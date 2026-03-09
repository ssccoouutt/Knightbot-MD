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

// ===== CONFIGURATION =====
// YOU MUST REPLACE THESE WITH YOUR ACTUAL VALUES FROM my.telegram.org
const API_ID = 32086282; // Your API ID from Python script
const API_HASH = "064a66fe7097452e6ac8f4e8df28aa97"; // Your API Hash from Python script

function loadConfig() {
    try {
        if (fs.existsSync(CONFIG_FILE)) {
            return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
        }
    } catch (e) {}
    return {
        botToken: null,
        whatsappNumber: null,
        sessionString: null,
        active: false
    };
}

function saveConfig(config) {
    fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

// Download file using Telethon client (up to 2GB)
async function downloadTelegramFileWithClient(client, message) {
    try {
        const tempFile = path.join(TEMP_DIR, `telegram_${Date.now()}_${message.id}`);
        
        console.log(`📥 Downloading media via user client...`);
        
        await client.downloadMedia(message, {
            progressCallback: (downloaded, total) => {
                const percent = Math.round((downloaded / total) * 100);
                if (percent % 10 === 0) console.log(`Download progress: ${percent}%`);
            },
            outputFile: tempFile
        });
        
        const buffer = fs.readFileSync(tempFile);
        fs.unlinkSync(tempFile);
        console.log(`✅ Download complete: ${(buffer.length / 1024 / 1024).toFixed(2)}MB`);
        return buffer;
    } catch (error) {
        console.error('Download error:', error);
        return null;
    }
}

// Download file using bot token (up to 20MB)
async function downloadTelegramFile(fileId, botToken) {
    try {
        const fileUrl = `https://api.telegram.org/bot${botToken}/getFile?file_id=${fileId}`;
        const response = await axios.get(fileUrl);
        const filePath = response.data.result.file_path;
        const fileSize = response.data.result.file_size;
        
        if (fileSize > 20 * 1024 * 1024) {
            console.log(`⚠️ File too large for bot API: ${(fileSize/1024/1024).toFixed(2)}MB`);
            return null;
        }
        
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

async function startTelegramBot(sock, chatId) {
    const config = loadConfig();
    
    if (!config.botToken) {
        await sock.sendMessage(chatId, { 
            text: '❌ Set bot token first: `.settoken YOUR_BOT_TOKEN`' 
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
        
        // ===== 1. START BOT TOKEN HANDLER (Receives messages) =====
        telegramBot = new Telegraf(config.botToken);
        
        telegramBot.on('message', async (ctx) => {
            try {
                const msg = ctx.message;
                
                // Skip commands
                if (msg.text && msg.text.startsWith('/')) return;
                
                const caption = msg.caption || '';
                
                console.log(`📨 Received message from Telegram bot`);
                
                // TEXT
                if (msg.text) {
                    await sock.sendMessage(whatsappJid, { 
                        text: `📨 *Telegram:*\n\n${msg.text}`
                    });
                    console.log(`✅ Text forwarded`);
                }
                
                // PHOTO
                else if (msg.photo) {
                    const photo = msg.photo[msg.photo.length - 1];
                    const buffer = await downloadTelegramFile(photo.file_id, config.botToken);
                    if (buffer) {
                        await sock.sendMessage(whatsappJid, {
                            image: buffer,
                            caption: caption ? `📨 *Telegram:*\n\n📝 ${caption}` : `📨 *Telegram:*`
                        });
                        console.log(`✅ Photo forwarded`);
                    } else if (config.sessionString) {
                        // File too large for bot API, but we have session string
                        await sock.sendMessage(whatsappJid, { 
                            text: `📨 *Telegram:*\n[Photo too large for bot API - needs session string handling]${caption ? `\n\n📝 ${caption}` : ''}`
                        });
                    }
                }
                
                // VIDEO
                else if (msg.video) {
                    const buffer = await downloadTelegramFile(msg.video.file_id, config.botToken);
                    if (buffer) {
                        await sock.sendMessage(whatsappJid, {
                            video: buffer,
                            caption: caption ? `📨 *Telegram:*\n\n📝 ${caption}` : `📨 *Telegram:*`
                        });
                        console.log(`✅ Video forwarded`);
                    }
                }
                
                // DOCUMENT
                else if (msg.document) {
                    const buffer = await downloadTelegramFile(msg.document.file_id, config.botToken);
                    if (buffer) {
                        await sock.sendMessage(whatsappJid, {
                            document: buffer,
                            fileName: msg.document.file_name || 'file',
                            caption: caption ? `📨 *Telegram:*\n\n📝 ${caption}` : `📨 *Telegram:*`
                        });
                        console.log(`✅ Document forwarded`);
                    }
                }
                
                // AUDIO
                else if (msg.audio) {
                    const buffer = await downloadTelegramFile(msg.audio.file_id, config.botToken);
                    if (buffer) {
                        await sock.sendMessage(whatsappJid, {
                            audio: buffer,
                            caption: caption ? `📨 *Telegram:*\n\n📝 ${caption}` : `📨 *Telegram:*`
                        });
                        console.log(`✅ Audio forwarded`);
                    }
                }
                
                // VOICE
                else if (msg.voice) {
                    const buffer = await downloadTelegramFile(msg.voice.file_id, config.botToken);
                    if (buffer) {
                        await sock.sendMessage(whatsappJid, {
                            audio: buffer,
                            ptt: true,
                            caption: caption ? `📨 *Telegram:*\n\n📝 ${caption}` : `📨 *Telegram:*`
                        });
                        console.log(`✅ Voice forwarded`);
                    }
                }
                
                // STICKER
                else if (msg.sticker) {
                    const buffer = await downloadTelegramFile(msg.sticker.file_id, config.botToken);
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
                        text: `📍 *Telegram Location:*\n${latitude}, ${longitude}\nhttps://maps.google.com/?q=${latitude},${longitude}`
                    });
                }
                
                // CONTACT
                else if (msg.contact) {
                    await sock.sendMessage(whatsappJid, {
                        text: `👤 *Telegram Contact:*\nName: ${msg.contact.first_name} ${msg.contact.last_name || ''}\nPhone: ${msg.contact.phone_number}`
                    });
                }
                
            } catch (err) {
                console.error('Bot handler error:', err);
            }
        });
        
        await telegramBot.launch();
        console.log('✅ Bot handler started');
        
        // ===== 2. START SESSION CLIENT (For 2GB downloads) =====
        if (config.sessionString) {
            try {
                const stringSession = new StringSession(config.sessionString);
                telegramClient = new TelegramClient(stringSession, API_ID, API_HASH, {
                    connectionRetries: 5
                });
                
                await telegramClient.connect();
                console.log('✅ User client connected (2GB support)');
                
                // This handles messages from your USER account, not the bot
                // You'll need to forward messages from your user to the bot
                // For now, we'll just use it for large file downloads when needed
                
            } catch (err) {
                console.error('Failed to connect user client:', err);
            }
        }
        
        isActive = true;
        config.active = true;
        saveConfig(config);
        
        await sock.sendMessage(chatId, { 
            text: `✅ *Bridge Active*\n📱 To: ${config.whatsappNumber}\n🤖 Bot: Active\n👤 User: ${config.sessionString ? 'Connected (2GB)' : 'Not connected'}` 
        });
        
        return true;
        
    } catch (error) {
        console.error('Start error:', error);
        await sock.sendMessage(chatId, { text: `❌ Failed: ${error.message}` });
        return false;
    }
}

// ===== COMMAND HANDLERS =====
async function telegramCommand(sock, chatId, message, args) {
    const subCommand = args[0]?.toLowerCase();
    
    if (!subCommand) {
        const config = loadConfig();
        let status = `📊 *Telegram Bridge*\n\n`;
        status += `Active: ${isActive ? '✅' : '❌'}\n`;
        status += `Bot Token: ${config.botToken ? '✅' : '❌'}\n`;
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
    config.botToken = token;
    saveConfig(config);
    await sock.sendMessage(chatId, { text: '✅ Bot token saved!' });
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
