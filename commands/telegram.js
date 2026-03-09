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

// Download file using client (up to 2GB)
async function downloadMedia(client, message) {
    try {
        const tempFile = path.join(TEMP_DIR, `telegram_${Date.now()}_${message.id}`);
        console.log(`📥 Downloading media...`);
        
        await client.downloadMedia(message, {
            progressCallback: (downloaded, total) => {
                const percent = Math.round((downloaded / total) * 100);
                console.log(`Download: ${percent}%`);
            },
            outputFile: tempFile
        });
        
        const buffer = fs.readFileSync(tempFile);
        fs.unlinkSync(tempFile);
        console.log(`✅ Downloaded: ${(buffer.length/1024/1024).toFixed(2)}MB`);
        return buffer;
    } catch (error) {
        console.error('Download error:', error);
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
        if (telegramClient) await telegramClient.disconnect();
        
        const whatsappJid = config.whatsappNumber.includes('@s.whatsapp.net') ?
            config.whatsappNumber :
            `${config.whatsappNumber}@s.whatsapp.net`;
        
        // Connect using BOT TOKEN with MTProto (like Telethon!)
        console.log('🔄 Connecting to Telegram MTProto with bot token...');
        telegramClient = new TelegramClient(new StringSession(""), API_ID, API_HASH, {
            connectionRetries: 5
        });
        
        await telegramClient.start({
            botAuthToken: config.botToken // This is the key!
        });
        
        console.log('✅ Connected to Telegram MTProto (2GB limit)!');
        
        // Add message handler
        async function messageHandler(event) {
            try {
                const message = event.message;
                if (!message) return;
                
                console.log(`📨 Message received`);
                
                // Handle text
                if (message.text) {
                    await sock.sendMessage(whatsappJid, {
                        text: `${message.text}`
                    });
                }
                
                // Handle media
                if (message.media) {
                    const buffer = await downloadMedia(telegramClient, message);
                    
                    if (buffer) {
                        if (message.photo) {
                            await sock.sendMessage(whatsappJid, {
                                image: buffer,
                                caption: message.text || ''
                            });
                        } else if (message.video) {
                            await sock.sendMessage(whatsappJid, {
                                video: buffer,
                                caption: message.text || ''
                            });
                        } else if (message.document) {
                            const fileName = message.document.attributes
                                .find(a => a.className === 'DocumentAttributeFilename')?.fileName || 'file';
                            
                            await sock.sendMessage(whatsappJid, {
                                document: buffer,
                                fileName: fileName,
                                caption: message.text || ''
                            });
                        } else if (message.audio) {
                            await sock.sendMessage(whatsappJid, {
                                audio: buffer,
                                caption: message.text || ''
                            });
                        } else if (message.voice) {
                            await sock.sendMessage(whatsappJid, {
                                audio: buffer,
                                ptt: true
                            });
                        } else if (message.sticker) {
                            await sock.sendMessage(whatsappJid, {
                                sticker: buffer
                            });
                        }
                        console.log(`✅ Media forwarded`);
                    }
                }
            } catch (err) {
                console.error('Message handler error:', err);
            }
        }
        
        telegramClient.addEventHandler(messageHandler, new NewMessage({}));
        
        isActive = true;
        config.active = true;
        saveConfig(config);
        
        await sock.sendMessage(chatId, { 
            text: `✅ *MTProto Bridge Active*\n📱 To: ${config.whatsappNumber}\n📥 2GB file support enabled!` 
        });
        
        return true;
        
    } catch (error) {
        console.error('Start error:', error);
        await sock.sendMessage(chatId, { text: `❌ Failed: ${error.message}` });
        return false;
    }
}

async function telegramCommand(sock, chatId, message, args) {
    const subCommand = args[0]?.toLowerCase();
    
    if (!subCommand) {
        const config = loadConfig();
        let status = `📊 *Telegram Bridge*\n\n`;
        status += `Active: ${isActive ? '✅' : '❌'}\n`;
        status += `Bot Token: ${config.botToken ? '✅' : '❌'}\n`;
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
            await startTelegramBot(sock, chatId);
            break;
            
        case 'off':
        case 'stop':
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
    await sock.sendMessage(chatId, { text: '✅ Bot token saved! (2GB support)' });
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
