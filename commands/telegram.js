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
        const tempFile = path.join(TEMP_DIR, `tg_${message.id}`);
        await client.downloadMedia(message, { outputFile: tempFile });
        
        // Check if file exists before reading
        if (!fs.existsSync(tempFile)) {
            log('ERROR', 'Media file not created', { messageId: message.id });
            return null;
        }
        
        const buffer = fs.readFileSync(tempFile);
        fs.unlinkSync(tempFile); // Clean up temp file
        return buffer;
    } catch (error) {
        log('ERROR', 'Media download failed', { 
            messageId: message.id,
            error: error.message 
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

function cleanWhitespace(text) {
    if (!text) return text;
    
    // Don't trim the entire text - preserve leading/trailing whitespace
    // Only collapse multiple spaces/tabs to single space (but preserve intentional spaces)
    text = text.replace(/[ \t]{2,}/g, ' ');
    
    // Reduce multiple newlines to max 2
    text = text.replace(/\n{3,}/g, '\n\n');
    
    return text;
}

function wrapLines(content, prefix, suffix) {
    // Only wraps non-empty lines, preserves empty lines
    // Preserves original whitespace within lines (don't trim)
    
    const lines = content.split('\n');
    const wrappedLines = [];
    
    for (const line of lines) {
        if (line.trim()) {
            // Only wrap non-empty lines, but preserve original line content including spaces
            wrappedLines.push(prefix + line + suffix);
        } else {
            // Preserve empty lines
            wrappedLines.push('');
        }
    }
    
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
            return 0;
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
        // First, identify blockquote ranges to skip formatting inside them
        const blockquoteRanges = [];
        for (const entity of entities) {
            if (entity.className === 'MessageEntityBlockquote') {
                blockquoteRanges.push({
                    start: entity.offset,
                    end: entity.offset + entity.length
                });
            }
        }
        
        // Sort entities by priority (higher priority last) and then by offset
        const sortedEntities = [...entities].sort((a, b) => {
            const priorityA = getEntityPriority(a.className);
            const priorityB = getEntityPriority(b.className);
            if (priorityA !== priorityB) {
                return priorityA - priorityB;
            }
            return a.offset - b.offset;
        });
        
        // Create a map to store formatted content at each position range
        const formattedMap = new Map();
        
        // First pass: apply all formatting to their respective ranges
        for (const entity of sortedEntities) {
            const start = entity.offset;
            const end = start + entity.length;
            
            // Check if this entity is inside a blockquote
            const isInBlockquote = blockquoteRanges.some(range => 
                start >= range.start && end <= range.end
            );
            
            // Skip formatting entities that are inside blockquotes
            if (isInBlockquote && entity.className !== 'MessageEntityBlockquote') {
                log('DEBUG', 'Skipping entity inside blockquote', {
                    type: entity.className,
                    start,
                    end
                });
                continue;
            }
            
            const rangeKey = `${start}_${end}`;
            const content = cleanText.substring(start, end);
            
            log('DEBUG', 'Processing entity for combination', {
                type: entity.className,
                start,
                end,
                content
            });
            
            let formattedContent = content;
            
            // Get existing formatting for this range if any
            if (formattedMap.has(rangeKey)) {
                formattedContent = formattedMap.get(rangeKey);
            }
            
            // Apply new formatting based on entity type
            switch (entity.className) {
                case 'MessageEntityBold':
                    formattedContent = combineFormatting(formattedContent, '*', '*');
                    log('INFO', 'Applied/Combined BOLD formatting', { 
                        content,
                        result: formattedContent
                    });
                    break;
                    
                case 'MessageEntityItalic':
                    formattedContent = combineFormatting(formattedContent, '_', '_');
                    log('INFO', 'Applied/Combined ITALIC formatting', { 
                        content,
                        result: formattedContent
                    });
                    break;
                    
                case 'MessageEntityStrike':
                    formattedContent = combineFormatting(formattedContent, '~', '~');
                    log('INFO', 'Applied/Combined STRIKETHROUGH formatting', { 
                        content,
                        result: formattedContent
                    });
                    break;
                    
                case 'MessageEntityCode':
                case 'MessageEntityPre':
                    // Code blocks override other formatting
                    formattedContent = '```' + content + '```';
                    log('INFO', 'Applied CODE formatting (overrides others)', { 
                        content,
                        result: formattedContent
                    });
                    break;
                    
                case 'MessageEntityBlockquote':
                    // Blockquote - just use plain text (no formatting)
                    formattedContent = content;
                    log('INFO', 'Keeping BLOCKQUOTE as plain text', { 
                        content
                    });
                    break;
                    
                case 'MessageEntityTextUrl':
                case 'MessageEntityUrl':
                    // URLs: keep as plain text
                    formattedContent = content;
                    log('INFO', 'Keeping URL as plain text', { content });
                    break;
                    
                default:
                    log('WARN', 'Unknown entity type', { type: entity.className });
                    formattedContent = content;
                    break;
            }
            
            formattedMap.set(rangeKey, formattedContent);
        }
        
        // Second pass: build the final result in order
        let result = '';
        let lastIndex = 0;
        
        // Get all unique ranges in order
        const sortedRanges = [...formattedMap.keys()]
            .map(key => {
                const [start, end] = key.split('_').map(Number);
                return { start, end, key };
            })
            .sort((a, b) => a.start - b.start);
        
        for (const range of sortedRanges) {
            // Add text before this range
            if (range.start > lastIndex) {
                result += cleanText.substring(lastIndex, range.start);
            }
            
            // Add formatted content for this range
            result += formattedMap.get(range.key);
            lastIndex = range.end;
        }
        
        // Add any remaining text after the last range
        if (lastIndex < cleanText.length) {
            result += cleanText.substring(lastIndex);
        }
        
        // Apply whitespace cleanup (but preserve trailing whitespace)
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
    
    // Apply whitespace cleanup (preserve trailing)
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
            connectionRetries: 5
        });
        
        await telegramClient.start({ botAuthToken: config.botToken });
        log('INFO', 'Telegram client connected successfully');
        
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
                
                // MEDIA WITH CAPTION
                log('DEBUG', 'Downloading media', { messageId: msg.id });
                const buffer = await downloadMedia(telegramClient, msg);
                
                if (!buffer || buffer.length === 0) {
                    log('ERROR', 'Failed to download media or empty buffer', { messageId: msg.id });
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
