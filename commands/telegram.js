const { Telegraf } = require('telegraf');
const fs = require('fs');
const path = require('path');

const CONFIG_FILE = path.join(process.cwd(), 'data', 'telegram_bridge.json');
let telegramBot = null;
let isActive = false;

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

// Format message for WhatsApp
function formatTelegramMessage(ctx) {
    const from = ctx.from;
    const chat = ctx.chat;
    const message = ctx.message;
    
    let formatted = `📨 *Telegram Message*\n\n`;
    formatted += `👤 *From:* ${from.first_name || ''} ${from.last_name || ''}`;
    if (from.username) formatted += ` (@${from.username})`;
    formatted += `\n🆔 *User ID:* \`${from.id}\``;
    
    if (chat.type !== 'private') {
        formatted += `\n💬 *Chat:* ${chat.title || 'Unknown'}`;
    }
    
    formatted += `\n\n📝 *Message:*\n${message.text || '[Non-text message]'}`;
    
    return formatted;
}

// Start Telegram bot
async function startTelegramBot(sock, chatId) {
    const config = loadConfig();
    
    if (!config.token) {
        await sock.sendMessage(chatId, { 
            text: '❌ Please set your Telegram bot token first using:\n`.settoken YOUR_BOT_TOKEN`' 
        });
        return false;
    }
    
    if (!config.whatsappNumber) {
        await sock.sendMessage(chatId, { 
            text: '❌ Please set your WhatsApp number first using:\n`.setwa YOUR_NUMBER`' 
        });
        return false;
    }

    try {
        telegramBot = new Telegraf(config.token);
        
        // Handle all messages
        telegramBot.on('message', async (ctx) => {
            try {
                const formattedMsg = formatTelegramMessage(ctx);
                const whatsappJid = config.whatsappNumber.includes('@s.whatsapp.net') ?
                    config.whatsappNumber :
                    `${config.whatsappNumber}@s.whatsapp.net`;
                
                await sock.sendMessage(whatsappJid, {
                    text: formattedMsg,
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
                
                console.log(`✅ Forwarded message from Telegram user ${ctx.from.id}`);
                
            } catch (err) {
                console.error('Forward error:', err);
            }
        });

        // Start bot
        await telegramBot.launch();
        isActive = true;
        config.active = true;
        saveConfig(config);
        
        await sock.sendMessage(chatId, { 
            text: `✅ *Telegram Bridge Activated!*\n\n📱 Forwarding to: ${config.whatsappNumber}\n🤖 Bot: @${telegramBot.botInfo?.username || 'Unknown'}` 
        });
        
        return true;
        
    } catch (error) {
        console.error('Telegram bot error:', error);
        await sock.sendMessage(chatId, { 
            text: `❌ Failed to start: ${error.message}` 
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
    
    // Show status if no subcommand
    if (!subCommand) {
        const config = loadConfig();
        let status = `📊 *Telegram Bridge Status*\n\n`;
        status += `🔹 *Active:* ${isActive ? '✅ YES' : '❌ NO'}\n`;
        status += `🔹 *Token Set:* ${config.token ? '✅' : '❌'}\n`;
        status += `🔹 *WhatsApp:* ${config.whatsappNumber || 'Not set'}\n`;
        
        if (telegramBot?.botInfo) {
            status += `🔹 *Bot:* @${telegramBot.botInfo.username}\n`;
        }
        
        status += `\n*Commands:*\n`;
        status += `• \`.telegram activate\` - Start bridge\n`;
        status += `• \`.telegram stop\` - Stop bridge\n`;
        status += `• \`.settoken TOKEN\` - Set Telegram token\n`;
        status += `• \`.setwa NUMBER\` - Set WhatsApp number`;
        
        await sock.sendMessage(chatId, { text: status });
        return;
    }
    
    // Handle subcommands
    switch (subCommand) {
        case 'activate':
        case 'start':
        case 'on':
            await startTelegramBot(sock, chatId);
            break;
            
        case 'stop':
        case 'off':
        case 'deactivate':
            await stopTelegramBot(sock, chatId);
            break;
            
        default:
            await sock.sendMessage(chatId, { 
                text: '❌ Unknown command. Use:\n• `.telegram activate`\n• `.telegram stop`' 
            });
    }
}

// Set token command
async function setTokenCommand(sock, chatId, message, token) {
    if (!token) {
        await sock.sendMessage(chatId, { 
            text: '❌ Please provide your Telegram bot token.\nExample: `.settoken 123456:ABCdef`' 
        });
        return;
    }
    
    const config = loadConfig();
    config.token = token;
    saveConfig(config);
    
    await sock.sendMessage(chatId, { 
        text: '✅ Telegram bot token saved!' 
    });
}

// Set WhatsApp number command
async function setWaCommand(sock, chatId, message, number) {
    if (!number) {
        await sock.sendMessage(chatId, { 
            text: '❌ Please provide your WhatsApp number.\nExample: `.setwa 923247220362`' 
        });
        return;
    }
    
    // Clean number
    const cleanNumber = number.replace(/[^0-9]/g, '');
    
    const config = loadConfig();
    config.whatsappNumber = cleanNumber;
    saveConfig(config);
    
    await sock.sendMessage(chatId, { 
        text: `✅ WhatsApp number set to: ${cleanNumber}` 
    });
}

module.exports = {
    telegramCommand,
    setTokenCommand,
    setWaCommand
};
