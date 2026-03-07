async function newletCommand(sock, chatId, message) {
    try {
        // Check if the command is used in a newsletter/channel
        if (!chatId.endsWith('@newsletter')) {
            await sock.sendMessage(chatId, { 
                text: '❌ This command can only be used in a WhatsApp Channel (Newsletter)!\n\nPlease go to a channel and try again.' 
            });
            return;
        }

        // Extract the newsletter ID
        const newsletterId = chatId.split('@')[0];
        const fullJid = chatId; // This is already the full JID (id@newsletter)

        // Get newsletter info if available
        let newsletterName = 'Unknown';
        try {
            // Try to get newsletter metadata
            const newsletterInfo = await sock.newsletterMetadata("jid", chatId);
            if (newsletterInfo && newsletterInfo[chatId]) {
                newsletterName = newsletterInfo[chatId].name || 'Unknown';
            }
        } catch (error) {
            console.log('Could not fetch newsletter metadata:', error.message);
        }

        // Create the response message
        const response = `
╔═══════════════════╗
   📢 *Channel Information*
╚═══════════════════╝

📌 *Channel Name:* ${newsletterName}
🆔 *Newsletter ID:* \`${newsletterId}\`
🔗 *Full JID:* \`${fullJid}\`

📋 *Usage Examples:*
• Use this ID for channel features
• Share with bot developers
• Use in other newsletter commands

💡 *Note:* This ID is unique to this channel
        `;

        await sock.sendMessage(chatId, { 
            text: response,
            contextInfo: {
                forwardingScore: 1,
                isForwarded: true,
                forwardedNewsletterMessageInfo: {
                    newsletterJid: chatId, // Use current channel
                    newsletterName: newsletterName,
                    serverMessageId: -1
                }
            }
        });

        // Also send the raw ID in a copyable format
        await sock.sendMessage(chatId, {
            text: `📋 *Copyable ID:*\n\`${fullJid}\``
        });

        console.log(`📢 Newsletter ID fetched: ${fullJid} for channel: ${newsletterName}`);

    } catch (error) {
        console.error('Newsletter command error:', error);
        await sock.sendMessage(chatId, { 
            text: '❌ Failed to get newsletter information. Make sure you are in a valid WhatsApp Channel.' 
        });
    }
}

module.exports = newletCommand;
