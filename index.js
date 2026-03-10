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

        // ===== MESSAGE HANDLER WITH FULL DEBUGGING =====
        XeonBotInc.ev.on('messages.upsert', async (messageData) => {
            try {
                console.log('\n' + '='.repeat(60));
                console.log(chalk.yellow('📥 RAW MESSAGE EVENT RECEIVED'));
                console.log('='.repeat(60));
                
                // Log the entire structure to see what we're getting
                console.log(chalk.cyan('Event structure:'), {
                    hasMessages: !!messageData?.messages,
                    hasType: !!messageData?.type,
                    type: messageData?.type,
                    messageCount: messageData?.messages?.length
                });
                
                // Check if it's the v6.6.0 format (messages array directly)
                if (Array.isArray(messageData)) {
                    console.log(chalk.green('✅ Detected v6.6.0 format (array)'));
                    const messages = messageData;
                    const type = 'notify'; // Assume notify for array format
                    
                    console.log(chalk.blue('Processing messages array:'), {
                        count: messages.length,
                        type: type
                    });
                    
                    if (messages.length === 0) {
                        console.log(chalk.red('❌ Empty messages array'));
                        return;
                    }
                    
                    const mek = messages[0];
                    
                    console.log(chalk.magenta('Message details:'), {
                        hasMessage: !!mek,
                        hasMessageObj: !!mek?.message,
                        key: mek?.key,
                        fromMe: mek?.key?.fromMe,
                        remoteJid: mek?.key?.remoteJid,
                        id: mek?.key?.id
                    });
                    
                    if (!mek?.message) {
                        console.log(chalk.red('❌ No message content'));
                        return;
                    }
                    
                    // Handle ephemeral messages
                    if (mek.message.ephemeralMessage) {
                        console.log(chalk.cyan('🔄 Handling ephemeral message'));
                        mek.message = mek.message.ephemeralMessage.message;
                    }
                    
                    // Handle status broadcasts
                    if (mek.key?.remoteJid === 'status@broadcast') {
                        console.log(chalk.cyan('📱 Status broadcast detected'));
                        const chatUpdate = { messages: [mek], type };
                        await handleStatus(XeonBotInc, chatUpdate);
                        return;
                    }
                    
                    // Skip own messages
                    if (mek.key?.fromMe) {
                        console.log(chalk.gray('⏭️ Skipping own message'));
                        return;
                    }
                    
                    // Skip protocol messages
                    if (mek.key?.id?.startsWith('BAE5') && mek.key.id.length === 16) {
                        console.log(chalk.gray('⏭️ Skipping protocol message'));
                        return;
                    }
                    
                    // Create chatUpdate for main.js
                    const chatUpdate = {
                        messages: [mek],
                        type: type
                    };
                    
                    console.log(chalk.green('✅ Calling handleMessages with:'), {
                        hasMessages: !!chatUpdate.messages,
                        messageType: type,
                        messageId: mek.key?.id
                    });
                    
                    await handleMessages(XeonBotInc, chatUpdate, true);
                    console.log(chalk.green('✅ handleMessages completed'));
                    
                } 
                // Check if it's the v7.x format (object with messages property)
                else if (messageData?.messages) {
                    console.log(chalk.green('✅ Detected v7.x format (messages object)'));
                    const { messages, type } = messageData;
                    
                    console.log(chalk.blue('Processing messages object:'), {
                        count: messages?.length,
                        type: type
                    });
                    
                    if (type !== 'notify') {
                        console.log(chalk.gray('⏭️ Skipping non-notify type:', type));
                        return;
                    }
                    
                    const mek = messages[0];
                    
                    console.log(chalk.magenta('Message details:'), {
                        hasMessage: !!mek,
                        hasMessageObj: !!mek?.message,
                        key: mek?.key,
                        fromMe: mek?.key?.fromMe,
                        remoteJid: mek?.key?.remoteJid,
                        id: mek?.key?.id
                    });
                    
                    if (!mek?.message) {
                        console.log(chalk.red('❌ No message content'));
                        return;
                    }
                    
                    // Handle ephemeral messages
                    if (mek.message.ephemeralMessage) {
                        console.log(chalk.cyan('🔄 Handling ephemeral message'));
                        mek.message = mek.message.ephemeralMessage.message;
                    }
                    
                    // Handle status broadcasts
                    if (mek.key?.remoteJid === 'status@broadcast') {
                        console.log(chalk.cyan('📱 Status broadcast detected'));
                        const chatUpdate = { messages: [mek], type };
                        await handleStatus(XeonBotInc, chatUpdate);
                        return;
                    }
                    
                    // Skip own messages
                    if (mek.key?.fromMe) {
                        console.log(chalk.gray('⏭️ Skipping own message'));
                        return;
                    }
                    
                    // Skip protocol messages
                    if (mek.key?.id?.startsWith('BAE5') && mek.key.id.length === 16) {
                        console.log(chalk.gray('⏭️ Skipping protocol message'));
                        return;
                    }
                    
                    // Check private mode
                    if (!XeonBotInc.public && !mek.key.fromMe && type === 'notify') {
                        const isGroup = mek.key?.remoteJid?.endsWith('@g.us');
                        if (!isGroup) {
                            console.log(chalk.gray('⏭️ Private mode blocking DM'));
                            return;
                        }
                    }
                    
                    // Create chatUpdate for main.js
                    const chatUpdate = {
                        messages: [mek],
                        type: type
                    };
                    
                    console.log(chalk.green('✅ Calling handleMessages with:'), {
                        hasMessages: !!chatUpdate.messages,
                        messageType: type,
                        messageId: mek.key?.id
                    });
                    
                    await handleMessages(XeonBotInc, chatUpdate, true);
                    console.log(chalk.green('✅ handleMessages completed'));
                }
                else {
                    console.log(chalk.red('❌ Unknown message format:'), messageData);
                }
                
            } catch (err) {
                console.error(chalk.red('❌ Fatal error in messages.upsert:'), err);
            }
            console.log('='.repeat(60) + '\n');
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
                if (!(v.name || v.subject)) v = XeonBotInc.groupMetadata(id) || {}
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
                        try {
                            if (typeof XeonBotInc.rejectCall === 'function' && call.id) {
                                await XeonBotInc.rejectCall(call.id, callerJid);
                            } else if (typeof XeonBotInc.sendCallOfferAck === 'function' && call.id) {
                                await XeonBotInc.sendCallOfferAck(call.id, callerJid, 'reject');
                            }
                        } catch {}

                        if (!antiCallNotified.has(callerJid)) {
                            antiCallNotified.add(callerJid);
                            setTimeout(() => antiCallNotified.delete(callerJid), 60000);
                            await XeonBotInc.sendMessage(callerJid, { text: '📵 Anticall is enabled. Your call was rejected and you will be blocked.' });
                        }
                    } catch {}
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
