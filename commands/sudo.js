const settings = require('../settings');
const { addSudo, removeSudo, getSudoList } = require('../lib/index');
const isOwnerOrSudo = require('../lib/isOwner');

async function sudoCommand(sock, chatId, message) {
    const senderJid = message.key.participant || message.key.remoteJid;
    const isOwner = message.key.fromMe || await isOwnerOrSudo(senderJid, sock, chatId);

    const rawText = message.message?.conversation || message.message?.extendedTextMessage?.text || '';
    const args = rawText.trim().split(' ').slice(1);
    const sub = (args[0] || '').toLowerCase();

    if (!sub || !['add', 'del', 'remove', 'list'].includes(sub)) {
        await sock.sendMessage(chatId, { text: 'Usage:\n.sudo add <number>\n.sudo del <number>\n.sudo list' },{quoted :message});
        return;
    }

    if (sub === 'list') {
        const list = await getSudoList();
        if (list.length === 0) {
            await sock.sendMessage(chatId, { text: 'No sudo users set.' },{quoted :message});
            return;
        }
        const text = list.map((j, i) => `${i + 1}. ${j.split('@')[0]}`).join('\n');
        await sock.sendMessage(chatId, { text: `Sudo users:\n${text}` },{quoted :message});
        return;
    }

    if (!isOwner) {
        await sock.sendMessage(chatId, { text: '❌ Only owner can add/remove sudo users.' },{quoted :message});
        return;
    }

    const targetNumber = args[1]?.replace(/[^0-9]/g, '');
    if (!targetNumber) {
        await sock.sendMessage(chatId, { text: 'Please provide a number.' },{quoted :message});
        return;
    }

    if (sub === 'add') {
        await addSudo(targetNumber);
        await sock.sendMessage(chatId, { text: `✅ Added sudo: ${targetNumber}` },{quoted :message});
        return;
    }

    if (sub === 'del' || sub === 'remove') {
        const ownerNumber = settings.ownerNumber.split('@')[0];
        if (targetNumber === ownerNumber) {
            await sock.sendMessage(chatId, { text: 'Owner cannot be removed.' },{quoted :message});
            return;
        }
        await removeSudo(targetNumber);
        await sock.sendMessage(chatId, { text: `✅ Removed sudo: ${targetNumber}` },{quoted :message});
        return;
    }
}

module.exports = sudoCommand;
