const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { NewMessage } = require('telegram/events');
const fs = require('fs');
const path = require('path');

const CONFIG_FILE = path.join(process.cwd(), 'data', 'telegram_bridge.json');
const TEMP_DIR = path.join(process.cwd(), 'temp');
let telegramClient = null;
let isActive = false;

if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

const API_ID = 32086282;
const API_HASH = "064a66fe7097452e6ac8f4e8df28aa97";

function loadConfig() {
    try {
        if (fs.existsSync(CONFIG_FILE)) {
            return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
        }
    } catch (e) {}
    return {
        botToken: null,
        whatsappNumber: null,
        active: false
    };
}

function saveConfig(config) {
    fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

function debugEntityProcessing(text, entities) {
    console.log('\n🔍 ====== ENTITY DEBUG START ======');
    console.log(`📝 Full text: "${text}"`);
    console.log(`📊 Text length: ${text.length}`);
    console.log(`📋 Entity count: ${entities?.length || 0}`);
    
    if (entities && entities.length > 0) {
        entities.forEach((entity, index) => {
            console.log(`\n--- Entity ${index + 1} ---`);
            console.log(`  Type: ${entity.className}`);
            console.log(`  Offset: ${entity.offset}`);
            console.log(`  Length: ${entity.length}`);
            
            // Extract the exact substring
            const substring = text.substring(entity.offset, entity.offset + entity.length);
            console.log(`  Raw content: "${substring}"`);
            console.log(`  Content length: ${substring.length}`);
            
            // Show character codes for debugging
            const charCodes = [];
            for (let i = 0; i < substring.length; i++) {
                charCodes.push(substring.charCodeAt(i));
            }
            console.log(`  Char codes: [${charCodes.join(', ')}]`);
        });
    }
    console.log('🔍 ====== ENTITY DEBUG END ======\n');
}

function clean_whatsapp_text(text, entities) {
    if (!text) return text;
    
    // DEBUG: Show input
    debugEntityProcessing(text, entities);
    
    if (entities && entities.length > 0) {
        let result = [];
        let lastPos = 0;
        
        const sorted = [...entities].sort((a, b) => a.offset - b.offset);
        
        for (const entity of sorted) {
            // Add text before entity
            if (entity.offset > lastPos) {
                const beforeText = text.substring(lastPos, entity.offset);
                console.log(`📎 Before entity: "${beforeText}"`);
                result.push(beforeText);
            }
            
            // Get the raw content
            let content = text.substring(entity.offset, entity.offset + entity.length);
            console.log(`📦 Raw entity content: "${content}"`);
            
            // Try different cleaning methods and log results
            const method1 = content.replace(/\*\*/g, '');
            console.log(`  Method1 (remove **): "${method1}"`);
            
            const method2 = content.replace(/[*]/g, '');
            console.log(`  Method2 (remove *): "${method2}"`);
            
            const method3 = content.substring(2, content.length - 2);
            console.log(`  Method3 (slice 2): "${method3}"`);
            
            // Choose method based on what works
            let cleaned = content;
            if (content.startsWith('**') && content.endsWith('**')) {
                cleaned = content.substring(2, content.length - 2);
                console.log(`  ✅ Using method3 (slice) -> "${cleaned}"`);
            } else if (content.includes('**')) {
                cleaned = content.replace(/\*\*/g, '');
                console.log(`  ✅ Using method1 (replace **) -> "${cleaned}"`);
            } else {
                cleaned = content.replace(/[*_~`]/g, '');
                console.log(`  ✅ Using method2 (remove all) -> "${cleaned}"`);
            }
            
            // Apply WhatsApp formatting
            let formatted = cleaned;
            if (entity.className === 'MessageEntityBold') {
                formatted = `*${cleaned}*`;
                console.log(`  ✨ Applied bold: "${formatted}"`);
            }
            else if (entity.className === 'MessageEntityItalic') {
                formatted = `_${cleaned}_`;
                console.log(`  ✨ Applied italic: "${formatted}"`);
            }
            else if (entity.className === 'MessageEntityStrike') {
                formatted = `~${cleaned}~`;
                console.log(`  ✨ Applied strike: "${formatted}"`);
            }
            else if (entity.className === 'MessageEntityCode' || entity.className === 'MessageEntityPre') {
                formatted = `\`\`\`${cleaned}\`\`\``;
                console.log(`  ✨ Applied code: "${formatted}"`);
            }
            
            result.push(formatted);
            lastPos = entity.offset + entity.length;
        }
        
        // Add remaining text
        if (lastPos < text.length) {
            const afterText = text.substring(lastPos);
            console.log(`📎 After entities: "${afterText}"`);
            result.push(afterText);
        }
        
        const final = result.join('');
        console.log(`\n✅ FINAL RESULT: "${final}"`);
        return final;
    }
    
    console.log(`⚠️ No entities, returning raw: "${text}"`);
    return text;
}

async function downloadMedia(client, message) {
    try {
        console.log(`📥 Downloading media for message ${message.id}...`);
        const tempFile = path.join(TEMP_DIR, `tg_${message.id}`);
        await client.downloadMedia(message, { outputFile: tempFile });
        const buffer = fs.readFileSync(tempFile);
        fs.unlinkSync(tempFile);
        console.log(`✅ Downloaded ${buffer.length} bytes`);
        return buffer;
    } catch (error) {
        console.log(`❌ Download failed: ${error.message}`);
        return null;
    }
}

async function startTelegramBot(sock, chatId) {
    const config = loadConfig();
    
    if (!config.botToken) {
        await sock.sendMessage(chatId, { text: '❌ Set bot token first: `.settoken TOKEN`' });
        return false;
    }
    
    if (!config.whatsappNumber) {
        await sock.sendMessage(chatId, { text: '❌ Set WhatsApp number first: `.setwa NUMBER`' });
        return false;
    }

    try {
        if (telegramClient) await telegramClient.disconnect();
        
        const whatsappJid = config.whatsappNumber.includes('@s.whatsapp.net') ?
            config.whatsappNumber :
            `${config.whatsappNumber}@s.whatsapp.net`;
        
        telegramClient = new TelegramClient(new StringSession(""), API_ID, API_HASH, {
            connectionRetries: 5
        });
        
        await telegramClient.start({ botAuthToken: config.botToken });
        console.log('✅ Connected to Telegram');
        
        async function messageHandler(event) {
            try {
                const msg = event.message;
                if (!msg) return;
                
                // Skip commands
                if (msg.text && msg.text.startsWith('/')) return;
                
                const text = msg.text || '';
                const entities = msg.entities || [];
                
                console.log('\n📨 ===== NEW MESSAGE RECEIVED =====');
                console.log(`Raw text: "${text}"`);
                console.log(`Has media: ${!!msg.media}`);
                console.log(`Entity count: ${entities.length}`);
                
                // Process formatting
                const formatted = clean_whatsapp_text(text, entities);
                
                if (text && !msg.media) {
                    console.log(`💬 Sending text to WhatsApp: "${formatted}"`);
                    await sock.sendMessage(whatsappJid, { text: formatted });
                }
                
                if (msg.media) {
                    const buffer = await downloadMedia(telegramClient, msg);
                    if (!buffer) return;
                    
                    console.log(`📤 Sending media with caption: "${formatted}"`);
                    
                    if (msg.photo) {
                        await sock.sendMessage(whatsappJid, {
                            image: buffer,
                            caption: formatted
                        });
                    }
                    else if (msg.video) {
                        await sock.sendMessage(whatsappJid, {
                            video: buffer,
                            caption: formatted
                        });
                    }
                    else if (msg.document) {
                        const fileName = msg.document.attributes
                            .find(a => a.className === 'DocumentAttributeFilename')?.fileName || 'file';
                        
                        await sock.sendMessage(whatsappJid, {
                            document: buffer,
                            fileName: fileName,
                            caption: formatted
                        });
                    }
                    else if (msg.audio) {
                        await sock.sendMessage(whatsappJid, {
                            audio: buffer,
                            caption: formatted
                        });
                    }
                    else if (msg.voice) {
                        await sock.sendMessage(whatsappJid, {
                            audio: buffer,
                            ptt: true
                        });
                    }
                    else if (msg.sticker) {
                        await sock.sendMessage(whatsappJid, {
                            sticker: buffer
                        });
                    }
                }
                
                console.log('✅ ===== MESSAGE PROCESSED =====\n');
                
            } catch (err) {
                console.error('❌ Error in message handler:', err);
            }
        }
        
        telegramClient.addEventHandler(messageHandler, new NewMessage({}));
        
        isActive = true;
        config.active = true;
        saveConfig(config);
        
        await sock.sendMessage(chatId, { text: '✅ Bridge active - Debug mode enabled' });
        return true;
        
    } catch (error) {
        console.error('Start error:', error);
        await sock.sendMessage(chatId, { text: '❌ Failed' });
        return false;
    }
}

async function telegramCommand(sock, chatId, message, args) {
    const sub = args[0]?.toLowerCase();
    const config = loadConfig();
    
    if (!sub) {
        await sock.sendMessage(chatId, { 
            text: `📊 Status\nActive: ${isActive ? '✅' : '❌'}\nToken: ${config.botToken ? '✅' : '❌'}\nWhatsApp: ${config.whatsappNumber || 'Not set'}\n\nCommands:\n.on\n.off\n.settoken\n.setwa`
        });
        return;
    }
    
    switch (sub) {
        case 'on':
            await startTelegramBot(sock, chatId);
            break;
        case 'off':
            if (telegramClient) await telegramClient.disconnect();
            isActive = false;
            config.active = false;
            saveConfig(config);
            await sock.sendMessage(chatId, { text: '🔴 Stopped' });
            break;
    }
}

async function setTokenCommand(sock, chatId, message, token) {
    if (!token) return await sock.sendMessage(chatId, { text: '❌ Provide token' });
    const config = loadConfig();
    config.botToken = token;
    saveConfig(config);
    await sock.sendMessage(chatId, { text: '✅ Token saved' });
}

async function setWaCommand(sock, chatId, message, number) {
    if (!number) return await sock.sendMessage(chatId, { text: '❌ Provide number' });
    const cleanNumber = number.replace(/[^0-9]/g, '');
    const config = loadConfig();
    config.whatsappNumber = cleanNumber;
    saveConfig(config);
    await sock.sendMessage(chatId, { text: `✅ WhatsApp set: ${cleanNumber}` });
}

module.exports = {
    telegramCommand,
    setTokenCommand,
    setWaCommand
};
