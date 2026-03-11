/**
 * ULTRA SIMPLE TEST BOT
 * Nothing else, just pure basic WhatsApp bot
 */
const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
    delay
} = require("@whiskeysockets/baileys");
const pino = require("pino");
const { Boom } = require("@hapi/boom");
const readline = require("readline");

// Your number
const PHONE_NUMBER = "923247220362";

// Create readline interface for pairing code
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const question = (text) => new Promise((resolve) => rl.question(text, resolve));

async function startBot() {
    console.log("🚀 Starting ULTRA SIMPLE TEST BOT...");
    console.log(`📱 Your number: ${PHONE_NUMBER}`);
    
    const { state, saveCreds } = await useMultiFileAuthState("session");
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        logger: pino({ level: "silent" }),
        printQRInTerminal: false,
        auth: state,
        browser: ["ULTRA SIMPLE", "TEST", "1.0.0"],
    });

    // Handle connection
    sock.ev.on("connection.update", async (update) => {
        const { connection, lastDisconnect } = update;
        
        if (connection === "connecting") {
            console.log("🔄 Connecting...");
        }
        
        if (connection === "open") {
            console.log("✅ CONNECTED SUCCESSFULLY!");
            console.log("📱 Send '.ping' to this number to test");
            
            // Send yourself a test message
            setTimeout(async () => {
                await sock.sendMessage(`${PHONE_NUMBER}@s.whatsapp.net`, { 
                    text: "✅ Bot is online! Send .ping" 
                });
            }, 2000);
        }
        
        if (connection === "close") {
            const shouldReconnect = (lastDisconnect.error instanceof Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log("Connection closed, reconnecting:", shouldReconnect);
            if (shouldReconnect) startBot();
        }
    });

    sock.ev.on("creds.update", saveCreds);

    // Handle pairing code
    if (!sock.authState.creds.registered) {
        console.log("\n📱 Requesting pairing code...");
        setTimeout(async () => {
            try {
                let code = await sock.requestPairingCode(PHONE_NUMBER);
                code = code?.match(/.{1,4}/g)?.join("-") || code;
                console.log("\n🔐 ========== PAIRING CODE ==========");
                console.log(`       ${code}`);
                console.log("=====================================\n");
                console.log("1. Open WhatsApp on your phone");
                console.log("2. Go to Settings > Linked Devices");
                console.log("3. Tap 'Link a Device'");
                console.log(`4. Enter this code: ${code}\n`);
            } catch (error) {
                console.error("Pairing code error:", error);
            }
        }, 3000);
    }

    // ===== SUPER SIMPLE MESSAGE HANDLER =====
    sock.ev.on("messages.upsert", async (m) => {
        try {
            // Get the message
            const msg = m.messages[0];
            if (!msg?.message || msg.key?.fromMe) return;
            
            // Get text
            let text = "";
            if (msg.message.conversation) text = msg.message.conversation;
            else if (msg.message.extendedTextMessage?.text) text = msg.message.extendedTextMessage.text;
            else return;
            
            console.log(`📨 Received: "${text}" from ${msg.key.remoteJid}`);
            
            // ONLY ONE COMMAND - .ping
            if (text === ".ping") {
                await sock.sendMessage(msg.key.remoteJid, { text: "pong" });
                console.log("✅ Sent: pong");
            }
            
        } catch (err) {
            console.error("Error:", err);
        }
    });

    return sock;
}

startBot().catch(console.error);
