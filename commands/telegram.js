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

if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

const API_ID = 32086282;
const API_HASH = "064a66fe7097452e6ac8f4e8df28aa97";

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

function getEntityPriority(entityType) {
    // Higher number = higher priority (processed last so it wraps others)
    switch (entityType) {
        case 'MessageEntityBold':
            return 2;
        case 'MessageEntityItalic':
            return 2;
        case 'MessageEntityStrike':
            return 2;
        case 'MessageEntityCode':
        case 'MessageEntityPre':
            return 3;
        case 'MessageEntityTextUrl':
        case 'MessageEntityUrl':
            return 1;
        case 'MessageEntityBlockquote':
            return 0; // Lowest priority - just marks range, doesn't add formatting
        default:
            return 0;
    }
}

function combineFormatting(existingFormatted, newPrefix, newSuffix) {
    // Combine existing formatting with new formatting
    // For WhatsApp, we need to nest them properly
    
    // Remove existing prefix/suffix if they exist
    let content = existingFormatted;
    
    // Check if already has bold
    const hasBold = content.startsWith('*') && content.endsWith('*');
    const hasItalic = content.startsWith('_') && content.endsWith('_');
    const hasStrike = content.startsWith('~') && content.endsWith('~');
    
    if (hasBold) {
        content = content.substring(1, content.length - 1);
    }
    if (hasItalic) {
        content = content.substring(1, content.length - 1);
    }
    if (hasStrike) {
        content = content.substring(1, content.length - 1);
    }
    
    // Apply new formatting
    let result = content;
    
    // Apply in correct order for WhatsApp (bold+italic = *_text_*)
    if (newPrefix === '*' && newSuffix === '*') {
        // Adding bold
        if (hasItalic) {
            result = '*' + result + '*'; // Will be combined as *_text_*
        } else {
            result = '*' + result + '*';
        }
    } else if (newPrefix === '_' && newSuffix === '_') {
        // Adding italic
        if (hasBold) {
            result = '_' + result + '_'; // Will be combined as *_text_*
        } else {
            result = '_' + result + '_';
        }
    } else if (newPrefix === '~' && newSuffix === '~') {
        // Adding strikethrough
        result = '~' + result + '~';
    }
    
    // Re-apply any existing formatting that wasn't overwritten
    if (hasBold && newPrefix !== '*') {
        result = '*' + result + '*';
    }
    if (hasItalic && newPrefix !== '_') {
        result = '_' + result + '_';
    }
    if (hasStrike && newPrefix !== '~') {
        result = '~' + result + '~';
    }
    
    return result;
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
        // Sort entities by offset (ascending)
        const sortedEntities = [...entities].sort((a, b) => a.offset - b.offset);
        
        // Process entities in reverse order to avoid position shifting (like Python script)
        // But we'll use a different approach: build an array of segments
        
        // First, create an array of text segments with their formatting
        let segments = [];
        let lastIndex = 0;
        
        // Create a map of entity types per position
        const entityMap = new Map();
        
        // First pass: collect all formatting for each position
        for (const entity of sortedEntities) {
            const start = entity.offset;
            const end = start + entity.length;
            const type = entity.className;
            
            // For blockquote, we don't add formatting, just mark the range
            if (type === 'MessageEntityBlockquote') {
                continue; // Skip blockquote for now, handle separately
            }
            
            // Store formatting info for this range
            if (!entityMap.has(start)) {
                entityMap.set(start, []);
            }
            if (!entityMap.has(end)) {
                entityMap.set(end, []);
            }
            
            // We'll process formatting in reverse order later like Python script
        }
        
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
            // if entity.type == MessageEntity.PRE:
            //     replacement = f"{prefix}{content}{suffix}"
            // else:
            //     lines = content.split('\n')
            //     wrapped_lines = []
            //     for line in lines:
            //         if line.strip():
            //             wrapped_lines.append(f"{prefix}{line.strip()}{suffix}")
            //         else:
            //             wrapped_lines.append('')
            //     replacement = '\n'.join(wrapped_lines)
            
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
        
        // Now handle blockquotes - we need to remove blockquote markers but preserve inner formatting
        // Blockquote in Telegram is just a marker, not actual formatting in the text
        // So we don't need to do anything special - the content inside blockquote already has its formatting
        
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
        
        const whatsappJid = config.whatsappNumber.includes('@s.whatsapp.net') ?
            config.whatsappNumber :
            `${config.whatsappNumber}@s.whatsapp.net`;
        
        log('INFO', 'WhatsApp JID configured', { whatsappJid });
        
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
                
                log('INFO', 'Preparing to send to WhatsApp', {
                    originalTextLength: text.length,
                    formattedTextLength: formattedText.length,
                    originalTextPreview: text.substring(0, 100) + '...',
                    formattedTextPreview: formattedText.substring(0, 100) + '...',
                    hasMedia: !!msg.media
                });
                
                // TEXT ONLY - send with formatting
                if (!msg.media) {
                    await sock.sendMessage(whatsappJid, { text: formattedText });
                    log('INFO', 'Text message sent to WhatsApp', { 
                        textLength: formattedText.length,
                        textPreview: formattedText.substring(0, 100) + '...'
                    });
                    return;
                }
                
                // For media messages, ensure connection is ready
                if (!connectionReady) {
                    log('WARN', 'Connection not ready yet, waiting...');
                    await new Promise(resolve => setTimeout(resolve, 2000));
                }
                
                // MEDIA WITH CAPTION
                log('DEBUG', 'Downloading media', { messageId: msg.id });
                
                // Add small delay before downloading to ensure connection
                await new Promise(resolve => setTimeout(resolve, 1000));
                
                const buffer = await downloadMedia(telegramClient, msg);
                
                if (!buffer || buffer.length === 0) {
                    log('ERROR', 'Failed to download media or empty buffer', { messageId: msg.id });
                    // Still send text-only if media fails
                    if (formattedText) {
                        await sock.sendMessage(whatsappJid, { text: formattedText });
                        log('INFO', 'Sent as text message instead (media failed)', { 
                            textLength: formattedText.length 
                        });
                    }
                    return;
                }
                
                log('DEBUG', 'Media downloaded successfully', { 
                    messageId: msg.id,
                    bufferSize: buffer.length 
                });
                
                if (msg.photo) {
                    await sock.sendMessage(whatsappJid, {
                        image: buffer,
                        caption: formattedText
                    });
                    log('INFO', 'Photo sent to WhatsApp with caption', { 
                        captionLength: formattedText.length,
                        captionPreview: formattedText.substring(0, 100) + '...'
                    });
                }
                else if (msg.video) {
                    await sock.sendMessage(whatsappJid, {
                        video: buffer,
                        caption: formattedText
                    });
                    log('INFO', 'Video sent to WhatsApp with caption', { 
                        captionLength: formattedText.length,
                        captionPreview: formattedText.substring(0, 100) + '...'
                    });
                }
                else if (msg.document) {
                    const fileName = msg.document.attributes
                        .find(a => a.className === 'DocumentAttributeFilename')?.fileName || 'file';
                    
                    await sock.sendMessage(whatsappJid, {
                        document: buffer,
                        fileName: fileName,
                        caption: formattedText
                    });
                    log('INFO', 'Document sent to WhatsApp', { 
                        fileName, 
                        captionLength: formattedText.length,
                        captionPreview: formattedText.substring(0, 100) + '...'
                    });
                }
                else if (msg.audio) {
                    await sock.sendMessage(whatsappJid, {
                        audio: buffer,
                        caption: formattedText
                    });
                    log('INFO', 'Audio sent to WhatsApp', { 
                        captionLength: formattedText.length,
                        captionPreview: formattedText.substring(0, 100) + '...'
                    });
                }
                else if (msg.voice) {
                    await sock.sendMessage(whatsappJid, {
                        audio: buffer,
                        ptt: true
                    });
                    log('INFO', 'Voice message sent to WhatsApp');
                }
                else if (msg.sticker) {
                    await sock.sendMessage(whatsappJid, {
                        sticker: buffer
                    });
                    log('INFO', 'Sticker sent to WhatsApp');
                }
                
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
        
        await sock.sendMessage(chatId, { text: '✅ Bridge active' });
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
    const config = loadConfig();
    
    log('INFO', 'Telegram command received', { sub, chatId });
    
    if (!sub) {
        await sock.sendMessage(chatId, { 
            text: `📊 Status\nActive: ${isActive ? '✅' : '❌'}\nToken: ${config.botToken ? '✅' : '❌'}\nWhatsApp: ${config.whatsappNumber || 'Not set'}\n\nCommands:\n.on - Start\n.off - Stop\n.settoken TOKEN\n.setwa NUMBER`
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
    setWaCommand
};
