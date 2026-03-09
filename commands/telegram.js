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
    
    if (!config.sessionString) {
        await sock.sendMessage(chatId, { 
            text: '❌ Set session string first: `.setsession YOUR_SESSION_STRING`' 
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
        
        // Initialize Telegram client
        telegramClient = await initTelegramClient(config.sessionString);
        
        // Set up message handler - FIXED VERSION
        async function messageHandler(event) {
            try {
                const message = event.message;
                
                // Skip if no message
                if (!message) return;
                
                // Get message text
                const text = message.text || message.message || '';
                
                // Skip commands and empty messages
                if (text.startsWith('/') || !text.trim()) return;
                
                console.log(`📨 Received Telegram message: ${text.substring(0, 50)}...`);
                
                const whatsappJid = config.whatsappNumber.includes('@s.whatsapp.net') ?
                    config.whatsappNumber :
                    `${config.whatsappNumber}@s.whatsapp.net`;
                
                // Send to WhatsApp
                await sock.sendMessage(whatsappJid, { 
                    text: text,
                    contextInfo: {
                        forwardingScore: 1,
                        isForwarded: true,
                        forwardedNewsletterMessageInfo: {
                            newsletterJid: '120363161513685998@newsletter',
                            newsletterName: 'Telegram Bridge',
                            serverMessageId: -1
                        }
                    }
                });
                
                console.log(`✅ Forwarded to WhatsApp: ${text.substring(0, 30)}...`);
                
            } catch (err) {
                console.error('Error in message handler:', err);
            }
        }
        
        // Add event handler - CORRECT SYNTAX
        telegramClient.addEventHandler(messageHandler, new NewMessage({}));
        
        console.log('✅ Event handler registered - waiting for messages...');
        
        isActive = true;
        config.active = true;
        saveConfig(config);
        
        await sock.sendMessage(chatId, { 
            text: `✅ *Telegram Bridge Active*\n📱 Forwarding to: ${config.whatsappNumber}\n💬 Now listening for messages...` 
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

// Command handlers
async function telegramCommand(sock, chatId, message, args) {
    const subCommand = args[0]?.toLowerCase();
    
    if (!subCommand) {
        const config = loadConfig();
        let status = `📊 *Telegram Bridge*\n\n`;
        status += `Active: ${isActive ? '✅' : '❌'}\n`;
        status += `Session: ${config.sessionString ? '✅' : '❌'}\n`;
        status += `WhatsApp: ${config.whatsappNumber || 'Not set'}\n\n`;
        status += `Commands:\n`;
        status += `• .telegram on - Start\n`;
        status += `• .telegram off - Stop\n`;
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
    setSessionCommand,
    setWaCommand
};
