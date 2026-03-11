/**
 * Knight Bot - COMPLETE STANDALONE VERSION
 * No dependencies on main.js - everything works here
 */
const { Boom } = require('@hapi/boom')
const fs = require('fs')
const chalk = require('chalk')
const path = require('path')
const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
    downloadContentFromMessage,
    jidDecode,
    delay
} = require("@whiskeysockets/baileys")
const pino = require("pino")
const readline = require("readline")
const { rmSync } = require('fs')

// Settings
const phoneNumber = "923247220362"
const owner = ["923247220362"]

global.botname = "KNIGHT BOT"
global.themeemoji = "•"
const pairingCode = true // Use pairing code instead of QR

// Readline for pairing code
const rl = process.stdin.isTTY ? readline.createInterface({ input: process.stdin, output: process.stdout }) : null
const question = (text) => {
    if (rl) {
        return new Promise((resolve) => rl.question(text, resolve))
    } else {
        return Promise.resolve(phoneNumber)
    }
}

// Channel ID
const CHANNEL_ID = "120363405181626845@newsletter";

// Logger
function log(level, msg, data) {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [${level}] ${msg}`);
    if (data) console.log(JSON.stringify(data, null, 2));
}

async function startBot() {
    try {
        console.log(chalk.cyan('🔧 Starting STANDALONE bot with Baileys version:', require('@whiskeysockets/baileys/package.json').version));
        console.log(chalk.yellow(`📱 Your number: ${phoneNumber}`));
        console.log(chalk.yellow(`📢 Channel ID: ${CHANNEL_ID}`));
        
        const { state, saveCreds } = await useMultiFileAuthState("./session");
        const { version } = await fetchLatestBaileysVersion();

        const sock = makeWASocket({
            version,
            logger: pino({ level: "silent" }),
            printQRInTerminal: false, // Use pairing code
            auth: state,
            browser: ["Ubuntu", "Chrome", "20.0.04"],
        });

        // Handle connection updates
        sock.ev.on("connection.update", async (update) => {
            const { connection, lastDisconnect, qr } = update;
            
            if (qr && !pairingCode) {
                console.log(chalk.yellow('📱 QR Code generated. Please scan with WhatsApp.'));
            }
            
            if (connection === "connecting") {
                console.log(chalk.yellow('🔄 Connecting to WhatsApp...'));
            }
            
            if (connection === "open") {
                console.log(chalk.green('✅ Bot Connected Successfully!'));
                console.log(chalk.blue(`Bot is ready!`));
                
                // Send connection message to yourself
                try {
                    await sock.sendMessage(`${phoneNumber}@s.whatsapp.net`, { 
                        text: '✅ Bot is online and ready!' 
                    });
                } catch (e) {}
            }
            
            if (connection === "close") {
                const shouldReconnect = (lastDisconnect.error instanceof Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
                console.log(chalk.red(`Connection closed, reconnecting: ${shouldReconnect}`));
                
                if (shouldReconnect) {
                    await delay(5000);
                    startBot();
                } else {
                    try {
                        rmSync('./session', { recursive: true, force: true });
                        console.log(chalk.yellow('Session deleted. Please restart.'));
                    } catch (e) {}
                }
            }
        });

        sock.ev.on("creds.update", saveCreds);

        // Handle pairing code
        if (pairingCode && !sock.authState.creds.registered) {
            console.log(chalk.green('\n📱 Requesting pairing code...'));
            
            setTimeout(async () => {
                try {
                    let code = await sock.requestPairingCode(phoneNumber);
                    code = code?.match(/.{1,4}/g)?.join("-") || code;
                    console.log(chalk.bgGreen.black(`\n🔐 Your Pairing Code: ${code}\n`));
                    console.log(chalk.yellow('1. Open WhatsApp on your phone'));
                    console.log(chalk.yellow('2. Go to Settings > Linked Devices'));
                    console.log(chalk.yellow('3. Tap "Link a Device"'));
                    console.log(chalk.yellow(`4. Enter this code: ${code}`));
                } catch (error) {
                    console.error('Pairing code error:', error);
                }
            }, 3000);
        }

        // ===== MAIN MESSAGE HANDLER =====
        sock.ev.on("messages.upsert", async (messageData) => {
            try {
                // Handle both array and object formats
                let messages = Array.isArray(messageData) ? messageData : messageData.messages;
                if (!messages || !messages[0]) return;
                
                const msg = messages[0];
                
                // Skip own messages
                if (msg.key?.fromMe) return;
                
                const from = msg.key.remoteJid;
                
                // Get message text
                let text = '';
                if (msg.message?.conversation) {
                    text = msg.message.conversation;
                } else if (msg.message?.extendedTextMessage?.text) {
                    text = msg.message.extendedTextMessage.text;
                } else if (msg.message?.imageMessage?.caption) {
                    text = msg.message.imageMessage.caption;
                } else if (msg.message?.videoMessage?.caption) {
                    text = msg.message.videoMessage.caption;
                }
                
                if (!text) return;
                
                log('INFO', `📨 Message from ${from}: ${text}`);
                
                // ===== PING COMMAND =====
                if (text === '.ping') {
                    await sock.sendMessage(from, { text: 'pong 🏓' });
                    log('INFO', '✅ Responded to .ping');
                }
                
                // ===== CHANNEL COMMAND =====
                else if (text.startsWith('.channel')) {
                    const args = text.slice(8).trim();
                    
                    // Check if replying to media
                    const quotedMsg = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
                    
                    if (quotedMsg?.imageMessage) {
                        log('INFO', '📸 Processing quoted image');
                        
                        try {
                            // Download the image
                            const stream = await downloadContentFromMessage(quotedMsg.imageMessage, 'image');
                            const buffer = [];
                            for await (const chunk of stream) buffer.push(chunk);
                            const imageBuffer = Buffer.concat(buffer);
                            
                            log('INFO', `Image downloaded: ${imageBuffer.length} bytes`);
                            
                            // Send to channel
                            await sock.sendMessage(CHANNEL_ID, {
                                image: imageBuffer,
                                caption: args || 'Sent via bot'
                            });
                            
                            await sock.sendMessage(from, { text: '✅ Image sent to channel!' });
                            log('INFO', '✅ Image sent to channel');
                            
                        } catch (err) {
                            log('ERROR', 'Failed to process image', err);
                            await sock.sendMessage(from, { text: '❌ Failed: ' + err.message });
                        }
                    }
                    else if (quotedMsg?.videoMessage) {
                        log('INFO', '🎥 Processing quoted video');
                        
                        try {
                            const stream = await downloadContentFromMessage(quotedMsg.videoMessage, 'video');
                            const buffer = [];
                            for await (const chunk of stream) buffer.push(chunk);
                            const videoBuffer = Buffer.concat(buffer);
                            
                            await sock.sendMessage(CHANNEL_ID, {
                                video: videoBuffer,
                                caption: args || 'Sent via bot'
                            });
                            
                            await sock.sendMessage(from, { text: '✅ Video sent to channel!' });
                            log('INFO', '✅ Video sent to channel');
                            
                        } catch (err) {
                            log('ERROR', 'Failed to process video', err);
                            await sock.sendMessage(from, { text: '❌ Failed: ' + err.message });
                        }
                    }
                    else if (args) {
                        // Text only
                        log('INFO', '📝 Sending text to channel', { text: args });
                        
                        await sock.sendMessage(CHANNEL_ID, { text: args });
                        await sock.sendMessage(from, { text: '✅ Text sent to channel!' });
                        log('INFO', '✅ Text sent to channel');
                    }
                    else {
                        await sock.sendMessage(from, { text: '❌ Usage: .channel your message or reply to media' });
                    }
                }
                
                // ===== TEST COMMAND =====
                else if (text === '.test') {
                    await sock.sendMessage(from, { text: '✅ Bot is working!' });
                }
                
                // ===== HELP COMMAND =====
                else if (text === '.help') {
                    const helpMsg = `*Available Commands:*\n\n`.ping - Test bot\n`.channel text - Send text to channel\nReply to image with .channel - Send image to channel`;
                    await sock.sendMessage(from, { text: helpMsg });
                }
                
            } catch (err) {
                log('ERROR', '❌ Error in message handler', err);
            }
        });

        return sock;
        
    } catch (error) {
        console.error('Fatal error:', error);
        await delay(5000);
        startBot();
    }
}

// Start the bot
startBot().catch(console.error);

process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
});

process.on('unhandledRejection', (err) => {
    console.error('Unhandled Rejection:', err);
});
