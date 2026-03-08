const settings = require('../settings');
const { addSudo, removeSudo, getSudoList } = require('../lib/index');
const isOwnerOrSudo = require('../lib/isOwner');

function extractMentionedJid(message, sock, chatId) {
    // First check for mentioned users
    const mentioned = message.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
    if (mentioned.length > 0) return mentioned[0];
    
    // Check for number in text
    const text = message.message?.conversation || message.message?.extendedTextMessage?.text || '';
    const match = text.match(/\b(\d{7,15})\b/);
    if (match) {
        const phoneNumber = match[1];
        
        // If we have group context, try to find the LID for this number
        if (sock && chatId && chatId.endsWith('@g.us')) {
            try {
                // This will be handled in the command with await
                return { type: 'phone', number: phoneNumber };
            } catch (e) {
                console.error('Error getting LID:', e);
            }
        }
        return phoneNumber + '@s.whatsapp.net';
    }
    return null;
}

async function sudoCommand(sock, chatId, message) {
    const senderJid = message.key.participant || message.key.remoteJid;
    const isOwner = message.key.fromMe || await isOwnerOrSudo(senderJid, sock, chatId);

    const rawText = message.message?.conversation || message.message?.extendedTextMessage?.text || '';
    const args = rawText.trim().split(' ').slice(1);
    const sub = (args[0] || '').toLowerCase();

    if (!sub || !['add', 'del', 'remove', 'list'].includes(sub)) {
        await sock.sendMessage(chatId, { text: 'Usage:\n.sudo add <@user|number>\n.sudo del <@user|number>\n.sudo list' },{quoted :message});
        return;
    }

    if (sub === 'list') {
        const list = await getSudoList();
        if (list.length === 0) {
            await sock.sendMessage(chatId, { text: 'No sudo users set.' },{quoted :message});
            return;
        }
        const text = list.map((j, i) => `${i + 1}. ${j}`).join('\n');
        await sock.sendMessage(chatId, { text: `Sudo users:\n${text}` },{quoted :message});
        return;
    }

    if (!isOwner) {
        await sock.sendMessage(chatId, { text: '❌ Only owner can add/remove sudo users. Use .sudo list to view.' },{quoted :message});
        return;
    }

    // Get target - could be JID or phone number
    const target = extractMentionedJid(message, sock, chatId);
    if (!target) {
        await sock.sendMessage(chatId, { text: 'Please mention a user or provide a number.' },{quoted :message});
        return;
    }

    let targetJid = target;
    
    // If it's a phone number and we're in a group, try to get the LID
    if (target.type === 'phone' && sock && chatId && chatId.endsWith('@g.us')) {
        try {
            const groupMetadata = await sock.groupMetadata(chatId);
            const participant = groupMetadata.participants.find(p => 
                p.id.includes(target.number)
            );
            if (participant && participant.lid) {
                targetJid = participant.lid; // Use LID instead of phone number!
                console.log('✅ Found LID for number:', target.number, '->', targetJid);
            } else {
                targetJid = target.number + '@s.whatsapp.net';
            }
        } catch (e) {
            console.error('Error finding LID:', e);
            targetJid = target.number + '@s.whatsapp.net';
        }
    }

    if (sub === 'add') {
        const ok = await addSudo(targetJid);
        await sock.sendMessage(chatId, { text: ok ? `✅ Added sudo: ${targetJid}` : '❌ Failed to add sudo' },{quoted :message});
        return;
    }

    if (sub === 'del' || sub === 'remove') {
        const ownerJid = settings.ownerNumber + '@s.whatsapp.net';
        if (targetJid === ownerJid) {
            await sock.sendMessage(chatId, { text: 'Owner cannot be removed.' },{quoted :message});
            return;
        }
        const ok = await removeSudo(targetJid);
        await sock.sendMessage(chatId, { text: ok ? `✅ Removed sudo: ${targetJid}` : '❌ Failed to remove sudo' },{quoted :message});
        return;
    }
}

module.exports = sudoCommand;
