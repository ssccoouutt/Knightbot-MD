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
        
        // Extract invite code from link
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

        // Join the group
        const groupJid = await sock.groupAcceptInvite(inviteCode);
        
        if (!groupJid) {
            throw new Error('Failed to get group JID');
        }

        // Small delay to ensure group is fully joined
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Get full group metadata
        const groupMetadata = await sock.groupMetadata(groupJid);
        
        const groupName = groupMetadata.subject || 'Unnamed Group';
        const memberCount = groupMetadata.participants?.length || 0;
        const groupDesc = groupMetadata.desc || 'No description';
        const groupOwner = groupMetadata.owner || 'Unknown';
        const groupCreation = groupMetadata.creation || 'Unknown';
        const groupRestrict = groupMetadata.restrict ? 'Yes' : 'No';
        const groupAnnounce = groupMetadata.announce ? 'Yes' : 'No';
        
        // Check if bot is admin
        const botParticipant = groupMetadata.participants?.find(p => 
            p.id === sock.user.id.split(':')[0] + '@s.whatsapp.net'
        );
        const isBotAdmin = botParticipant?.admin === 'admin' || botParticipant?.admin === 'superadmin';

        // Format creation date
        let creationDate = 'Unknown';
        if (groupCreation && groupCreation !== 'Unknown') {
            creationDate = new Date(groupCreation * 1000).toLocaleDateString();
        }

        // Format owner info
        let ownerName = groupOwner;
        if (groupOwner && groupOwner !== 'Unknown') {
            ownerName = groupOwner.split('@')[0];
        }

        // Send confirmation WITHOUT auto-message to group
        await sock.sendMessage(chatId, { 
            text: `✅ *Successfully joined group!*\n\n` +
                  `📌 *Group Name:* ${groupName}\n` +
                  `👥 *Members:* ${memberCount}\n` +
                  `📝 *Description:* ${groupDesc.substring(0, 100)}${groupDesc.length > 100 ? '...' : ''}\n` +
                  `👑 *Group Owner:* ${ownerName}\n` +
                  `🔒 *Restricted:* ${groupRestrict} (Only admins can change group info)\n` +
                  `🔇 *Announcement Mode:* ${groupAnnounce} (${groupAnnounce === 'Yes' ? 'Only admins can message' : 'Everyone can message'})\n` +
                  `📅 *Created:* ${creationDate}\n` +
                  `🤖 *Bot is Admin:* ${isBotAdmin ? 'Yes ✅' : 'No ❌'}\n` +
                  `🔗 *JID:* ${groupJid}`,
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

        // REMOVED: No welcome message sent to the group

        // Log the action
        console.log(`✅ Bot joined group: ${groupName} (${groupJid}) - Members: ${memberCount}`);

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
