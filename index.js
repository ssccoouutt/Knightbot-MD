/**
 * Knight Bot - ULTRA DEBUG VERSION
 * Shows EVERY event and message like your simplest test
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
    delay
} = require("@whiskeysockets/baileys")
const pino = require("pino")
const readline = require("readline")

// Settings
const phoneNumber = "923247220362"
const owner = ["923247220362"]

global.botname = "KNIGHT BOT"
global.themeemoji = "•"
const pairingCode = true

// Channel ID
const CHANNEL_ID = "120363405181626845@newsletter";

// Readline for pairing code
const rl = process.stdin.isTTY ? readline.createInterface({ input: process.stdin, output: process.stdout }) : null
const question = (text) => {
    if (rl) {
        return new Promise((resolve) => rl.question(text, resolve))
    } else {
        return Promise.resolve(phoneNumber)
    }
}

async function startBot() {
    try {
        console.log(chalk.cyan('🔧 Starting ULTRA DEBUG bot with Baileys version:', require('@whiskeysockets/baileys/package.json').version));
        console.log(chalk.yellow(`📱 Your number: ${phoneNumber}`));
        console.log(chalk.yellow(`📢 Channel ID: ${CHANNEL_ID}`));
        
        const { state, saveCreds } = await useMultiFileAuthState("./session");
        const { version } = await fetchLatestBaileysVersion();

        const sock = makeWASocket({
            version,
            logger: pino({ level: "silent" }),
            printQRInTerminal: false,
            auth: state,
            browser: ["KnightBot", "Chrome", "3.0.7"],
        });

        // ===== DEBUG ALL EVENTS =====
        console.log('\n📋 Listening for all events...\n');

        // Track connection state
        sock.ev.on("connection.update", async (update) => {
            const { connection, lastDisconnect, qr, isNewLogin } = update;
            
            console.log('\n🔌 CONNECTION UPDATE:', {
                connection,
                hasQR: !!qr,
                isNewLogin,
                timestamp: new Date().toISOString()
            });
            
            if (qr) {
                console.log(chalk.yellow('\n📱 QR Code generated'));
            }
            
            if (connection === "connecting") {
                console.log(chalk.yellow('🔄 Connecting to WhatsApp...'));
            }
            
            if (connection === "open") {
                console.log(chalk.green('\n✅✅✅ BOT CONNECTED SUCCESSFULLY! ✅✅✅'));
                console.log(chalk.blue(`Bot Version: 3.0.7`));
                console.log(chalk.magenta(`\n${global.themeemoji || '•'} YT CHANNEL: MR UNIQUE HACKER`));
                console.log(chalk.magenta(`${global.themeemoji || '•'} GITHUB: mrunqiuehacker`));
                console.log(chalk.magenta(`${global.themeemoji || '•'} WA NUMBER: ${owner}`));
                console.log(chalk.magenta(`${global.themeemoji || '•'} CREDIT: MR UNIQUE HACKER`));
                console.log(chalk.green(`${global.themeemoji || '•'} 🤖 Bot Ready! ✅\n`));
                
                // Send connection message
                try {
                    await sock.sendMessage(`${phoneNumber}@s.whatsapp.net`, { 
                        text: '✅ Bot is online! Send .ping to test' 
                    });
                    console.log('📤 Sent connection message to owner');
                } catch (e) {
                    console.log('❌ Failed to send connection message:', e.message);
                }
            }
            
            if (connection === "close") {
                const shouldReconnect = (lastDisconnect.error instanceof Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
                console.log(chalk.red(`❌ Connection closed, reconnecting: ${shouldReconnect}`));
                console.log('Close reason:', lastDisconnect?.error?.message);
                
                if (shouldReconnect) {
                    console.log('🔄 Reconnecting in 5 seconds...');
                    await delay(5000);
                    startBot();
                }
            }
        });

        // Handle creds update
        sock.ev.on("creds.update", saveCreds);
        console.log('✓ Creds update handler registered');

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
                    console.log(chalk.yellow(`4. Enter this code: ${code}\n`));
                } catch (error) {
                    console.error('❌ Pairing code error:', error);
                }
            }, 3000);
        }

        // ===== DEBUG ALL MESSAGES =====
        sock.ev.on("messages.upsert", (m) => {
            console.log('\n' + '='.repeat(60));
            console.log('📥📥📥 MESSAGES.UPSERT EVENT TRIGGERED! 📥📥📥');
            console.log('='.repeat(60));
            
            // Log event type
            console.log('Event type:', m.type);
            console.log('Has messages:', !!m.messages);
            console.log('Message count:', m.messages?.length);
            
            if (m.messages && m.messages.length > 0) {
                const msg = m.messages[0];
                console.log('\n📨 RAW MESSAGE DATA:');
                console.log('  RemoteJid:', msg.key?.remoteJid);
                console.log('  From Me:', msg.key?.fromMe);
                console.log('  ID:', msg.key?.id);
                console.log('  Participant:', msg.key?.participant);
                console.log('  Has Message:', !!msg.message);
                
                if (msg.message) {
                    console.log('  Message Types:', Object.keys(msg.message));
                    
                    // Try to extract text
                    let text = '';
                    if (msg.message.conversation) {
                        text = msg.message.conversation;
                        console.log('  Conversation Text:', text);
                    }
                    if (msg.message.extendedTextMessage?.text) {
                        text = msg.message.extendedTextMessage.text;
                        console.log('  Extended Text:', text);
                    }
                    if (msg.message.imageMessage?.caption) {
                        text = msg.message.imageMessage.caption;
                        console.log('  Image Caption:', text);
                    }
                    if (msg.message.videoMessage?.caption) {
                        text = msg.message.videoMessage.caption;
                        console.log('  Video Caption:', text);
                    }
                    
                    // Log if it's a command
                    if (text && text.startsWith('.')) {
                        console.log('  🎯 COMMAND DETECTED:', text);
                    }
                    
                    // ALWAYS respond to ANY message - just like your simplest test
                    if (text && !msg.key?.fromMe) {
                        console.log('  ✅ VALID MESSAGE DETECTED - WILL RESPOND!');
                        
                        // Send response
                        sock.sendMessage(msg.key.remoteJid, { 
                            text: `✅ Echo: "${text}"` 
                        }).then(() => {
                            console.log('  ✅ Response sent!');
                        }).catch(err => {
                            console.log('  ❌ Failed to send response:', err.message);
                        });
                    }
                }
            }
            console.log('='.repeat(60) + '\n');
        });

        // ===== DEBUG OTHER EVENTS =====
        sock.ev.on("messages.reaction", (r) => {
            console.log('\n🔔 REACTION EVENT:', r);
        });

        sock.ev.on("presence.update", (p) => {
            console.log('👤 Presence update');
        });

        sock.ev.on("contacts.update", (c) => {
            console.log('📇 Contacts update');
        });

        sock.ev.on("chats.update", (c) => {
            console.log('💬 Chats update');
        });

        sock.ev.on("group-participants.update", (g) => {
            console.log('👥 Group participants update');
        });

        console.log('✓ All event handlers registered');
        console.log('\n📱 Waiting for messages... Send ANY message to test\n');

        return sock;
        
    } catch (error) {
        console.error('❌ Fatal error:', error);
        await delay(5000);
        startBot();
    }
}

// Start the bot
startBot().catch(console.error);

process.on('uncaughtException', (err) => {
    console.error('❌ Uncaught Exception:', err);
});

process.on('unhandledRejection', (err) => {
    console.error('❌ Unhandled Rejection:', err);
});
