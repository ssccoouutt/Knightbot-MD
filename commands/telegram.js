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

// Hardcoded values
const TELEGRAM_BOT_TOKEN = "8717510346:AAFi_8U7L0KCh13UzEu69EGc7j8qDteyu70";
const BOT_USERNAME = "YourBotUsername"; // Replace with your bot's username
const WHATSAPP_NUMBER = "923247220362";
const WHATSAPP_GROUPS = [
    "120363140590753276@g.us",  // Original group
    "120363162260844407@g.us",
    "120363042237526273@g.us", 
    "120363023394033137@g.us",
    "120363161222427319@g.us"   // Fifth group
];

// Logger function with timestamps
function log(level, message, data = null) {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] [${level}] ${message}`;
    console.log(logMessage);
    if (data) {
        console.log(JSON.stringify(data, null, 2));
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
    
    // Python: re.sub(r'[ \t]+', ' ', text) - Replaces multiple spaces/tabs with single space
    text = text.replace(/[ \t]+/g, ' ');
    
    // Python: re.sub(r'\n{3,}', '\n\n', text) - Reduces multiple newlines to max 2
    text = text.replace(/\n{3,}/g, '\n\n');
    
    // Python: text.strip() - Final strip removes leading/trailing whitespace
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
    
    // First, remove all markdown symbols from the text
    let cleanText = text;
    cleanText = cleanText.replace(/\*\*/g, '');
    cleanText = cleanText.replace(/__/g, '');
    cleanText = cleanText.replace(/~~/g, '');
    cleanText = cleanText.replace(/`/g, '');
    
    log('DEBUG', 'Removed markdown symbols', {
        original: text,
        cleaned: cleanText
    });
    
    // If we have entities, use them for accurate formatting
    if (entities && entities.length > 0) {
        const reversedEntities = [...entities].sort((a, b) => b.offset - a.offset);
        let textArray = cleanText.split('');
        
        for (const entity of reversedEntities) {
            const start = entity.offset;
            const end = start + entity.length;
            const type = entity.className;
            
            if (type === 'MessageEntityBlockquote') {
                continue;
            }
            
            const content = cleanText.substring(start, end);
            
            let prefix = '', suffix = '';
            switch (type) {
                case 'MessageEntityBold':
                    prefix = '*'; suffix = '*';
                    break;
                case 'MessageEntityItalic':
                    prefix = '_'; suffix = '_';
                    break;
                case 'MessageEntityStrike':
                    prefix = '~'; suffix = '~';
                    break;
                case 'MessageEntityCode':
                case 'MessageEntityPre':
                    prefix = '```'; suffix = '```';
                    break;
                default:
                    continue;
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
        const cleanedResult = cleanWhitespace(result);
        
        log('INFO', 'Final formatted text', {
            originalLength: text.length,
            finalLength: cleanedResult.length,
            formatted: cleanedResult
        });
        
        return cleanedResult;
    }
    
    log('DEBUG', 'No entities found, using regex fallback');
    
    let formatted = text;
    formatted = formatted.replace(/\*\*(.*?)\*\*/g, '*$1*');
    formatted = formatted.replace(/__(.*?)__/g, '_$1_');
    formatted = formatted.replace(/~~(.*?)~~/g, '~$1~');
    formatted = formatted.replace(/`(.*?)`/g, '```$1```');
    
    formatted = cleanWhitespace(formatted);
    
    log('INFO', 'Final formatted text (regex method)', {
        original: text,
        formatted: formatted
    });
    
    return formatted;
}

async function downloadMedia(client, message) {
    try {
        if (message.media?.className === 'MessageMediaWebPage') {
            log('DEBUG', 'Skipping webpage media (no downloadable content)', { messageId: message.id });
            return null;
        }
        
        await new Promise(resolve => setTimeout(resolve, 500));
        
        const tempFile = path.join(TEMP_DIR, `tg_${message.id}`);
        
        if (!fs.existsSync(TEMP_DIR)) {
            fs.mkdirSync(TEMP_DIR, { recursive: true });
        }
        
        try {
            await client.downloadMedia(message, { 
                outputFile: tempFile,
                progressCallback: (received, total) => {
                    log('DEBUG', `Download progress: ${received}/${total}`, { messageId: message.id });
                }
            });
        } catch (downloadError) {
            log('ERROR', 'Download attempt failed, retrying...', { 
                messageId: message.id,
                error: downloadError.message 
            });
            
            await new Promise(resolve => setTimeout(resolve, 1000));
            await client.downloadMedia(message, { outputFile: tempFile });
        }
        
        if (!fs.existsSync(tempFile)) {
            log('ERROR', 'Media file not created', { messageId: message.id });
            return null;
        }
        
        const stats = fs.statSync(tempFile);
        if (stats.size === 0) {
            log('ERROR', 'Media file is empty', { messageId: message.id });
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
        log('ERROR', 'Media download failed', { 
            messageId: message.id,
            error: error.message,
            mediaType: message.media?.className
        });
        
        try {
            const tempFile = path.join(TEMP_DIR, `tg_${message.id}`);
            if (fs.existsSync(tempFile)) {
                fs.unlinkSync(tempFile);
            }
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
                log('INFO', 'Message sending cancelled by user');
                return false;
            default:
                log('ERROR', 'Invalid target type', { targetType });
                return false;
        }
        
        log('INFO', `Sending to ${targets.length} WhatsApp targets`, { targetType });
        
        for (const target of targets) {
            const jid = target.includes('@') ? target : 
                       targetType === 'own' ? `${target}@s.whatsapp.net` : `${target}@g.us`;
            
            if (messageData.type === 'text') {
                await sock.sendMessage(jid, { text: messageData.content });
                log('INFO', 'Text message sent to WhatsApp', { target: jid });
                
            } else if (messageData.type === 'media') {
                // Check file size (convert to MB)
                const fileSizeMB = messageData.size / (1024 * 1024);
                
                if (fileSizeMB > 100) {
                    // Send as document if > 100MB
                    const fileName = messageData.fileName || 
                        (messageData.mediaType === 'photo' ? 'image.jpg' : 
                         messageData.mediaType === 'video' ? 'video.mp4' : 'file.bin');
                    
                    await sock.sendMessage(jid, {
                        document: messageData.buffer,
                        fileName: fileName,
                        caption: messageData.caption,
                        mimetype: messageData.mimeType
                    });
                    log('INFO', `Large file (${fileSizeMB.toFixed(2)}MB) sent as document`, { target: jid });
                    
                } else {
                    // Send as normal media
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
                    } else if (messageData.mediaType === 'audio') {
                        await sock.sendMessage(jid, {
                            audio: messageData.buffer,
                            caption: messageData.caption
                        });
                    } else if (messageData.mediaType === 'voice') {
                        await sock.sendMessage(jid, {
                            audio: messageData.buffer,
                            ptt: true
                        });
                    } else if (messageData.mediaType === 'sticker') {
                        await sock.sendMessage(jid, {
                            sticker: messageData.buffer
                        });
                    }
                }
                
                log('INFO', `${messageData.mediaType} sent to WhatsApp`, { target: jid, sizeMB: fileSizeMB.toFixed(2) });
            }
        }
        
        return true;
    } catch (error) {
        log('ERROR', 'Failed to send to WhatsApp', { error: error.message });
        return false;
    }
}

// Initialize Telegram bot for confirmations
function initTelegramBot() {
    telegramBot = new Telegraf(TELEGRAM_BOT_TOKEN);
    
    telegramBot.command('start', (ctx) => {
        const helpMessage = 
            `🤖 *Welcome to WhatsApp Forwarder Bot*\n\n` +
            `This bot forwards messages to WhatsApp with your confirmation.\n\n` +
            `*How it works:*\n` +
            `1️⃣ Send any message to this bot\n` +
            `2️⃣ I'll ask you where to forward it\n` +
            `3️⃣ Choose destination:\n` +
            `   • 📱 *Own Chat* - Send to your personal WhatsApp\n` +
            `   • 👥 *All Groups* - Send to all ${WHATSAPP_GROUPS.length} configured groups\n` +
            `   • ❌ *Cancel* - Don't forward\n\n` +
            `*Configured Groups:*\n` +
            `${WHATSAPP_GROUPS.map((g, i) => `   ${i+1}. \`${g}\``).join('\n')}\n\n` +
            `*Note:* Media files larger than 100MB will be sent as documents.\n\n` +
            `*Commands:*\n` +
            `/start - Show this help message\n` +
            `/status - Check bot status`;
        
        ctx.reply(helpMessage, { parse_mode: 'Markdown' });
    });
    
    telegramBot.command('status', (ctx) => {
        const statusMessage = 
            `📊 *Bot Status*\n\n` +
            `• WhatsApp Number: \`${WHATSAPP_NUMBER}\`\n` +
            `• Groups Configured: ${WHATSAPP_GROUPS.length}\n` +
            `• Bridge Active: ${isActive ? '✅' : '❌'}\n` +
            `• Pending Messages: ${pendingMessages.size}`;
        
        ctx.reply(statusMessage, { parse_mode: 'Markdown' });
    });
    
    telegramBot.on('callback_query', async (ctx) => {
        try {
            const callbackData = ctx.callbackQuery.data;
            const messageId = ctx.callbackQuery.message.message_id;
            const chatId = ctx.callbackQuery.message.chat.id;
            
            const parts = callbackData.split('_');
            if (parts.length !== 3 || parts[0] !== 'confirm') {
                await ctx.answerCbQuery('Invalid option');
                return;
            }
            
            const originalMessageId = parts[1];
            const target = parts[2];
            const pendingKey = `${chatId}_${originalMessageId}`;
            const messageData = pendingMessages.get(pendingKey);
            
            if (!messageData) {
                await ctx.answerCbQuery('❌ This message has expired');
                await ctx.editMessageText('❌ This message has expired or already processed.');
                return;
            }
            
            await ctx.answerCbQuery('Processing...');
            
            pendingMessages.delete(pendingKey);
            
            if (target === 'cancel') {
                await ctx.editMessageText('❌ Message forwarding cancelled.');
                return;
            }
            
            // Get sock from global or passed instance
            const sock = global.sock;
            if (!sock) {
                await ctx.editMessageText('❌ WhatsApp connection not available');
                return;
            }
            
            const success = await sendToWhatsApp(sock, messageData, target);
            
            if (success) {
                const targetText = target === 'own' ? 'your own chat' : 'all groups';
                await ctx.editMessageText(`✅ Message forwarded to WhatsApp (${targetText})`);
            } else {
                await ctx.editMessageText('❌ Failed to forward message to WhatsApp');
            }
            
        } catch (error) {
            log('ERROR', 'Callback query error', { error: error.message });
        }
    });
    
    // Handle regular messages
    telegramBot.on('message', async (ctx) => {
        try {
            const message = ctx.message;
            const chatId = ctx.chat.id;
            
            log('INFO', 'Direct message received in Telegram bot', {
                chatId,
                hasText: !!message.text,
                hasMedia: !!message.photo || !!message.video || !!message.document
            });
            
            // Process the message as if it came through the bridge
            const text = message.text || message.caption || '';
            const formattedText = convertTelegramToWhatsApp(text, []);
            
            let messageData = {
                type: 'text',
                content: formattedText,
                timestamp: Date.now()
            };
            
            if (message.photo || message.video || message.document) {
                // For direct media, we need to download it
                // This is simplified - you might need to implement media download for direct messages
                messageData = {
                    type: 'text',
                    content: formattedText + '\n\n[Media received directly - use the bridge bot for media]',
                    timestamp: Date.now()
                };
            }
            
            const pendingKey = `${chatId}_${message.message_id}`;
            pendingMessages.set(pendingKey, messageData);
            
            const previewText = formattedText.length > 200 ? 
                formattedText.substring(0, 200) + '...' : 
                formattedText;
            
            const confirmationMessage = 
                `📨 *New message received*\n\n` +
                `Preview:\n${previewText}\n\n` +
                `Type: ${message.photo || message.video || message.document ? 'Media' : 'Text'}\n` +
                `Length: ${formattedText.length} characters\n\n` +
                `Where would you like to forward this to WhatsApp?`;
            
            await ctx.reply(confirmationMessage, {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: '📱 Own Chat', callback_data: `confirm_${message.message_id}_own` },
                            { text: '👥 All Groups', callback_data: `confirm_${message.message_id}_group` }
                        ],
                        [
                            { text: '❌ Cancel', callback_data: `confirm_${message.message_id}_cancel` }
                        ]
                    ]
                }
            });
            
        } catch (error) {
            log('ERROR', 'Message handler error in Telegram bot', { error: error.message });
        }
    });
    
    telegramBot.launch();
    log('INFO', 'Telegram confirmation bot started');
}

async function startTelegramBot(sock, chatId) {
    log('INFO', 'Starting Telegram bot', { chatId });

    try {
        if (telegramClient) await telegramClient.disconnect();
        
        telegramClient = new TelegramClient(new StringSession(""), API_ID, API_HASH, {
            connectionRetries: 5,
            downloadRetries: 3
        });
        
        await telegramClient.start({ botAuthToken: TELEGRAM_BOT_TOKEN });
        log('INFO', 'Telegram client connected successfully');
        
        if (!telegramBot) {
            initTelegramBot();
        }
        
        await new Promise(resolve => setTimeout(resolve, 2000));
        connectionReady = true;
        log('INFO', 'Telegram connection ready for media downloads');
        
        async function messageHandler(event) {
            try {
                const msg = event.message;
                if (!msg) {
                    log('DEBUG', 'Empty message received');
                    return;
                }
                
                let senderId = null;
                if (msg.fromId) {
                    if (typeof msg.fromId === 'object' && msg.fromId.userId) {
                        senderId = msg.fromId.userId;
                    } else if (typeof msg.fromId === 'object' && msg.fromId.value) {
                        senderId = msg.fromId.value;
                    } else if (typeof msg.fromId === 'number' || typeof msg.fromId === 'string') {
                        senderId = msg.fromId.toString();
                    }
                }
                
                if (!senderId && msg.peerId) {
                    if (typeof msg.peerId === 'object' && msg.peerId.userId) {
                        senderId = msg.peerId.userId;
                    }
                }
                
                if (!senderId) {
                    log('DEBUG', 'Could not determine sender ID, skipping message', { messageId: msg.id });
                    return;
                }
                
                // CRITICAL FIX: Skip messages from the bot itself
                if (senderId.toString() === '8717510346') {
                    log('DEBUG', 'Skipping message from bot itself', { senderId });
                    return;
                }
                
                log('INFO', 'New message received', {
                    messageId: msg.id,
                    senderId: senderId,
                    hasText: !!msg.text,
                    textLength: msg.text?.length || 0,
                    hasMedia: !!msg.media,
                    mediaType: msg.media?.className
                });
                
                if (msg.text && msg.text.startsWith('/')) {
                    log('DEBUG', 'Skipping command message', { text: msg.text });
                    return;
                }
                
                const text = msg.text || '';
                const entities = msg.entities || [];
                
                const formattedText = convertTelegramToWhatsApp(text, entities);
                
                let messageData = {
                    type: 'text',
                    content: formattedText,
                    timestamp: Date.now()
                };
                
                if (msg.media) {
                    if (!connectionReady) {
                        log('WARN', 'Connection not ready yet, waiting...');
                        await new Promise(resolve => setTimeout(resolve, 2000));
                    }
                    
                    log('DEBUG', 'Downloading media', { messageId: msg.id });
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    
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
                            fileName = msg.document.attributes
                                .find(a => a.className === 'DocumentAttributeFilename')?.fileName || `file_${msg.id}.bin`;
                        } else if (msg.audio) {
                            mediaType = 'audio';
                            fileName = `audio_${msg.id}.mp3`;
                        } else if (msg.voice) {
                            mediaType = 'voice';
                            fileName = `voice_${msg.id}.ogg`;
                        } else if (msg.sticker) {
                            mediaType = 'sticker';
                            fileName = `sticker_${msg.id}.webp`;
                        }
                        
                        messageData = {
                            type: 'media',
                            mediaType: mediaType,
                            buffer: mediaResult.buffer,
                            size: mediaResult.size,
                            mimeType: mediaResult.mimeType,
                            fileName: fileName,
                            caption: formattedText,
                            timestamp: Date.now()
                        };
                    } else {
                        // Media download failed, send as text only
                        messageData = {
                            type: 'text',
                            content: formattedText + '\n\n[Media could not be downloaded]',
                            timestamp: Date.now()
                        };
                    }
                }
                
                const pendingKey = `${senderId}_${msg.id}`;
                pendingMessages.set(pendingKey, messageData);
                
                const now = Date.now();
                for (const [key, data] of pendingMessages.entries()) {
                    if (now - data.timestamp > 300000) {
                        pendingMessages.delete(key);
                    }
                }
                
                const previewText = formattedText.length > 200 ? 
                    formattedText.substring(0, 200) + '...' : 
                    formattedText;
                
                let fileSizeInfo = '';
                if (messageData.type === 'media') {
                    const sizeMB = messageData.size / (1024 * 1024);
                    fileSizeInfo = `\nSize: ${sizeMB.toFixed(2)}MB ${sizeMB > 100 ? '(will be sent as document)' : ''}`;
                }
                
                const confirmationMessage = 
                    `📨 *New message received*\n\n` +
                    `Preview:\n${previewText}\n\n` +
                    `Type: ${msg.media ? 'Media with caption' : 'Text'}${fileSizeInfo}\n` +
                    `Length: ${formattedText.length} characters\n\n` +
                    `Where would you like to forward this to WhatsApp?`;
                
                // Use the same bot instance to send confirmation
                await telegramBot.telegram.sendMessage(
                    senderId,
                    confirmationMessage,
                    {
                        parse_mode: 'Markdown',
                        reply_markup: {
                            inline_keyboard: [
                                [
                                    { text: '📱 Own Chat', callback_data: `confirm_${msg.id}_own` },
                                    { text: '👥 All Groups', callback_data: `confirm_${msg.id}_group` }
                                ],
                                [
                                    { text: '❌ Cancel', callback_data: `confirm_${msg.id}_cancel` }
                                ]
                            ]
                        }
                    }
                );
                
                log('INFO', 'Confirmation request sent', { 
                    senderId: senderId,
                    messageId: msg.id,
                    hasMedia: !!msg.media 
                });
                
            } catch (err) {
                log('ERROR', 'Message handler error', { 
                    error: err.message,
                    stack: err.stack 
                });
            }
        }
        
        telegramClient.addEventHandler(messageHandler, new NewMessage({}));
        log('INFO', 'Message handler registered');
        
        isActive = true;
        
        await sock.sendMessage(chatId, { text: '✅ Bridge active - Messages will be sent to Telegram bot for confirmation' });
        log('INFO', 'Bridge started successfully');
        return true;
        
    } catch (error) {
        log('ERROR', 'Failed to start Telegram bot', { 
            error: error.message,
            stack: error.stack 
        });
        await sock.sendMessage(chatId, { text: '❌ Failed to start' });
        return false;
    }
}

async function telegramCommand(sock, chatId, message, args) {
    const sub = args[0]?.toLowerCase();
    
    log('INFO', 'Telegram command received', { sub, chatId });
    
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
            if (telegramClient) await telegramClient.disconnect();
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

// Remove setTokenCommand and setWaCommand as they're not needed
async function setTokenCommand() {} // Empty function
async function setWaCommand() {}    // Empty function

module.exports = {
    telegramCommand,
    setTokenCommand,
    setWaCommand
};
