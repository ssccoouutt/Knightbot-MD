const axios = require('axios');
const { downloadContentFromMessage } = require('@whiskeysockets/baileys');

// Logger function with timestamps
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
}

async function channelCommand(sock, chatId, message, args) {
    const startTime = Date.now();
    const debug = {
        command: 'channel',
        chatId: chatId.toString(),
        timestamp: new Date().toISOString(),
        steps: [],
        errors: []
    };
    
    try {
        const channelJid = '120363405181626845@newsletter';
        debug.channelJid = channelJid;
        log('INFO', '🚀 Channel command started', { chatId, channelJid });
        
        // Get the full message object
        const fullMessage = message.message;
        debug.hasFullMessage = !!fullMessage;
        debug.messageType = fullMessage ? Object.keys(fullMessage)[0] : 'none';
        log('DEBUG', 'Message object', { 
            hasFullMessage: !!fullMessage,
            messageType: debug.messageType
        });
        
        const messageText = args.join(' ').trim();
        debug.messageText = messageText;
        debug.messageTextLength = messageText.length;
        log('DEBUG', 'Message text', { text: messageText, length: messageText.length });
        
        // Check for quoted media FIRST
        const quotedMessage = fullMessage?.extendedTextMessage?.contextInfo?.quotedMessage;
        debug.hasQuotedMessage = !!quotedMessage;
        debug.quotedType = quotedMessage ? Object.keys(quotedMessage)[0] : 'none';
        log('DEBUG', 'Quoted message check', { 
            hasQuotedMessage: !!quotedMessage,
            quotedType: debug.quotedType
        });
        
        // If there's quoted media
        if (quotedMessage) {
            debug.steps.push('processing_quoted_media');
            log('INFO', '📎 Processing quoted media', { 
                quotedType: debug.quotedType,
                hasCaption: !!messageText
            });
            
            // Send typing indicator
            await sock.sendPresenceUpdate('composing', channelJid);
            debug.steps.push('sent_typing_indicator');
            
            let finalMessage = {};
            
            // Handle different media types from quoted message
            if (quotedMessage.imageMessage) {
                debug.mediaType = 'image';
                log('INFO', '📸 Downloading quoted image', { 
                    mimetype: quotedMessage.imageMessage.mimetype,
                    fileLength: quotedMessage.imageMessage.fileLength,
                    caption: messageText
                });
                
                // Download image
                const stream = await downloadContentFromMessage(quotedMessage.imageMessage, 'image');
                const buffer = [];
                for await (const chunk of stream) {
                    buffer.push(chunk);
                }
                const imageBuffer = Buffer.concat(buffer);
                debug.imageSize = imageBuffer.length;
                debug.imageSizeMB = (imageBuffer.length / (1024 * 1024)).toFixed(2);
                log('DEBUG', 'Image downloaded', { 
                    size: imageBuffer.length,
                    sizeMB: debug.imageSizeMB
                });
                
                finalMessage = {
                    image: imageBuffer,
                    caption: messageText,
                    mimetype: quotedMessage.imageMessage.mimetype
                };
                
                log('INFO', '📤 Attempting to send image to channel', { 
                    captionLength: messageText.length,
                    mimeType: quotedMessage.imageMessage.mimetype,
                    imageSize: imageBuffer.length,
                    imageSizeMB: debug.imageSizeMB
                });
                
                try {
                    const sendResult = await sock.sendMessage(channelJid, finalMessage);
                    debug.sendResult = !!sendResult;
                    log('INFO', '✅ sendMessage executed successfully', { 
                        sendResult: !!sendResult,
                        timestamp: new Date().toISOString()
                    });
                } catch (sendError) {
                    debug.sendError = {
                        message: sendError.message,
                        stack: sendError.stack
                    };
                    log('ERROR', '❌ sendMessage threw error', { 
                        error: sendError.message,
                        stack: sendError.stack
                    });
                    throw sendError;
                }
                
                debug.steps.push('sent_to_channel');
                
                const timeTaken = Date.now() - startTime;
                log('INFO', '✅ Image send attempted', { 
                    timeTaken: `${timeTaken}ms`,
                    imageSize: imageBuffer.length,
                    imageSizeMB: debug.imageSizeMB,
                    caption: messageText.substring(0, 50)
                });
                
                // Verify the message was actually sent by trying to check
                try {
                    // Try to send a test text to confirm channel still works
                    await sock.sendMessage(channelJid, { text: '✅' });
                    log('INFO', '✅ Channel still accepting messages (test text sent)');
                } catch (testError) {
                    log('ERROR', '❌ Channel not accepting ANY messages!', { 
                        error: testError.message 
                    });
                }
                
                await sock.sendMessage(chatId, { 
                    text: `✅ Image sent to channel with caption: ${messageText || '(no caption)'}\n(Check if actually appeared)` 
                });
                return;
            }
            // ... rest of media types same pattern ...
        }
        
        // Handle text only
        else if (messageText) {
            debug.steps.push('processing_text_only');
            log('INFO', '📝 Processing text-only message', { 
                textLength: messageText.length,
                preview: messageText.substring(0, 100)
            });
            
            await sock.sendPresenceUpdate('composing', channelJid);
            debug.steps.push('sent_typing_indicator');
            
            const finalMessage = {
                text: messageText
            };
            
            log('INFO', '📤 Sending text to channel');
            await sock.sendMessage(channelJid, finalMessage);
            debug.steps.push('sent_to_channel');
            
            const timeTaken = Date.now() - startTime;
            log('INFO', '✅ Text sent successfully', { 
                timeTaken: `${timeTaken}ms`,
                textLength: messageText.length
            });
            
            await sock.sendMessage(chatId, { 
                text: `✅ Message sent to channel:\n\n${messageText}` 
            });
            return;
        }
        
        // ... rest of code ...

    } catch (error) {
        debug.errors.push({
            message: error.message,
            stack: error.stack,
            step: debug.steps[debug.steps.length - 1] || 'unknown'
        });
        
        log('ERROR', '❌ Channel command failed', {
            error: error.message,
            stack: error.stack,
            debug: debug
        });
        
        await sock.sendMessage(chatId, { 
            text: '❌ Failed to send to channel. Error: ' + error.message 
        });
    } finally {
        const totalTime = Date.now() - startTime;
        log('INFO', '📊 Channel command completed', {
            totalTime: `${totalTime}ms`,
            steps: debug.steps,
            errorCount: debug.errors.length
        });
    }
}

module.exports = channelCommand;
