async function joinCommand(sock, chatId, message, args) {
    try {
        if (args.length === 0) {
            await sock.sendMessage(chatId, { 
                text: '❌ Please provide a link!\n\nUsage: `.join [link]`\n\nSupported links:\n• Group invite: https://chat.whatsapp.com/...\n• Channel link: https://whatsapp.com/channel/...' 
            });
            return;
        }

        const input = args[0].trim();
        
        // Detect link type
        let linkType = 'unknown';
        let code = '';
        
        if (input.includes('chat.whatsapp.com/')) {
            // Group link
            code = input.split('chat.whatsapp.com/')[1].split('?')[0].split('/')[0].trim();
            linkType = 'group';
        } else if (input.includes('whatsapp.com/channel/')) {
            // Channel link
            code = input.split('whatsapp.com/channel/')[1].split('?')[0].split('/')[0].trim();
            linkType = 'channel';
        } else {
            // Try as direct code
            code = input;
            linkType = 'group';
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
        // First, check if we can get invite info
        let inviteInfo = null;
        try {
            inviteInfo = await sock.groupGetInviteInfo(inviteCode);
        } catch (infoError) {
            console.log('Could not get invite info:', infoError.message);
            // Continue anyway - some invites don't allow preview
        }

        // Check if bot is already in this group by trying to fetch all groups
        try {
            const groups = await sock.groupFetchAllParticipating();
            
            // Look for group with matching invite code or subject
            for (const [jid, group] of Object.entries(groups)) {
                if (group.inviteCode === inviteCode || 
                    (inviteInfo && group.subject === inviteInfo.subject)) {
                    // Bot is already in this group
                    await sock.sendMessage(chatId, { 
                        text: `✅ Bot was already in this group!\n\n📌 *Group:* ${group.subject}\n👥 *Members:* ${group.participants?.length || 0}\n🔗 *JID:* ${jid}` 
                    });
                    return;
                }
            }
        } catch (e) {
            console.log('Error checking existing groups:', e);
        }

        // Try to join the group
        let groupJid;
        try {
            groupJid = await sock.groupAcceptInvite(inviteCode);
        } catch (joinError) {
            // Handle specific join errors
            if (joinError.message?.includes('already-exists') || joinError.data === 304) {
                // Bot already in group - try to find it in groups list
                try {
                    const groups = await sock.groupFetchAllParticipating();
                    // Find the group - this is tricky without more info
                    await sock.sendMessage(chatId, { 
                        text: '✅ Bot is already a member of this group! (Details unavailable)' 
                    });
                } catch {
                    await sock.sendMessage(chatId, { 
                        text: '✅ Bot is already a member of this group!' 
                    });
                }
                return;
            }
            
            if (joinError.message?.includes('conflict') || joinError.data === 409) {
                // Group requires approval to join
                if (inviteInfo) {
                    await sock.sendMessage(chatId, { 
                        text: `⏳ *This group requires approval to join*\n\n` +
                              `📌 *Group:* ${inviteInfo.subject || 'Unknown'}\n` +
                              `👥 *Members:* ${inviteInfo.size || 'Unknown'}\n` +
                              `📝 *Description:* ${inviteInfo.desc || 'No description'}\n\n` +
                              `✅ Join request has been sent! You'll be added when approved.` 
                    });
                } else {
                    await sock.sendMessage(chatId, { 
                        text: '⏳ *This group requires approval to join*\n\nJoin request sent! You\'ll be added when an admin approves.' 
                    });
                }
                return;
            }
            
            // Re-throw other errors
            throw joinError;
        }

        // If we get here but no JID, something went wrong
        if (!groupJid) {
            // Try to find the newly joined group
            await new Promise(resolve => setTimeout(resolve, 3000)); // Wait 3 seconds
            
            const groups = await sock.groupFetchAllParticipating();
            
            // Look for the most recently joined group (by invite code or subject)
            let joinedGroup = null;
            if (inviteInfo) {
                joinedGroup = Object.entries(groups).find(([_, g]) => 
                    g.subject === inviteInfo.subject
                );
            }
            
            if (joinedGroup) {
                groupJid = joinedGroup[0];
            } else {
                // If we can't find it, just confirm success without details
                await sock.sendMessage(chatId, { 
                    text: `✅ *Successfully joined group!*\n\n(Unable to fetch group details, but join was successful)` 
                });
                console.log(`✅ Bot joined a group (JID unknown)`);
                return;
            }
        }

        // Get full group metadata
        await new Promise(resolve => setTimeout(resolve, 2000));
        const groupMetadata = await sock.groupMetadata(groupJid);
        
        const groupName = groupMetadata.subject || 'Unnamed Group';
        const memberCount = groupMetadata.participants?.length || 0;
        const groupDesc = groupMetadata.desc || 'No description';
        const groupOwner = groupMetadata.owner || 'Unknown';
        const groupCreation = groupMetadata.creation || 'Unknown';
        const groupRestrict = groupMetadata.restrict ? 'Yes' : 'No';
        const groupAnnounce = groupMetadata.announce ? 'Yes' : 'No';
        
        // Check if bot is admin
        const botId = sock.user.id.split(':')[0] + '@s.whatsapp.net';
        const botParticipant = groupMetadata.participants?.find(p => p.id === botId);
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
        
        // Handle specific error cases
        if (error.message?.includes('not-authorized') || error.data === 401) {
            await sock.sendMessage(chatId, { 
                text: '❌ Invalid or expired invite link.' 
            });
        } else if (error.message?.includes('already-exists') || error.data === 304) {
            await sock.sendMessage(chatId, { 
                text: '❌ Bot is already a member of this group!' 
            });
        } else {
            // Generic error but still try to confirm if join actually succeeded
            await sock.sendMessage(chatId, { 
                text: '⚠️ There was an error fetching group details, but the join may have succeeded. Check if the bot is in the group.' 
            });
        }
    }
}

async function handleChannelJoin(sock, chatId, message, channelId) {
    try {
        // Format channel JID
        const channelJid = channelId.includes('@newsletter') ? channelId : `${channelId}@newsletter`;
        
        // Different Baileys versions have different methods for channels
        let followed = false;
        
        // Try different possible method names
        try {
            // Method 1: newsletterFollow
            if (sock.newsletterFollow) {
                await sock.newsletterFollow(channelJid);
                followed = true;
            }
            // Method 2: followNewsletter
            else if (sock.followNewsletter) {
                await sock.followNewsletter(channelJid);
                followed = true;
            }
            // Method 3: joinNewsletter
            else if (sock.joinNewsletter) {
                await sock.joinNewsletter(channelJid);
                followed = true;
            }
            else {
                // No method found - channel joining might not be supported
                await sock.sendMessage(chatId, { 
                    text: '❌ Channel joining is not supported in this version of Baileys.' 
                });
                return;
            }
        } catch (followError) {
            if (followError.message?.includes('already-exists') || followError.data === 304) {
                // Already following
                followed = true;
            } else {
                throw followError;
            }
        }
        
        if (followed) {
            // Try to get channel info (may not be available in all versions)
            let channelName = 'Unknown Channel';
            try {
                if (sock.newsletterMetadata) {
                    const metadata = await sock.newsletterMetadata('me', [channelJid]);
                    channelName = metadata[channelJid]?.name || 'Unknown Channel';
                }
            } catch (e) {
                console.log('Could not fetch channel metadata:', e);
            }
            
            await sock.sendMessage(chatId, { 
                text: `✅ *Successfully joined channel!*\n\n📌 *Channel:* ${channelName}\n🔗 *JID:* ${channelJid}` 
            });
            
            console.log(`📢 Bot joined channel: ${channelName} (${channelJid})`);
        }
        
    } catch (error) {
        console.error('Channel join error:', error);
        
        // Check if it's a "bad request" error (channel doesn't exist)
        if (error.message?.includes('Bad Request') || error.data === 400) {
            await sock.sendMessage(chatId, { 
                text: '❌ Invalid channel link or channel does not exist.' 
            });
        } else {
            await sock.sendMessage(chatId, { 
                text: '❌ Failed to join channel. Make sure the link is correct.' 
            });
        }
    }
}

module.exports = joinCommand;
