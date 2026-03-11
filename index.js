/**
 * Knight Bot - CLEAN VERSION with basic commands
 * No main.js needed - everything works here
 */
const { Boom } = require('@hapi/boom')
const fs = require('fs')
const chalk = require('chalk')
const path = require('path')
const axios = require('axios')
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
const sessionDir = "./session"

global.botname = "KNIGHT BOT"
global.themeemoji = "•"
const pairingCode = true

// Create temp directory for downloads
const TEMP_DIR = path.join(process.cwd(), 'temp');
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

// Channel ID
const CHANNEL_ID = "120363405181626845@newsletter";

// Logger
function log(level, msg, data) {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [${level}] ${msg}`);
    if (data) console.log(JSON.stringify(data, null, 2));
}

// Readline for pairing code
const rl = process.stdin.isTTY ? readline.createInterface({ input: process.stdin, output: process.stdout }) : null
const question = (text) => {
    if (rl) {
        return new Promise((resolve) => rl.question(text, resolve))
    } else {
        return Promise.resolve(phoneNumber)
    }
}

// Format size
function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
    return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

async function startBot() {
    try {
        console.log(chalk.cyan('🔧 Starting Knight Bot with Baileys version:', require('@whiskeysockets/baileys/package.json').version));
        console.log(chalk.yellow(`📱 Your number: ${phoneNumber}`));
        console.log(chalk.yellow(`📢 Channel ID: ${CHANNEL_ID}`));
        
        const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
        const { version } = await fetchLatestBaileysVersion();

        const sock = makeWASocket({
            version,
            logger: pino({ level: "silent" }),
            printQRInTerminal: false,
            auth: state,
            browser: ["KnightBot", "Chrome", "3.0.7"],
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
                console.log(chalk.green('\n✅ Bot Connected Successfully!'));
                console.log(chalk.blue(`Bot Version: 3.0.7`));
                console.log(chalk.magenta(`\n${global.themeemoji || '•'} YT CHANNEL: MR UNIQUE HACKER`));
                console.log(chalk.magenta(`${global.themeemoji || '•'} GITHUB: mrunqiuehacker`));
                console.log(chalk.magenta(`${global.themeemoji || '•'} WA NUMBER: ${owner}`));
                console.log(chalk.magenta(`${global.themeemoji || '•'} CREDIT: MR UNIQUE HACKER`));
                console.log(chalk.green(`${global.themeemoji || '•'} 🤖 Bot Ready! ✅\n`));
                
                // Send connection message
                try {
                    await sock.sendMessage(`${phoneNumber}@s.whatsapp.net`, { 
                        text: '✅ Bot is online! Send .menu for commands' 
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
                        rmSync(sessionDir, { recursive: true, force: true });
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
                    console.log(chalk.yellow(`4. Enter this code: ${code}\n`));
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
                const isGroup = from.endsWith('@g.us');
                const sender = isGroup ? msg.key.participant : from;
                
                // Get message text
                let text = '';
                let rawText = '';
                
                if (msg.message?.conversation) {
                    text = msg.message.conversation;
                    rawText = text;
                } else if (msg.message?.extendedTextMessage?.text) {
                    text = msg.message.extendedTextMessage.text;
                    rawText = text;
                } else if (msg.message?.imageMessage?.caption) {
                    text = msg.message.imageMessage.caption;
                    rawText = text;
                } else if (msg.message?.videoMessage?.caption) {
                    text = msg.message.videoMessage.caption;
                    rawText = text;
                }
                
                if (!text) return;
                
                const userMessage = text.toLowerCase().trim();
                log('INFO', `📨 ${isGroup ? 'Group' : 'Private'} message from ${sender}: ${userMessage}`);

                // ===== BASIC COMMANDS =====
                
                // .ping command
                if (userMessage === '.ping') {
                    const start = Date.now();
                    await sock.sendMessage(from, { text: 'pong 🏓' });
                    const end = Date.now();
                    await sock.sendMessage(from, { text: `⏱️ Response time: ${end - start}ms` });
                    log('INFO', '✅ Responded to .ping');
                }
                
                // .menu / .help command
                else if (userMessage === '.menu' || userMessage === '.help' || userMessage === '.commands') {
                    const menuText = `╔══════════════════╗
   *🤖 KNIGHT BOT*  
   Version: *3.0.7*
   by MR UNIQUE HACKER
╚══════════════════╝

*Available Commands:*

╔══════════════════╗
🌐 *General Commands*:
║ ➤ .ping
║ ➤ .menu
║ ➤ .owner
║ ➤ .repo
║ ➤ .alive
╚══════════════════╝

╔══════════════════╗
📢 *Channel Commands*:
║ ➤ .channel <text>
║ ➤ Reply to image/video with .channel
╚══════════════════╝

╔══════════════════╗
🎮 *Fun Commands*:
║ ➤ .sticker (reply to image)
║ ➤ .tts <text>
║ ➤ .joke
║ ➤ .quote
╚══════════════════╝

╔══════════════════╗
📥 *Downloader*:
║ ➤ .yt <url>
║ ➤ .ig <url>
║ ➤ .fb <url>
╚══════════════════╝

Join our channel for updates:`;
                    
                    await sock.sendMessage(from, { text: menuText });
                    log('INFO', '✅ Sent menu');
                }
                
                // .owner command
                else if (userMessage === '.owner') {
                    await sock.sendMessage(from, { text: `👑 *Owner:* ${owner[0]}\n📱 WhatsApp: wa.me/${owner[0]}` });
                }
                
                // .repo / .git command
                else if (userMessage === '.repo' || userMessage === '.git' || userMessage === '.github' || userMessage === '.script') {
                    await sock.sendMessage(from, { text: '📦 *Knight Bot Repository*\n\nhttps://github.com/ssccoouutt/Knightbot-MD' });
                }
                
                // .alive command
                else if (userMessage === '.alive') {
                    await sock.sendMessage(from, { text: '🤖 *I am alive!*\n\nUptime: ' + process.uptime().toFixed(0) + ' seconds' });
                }
                
                // .sticker command
                else if (userMessage === '.sticker' || userMessage === '.s') {
                    const quotedMsg = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
                    
                    if (quotedMsg?.imageMessage) {
                        try {
                            const stream = await downloadContentFromMessage(quotedMsg.imageMessage, 'image');
                            const buffer = [];
                            for await (const chunk of stream) buffer.push(chunk);
                            const imageBuffer = Buffer.concat(buffer);
                            
                            await sock.sendMessage(from, {
                                sticker: imageBuffer
                            });
                            
                            log('INFO', '✅ Sticker created');
                        } catch (err) {
                            log('ERROR', 'Sticker creation failed', err);
                            await sock.sendMessage(from, { text: '❌ Failed to create sticker' });
                        }
                    } else {
                        await sock.sendMessage(from, { text: '❌ Reply to an image with .sticker' });
                    }
                }
                
                // .tts command (Text to Speech)
                else if (userMessage.startsWith('.tts ')) {
                    const ttsText = rawText.slice(5).trim();
                    if (ttsText) {
                        try {
                            const response = await axios.get(`https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(ttsText)}&tl=en&client=tw-ob`, {
                                responseType: 'arraybuffer'
                            });
                            
                            await sock.sendMessage(from, {
                                audio: Buffer.from(response.data),
                                mimetype: 'audio/mpeg',
                                ptt: true
                            });
                            
                            log('INFO', '✅ TTS sent');
                        } catch (err) {
                            log('ERROR', 'TTS failed', err);
                            await sock.sendMessage(from, { text: '❌ TTS failed' });
                        }
                    } else {
                        await sock.sendMessage(from, { text: '❌ Usage: .tts Hello world' });
                    }
                }
                
                // .joke command
                else if (userMessage === '.joke') {
                    try {
                        const response = await axios.get('https://v2.jokeapi.dev/joke/Any?type=single');
                        const joke = response.data.joke || 'No joke found';
                        await sock.sendMessage(from, { text: `😄 *Joke:*\n\n${joke}` });
                    } catch (err) {
                        await sock.sendMessage(from, { text: 'Why did the programmer quit his job?\nBecause he didn\'t get arrays!' });
                    }
                }
                
                // .quote command
                else if (userMessage === '.quote') {
                    const quotes = [
                        "The only way to do great work is to love what you do. - Steve Jobs",
                        "Life is what happens when you're busy making other plans. - John Lennon",
                        "The future belongs to those who believe in the beauty of their dreams. - Eleanor Roosevelt",
                        "It does not matter how slowly you go as long as you do not stop. - Confucius",
                        "Everything you've ever wanted is on the other side of fear. - George Addair"
                    ];
                    const randomQuote = quotes[Math.floor(Math.random() * quotes.length)];
                    await sock.sendMessage(from, { text: `💭 *Quote:*\n\n${randomQuote}` });
                }
                
                // .channel command
                else if (userMessage.startsWith('.channel')) {
                    const args = rawText.slice(8).trim();
                    const quotedMsg = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
                    
                    if (quotedMsg?.imageMessage) {
                        try {
                            const stream = await downloadContentFromMessage(quotedMsg.imageMessage, 'image');
                            const buffer = [];
                            for await (const chunk of stream) buffer.push(chunk);
                            const imageBuffer = Buffer.concat(buffer);
                            
                            log('INFO', `Image downloaded: ${formatFileSize(imageBuffer.length)}`);
                            
                            await sock.sendMessage(CHANNEL_ID, {
                                image: imageBuffer,
                                caption: args || 'Sent via KnightBot'
                            });
                            
                            await sock.sendMessage(from, { text: '✅ Image sent to channel!' });
                        } catch (err) {
                            log('ERROR', 'Channel image failed', err);
                            await sock.sendMessage(from, { text: '❌ Failed: ' + err.message });
                        }
                    }
                    else if (quotedMsg?.videoMessage) {
                        try {
                            const stream = await downloadContentFromMessage(quotedMsg.videoMessage, 'video');
                            const buffer = [];
                            for await (const chunk of stream) buffer.push(chunk);
                            const videoBuffer = Buffer.concat(buffer);
                            
                            await sock.sendMessage(CHANNEL_ID, {
                                video: videoBuffer,
                                caption: args || 'Sent via KnightBot'
                            });
                            
                            await sock.sendMessage(from, { text: '✅ Video sent to channel!' });
                        } catch (err) {
                            await sock.sendMessage(from, { text: '❌ Failed: ' + err.message });
                        }
                    }
                    else if (args) {
                        await sock.sendMessage(CHANNEL_ID, { text: args });
                        await sock.sendMessage(from, { text: '✅ Text sent to channel!' });
                    }
                    else {
                        await sock.sendMessage(from, { text: '❌ Usage: .channel text or reply to image/video' });
                    }
                }
                
                // .yt command (YouTube downloader placeholder)
                else if (userMessage.startsWith('.yt ')) {
                    const url = rawText.slice(4).trim();
                    await sock.sendMessage(from, { text: `⏳ Downloading from YouTube: ${url}\n\nThis feature is being implemented.` });
                }
                
                // .ig command (Instagram downloader placeholder)
                else if (userMessage.startsWith('.ig ') || userMessage.startsWith('.insta ')) {
                    const url = rawText.slice(userMessage.startsWith('.ig ') ? 4 : 7).trim();
                    await sock.sendMessage(from, { text: `⏳ Downloading from Instagram: ${url}\n\nThis feature is being implemented.` });
                }
                
                // Default response for unrecognized commands
                else if (userMessage.startsWith('.')) {
                    await sock.sendMessage(from, { text: `❌ Unknown command: ${userMessage}\nType .menu for available commands` });
                }
                
            } catch (err) {
                log('ERROR', '❌ Error in message handler', err);
                if (msg?.key?.remoteJid) {
                    await sock.sendMessage(msg.key.remoteJid, { 
                        text: '❌ An error occurred processing your command' 
                    }).catch(() => {});
                }
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
