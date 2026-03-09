const { Telegraf } = require('telegraf');
const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { NewMessage } = require('telegram/events');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const CONFIG_FILE = path.join(process.cwd(), 'data', 'telegram_bridge.json');
const TEMP_DIR = path.join(process.cwd(), 'temp');
let telegramBot = null;
let telegramClient = null;
let isActive = false;

if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

// YOU MUST REPLACE THESE WITH YOUR ACTUAL VALUES FROM my.telegram.org
const API_ID = 123456; // CHANGE THIS
const API_HASH = 'your_api_hash_here'; // CHANGE THIS

function loadConfig() {
    try {
        if (fs.existsSync(CONFIG_FILE)) {
            return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
        }
    } catch (e) {}
    return {
        token: null,
        whatsappNumber: null,
        sessionString: null,
        active: false
    };
}

function saveConfig(config) {
    fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

// Download file from Telegram using bot token (up to 20MB)
async function downloadTelegramFile(fileId, botToken) {
    try {
        const fileUrl = `https://api.telegram.org/bot${botToken}/getFile?file_id=${fileId}`;
        const response = await axios.get(fileUrl);
        const filePath = response.data.result.file_path;
        
        const downloadUrl = `https://api.telegram.org/file/bot${botToken}/${filePath}`;
        const fileResponse = await axios({
            method: 'GET',
            url: downloadUrl,
            responseType: 'arraybuffer',
            timeout: 60000
        });
        
        return Buffer.from(fileResponse.data);
    } catch (error) {
        console.error('Download error:', error.message);
        return null;
    }
}

// Download file using Telethon client (up to 2GB)
async function downloadTelegramFileWithClient(client, message) {
    try {
        const tempFile = path.join(TEMP_DIR, `telegram_${Date.now()}_${message.id}`);
        
        await client.downloadMedia(message, {
            progressCallback: (downloaded, total) => {
                const percent = Math.round((downloaded / total) * 100);
                if (percent % 10 === 0) console.log(`Download progress: ${percent}%`);
            },
            outputFile: tempFile
        });
        
        const buffer = fs.readFileSync(tempFile);
        fs.unlinkSync(tempFile);
        return buffer;
    } catch (error) {
        console.error('Download error:', error);
        return null;
    }
}

// Get file extension from mime type
function getExtension(mimeType) {
    const map = {
        'image/jpeg': '.jpg',
        'image/png': '.png',
        'image/gif': '.gif',
        'image/webp': '.webp',
        'video/mp4': '.mp4',
        'video/quicktime': '.mov',
        'audio/mpeg': '.mp3',
        'audio/ogg': '.ogg',
        'application/pdf': '.pdf',
        'application/zip': '.zip',
        'text/plain': '.txt'
    };
    return map[mimeType] || '.bin';
}

async function startTelegramBot(sock, chatId) {
    const config = loadConfig();
    
    if (!config.token && !config.sessionString) {
        await sock.sendMessage(chatId, { 
            text: '❌ Set Telegram token or session first:\n`.settoken TOKEN`\n`.setsession SESSION`' 
        });
        return false;
    }
    
    if (!config.whatsappNumber) {
        await sock.sendMessage(chatId, { text: '❌ Set WhatsApp number first: `.setwa NUMBER`' });
        return false;
    }

    try {
        if (telegramBot) await telegramBot.stop();
        if (telegramClient) await telegramClient.disconnect();
        
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        const whatsappJid = config.whatsappNumber.includes('@s.whatsapp.net') ?
            config.whatsappNumber :
            `${config.whatsappNumber}@s.whatsapp.net`;
        
        // BOT TOKEN HANDLER (20MB limit)
        if (config.token) {
            telegramBot = new Telegraf(config.token);
            
            telegramBot.on('message', async (ctx) => {
                try {
                    const msg = ctx.message;
                    if (msg.text && msg.text.startsWith('/')) return;
                    
                    const caption = msg.caption || '';
                    
                    // TEXT
                    if (msg.text) {
                        await sock.sendMessage(whatsappJid, { 
                            text: `📨 *Bot:*\n\n${msg.text}`
                        });
                        console.log(`✅ Text forwarded`);
                    }
                    
                    // PHOTO
                    else if (msg.photo) {
                        const photo = msg.photo[msg.photo.length - 1];
                        const buffer = await downloadTelegramFile(photo.file_id, config.token);
                        if (buffer) {
                            await sock.sendMessage(whatsappJid, {
                                image: buffer,
                                caption: caption ? `📨 *Bot:*\n\n📝 ${caption}` : `📨 *Bot:*`
                            });
                            console.log(`✅ Photo forwarded`);
                        }
                    }
                    
                    // VIDEO
                    else if (msg.video) {
                        const buffer = await downloadTelegramFile(msg.video.file_id, config.token);
                        if (buffer) {
                            await sock.sendMessage(whatsappJid, {
                                video: buffer,
                                caption: caption ? `📨 *Bot:*\n\n📝 ${caption}` : `📨 *Bot:*`
                            });
                            console.log(`✅ Video forwarded`);
                        }
                    }
                    
                    // DOCUMENT
                    else if (msg.document) {
                        const buffer = await downloadTelegramFile(msg.document.file_id, config.token);
                        if (buffer) {
                            await sock.sendMessage(whatsappJid, {
                                document: buffer,
                                fileName: msg.document.file_name || 'file',
                                caption: caption ? `📨 *Bot:*\n\n📝 ${caption}` : `📨 *Bot:*`
                            });
                            console.log(`✅ Document forwarded`);
                        }
                    }
                    
                    // AUDIO
                    else if (msg.audio) {
                        const buffer = await downloadTelegramFile(msg.audio.file_id, config.token);
                        if (buffer) {
                            await sock.sendMessage(whatsappJid, {
                                audio: buffer,
                                caption: caption ? `📨 *Bot:*\n\n📝 ${caption}` : `📨 *Bot:*`
                            });
                            console.log(`✅ Audio forwarded`);
                        }
                    }
                    
                    // VOICE
                    else if (msg.voice) {
                        const buffer = await downloadTelegramFile(msg.voice.file_id, config.token);
                        if (buffer) {
                            await sock.sendMessage(whatsappJid, {
                                audio: buffer,
                                ptt: true,
                                caption: caption ? `📨 *Bot:*\n\n📝 ${caption}` : `📨 *Bot:*`
                            });
                            console.log(`✅ Voice forwarded`);
                        }
                    }
                    
                    // STICKER
                    else if (msg.sticker) {
                        const buffer = await downloadTelegramFile(msg.sticker.file_id, config.token);
                        if (buffer) {
                            await sock.sendMessage(whatsappJid, {
                                sticker: buffer
                            });
                            console.log(`✅ Sticker forwarded`);
                        }
                    }
                    
                    // LOCATION
                    else if (msg.location) {
                        const { latitude, longitude } = msg.location;
                        await sock.sendMessage(whatsappJid, {
                            text: `📍 *Bot Location:*\n${latitude}, ${longitude}\nhttps://maps.google.com/?q=${latitude},${longitude}`
                        });
                        console.log(`✅ Location forwarded`);
                    }
                    
                    // CONTACT
                    else if (msg.contact) {
                        await sock.sendMessage(whatsappJid, {
                            text: `👤 *Bot Contact:*\nName: ${msg.contact.first_name} ${msg.contact.last_name || ''}\nPhone: ${msg.contact.phone_number}`
                        });
                        console.log(`✅ Contact forwarded`);
                    }
                    
                } catch (err) {
                    console.error('Bot handler error:', err);
                }
            });
            
            await telegramBot.launch();
            console.log('✅ Bot handler started');
        }
        
        // SESSION STRING HANDLER (2GB limit)
        if (config.sessionString) {
            const stringSession = new StringSession(config.sessionString);
            telegramClient = new TelegramClient(stringSession, API_ID, API_HASH, {
                connectionRetries: 5
            });
            
            await telegramClient.connect();
            console.log('✅ User client connected');
            
            async function userHandler(event) {
                try {
                    const msg = event.message;
                    if (!msg || !msg.text) return;
                    
                    const text = msg.text;
                    if (text.startsWith('/')) return;
                    
                    await sock.sendMessage(whatsappJid, { 
                        text: `📨 *User:*\n\n${text}`
                    });
                    console.log(`✅ User message forwarded`);
                    
                } catch (err) {
                    console.error('User handler error:', err);
                }
            }
            
            telegramClient.addEventHandler(userHandler, new NewMessage({}));
        }
        
        isActive = true;
        config.active = true;
        saveConfig(config);
        
        await sock.sendMessage(chatId, { 
            text: `✅ *Bridge Active*\n📱 To: ${config.whatsappNumber}` 
        });
        
        return true;
        
    } catch (error) {
        console.error('Start error:', error);
        await sock.sendMessage(chatId, { text: `❌ Failed: ${error.message}` });
        return false;
    }
}

// Command handlers
async function telegramCommand(sock, chatId, message, args) {
    const subCommand = args[0]?.toLowerCase();
    
    if (!subCommand) {
        const config = loadConfig();
        let status = `📊 *Telegram Bridge*\n\n`;
        status += `Active: ${isActive ? '✅' : '❌'}\n`;
        status += `Token: ${config.token ? '✅' : '❌'}\n`;
        status += `Session: ${config.sessionString ? '✅ (2GB)' : '❌'}\n`;
        status += `WhatsApp: ${config.whatsappNumber || 'Not set'}\n\n`;
        status += `Commands:\n`;
        status += `• .telegram on - Start\n`;
        status += `• .telegram off - Stop\n`;
        status += `• .settoken TOKEN\n`;
        status += `• .setsession SESSION\n`;
        status += `• .setwa NUMBER`;
        
        await sock.sendMessage(chatId, { text: status });
        return;
    }
    
    switch (subCommand) {
        case 'on':
        case 'start':
            await startTelegramBot(sock, chatId);
            break;
            
        case 'off':
        case 'stop':
            if (telegramBot) await telegramBot.stop();
            if (telegramClient) await telegramClient.disconnect();
            isActive = false;
            const config = loadConfig();
            config.active = false;
            saveConfig(config);
            await sock.sendMessage(chatId, { text: '🔴 *Bridge Stopped*' });
            break;
            
        default:
            await sock.sendMessage(chatId, { text: 'Use: .telegram on / off' });
    }
}

async function setTokenCommand(sock, chatId, message, token) {
    if (!token) return await sock.sendMessage(chatId, { text: '❌ Provide token' });
    
    const config = loadConfig();
    config.token = token;
    saveConfig(config);
    await sock.sendMessage(chatId, { text: '✅ Token saved!' });
}

async function setSessionCommand(sock, chatId, message, sessionString) {
    if (!sessionString) return await sock.sendMessage(chatId, { text: '❌ Provide session' });
    
    const config = loadConfig();
    config.sessionString = sessionString;
    saveConfig(config);
    await sock.sendMessage(chatId, { text: '✅ Session saved! (2GB support)' });
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
    setSessionCommand,
    setWaCommand
};
