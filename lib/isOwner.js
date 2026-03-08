const settings = require('../settings');
const { getSudoList } = require('./index');

async function isOwnerOrSudo(senderId, sock = null, chatId = null) {
    const ownerNumber = settings.ownerNumber.split(':')[0].split('@')[0];
    
    // Extract phone number from sender ID (remove @lid, @s.whatsapp.net, device IDs)
    const senderNumber = senderId.split(':')[0].split('@')[0];
    
    console.log('\n========== OWNER/SUDO CHECK ==========');
    console.log('📱 Sender:', senderId);
    console.log('📞 Sender Number:', senderNumber);
    console.log('👑 Owner Number:', ownerNumber);
    
    // Check if owner
    if (senderNumber === ownerNumber) {
        console.log('✅ Owner match!');
        return true;
    }
    
    // Check sudo list (just compare numbers!)
    try {
        const sudoList = await getSudoList();
        console.log('📋 Sudo list:', sudoList);
        
        for (const sudoEntry of sudoList) {
            // Extract number from sudo entry
            const sudoNumber = sudoEntry.split(':')[0].split('@')[0];
            console.log(`🔍 Comparing ${senderNumber} with ${sudoNumber}`);
            
            if (senderNumber === sudoNumber) {
                console.log('✅ Sudo match found!');
                return true;
            }
        }
        
        console.log('❌ No match found');
    } catch (e) {
        console.error('Error checking sudo:', e);
    }
    
    console.log('=====================================\n');
    return false;
}

module.exports = isOwnerOrSudo;
