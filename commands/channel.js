const axios = require('axios');

async function channelCommand(sock, chatId, message, args) {
    try {
        const channelJid = '120363405181626845@newsletter';
        
        // Get message content and caption
        const messageText = args.join(' ').trim();
        
        // Check if there's any media in the message
        // The message object structure is different for media messages
        const mediaTypes = ['imageMessage', 'videoMessage', 'audioMessage', 'documentMessage', 'stickerMessage'];
        let hasMedia = false;
        let mediaType = null;
        
        for (const type of mediaTypes) {
            if (message.message?.[type]) {
                hasMedia = true;
                mediaType = type;
                break;
            }
        }
        
        // If no message text and no media, show usage
        if (!messageText && !hasMedia) {
            await sock.sendMessage(chatId, { 
                text: '❌ Please provide a message or media to send to the channel!\n\nUsage:\n• Text: `.channel Hello everyone!`\n• Media: Send image/video with caption `.channel Your caption here`' 
            });
            return;
        }

        // Send typing indicator to channel
        await sock.sendPresenceUpdate('composing', channelJid);

        let finalMessage = {};
        const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
        
        // Check if message contains media directly
        if (hasMedia) {
            if (mediaType === 'imageMessage') {
                // Handle image
                const mediaData = message.message.imageMessage;
                const stream = await downloadContentFromMessage(mediaData, 'image');
                const buffer = [];
                for await (const chunk of stream) {
                    buffer.push(chunk);
                }
                finalMessage = {
                    image: Buffer.concat(buffer),
                    caption: messageText || '',
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
            } else if (mediaType === 'videoMessage') {
                // Handle video
                const mediaData = message.message.videoMessage;
                const stream = await downloadContentFromMessage(mediaData, 'video');
                const buffer = [];
                for await (const chunk of stream) {
                    buffer.push(chunk);
                }
                finalMessage = {
                    video: Buffer.concat(buffer),
                    caption: messageText || '',
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
            } else if (mediaType === 'audioMessage') {
                // Handle audio
                const mediaData = message.message.audioMessage;
                const stream = await downloadContentFromMessage(mediaData, 'audio');
                const buffer = [];
                for await (const chunk of stream) {
                    buffer.push(chunk);
                }
                finalMessage = {
                    audio: Buffer.concat(buffer),
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
            } else if (mediaType === 'documentMessage') {
                // Handle document
                const mediaData = message.message.documentMessage;
                const stream = await downloadContentFromMessage(mediaData, 'document');
                const buffer = [];
                for await (const chunk of stream) {
                    buffer.push(chunk);
                }
                finalMessage = {
                    document: Buffer.concat(buffer),
                    mimetype: mediaData.mimetype,
                    fileName: mediaData.fileName || 'document',
                    caption: messageText || '',
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
            } else if (mediaType === 'stickerMessage') {
                // Handle sticker
                const mediaData = message.message.stickerMessage;
                const stream = await downloadContentFromMessage(mediaData, 'sticker');
                const buffer = [];
                for await (const chunk of stream) {
                    buffer.push(chunk);
                }
                finalMessage = {
                    sticker: Buffer.concat(buffer),
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
        // Check if this is a reply to a message (to forward quoted media)
        else if (message.message?.extendedTextMessage?.contextInfo?.quotedMessage) {
            const quotedMessage = message.message.extendedTextMessage.contextInfo.quotedMessage;
            
            if (quotedMessage.imageMessage) {
                // Forward image
                const stream = await downloadContentFromMessage(quotedMessage.imageMessage, 'image');
                const buffer = [];
                for await (const chunk of stream) {
                    buffer.push(chunk);
                }
                finalMessage = {
                    image: Buffer.concat(buffer),
                    caption: messageText || '',
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
                    caption: messageText || '',
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
                    caption: messageText || '',
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
        await sock.sendMessage(channelJid, finalMessage);

        // Determine what was sent for confirmation message
        let sentType = 'text message';
        if (hasMedia) {
            if (mediaType === 'imageMessage') sentType = 'image';
            else if (mediaType === 'videoMessage') sentType = 'video';
            else if (mediaType === 'audioMessage') sentType = 'audio';
            else if (mediaType === 'documentMessage') sentType = 'document';
            else if (mediaType === 'stickerMessage') sentType = 'sticker';
        } else if (message.message?.extendedTextMessage?.contextInfo?.quotedMessage) {
            const quoted = message.message.extendedTextMessage.contextInfo.quotedMessage;
            if (quoted.imageMessage) sentType = 'image (forwarded)';
            else if (quoted.videoMessage) sentType = 'video (forwarded)';
            else if (quoted.audioMessage) sentType = 'audio (forwarded)';
            else if (quoted.documentMessage) sentType = 'document (forwarded)';
            else if (quoted.stickerMessage) sentType = 'sticker (forwarded)';
            else sentType = 'forwarded message';
        }

        // Confirm to the user
        await sock.sendMessage(chatId, { 
            text: `✅ ${sentType.charAt(0).toUpperCase() + sentType.slice(1)} sent to channel successfully!\n\n${messageText ? `📝 Caption: ${messageText.substring(0, 50)}${messageText.length > 50 ? '...' : ''}\n\n` : ''}📢 Channel: Tech Zone` 
        });

        // Log the action
        console.log(`📢 Channel ${sentType} sent by ${chatId}: ${messageText.substring(0, 50)}...`);

    } catch (error) {
        console.error('Channel command error:', error);
        await sock.sendMessage(chatId, { 
            text: '❌ Failed to send message to channel. Make sure the bot has access to the channel.' 
        });
    }
}

module.exports = channelCommand;
