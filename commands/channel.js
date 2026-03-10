const axios = require('axios');

async function channelCommand(sock, chatId, message, args) {
    try {
        // Check if user provided a message
        if (args.length === 0) {
            await sock.sendMessage(chatId, { 
                text: '❌ Please provide a message to send to the channel!\n\nUsage: `.channel [message]`\nExample: `.channel Hello everyone! Check out our new update!`' 
            });
            return;
        }

        const channelJid = '120363405181626845@newsletter';
        const messageText = args.join(' ').trim();

        // Send typing indicator to channel
        await sock.sendPresenceUpdate('composing', channelJid);

        // Prepare the message with minimal context info
        const channelMessage = {
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

        // Check if this is a reply to a message (to forward media)
        const quotedMessage = message.message?.extendedTextMessage?.contextInfo?.quotedMessage;
        
        let finalMessage = channelMessage;

        // If replying to media, forward it
        if (quotedMessage) {
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
            }
        }

        // Send to channel
        await sock.sendMessage(channelJid, finalMessage);

        // Confirm to the user
        await sock.sendMessage(chatId, { 
            text: `✅ Message sent to channel successfully!\n\n📝 Message: ${messageText.substring(0, 50)}${messageText.length > 50 ? '...' : ''}\n\n📢 Channel: Tech Zone` 
        });

        // Log the action
        console.log(`📢 Channel message sent by ${chatId}: ${messageText.substring(0, 50)}...`);

    } catch (error) {
        console.error('Channel command error:', error);
        await sock.sendMessage(chatId, { 
            text: '❌ Failed to send message to channel. Make sure the bot has access to the channel.' 
        });
    }
}

module.exports = channelCommand;
