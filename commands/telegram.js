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

// Logger function with timestamps
function log(level, message, data = null) {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] [${level}] ${message}`;
    console.log(logMessage);
    if (data) {
        console.log(JSON.stringify(data, null, 2));
    }
    // Also write to file for persistent logging
    const logDir = path.join(process.cwd(), 'logs');
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
    fs.appendFileSync(
        path.join(logDir, 'telegram_bridge.log'),
        logMessage + (data ? '\n' + JSON.stringify(data) : '') + '\n'
    );
}

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

async function downloadMedia(client, message) {
    try {
        const tempFile = path.join(TEMP_DIR, `tg_${message.id}`);
        await client.downloadMedia(message, { outputFile: tempFile });
        const buffer = fs.readFileSync(tempFile);
        fs.unlinkSync(tempFile);
        return buffer;
    } catch (error) {
        log('ERROR', 'Media download failed', { error: error.message });
        return null;
    }
}

function convertTelegramToWhatsApp(text, entities) {
    log('DEBUG', 'Converting text with entities', { 
        originalText: text,
        entityCount: entities?.length || 0,
        entities: entities?.map(e => ({
            type: e.className,
            offset: e.offset,
            length: e.length,
            content: text?.substring(e.offset, e.offset + e.length)
        }))
    });
    
    if (!text) return text;
    
    // If we have entities, use them for accurate formatting
    if (entities && entities.length > 0) {
        // Sort entities in reverse order by offset to handle nested formatting
        const sortedEntities = [...entities].sort((a, b) => b.offset - a.offset);
        
        log('DEBUG', 'Sorted entities for processing', {
            sorted: sortedEntities.map(e => ({
                type: e.className,
                offset: e.offset,
                length: e.length
            }))
        });
        
        // Start with original text
        let result = text;
        
        for (const entity of sortedEntities) {
            const start = entity.offset;
            const end = start + entity.length;
            const content = text.substring(start, end);
            
            log('DEBUG', 'Processing entity', {
                type: entity.className,
                start,
                end,
                content,
                currentResult: result
            });
            
            // Handle different entity types
            switch (entity.className) {
                case 'MessageEntityBold':
                    log('INFO', 'Converting BOLD formatting', {
                        before: content,
                        after: `*${content}*`
                    });
                    // Bold: **text** → *text*
                    result = result.substring(0, start) + 
                             '*' + content + '*' + 
                             result.substring(end);
                    break;
                    
                case 'MessageEntityItalic':
                    log('INFO', 'Converting ITALIC formatting', {
                        before: content,
                        after: `_${content}_`
                    });
                    // Italic: _text_ → _text_
                    result = result.substring(0, start) + 
                             '_' + content + '_' + 
                             result.substring(end);
                    break;
                    
                case 'MessageEntityStrike':
                    log('INFO', 'Converting STRIKETHROUGH formatting', {
                        before: content,
                        after: `~${content}~`
                    });
                    // Strikethrough: ~text~ → ~text~
                    result = result.substring(0, start) + 
                             '~' + content + '~' + 
                             result.substring(end);
                    break;
                    
                case 'MessageEntityCode':
                    log('INFO', 'Converting CODE formatting', {
                        before: content,
                        after: `\`\`\`${content}\`\`\``
                    });
                    // Code: `text` → ```text```
                    result = result.substring(0, start) + 
                             '```' + content + '```' + 
                             result.substring(end);
                    break;
                    
                case 'MessageEntityPre':
                case 'MessageEntityBlockquote':
                    log('INFO', 'Converting PRE/BLOCKQUOTE formatting', {
                        before: content,
                        lines: content.split('\n').length
                    });
                    // Pre-formatted: keep as is but wrap with ```
                    const lines = content.split('\n');
                    const wrappedLines = lines.map(line => {
                        return line.trim() ? '```' + line + '```' : '';
                    });
                    const replacement = wrappedLines.join('\n');
                    log('DEBUG', 'Pre-formatted conversion', {
                        original: content,
                        wrapped: replacement
                    });
                    result = result.substring(0, start) + 
                             replacement + 
                             result.substring(end);
                    break;
                    
                case 'MessageEntityTextUrl':
                case 'MessageEntityUrl':
                    log('INFO', 'Skipping URL entity (WhatsApp doesn\'t support formatted links)', {
                        content
                    });
                    // Links: keep as plain text
                    break;
                    
                default:
                    log('WARN', 'Unknown entity type', {
                        type: entity.className,
                        content
                    });
                    break;
            }
            
            log('DEBUG', 'After entity processing', {
                type: entity.className,
                newResult: result
            });
        }
        
        log('INFO', 'Final formatted text (entities method)', {
            original: text,
            formatted: result
        });
        
        return result;
    }
    
    log('DEBUG', 'No entities found, using regex fallback');
    
    // Fallback to regex if no entities available
    let formatted = text;
    
    // Log regex patterns being applied
    const regexSteps = [];
    
    // Remove escape characters
    const step1 = formatted.replace(/\\([^a-zA-Z0-9])/g, '$1');
    if (step1 !== formatted) regexSteps.push({ step: 'remove_escapes', before: formatted, after: step1 });
    formatted = step1;
    
    // Convert Telegram markdown to WhatsApp format
    const step2 = formatted.replace(/\*\*(.*?)\*\*/g, '*$1*');
    if (step2 !== formatted) regexSteps.push({ step: 'bold', before: formatted, after: step2 });
    formatted = step2;
    
    const step3 = formatted.replace(/__(.*?)__/g, '_$1_');
    if (step3 !== formatted) regexSteps.push({ step: 'italic', before: formatted, after: step3 });
    formatted = step3;
    
    const step4 = formatted.replace(/~~(.*?)~~/g, '~$1~');
    if (step4 !== formatted) regexSteps.push({ step: 'strikethrough', before: formatted, after: step4 });
    formatted = step4;
    
    const step5 = formatted.replace(/`(.*?)`/g, '```$1```');
    if (step5 !== formatted) regexSteps.push({ step: 'code', before: formatted, after: step5 });
    formatted = step5;
    
    // Handle pre-formatted blocks
    const step6 = formatted.replace(/```(.*?)```/gs, (match, code) => {
        const lines = code.split('\n');
        return lines.map(line => line.trim() ? '```' + line + '```' : '').join('\n');
    });
    if (step6 !== formatted) regexSteps.push({ step: 'pre', before: formatted, after: step6 });
    formatted = step6;
    
    // Clean up whitespace
    const step7 = formatted.replace(/[ \t]+/g, ' ');
    if (step7 !== formatted) regexSteps.push({ step: 'spaces', before: formatted, after: step7 });
    formatted = step7;
    
    const step8 = formatted.replace(/\n{3,}/g, '\n\n');
    if (step8 !== formatted) regexSteps.push({ step: 'newlines', before: formatted, after: step8 });
    formatted = step8;
    
    if (regexSteps.length > 0) {
        log('DEBUG', 'Regex conversion steps applied', regexSteps);
    }
    
    log('INFO', 'Final formatted text (regex method)', {
        original: text,
        formatted: formatted.trim()
    });
    
    return formatted.trim();
}

async function startTelegramBot(sock, chatId) {
    const config = loadConfig();
    
    log('INFO', 'Starting Telegram bot', { chatId, hasToken: !!config.botToken, hasNumber: !!config.whatsappNumber });
    
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
        
        log('INFO', 'WhatsApp JID configured', { whatsappJid });
        
        telegramClient = new TelegramClient(new StringSession(""), API_ID, API_HASH, {
            connectionRetries: 5
        });
        
        await telegramClient.start({ botAuthToken: config.botToken });
        log('INFO', 'Telegram client connected successfully');
        
        async function messageHandler(event) {
            try {
                const msg = event.message;
                if (!msg) {
                    log('DEBUG', 'Empty message received');
                    return;
                }
                
                log('INFO', 'New message received', {
                    messageId: msg.id,
                    fromId: msg.fromId?.userId,
                    hasText: !!msg.text,
                    hasMedia: !!msg.media,
                    mediaType: msg.media?.className
                });
                
                // Skip commands
                if (msg.text && msg.text.startsWith('/')) {
                    log('DEBUG', 'Skipping command message', { text: msg.text });
                    return;
                }
                
                // Get message text and entities
                const text = msg.text || '';
                const entities = msg.entities || [];
                
                log('DEBUG', 'Message details', {
                    rawText: text,
                    entityCount: entities.length,
                    entities: entities.map(e => ({
                        type: e.className,
                        offset: e.offset,
                        length: e.length
                    }))
                });
                
                // Convert formatting for WhatsApp
                const formattedText = convertTelegramToWhatsApp(text, entities);
                
                log('INFO', 'Sending to WhatsApp', {
                    originalText: text,
                    formattedText: formattedText,
                    hasMedia: !!msg.media
                });
                
                // TEXT ONLY - send with formatting
                if (!msg.media) {
                    await sock.sendMessage(whatsappJid, { text: formattedText });
                    log('INFO', 'Text message sent to WhatsApp', { text: formattedText });
                    return;
                }
                
                // MEDIA WITH CAPTION
                log('DEBUG', 'Downloading media', { messageId: msg.id });
                const buffer = await downloadMedia(telegramClient, msg);
                
                if (!buffer) {
                    log('ERROR', 'Failed to download media', { messageId: msg.id });
                    return;
                }
                
                log('DEBUG', 'Media downloaded successfully', { 
                    messageId: msg.id,
                    bufferSize: buffer.length 
                });
                
                if (msg.photo) {
                    await sock.sendMessage(whatsappJid, {
                        image: buffer,
                        caption: formattedText
                    });
                    log('INFO', 'Photo sent to WhatsApp with caption', { caption: formattedText });
                }
                else if (msg.video) {
                    await sock.sendMessage(whatsappJid, {
                        video: buffer,
                        caption: formattedText
                    });
                    log('INFO', 'Video sent to WhatsApp with caption', { caption: formattedText });
                }
                else if (msg.document) {
                    const fileName = msg.document.attributes
                        .find(a => a.className === 'DocumentAttributeFilename')?.fileName || 'file';
                    
                    await sock.sendMessage(whatsappJid, {
                        document: buffer,
                        fileName: fileName,
                        caption: formattedText
                    });
                    log('INFO', 'Document sent to WhatsApp', { fileName, caption: formattedText });
                }
                else if (msg.audio) {
                    await sock.sendMessage(whatsappJid, {
                        audio: buffer,
                        caption: formattedText
                    });
                    log('INFO', 'Audio sent to WhatsApp', { caption: formattedText });
                }
                else if (msg.voice) {
                    await sock.sendMessage(whatsappJid, {
                        audio: buffer,
                        ptt: true
                    });
                    log('INFO', 'Voice message sent to WhatsApp');
                }
                else if (msg.sticker) {
                    await sock.sendMessage(whatsappJid, {
                        sticker: buffer
                    });
                    log('INFO', 'Sticker sent to WhatsApp');
                }
                
            } catch (err) {
                log('ERROR', 'Message handler error', { 
                    error: err.message,
                    stack: err.stack 
                });
            }
        }
        
        telegramClient.addEventHandler(messageHandler, new NewMessage({}));
        log('INFO', 'Message handler registered');
        
        isActive = true;
        config.active = true;
        saveConfig(config);
        
        await sock.sendMessage(chatId, { text: '✅ Bridge active' });
        log('INFO', 'Bridge started successfully');
        return true;
        
    } catch (error) {
        log('ERROR', 'Failed to start Telegram bot', { 
            error: error.message,
            stack: error.stack 
        });
        await sock.sendMessage(chatId, { text: '❌ Failed to start' });
        return false;
    }
}

async function telegramCommand(sock, chatId, message, args) {
    const sub = args[0]?.toLowerCase();
    const config = loadConfig();
    
    log('INFO', 'Telegram command received', { sub, chatId });
    
    if (!sub) {
        await sock.sendMessage(chatId, { 
            text: `📊 Status\nActive: ${isActive ? '✅' : '❌'}\nToken: ${config.botToken ? '✅' : '❌'}\nWhatsApp: ${config.whatsappNumber || 'Not set'}\n\nCommands:\n.on - Start\n.off - Stop\n.settoken TOKEN\n.setwa NUMBER`
        });
        return;
    }
    
    switch (sub) {
        case 'on': case 'start':
            await startTelegramBot(sock, chatId);
            break;
        case 'off': case 'stop':
            if (telegramClient) await telegramClient.disconnect();
            isActive = false;
            config.active = false;
            saveConfig(config);
            await sock.sendMessage(chatId, { text: '🔴 Stopped' });
            log('INFO', 'Bridge stopped');
            break;
    }
}

async function setTokenCommand(sock, chatId, message, token) {
    if (!token) return await sock.sendMessage(chatId, { text: '❌ Provide token' });
    const config = loadConfig();
    config.botToken = token;
    saveConfig(config);
    log('INFO', 'Token saved', { chatId });
    await sock.sendMessage(chatId, { text: '✅ Token saved' });
}

async function setWaCommand(sock, chatId, message, number) {
    if (!number) return await sock.sendMessage(chatId, { text: '❌ Provide number' });
    const cleanNumber = number.replace(/[^0-9]/g, '');
    const config = loadConfig();
    config.whatsappNumber = cleanNumber;
    saveConfig(config);
    log('INFO', 'WhatsApp number saved', { chatId, number: cleanNumber });
    await sock.sendMessage(chatId, { text: `✅ WhatsApp set: ${cleanNumber}` });
}

module.exports = {
    telegramCommand,
    setTokenCommand,
    setWaCommand
};
