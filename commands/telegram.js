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

// Convert Telegram formatting to WhatsApp style
function formatForWhatsApp(text, entities) {
    if (!text) return text;
    
    let formatted = text;
    const adjustments = [];
    
    // Sort entities in reverse order to avoid offset issues
    const sorted = [...(entities || [])].sort((a, b) => b.offset - a.offset);
    
    for (const entity of sorted) {
        const start = entity.offset;
        const end = start + entity.length;
        const content = text.substring(start, end);
        
        switch (entity.className) {
            case 'MessageEntityBold':
                adjustments.push({ start, end, replacement: `*${content}*` });
                break;
            case 'MessageEntityItalic':
                adjustments.push({ start, end, replacement: `_${content}_` });
                break;
            case 'MessageEntityStrike':
                adjustments.push({ start, end, replacement: `~${content}~` });
                break;
            case 'MessageEntityCode':
            case 'MessageEntityPre':
                adjustments.push({ start, end, replacement: `\`\`\`${content}\`\`\`` });
                break;
            case 'MessageEntityUnderline':
                // WhatsApp doesn't have underline, use bold as fallback
                adjustments.push({ start, end, replacement: `*${content}*` });
                break;
            case 'MessageEntitySpoiler':
                // No spoiler in WhatsApp, send as is
                break;
        }
    }
    
    // Apply adjustments from end to start
    for (const adj of adjustments.sort((a, b) => b.start - a.start)) {
        formatted = formatted.substring(0, adj.start) + 
                   adj.replacement + 
                   formatted.substring(adj.end);
    }
    
    // Clean up any double formatting
    formatted = formatted.replace(/\*\*(.*?)\*\*/g, '*$1*'); // bold
    formatted = formatted.replace(/__(.*?)__/g, '_$1_');     // italic
    formatted = formatted.replace(/~~(.*?)~~/g, '~$1~');     // strikethrough
    
    return formatted;
}

// Extract entities from message
function getEntities(msg) {
    const entities = [];
    
    if (msg.entities) {
        entities.push(...msg.entities);
    }
    if (msg.captionEntities) {
        entities.push(...msg.captionEntities);
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
                    const formatted = formatForWhatsApp(msg.text, entities);
                    await sock.sendMessage(whatsappJid, { text: formatted });
                    return;
                }
                
                // MEDIA
                const buffer = await downloadMedia(telegramClient, msg);
                if (!buffer) return;
                
                const formattedCaption = formatForWhatsApp(caption, entities);
                
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
