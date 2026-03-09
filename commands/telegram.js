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

// Entity types mapping (Telegram API constants)
const ENTITY_TYPES = {
    BOLD: 'messageEntityBold',
    ITALIC: 'messageEntityItalic',
    CODE: 'messageEntityCode',
    PRE: 'messageEntityPre',
    STRIKETHROUGH: 'messageEntityStrike',
    UNDERLINE: 'messageEntityUnderline',
    TEXT_LINK: 'messageEntityTextUrl',
    MENTION: 'messageEntityMention',
    HASHTAG: 'messageEntityHashtag',
    BOT_COMMAND: 'messageEntityBotCommand',
    URL: 'messageEntityUrl',
    EMAIL: 'messageEntityEmail',
    PHONE: 'messageEntityPhone',
    CASHTAG: 'messageEntityCashtag',
    SPOILER: 'messageEntitySpoiler'
};

// Mapping of Telegram entities to WhatsApp formatting
function getWhatsAppFormatting(entityType) {
    const formattingMap = {
        [ENTITY_TYPES.BOLD]: { prefix: '*', suffix: '*' },
        [ENTITY_TYPES.ITALIC]: { prefix: '_', suffix: '_' },
        [ENTITY_TYPES.STRIKETHROUGH]: { prefix: '~', suffix: '~' },
        [ENTITY_TYPES.CODE]: { prefix: '```', suffix: '```' },
        [ENTITY_TYPES.PRE]: { prefix: '```\n', suffix: '\n```' },
        [ENTITY_TYPES.UNDERLINE]: { prefix: '', suffix: '' }, // Not supported in WhatsApp
        [ENTITY_TYPES.SPOILER]: { prefix: '', suffix: '' }, // Not supported
        [ENTITY_TYPES.TEXT_LINK]: { prefix: '', suffix: '' } // Handle separately
    };
    return formattingMap[entityType] || null;
}

/**
 * Convert Telegram formatted text to WhatsApp format using entities
 */
function convertTelegramToWhatsApp(text, entities) {
    if (!text) return text;
    if (!entities || entities.length === 0) return text;

    // Sort entities in reverse order by offset to avoid position shifting
    const sortedEntities = [...entities].sort((a, b) => b.offset - a.offset);
    
    // Convert text to array for manipulation
    let result = text;
    
    for (const entity of sortedEntities) {
        const formatting = getWhatsAppFormatting(entity.className);
        if (!formatting) continue; // Skip unsupported formatting
        
        const start = entity.offset;
        const end = start + entity.length;
        
        // Extract the formatted content
        const content = text.substring(start, end);
        
        // Handle multi-line content specially
        if (entity.className === ENTITY_TYPES.PRE) {
            // Pre-formatted blocks keep their structure
            const replacement = `${formatting.prefix}${content}${formatting.suffix}`;
            result = result.substring(0, start) + replacement + result.substring(end);
        } else {
            // For other types, process line by line to maintain WhatsApp syntax
            const lines = content.split('\n');
            const wrappedLines = lines.map(line => {
                if (line.trim()) {
                    return `${formatting.prefix}${line}${formatting.suffix}`;
                }
                return line; // Preserve empty lines
            });
            const replacement = wrappedLines.join('\n');
            result = result.substring(0, start) + replacement + result.substring(end);
        }
    }
    
    return result;
}

/**
 * Fallback method using regex when entities aren't available
 */
function convertWithRegex(text) {
    if (!text) return text;
    
    let result = text;
    
    // Remove escape characters
    result = result.replace(/\\([^a-zA-Z0-9])/g, '$1');
    
    // Convert Telegram markdown to WhatsApp format
    // Bold: **text** or __text__ to *text*
    result = result.replace(/\*\*(.*?)\*\*/g, '*$1*');
    result = result.replace(/__(.*?)__/g, '_$1_');
    
    // Italic: *text* or _text_ to _text_ (but careful not to conflict with bold)
    result = result.replace(/(?<!\*)\*(?!\*)(.*?)(?<!\*)\*(?!\*)/g, '_$1_');
    
    // Strikethrough: ~text~ or ~~text~~ to ~text~
    result = result.replace(/~~(.*?)~~/g, '~$1~');
    result = result.replace(/~(.*?)~/g, '~$1~');
    
    // Code: `text` to ```text```
    result = result.replace(/`([^`]+)`/g, '```$1```');
    
    // Clean up multiple spaces and newlines
    result = result.replace(/[ \t]+/g, ' ');
    result = result.replace(/\n{3,}/g, '\n\n');
    
    return result.trim();
}

/**
 * Extract and process entities from message
 */
function extractEntities(message) {
    const entities = [];
    
    // Combine all entity types that might be present
    const entityFields = [
        'entities', 'bold', 'italic', 'underline', 'strike', 'code',
        'pre', 'blockquote', 'spoiler', 'textUrl', 'mention', 'hashtag'
    ];
    
    for (const field of entityFields) {
        if (message[field]) {
            if (Array.isArray(message[field])) {
                entities.push(...message[field]);
            } else if (message[field] && typeof message[field] === 'object') {
                entities.push(message[field]);
            }
        }
    }
    
    return entities;
}

async function downloadMedia(client, message) {
    try {
        const tempFile = path.join(TEMP_DIR, `tg_${message.id}_${Date.now()}`);
        await client.downloadMedia(message, { outputFile: tempFile });
        const buffer = fs.readFileSync(tempFile);
        fs.unlinkSync(tempFile);
        return buffer;
    } catch (error) {
        console.error('Media download error:', error);
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
        console.log('✅ Telegram connected');
        
        async function messageHandler(event) {
            try {
                const msg = event.message;
                if (!msg) return;
                
                // Skip commands
                if (msg.text && msg.text.startsWith('/')) return;
                
                // Get entities and convert formatting
                const entities = extractEntities(msg);
                let formattedText = msg.text || '';
                
                if (entities.length > 0) {
                    // Use entity-based conversion for accurate formatting
                    formattedText = convertTelegramToWhatsApp(formattedText, entities);
                } else if (formattedText) {
                    // Fallback to regex conversion
                    formattedText = convertWithRegex(formattedText);
                }
                
                // TEXT ONLY - send with converted formatting
                if (msg.text && !msg.media) {
                    await sock.sendMessage(whatsappJid, { text: formattedText });
                    console.log('✅ Sent text with formatting:', formattedText.substring(0, 50) + '...');
                    return;
                }
                
                // MEDIA WITH CAPTION
                const caption = formattedText || '';
                const buffer = await downloadMedia(telegramClient, msg);
                
                if (!buffer) return;
                
                if (msg.photo) {
                    await sock.sendMessage(whatsappJid, {
                        image: buffer,
                        caption: caption
                    });
                }
                else if (msg.video) {
                    await sock.sendMessage(whatsappJid, {
                        video: buffer,
                        caption: caption
                    });
                }
                else if (msg.document) {
                    const fileName = msg.document.attributes
                        .find(a => a.className === 'DocumentAttributeFilename')?.fileName || 'file';
                    
                    await sock.sendMessage(whatsappJid, {
                        document: buffer,
                        fileName: fileName,
                        caption: caption
                    });
                }
                else if (msg.audio) {
                    await sock.sendMessage(whatsappJid, {
                        audio: buffer,
                        caption: caption
                    });
                }
                else if (msg.voice) {
                    await sock.sendMessage(whatsappJid, {
                        audio: buffer,
                        ptt: true,
                        caption: caption
                    });
                }
                else if (msg.sticker) {
                    await sock.sendMessage(whatsappJid, {
                        sticker: buffer
                    });
                }
                
            } catch (err) {
                console.error('Message handling error:', err);
            }
        }
        
        telegramClient.addEventHandler(messageHandler, new NewMessage({}));
        
        isActive = true;
        config.active = true;
        saveConfig(config);
        
        await sock.sendMessage(chatId, { text: '✅ Bridge active with formatting support' });
        return true;
        
    } catch (error) {
        console.error('Start error:', error);
        await sock.sendMessage(chatId, { text: '❌ Failed to start' });
        return false;
    }
}

async function telegramCommand(sock, chatId, message, args) {
    const sub = args[0]?.toLowerCase();
    const config = loadConfig();
    
    if (!sub) {
        await sock.sendMessage(chatId, { 
            text: `📊 Status\nActive: ${isActive ? '✅' : '❌'}\nToken: ${config.botToken ? '✅' : '❌'}\nWhatsApp: ${config.whatsappNumber || 'Not set'}\nFormatting: ✅ Bold, Italic, Strikethrough, Code\n\nCommands:\n.on - Start\n.off - Stop\n.settoken TOKEN\n.setwa NUMBER`
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
