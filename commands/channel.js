const axios = require('axios');
const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
const sharp = require('sharp'); // For thumbnail generation

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

// Generate thumbnail from image buffer
async function generateThumbnail(buffer) {
    try {
        const thumbnail = await sharp(buffer)
            .resize(100, 100, { fit: 'inside' })
            .jpeg({ quality: 50 })
            .toBuffer();
        return thumbnail.toString('base64');
    } catch (err) {
        log('WARN', 'Thumbnail generation failed', { error: err.message });
        return null;
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
        
        const messageText = args.join(' ').trim();
        debug.messageText = messageText;
        
        // Check for quoted media FIRST
        const quotedMessage = fullMessage?.extendedTextMessage?.contextInfo?.quotedMessage;
        debug.hasQuotedMessage = !!quotedMessage;
        debug.quotedType = quotedMessage ? Object.keys(quotedMessage)[0] : 'none';
        
        // Check for direct media
        const hasDirectMedia = fullMessage?.imageMessage || 
                               fullMessage?.videoMessage || 
                               fullMessage?.audioMessage || 
                               fullMessage?.documentMessage || 
                               fullMessage?.stickerMessage;
        
        log('DEBUG', 'Message details', {
            messageType: debug.messageType,
            hasQuotedMessage: debug.hasQuotedMessage,
            quotedType: debug.quotedType,
            hasDirectMedia,
            messageTextLength: messageText.length
        });

        // Channel context info - CRITICAL for channel posts
        const channelContext = {
            contextInfo: {
                forwardingScore: 1,
                isForwarded: false,
                forwardedNewsletterMessageInfo: {
                    newsletterJid: channelJid,
                    newsletterName: 'Tech Zone',
                    serverMessageId: -1
                }
            }
        };

        // Send typing indicator
        await sock.sendPresenceUpdate('composing', channelJid);
        debug.steps.push('sent_typing_indicator');

        // ===== HANDLE QUOTED MEDIA (Reply to image with .channel caption) =====
        if (quotedMessage) {
            debug.steps.push('processing_quoted_media');
            log('INFO', '📎 Processing quoted media', { 
                quotedType: debug.quotedType,
                caption: messageText
            });
            
            // QUOTED IMAGE
            if (quotedMessage.imageMessage) {
                debug.mediaType = 'image';
                log('INFO', '📸 Downloading quoted image', { 
                    mimetype: quotedMessage.imageMessage.mimetype,
                    fileLength: quotedMessage.imageMessage.fileLength
                });
                
                const stream = await downloadContentFromMessage(quotedMessage.imageMessage, 'image');
                const buffer = [];
                for await (const chunk of stream) buffer.push(chunk);
                const imageBuffer = Buffer.concat(buffer);
                
                // Generate thumbnail for channel preview
                const thumbnail = await generateThumbnail(imageBuffer);
                
                const finalMessage = {
                    image: imageBuffer,
                    caption: messageText,
                    mimetype: quotedMessage.imageMessage.mimetype,
                    jpegThumbnail: thumbnail, // CRITICAL for channel preview
                    ...channelContext
                };
                
                log('INFO', '📤 Sending quoted image to channel with thumbnail');
                await sock.sendMessage(channelJid, finalMessage);
                debug.steps.push('sent_to_channel');
                
                const timeTaken = Date.now() - startTime;
                log('INFO', '✅ Quoted image sent successfully', { 
                    timeTaken: `${timeTaken}ms`,
                    imageSize: imageBuffer.length,
                    hasThumbnail: !!thumbnail
                });
                
                await sock.sendMessage(chatId, { 
                    text: `✅ Image sent to channel with caption: ${messageText || '(no caption)'}` 
                });
                return;
            }
            
            // QUOTED VIDEO
            else if (quotedMessage.videoMessage) {
                debug.mediaType = 'video';
                log('INFO', '🎥 Downloading quoted video', { 
                    mimetype: quotedMessage.videoMessage.mimetype,
                    fileLength: quotedMessage.videoMessage.fileLength
                });
                
                const stream = await downloadContentFromMessage(quotedMessage.videoMessage, 'video');
                const buffer = [];
                for await (const chunk of stream) buffer.push(chunk);
                const videoBuffer = Buffer.concat(buffer);
                
                // For videos, try to generate thumbnail from first frame if possible
                let thumbnail = null;
                try {
                    // You'd need ffmpeg for this, skip for now
                } catch (e) {}
                
                const finalMessage = {
                    video: videoBuffer,
                    caption: messageText,
                    mimetype: quotedMessage.videoMessage.mimetype,
                    jpegThumbnail: thumbnail,
                    ...channelContext
                };
                
                log('INFO', '📤 Sending quoted video to channel');
                await sock.sendMessage(channelJid, finalMessage);
                debug.steps.push('sent_to_channel');
                
                await sock.sendMessage(chatId, { 
                    text: `✅ Video sent to channel with caption: ${messageText || '(no caption)'}` 
                });
                return;
            }
            
            // QUOTED AUDIO
            else if (quotedMessage.audioMessage) {
                debug.mediaType = 'audio';
                log('INFO', '🎵 Downloading quoted audio');
                
                const stream = await downloadContentFromMessage(quotedMessage.audioMessage, 'audio');
                const buffer = [];
                for await (const chunk of stream) buffer.push(chunk);
                const audioBuffer = Buffer.concat(buffer);
                
                const finalMessage = {
                    audio: audioBuffer,
                    mimetype: quotedMessage.audioMessage.mimetype,
                    ptt: quotedMessage.audioMessage.ptt || false,
                    ...channelContext
                };
                
                log('INFO', '📤 Sending quoted audio to channel');
                await sock.sendMessage(channelJid, finalMessage);
                debug.steps.push('sent_to_channel');
                
                await sock.sendMessage(chatId, { 
                    text: `✅ Audio sent to channel` 
                });
                return;
            }
            
            // QUOTED DOCUMENT
            else if (quotedMessage.documentMessage) {
                debug.mediaType = 'document';
                log('INFO', '📄 Downloading quoted document', { 
                    fileName: quotedMessage.documentMessage.fileName
                });
                
                const stream = await downloadContentFromMessage(quotedMessage.documentMessage, 'document');
                const buffer = [];
                for await (const chunk of stream) buffer.push(chunk);
                const docBuffer = Buffer.concat(buffer);
                
                const finalMessage = {
                    document: docBuffer,
                    mimetype: quotedMessage.documentMessage.mimetype,
                    fileName: quotedMessage.documentMessage.fileName || 'document',
                    caption: messageText,
                    ...channelContext
                };
                
                log('INFO', '📤 Sending quoted document to channel');
                await sock.sendMessage(channelJid, finalMessage);
                debug.steps.push('sent_to_channel');
                
                await sock.sendMessage(chatId, { 
                    text: `✅ Document sent to channel: ${quotedMessage.documentMessage.fileName || 'document'}` 
                });
                return;
            }
            
            // QUOTED STICKER
            else if (quotedMessage.stickerMessage) {
                debug.mediaType = 'sticker';
                log('INFO', '😊 Downloading quoted sticker');
                
                const stream = await downloadContentFromMessage(quotedMessage.stickerMessage, 'sticker');
                const buffer = [];
                for await (const chunk of stream) buffer.push(chunk);
                const stickerBuffer = Buffer.concat(buffer);
                
                const finalMessage = {
                    sticker: stickerBuffer,
                    mimetype: quotedMessage.stickerMessage.mimetype,
                    ...channelContext
                };
                
                log('INFO', '📤 Sending quoted sticker to channel');
                await sock.sendMessage(channelJid, finalMessage);
                debug.steps.push('sent_to_channel');
                
                await sock.sendMessage(chatId, { 
                    text: `✅ Sticker sent to channel` 
                });
                return;
            }
        }
        
        // ===== HANDLE DIRECT MEDIA (Send image/video with caption in same message) =====
        else if (hasDirectMedia) {
            debug.steps.push('processing_direct_media');
            log('INFO', '📎 Processing direct media message');
            
            // DIRECT IMAGE
            if (fullMessage?.imageMessage) {
                debug.mediaType = 'image';
                log('INFO', '📸 Downloading direct image', { 
                    mimetype: fullMessage.imageMessage.mimetype,
                    fileLength: fullMessage.imageMessage.fileLength
                });
                
                const stream = await downloadContentFromMessage(fullMessage.imageMessage, 'image');
                const buffer = [];
                for await (const chunk of stream) buffer.push(chunk);
                const imageBuffer = Buffer.concat(buffer);
                
                // Generate thumbnail for channel preview
                const thumbnail = await generateThumbnail(imageBuffer);
                
                const finalMessage = {
                    image: imageBuffer,
                    caption: messageText,
                    mimetype: fullMessage.imageMessage.mimetype,
                    jpegThumbnail: thumbnail, // CRITICAL for channel preview
                    ...channelContext
                };
                
                log('INFO', '📤 Sending direct image to channel with thumbnail');
                await sock.sendMessage(channelJid, finalMessage);
                debug.steps.push('sent_to_channel');
                
                const timeTaken = Date.now() - startTime;
                log('INFO', '✅ Direct image sent successfully', { 
                    timeTaken: `${timeTaken}ms`,
                    imageSize: imageBuffer.length,
                    hasThumbnail: !!thumbnail
                });
                
                await sock.sendMessage(chatId, { 
                    text: `✅ Image sent to channel with caption: ${messageText || '(no caption)'}` 
                });
                return;
            }
            
            // DIRECT VIDEO
            else if (fullMessage?.videoMessage) {
                debug.mediaType = 'video';
                log('INFO', '🎥 Downloading direct video');
                
                const stream = await downloadContentFromMessage(fullMessage.videoMessage, 'video');
                const buffer = [];
                for await (const chunk of stream) buffer.push(chunk);
                const videoBuffer = Buffer.concat(buffer);
                
                const finalMessage = {
                    video: videoBuffer,
                    caption: messageText,
                    mimetype: fullMessage.videoMessage.mimetype,
                    ...channelContext
                };
                
                log('INFO', '📤 Sending direct video to channel');
                await sock.sendMessage(channelJid, finalMessage);
                debug.steps.push('sent_to_channel');
                
                await sock.sendMessage(chatId, { 
                    text: `✅ Video sent to channel with caption: ${messageText || '(no caption)'}` 
                });
                return;
            }
            
            // DIRECT AUDIO
            else if (fullMessage?.audioMessage) {
                debug.mediaType = 'audio';
                log('INFO', '🎵 Downloading direct audio');
                
                const stream = await downloadContentFromMessage(fullMessage.audioMessage, 'audio');
                const buffer = [];
                for await (const chunk of stream) buffer.push(chunk);
                const audioBuffer = Buffer.concat(buffer);
                
                const finalMessage = {
                    audio: audioBuffer,
                    mimetype: fullMessage.audioMessage.mimetype,
                    ptt: fullMessage.audioMessage.ptt || false,
                    ...channelContext
                };
                
                log('INFO', '📤 Sending direct audio to channel');
                await sock.sendMessage(channelJid, finalMessage);
                debug.steps.push('sent_to_channel');
                
                await sock.sendMessage(chatId, { 
                    text: `✅ Audio sent to channel` 
                });
                return;
            }
            
            // DIRECT DOCUMENT
            else if (fullMessage?.documentMessage) {
                debug.mediaType = 'document';
                log('INFO', '📄 Downloading direct document', { 
                    fileName: fullMessage.documentMessage.fileName
                });
                
                const stream = await downloadContentFromMessage(fullMessage.documentMessage, 'document');
                const buffer = [];
                for await (const chunk of stream) buffer.push(chunk);
                const docBuffer = Buffer.concat(buffer);
                
                const finalMessage = {
                    document: docBuffer,
                    mimetype: fullMessage.documentMessage.mimetype,
                    fileName: fullMessage.documentMessage.fileName || 'document',
                    caption: messageText,
                    ...channelContext
                };
                
                log('INFO', '📤 Sending direct document to channel');
                await sock.sendMessage(channelJid, finalMessage);
                debug.steps.push('sent_to_channel');
                
                await sock.sendMessage(chatId, { 
                    text: `✅ Document sent to channel: ${fullMessage.documentMessage.fileName || 'document'}` 
                });
                return;
            }
            
            // DIRECT STICKER
            else if (fullMessage?.stickerMessage) {
                debug.mediaType = 'sticker';
                log('INFO', '😊 Downloading direct sticker');
                
                const stream = await downloadContentFromMessage(fullMessage.stickerMessage, 'sticker');
                const buffer = [];
                for await (const chunk of stream) buffer.push(chunk);
                const stickerBuffer = Buffer.concat(buffer);
                
                const finalMessage = {
                    sticker: stickerBuffer,
                    mimetype: fullMessage.stickerMessage.mimetype,
                    ...channelContext
                };
                
                log('INFO', '📤 Sending direct sticker to channel');
                await sock.sendMessage(channelJid, finalMessage);
                debug.steps.push('sent_to_channel');
                
                await sock.sendMessage(chatId, { 
                    text: `✅ Sticker sent to channel` 
                });
                return;
            }
        }
        
        // ===== HANDLE TEXT ONLY =====
        else if (messageText) {
            debug.steps.push('processing_text_only');
            log('INFO', '📝 Sending text to channel', { text: messageText });
            
            const finalMessage = {
                text: messageText,
                ...channelContext  // Text also gets context
            };
            
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
        
        // ===== NO CONTENT =====
        else {
            debug.steps.push('no_content');
            log('WARN', '❌ No content provided');
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
