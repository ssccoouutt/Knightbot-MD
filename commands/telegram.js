const { Telegraf } = require('telegraf');
const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { NewMessage } = require('telegram/events');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const input = require('input');

const CONFIG_FILE = path.join(process.cwd(), 'data', 'telegram_bridge.json');
const TEMP_DIR = path.join(process.cwd(), 'temp');
let telegramBot = null;
let telegramClient = null;
let isActive = false;
let botInstance = null;

if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

// You need to get these from my.telegram.org
const API_ID = 123456; // REPLACE WITH YOUR API ID
const API_HASH = 'your_api_hash_here'; // REPLACE WITH YOUR API HASH

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

// Initialize Telegram client with session string
async function initTelegramClient(sessionString) {
    const stringSession = new StringSession(sessionString);
    const client = new TelegramClient(stringSession, API_ID, API_HASH, {
        connectionRetries: 5,
        baseDc: 2
    });
    
    await client.start({
        phoneNumber: async () => await input.text('Please enter your number: '),
        password: async () => await input.text('Please enter your password: '),
        phoneCode: async () => await input.text('Please enter the code you received: '),
        onError: (err) => console.log(err)
    });
    
    console.log('✅ Telegram client connected!');
    return client;
}

// Download file using Telethon client (supports up to 2GB)
async function downloadTelegramFileWithClient(client, message) {
    try {
        const tempFile = path.join(TEMP_DIR, `telegram_${Date.now()}_${message.id}`);
        
        // Download using the client
        await client.downloadMedia(message, {
            progressCallback: (downloaded, total) => {
                const percent = Math.round((downloaded / total) * 100);
                console.log(`Download progress: ${percent}%`);
            },
            outputFile: tempFile
        });
        
        // Read the downloaded file
        const buffer = fs.readFileSync(tempFile);
        fs.unlinkSync(tempFile); // Clean up
        return buffer;
    } catch (error) {
        console.error('Download error with client:', error);
        return null;
    }
}

async function startTelegramBot(sock, chatId) {
    const config = loadConfig();
    
    if (!config.token && !config.sessionString) {
        await sock.sendMessage(chatId, { 
            text: '❌ Set Telegram token or session string first:\n`.settoken TOKEN`\n`.setsession SESSION_STRING`' 
        });
        return false;
    }
    
    if (!config.whatsappNumber) {
        await sock.sendMessage(chatId, { text: '❌ Set WhatsApp number first: `.setwa YOUR_NUMBER`' });
        return false;
    }

    try {
        // Stop any existing instances
        if (telegramBot) {
            await telegramBot.stop();
            telegramBot = null;
        }
        if (telegramClient) {
            await telegramClient.disconnect();
            telegramClient = null;
        }
        
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Initialize based on available credentials
        if (config.sessionString) {
            // Use Telethon client for 2GB downloads
            telegramClient = await initTelegramClient(config.sessionString);
            
            // Set up message handler for the client - CORRECT SYNTAX
            telegramClient.addEventHandler(async (event) => {
                const message = event.message;
                if (!message || !message.text) return;
                
                // Skip commands
                if (message.text.startsWith('/')) return;
                
                const whatsappJid = config.whatsappNumber.includes('@s.whatsapp.net') ?
                    config.whatsappNumber :
                    `${config.whatsappNumber}@s.whatsapp.net`;
                
                try {
                    // Handle text
                    if (message.text) {
                        await sock.sendMessage(whatsappJid, { text: message.text });
                        console.log(`✅ Text forwarded: ${message.text.substring(0, 30)}...`);
                    }
                    
                    // Handle media
                    if (message.media) {
                        const buffer = await downloadTelegramFileWithClient(telegramClient, message);
                        
                        if (buffer) {
                            if (message.photo) {
                                await sock.sendMessage(whatsappJid, {
                                    image: buffer,
                                    caption: message.text || ''
                                });
                            } else if (message.document) {
                                await sock.sendMessage(whatsappJid, {
                                    document: buffer,
                                    fileName: message.file.name || `file_${Date.now()}`,
                                    mimetype: message.file.mimeType || 'application/octet-stream',
                                    caption: message.text || ''
                                });
                            } else if (message.video) {
                                await sock.sendMessage(whatsappJid, {
                                    video: buffer,
                                    caption: message.text || ''
                                });
                            } else if (message.audio) {
                                await sock.sendMessage(whatsappJid, {
                                    audio: buffer,
                                    caption: message.text || ''
                                });
                            }
                            console.log(`✅ Media forwarded`);
                        }
                    }
                } catch (err) {
                    console.error('Forward error:', err);
                }
            }, new NewMessage({}));
            
            await sock.sendMessage(chatId, { 
                text: `✅ *Telegram Client Active*\n📱 Using session string (2GB file support)` 
            });
            
        } else if (config.token) {
            // Use Telegraf bot (20MB limit)
            telegramBot = new Telegraf(config.token);
            botInstance = Date.now();
            
            telegramBot.on('message', async (ctx) => {
                // Skip commands
                if (ctx.message.text && ctx.message.text.startsWith('/')) return;
                
                const whatsappJid = config.whatsappNumber.includes('@s.whatsapp.net') ?
                    config.whatsappNumber :
                    `${config.whatsappNumber}@s.whatsapp.net`;
                
                try {
                    // Handle text
                    if (ctx.message.text) {
                        await sock.sendMessage(whatsappJid, { text: ctx.message.text });
                    }
                    
                    // Media handling for bot token would go here
                    // (similar to before but with 20MB limit)
                    
                } catch (err) {
                    console.error('Forward error:', err);
                }
            });
            
            await telegramBot.launch();
            await sock.sendMessage(chatId, { 
                text: `✅ *Telegram Bot Active*\n📱 Using bot token (20MB file limit)` 
            });
        }
        
        isActive = true;
        config.active = true;
        saveConfig(config);
        
        return true;
        
    } catch (error) {
        console.error('Telegram bot error:', error);
        await sock.sendMessage(chatId, { 
            text: `❌ Failed: ${error.message}` 
        });
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
        status += `Session: ${config.sessionString ? '✅ (2GB support)' : '❌'}\n`;
        status += `WhatsApp: ${config.whatsappNumber || 'Not set'}\n\n`;
        status += `Commands:\n`;
        status += `• .telegram on - Start\n`;
        status += `• .telegram off - Stop\n`;
        status += `• .settoken TOKEN\n`;
        status += `• .setsession SESSION_STRING\n`;
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
            if (telegramBot) await telegramBot.stop();
            if (telegramClient) await telegramClient.disconnect();
            isActive = false;
            const config = loadConfig();
            config.active = false;
            saveConfig(config);
            await sock.sendMessage(chatId, { text: '🔴 *Telegram Bridge Stopped*' });
            break;
            
        default:
            await sock.sendMessage(chatId, { 
                text: 'Use: .telegram on / off' 
            });
    }
}

async function setTokenCommand(sock, chatId, message, token) {
    if (!token) {
        await sock.sendMessage(chatId, { text: '❌ Provide token: `.settoken 123456:ABCdef`' });
        return;
    }
    
    const config = loadConfig();
    config.token = token;
    saveConfig(config);
    
    await sock.sendMessage(chatId, { text: '✅ Token saved!' });
}

async function setSessionCommand(sock, chatId, message, sessionString) {
    if (!sessionString) {
        await sock.sendMessage(chatId, { text: '❌ Provide session string: `.setsession YOUR_SESSION_STRING`' });
        return;
    }
    
    const config = loadConfig();
    config.sessionString = sessionString;
    saveConfig(config);
    
    await sock.sendMessage(chatId, { text: '✅ Session string saved! (2GB file support enabled)' });
}

async function setWaCommand(sock, chatId, message, number) {
    if (!number) {
        await sock.sendMessage(chatId, { text: '❌ Provide number: `.setwa 923247220362`' });
        return;
    }
    
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
