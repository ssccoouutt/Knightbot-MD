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
let whatsappSock = null;

// Store pending messages
const pendingMessages = new Map();
const pendingDownloads = new Map();

if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

const API_ID = 32086282;
const API_HASH = "064a66fe7097452e6ac8f4e8df28aa97";

// HARDCODED VALUES
const TELEGRAM_BOT_TOKEN = "8717510346:AAFi_8U7L0KCh13UzEu69EGc7j8qDteyu70";
const BOT_ID = "8717510346";
const WHATSAPP_NUMBER = "923247220362";
const CRITICAL_CHANNEL = "120363304414452603@newsletter";
const WHATSAPP_GROUPS = [
    "120363140590753276@g.us",
    "120363162260844407@g.us",
    "120363042237526273@g.us", 
    "120363023394033137@g.us",
    "120363161222427319@g.us"
];

// ALL TARGETS = Channel + All Groups
const ALL_TARGETS = [
    CRITICAL_CHANNEL,                    // Channel first
    ...WHATSAPP_GROUPS                    // Then all groups
];

const RATE_LIMIT_DELAY = 3000;
const BATCH_SIZE = 2;
const KEEP_ALIVE_INTERVAL = 15000;

function log(level, message, data = null) {
    const timestamp = new Date().toISOString();
    let logMessage = `[${timestamp}] [${level}] ${message}`;
    console.log(logMessage);
    if (data) {
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

// Keep connection alive
function startKeepAlive() {
    if (!telegramClient) return;
    
    const interval = setInterval(async () => {
        if (!telegramClient || !telegramClient.connected) {
            clearInterval(interval);
            return;
        }
        
        try {
            await telegramClient.getMe();
            log('DEBUG', 'Keep-alive ping sent');
        } catch (err) {
            log('WARN', 'Keep-alive failed', { error: err.message });
        }
    }, KEEP_ALIVE_INTERVAL);
    
    return interval;
}

function cleanWhitespace(text) {
    if (!text) return text;
    text = text.replace(/[ \t]+/g, ' ');
    text = text.replace(/\n{3,}/g, '\n\n');
    return text.trim();
}

function convertTelegramToWhatsApp(text, entities) {
    if (!text) return text;
    
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
    const downloadId = `${message.id}_${Date.now()}`;
    pendingDownloads.set(downloadId, { status: 'downloading', startTime: Date.now() });
    
    try {
        if (message.media?.className === 'MessageMediaWebPage') {
            pendingDownloads.delete(downloadId);
            return null;
        }
        
        let lastError = null;
        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                const tempFile = path.join(TEMP_DIR, `tg_${message.id}_attempt_${attempt}`);
                
                if (!fs.existsSync(TEMP_DIR)) {
                    fs.mkdirSync(TEMP_DIR, { recursive: true });
                }
                
                log('DEBUG', `Download attempt ${attempt}/3`, { messageId: message.id });
                
                await client.downloadMedia(message, { 
                    outputFile: tempFile,
                    progressCallback: (received, total) => {
                        if (received % 100000 === 0) {
                            log('DEBUG', `Download progress: ${Math.round(received/1024)}KB/${Math.round(total/1024)}KB`, { messageId: message.id });
                        }
                    }
                });
                
                if (!fs.existsSync(tempFile)) {
                    throw new Error('File not created');
                }
                
                const stats = fs.statSync(tempFile);
                if (stats.size === 0) {
                    throw new Error('File is empty');
                }
                
                const buffer = fs.readFileSync(tempFile);
                fs.unlinkSync(tempFile);
                
                log('INFO', `✅ Media downloaded successfully on attempt ${attempt}`, { 
                    messageId: message.id,
                    size: stats.size,
                    type: message.photo ? 'photo' : message.video ? 'video' : 'document'
                });
                
                pendingDownloads.delete(downloadId);
                return {
                    buffer,
                    size: stats.size,
                    mimeType: message.photo ? 'image/jpeg' : 
                             message.video ? 'video/mp4' : 
                             message.document?.mimeType || 'application/octet-stream'
                };
                
            } catch (err) {
                lastError = err;
                log('WARN', `Download attempt ${attempt} failed`, { 
                    messageId: message.id,
                    error: err.message 
                });
                
                try {
                    const tempFile = path.join(TEMP_DIR, `tg_${message.id}_attempt_${attempt}`);
                    if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
                } catch (cleanupError) {}
                
                if (attempt < 3) {
                    const delay = attempt * 2000;
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            }
        }
        
        pendingDownloads.delete(downloadId);
        log('ERROR', '❌ ALL download attempts failed', { 
            messageId: message.id,
            lastError: lastError?.message 
        });
        return null;
        
    } catch (error) {
        pendingDownloads.delete(downloadId);
        log('ERROR', 'Media download failed completely', { 
            messageId: message.id,
            error: error.message 
        });
        return null;
    }
}

// ===== SEND TO ALL TARGETS - NO TAGS, NO FORWARDED, PURE MESSAGES =====
async function sendToAllTargets(messageData) {
    try {
        if (!whatsappSock) {
            log('ERROR', 'WhatsApp socket not available');
            return false;
        }
        
        log('INFO', `🚨 SENDING TO ALL ${ALL_TARGETS.length} TARGETS (Channel + ${WHATSAPP_GROUPS.length} Groups)`);
        
        let successCount = 0;
        let failedTargets = [];
        
        // Process targets one by one
        for (let i = 0; i < ALL_TARGETS.length; i++) {
            const target = ALL_TARGETS[i];
            
            try {
                log('DEBUG', `Sending to target ${i+1}/${ALL_TARGETS.length}: ${target}`);
                
                // Prepare message based on type - NO contextInfo at all
                let messageOptions = {};
                
                if (messageData.type === 'text') {
                    messageOptions = { text: messageData.content };
                } else if (messageData.type === 'media') {
                    const mediaBuffer = messageData.buffer;
                    const mediaCaption = messageData.caption || '';
                    const mediaFileName = messageData.fileName;
                    const mediaMimeType = messageData.mimeType;
                    const mediaType = messageData.mediaType;
                    const mediaSize = messageData.size;
                    
                    const fileSizeMB = mediaSize / (1024 * 1024);
                    
                    if (fileSizeMB > 100) {
                        messageOptions = {
                            document: mediaBuffer,
                            fileName: mediaFileName || 'file.bin',
                            caption: mediaCaption,
                            mimetype: mediaMimeType
                        };
                    } else {
                        if (mediaType === 'photo') {
                            messageOptions = {
                                image: mediaBuffer,
                                caption: mediaCaption
                            };
                        } else if (mediaType === 'video') {
                            messageOptions = {
                                video: mediaBuffer,
                                caption: mediaCaption
                            };
                        } else if (mediaType === 'document') {
                            messageOptions = {
                                document: mediaBuffer,
                                fileName: mediaFileName,
                                caption: mediaCaption,
                                mimetype: mediaMimeType
                            };
                        } else {
                            messageOptions = {
                                document: mediaBuffer,
                                fileName: mediaFileName || 'file',
                                caption: mediaCaption,
                                mimetype: mediaMimeType
                            };
                        }
                    }
                }
                
                // Check if this is a channel (ends with @newsletter)
                const isChannel = target.endsWith('@newsletter');
                
                // For channels - send typing indicator but NO contextInfo
                if (isChannel) {
                    await whatsappSock.sendPresenceUpdate('composing', target);
                    log('DEBUG', 'Sending to channel with NO context info', { target });
                }
                
                // Send the message - NO contextInfo added anywhere
                await whatsappSock.sendMessage(target, messageOptions);
                
                log('INFO', `✅ Sent`, { target, type: messageData.type || 'text' });
                successCount++;
                
                // Delay between sends
                if (i < ALL_TARGETS.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_DELAY));
                }
                
            } catch (err) {
                log('ERROR', `Failed to send to ${target}`, { error: err.message });
                failedTargets.push(target);
            }
        }
        
        if (failedTargets.length > 0) {
            log('WARN', `Failed to send to ${failedTargets.length} targets`, { failedTargets });
            return false;
        }
        
        log('INFO', `✅ Successfully sent to ALL ${ALL_TARGETS.length} targets`);
        return true;
        
    } catch (error) {
        log('ERROR', 'Send to all failed', { error: error.message });
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
            `• 👥 *ALL* - Send to Channel + ${WHATSAPP_GROUPS.length} groups\n` +
            `• 📱 *Own Chat* - Send only to your WhatsApp\n` +
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
            
            await ctx.answerCbQuery('⏳ Processing...');
            pendingMessages.delete(pendingKey);
            
            if (target === 'cancel') {
                await ctx.editMessageText('❌ Cancelled.');
                return;
            }
            
            let success = false;
            let targetText = '';
            
            if (target === 'all') {
                success = await sendToAllTargets(messageData);
                targetText = `Channel + ${WHATSAPP_GROUPS.length} groups`;
            } else if (target === 'own') {
                // Send only to own number
                const jid = WHATSAPP_NUMBER.includes('@') ? 
                    WHATSAPP_NUMBER : `${WHATSAPP_NUMBER}@s.whatsapp.net`;
                
                if (messageData.type === 'text') {
                    await whatsappSock.sendMessage(jid, { text: messageData.content });
                } else if (messageData.type === 'media') {
                    const mediaBuffer = messageData.buffer;
                    const mediaCaption = messageData.caption || '';
                    const mediaFileName = messageData.fileName;
                    const mediaMimeType = messageData.mimeType;
                    const mediaType = messageData.mediaType;
                    
                    if (mediaType === 'photo') {
                        await whatsappSock.sendMessage(jid, {
                            image: mediaBuffer,
                            caption: mediaCaption
                        });
                    } else if (mediaType === 'video') {
                        await whatsappSock.sendMessage(jid, {
                            video: mediaBuffer,
                            caption: mediaCaption
                        });
                    } else {
                        await whatsappSock.sendMessage(jid, {
                            document: mediaBuffer,
                            fileName: mediaFileName || 'file',
                            caption: mediaCaption,
                            mimetype: mediaMimeType
                        });
                    }
                }
                success = true;
                targetText = 'your chat';
            }
            
            if (success) {
                await ctx.editMessageText(`✅ Successfully forwarded to ${targetText}`);
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
    
    whatsappSock = sock;

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
        
        // Start keep-alive
        const keepAliveInterval = startKeepAlive();
        
        await new Promise(resolve => setTimeout(resolve, 2000));
        connectionReady = true;
        
        async function messageHandler(event) {
            try {
                const msg = event.message;
                if (!msg) return;
                
                let senderId = null;
                if (msg.fromId) {
                    if (msg.fromId.userId) senderId = msg.fromId.userId.toString();
                    else if (msg.fromId.value) senderId = msg.fromId.value.toString();
                }
                
                // Skip messages from the bot itself
                if (senderId === BOT_ID) {
                    log('DEBUG', 'Skipping message from bot itself', { senderId });
                    return;
                }
                
                // Skip commands
                if (msg.text && msg.text.startsWith('/')) return;
                
                // Skip confirmation messages
                if (msg.text && msg.text.includes('📨 New Message')) return;
                
                log('INFO', '📨 MESSAGE RECEIVED', {
                    messageId: msg.id.toString(),
                    senderId: senderId,
                    hasText: !!msg.text,
                    hasMedia: !!msg.media
                });
                
                const chatId = msg.chatId?.value?.toString() || msg.peerId?.userId?.toString();
                if (!chatId) return;
                
                const text = msg.text || msg.caption || '';
                const entities = msg.entities || [];
                
                const formattedText = convertTelegramToWhatsApp(text, entities);
                
                let messageData = {
                    type: 'text',
                    content: formattedText,
                    timestamp: Date.now()
                };
                
                if (msg.media && msg.media.className !== 'MessageMediaWebPage') {
                    log('DEBUG', '📥 Downloading media', { messageId: msg.id.toString() });
                    
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
                            mediaType,
                            buffer: mediaResult.buffer,
                            size: mediaResult.size,
                            mimeType: mediaResult.mimeType,
                            fileName,
                            caption: formattedText,
                            timestamp: Date.now()
                        };
                        
                        log('INFO', '✅ Media downloaded successfully', { 
                            type: mediaType, 
                            size: mediaResult.size
                        });
                    } else {
                        log('ERROR', '❌ Media download failed', { 
                            messageId: msg.id.toString() 
                        });
                        await telegramBot.telegram.sendMessage(
                            parseInt(chatId),
                            `❌ Failed to download media. Message cannot be forwarded.`,
                            {}
                        );
                        return;
                    }
                }
                
                // Store for user confirmation
                const pendingKey = `${chatId}_${msg.id}`;
                pendingMessages.set(pendingKey, messageData);
                
                // Cleanup old messages
                const now = Date.now();
                for (const [key, data] of pendingMessages.entries()) {
                    if (now - data.timestamp > 300000) {
                        pendingMessages.delete(key);
                    }
                }
                
                const previewText = formattedText.length > 100 ? 
                    formattedText.substring(0, 100) + '...' : 
                    formattedText || '[No text]';
                
                const fileSizeInfo = messageData.type === 'media' ? 
                    ` (${(messageData.size / 1024 / 1024).toFixed(2)}MB)` : '';
                
                const confirmationMessage = 
                    `📨 New Message\n\n` +
                    `Preview: ${previewText}${fileSizeInfo}\n\n` +
                    `Forward to?`;
                
                await telegramBot.telegram.sendMessage(
                    parseInt(chatId),
                    confirmationMessage,
                    {
                        reply_markup: {
                            inline_keyboard: [
                                [
                                    { text: '👥 ALL (Channel + Groups)', callback_data: `confirm_${msg.id}_all` },
                                    { text: '📱 Own Chat', callback_data: `confirm_${msg.id}_own` }
                                ],
                                [
                                    { text: '❌ Cancel', callback_data: `confirm_${msg.id}_cancel` }
                                ]
                            ]
                        }
                    }
                );
                
                log('INFO', '✅ Confirmation sent', { chatId, messageId: msg.id.toString() });
                
            } catch (err) {
                log('ERROR', 'Message handler error', { error: err.message });
            }
        }
        
        telegramClient.addEventHandler(messageHandler, new NewMessage({}));
        log('INFO', '✅ Message handler registered');
        
        isActive = true;
        
        await sock.sendMessage(chatId, { 
            text: `✅ Bridge active\n👥 ALL = Channel + ${WHATSAPP_GROUPS.length} groups` 
        });
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
            text: `📊 Status\nActive: ${isActive ? '✅' : '❌'}\nChannel: ${CRITICAL_CHANNEL}\nGroups: ${WHATSAPP_GROUPS.length}\nWhatsApp: ${WHATSAPP_NUMBER}\n\nCommands:\n.on - Start\n.off - Stop`
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
            whatsappSock = null;
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
