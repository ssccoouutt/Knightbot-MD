const { downloadContentFromMessage } = require('@whiskeysockets/baileys');

async function joinCommand(sock, chatId, message, args) {
    try {
        // Check if user provided a link/code
        if (args.length === 0) {
            await sock.sendMessage(chatId, { 
                text: '❌ Please provide a group invite link or code!\n\nUsage: `.join [group_link_or_code]`\n\nExamples:\n`.join https://chat.whatsapp.com/ABCDEFGHIJKLMN`\n`.join ABCDEFGHIJKLMN`' 
            });
            return;
        }

        const input = args[0].trim();
        
        // Extract invite code from link if full URL is provided
        let inviteCode = input;
        if (input.includes('chat.whatsapp.com/')) {
            inviteCode = input.split('chat.whatsapp.com/')[1].split('?')[0].split('/')[0].trim();
        } else if (input.includes('whatsapp.com/')) {
            inviteCode = input.split('whatsapp.com/')[1].split('?')[0].split('/')[0].trim();
        }

        if (!inviteCode) {
            await sock.sendMessage(chatId, { 
                text: '❌ Invalid invite link or code!' 
            });
            return;
        }

        // Send processing message
        await sock.sendMessage(chatId, { 
            text: '⏳ Attempting to join group...' 
        });

        // Join the group using the invite code
        // The groupInviteCode is just the code part, not the full URL
        const groupMetadata = await sock.groupAcceptInvite(inviteCode);
        
        // Success! Get group info
        const groupName = groupMetadata.subject || 'Unknown Group';
        const groupJid = groupMetadata.id;
        const memberCount = groupMetadata.participants?.length || 0;

        // Confirm to the user
        await sock.sendMessage(chatId, { 
            text: `✅ *Successfully joined group!*\n\n📌 *Group:* ${groupName}\n👥 *Members:* ${memberCount}\n🔗 *JID:* ${groupJid}`,
            contextInfo: {
                forwardingScore: 1,
                isForwarded: true,
                forwardedNewsletterMessageInfo: {
                    newsletterJid: '120363161513685998@newsletter',
                    newsletterName: 'KnightBot MD',
                    serverMessageId: -1
                }
            }
        });

        // Optional: Send a welcome message to the group
        await sock.sendMessage(groupJid, { 
            text: `🤖 Hello everyone! I'm a bot and just joined using an invite link.\nType *.menu* to see what I can do!` 
        });

        // Log the action
        console.log(`✅ Bot joined group: ${groupName} (${groupJid}) via command from ${chatId}`);

    } catch (error) {
        console.error('Join command error:', error);
        
        // Handle specific error cases
        if (error.message?.includes('not-authorized')) {
            await sock.sendMessage(chatId, { 
                text: '❌ Cannot join group. The invite link may be invalid or expired.' 
            });
        } else if (error.message?.includes('already-a-member')) {
            await sock.sendMessage(chatId, { 
                text: '❌ Bot is already a member of this group!' 
            });
        } else {
            await sock.sendMessage(chatId, { 
                text: '❌ Failed to join group. Please check the invite link and try again.' 
            });
        }
    }
}

module.exports = joinCommand;
