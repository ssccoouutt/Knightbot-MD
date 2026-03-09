const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { NewMessage } = require('telegram/events');
const fs = require('fs');
const path = require('path');

const CONFIG_FILE = path.join(process.cwd(), 'data', 'telegram_bridge.json');
const TEMP_DIR = path.join(process.cwd(), 'temp');
let telegramClient = null;
let isActive = false;

if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

const API_ID = 32086282;
const API_HASH = "064a66fe7097452e6ac8f4e8df28aa97";

function loadConfig() {
    try {
        if (fs.existsSync(CONFIG_FILE)) {
            return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
        }
    } catch (e) {}
    return {
        botToken: null,
        whatsappNumber: null,
        active: false
    };
}

function saveConfig(config) {
    fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

// ===== ENTITY ADJUSTMENT (like Python's adjust_entity_offsets) =====
function adjustEntityOffsets(text, entities) {
    if (!entities || entities.length === 0) return entities;
    
    // Create position mapping for multi-code-point characters
    const posMap = {};
    let charPos = 0;
    let utf16Pos = 0;
    
    for (let i = 0; i < text.length; i++) {
        posMap[utf16Pos] = charPos;
        utf16Pos += text[i].length; // In JS, string length handles UTF-16 correctly
        charPos++;
    }
    
    return entities.map(entity => ({
        ...entity,
        offset: posMap[entity.offset] !== undefined ? posMap[entity.offset] : entity.offset,
        length: entity.length // Length remains the same in characters
    }));
}

// ===== FILTER ENTITIES (like Python's filter_entities) =====
function filterEntities(entities) {
    const allowedTypes = [
        'MessageEntityBold',
        'MessageEntityItalic', 
        'MessageEntityCode',
        'MessageEntityPre',
        'MessageEntityUnderline',
        'MessageEntityStrike',
        'MessageEntityTextUrl',
        'MessageEntitySpoiler',
        'MessageEntityBlockquote'
    ];
    
    return entities.filter(e => allowedTypes.includes(e.className));
}

// ===== APPLY TELEGRAM FORMATTING (like Python's apply_telegram_formatting) =====
function applyTelegramFormatting(text, entities) {
    if (!text) return text;
    
    let chars = [...text];
    let textLength = chars.length;
    
    // Sort entities in reverse order
    const sorted = [...(entities || [])].sort((a, b) => b.offset - a.offset);
    
    // Entity tag mapping
    const entityTags = {
        'MessageEntityBold': ['<b>', '</b>'],
        'MessageEntityItalic': ['<i>', '</i>'],
        'MessageEntityUnderline': ['<u>', '</u>'],
        'MessageEntityStrike': ['<s>', '</s>'],
        'MessageEntitySpoiler': ['<tg-spoiler>', '</tg-spoiler>'],
        'MessageEntityCode': ['<code>', '</code>'],
        'MessageEntityPre': ['<pre>', '</pre>'],
        'MessageEntityTextUrl': (e) => [`<a href="${e.url}">`, '</a>'],
        'MessageEntityBlockquote': ['<blockquote>', '</blockquote>']
    };
    
    for (const entity of sorted) {
        const entityType = entity.className;
        if (!entityTags[entityType]) continue;
        
        let [startTag, endTag] = entityTags[entityType];
        if (typeof startTag === 'function') {
            startTag = startTag(entity);
        }
        
        const start = entity.offset;
        const end = start + entity.length;
        
        if (start >= textLength || end > textLength) continue;
        
        const before = chars.slice(0, start).join('');
        const content = chars.slice(start, end).join('');
        const after = chars.slice(end).join('');
        
        // Special handling for blockquotes
        let processedContent = content;
        if (entityType === 'MessageEntityBlockquote') {
            processedContent = content
                .replace(/<b>/g, '').replace(/<\/b>/g, '')
                .replace(/<i>/g, '').replace(/<\/i>/g, '');
        }
        
        chars = [...(before + startTag + processedContent + endTag + after)];
        textLength = chars.length;
    }
    
    let formattedText = chars.join('');
    
    // Handle manual blockquotes (lines starting with >)
    if (formattedText.includes('>')) {
        formattedText = formattedText.replace(/&gt;/g, '>');
        const lines = formattedText.split('\n');
        const formattedLines = [];
        let inBlockquote = false;
        
        for (const line of lines) {
            if (line.startsWith('>')) {
                if (!inBlockquote) {
                    formattedLines.push('<blockquote>');
                    inBlockquote = true;
                }
                formattedLines.push(line.substring(1).trim());
            } else {
                if (inBlockquote) {
                    formattedLines.push('</blockquote>');
                    inBlockquote = false;
                }
                formattedLines.push(line);
            }
        }
        
        if (inBlockquote) {
            formattedLines.push('</blockquote>');
        }
        
        formattedText = formattedLines.join('\n');
    }
    
    // HTML escaping
    formattedText = formattedText
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    
    // Re-insert HTML tags
    const htmlTags = ['b', 'i', 'u', 's', 'code', 'pre', 'a', 'tg-spoiler', 'blockquote'];
    for (const tag of htmlTags) {
        formattedText = formattedText
            .replace(new RegExp(`&lt;${tag}&gt;`, 'g'), `<${tag}>`)
            .replace(new RegExp(`&lt;/${tag}&gt;`, 'g'), `</${tag}>`);
    }
    
    return formattedText;
}

// ===== CLEAN WHATSAPP TEXT (exact Python port) =====
function cleanWhatsAppText(text, entities = null) {
    if (!text) return text;
    
    console.log('\n🔍 [WHATSAPP FORMATTING DEBUG]');
    console.log(`Input text: "${text}"`);
    console.log(`Entity count: ${entities?.length || 0}`);
    
    if (entities && entities.length > 0) {
        // Adjust entity offsets
        const adjustedEntities = adjustEntityOffsets(text, entities);
        console.log(`Adjusted entities: ${adjustedEntities.length}`);
        
        // Convert to array for manipulation
        let textArray = [...text];
        
        // Entity type mapping (same as Python)
        const entityTypes = {
            'MessageEntityBold': ['*', '*'],
            'MessageEntityItalic': ['_', '_'],
            'MessageEntityStrike': ['~', '~'],
            'MessageEntityCode': ['```', '```'],
            'MessageEntityPre': ['```\n', '\n```']
        };
        
        // Sort in reverse order (like Python)
        const sorted = [...adjustedEntities].sort((a, b) => b.offset - a.offset);
        
        for (const entity of sorted) {
            console.log(`\nProcessing entity: ${entity.className}`);
            console.log(`  Offset: ${entity.offset}, Length: ${entity.length}`);
            
            if (entityTypes[entity.className]) {
                const [prefix, suffix] = entityTypes[entity.className];
                const start = entity.offset;
                const end = start + entity.length;
                
                // Extract content
                let content = text.substring(start, end);
                console.log(`  Raw content: "${content}"`);
                
                let replacement;
                if (entity.className === 'MessageEntityPre') {
                    replacement = `${prefix}${content}${suffix}`;
                    console.log(`  PRE formatting: "${replacement}"`);
                } else {
                    // Process line by line
                    const lines = content.split('\n');
                    const wrappedLines = [];
                    
                    for (const line of lines) {
                        if (line.trim()) {
                            // Remove any existing markdown
                            const cleanLine = line.replace(/[*_~`]/g, '');
                            wrappedLines.push(`${prefix}${cleanLine}${suffix}`);
                            console.log(`    Line: "${line}" → "*${cleanLine}*"`);
                        } else {
                            wrappedLines.push('');
                            console.log(`    Empty line preserved`);
                        }
                    }
                    
                    replacement = wrappedLines.join('\n');
                    console.log(`  Final replacement: "${replacement}"`);
                }
                
                // Replace in text
                textArray.splice(start, end - start, ...replacement.split(''));
            }
        }
        
        text = textArray.join('');
        console.log(`\nAfter entity processing: "${text}"`);
    } else {
        // Fallback regex (like Python)
        console.log('No entities, using regex fallback');
        text = text.replace(/\\([^a-zA-Z0-9])/g, '$1');
        text = text.replace(/\*\*(.*?)\*\*/g, '*$1*');
        text = text.replace(/__(.*?)__/g, '_$1_');
        text = text.replace(/~~(.*?)~~/g, '~$1~');
        text = text.replace(/`(.*?)`/g, '```$1```');
    }
    
    // Clean whitespace (like Python)
    text = text.replace(/[ \t]+/g, ' ');
    text = text.replace(/\n{3,}/g, '\n\n');
    
    console.log(`\n✅ Final WhatsApp text: "${text.trim()}"`);
    console.log('=====================================\n');
    
    return text.trim();
}

// ===== GET ENTITIES =====
function getEntities(msg) {
    const entities = [];
    
    if (msg.entities) {
        for (const e of msg.entities) {
            entities.push({
                className: e.className,
                offset: e.offset,
                length: e.length,
                url: e.url // For text links
            });
        }
    }
    
    return entities;
}

async function downloadMedia(client, message) {
    try {
        const tempFile = path.join(TEMP_DIR, `tg_${message.id}`);
        await client.downloadMedia(message, { outputFile: tempFile });
        const buffer = fs.readFileSync(tempFile);
        fs.unlinkSync(tempFile);
        return buffer;
    } catch (error) {
        return null;
    }
}

async function startTelegramBot(sock, chatId) {
    const config = loadConfig();
    
    if (!config.botToken) {
        await sock.sendMessage(chatId, { text: '❌ Set bot token first: `.settoken TOKEN`' });
        return false;
    }
    
    if (!config.whatsappNumber) {
        await sock.sendMessage(chatId, { text: '❌ Set WhatsApp number first: `.setwa NUMBER`' });
        return false;
    }

    try {
        if (telegramClient) await telegramClient.disconnect();
        
        const whatsappJid = config.whatsappNumber.includes('@s.whatsapp.net') ?
            config.whatsappNumber :
            `${config.whatsappNumber}@s.whatsapp.net`;
        
        telegramClient = new TelegramClient(new StringSession(""), API_ID, API_HASH, {
            connectionRetries: 5
        });
        
        await telegramClient.start({ botAuthToken: config.botToken });
        console.log('✅ Connected to Telegram');
        
        async function messageHandler(event) {
            try {
                const msg = event.message;
                if (!msg) return;
                
                if (msg.text && msg.text.startsWith('/')) return;
                
                const text = msg.text || '';
                const entities = getEntities(msg);
                
                console.log('\n📨 ===== NEW MESSAGE =====');
                console.log(`Raw text: "${text}"`);
                console.log(`Has media: ${!!msg.media}`);
                console.log(`Raw entities:`, entities.map(e => `${e.className}(${e.offset},${e.length})`));
                
                // Filter entities (like Python)
                const filteredEntities = filterEntities(entities);
                console.log(`Filtered entities:`, filteredEntities.map(e => e.className));
                
                // Format for WhatsApp
                const whatsappFormatted = cleanWhatsAppText(text, filteredEntities);
                
                if (text && !msg.media) {
                    console.log(`💬 Sending to WhatsApp: "${whatsappFormatted}"`);
                    await sock.sendMessage(whatsappJid, { text: whatsappFormatted });
                }
                
                if (msg.media) {
                    const buffer = await downloadMedia(telegramClient, msg);
                    if (!buffer) return;
                    
                    console.log(`📤 Sending media with caption: "${whatsappFormatted}"`);
                    
                    if (msg.photo) {
                        await sock.sendMessage(whatsappJid, {
                            image: buffer,
                            caption: whatsappFormatted
                        });
                    }
                    else if (msg.video) {
                        await sock.sendMessage(whatsappJid, {
                            video: buffer,
                            caption: whatsappFormatted
                        });
                    }
                    else if (msg.document) {
                        const attrs = msg.document.attributes;
                        const fileName = attrs.find(a => a.className === 'DocumentAttributeFilename')?.fileName || 'file';
                        
                        await sock.sendMessage(whatsappJid, {
                            document: buffer,
                            fileName: fileName,
                            caption: whatsappFormatted
                        });
                    }
                    else if (msg.audio) {
                        await sock.sendMessage(whatsappJid, {
                            audio: buffer,
                            caption: whatsappFormatted
                        });
                    }
                    else if (msg.voice) {
                        await sock.sendMessage(whatsappJid, {
                            audio: buffer,
                            ptt: true
                        });
                    }
                    else if (msg.sticker) {
                        await sock.sendMessage(whatsappJid, {
                            sticker: buffer
                        });
                    }
                }
                
                console.log('✅ ===== MESSAGE PROCESSED =====\n');
                
            } catch (err) {
                console.error('❌ Error:', err);
            }
        }
        
        telegramClient.addEventHandler(messageHandler, new NewMessage({}));
        
        isActive = true;
        config.active = true;
        saveConfig(config);
        
        await sock.sendMessage(chatId, { text: '✅ Bridge active - Full Python port with debug' });
        return true;
        
    } catch (error) {
        console.error('Start error:', error);
        await sock.sendMessage(chatId, { text: '❌ Failed' });
        return false;
    }
}

async function telegramCommand(sock, chatId, message, args) {
    const sub = args[0]?.toLowerCase();
    const config = loadConfig();
    
    if (!sub) {
        await sock.sendMessage(chatId, { 
            text: `📊 Status\nActive: ${isActive ? '✅' : '❌'}\nToken: ${config.botToken ? '✅' : '❌'}\nWhatsApp: ${config.whatsappNumber || 'Not set'}\n\nCommands:\n.on\n.off\n.settoken\n.setwa`
        });
        return;
    }
    
    switch (sub) {
        case 'on':
            await startTelegramBot(sock, chatId);
            break;
        case 'off':
            if (telegramClient) await telegramClient.disconnect();
            isActive = false;
            config.active = false;
            saveConfig(config);
            await sock.sendMessage(chatId, { text: '🔴 Stopped' });
            break;
    }
}

async function setTokenCommand(sock, chatId, message, token) {
    if (!token) return await sock.sendMessage(chatId, { text: '❌ Provide token' });
    const config = loadConfig();
    config.botToken = token;
    saveConfig(config);
    await sock.sendMessage(chatId, { text: '✅ Token saved' });
}

async function setWaCommand(sock, chatId, message, number) {
    if (!number) return await sock.sendMessage(chatId, { text: '❌ Provide number' });
    const cleanNumber = number.replace(/[^0-9]/g, '');
    const config = loadConfig();
    config.whatsappNumber = cleanNumber;
    saveConfig(config);
    await sock.sendMessage(chatId, { text: `✅ WhatsApp set: ${cleanNumber}` });
}

module.exports = {
    telegramCommand,
    setTokenCommand,
    setWaCommand
};
