async function joinCommand(sock, chatId, message, args) {
    try {
        if (args.length === 0) {
            await sock.sendMessage(chatId, { 
                text: '❌ Please provide a link!\n\nUsage: `.join [link]`\n\nSupported links:\n• Group invite: https://chat.whatsapp.com/...\n• Channel link: https://whatsapp.com/channel/...\n• Community link: https://chat.whatsapp.com/... (community invite)' 
            });
            return;
        }

        const input = args[0].trim();
        
        // Detect link type
        let linkType = 'unknown';
        let code = '';
        
        if (input.includes('chat.whatsapp.com/')) {
            // Group or Community link
            code = input.split('chat.whatsapp.com/')[1].split('?')[0].split('/')[0].trim();
            linkType = 'group';
        } else if (input.includes('whatsapp.com/channel/')) {
            // Channel link
            code = input.split('whatsapp.com/channel/')[1].split('?')[0].split('/')[0].trim();
            linkType = 'channel';
        } else {
            // Try as direct code
            code = input;
            linkType = 'group'; // Assume group for direct code
        }

        if (!code) {
            await sock.sendMessage(chatId, { 
                text: '❌ Invalid link or code!' 
            });
            return;
        }

        // Send processing message
        await sock.sendMessage(chatId, { 
            text: `⏳ Processing ${linkType} link...` 
        });

        // Handle different link types
        if (linkType === 'channel') {
            await handleChannelJoin(sock, chatId, message, code);
        } else {
            await handleGroupJoin(sock, chatId, message, code);
        }

    } catch (error) {
        console.error('Join command error:', error);
        await sock.sendMessage(chatId, { 
            text: '❌ Failed to process link. Please try again.' 
        });
    }
}

async function handleGroupJoin(sock, chatId, message, inviteCode) {
    try {
        // First, try to get invite info without joining
        let inviteInfo;
        try {
            inviteInfo = await sock.groupGetInviteInfo(inviteCode);
        } catch (infoError) {
            console.log('Could not get invite info:', infoError.message);
        }

        // Check if bot is already in group
        try {
            const existingGroups = await sock.groupFetchAllParticipating();
            const alreadyJoined = Object.values(existingGroups).find(g => 
                g.inviteCode === inviteCode || 
                (inviteInfo && g.subject === inviteInfo.subject)
            );
            
            if (alreadyJoined) {
                await sock.sendMessage(chatId, { 
                    text: `❌ Bot is already a member of this group!\n\n📌 *Group:* ${alreadyJoined.subject}\n👥 *Members:* ${alreadyJoined.participants.length}\n🔗 *JID:* ${alreadyJoined.id}` 
                });
                return;
            }
        } catch (e) {
            console.log('Error checking existing groups:', e);
        }

        // Try to join
        let groupJid;
        try {
            groupJid = await sock.groupAcceptInvite(inviteCode);
        } catch (joinError) {
            // Handle specific join errors
            if (joinError.message?.includes('already-exists') || joinError.data === 304) {
                // Bot already in group - try to find it
                const groups = await sock.groupFetchAllParticipating();
                const joinedGroup = Object.values(groups).find(g => 
                    g.inviteCode === inviteCode
                );
                
                if (joinedGroup) {
                    await sock.sendMessage(chatId, { 
                        text: `✅ Bot was already in this group!\n\n📌 *Group:* ${joinedGroup.subject}\n👥 *Members:* ${joinedGroup.participants.length}\n🔗 *JID:* ${joinedGroup.id}` 
                    });
                } else {
                    await sock.sendMessage(chatId, { 
                        text: '❌ Bot is already a member of this group (but couldn\'t fetch details).' 
                    });
                }
                return;
            }
            
            if (joinError.message?.includes('conflict') || joinError.data === 409) {
                // "Request to join" group - needs approval
                if (inviteInfo) {
                    await sock.sendMessage(chatId, { 
                        text: `⏳ *This group requires approval to join*\n\n` +
                              `📌 *Group:* ${inviteInfo.subject || 'Unknown'}\n` +
                              `👥 *Members:* ${inviteInfo.size || 'Unknown'}\n` +
                              `📝 *Description:* ${inviteInfo.desc || 'No description'}\n\n` +
                              `✅ Join request has been sent! An admin will review your request.\n` +
                              `You'll be added when approved.` 
                    });
                    
                    // Log the request
                    console.log(`📨 Join request sent for group: ${inviteInfo.subject || inviteCode}`);
                } else {
                    await sock.sendMessage(chatId, { 
                        text: '⏳ *This group requires approval to join*\n\nJoin request has been sent! You\'ll be added when an admin approves.' 
                    });
                }
                return;
            }
            
            // Re-throw other errors
            throw joinError;
        }

        // If we get here, join was successful
        if (!groupJid) {
            throw new Error('Failed to get group JID');
        }

        // Wait for group to be fully joined
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Get group metadata
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

        // Send confirmation
        await sock.sendMessage(chatId, { 
            text: `✅ *Successfully joined group!*\n\n` +
                  `📌 *Group Name:* ${groupName}\n` +
                  `👥 *Members:* ${memberCount}\n` +
                  `📝 *Description:* ${groupDesc.substring(0, 100)}${groupDesc.length > 100 ? '...' : ''}\n` +
                  `👑 *Group Owner:* ${ownerName}\n` +
                  `🔒 *Restricted:* ${groupRestrict}\n` +
                  `🔇 *Announcement Mode:* ${groupAnnounce}\n` +
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

        console.log(`✅ Bot joined group: ${groupName} (${groupJid})`);

    } catch (error) {
        console.error('Group join error:', error);
        
        if (error.message?.includes('not-authorized') || error.data === 401) {
            await sock.sendMessage(chatId, { 
                text: '❌ Invalid or expired invite link.' 
            });
        } else if (error.message?.includes('already-exists') || error.data === 304) {
            await sock.sendMessage(chatId, { 
                text: '❌ Bot is already a member of this group!' 
            });
        } else {
            throw error;
        }
    }
}

async function handleChannelJoin(sock, chatId, message, channelId) {
    try {
        // Format channel JID
        const channelJid = channelId.includes('@newsletter') ? channelId : `${channelId}@newsletter`;
        
        // Try to follow the channel
        try {
            await sock.newsletterFollow(channelJid);
            
            // Get channel info if possible
            let channelName = 'Unknown Channel';
            try {
                const [metadata] = await sock.newsletterMetadata('me', [channelJid]);
                channelName = metadata[channelJid]?.name || 'Unknown Channel';
            } catch (e) {
                console.log('Could not fetch channel metadata:', e);
            }
            
            await sock.sendMessage(chatId, { 
                text: `✅ *Successfully joined channel!*\n\n📌 *Channel:* ${channelName}\n🔗 *JID:* ${channelJid}` 
            });
            
            console.log(`📢 Bot joined channel: ${channelName} (${channelJid})`);
            
        } catch (followError) {
            if (followError.message?.includes('already-exists') || followError.data === 304) {
                await sock.sendMessage(chatId, { 
                    text: `✅ Bot is already following this channel!\n🔗 *JID:* ${channelJid}` 
                });
            } else {
                throw followError;
            }
        }
        
    } catch (error) {
        console.error('Channel join error:', error);
        await sock.sendMessage(chatId, { 
            text: '❌ Failed to join channel. Invalid link or channel doesn\'t exist.' 
        });
    }
}

module.exports = joinCommand;
