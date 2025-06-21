require('./settings')
const { Boom } = require('@hapi/boom')
const fs = require('fs')
const chalk = require('chalk')
const { 
    default: makeWASocket,
    useMultiFileAuthState, 
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore
} = require("@whiskeysockets/baileys")
const NodeCache = require("node-cache")
const pino = require("pino")

async function startBot() {
    let { version } = await fetchLatestBaileysVersion()
    const { state, saveCreds } = await useMultiFileAuthState(`./session`)

    const sock = makeWASocket({
        version,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: true,
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" })),
        },
        markOnlineOnConnect: true,
    })

    // Message handling
    sock.ev.on('messages.upsert', async ({ messages }) => {
        const message = messages[0]
        if (!message?.message) return

        const chatId = message.key.remoteJid
        const text = message.message.conversation || ''

        if (text.toLowerCase() === 'hi') {
            await sock.sendMessage(chatId, { text: 'Hello!' })
        }
    })

    // Connection handling
    sock.ev.on('connection.update', (update) => {
        const { connection } = update
        if (connection === "open") {
            console.log(chalk.green('Bot connected successfully!'))
        }
    })

    sock.ev.on('creds.update', saveCreds)
}

// Start the bot
startBot().catch(error => {
    console.error('Error:', error)
    process.exit(1)
})
