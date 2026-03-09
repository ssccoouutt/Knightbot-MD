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

// ===== EXACT PATTERN FROM YOUR PYTHON SCRIPT =====
function clean_whatsapp_text(text, entities) {
    if (!text) return text;
    
    let formatted = text;
    
    if (entities && entities.length > 0) {
        // Sort entities in reverse order
        const sorted = [...entities].sort((a, b) => b.offset - a.offset);
        
        for (const entity of sorted) {
            const start = entity.offset;
            const end = start + entity.length;
            const content = text.substring(start, end);
            
            // Exactly like your Python script's entity_types mapping
            const entityTypes = {
                'MessageEntityBold': ['*', '*'],
                'MessageEntityItalic': ['_', '_'],
                'MessageEntityStrike': ['~', '~'],
                'MessageEntityCode': ['```', '```'],
                'MessageEntityPre': ['```\n', '\n```']
            };
            
            const type = entity.className;
            if (entityTypes[type]) {
                const [prefix, suffix] = entityTypes[type];
                
                // Process line by line like Python script
                const lines = content.split('\n');
                const wrappedLines = [];
                
                for (const line of lines) {
                    if (line.trim()) {
                        wrappedLines.push(`${prefix}${line.trim()}${suffix}`);
                    } else {
                        wrappedLines.push('');
                    }
                }
                
                const replacement = wrappedLines.join('\n');
                formatted = formatted.substring(0, start) + replacement + formatted.substring(end);
            }
        }
    } else {
        // Fallback regex processing like Python script
        formatted = formatted.replace(/\*\*(.*?)\*\*/g, '*$1*');  // bold
        formatted = formatted.replace(/__(.*?)__/g, '_$1_');      // italic
        formatted = formatted.replace(/~~(.*?)~~/g, '~$1~');      // strikethrough
        formatted = formatted.replace(/`(.*?)`/g, '```$1```');    // code
    }
    
    // Clean whitespace exactly like Python script
    formatted = formatted.replace(/[ \t]+/g, ' ');
    formatted = formatted.replace(/\n{3,}/g, '\n\n');
    
    return formatted.trim();
}

function getEntities(msg) {
    const entities = [];
    
    // Telethon uses different property names
    if (msg.entities) {
        for (const e of msg.entities) {
            entities.push({
                className: e.className,
                offset: e.offset,
                length: e.length
            });
        }
    }
    if (msg.captionEntities) {
        for (const e of msg.captionEntities) {
            entities.push({
                className: e.className,
                offset: e.offset,
                length: e.length
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
        console.log('✅ Connected');
        
        async function messageHandler(event) {
            try {
                const msg = event.message;
                if (!msg) return;
                
                // Skip commands
                if (msg.text && msg.text.startsWith('/')) return;
                
                const entities = getEntities(msg);
                const caption = msg.text || '';
                
                // TEXT ONLY
                if (msg.text && !msg.media) {
                    const formatted = clean_whatsapp_text(msg.text, entities);
                    await sock.sendMessage(whatsappJid, { text: formatted });
                    return;
                }
                
                // MEDIA
                const buffer = await downloadMedia(telegramClient, msg);
                if (!buffer) return;
                
                const formattedCaption = clean_whatsapp_text(caption, entities);
                
                if (msg.photo) {
                    await sock.sendMessage(whatsappJid, {
                        image: buffer,
                        caption: formattedCaption
                    });
                }
                else if (msg.video) {
                    await sock.sendMessage(whatsappJid, {
                        video: buffer,
                        caption: formattedCaption
                    });
                }
                else if (msg.document) {
                    const fileName = msg.document.attributes
                        .find(a => a.className === 'DocumentAttributeFilename')?.fileName || 'file';
                    
                    await sock.sendMessage(whatsappJid, {
                        document: buffer,
                        fileName: fileName,
                        caption: formattedCaption
                    });
                }
                else if (msg.audio) {
                    await sock.sendMessage(whatsappJid, {
                        audio: buffer,
                        caption: formattedCaption
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
                // Silent
            }
        }
        
        telegramClient.addEventHandler(messageHandler, new NewMessage({}));
        
        isActive = true;
        config.active = true;
        saveConfig(config);
        
        await sock.sendMessage(chatId, { text: '✅ Bridge active' });
        return true;
        
    } catch (error) {
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
