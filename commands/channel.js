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
        log('DEBUG', 'Message object', { 
            hasFullMessage: !!fullMessage,
            messageType: fullMessage ? Object.keys(fullMessage)[0] : 'none'
        });
        
        const messageText = args.join(' ').trim();
        debug.messageText = messageText;
        debug.messageTextLength = messageText.length;
        log('DEBUG', 'Message text', { text: messageText, length: messageText.length });
        
        // Check for quoted media FIRST
        const quotedMessage = fullMessage?.extendedTextMessage?.contextInfo?.quotedMessage;
        debug.hasQuotedMessage = !!quotedMessage;
        log('DEBUG', 'Quoted message check', { 
            hasQuotedMessage: !!quotedMessage,
            quotedType: quotedMessage ? Object.keys(quotedMessage)[0] : 'none'
        });
        
        // If there's quoted media
        if (quotedMessage) {
            debug.steps.push('processing_quoted_media');
            log('INFO', '📎 Processing quoted media', { 
                quotedType: Object.keys(quotedMessage)[0],
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
                    fileLength: quotedMessage.imageMessage.fileLength
                });
                
                // Download image
                const stream = await downloadContentFromMessage(quotedMessage.imageMessage, 'image');
                const buffer = [];
                for await (const chunk of stream) {
                    buffer.push(chunk);
                }
                const imageBuffer = Buffer.concat(buffer);
                debug.imageSize = imageBuffer.length;
                log('DEBUG', 'Image downloaded', { size: imageBuffer.length });
                
                finalMessage = {
                    image: imageBuffer,
                    caption: messageText,
                    mimetype: quotedMessage.imageMessage.mimetype
                };
                
                log('INFO', '📤 Sending image to channel', { 
                    captionLength: messageText.length,
                    mimeType: quotedMessage.imageMessage.mimetype
                });
                await sock.sendMessage(channelJid, finalMessage);
                debug.steps.push('sent_to_channel');
                
                const timeTaken = Date.now() - startTime;
                log('INFO', '✅ Image sent successfully', { 
                    timeTaken: `${timeTaken}ms`,
                    imageSize: imageBuffer.length,
                    caption: messageText.substring(0, 50)
                });
                
                await sock.sendMessage(chatId, { 
                    text: `✅ Image sent to channel with caption: ${messageText || '(no caption)'}` 
                });
                return;
            }
            else if (quotedMessage.videoMessage) {
                debug.mediaType = 'video';
                log('INFO', '🎥 Downloading quoted video', { 
                    mimetype: quotedMessage.videoMessage.mimetype,
                    fileLength: quotedMessage.videoMessage.fileLength,
                    duration: quotedMessage.videoMessage.seconds
                });
                
                // Download video
                const stream = await downloadContentFromMessage(quotedMessage.videoMessage, 'video');
                const buffer = [];
                for await (const chunk of stream) {
                    buffer.push(chunk);
                }
                const videoBuffer = Buffer.concat(buffer);
                debug.videoSize = videoBuffer.length;
                log('DEBUG', 'Video downloaded', { size: videoBuffer.length });
                
                finalMessage = {
                    video: videoBuffer,
                    caption: messageText,
                    mimetype: quotedMessage.videoMessage.mimetype
                };
                
                log('INFO', '📤 Sending video to channel', { 
                    captionLength: messageText.length,
                    mimeType: quotedMessage.videoMessage.mimetype
                });
                await sock.sendMessage(channelJid, finalMessage);
                debug.steps.push('sent_to_channel');
                
                const timeTaken = Date.now() - startTime;
                log('INFO', '✅ Video sent successfully', { 
                    timeTaken: `${timeTaken}ms`,
                    videoSize: videoBuffer.length
                });
                
                await sock.sendMessage(chatId, { 
                    text: `✅ Video sent to channel with caption: ${messageText || '(no caption)'}` 
                });
                return;
            }
            else if (quotedMessage.audioMessage) {
                debug.mediaType = 'audio';
                log('INFO', '🎵 Downloading quoted audio', { 
                    mimetype: quotedMessage.audioMessage.mimetype,
                    fileLength: quotedMessage.audioMessage.fileLength,
                    duration: quotedMessage.audioMessage.seconds,
                    isPTT: quotedMessage.audioMessage.ptt
                });
                
                // Download audio
                const stream = await downloadContentFromMessage(quotedMessage.audioMessage, 'audio');
                const buffer = [];
                for await (const chunk of stream) {
                    buffer.push(chunk);
                }
                const audioBuffer = Buffer.concat(buffer);
                debug.audioSize = audioBuffer.length;
                log('DEBUG', 'Audio downloaded', { size: audioBuffer.length });
                
                finalMessage = {
                    audio: audioBuffer,
                    mimetype: quotedMessage.audioMessage.mimetype,
                    ptt: quotedMessage.audioMessage.ptt || false
                };
                
                log('INFO', '📤 Sending audio to channel');
                await sock.sendMessage(channelJid, finalMessage);
                debug.steps.push('sent_to_channel');
                
                const timeTaken = Date.now() - startTime;
                log('INFO', '✅ Audio sent successfully', { 
                    timeTaken: `${timeTaken}ms`,
                    audioSize: audioBuffer.length
                });
                
                await sock.sendMessage(chatId, { 
                    text: `✅ Audio sent to channel` 
                });
                return;
            }
            else if (quotedMessage.documentMessage) {
                debug.mediaType = 'document';
                log('INFO', '📄 Downloading quoted document', { 
                    mimetype: quotedMessage.documentMessage.mimetype,
                    fileLength: quotedMessage.documentMessage.fileLength,
                    fileName: quotedMessage.documentMessage.fileName
                });
                
                // Download document
                const stream = await downloadContentFromMessage(quotedMessage.documentMessage, 'document');
                const buffer = [];
                for await (const chunk of stream) {
                    buffer.push(chunk);
                }
                const docBuffer = Buffer.concat(buffer);
                debug.docSize = docBuffer.length;
                log('DEBUG', 'Document downloaded', { 
                    size: docBuffer.length,
                    fileName: quotedMessage.documentMessage.fileName
                });
                
                finalMessage = {
                    document: docBuffer,
                    mimetype: quotedMessage.documentMessage.mimetype,
                    fileName: quotedMessage.documentMessage.fileName || 'document',
                    caption: messageText
                };
                
                log('INFO', '📤 Sending document to channel', { 
                    fileName: quotedMessage.documentMessage.fileName,
                    captionLength: messageText.length
                });
                await sock.sendMessage(channelJid, finalMessage);
                debug.steps.push('sent_to_channel');
                
                const timeTaken = Date.now() - startTime;
                log('INFO', '✅ Document sent successfully', { 
                    timeTaken: `${timeTaken}ms`,
                    docSize: docBuffer.length,
                    fileName: quotedMessage.documentMessage.fileName
                });
                
                await sock.sendMessage(chatId, { 
                    text: `✅ Document sent to channel: ${quotedMessage.documentMessage.fileName || 'document'}` 
                });
                return;
            }
            else if (quotedMessage.stickerMessage) {
                debug.mediaType = 'sticker';
                log('INFO', '😊 Downloading quoted sticker', { 
                    mimetype: quotedMessage.stickerMessage.mimetype,
                    fileLength: quotedMessage.stickerMessage.fileLength
                });
                
                // Download sticker
                const stream = await downloadContentFromMessage(quotedMessage.stickerMessage, 'sticker');
                const buffer = [];
                for await (const chunk of stream) {
                    buffer.push(chunk);
                }
                const stickerBuffer = Buffer.concat(buffer);
                debug.stickerSize = stickerBuffer.length;
                log('DEBUG', 'Sticker downloaded', { size: stickerBuffer.length });
                
                finalMessage = {
                    sticker: stickerBuffer,
                    mimetype: quotedMessage.stickerMessage.mimetype
                };
                
                log('INFO', '📤 Sending sticker to channel');
                await sock.sendMessage(channelJid, finalMessage);
                debug.steps.push('sent_to_channel');
                
                const timeTaken = Date.now() - startTime;
                log('INFO', '✅ Sticker sent successfully', { 
                    timeTaken: `${timeTaken}ms`,
                    stickerSize: stickerBuffer.length
                });
                
                await sock.sendMessage(chatId, { 
                    text: `✅ Sticker sent to channel` 
                });
                return;
            }
        }
        
        // If no quoted media, check if message itself has media (unlikely with .channel command)
        else if (fullMessage?.imageMessage || fullMessage?.videoMessage || 
                 fullMessage?.audioMessage || fullMessage?.documentMessage || 
                 fullMessage?.stickerMessage) {
            
            debug.steps.push('processing_direct_media');
            log('INFO', '📎 Processing direct media message');
            
            let mediaData = null;
            let mediaType = null;
            let caption = '';
            
            if (fullMessage?.imageMessage) {
                mediaData = fullMessage.imageMessage;
                mediaType = 'image';
                caption = mediaData.caption || '';
                log('DEBUG', 'Direct image message', { 
                    mimetype: mediaData.mimetype,
                    fileLength: mediaData.fileLength,
                    caption: caption.substring(0, 50)
                });
            } else if (fullMessage?.videoMessage) {
                mediaData = fullMessage.videoMessage;
                mediaType = 'video';
                caption = mediaData.caption || '';
                log('DEBUG', 'Direct video message', { 
                    mimetype: mediaData.mimetype,
                    fileLength: mediaData.fileLength,
                    duration: mediaData.seconds
                });
            } else if (fullMessage?.audioMessage) {
                mediaData = fullMessage.audioMessage;
                mediaType = 'audio';
                log('DEBUG', 'Direct audio message', { 
                    mimetype: mediaData.mimetype,
                    fileLength: mediaData.fileLength,
                    isPTT: mediaData.ptt
                });
            } else if (fullMessage?.documentMessage) {
                mediaData = fullMessage.documentMessage;
                mediaType = 'document';
                caption = mediaData.caption || '';
                log('DEBUG', 'Direct document message', { 
                    mimetype: mediaData.mimetype,
                    fileLength: mediaData.fileLength,
                    fileName: mediaData.fileName
                });
            } else if (fullMessage?.stickerMessage) {
                mediaData = fullMessage.stickerMessage;
                mediaType = 'sticker';
                log('DEBUG', 'Direct sticker message', { 
                    mimetype: mediaData.mimetype,
                    fileLength: mediaData.fileLength
                });
            }
            
            const finalCaption = messageText || caption || '';
            debug.mediaType = mediaType;
            debug.finalCaption = finalCaption.substring(0, 50);
            
            // Send typing indicator
            await sock.sendPresenceUpdate('composing', channelJid);
            debug.steps.push('sent_typing_indicator');
            
            log('INFO', `📥 Downloading direct ${mediaType}`, { 
                captionLength: finalCaption.length 
            });
            
            // Download the media
            const stream = await downloadContentFromMessage(mediaData, mediaType);
            const buffer = [];
            for await (const chunk of stream) {
                buffer.push(chunk);
            }
            const mediaBuffer = Buffer.concat(buffer);
            debug.mediaSize = mediaBuffer.length;
            log('DEBUG', 'Media downloaded', { size: mediaBuffer.length });
            
            let finalMessage = {};
            
            if (mediaType === 'image') {
                finalMessage = {
                    image: mediaBuffer,
                    caption: finalCaption,
                    mimetype: mediaData.mimetype
                };
            } else if (mediaType === 'video') {
                finalMessage = {
                    video: mediaBuffer,
                    caption: finalCaption,
                    mimetype: mediaData.mimetype
                };
            } else if (mediaType === 'audio') {
                finalMessage = {
                    audio: mediaBuffer,
                    mimetype: mediaData.mimetype,
                    ptt: mediaData.ptt || false
                };
            } else if (mediaType === 'document') {
                finalMessage = {
                    document: mediaBuffer,
                    mimetype: mediaData.mimetype,
                    fileName: mediaData.fileName || 'document',
                    caption: finalCaption
                };
            } else if (mediaType === 'sticker') {
                finalMessage = {
                    sticker: mediaBuffer,
                    mimetype: mediaData.mimetype
                };
            }
            
            log('INFO', `📤 Sending ${mediaType} to channel`);
            await sock.sendMessage(channelJid, finalMessage);
            debug.steps.push('sent_to_channel');
            
            const timeTaken = Date.now() - startTime;
            log('INFO', `✅ ${mediaType} sent successfully`, { 
                timeTaken: `${timeTaken}ms`,
                size: mediaBuffer.length
            });
            
            await sock.sendMessage(chatId, { 
                text: `✅ ${mediaType} sent to channel successfully!${finalCaption ? `\n📝 Caption: ${finalCaption.substring(0, 50)}${finalCaption.length > 50 ? '...' : ''}` : ''}` 
            });
            return;
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
        
        // No media and no text
        else {
            debug.steps.push('no_content');
            log('WARN', '❌ No content provided', { 
                hasText: !!messageText,
                hasQuoted: !!quotedMessage,
                hasDirectMedia: !!(fullMessage?.imageMessage || fullMessage?.videoMessage)
            });
            
            await sock.sendMessage(chatId, { 
                text: '❌ Please provide a message or reply to media with .channel' 
            });
        }

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
            text: '❌ Failed to send to channel. Check logs for details.' 
        });
    } finally {
        // Always log completion
        const totalTime = Date.now() - startTime;
        log('INFO', '📊 Channel command completed', {
            totalTime: `${totalTime}ms`,
            steps: debug.steps,
            errorCount: debug.errors.length
        });
    }
}

module.exports = channelCommand;
