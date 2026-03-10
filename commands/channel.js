const axios = require('axios');

async function channelCommand(sock, chatId, message, args) {
    try {
        const channelJid = '120363405181626845@newsletter';
        
        // Get the full message object
        const fullMessage = message.message;
        
        // Check if this is a media message with caption
        let mediaData = null;
        let mediaType = null;
        let caption = '';
        
        // Check for image with caption
        if (fullMessage?.imageMessage) {
            mediaData = fullMessage.imageMessage;
            mediaType = 'image';
            caption = mediaData.caption || '';
        }
        // Check for video with caption
        else if (fullMessage?.videoMessage) {
            mediaData = fullMessage.videoMessage;
            mediaType = 'video';
            caption = mediaData.caption || '';
        }
        // Check for audio
        else if (fullMessage?.audioMessage) {
            mediaData = fullMessage.audioMessage;
            mediaType = 'audio';
        }
        // Check for document
        else if (fullMessage?.documentMessage) {
            mediaData = fullMessage.documentMessage;
            mediaType = 'document';
            caption = mediaData.caption || '';
        }
        // Check for sticker
        else if (fullMessage?.stickerMessage) {
            mediaData = fullMessage.stickerMessage;
            mediaType = 'sticker';
        }
        
        // Get the command arguments (if any)
        const messageText = args.join(' ').trim();
        
        // If it's a media message, the caption might contain the command
        // So we need to use the messageText from args if available, otherwise use the media caption
        const finalCaption = messageText || caption || '';
        
        // If no media and no text, show usage
        if (!mediaData && !messageText) {
            await sock.sendMessage(chatId, { 
                text: '❌ Please provide a message or media to send to the channel!\n\nUsage:\n• Text: `.channel Hello everyone!`\n• Media: Send image/video with caption `.channel Your caption here`' 
            });
            return;
        }

        // Send typing indicator to channel
        await sock.sendPresenceUpdate('composing', channelJid);

        let finalMessage = {};
        const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
        
        // If there's media in the message
        if (mediaData) {
            // Download the media
            const stream = await downloadContentFromMessage(mediaData, mediaType);
            const buffer = [];
            for await (const chunk of stream) {
                buffer.push(chunk);
            }
            const mediaBuffer = Buffer.concat(buffer);
            
            // Prepare message based on media type
            if (mediaType === 'image') {
                finalMessage = {
                    image: mediaBuffer,
                    caption: finalCaption,
                    mimetype: mediaData.mimetype,
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
            } else if (mediaType === 'video') {
                finalMessage = {
                    video: mediaBuffer,
                    caption: finalCaption,
                    mimetype: mediaData.mimetype,
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
            } else if (mediaType === 'audio') {
                finalMessage = {
                    audio: mediaBuffer,
                    mimetype: mediaData.mimetype,
                    ptt: mediaData.ptt || false,
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
            } else if (mediaType === 'document') {
                finalMessage = {
                    document: mediaBuffer,
                    mimetype: mediaData.mimetype,
                    fileName: mediaData.fileName || 'document',
                    caption: finalCaption,
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
            } else if (mediaType === 'sticker') {
                finalMessage = {
                    sticker: mediaBuffer,
                    mimetype: mediaData.mimetype,
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
            }
        }
        // Check if this is a reply to a message
        else if (fullMessage?.extendedTextMessage?.contextInfo?.quotedMessage) {
            const quotedMessage = fullMessage.extendedTextMessage.contextInfo.quotedMessage;
            
            if (quotedMessage.imageMessage) {
                // Forward image
                const stream = await downloadContentFromMessage(quotedMessage.imageMessage, 'image');
                const buffer = [];
                for await (const chunk of stream) {
                    buffer.push(chunk);
                }
                finalMessage = {
                    image: Buffer.concat(buffer),
                    caption: messageText,
                    mimetype: quotedMessage.imageMessage.mimetype,
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
            } else if (quotedMessage.videoMessage) {
                // Forward video
                const stream = await downloadContentFromMessage(quotedMessage.videoMessage, 'video');
                const buffer = [];
                for await (const chunk of stream) {
                    buffer.push(chunk);
                }
                finalMessage = {
                    video: Buffer.concat(buffer),
                    caption: messageText,
                    mimetype: quotedMessage.videoMessage.mimetype,
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
            } else if (quotedMessage.audioMessage) {
                // Forward audio
                const stream = await downloadContentFromMessage(quotedMessage.audioMessage, 'audio');
                const buffer = [];
                for await (const chunk of stream) {
                    buffer.push(chunk);
                }
                finalMessage = {
                    audio: Buffer.concat(buffer),
                    mimetype: quotedMessage.audioMessage.mimetype,
                    ptt: quotedMessage.audioMessage.ptt || false,
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
            } else if (quotedMessage.documentMessage) {
                // Forward document
                const stream = await downloadContentFromMessage(quotedMessage.documentMessage, 'document');
                const buffer = [];
                for await (const chunk of stream) {
                    buffer.push(chunk);
                }
                finalMessage = {
                    document: Buffer.concat(buffer),
                    mimetype: quotedMessage.documentMessage.mimetype,
                    fileName: quotedMessage.documentMessage.fileName || 'document',
                    caption: messageText,
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
            } else if (quotedMessage.stickerMessage) {
                // Forward sticker
                const stream = await downloadContentFromMessage(quotedMessage.stickerMessage, 'sticker');
                const buffer = [];
                for await (const chunk of stream) {
                    buffer.push(chunk);
                }
                finalMessage = {
                    sticker: Buffer.concat(buffer),
                    mimetype: quotedMessage.stickerMessage.mimetype,
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
            } else {
                // If quoted message is not media, send as text
                finalMessage = {
                    text: messageText || 'Forwarded message',
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
            }
        } else {
            // Handle text only message
            finalMessage = {
                text: messageText,
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
        }

        // Send to channel
        if (Object.keys(finalMessage).length > 0) {
            await sock.sendMessage(channelJid, finalMessage);
        }

        // Determine what was sent for confirmation message
        let sentType = 'text message';
        if (mediaData) {
            sentType = mediaType;
        } else if (fullMessage?.extendedTextMessage?.contextInfo?.quotedMessage) {
            const quoted = fullMessage.extendedTextMessage.contextInfo.quotedMessage;
            if (quoted.imageMessage) sentType = 'image (forwarded)';
            else if (quoted.videoMessage) sentType = 'video (forwarded)';
            else if (quoted.audioMessage) sentType = 'audio (forwarded)';
            else if (quoted.documentMessage) sentType = 'document (forwarded)';
            else if (quoted.stickerMessage) sentType = 'sticker (forwarded)';
            else sentType = 'forwarded message';
        }

        // Confirm to the user
        await sock.sendMessage(chatId, { 
            text: `✅ ${sentType.charAt(0).toUpperCase() + sentType.slice(1)} sent to channel successfully!\n\n${finalCaption ? `📝 Caption: ${finalCaption.substring(0, 50)}${finalCaption.length > 50 ? '...' : ''}\n\n` : ''}📢 Channel: Tech Zone` 
        });

        // Log the action
        console.log(`📢 Channel ${sentType} sent by ${chatId}: ${finalCaption.substring(0, 50)}...`);

    } catch (error) {
        console.error('Channel command error:', error);
        await sock.sendMessage(chatId, { 
            text: '❌ Failed to send message to channel. Make sure the bot has access to the channel.' 
        });
    }
}

module.exports = channelCommand;
