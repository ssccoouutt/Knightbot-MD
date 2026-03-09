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

function convertTelegramToWhatsApp(text, entities) {
    if (!text) return text;
    
    // If we have entities, use them for accurate formatting
    if (entities && entities.length > 0) {
        // Sort entities in reverse order by offset to handle nested formatting
        const sortedEntities = [...entities].sort((a, b) => b.offset - a.offset);
        
        // Convert text to array for manipulation
        let result = text;
        
        for (const entity of sortedEntities) {
            const start = entity.offset;
            const end = start + entity.length;
            const content = text.substring(start, end);
            
            // Handle different entity types
            switch (entity.className) {
                case 'MessageEntityBold':
                    // Bold: **text** → *text*
                    result = result.substring(0, start) + 
                             '*' + content + '*' + 
                             result.substring(end);
                    break;
                    
                case 'MessageEntityItalic':
                    // Italic: _text_ → _text_
                    result = result.substring(0, start) + 
                             '_' + content + '_' + 
                             result.substring(end);
                    break;
                    
                case 'MessageEntityStrike':
                    // Strikethrough: ~text~ → ~text~
                    result = result.substring(0, start) + 
                             '~' + content + '~' + 
                             result.substring(end);
                    break;
                    
                case 'MessageEntityCode':
                    // Code: `text` → ```text```
                    result = result.substring(0, start) + 
                             '```' + content + '```' + 
                             result.substring(end);
                    break;
                    
                case 'MessageEntityPre':
                case 'MessageEntityBlockquote':
                    // Pre-formatted: keep as is but wrap with ```
                    const lines = content.split('\n');
                    const wrappedLines = lines.map(line => {
                        return line.trim() ? '```' + line + '```' : '';
                    });
                    result = result.substring(0, start) + 
                             wrappedLines.join('\n') + 
                             result.substring(end);
                    break;
                    
                case 'MessageEntityTextUrl':
                case 'MessageEntityUrl':
                    // Links: keep as plain text (WhatsApp doesn't support formatted links)
                    // Just keep the text without special formatting
                    break;
                    
                default:
                    // Unknown entity type, leave as is
                    break;
            }
        }
        
        return result;
    }
    
    // Fallback to regex if no entities available
    let formatted = text;
    
    // Remove escape characters
    formatted = formatted.replace(/\\([^a-zA-Z0-9])/g, '$1');
    
    // Convert Telegram markdown to WhatsApp format
    formatted = formatted.replace(/\*\*(.*?)\*\*/g, '*$1*');     // Bold
    formatted = formatted.replace(/__(.*?)__/g, '_$1_');        // Italic
    formatted = formatted.replace(/~~(.*?)~~/g, '~$1~');        // Strikethrough
    formatted = formatted.replace(/`(.*?)`/g, '```$1```');      // Code
    
    // Handle pre-formatted blocks
    formatted = formatted.replace(/```(.*?)```/gs, (match, code) => {
        const lines = code.split('\n');
        return lines.map(line => line.trim() ? '```' + line + '```' : '').join('\n');
    });
    
    // Clean up whitespace
    formatted = formatted.replace(/[ \t]+/g, ' ');
    formatted = formatted.replace(/\n{3,}/g, '\n\n');
    
    return formatted.trim();
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
                
                // Get message text and entities
                const text = msg.text || '';
                const entities = msg.entities || [];
                
                // Convert formatting for WhatsApp
                const formattedText = convertTelegramToWhatsApp(text, entities);
                
                // TEXT ONLY - send with formatting
                if (!msg.media) {
                    await sock.sendMessage(whatsappJid, { text: formattedText });
                    return;
                }
                
                // MEDIA WITH CAPTION
                const buffer = await downloadMedia(telegramClient, msg);
                
                if (!buffer) return;
                
                if (msg.photo) {
                    await sock.sendMessage(whatsappJid, {
                        image: buffer,
                        caption: formattedText
                    });
                }
                else if (msg.video) {
                    await sock.sendMessage(whatsappJid, {
                        video: buffer,
                        caption: formattedText
                    });
                }
                else if (msg.document) {
                    const fileName = msg.document.attributes
                        .find(a => a.className === 'DocumentAttributeFilename')?.fileName || 'file';
                    
                    await sock.sendMessage(whatsappJid, {
                        document: buffer,
                        fileName: fileName,
                        caption: formattedText
                    });
                }
                else if (msg.audio) {
                    await sock.sendMessage(whatsappJid, {
                        audio: buffer,
                        caption: formattedText
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
                
            } catch (err) {
                // Silent fail
            }
        }
        
        telegramClient.addEventHandler(messageHandler, new NewMessage({}));
        
        isActive = true;
        config.active = true;
        saveConfig(config);
        
        await sock.sendMessage(chatId, { text: '✅ Bridge active' });
        return true;
        
    } catch (error) {
        await sock.sendMessage(chatId, { text: '❌ Failed to start' });
        return false;
    }
}

async function telegramCommand(sock, chatId, message, args) {
    const sub = args[0]?.toLowerCase();
    const config = loadConfig();
    
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
