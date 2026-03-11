/**
 * Knight Bot - COMPLETE VERSION WITH ENCRYPTION FIXES
 * Fixes the "Closing session" and message receiving issues
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
    delay,
    jidDecode,
    getContentType,
    makeCacheableSignalKeyStore,
    Browsers
} = require("@whiskeysockets/baileys")
const pino = require("pino")
const readline = require("readline")
const NodeCache = require("node-cache")
const { rmSync } = require('fs')

// Settings
const phoneNumber = "923247220362"
const owner = ["923247220362"]

global.botname = "KNIGHT BOT"
global.themeemoji = "•"
const pairingCode = true

// Channel ID
const CHANNEL_ID = "120363405181626845@newsletter";

// Create message cache to prevent duplicates
const msgRetryCounterCache = new NodeCache({ stdTTL: 300 }) // 5 minutes TTL

// Store for messages
const messageStore = new Map();

// Readline for pairing code
const rl = process.stdin.isTTY ? readline.createInterface({ input: process.stdin, output: process.stdout }) : null
const question = (text) => {
    if (rl) {
        return new Promise((resolve) => rl.question(text, resolve))
    } else {
        return Promise.resolve(phoneNumber)
    }
}

// Logger with colors
function logDebug(level, message, data = null) {
    const timestamp = new Date().toISOString();
    const colors = {
        'INFO': chalk.green,
        'WARN': chalk.yellow,
        'ERROR': chalk.red,
        'DEBUG': chalk.cyan,
        'MSG': chalk.magenta,
        'HEART': chalk.blue,
        'AUTH': chalk.yellow
    };
    const color = colors[level] || chalk.white;
    console.log(color(`[${timestamp}] [${level}] ${message}`));
    if (data) {
        console.log(color(JSON.stringify(data, (key, value) => 
            typeof value === 'bigint' ? value.toString() : value
        , 2)));
    }
}

async function startBot() {
    try {
        console.log(chalk.cyan('🔧 Starting Knight Bot with Baileys version:', require('@whiskeysockets/baileys/package.json').version));
        console.log(chalk.yellow(`📱 Your number: ${phoneNumber}`));
        console.log(chalk.yellow(`📢 Channel ID: ${CHANNEL_ID}`));
        
        // Clear any stale session data
        try {
            const authState = await useMultiFileAuthState("./session");
            logDebug('AUTH', '📁 Auth state loaded');
        } catch (e) {
            logDebug('WARN', '⚠️ No existing session found');
        }
        
        const { state, saveCreds } = await useMultiFileAuthState("./session");
        const { version } = await fetchLatestBaileysVersion();

        const sock = makeWASocket({
            version,
            logger: pino({ level: "silent" }),
            printQRInTerminal: false,
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" })),
            },
            browser: Browsers.ubuntu("Chrome"),
            markOnlineOnConnect: true,
            syncFullHistory: true, // Sync history to fix encryption
            emitOwnEvents: true,
            msgRetryCounterCache,
            defaultQueryTimeoutMs: 60000,
            keepAliveIntervalMs: 10000,
            generateHighQualityLinkPreview: true,
            shouldIgnoreJid: (jid) => {
                // Don't ignore any JIDs, especially not your own
                return false;
            },
            getMessage: async (key) => {
                // Try to get message from store
                const msg = messageStore.get(key.id);
                if (msg) {
                    logDebug('DEBUG', '📎 Retrieved message from store', { id: key.id });
                    return msg;
                }
                return undefined;
            },
            patchMessageBeforeSending: (msg) => {
                // Ensure messages are properly formatted
                return msg;
            }
        });

        // ===== DEBUG ALL EVENTS =====
        console.log('\n' + chalk.bgCyan.black('📋 LISTENING FOR ALL EVENTS 📋') + '\n');

        // Connection state tracking
        let connectionState = 'disconnected';
        let heartbeatInterval = null;
        let reconnectAttempts = 0;
        
        // Handle messaging history set (helps with encryption)
        sock.ev.on('messaging-history.set', ({ chats, messages, isLatest }) => {
            logDebug('INFO', '📜 Messaging history set', {
                chats: chats.length,
                messages: messages.length,
                isLatest
            });
            
            // Store messages for later retrieval
            messages.forEach(msg => {
                if (msg.key?.id) {
                    messageStore.set(msg.key.id, msg);
                }
            });
        });

        // Handle new message (before upsert) - this helps with encryption
        sock.ev.on('messages.received', (messages) => {
            logDebug('DEBUG', '📨 Messages received event', { count: messages.length });
        });

        // Track connection updates
        sock.ev.on("connection.update", async (update) => {
            const { connection, lastDisconnect, qr, isNewLogin } = update;
            
            logDebug('INFO', '🔌 CONNECTION UPDATE', {
                connection: connection || 'no change',
                previousState: connectionState,
                hasQR: !!qr,
                isNewLogin,
                reconnectAttempts,
                timestamp: new Date().toISOString()
            });
            
            if (qr) {
                console.log(chalk.yellow('\n📱 QR Code generated'));
            }
            
            if (connection) {
                connectionState = connection;
            }
            
            if (connection === "connecting") {
                console.log(chalk.yellow('🔄 Connecting to WhatsApp...'));
                reconnectAttempts++;
            }
            
            if (connection === "open") {
                reconnectAttempts = 0;
                console.log(chalk.green('\n' + '✅'.repeat(30)));
                console.log(chalk.green('✅✅✅ BOT CONNECTED SUCCESSFULLY! ✅✅✅'));
                console.log(chalk.green('✅'.repeat(30) + '\n'));
                
                console.log(chalk.blue(`Bot Version: 3.0.7`));
                console.log(chalk.magenta(`\n${global.themeemoji || '•'} YT CHANNEL: MR UNIQUE HACKER`));
                console.log(chalk.magenta(`${global.themeemoji || '•'} GITHUB: mrunqiuehacker`));
                console.log(chalk.magenta(`${global.themeemoji || '•'} WA NUMBER: ${owner}`));
                console.log(chalk.magenta(`${global.themeemoji || '•'} CREDIT: MR UNIQUE HACKER`));
                console.log(chalk.green(`${global.themeemoji || '•'} 🤖 Bot Ready! ✅\n`));
                
                // Send connection message
                try {
                    await sock.sendMessage(`${phoneNumber}@s.whatsapp.net`, { 
                        text: '✅ Bot is online! Send any message to test' 
                    });
                    logDebug('INFO', '📤 Sent connection message to owner');
                } catch (e) {
                    logDebug('ERROR', '❌ Failed to send connection message', { error: e.message });
                }
                
                // Start heartbeat to keep connection alive
                if (heartbeatInterval) clearInterval(heartbeatInterval);
                heartbeatInterval = setInterval(async () => {
                    try {
                        await sock.sendMessage(`${phoneNumber}@s.whatsapp.net`, { 
                            text: `💓 Heartbeat - ${new Date().toLocaleTimeString()}` 
                        });
                        logDebug('HEART', '💓 Heartbeat sent');
                    } catch (e) {
                        logDebug('ERROR', '❌ Heartbeat failed', { error: e.message });
                    }
                }, 30000);
            }
            
            if (connection === "close") {
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
                
                logDebug('ERROR', '❌ Connection closed', {
                    reason: lastDisconnect?.error?.message,
                    statusCode,
                    shouldReconnect,
                    reconnectAttempts
                });
                
                if (heartbeatInterval) {
                    clearInterval(heartbeatInterval);
                    heartbeatInterval = null;
                }
                
                if (shouldReconnect && reconnectAttempts < 5) {
                    logDebug('INFO', `🔄 Reconnecting in 5 seconds... (Attempt ${reconnectAttempts + 1}/5)`);
                    await delay(5000);
                    startBot();
                } else if (reconnectAttempts >= 5) {
                    logDebug('ERROR', '❌ Max reconnection attempts reached. Please restart manually.');
                }
            }
        });

        // Handle creds update
        sock.ev.on("creds.update", saveCreds);
        logDebug('DEBUG', '✓ Creds update handler registered');

        // Handle pairing code
        if (pairingCode && !sock.authState.creds.registered) {
            logDebug('INFO', '📱 Requesting pairing code...');
            
            setTimeout(async () => {
                try {
                    let code = await sock.requestPairingCode(phoneNumber);
                    code = code?.match(/.{1,4}/g)?.join("-") || code;
                    console.log(chalk.bgGreen.black(`\n🔐 ===== PAIRING CODE =====`));
                    console.log(chalk.bgGreen.black(`       ${code}       `));
                    console.log(chalk.bgGreen.black(`=========================\n`));
                    console.log(chalk.yellow('1. Open WhatsApp on your phone'));
                    console.log(chalk.yellow('2. Go to Settings > Linked Devices'));
                    console.log(chalk.yellow('3. Tap "Link a Device"'));
                    console.log(chalk.yellow(`4. Enter this code: ${code}\n`));
                } catch (error) {
                    logDebug('ERROR', '❌ Pairing code error', { error: error.message });
                }
            }, 3000);
        }

        // ===== COMPLETE MESSAGE DEBUGGING =====
        sock.ev.on("messages.upsert", (m) => {
            console.log('\n' + chalk.bgMagenta.white('📥 MESSAGES.UPSERT EVENT TRIGGERED 📥'));
            console.log(chalk.magenta('='.repeat(60)));
            
            // Log basic event info
            logDebug('MSG', 'Event details', {
                type: m.type,
                messageCount: m.messages?.length,
                hasMessages: !!m.messages
            });
            
            if (!m.messages || m.messages.length === 0) {
                logDebug('WARN', '⚠️ No messages in event');
                return;
            }
            
            // Store messages for getMessage function
            m.messages.forEach(msg => {
                if (msg.key?.id) {
                    messageStore.set(msg.key.id, msg);
                }
            });
            
            // Process each message
            m.messages.forEach((msg, index) => {
                console.log(chalk.cyan(`\n--- MESSAGE ${index + 1} ---`));
                
                // Message key info
                logDebug('DEBUG', 'Message key', {
                    remoteJid: msg.key?.remoteJid,
                    fromMe: msg.key?.fromMe,
                    id: msg.key?.id,
                    participant: msg.key?.participant
                });
                
                // Sender info
                const sender = msg.key?.participant || msg.key?.remoteJid;
                const isGroup = msg.key?.remoteJid?.endsWith('@g.us');
                logDebug('INFO', '👤 Sender', {
                    sender,
                    isGroup,
                    chat: msg.key?.remoteJid
                });
                
                // Check if message has content
                if (!msg.message) {
                    logDebug('WARN', '⚠️ No message content');
                    return;
                }
                
                // Get message type
                const msgType = getContentType(msg.message);
                logDebug('DEBUG', 'Message type', { type: msgType });
                
                // Extract text based on type
                let text = '';
                let mediaType = null;
                
                if (msgType === 'conversation') {
                    text = msg.message.conversation || '';
                } else if (msgType === 'extendedTextMessage') {
                    text = msg.message.extendedTextMessage?.text || '';
                } else if (msgType === 'imageMessage') {
                    text = msg.message.imageMessage?.caption || '';
                    mediaType = 'image';
                } else if (msgType === 'videoMessage') {
                    text = msg.message.videoMessage?.caption || '';
                    mediaType = 'video';
                } else if (msgType === 'audioMessage') {
                    mediaType = 'audio';
                } else if (msgType === 'documentMessage') {
                    text = msg.message.documentMessage?.caption || '';
                    mediaType = 'document';
                } else if (msgType === 'stickerMessage') {
                    mediaType = 'sticker';
                }
                
                logDebug('INFO', '📨 Message content', {
                    text: text || '[no text]',
                    mediaType,
                    hasMedia: !!mediaType,
                    length: text.length
                });
                
                // Check for quoted messages
                const quotedMsg = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
                if (quotedMsg) {
                    logDebug('DEBUG', '📎 Has quoted message', {
                        quotedType: Object.keys(quotedMsg)[0]
                    });
                }
                
                // ===== ALWAYS RESPOND TO ANY MESSAGE FOR TESTING =====
                if (!msg.key?.fromMe && (text || mediaType)) {
                    logDebug('INFO', '✅ VALID MESSAGE DETECTED - SENDING RESPONSE');
                    
                    // Prepare response
                    let responseText = '';
                    
                    if (text === '.ping') {
                        responseText = 'pong 🏓';
                    } else if (text === '.test') {
                        responseText = '✅ Bot is working!';
                    } else if (text === '.info') {
                        responseText = `🤖 Bot Info:\n• Version: 3.0.7\n• Owner: ${owner[0]}\n• Connected: Yes\n• Uptime: ${Math.floor(process.uptime())}s`;
                    } else if (text === '.help' || text === '.menu') {
                        responseText = `*Available Commands:*\n\n• .ping - Test bot\n• .test - Check if bot works\n• .info - Bot info\n• .help - This menu\n• .echo <text> - Echo your message\n\nReply to any message to test!`;
                    } else if (text.startsWith('.echo ')) {
                        responseText = `📢 Echo: ${text.slice(6)}`;
                    } else if (text.startsWith('.channel ')) {
                        const args = text.slice(9).trim();
                        if (args) {
                            // Send to channel
                            sock.sendMessage(CHANNEL_ID, { text: args })
                                .then(() => {
                                    logDebug('INFO', '✅ Channel message sent');
                                })
                                .catch(err => {
                                    logDebug('ERROR', '❌ Channel send failed', { error: err.message });
                                });
                            responseText = `✅ Sent to channel: ${args}`;
                        } else {
                            responseText = '❌ Usage: .channel your message';
                        }
                    } else {
                        responseText = `✅ Received: "${text || '[media]'}"\nFrom: ${sender}\nType: ${mediaType || 'text'}`;
                    }
                    
                    // Send response
                    sock.sendMessage(msg.key.remoteJid, { text: responseText })
                        .then(() => {
                            logDebug('INFO', '✅ Response sent successfully', { to: msg.key.remoteJid });
                        })
                        .catch(err => {
                            logDebug('ERROR', '❌ Failed to send response', { error: err.message });
                        });
                }
            });
            
            console.log(chalk.magenta('='.repeat(60)) + '\n');
        });

        // ===== DEBUG OTHER EVENTS =====
        sock.ev.on("messages.reaction", (r) => {
            logDebug('DEBUG', '🔔 Reaction event', { reaction: r });
        });

        sock.ev.on("presence.update", (p) => {
            logDebug('DEBUG', '👤 Presence update', { presence: p });
        });

        sock.ev.on("contacts.update", (c) => {
            logDebug('DEBUG', '📇 Contacts update', { count: c.length });
        });

        sock.ev.on("chats.update", (c) => {
            logDebug('DEBUG', '💬 Chats update', { count: c.length });
        });

        sock.ev.on("group-participants.update", (g) => {
            logDebug('DEBUG', '👥 Group participants update', {
                group: g.id,
                action: g.action,
                participants: g.participants
            });
        });

        logDebug('INFO', '✓ All event handlers registered');
        console.log(chalk.green('\n📱 Bot is ready! Send ANY message to see debug output\n'));

        return sock;
        
    } catch (error) {
        logDebug('ERROR', '❌ Fatal error', { error: error.message, stack: error.stack });
        await delay(5000);
        startBot();
    }
}

// Start the bot
startBot().catch(error => {
    logDebug('ERROR', '❌ Fatal error in startBot', { error: error.message });
});

process.on('uncaughtException', (err) => {
    logDebug('ERROR', '❌ Uncaught Exception', { error: err.message, stack: err.stack });
});

process.on('unhandledRejection', (err) => {
    logDebug('ERROR', '❌ Unhandled Rejection', { error: err.message });
});
