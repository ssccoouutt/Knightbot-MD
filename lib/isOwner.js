const settings = require('../settings');
const { isSudo, getSudoList } = require('./index');

async function isOwnerOrSudo(senderId, sock = null, chatId = null) {
    const ownerJid = settings.ownerNumber + "@s.whatsapp.net";
    const ownerNumberClean = settings.ownerNumber.split(':')[0].split('@')[0];
    
    // Debug: Log what we're checking
    console.log('\n========== OWNER/SUDO CHECK ==========');
    console.log('📱 Checking sender:', senderId);
    console.log('👑 Owner JID:', ownerJid);
    console.log('🔢 Owner Clean:', ownerNumberClean);
    
    // Direct JID match
    if (senderId === ownerJid) {
        console.log('✅ Direct owner JID match!');
        return true;
    }
    
    // Extract sender's numeric parts
    const senderIdClean = senderId.split(':')[0].split('@')[0];
    const senderLidNumeric = senderId.includes('@lid') ? senderId.split('@')[0].split(':')[0] : '';
    
    console.log('🧹 Sender Clean:', senderIdClean);
    console.log('🆔 Sender LID:', senderLidNumeric);
    
    // Check if sender's phone number matches owner number
    if (senderIdClean === ownerNumberClean) {
        console.log('✅ Phone number matches owner!');
        return true;
    }
    
    // In groups, check if sender's LID matches bot's LID (owner uses same account as bot)
    if (sock && chatId && chatId.endsWith('@g.us') && senderId.includes('@lid')) {
        console.log('👥 Checking group participant data...');
        try {
            // Get bot's LID numeric
            const botLid = sock.user?.lid || '';
            const botLidNumeric = botLid.includes(':') ? botLid.split(':')[0] : (botLid.includes('@') ? botLid.split('@')[0] : botLid);
            
            console.log('🤖 Bot LID:', botLidNumeric);
            
            // Check if sender's LID numeric matches bot's LID numeric
            if (senderLidNumeric && botLidNumeric && senderLidNumeric === botLidNumeric) {
                console.log('✅ LID matches bot!');
                return true;
            }
            
            // Also check participant data for additional matching
            const metadata = await sock.groupMetadata(chatId);
            const participants = metadata.participants || [];
            
            const participant = participants.find(p => {
                const pLid = p.lid || '';
                const pLidNumeric = pLid.includes(':') ? pLid.split(':')[0] : (pLid.includes('@') ? pLid.split('@')[0] : pLid);
                const pId = p.id || '';
                const pIdClean = pId.split(':')[0].split('@')[0];
                
                return (
                    p.lid === senderId || 
                    p.id === senderId ||
                    pLidNumeric === senderLidNumeric ||
                    pIdClean === senderIdClean ||
                    pIdClean === ownerNumberClean
                );
            });
            
            if (participant) {
                const participantId = participant.id || '';
                const participantLid = participant.lid || '';
                const participantIdClean = participantId.split(':')[0].split('@')[0];
                const participantLidNumeric = participantLid.includes(':') ? participantLid.split(':')[0] : (participantLid.includes('@') ? participantLid.split('@')[0] : participantLid);
                
                if (participantId === ownerJid || 
                    participantIdClean === ownerNumberClean ||
                    participantLidNumeric === botLidNumeric) {
                    console.log('✅ Found matching participant!');
                    return true;
                }
            }
        } catch (e) {
            console.error('❌ [isOwner] Error checking participant data:', e);
        }
    }
    
    // Check if sender ID contains owner number (fallback)
    if (senderId.includes(ownerNumberClean)) {
        console.log('✅ Sender ID contains owner number!');
        return true;
    }
    
    // Check sudo status
    console.log('🔍 Checking sudo status...');
    try {
        const sudoList = await getSudoList();
        console.log('📋 Current sudo list:', sudoList);
        
        const isSudoUser = await isSudo(senderId);
        console.log('👤 Is sudo user?', isSudoUser);
        
        if (isSudoUser) {
            console.log('✅ User is in sudo list!');
            return true;
        } else {
            console.log('❌ User is NOT in sudo list');
        }
    } catch (e) {
        console.error('❌ [isOwner] Error checking sudo:', e);
    }
    
    console.log('❌ All checks failed - access denied');
    console.log('=====================================\n');
    return false;
}

module.exports = isOwnerOrSudo;
