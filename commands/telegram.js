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
let whatsappSock = null; // Store WhatsApp socket

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
            log('DEBUG', 'Skipping webpage media (no downloadable content)', { messageId: message.id });
            return null;
        }
        
        // Add multiple retry attempts with increasing delays
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
                        if (received % 100000 === 0) { // Log every 100KB
                            log('DEBUG', `Download progress: ${Math.round(received/1024)}KB/${Math.round(total/1024)}KB`, { messageId: message.id });
                        }
                    }
                });
                
                // Check if file exists and has content
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
                
                // Clean up temp file if it exists
                try {
                    const tempFile = path.join(TEMP_DIR, `tg_${message.id}_attempt_${attempt}`);
                    if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
                } catch (cleanupError) {}
                
                // Wait before retry (increasing delay)
                if (attempt < 3) {
                    const delay = attempt * 2000;
                    log('DEBUG', `Waiting ${delay}ms before retry...`, { messageId: message.id });
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            }
        }
        
        // All attempts failed
        log('ERROR', '❌ ALL download attempts failed - media cannot be retrieved', { 
            messageId: message.id,
            lastError: lastError?.message 
        });
        return null;
        
    } catch (error) {
        log('ERROR', 'Media download failed completely', { 
            messageId: message.id,
            error: error.message 
        });
        return null;
    }
}

async function sendToWhatsApp(messageData, targetType) {
    try {
        if (!whatsappSock) {
            log('ERROR', 'WhatsApp socket not available');
            return false;
        }
        
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
        
        let successCount = 0;
        let failedTargets = [];
        
        // For media messages, we already have the buffer - reuse it for all targets
        const mediaBuffer = messageData.type === 'media' ? messageData.buffer : null;
        const mediaCaption = messageData.type === 'media' ? messageData.caption : null;
        const mediaFileName = messageData.type === 'media' ? messageData.fileName : null;
        const mediaMimeType = messageData.type === 'media' ? messageData.mimeType : null;
        const mediaType = messageData.type === 'media' ? messageData.mediaType : null;
        const mediaSize = messageData.type === 'media' ? messageData.size : null;
        
        // Verify media buffer exists for media messages
        if (messageData.type === 'media' && !mediaBuffer) {
            log('ERROR', '❌ Media message has no buffer - cannot send', { messageData });
            return false;
        }
        
        // Send to all targets sequentially with small delay
        for (let i = 0; i < targets.length; i++) {
            const target = targets[i];
            const jid = target.includes('@') ? target : 
                       targetType === 'own' ? `${target}@s.whatsapp.net` : `${target}@g.us`;
            
            try {
                if (messageData.type === 'text') {
                    await whatsappSock.sendMessage(jid, { text: messageData.content });
                    log('INFO', '✅ Text sent', { target: jid, index: i + 1 });
                    successCount++;
                    
                } else if (messageData.type === 'media') {
                    // Use the already downloaded buffer for all targets
                    const fileSizeMB = mediaSize / (1024 * 1024);
                    
                    log('DEBUG', 'Sending media using cached buffer', {
                        type: mediaType,
                        size: `${fileSizeMB.toFixed(2)}MB`,
                        target: jid,
                        bufferSize: mediaBuffer.length
                    });
                    
                    if (fileSizeMB > 100) {
                        await whatsappSock.sendMessage(jid, {
                            document: mediaBuffer,
                            fileName: mediaFileName || 'file.bin',
                            caption: mediaCaption,
                            mimetype: mediaMimeType
                        });
                        log('INFO', '✅ Large file sent as document', { 
                            target: jid, 
                            sizeMB: Math.round(fileSizeMB * 100) / 100 
                        });
                    } else {
                        if (mediaType === 'photo') {
                            await whatsappSock.sendMessage(jid, {
                                image: mediaBuffer,
                                caption: mediaCaption
                            });
                            log('INFO', '✅ Photo sent', { target: jid });
                        } else if (mediaType === 'video') {
                            await whatsappSock.sendMessage(jid, {
                                video: mediaBuffer,
                                caption: mediaCaption
                            });
                            log('INFO', '✅ Video sent', { target: jid });
                        } else if (mediaType === 'document') {
                            await whatsappSock.sendMessage(jid, {
                                document: mediaBuffer,
                                fileName: mediaFileName,
                                caption: mediaCaption,
                                mimetype: mediaMimeType
                            });
                            log('INFO', '✅ Document sent', { target: jid });
                        } else if (mediaType === 'audio') {
                            await whatsappSock.sendMessage(jid, {
                                audio: mediaBuffer,
                                caption: mediaCaption
                            });
                            log('INFO', '✅ Audio sent', { target: jid });
                        } else if (mediaType === 'voice') {
                            await whatsappSock.sendMessage(jid, {
                                audio: mediaBuffer,
                                ptt: true
                            });
                            log('INFO', '✅ Voice sent', { target: jid });
                        } else if (mediaType === 'sticker') {
                            await whatsappSock.sendMessage(jid, {
                                sticker: mediaBuffer
                            });
                            log('INFO', '✅ Sticker sent', { target: jid });
                        }
                    }
                    successCount++;
                }
                
                // Small delay between sends (1 second) to avoid rate limiting
                if (i < targets.length - 1) {
                    log('DEBUG', `Waiting 1 second before next send...`);
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
                
            } catch (err) {
                log('ERROR', `Failed to send to ${jid}`, { error: err.message });
                failedTargets.push(jid);
                
                // Still wait before next attempt even if this one failed
                if (i < targets.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
            }
        }
        
        if (failedTargets.length > 0) {
            log('WARN', `Failed to send to ${failedTargets.length} targets`, { failedTargets });
            return false;
        }
        
        log('INFO', `✅ Successfully sent to all ${targets.length} targets`);
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
            
            await ctx.answerCbQuery('⏳ Processing...');
            pendingMessages.delete(pendingKey);
            
            if (target === 'cancel') {
                await ctx.editMessageText('❌ Cancelled.');
                return;
            }
            
            const success = await sendToWhatsApp(messageData, target);
            
            if (success) {
                const targetText = target === 'own' ? 'your chat' : `${WHATSAPP_GROUPS.length} groups`;
                await ctx.editMessageText(`✅ Successfully forwarded to ${targetText}`);
            } else {
                await ctx.editMessageText('❌ Failed to forward to some targets');
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
    
    // Store WhatsApp socket
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
                if (msg.text && msg.text.includes('📨 New Message')) {
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
                
                // Handle media if present - MUST download successfully or we don't proceed
                if (msg.media && msg.media.className !== 'MessageMediaWebPage') {
                    log('DEBUG', '📥 Downloading media (MUST succeed)', { messageId: msg.id.toString() });
                    
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
                            size: mediaResult.size,
                            bufferSize: mediaResult.buffer.length
                        });
                    } else {
                        // CRITICAL: Media download failed - DO NOT PROCEED
                        log('ERROR', '❌ Media download failed - message will NOT be forwarded', { 
                            messageId: msg.id.toString() 
                        });
                        
                        // Notify user that media couldn't be downloaded
                        await telegramBot.telegram.sendMessage(
                            parseInt(chatId),
                            `❌ Failed to download media from Telegram. The message will NOT be forwarded to WhatsApp.`,
                            {}
                        );
                        
                        // Skip this message entirely
                        return;
                    }
                }
                
                // Store in pending messages using chatId
                const pendingKey = `${chatId}_${msg.id}`;
                pendingMessages.set(pendingKey, messageData);
                log('INFO', 'Message stored in pending', { pendingKey });
                
                // Cleanup old messages
                const now = Date.now();
                for (const [key, data] of pendingMessages.entries()) {
                    if (now - data.timestamp > 300000) { // 5 minutes
                        pendingMessages.delete(key);
                    }
                }
                
                // Create preview
                const previewText = formattedText.length > 100 ? 
                    formattedText.substring(0, 100) + '...' : 
                    formattedText || '[No text]';
                
                const fileSizeInfo = messageData.type === 'media' ? 
                    ` (${(messageData.size / 1024 / 1024).toFixed(2)}MB)` : '';
                
                // Simple plain text message
                const confirmationMessage = 
                    `📨 New Message\n\n` +
                    `Preview: ${previewText}${fileSizeInfo}\n\n` +
                    `Forward to?`;
                
                log('INFO', 'Sending confirmation', { chatId });
                
                // Send confirmation back to the same chat
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
