const { Telegraf } = require('telegraf');
const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { NewMessage } = require('telegram/events');
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

async function initTelegramClient(sessionString) {
    const stringSession = new StringSession(sessionString);
    const client = new TelegramClient(stringSession, API_ID, API_HASH, {
        connectionRetries: 5,
        baseDc: 2
    });
    
    console.log('🔄 Connecting to Telegram...');
    await client.connect();
    console.log('✅ Telegram client connected!');
    
    return client;
}

async function startTelegramBot(sock, chatId) {
    const config = loadConfig();
    
    if (!config.token && !config.sessionString) {
        await sock.sendMessage(chatId, { 
            text: '❌ Set Telegram bot token or session string first:\n`.settoken TOKEN`\n`.setsession SESSION_STRING`' 
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
        
        // Use BOT TOKEN for receiving messages
        if (config.token) {
            telegramBot = new Telegraf(config.token);
            
            telegramBot.on('message', async (ctx) => {
                try {
                    const message = ctx.message;
                    
                    // Skip commands
                    if (message.text && message.text.startsWith('/')) return;
                    
                    const text = message.text || message.caption || '';
                    if (!text.trim()) return;
                    
                    console.log(`📨 Received from Telegram bot: ${text.substring(0, 50)}...`);
                    
                    const whatsappJid = config.whatsappNumber.includes('@s.whatsapp.net') ?
                        config.whatsappNumber :
                        `${config.whatsappNumber}@s.whatsapp.net`;
                    
                    await sock.sendMessage(whatsappJid, { 
                        text: `📨 *Telegram Bot:*\n\n${text}`
                    });
                    
                    console.log(`✅ Forwarded to WhatsApp`);
                    
                } catch (err) {
                    console.error('Error in bot message handler:', err);
                }
            });
            
            await telegramBot.launch();
            console.log('✅ Telegram bot started');
            
            await sock.sendMessage(chatId, { 
                text: `✅ *Telegram Bot Active*\n🤖 Using bot token\n📱 Forwarding to: ${config.whatsappNumber}` 
            });
        }
        
        // Use SESSION STRING for 2GB file downloads (optional)
        if (config.sessionString) {
            telegramClient = await initTelegramClient(config.sessionString);
            
            async function messageHandler(event) {
                try {
                    const message = event.message;
                    if (!message || !message.text) return;
                    
                    const text = message.text;
                    if (text.startsWith('/') || !text.trim()) return;
                    
                    console.log(`📨 Received from Telegram user: ${text.substring(0, 50)}...`);
                    
                    const whatsappJid = config.whatsappNumber.includes('@s.whatsapp.net') ?
                        config.whatsappNumber :
                        `${config.whatsappNumber}@s.whatsapp.net`;
                    
                    await sock.sendMessage(whatsappJid, { 
                        text: `📨 *Telegram User:*\n\n${text}`
                    });
                    
                    console.log(`✅ Forwarded to WhatsApp`);
                    
                } catch (err) {
                    console.error('Error in user message handler:', err);
                }
            }
            
            telegramClient.addEventHandler(messageHandler, new NewMessage({}));
            console.log('✅ Telegram user client started');
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
        status += `Bot Token: ${config.token ? '✅' : '❌'}\n`;
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
    
    await sock.sendMessage(chatId, { text: '✅ Bot token saved!' });
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
