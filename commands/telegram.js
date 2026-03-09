const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { NewMessage } = require('telegram/events');
const fs = require('fs');
const path = require('path');
const { Telegraf } = require('telegraf');

const TEMP_DIR = path.join(process.cwd(), 'temp');
let telegramClient = null;
let isActive = false;
let connectionReady = false;
let telegramBot = null;

// Store pending messages for confirmation
const pendingMessages = new Map();

if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

const API_ID = 32086282;
const API_HASH = "064a66fe7097452e6ac8f4e8df28aa97";

// HARDCODED VALUES
const TELEGRAM_BOT_TOKEN = "8717510346:AAFi_8U7L0KCh13UzEu69EGc7j8qDteyu70";
const BOT_ID = "8717510346"; // Bot's user ID
const WHATSAPP_NUMBER = "923247220362";
const WHATSAPP_GROUPS = [
    "120363140590753276@g.us",  // Original group
    "120363162260844407@g.us",
    "120363042237526273@g.us", 
    "120363023394033137@g.us",
    "120363161222427319@g.us"   // Fifth group
];

// Logger function with timestamps - FIXED to handle BigInt
function log(level, message, data = null) {
    const timestamp = new Date().toISOString();
    let logMessage = `[${timestamp}] [${level}] ${message}`;
    console.log(logMessage);
    if (data) {
        // Convert BigInt values to strings for logging
        const processedData = JSON.parse(JSON.stringify(data, (key, value) => 
            typeof value === 'bigint' ? value.toString() : value
        ));
        console.log(JSON.stringify(processedData, null, 2));
    }
    const logDir = path.join(process.cwd(), 'logs');
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
    fs.appendFileSync(
        path.join(logDir, 'telegram_bridge.log'),
        logMessage + (data ? '\n' + JSON.stringify(data) : '') + '\n'
    );
}

// EXACT Python cleanup function 1: Clean whitespace
function cleanWhitespace(text) {
    if (!text) return text;
    text = text.replace(/[ \t]+/g, ' ');
    text = text.replace(/\n{3,}/g, '\n\n');
    return text.trim();
}

// EXACT Python line wrapping function
function wrapLines(content, prefix, suffix) {
    const lines = content.split('\n');
    const wrappedLines = [];
    for (const line of lines) {
        if (line.trim()) {
            wrappedLines.push(prefix + line.trim() + suffix);
        } else {
            wrappedLines.push('');
        }
    }
    return wrappedLines.join('\n');
}

function convertTelegramToWhatsApp(text, entities) {
    if (!text) return text;
    
    log('DEBUG', 'Converting text with entities', { 
        originalText: text,
        originalLength: text.length,
        entityCount: entities?.length || 0
    });
    
    let cleanText = text;
    cleanText = cleanText.replace(/\*\*/g, '');
    cleanText = cleanText.replace(/__/g, '');
    cleanText = cleanText.replace(/~~/g, '');
    cleanText = cleanText.replace(/`/g, '');
    
    if (entities && entities.length > 0) {
        const reversedEntities = [...entities].sort((a, b) => b.offset - a.offset);
        let textArray = cleanText.split('');
        
        for (const entity of reversedEntities) {
            const start = entity.offset;
            const end = start + entity.length;
            const type = entity.className;
            
            if (type === 'MessageEntityBlockquote') continue;
            
            const content = cleanText.substring(start, end);
            
            let prefix = '', suffix = '';
            switch (type) {
                case 'MessageEntityBold': prefix = '*'; suffix = '*'; break;
                case 'MessageEntityItalic': prefix = '_'; suffix = '_'; break;
                case 'MessageEntityStrike': prefix = '~'; suffix = '~'; break;
                case 'MessageEntityCode':
                case 'MessageEntityPre': prefix = '```'; suffix = '```'; break;
                default: continue;
            }
            
            let replacement;
            if (type === 'MessageEntityPre') {
                replacement = prefix + content + suffix;
            } else {
                const lines = content.split('\n');
                const wrappedLines = [];
                for (const line of lines) {
                    if (line.trim()) {
                        wrappedLines.push(prefix + line.trim() + suffix);
                    } else {
                        wrappedLines.push('');
                    }
                }
                replacement = wrappedLines.join('\n');
            }
            
            textArray.splice(start, end - start, replacement);
        }
        
        let result = textArray.join('');
        return cleanWhitespace(result);
    }
    
    let formatted = text;
    formatted = formatted.replace(/\*\*(.*?)\*\*/g, '*$1*');
    formatted = formatted.replace(/__(.*?)__/g, '_$1_');
    formatted = formatted.replace(/~~(.*?)~~/g, '~$1~');
    formatted = formatted.replace(/`(.*?)`/g, '```$1```');
    
    return cleanWhitespace(formatted);
}

async function downloadMedia(client, message) {
    try {
        if (message.media?.className === 'MessageMediaWebPage') {
            return null;
        }
        
        await new Promise(resolve => setTimeout(resolve, 500));
        
        const tempFile = path.join(TEMP_DIR, `tg_${message.id}`);
        
        if (!fs.existsSync(TEMP_DIR)) {
            fs.mkdirSync(TEMP_DIR, { recursive: true });
        }
        
        try {
            await client.downloadMedia(message, { outputFile: tempFile });
        } catch (downloadError) {
            await new Promise(resolve => setTimeout(resolve, 1000));
            await client.downloadMedia(message, { outputFile: tempFile });
        }
        
        if (!fs.existsSync(tempFile)) {
            return null;
        }
        
        const stats = fs.statSync(tempFile);
        if (stats.size === 0) {
            fs.unlinkSync(tempFile);
            return null;
        }
        
        const buffer = fs.readFileSync(tempFile);
        fs.unlinkSync(tempFile);
        return {
            buffer,
            size: stats.size,
            mimeType: message.photo ? 'image/jpeg' : 
                     message.video ? 'video/mp4' : 
                     message.document?.mimeType || 'application/octet-stream'
        };
    } catch (error) {
        try {
            const tempFile = path.join(TEMP_DIR, `tg_${message.id}`);
            if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
        } catch (cleanupError) {}
        return null;
    }
}

async function sendToWhatsApp(sock, messageData, targetType) {
    try {
        let targets = [];
        
        switch (targetType) {
            case 'own':
                targets = [WHATSAPP_NUMBER];
                break;
            case 'group':
                targets = WHATSAPP_GROUPS;
                break;
            case 'cancel':
                return false;
        }
        
        log('INFO', `Sending to ${targets.length} targets`, { targetType });
        
        for (const target of targets) {
            const jid = target.includes('@') ? target : 
                       targetType === 'own' ? `${target}@s.whatsapp.net` : `${target}@g.us`;
            
            if (messageData.type === 'text') {
                await sock.sendMessage(jid, { text: messageData.content });
                log('INFO', 'Text sent', { target: jid });
            } else if (messageData.type === 'media') {
                const fileSizeMB = messageData.size / (1024 * 1024);
                
                if (fileSizeMB > 100) {
                    const fileName = messageData.fileName || 'file.bin';
                    await sock.sendMessage(jid, {
                        document: messageData.buffer,
                        fileName: fileName,
                        caption: messageData.caption,
                        mimetype: messageData.mimeType
                    });
                    log('INFO', 'Large file sent as document', { target: jid, sizeMB: Math.round(fileSizeMB * 100) / 100 });
                } else {
                    if (messageData.mediaType === 'photo') {
                        await sock.sendMessage(jid, {
                            image: messageData.buffer,
                            caption: messageData.caption
                        });
                    } else if (messageData.mediaType === 'video') {
                        await sock.sendMessage(jid, {
                            video: messageData.buffer,
                            caption: messageData.caption
                        });
                    } else if (messageData.mediaType === 'document') {
                        await sock.sendMessage(jid, {
                            document: messageData.buffer,
                            fileName: messageData.fileName,
                            caption: messageData.caption,
                            mimetype: messageData.mimeType
                        });
                    }
                    log('INFO', `${messageData.mediaType} sent`, { target: jid });
                }
            }
        }
        return true;
    } catch (error) {
        log('ERROR', 'Send failed', { error: error.message });
        return false;
    }
}

// Initialize Telegram bot for confirmations
function initTelegramBot() {
    telegramBot = new Telegraf(TELEGRAM_BOT_TOKEN);
    
    telegramBot.command('start', (ctx) => {
        const helpMessage = 
            `🤖 *WhatsApp Forwarder Bot*\n\n` +
            `Send any message here and choose where to forward it.\n\n` +
            `*Options:*\n` +
            `• 📱 *Own Chat* - Send to your WhatsApp\n` +
            `• 👥 *Groups* - Send to ${WHATSAPP_GROUPS.length} groups\n` +
            `• ❌ *Cancel* - Don't forward`;
        
        ctx.reply(helpMessage, { parse_mode: 'Markdown' });
        log('INFO', 'Start command responded', { chatId: ctx.chat.id.toString() });
    });
    
    telegramBot.on('callback_query', async (ctx) => {
        try {
            const callbackData = ctx.callbackQuery.data;
            const parts = callbackData.split('_');
            if (parts.length !== 3 || parts[0] !== 'confirm') {
                await ctx.answerCbQuery('Invalid option');
                return;
            }
            
            const originalMessageId = parts[1];
            const target = parts[2];
            const pendingKey = `${ctx.chat.id}_${originalMessageId}`;
            const messageData = pendingMessages.get(pendingKey);
            
            if (!messageData) {
                await ctx.answerCbQuery('❌ Expired');
                await ctx.editMessageText('❌ This message has expired.');
                return;
            }
            
            await ctx.answerCbQuery('Processing...');
            pendingMessages.delete(pendingKey);
            
            if (target === 'cancel') {
                await ctx.editMessageText('❌ Cancelled.');
                return;
            }
            
            const sock = global.sock;
            if (!sock) {
                await ctx.editMessageText('❌ WhatsApp not connected');
                return;
            }
            
            const success = await sendToWhatsApp(sock, messageData, target);
            
            if (success) {
                const targetText = target === 'own' ? 'your chat' : 'all groups';
                await ctx.editMessageText(`✅ Forwarded to ${targetText}`);
            } else {
                await ctx.editMessageText('❌ Failed to forward');
            }
            
        } catch (error) {
            log('ERROR', 'Callback error', { error: error.message });
        }
    });
    
    telegramBot.launch();
    log('INFO', 'Telegram confirmation bot started');
}

async function startTelegramBot(sock, chatId) {
    log('INFO', 'Starting Telegram bot', { chatId: chatId.toString() });

    try {
        if (telegramClient) await telegramClient.disconnect();
        
        telegramClient = new TelegramClient(new StringSession(""), API_ID, API_HASH, {
            connectionRetries: 5,
            downloadRetries: 3
        });
        
        await telegramClient.start({ botAuthToken: TELEGRAM_BOT_TOKEN });
        log('INFO', 'Telegram client connected');
        
        if (!telegramBot) {
            initTelegramBot();
        }
        
        await new Promise(resolve => setTimeout(resolve, 2000));
        connectionReady = true;
        
        async function messageHandler(event) {
            try {
                const msg = event.message;
                if (!msg) {
                    log('DEBUG', 'Empty message received');
                    return;
                }
                
                // Get sender info to check if it's the bot itself
                let senderId = null;
                if (msg.fromId) {
                    if (msg.fromId.userId) senderId = msg.fromId.userId.toString();
                    else if (msg.fromId.value) senderId = msg.fromId.value.toString();
                }
                
                // CRITICAL: Skip messages from the bot itself to prevent loops
                if (senderId === BOT_ID) {
                    log('DEBUG', 'Skipping message from bot itself', { senderId });
                    return;
                }
                
                // Skip if it's a command
                if (msg.text && msg.text.startsWith('/')) {
                    log('DEBUG', 'Skipping command', { text: msg.text });
                    return;
                }
                
                // Skip messages that look like our confirmation messages (to prevent loops)
                if (msg.text && msg.text.includes('📨 *New Message*')) {
                    log('DEBUG', 'Skipping confirmation message', { text: msg.text.substring(0, 50) });
                    return;
                }
                
                log('INFO', '📨 MESSAGE RECEIVED', {
                    messageId: msg.id.toString(),
                    senderId: senderId,
                    hasText: !!msg.text,
                    hasMedia: !!msg.media
                });
                
                // Get the chat ID to send confirmation back
                const chatId = msg.chatId?.value?.toString() || msg.peerId?.userId?.toString();
                if (!chatId) {
                    log('ERROR', 'Cannot determine chat ID');
                    return;
                }
                
                const text = msg.text || msg.caption || '';
                const entities = msg.entities || [];
                
                log('DEBUG', 'Converting text', { textLength: text.length });
                const formattedText = convertTelegramToWhatsApp(text, entities);
                
                let messageData = {
                    type: 'text',
                    content: formattedText,
                    timestamp: Date.now()
                };
                
                // Handle media if present
                if (msg.media && msg.media.className !== 'MessageMediaWebPage') {
                    log('DEBUG', 'Downloading media', { messageId: msg.id.toString() });
                    
                    const mediaResult = await downloadMedia(telegramClient, msg);
                    
                    if (mediaResult) {
                        let fileName = 'file';
                        let mediaType = 'document';
                        
                        if (msg.photo) {
                            mediaType = 'photo';
                            fileName = `image_${msg.id}.jpg`;
                        } else if (msg.video) {
                            mediaType = 'video';
                            fileName = `video_${msg.id}.mp4`;
                        } else if (msg.document) {
                            mediaType = 'document';
                            const attr = msg.document.attributes.find(a => a.className === 'DocumentAttributeFilename');
                            fileName = attr?.fileName || `file_${msg.id}.bin`;
                        }
                        
                        messageData = {
                            type: 'media',
                            mediaType,
                            buffer: mediaResult.buffer,
                            size: mediaResult.size,
                            mimeType: mediaResult.mimeType,
                            fileName,
                            caption: formattedText,
                            timestamp: Date.now()
                        };
                        
                        log('INFO', 'Media downloaded', { 
                            type: mediaType, 
                            size: mediaResult.size 
                        });
                    }
                }
                
                // Store in pending messages using chatId
                const pendingKey = `${chatId}_${msg.id}`;
                pendingMessages.set(pendingKey, messageData);
                log('INFO', 'Message stored in pending', { pendingKey });
                
                // Cleanup old messages
                const now = Date.now();
                for (const [key, data] of pendingMessages.entries()) {
                    if (now - data.timestamp > 300000) {
                        pendingMessages.delete(key);
                    }
                }
                
                // Create preview - WITHOUT markdown to avoid parsing issues
                const previewText = formattedText.length > 100 ? 
                    formattedText.substring(0, 100) + '...' : 
                    formattedText || '[No text]';
                
                const fileSizeInfo = messageData.type === 'media' ? 
                    ` (${(messageData.size / 1024 / 1024).toFixed(2)}MB)` : '';
                
                // Simple plain text message without markdown to avoid parsing errors
                const confirmationMessage = 
                    `📨 New Message\n\n` +
                    `Preview: ${previewText}${fileSizeInfo}\n\n` +
                    `Forward to?`;
                
                log('INFO', 'Sending confirmation', { chatId });
                
                // Send confirmation back to the same chat - WITHOUT parse_mode to avoid entity parsing errors
                await telegramBot.telegram.sendMessage(
                    parseInt(chatId),
                    confirmationMessage,
                    {
                        reply_markup: {
                            inline_keyboard: [
                                [
                                    { text: '📱 Own Chat', callback_data: `confirm_${msg.id}_own` },
                                    { text: '👥 Groups', callback_data: `confirm_${msg.id}_group` }
                                ],
                                [
                                    { text: '❌ Cancel', callback_data: `confirm_${msg.id}_cancel` }
                                ]
                            ]
                        }
                    }
                );
                
                log('INFO', '✅ Confirmation sent', { 
                    chatId, 
                    messageId: msg.id.toString() 
                });
                
            } catch (err) {
                log('ERROR', 'Message handler error', { 
                    error: err.message,
                    stack: err.stack 
                });
            }
        }
        
        // Add event handler for all messages
        telegramClient.addEventHandler(messageHandler, new NewMessage({}));
        log('INFO', '✅ Message handler registered - ready to receive messages');
        
        isActive = true;
        
        await sock.sendMessage(chatId, { text: '✅ Bridge active - Send messages to the bot to forward to WhatsApp' });
        return true;
        
    } catch (error) {
        log('ERROR', 'Failed to start', { error: error.message });
        await sock.sendMessage(chatId, { text: '❌ Failed to start' });
        return false;
    }
}

async function telegramCommand(sock, chatId, message, args) {
    const sub = args[0]?.toLowerCase();
    
    if (!sub) {
        await sock.sendMessage(chatId, { 
            text: `📊 Status\nActive: ${isActive ? '✅' : '❌'}\nWhatsApp: ${WHATSAPP_NUMBER}\nGroups: ${WHATSAPP_GROUPS.length}\n\nCommands:\n.on - Start\n.off - Stop`
        });
        return;
    }
    
    switch (sub) {
        case 'on': case 'start':
            await startTelegramBot(sock, chatId);
            break;
        case 'off': case 'stop':
            if (telegramClient) {
                await telegramClient.disconnect();
                telegramClient = null;
            }
            if (telegramBot) {
                telegramBot.stop();
                telegramBot = null;
            }
            isActive = false;
            connectionReady = false;
            pendingMessages.clear();
            await sock.sendMessage(chatId, { text: '🔴 Stopped' });
            log('INFO', 'Bridge stopped');
            break;
    }
}

// Empty functions since values are hardcoded
async function setTokenCommand() {}
async function setWaCommand() {}

module.exports = {
    telegramCommand,
    setTokenCommand,
    setWaCommand
};
