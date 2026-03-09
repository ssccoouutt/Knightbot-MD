const { Telegraf } = require('telegraf');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { downloadContentFromMessage } = require('@whiskeysockets/baileys');

const CONFIG_FILE = path.join(process.cwd(), 'data', 'telegram_bridge.json');
const TEMP_DIR = path.join(process.cwd(), 'temp');
let telegramBot = null;
let isActive = false;

if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

// Load or create config
function loadConfig() {
    try {
        if (fs.existsSync(CONFIG_FILE)) {
            return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
        }
    } catch (e) {}
    return {
        token: null,
        whatsappNumber: null,
        active: false
    };
}

function saveConfig(config) {
    fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

// Download file from Telegram
async function downloadTelegramFile(fileId, botToken) {
    try {
        const fileUrl = `https://api.telegram.org/bot${botToken}/getFile?file_id=${fileId}`;
        const response = await axios.get(fileUrl);
        const filePath = response.data.result.file_path;
        const downloadUrl = `https://api.telegram.org/file/bot${botToken}/${filePath}`;
        
        const fileResponse = await axios({
            method: 'GET',
            url: downloadUrl,
            responseType: 'arraybuffer'
        });
        
        return Buffer.from(fileResponse.data);
    } catch (error) {
        console.error('Download error:', error);
        return null;
    }
}

// Start Telegram bot
async function startTelegramBot(sock, chatId) {
    const config = loadConfig();
    
    if (!config.token) {
        await sock.sendMessage(chatId, { 
            text: '❌ Set token first: `.settoken YOUR_TOKEN`' 
        });
        return false;
    }
    
    if (!config.whatsappNumber) {
        await sock.sendMessage(chatId, { 
            text: '❌ Set WhatsApp number first: `.setwa YOUR_NUMBER`' 
        });
        return false;
    }

    try {
        telegramBot = new Telegraf(config.token);
        
        // Handle ALL messages (including commands)
        telegramBot.on('message', async (ctx) => {
            try {
                // Skip if it's a command and you want to ignore commands
                // if (ctx.message.text && ctx.message.text.startsWith('/')) return;
                
                const message = ctx.message;
                const whatsappJid = config.whatsappNumber.includes('@s.whatsapp.net') ?
                    config.whatsappNumber :
                    `${config.whatsappNumber}@s.whatsapp.net`;
                
                // Handle different message types
                if (message.text) {
                    // Plain text - send exactly as is
                    await sock.sendMessage(whatsappJid, { text: message.text });
                    
                } else if (message.photo) {
                    // Photo with optional caption
                    const photo = message.photo[message.photo.length - 1];
                    const buffer = await downloadTelegramFile(photo.file_id, config.token);
                    if (buffer) {
                        await sock.sendMessage(whatsappJid, {
                            image: buffer,
                            caption: message.caption || ''
                        });
                    }
                    
                } else if (message.video) {
                    // Video with optional caption
                    const buffer = await downloadTelegramFile(message.video.file_id, config.token);
                    if (buffer) {
                        await sock.sendMessage(whatsappJid, {
                            video: buffer,
                            caption: message.caption || ''
                        });
                    }
                    
                } else if (message.document) {
                    // Document with optional caption
                    const buffer = await downloadTelegramFile(message.document.file_id, config.token);
                    if (buffer) {
                        await sock.sendMessage(whatsappJid, {
                            document: buffer,
                            fileName: message.document.file_name || 'file',
                            mimetype: message.document.mime_type || 'application/octet-stream',
                            caption: message.caption || ''
                        });
                    }
                    
                } else if (message.audio) {
                    // Audio file
                    const buffer = await downloadTelegramFile(message.audio.file_id, config.token);
                    if (buffer) {
                        await sock.sendMessage(whatsappJid, {
                            audio: buffer,
                            mimetype: message.audio.mime_type || 'audio/mpeg',
                            caption: message.caption || ''
                        });
                    }
                    
                } else if (message.voice) {
                    // Voice message
                    const buffer = await downloadTelegramFile(message.voice.file_id, config.token);
                    if (buffer) {
                        await sock.sendMessage(whatsappJid, {
                            audio: buffer,
                            mimetype: 'audio/ogg',
                            ptt: true // Send as voice note
                        });
                    }
                    
                } else if (message.sticker) {
                    // Sticker
                    const buffer = await downloadTelegramFile(message.sticker.file_id, config.token);
                    if (buffer) {
                        await sock.sendMessage(whatsappJid, {
                            sticker: buffer
                        });
                    }
                    
                } else if (message.location) {
                    // Location
                    const { latitude, longitude } = message.location;
                    await sock.sendMessage(whatsappJid, {
                        text: `📍 Location: ${latitude}, ${longitude}\nhttps://maps.google.com/?q=${latitude},${longitude}`
                    });
                    
                } else if (message.contact) {
                    // Contact
                    const contact = message.contact;
                    await sock.sendMessage(whatsappJid, {
                        text: `👤 Contact: ${contact.first_name} ${contact.last_name || ''}\n📱 Phone: ${contact.phone_number}`
                    });
                    
                } else {
                    // Unknown type - send raw info
                    await sock.sendMessage(whatsappJid, {
                        text: `[Unsupported message type: ${Object.keys(message)[0]}]`
                    });
                }
                
                console.log(`✅ Forwarded from Telegram: ${ctx.from.id}`);
                
            } catch (err) {
                console.error('Forward error:', err);
                // Optionally notify about error
                // await sock.sendMessage(whatsappJid, { text: '❌ Failed to forward message' });
            }
        });

        // Start bot
        await telegramBot.launch();
        isActive = true;
        config.active = true;
        saveConfig(config);
        
        await sock.sendMessage(chatId, { 
            text: `✅ *Telegram Bridge Active*\n📱 To: ${config.whatsappNumber}` 
        });
        
        return true;
        
    } catch (error) {
        console.error('Telegram bot error:', error);
        await sock.sendMessage(chatId, { 
            text: `❌ Failed: ${error.message}` 
        });
        return false;
    }
}

// Stop Telegram bot
async function stopTelegramBot(sock, chatId) {
    if (telegramBot) {
        await telegramBot.stop();
        telegramBot = null;
    }
    isActive = false;
    
    const config = loadConfig();
    config.active = false;
    saveConfig(config);
    
    await sock.sendMessage(chatId, { 
        text: '🔴 *Telegram Bridge Stopped*' 
    });
}

// Main command handler
async function telegramCommand(sock, chatId, message, args) {
    const subCommand = args[0]?.toLowerCase();
    
    if (!subCommand) {
        const config = loadConfig();
        let status = `📊 *Telegram Bridge*\n\n`;
        status += `Active: ${isActive ? '✅' : '❌'}\n`;
        status += `Token: ${config.token ? '✅' : '❌'}\n`;
        status += `WhatsApp: ${config.whatsappNumber || 'Not set'}\n\n`;
        status += `Commands:\n`;
        status += `• .telegram on - Start\n`;
        status += `• .telegram off - Stop\n`;
        status += `• .settoken TOKEN\n`;
        status += `• .setwa NUMBER`;
        
        await sock.sendMessage(chatId, { text: status });
        return;
    }
    
    switch (subCommand) {
        case 'on':
        case 'start':
        case 'activate':
            await startTelegramBot(sock, chatId);
            break;
            
        case 'off':
        case 'stop':
        case 'deactivate':
            await stopTelegramBot(sock, chatId);
            break;
            
        default:
            await sock.sendMessage(chatId, { 
                text: 'Use: .telegram on / off' 
            });
    }
}

// Set token command
async function setTokenCommand(sock, chatId, message, token) {
    if (!token) {
        await sock.sendMessage(chatId, { 
            text: '❌ Provide token: `.settoken 123456:ABCdef`' 
        });
        return;
    }
    
    const config = loadConfig();
    config.token = token;
    saveConfig(config);
    
    await sock.sendMessage(chatId, { 
        text: '✅ Token saved!' 
    });
}

// Set WhatsApp number command
async function setWaCommand(sock, chatId, message, number) {
    if (!number) {
        await sock.sendMessage(chatId, { 
            text: '❌ Provide number: `.setwa 923247220362`' 
        });
        return;
    }
    
    const cleanNumber = number.replace(/[^0-9]/g, '');
    
    const config = loadConfig();
    config.whatsappNumber = cleanNumber;
    saveConfig(config);
    
    await sock.sendMessage(chatId, { 
        text: `✅ WhatsApp set: ${cleanNumber}` 
    });
}

module.exports = {
    telegramCommand,
    setTokenCommand,
    setWaCommand
};
