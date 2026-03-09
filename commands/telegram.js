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

// EXACT pattern from your Python script
function clean_whatsapp_text(text, entities) {
    if (!text) return text;
    
    // If we have entities, build from scratch using plain text + entities
    if (entities && entities.length > 0) {
        // Start with the plain text (without any markdown)
        let result = [];
        let lastPos = 0;
        
        // Sort entities by offset
        const sorted = [...entities].sort((a, b) => a.offset - b.offset);
        
        for (const entity of sorted) {
            // Add plain text before entity
            if (entity.offset > lastPos) {
                result.push(text.substring(lastPos, entity.offset));
            }
            
            const content = text.substring(entity.offset, entity.offset + entity.length);
            
            // Apply formatting based on entity type
            if (entity.className === 'MessageEntityBold') {
                result.push(`*${content}*`);
            }
            else if (entity.className === 'MessageEntityItalic') {
                result.push(`_${content}_`);
            }
            else if (entity.className === 'MessageEntityStrike') {
                result.push(`~${content}~`);
            }
            else if (entity.className === 'MessageEntityCode' || entity.className === 'MessageEntityPre') {
                result.push(`\`\`\`${content}\`\`\``);
            }
            else {
                result.push(content);
            }
            
            lastPos = entity.offset + entity.length;
        }
        
        // Add remaining text
        if (lastPos < text.length) {
            result.push(text.substring(lastPos));
        }
        
        return result.join('');
    }
    
    // No entities - return plain text as is
    return text;
}

async function downloadMedia(client, message) {
    try {
        const tempFile = path.join(TEMP_DIR, `tg_${message.id}`);
        await client.downloadMedia(message, { outputFile: tempFile });
        const buffer = fs.readFileSync(tempFile);
        fs.unlinkSync(tempFile);
        return buffer;
    } catch (error) {
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
        console.log('✅ Connected');
        
        async function messageHandler(event) {
            try {
                const msg = event.message;
                if (!msg) return;
                
                // Skip commands
                if (msg.text && msg.text.startsWith('/')) return;
                
                const text = msg.text || '';
                const entities = msg.entities || [];
                
                // DEBUG
                console.log(`📨 Raw: ${text}`);
                if (entities.length > 0) {
                    console.log(`📋 Entities: ${entities.map(e => e.className).join(', ')}`);
                }
                
                const formatted = clean_whatsapp_text(text, entities);
                console.log(`✨ Formatted: ${formatted}`);
                
                // TEXT ONLY
                if (text && !msg.media) {
                    await sock.sendMessage(whatsappJid, { text: formatted });
                    return;
                }
                
                // MEDIA handling...
                const buffer = await downloadMedia(telegramClient, msg);
                if (!buffer) return;
                
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
                
            } catch (err) {
                console.error('Error:', err.message);
            }
        }
        
        telegramClient.addEventHandler(messageHandler, new NewMessage({}));
        
        isActive = true;
        config.active = true;
        saveConfig(config);
        
        await sock.sendMessage(chatId, { text: '✅ Bridge active' });
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
