const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { NewMessage } = require('telegram/events');
const fs = require('fs');
const path = require('path');

const CONFIG_FILE = path.join(process.cwd(), 'data', 'telegram_bridge.json');
const TEMP_DIR = path.join(process.cwd(), 'temp');
let telegramClient = null;
let isActive = false;
let connectionReady = false;

// Store pending messages for confirmation
const pendingMessages = new Map();

if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

const API_ID = 32086282;
const API_HASH = "064a66fe7097452e6ac8f4e8df28aa97";

// WhatsApp Configuration from Python script
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
    // Also write to file for persistent logging
    const logDir = path.join(process.cwd(), 'logs');
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
    fs.appendFileSync(
        path.join(logDir, 'telegram_bridge.log'),
        logMessage + (data ? '\n' + JSON.stringify(data) : '') + '\n'
    );
}

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

async function downloadMedia(client, message) {
    try {
        // Skip if it's a webpage/media that doesn't have downloadable content
        if (message.media?.className === 'MessageMediaWebPage') {
            log('DEBUG', 'Skipping webpage media (no downloadable content)', { messageId: message.id });
            return null;
        }
        
        // Add small delay to ensure connection is stable
        await new Promise(resolve => setTimeout(resolve, 500));
        
        const tempFile = path.join(TEMP_DIR, `tg_${message.id}`);
        
        // Ensure temp directory exists
        if (!fs.existsSync(TEMP_DIR)) {
            fs.mkdirSync(TEMP_DIR, { recursive: true });
        }
        
        // Download with explicit error handling
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
            
            // Wait and retry once
            await new Promise(resolve => setTimeout(resolve, 1000));
            await client.downloadMedia(message, { outputFile: tempFile });
        }
        
        // Check if file exists and has content
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
        fs.unlinkSync(tempFile); // Clean up temp file
        return buffer;
    } catch (error) {
        log('ERROR', 'Media download failed', { 
            messageId: message.id,
            error: error.message,
            mediaType: message.media?.className
        });
        
        // Clean up temp file if it exists
        try {
            const tempFile = path.join(TEMP_DIR, `tg_${message.id}`);
            if (fs.existsSync(tempFile)) {
                fs.unlinkSync(tempFile);
            }
        } catch (cleanupError) {
            // Ignore cleanup errors
        }
        
        return null;
    }
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
    // Python: lines = content.split('\n')
    const lines = content.split('\n');
    const wrappedLines = [];
    
    // Python: for line in lines:
    for (const line of lines) {
        // Python: if line.strip(): - Only wrap non-empty lines
        if (line.trim()) {
            // Python: f"{prefix}{line.strip()}{suffix}" - Wrap trimmed line
            wrappedLines.push(prefix + line.trim() + suffix);
        } else {
            // Python: Preserve empty lines
            wrappedLines.push('');
        }
    }
    
    // Python: return '\n'.join(wrapped_lines)
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
    // We'll rely on entities to tell us what should be formatted
    let cleanText = text;
    
    // Remove bold markers
    cleanText = cleanText.replace(/\*\*/g, '');
    // Remove italic markers  
    cleanText = cleanText.replace(/__/g, '');
    // Remove strikethrough markers
    cleanText = cleanText.replace(/~~/g, '');
    // Remove code markers
    cleanText = cleanText.replace(/`/g, '');
    
    log('DEBUG', 'Removed markdown symbols', {
        original: text,
        cleaned: cleanText
    });
    
    // If we have entities, use them for accurate formatting
    if (entities && entities.length > 0) {
        // Python-style: Sort entities by offset in reverse order
        const reversedEntities = [...entities].sort((a, b) => b.offset - a.offset);
        
        // Convert text to array for manipulation (like Python's text_list)
        let textArray = cleanText.split('');
        
        // Process each entity type with line-by-line wrapping (like Python)
        for (const entity of reversedEntities) {
            const start = entity.offset;
            const end = start + entity.length;
            const type = entity.className;
            
            // Skip blockquote - we handle it separately (just remove the markers)
            if (type === 'MessageEntityBlockquote') {
                continue;
            }
            
            // Get the content for this entity
            const content = cleanText.substring(start, end);
            
            // Determine prefix and suffix based on entity type
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
                    continue; // Skip other types
            }
            
            // EXACT Python line-by-line wrapping logic
            let replacement;
            if (type === 'MessageEntityPre') {
                // PRE formatting - wrap entire content
                replacement = prefix + content + suffix;
            } else {
                // For other types, process line by line
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
            
            // Replace the original section in textArray
            // Since we're processing in reverse order, indices won't shift for earlier entities
            textArray.splice(start, end - start, replacement);
        }
        
        // Join the array back into a string
        let result = textArray.join('');
        
        // Apply EXACT Python cleanup function
        const cleanedResult = cleanWhitespace(result);
        
        log('INFO', 'Final formatted text', {
            originalLength: text.length,
            finalLength: cleanedResult.length,
            formatted: cleanedResult
        });
        
        return cleanedResult;
    }
    
    // Fallback to regex if no entities available
    log('DEBUG', 'No entities found, using regex fallback');
    
    // Convert Telegram markdown to WhatsApp format
    let formatted = text;
    formatted = formatted.replace(/\*\*(.*?)\*\*/g, '*$1*');     // Bold
    formatted = formatted.replace(/__(.*?)__/g, '_$1_');        // Italic
    formatted = formatted.replace(/~~(.*?)~~/g, '~$1~');        // Strikethrough
    formatted = formatted.replace(/`(.*?)`/g, '```$1```');      // Code
    
    // Apply EXACT Python cleanup function
    formatted = cleanWhitespace(formatted);
    
    log('INFO', 'Final formatted text (regex method)', {
        original: text,
        formatted: formatted
    });
    
    return formatted;
}

async function sendToWhatsApp(sock, messageData, targetType) {
    try {
        const config = loadConfig();
        if (!config.whatsappNumber) {
            log('ERROR', 'WhatsApp number not configured');
            return false;
        }
        
        const whatsappJid = config.whatsappNumber.includes('@s.whatsapp.net') ?
            config.whatsappNumber :
            `${config.whatsappNumber}@s.whatsapp.net`;
        
        let targets = [];
        
        // Determine targets based on user choice
        switch (targetType) {
            case 'own':
                targets = [whatsappJid];
                break;
            case 'group':
                // Add all WhatsApp groups from Python script
                targets = WHATSAPP_GROUPS.map(group => 
                    group.includes('@g.us') ? group : `${group}@g.us`
                );
                break;
            case 'cancel':
                log('INFO', 'Message sending cancelled by user');
                return false;
            default:
                log('ERROR', 'Invalid target type', { targetType });
                return false;
        }
        
        log('INFO', `Sending to ${targets.length} targets`, { targetType });
        
        // Send to each target
        for (const target of targets) {
            if (messageData.type === 'text') {
                await sock.sendMessage(target, { text: messageData.content });
                log('INFO', 'Text message sent to WhatsApp', { 
                    target,
                    textLength: messageData.content.length 
                });
            } else if (messageData.type === 'media') {
                if (messageData.mediaType === 'photo') {
                    await sock.sendMessage(target, {
                        image: messageData.buffer,
                        caption: messageData.caption
                    });
                } else if (messageData.mediaType === 'video') {
                    await sock.sendMessage(target, {
                        video: messageData.buffer,
                        caption: messageData.caption
                    });
                } else if (messageData.mediaType === 'document') {
                    await sock.sendMessage(target, {
                        document: messageData.buffer,
                        fileName: messageData.fileName,
                        caption: messageData.caption
                    });
                } else if (messageData.mediaType === 'audio') {
                    await sock.sendMessage(target, {
                        audio: messageData.buffer,
                        caption: messageData.caption
                    });
                } else if (messageData.mediaType === 'voice') {
                    await sock.sendMessage(target, {
                        audio: messageData.buffer,
                        ptt: true
                    });
                } else if (messageData.mediaType === 'sticker') {
                    await sock.sendMessage(target, {
                        sticker: messageData.buffer
                    });
                }
                log('INFO', `${messageData.mediaType} sent to WhatsApp`, { target });
            }
        }
        
        return true;
    } catch (error) {
        log('ERROR', 'Failed to send to WhatsApp', { error: error.message });
        return false;
    }
}

async function handleConfirmation(sock, chatId, messageId, userChoice) {
    const pendingKey = `${chatId}_${messageId}`;
    const messageData = pendingMessages.get(pendingKey);
    
    if (!messageData) {
        log('ERROR', 'No pending message found', { chatId, messageId });
        await sock.sendMessage(chatId, { text: '❌ This message has expired or already processed.' });
        return;
    }
    
    // Remove from pending
    pendingMessages.delete(pendingKey);
    
    // Handle cancel
    if (userChoice === 'cancel') {
        await sock.sendMessage(chatId, { text: '❌ Message sending cancelled.' });
        return;
    }
    
    // Send to WhatsApp
    const success = await sendToWhatsApp(sock, messageData, userChoice);
    
    if (success) {
        const targetText = userChoice === 'own' ? 'your own chat' : 'all groups';
        await sock.sendMessage(chatId, { text: `✅ Message forwarded to WhatsApp (${targetText})` });
    } else {
        await sock.sendMessage(chatId, { text: '❌ Failed to forward message to WhatsApp' });
    }
}

async function startTelegramBot(sock, chatId) {
    const config = loadConfig();
    
    log('INFO', 'Starting Telegram bot', { chatId, hasToken: !!config.botToken, hasNumber: !!config.whatsappNumber });
    
    if (!config.botToken) {
        await sock.sendMessage(chatId, { text: '❌ Set bot token first: `.settoken TOKEN`' });
        return false;
    }
    
    if (!config.whatsappNumber) {
        await sock.sendMessage(chatId, { text: '❌ Set WhatsApp number first: `.setwa NUMBER`' });
        return false;
    }

    try {
        if (telegramClient) await telegramClient.disconnect();
        
        telegramClient = new TelegramClient(new StringSession(""), API_ID, API_HASH, {
            connectionRetries: 5,
            downloadRetries: 3
        });
        
        await telegramClient.start({ botAuthToken: config.botToken });
        log('INFO', 'Telegram client connected successfully');
        
        // Wait a moment for connection to stabilize
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
                
                log('INFO', 'New message received', {
                    messageId: msg.id,
                    fromId: msg.fromId?.userId,
                    hasText: !!msg.text,
                    textLength: msg.text?.length || 0,
                    hasMedia: !!msg.media,
                    mediaType: msg.media?.className
                });
                
                // Skip commands
                if (msg.text && msg.text.startsWith('/')) {
                    log('DEBUG', 'Skipping command message', { text: msg.text });
                    return;
                }
                
                // Get message text and entities
                const text = msg.text || '';
                const entities = msg.entities || [];
                
                log('DEBUG', 'Message details', {
                    rawText: text,
                    rawTextLength: text.length,
                    entityCount: entities.length
                });
                
                // Convert formatting for WhatsApp
                const formattedText = convertTelegramToWhatsApp(text, entities);
                
                log('INFO', 'Preparing message for confirmation', {
                    originalTextLength: text.length,
                    formattedTextLength: formattedText.length,
                    hasMedia: !!msg.media
                });
                
                // Prepare message data for pending storage
                let messageData = {
                    type: 'text',
                    content: formattedText,
                    timestamp: Date.now()
                };
                
                // If media, download it
                if (msg.media) {
                    // For media messages, ensure connection is ready
                    if (!connectionReady) {
                        log('WARN', 'Connection not ready yet, waiting...');
                        await new Promise(resolve => setTimeout(resolve, 2000));
                    }
                    
                    log('DEBUG', 'Downloading media for confirmation', { messageId: msg.id });
                    
                    // Add small delay before downloading
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    
                    const buffer = await downloadMedia(telegramClient, msg);
                    
                    if (!buffer || buffer.length === 0) {
                        log('ERROR', 'Failed to download media', { messageId: msg.id });
                        await sock.sendMessage(chatId, { 
                            text: '❌ Failed to download media. Please try again.' 
                        });
                        return;
                    }
                    
                    // Prepare media message data
                    messageData = {
                        type: 'media',
                        mediaType: msg.photo ? 'photo' : 
                                   msg.video ? 'video' :
                                   msg.document ? 'document' :
                                   msg.audio ? 'audio' :
                                   msg.voice ? 'voice' :
                                   msg.sticker ? 'sticker' : 'unknown',
                        buffer: buffer,
                        caption: formattedText,
                        timestamp: Date.now()
                    };
                    
                    if (msg.document) {
                        messageData.fileName = msg.document.attributes
                            .find(a => a.className === 'DocumentAttributeFilename')?.fileName || 'file';
                    }
                }
                
                // Store in pending messages
                const pendingKey = `${chatId}_${msg.id}`;
                pendingMessages.set(pendingKey, messageData);
                
                // Auto-cleanup old pending messages (older than 5 minutes)
                const now = Date.now();
                for (const [key, data] of pendingMessages.entries()) {
                    if (now - data.timestamp > 300000) { // 5 minutes
                        pendingMessages.delete(key);
                    }
                }
                
                // Create inline keyboard for confirmation
                const keyboard = [
                    [
                        { text: '📱 Own Chat', callbackData: `confirm_${msg.id}_own` },
                        { text: '👥 Groups', callbackData: `confirm_${msg.id}_group` }
                    ],
                    [
                        { text: '❌ Cancel', callbackData: `confirm_${msg.id}_cancel` }
                    ]
                ];
                
                // Send confirmation message with preview
                const previewText = formattedText.length > 100 ? 
                    formattedText.substring(0, 100) + '...' : 
                    formattedText;
                
                const confirmationMessage = 
                    `📨 *New message received*\n\n` +
                    `Preview:\n${previewText}\n\n` +
                    `Type: ${msg.media ? 'Media with caption' : 'Text'}\n` +
                    `Length: ${formattedText.length} characters\n\n` +
                    `Where would you like to forward this to WhatsApp?`;
                
                await sock.sendMessage(chatId, {
                    text: confirmationMessage,
                    buttons: keyboard
                });
                
                log('INFO', 'Confirmation request sent to user', { 
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
        config.active = true;
        saveConfig(config);
        
        await sock.sendMessage(chatId, { text: '✅ Bridge active - You will be asked for confirmation before forwarding to WhatsApp' });
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

async function handleButtonClick(sock, buttonData, chatId) {
    try {
        // Button data format: confirm_messageId_target
        const parts = buttonData.split('_');
        if (parts.length !== 3 || parts[0] !== 'confirm') {
            log('ERROR', 'Invalid button data', { buttonData });
            return;
        }
        
        const messageId = parts[1];
        const target = parts[2];
        
        await handleConfirmation(sock, chatId, messageId, target);
        
    } catch (error) {
        log('ERROR', 'Button handler error', { error: error.message });
        await sock.sendMessage(chatId, { text: '❌ Failed to process your selection' });
    }
}

async function telegramCommand(sock, chatId, message, args) {
    const sub = args[0]?.toLowerCase();
    const config = loadConfig();
    
    log('INFO', 'Telegram command received', { sub, chatId });
    
    if (!sub) {
        await sock.sendMessage(chatId, { 
            text: `📊 Status\nActive: ${isActive ? '✅' : '❌'}\nToken: ${config.botToken ? '✅' : '❌'}\nWhatsApp: ${config.whatsappNumber || 'Not set'}\nGroups: ${WHATSAPP_GROUPS.length}\n\nCommands:\n.on - Start\n.off - Stop\n.settoken TOKEN\n.setwa NUMBER`
        });
        return;
    }
    
    switch (sub) {
        case 'on': case 'start':
            await startTelegramBot(sock, chatId);
            break;
        case 'off': case 'stop':
            if (telegramClient) await telegramClient.disconnect();
            isActive = false;
            connectionReady = false;
            config.active = false;
            saveConfig(config);
            pendingMessages.clear(); // Clear pending messages
            await sock.sendMessage(chatId, { text: '🔴 Stopped' });
            log('INFO', 'Bridge stopped');
            break;
    }
}

async function setTokenCommand(sock, chatId, message, token) {
    if (!token) return await sock.sendMessage(chatId, { text: '❌ Provide token' });
    const config = loadConfig();
    config.botToken = token;
    saveConfig(config);
    log('INFO', 'Token saved', { chatId });
    await sock.sendMessage(chatId, { text: '✅ Token saved' });
}

async function setWaCommand(sock, chatId, message, number) {
    if (!number) return await sock.sendMessage(chatId, { text: '❌ Provide number' });
    const cleanNumber = number.replace(/[^0-9]/g, '');
    const config = loadConfig();
    config.whatsappNumber = cleanNumber;
    saveConfig(config);
    log('INFO', 'WhatsApp number saved', { chatId, number: cleanNumber });
    await sock.sendMessage(chatId, { text: `✅ WhatsApp set: ${cleanNumber}` });
}

module.exports = {
    telegramCommand,
    setTokenCommand,
    setWaCommand,
    handleButtonClick
};
