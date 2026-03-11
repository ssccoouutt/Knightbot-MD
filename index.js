/**
 * Knight Bot - A WhatsApp Bot
 * Copyright (c) 2024 Professor
 * 
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the MIT License.
 * 
 * Credits:
 * - Baileys Library by @adiwajshing
 * - Pair Code implementation inspired by TechGod143 & DGXEON
 */
require('./settings')
const { Boom } = require('@hapi/boom')
const fs = require('fs')
const chalk = require('chalk')
const FileType = require('file-type')
const path = require('path')
const axios = require('axios')
const { handleMessages, handleGroupParticipantUpdate, handleStatus } = require('./main');
const PhoneNumber = require('awesome-phonenumber')
const { imageToWebp, videoToWebp, writeExifImg, writeExifVid } = require('./lib/exif')
const { smsg, isUrl, generateMessageTag, getBuffer, getSizeMedia, fetch, await, sleep, reSize } = require('./lib/myfunc')
const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
    generateForwardMessageContent,
    prepareWAMessageMedia,
    generateWAMessageFromContent,
    generateMessageID,
    downloadContentFromMessage,
    jidDecode,
    proto,
    jidNormalizedUser,
    makeCacheableSignalKeyStore,
    delay
} = require("@whiskeysockets/baileys")
const NodeCache = require("node-cache")
const pino = require("pino")
const readline = require("readline")
const { parsePhoneNumber } = require("libphonenumber-js")
const { PHONENUMBER_MCC } = require('@whiskeysockets/baileys/lib/Utils/generics')
const { rmSync, existsSync } = require('fs')
const { join } = require('path')

// Import lightweight store
const store = require('./lib/lightweight_store')

// Initialize store
store.readFromFile()
const settings = require('./settings')
setInterval(() => store.writeToFile(), settings.storeWriteInterval || 10000)

// Memory optimization - Force garbage collection if available
setInterval(() => {
    if (global.gc) {
        global.gc()
        console.log('🧹 Garbage collection completed')
    }
}, 60_000)

// Memory monitoring - Restart if RAM gets too high
setInterval(() => {
    const used = process.memoryUsage().rss / 1024 / 1024
    if (used > 10000) {
        console.log('⚠️ RAM too high (>10000MB), restarting bot...')
        process.exit(1)
    }
}, 30_000)

let phoneNumber = "911234567890"
let owner = JSON.parse(fs.readFileSync('./data/owner.json'))

global.botname = "KNIGHT BOT"
global.themeemoji = "•"
const pairingCode = !!phoneNumber || process.argv.includes("--pairing-code")
const useMobile = process.argv.includes("--mobile")

// Only create readline interface if we're in an interactive environment
const rl = process.stdin.isTTY ? readline.createInterface({ input: process.stdin, output: process.stdout }) : null
const question = (text) => {
    if (rl) {
        return new Promise((resolve) => rl.question(text, resolve))
    } else {
        return Promise.resolve(settings.ownerNumber || phoneNumber)
    }
}

async function startXeonBotInc() {
    try {
        console.log(chalk.cyan('🔧 Starting bot with Baileys version:', require('@whiskeysockets/baileys/package.json').version));
        
        let { version, isLatest } = await fetchLatestBaileysVersion()
        const { state, saveCreds } = await useMultiFileAuthState(`./session`)
        const msgRetryCounterCache = new NodeCache()

        const XeonBotInc = makeWASocket({
            version,
            logger: pino({ level: 'silent' }),
            printQRInTerminal: !pairingCode,
            browser: ["Ubuntu", "Chrome", "20.0.04"],
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" }).child({ level: "fatal" })),
            },
            markOnlineOnConnect: true,
            generateHighQualityLinkPreview: true,
            syncFullHistory: false,
            getMessage: async (key) => {
                let jid = jidNormalizedUser(key.remoteJid)
                let msg = await store.loadMessage(jid, key.id)
                return msg?.message || ""
            },
            msgRetryCounterCache,
            defaultQueryTimeoutMs: 60000,
            connectTimeoutMs: 60000,
            keepAliveIntervalMs: 10000,
        })

        // Save credentials when they update
        XeonBotInc.ev.on('creds.update', saveCreds)
        store.bind(XeonBotInc.ev)

        // ===== ULTRA DEBUG MESSAGE HANDLER =====
        XeonBotInc.ev.on('messages.upsert', async (messageData) => {
            console.log('\n' + '🚨'.repeat(50));
            console.log('🚨 RAW MESSAGE EVENT RECEIVED');
            console.log('🚨'.repeat(50));
            
            // Log basic info
            console.log('Timestamp:', new Date().toISOString());
            console.log('Event data type:', typeof messageData);
            console.log('Is array?', Array.isArray(messageData));
            
            // Try to log the structure safely
            try {
                if (Array.isArray(messageData)) {
                    console.log(`📦 Array with ${messageData.length} items`);
                    messageData.forEach((msg, i) => {
                        console.log(`\n--- Array Item ${i} ---`);
                        console.log('  Type:', typeof msg);
                        console.log('  Keys:', Object.keys(msg || {}));
                    });
                } else if (messageData && typeof messageData === 'object') {
                    console.log('📦 Object keys:', Object.keys(messageData));
                    
                    // Check for messages property
                    if (messageData.messages) {
                        console.log('✅ Has messages property');
                        console.log('messages type:', typeof messageData.messages);
                        console.log('messages is array?', Array.isArray(messageData.messages));
                        console.log('messages length:', messageData.messages?.length);
                    }
                    
                    // Check for type property
                    if (messageData.type) {
                        console.log('✅ Has type property:', messageData.type);
                    }
                }
            } catch (e) {
                console.log('❌ Error logging structure:', e.message);
            }
            
            // Try to extract messages using different methods
            let messages = [];
            let type = 'notify';
            
            // Method 1: Direct array
            if (Array.isArray(messageData)) {
                console.log('✅ Method 1: Direct array');
                messages = messageData;
            }
            // Method 2: Object with messages property
            else if (messageData?.messages && Array.isArray(messageData.messages)) {
                console.log('✅ Method 2: messages array property');
                messages = messageData.messages;
                type = messageData.type || 'notify';
            }
            // Method 3: Try to find any array
            else if (messageData && typeof messageData === 'object') {
                console.log('🔍 Searching for arrays in object...');
                for (let key in messageData) {
                    if (Array.isArray(messageData[key])) {
                        console.log(`✅ Found array at key: ${key}`);
                        messages = messageData[key];
                        break;
                    }
                }
            }
            
            console.log(`\n📊 Extracted ${messages.length} messages`);
            
            // Log each message in detail
            if (messages.length > 0) {
                messages.forEach((msg, i) => {
                    console.log(`\n🔍 MESSAGE ${i} DETAILS:`);
                    console.log('─'.repeat(40));
                    
                    // Key information
                    console.log('Has key?', !!msg?.key);
                    if (msg?.key) {
                        console.log('  remoteJid:', msg.key.remoteJid);
                        console.log('  fromMe:', msg.key.fromMe);
                        console.log('  id:', msg.key.id);
                        console.log('  participant:', msg.key.participant);
                    }
                    
                    // Message content
                    console.log('Has message?', !!msg?.message);
                    if (msg?.message) {
                        const msgTypes = Object.keys(msg.message);
                        console.log('  message types:', msgTypes);
                        
                        // Try to get text content
                        if (msg.message.conversation) {
                            console.log('  TEXT:', msg.message.conversation);
                        } else if (msg.message.extendedTextMessage?.text) {
                            console.log('  EXTENDED TEXT:', msg.message.extendedTextMessage.text);
                        } else if (msg.message.imageMessage?.caption) {
                            console.log('  IMAGE CAPTION:', msg.message.imageMessage.caption);
                        } else if (msg.message.videoMessage?.caption) {
                            console.log('  VIDEO CAPTION:', msg.message.videoMessage.caption);
                        }
                        
                        // Log raw message structure (truncated)
                        const msgStr = JSON.stringify(msg.message).substring(0, 200);
                        console.log('  raw preview:', msgStr + '...');
                    }
                    
                    // Check if it's a command
                    let text = '';
                    if (msg?.message?.conversation) {
                        text = msg.message.conversation;
                    } else if (msg?.message?.extendedTextMessage?.text) {
                        text = msg.message.extendedTextMessage.text;
                    } else if (msg?.message?.imageMessage?.caption) {
                        text = msg.message.imageMessage.caption;
                    } else if (msg?.message?.videoMessage?.caption) {
                        text = msg.message.videoMessage.caption;
                    }
                    
                    if (text && text.startsWith('.')) {
                        console.log('🎯 COMMAND DETECTED:', text);
                    }
                });
                
                // Process the first message if it's valid
                const firstMsg = messages[0];
                if (firstMsg?.message && !firstMsg.key?.fromMe) {
                    console.log('\n✅ Valid message found! Sending to handleMessages...');
                    
                    const chatUpdate = {
                        messages: [firstMsg],
                        type: type
                    };
                    
                    console.log('📤 chatUpdate prepared:', {
                        messagesLength: chatUpdate.messages.length,
                        type: chatUpdate.type,
                        remoteJid: firstMsg.key?.remoteJid
                    });
                    
                    try {
                        console.log('⏳ Calling handleMessages...');
                        await handleMessages(XeonBotInc, chatUpdate, true);
                        console.log('✅ handleMessages completed successfully');
                    } catch (err) {
                        console.error('❌ Error in handleMessages:', err);
                        console.error('Error stack:', err.stack);
                    }
                } else {
                    console.log('⏭️ No valid message to process (maybe own message or no content)');
                }
            } else {
                console.log('❌ No messages extracted from event');
            }
            
            console.log('🚨'.repeat(50) + '\n');
        });

        // Add these event handlers for better functionality
        XeonBotInc.decodeJid = (jid) => {
            if (!jid) return jid
            if (/:\d+@/gi.test(jid)) {
                let decode = jidDecode(jid) || {}
                return decode.user && decode.server && decode.user + '@' + decode.server || jid
            } else return jid
        }

        XeonBotInc.ev.on('contacts.update', update => {
            for (let contact of update) {
                let id = XeonBotInc.decodeJid(contact.id)
                if (store && store.contacts) store.contacts[id] = { id, name: contact.notify }
            }
        })

        XeonBotInc.getName = (jid, withoutContact = false) => {
            let id = XeonBotInc.decodeJid(jid)
            withoutContact = XeonBotInc.withoutContact || withoutContact
            let v
            if (id.endsWith("@g.us")) return new Promise(async (resolve) => {
                v = store.contacts[id] || {}
                if (!(v.name || v.subject)) v = await XeonBotInc.groupMetadata(id).catch(() => ({})) || {}
                resolve(v.name || v.subject || PhoneNumber('+' + id.replace('@s.whatsapp.net', '')).getNumber('international'))
            })
            else v = id === '0@s.whatsapp.net' ? {
                id,
                name: 'WhatsApp'
            } : id === XeonBotInc.decodeJid(XeonBotInc.user.id) ?
                XeonBotInc.user :
                (store.contacts[id] || {})
            return (withoutContact ? '' : v.name) || v.subject || v.verifiedName || PhoneNumber('+' + jid.replace('@s.whatsapp.net', '')).getNumber('international')
        }

        XeonBotInc.public = true
        XeonBotInc.serializeM = (m) => smsg(XeonBotInc, m, store)

        // Handle pairing code
        if (pairingCode && !XeonBotInc.authState.creds.registered) {
            if (useMobile) throw new Error('Cannot use pairing code with mobile api')

            let phoneNumber
            if (!!global.phoneNumber) {
                phoneNumber = global.phoneNumber
            } else {
                phoneNumber = await question(chalk.bgBlack(chalk.greenBright(`Please type your WhatsApp number 😍\nFormat: 6281376552730 (without + or spaces) : `)))
            }

            phoneNumber = phoneNumber.replace(/[^0-9]/g, '')

            const pn = require('awesome-phonenumber');
            if (!pn('+' + phoneNumber).isValid()) {
                console.log(chalk.red('Invalid phone number. Please enter your full international number (e.g., 15551234567 for US, 447911123456 for UK, etc.) without + or spaces.'));
                process.exit(1);
            }

            setTimeout(async () => {
                try {
                    let code = await XeonBotInc.requestPairingCode(phoneNumber)
                    code = code?.match(/.{1,4}/g)?.join("-") || code
                    console.log(chalk.black(chalk.bgGreen(`Your Pairing Code : `)), chalk.black(chalk.white(code)))
                    console.log(chalk.yellow(`\nPlease enter this code in your WhatsApp app:\n1. Open WhatsApp\n2. Go to Settings > Linked Devices\n3. Tap "Link a Device"\n4. Enter the code shown above`))
                } catch (error) {
                    console.error('Error requesting pairing code:', error)
                    console.log(chalk.red('Failed to get pairing code. Please check your phone number and try again.'))
                }
            }, 3000)
        }

        // Connection handling
        XeonBotInc.ev.on('connection.update', async (s) => {
            const { connection, lastDisconnect, qr } = s
            
            if (qr) {
                console.log(chalk.yellow('📱 QR Code generated. Please scan with WhatsApp.'))
            }
            
            if (connection === 'connecting') {
                console.log(chalk.yellow('🔄 Connecting to WhatsApp...'))
            }
            
            if (connection == "open") {
                console.log(chalk.magenta(` `))
                console.log(chalk.yellow(`🌿Connected to => ` + JSON.stringify(XeonBotInc.user, null, 2)))

                try {
                    const botNumber = XeonBotInc.user.id.split(':')[0] + '@s.whatsapp.net';
                    await XeonBotInc.sendMessage(botNumber, {
                        text: `🤖 Bot Connected Successfully!\n\n⏰ Time: ${new Date().toLocaleString()}\n✅ Status: Online and Ready!\n\n✅Make sure to join below channel`,
                        contextInfo: {
                            forwardingScore: 1,
                            isForwarded: true,
                            forwardedNewsletterMessageInfo: {
                                newsletterJid: '120363405181626845@newsletter',
                                newsletterName: 'The Boy',
                                serverMessageId: -1
                            }
                        }
                    });
                } catch (error) {
                    console.error('Error sending connection message:', error.message)
                }

                await delay(1999)
                console.log(chalk.yellow(`\n\n                  ${chalk.bold.blue(`[ ${global.botname || 'KNIGHT BOT'} ]`)}\n\n`))
                console.log(chalk.cyan(`< ================================================== >`))
                console.log(chalk.magenta(`\n${global.themeemoji || '•'} YT CHANNEL: MR UNIQUE HACKER`))
                console.log(chalk.magenta(`${global.themeemoji || '•'} GITHUB: mrunqiuehacker`))
                console.log(chalk.magenta(`${global.themeemoji || '•'} WA NUMBER: ${owner}`))
                console.log(chalk.magenta(`${global.themeemoji || '•'} CREDIT: MR UNIQUE HACKER`))
                console.log(chalk.green(`${global.themeemoji || '•'} 🤖 Bot Connected Successfully! ✅`))
                console.log(chalk.blue(`Bot Version: ${settings.version}`))
            }
            
            if (connection === 'close') {
                const shouldReconnect = (lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut
                const statusCode = lastDisconnect?.error?.output?.statusCode
                
                console.log(chalk.red(`Connection closed due to ${lastDisconnect?.error}, reconnecting ${shouldReconnect}`))
                
                if (statusCode === DisconnectReason.loggedOut || statusCode === 401) {
                    try {
                        rmSync('./session', { recursive: true, force: true })
                        console.log(chalk.yellow('Session folder deleted. Please re-authenticate.'))
                    } catch (error) {
                        console.error('Error deleting session:', error)
                    }
                    console.log(chalk.red('Session logged out. Please re-authenticate.'))
                }
                
                if (shouldReconnect) {
                    console.log(chalk.yellow('Reconnecting...'))
                    await delay(5000)
                    startXeonBotInc()
                }
            }
        })

        // Track recently-notified callers to avoid spamming messages
        const antiCallNotified = new Set();

        // Anticall handler: block callers when enabled
        XeonBotInc.ev.on('call', async (calls) => {
            try {
                const { readState: readAnticallState } = require('./commands/anticall');
                const state = readAnticallState();
                if (!state.enabled) return;
                for (const call of calls) {
                    const callerJid = call.from || call.peerJid || call.chatId;
                    if (!callerJid) continue;
                    try {
                        // First: attempt to reject the call if supported
                        try {
                            if (typeof XeonBotInc.rejectCall === 'function' && call.id) {
                                await XeonBotInc.rejectCall(call.id, callerJid);
                            } else if (typeof XeonBotInc.sendCallOfferAck === 'function' && call.id) {
                                await XeonBotInc.sendCallOfferAck(call.id, callerJid, 'reject');
                            }
                        } catch {}

                        // Notify the caller only once within a short window
                        if (!antiCallNotified.has(callerJid)) {
                            antiCallNotified.add(callerJid);
                            setTimeout(() => antiCallNotified.delete(callerJid), 60000);
                            await XeonBotInc.sendMessage(callerJid, { text: '📵 Anticall is enabled. Your call was rejected and you will be blocked.' });
                        }
                    } catch {}
                    // Then: block after a short delay to ensure rejection and message are processed
                    setTimeout(async () => {
                        try { await XeonBotInc.updateBlockStatus(callerJid, 'block'); } catch {}
                    }, 800);
                }
            } catch (e) {
                // ignore
            }
        });

        XeonBotInc.ev.on('group-participants.update', async (update) => {
            await handleGroupParticipantUpdate(XeonBotInc, update);
        });

        // Status update handlers
        XeonBotInc.ev.on('status.update', async (status) => {
            await handleStatus(XeonBotInc, status);
        });

        XeonBotInc.ev.on('messages.reaction', async (status) => {
            await handleStatus(XeonBotInc, status);
        });

        return XeonBotInc
    } catch (error) {
        console.error('Error in startXeonBotInc:', error)
        await delay(5000)
        startXeonBotInc()
    }
}

// Start the bot with error handling
startXeonBotInc().catch(error => {
    console.error('Fatal error:', error)
    process.exit(1)
})

process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err)
})

process.on('unhandledRejection', (err) => {
    console.error('Unhandled Rejection:', err)
})

let file = require.resolve(__filename)
fs.watchFile(file, () => {
    fs.unwatchFile(file)
    console.log(chalk.redBright(`Update ${__filename}`))
    delete require.cache[file]
    require(file)
})
