const axios = require('axios');

async function channelCommand(sock, chatId, message, args) {
    try {
        const channelJid = '120363405181626845@newsletter';
        
        // Get message content and caption
        const messageText = args.join(' ').trim();
        
        // Check if there's any media in the message
        const hasMedia = message.message?.imageMessage || 
                        message.message?.videoMessage || 
                        message.message?.audioMessage || 
                        message.message?.documentMessage || 
                        message.message?.stickerMessage;
        
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
        
        // Check if message contains media directly
        if (hasMedia) {
            const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
            
            if (message.message?.imageMessage) {
                // Handle image
                const stream = await downloadContentFromMessage(message.message.imageMessage, 'image');
                const buffer = [];
                for await (const chunk of stream) {
                    buffer.push(chunk);
                }
                finalMessage = {
                    image: Buffer.concat(buffer),
                    caption: messageText || '',
                    mimetype: message.message.imageMessage.mimetype,
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
            } else if (message.message?.videoMessage) {
                // Handle video
                const stream = await downloadContentFromMessage(message.message.videoMessage, 'video');
                const buffer = [];
                for await (const chunk of stream) {
                    buffer.push(chunk);
                }
                finalMessage = {
                    video: Buffer.concat(buffer),
                    caption: messageText || '',
                    mimetype: message.message.videoMessage.mimetype,
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
            } else if (message.message?.audioMessage) {
                // Handle audio
                const stream = await downloadContentFromMessage(message.message.audioMessage, 'audio');
                const buffer = [];
                for await (const chunk of stream) {
                    buffer.push(chunk);
                }
                finalMessage = {
                    audio: Buffer.concat(buffer),
                    mimetype: message.message.audioMessage.mimetype,
                    ptt: message.message.audioMessage.ptt || false,
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
            } else if (message.message?.documentMessage) {
                // Handle document
                const stream = await downloadContentFromMessage(message.message.documentMessage, 'document');
                const buffer = [];
                for await (const chunk of stream) {
                    buffer.push(chunk);
                }
                finalMessage = {
                    document: Buffer.concat(buffer),
                    mimetype: message.message.documentMessage.mimetype,
                    fileName: message.message.documentMessage.fileName || 'document',
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
            } else if (message.message?.stickerMessage) {
                // Handle sticker
                const stream = await downloadContentFromMessage(message.message.stickerMessage, 'sticker');
                const buffer = [];
                for await (const chunk of stream) {
                    buffer.push(chunk);
                }
                finalMessage = {
                    sticker: Buffer.concat(buffer),
                    mimetype: message.message.stickerMessage.mimetype,
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

        // Check if this is a reply to a message (to forward quoted media)
        const quotedMessage = message.message?.extendedTextMessage?.contextInfo?.quotedMessage;
        
        // If replying to media and no direct media in message, forward the quoted media
        if (quotedMessage && !hasMedia) {
            const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
            
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
            }
        }

        // Send to channel
        await sock.sendMessage(channelJid, finalMessage);

        // Determine what was sent for confirmation message
        let sentType = 'text message';
        if (hasMedia) {
            if (message.message?.imageMessage) sentType = 'image';
            else if (message.message?.videoMessage) sentType = 'video';
            else if (message.message?.audioMessage) sentType = 'audio';
            else if (message.message?.documentMessage) sentType = 'document';
            else if (message.message?.stickerMessage) sentType = 'sticker';
        } else if (quotedMessage) {
            if (quotedMessage.imageMessage) sentType = 'image (forwarded)';
            else if (quotedMessage.videoMessage) sentType = 'video (forwarded)';
            else if (quotedMessage.audioMessage) sentType = 'audio (forwarded)';
            else if (quotedMessage.documentMessage) sentType = 'document (forwarded)';
            else if (quotedMessage.stickerMessage) sentType = 'sticker (forwarded)';
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
