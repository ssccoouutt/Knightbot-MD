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

function clean_whatsapp_text(text, entities) {
    if (!text) return text;
    
    // If no entities, return as is
    if (!entities || entities.length === 0) return text;
    
    let result = [];
    let lastPos = 0;
    
    const sorted = [...entities].sort((a, b) => a.offset - b.offset);
    
    for (const entity of sorted) {
        // Add text before entity
        if (entity.offset > lastPos) {
            result.push(text.substring(lastPos, entity.offset));
        }
        
        // For bold entity, find the actual text between markers
        if (entity.className === 'MessageEntityBold') {
            // Look for the text between ** and **
            const boldStart = entity.offset;
            const boldEnd = text.indexOf('**', boldStart + 2);
            
            if (boldEnd !== -1) {
                const boldText = text.substring(boldStart + 2, boldEnd);
                result.push(`*${boldText}*`);
                lastPos = boldEnd + 2;
                continue;
            }
        }
        
        // For other entity types (add more as needed)
        // Default: skip entity and continue
        lastPos = entity.offset + entity.length;
    }
    
    // Add remaining text
    if (lastPos < text.length) {
        result.push(text.substring(lastPos));
    }
    
    return result.join('');
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
                const entities = msg.entities || [];
                
                console.log(`📨 Raw: ${text}`);
                console.log(`📋 Entities: ${entities.map(e => `${e.className}(${e.offset},${e.length})`).join(', ')}`);
                
                const formatted = clean_whatsapp_text(text, entities);
                console.log(`✨ Formatted: ${formatted}`);
                
                if (text && !msg.media) {
                    await sock.sendMessage(whatsappJid, { text: formatted });
                }
                
                // Media handling (same as before)
                if (msg.media) {
                    const buffer = await downloadMedia(telegramClient, msg);
                    if (!buffer) return;
                    
                    if (msg.photo) {
                        await sock.sendMessage(whatsappJid, {
                            image: buffer,
                            caption: formatted
                        });
                    }
                    else if (msg.video) {
                        await sock.sendMessage(whatsappJid, {
                            video: buffer,
                            caption: formatted
                        });
                    }
                    else if (msg.document) {
                        const fileName = msg.document.attributes
                            .find(a => a.className === 'DocumentAttributeFilename')?.fileName || 'file';
                        
                        await sock.sendMessage(whatsappJid, {
                            document: buffer,
                            fileName: fileName,
                            caption: formatted
                        });
                    }
                    else if (msg.audio) {
                        await sock.sendMessage(whatsappJid, {
                            audio: buffer,
                            caption: formatted
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
                
            } catch (err) {
                console.error('Error:', err.message);
            }
        }
        
        telegramClient.addEventHandler(messageHandler, new NewMessage({}));
        
        isActive = true;
        config.active = true;
        saveConfig(config);
        
        await sock.sendMessage(chatId, { text: '✅ Bridge active' });
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
