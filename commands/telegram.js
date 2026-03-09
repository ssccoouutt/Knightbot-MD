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
const API_ID = 32086282; // Your API ID
const API_HASH = "064a66fe7097452e6ac8f4e8df28aa97"; // Your API Hash

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

// Download file using Telethon client (up to 2GB) - THIS IS THE FIX!
async function downloadTelegramFileWithClient(client, messageId, chatId) {
    try {
        console.log(`📥 Downloading media using user client...`);
        
        // Get the message first
        const messages = await client.getMessages(chatId, { ids: messageId });
        if (!messages || messages.length === 0) {
            console.log('Message not found');
            return null;
        }
        
        const message = messages[0];
        if (!message.media) {
            console.log('No media in message');
            return null;
        }
        
        const tempFile = path.join(TEMP_DIR, `telegram_${Date.now()}_${messageId}`);
        
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
        console.error('Download error with client:', error);
        return null;
    }
}

// Helper to extract chat ID and message ID from context
function extractMessageInfo(ctx) {
    const chatId = ctx.chat.id;
    const messageId = ctx.message.message_id;
    return { chatId, messageId };
}

async function startTelegramBot(sock, chatId) {
    const config = loadConfig();
    
    if (!config.botToken) {
        await sock.sendMessage(chatId, { 
            text: '❌ Set bot token first: `.settoken YOUR_BOT_TOKEN`' 
        });
        return false;
    }
    
    if (!config.sessionString) {
        await sock.sendMessage(chatId, { 
            text: '❌ Session string required for media downloads! Use `.setsession YOUR_SESSION`' 
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
        
        // ===== 1. CONNECT USER CLIENT FIRST (for downloads) =====
        console.log('🔄 Connecting user client...');
        const stringSession = new StringSession(config.sessionString);
        telegramClient = new TelegramClient(stringSession, API_ID, API_HASH, {
            connectionRetries: 5
        });
        
        await telegramClient.connect();
        console.log('✅ User client connected (2GB support)');
        
        // ===== 2. START BOT TOKEN HANDLER (Receives messages) =====
        telegramBot = new Telegraf(config.botToken);
        
        telegramBot.on('message', async (ctx) => {
            try {
                const msg = ctx.message;
                
                // Skip commands
                if (msg.text && msg.text.startsWith('/')) return;
                
                const caption = msg.caption || '';
                const { chatId: telegramChatId, messageId } = extractMessageInfo(ctx);
                
                console.log(`📨 Received message from Telegram (chat: ${telegramChatId}, msg: ${messageId})`);
                
                // TEXT
                if (msg.text) {
                    await sock.sendMessage(whatsappJid, { 
                        text: `${msg.text}`
                    });
                    console.log(`✅ Text forwarded`);
                }
                
                // PHOTO
                else if (msg.photo) {
                    console.log('📸 Downloading photo via user client...');
                    const buffer = await downloadTelegramFileWithClient(telegramClient, messageId, telegramChatId);
                    if (buffer) {
                        await sock.sendMessage(whatsappJid, {
                            image: buffer,
                            caption: caption || ''
                        });
                        console.log(`✅ Photo forwarded`);
                    } else {
                        await sock.sendMessage(whatsappJid, { 
                            text: `[Photo]${caption ? `\n\n${caption}` : ''}`
                        });
                    }
                }
                
                // VIDEO
                else if (msg.video) {
                    console.log('🎥 Downloading video via user client...');
                    const buffer = await downloadTelegramFileWithClient(telegramClient, messageId, telegramChatId);
                    if (buffer) {
                        await sock.sendMessage(whatsappJid, {
                            video: buffer,
                            caption: caption || ''
                        });
                        console.log(`✅ Video forwarded`);
                    } else {
                        await sock.sendMessage(whatsappJid, { 
                            text: `[Video]${caption ? `\n\n${caption}` : ''}`
                        });
                    }
                }
                
                // DOCUMENT
                else if (msg.document) {
                    console.log(`📄 Downloading document via user client: ${msg.document.file_name}`);
                    const buffer = await downloadTelegramFileWithClient(telegramClient, messageId, telegramChatId);
                    if (buffer) {
                        await sock.sendMessage(whatsappJid, {
                            document: buffer,
                            fileName: msg.document.file_name || 'file',
                            caption: caption || ''
                        });
                        console.log(`✅ Document forwarded`);
                    } else {
                        await sock.sendMessage(whatsappJid, { 
                            text: `[Document: ${msg.document.file_name}]${caption ? `\n\n${caption}` : ''}`
                        });
                    }
                }
                
                // AUDIO
                else if (msg.audio) {
                    console.log('🎵 Downloading audio via user client...');
                    const buffer = await downloadTelegramFileWithClient(telegramClient, messageId, telegramChatId);
                    if (buffer) {
                        await sock.sendMessage(whatsappJid, {
                            audio: buffer,
                            caption: caption || ''
                        });
                        console.log(`✅ Audio forwarded`);
                    } else {
                        await sock.sendMessage(whatsappJid, { 
                            text: `[Audio]${caption ? `\n\n${caption}` : ''}`
                        });
                    }
                }
                
                // VOICE
                else if (msg.voice) {
                    console.log('🎤 Downloading voice via user client...');
                    const buffer = await downloadTelegramFileWithClient(telegramClient, messageId, telegramChatId);
                    if (buffer) {
                        await sock.sendMessage(whatsappJid, {
                            audio: buffer,
                            ptt: true
                        });
                        console.log(`✅ Voice forwarded`);
                    } else {
                        await sock.sendMessage(whatsappJid, { 
                            text: '[Voice message]'
                        });
                    }
                }
                
                // STICKER
                else if (msg.sticker) {
                    console.log('😊 Downloading sticker via user client...');
                    const buffer = await downloadTelegramFileWithClient(telegramClient, messageId, telegramChatId);
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
                        text: `📍 ${latitude}, ${longitude}\nhttps://maps.google.com/?q=${latitude},${longitude}`
                    });
                }
                
                // CONTACT
                else if (msg.contact) {
                    await sock.sendMessage(whatsappJid, {
                        text: `👤 ${msg.contact.first_name} ${msg.contact.last_name || ''}\n📱 ${msg.contact.phone_number}`
                    });
                }
                
            } catch (err) {
                console.error('Bot handler error:', err);
            }
        });
        
        await telegramBot.launch();
        console.log('✅ Bot handler started');
        
        isActive = true;
        config.active = true;
        saveConfig(config);
        
        await sock.sendMessage(chatId, { 
            text: `✅ *Bridge Active*\n📱 To: ${config.whatsappNumber}\n📥 2GB media support enabled!` 
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
