/**
 * ULTRA DEBUG TEST - Shows EVERY message received
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

const PHONE_NUMBER = "923247220362";
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const question = (text) => new Promise((resolve) => rl.question(text, resolve));

async function startBot() {
    console.log("🚀 Starting ULTRA DEBUG TEST BOT...");
    console.log(`📱 Your number: ${PHONE_NUMBER}`);
    
    const { state, saveCreds } = await useMultiFileAuthState("session");
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        logger: pino({ level: "silent" }),
        printQRInTerminal: false,
        auth: state,
    });

    // Connection handler
    sock.ev.on("connection.update", async (update) => {
        const { connection, lastDisconnect } = update;
        
        if (connection === "open") {
            console.log("\n✅✅✅ CONNECTED SUCCESSFULLY! ✅✅✅");
            console.log("📱 Waiting for messages...");
            console.log("Send ANY message to see if it's detected\n");
        }
        
        if (connection === "close") {
            const shouldReconnect = (lastDisconnect.error instanceof Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) startBot();
        }
    });

    sock.ev.on("creds.update", saveCreds);

    // Handle pairing code
    if (!sock.authState.creds.registered) {
        setTimeout(async () => {
            try {
                let code = await sock.requestPairingCode(PHONE_NUMBER);
                code = code?.match(/.{1,4}/g)?.join("-") || code;
                console.log("\n🔐 ========== PAIRING CODE ==========");
                console.log(`       ${code}`);
                console.log("=====================================\n");
            } catch (error) {
                console.error("Pairing code error:", error);
            }
        }, 3000);
    }

    // ===== DEBUG ALL EVENTS =====
    sock.ev.on("messages.upsert", (m) => {
        console.log("\n📥📥📥 MESSAGE EVENT TRIGGERED! 📥📥📥");
        console.log("Event type:", m.type);
        console.log("Has messages:", !!m.messages);
        console.log("Message count:", m.messages?.length);
        
        if (m.messages && m.messages[0]) {
            const msg = m.messages[0];
            console.log("\n📨 RAW MESSAGE DATA:");
            console.log("  From:", msg.key?.remoteJid);
            console.log("  From Me:", msg.key?.fromMe);
            console.log("  ID:", msg.key?.id);
            console.log("  Has Message:", !!msg.message);
            
            if (msg.message) {
                console.log("  Message Types:", Object.keys(msg.message));
                
                // Try to extract text
                let text = "";
                if (msg.message.conversation) text = msg.message.conversation;
                else if (msg.message.extendedTextMessage?.text) text = msg.message.extendedTextMessage.text;
                else if (msg.message.imageMessage?.caption) text = msg.message.imageMessage.caption;
                
                console.log("  Text:", text || "[no text]");
                
                // Respond to ANY message
                if (text && !msg.key?.fromMe) {
                    console.log("  ✅ VALID MESSAGE DETECTED!");
                    sock.sendMessage(msg.key.remoteJid, { 
                        text: `✅ Received: "${text}"` 
                    }).catch(console.error);
                }
            }
        }
        console.log("📥📥📥 END MESSAGE EVENT 📥📥📥\n");
    });

    // Log other events too
    sock.ev.on("messages.reaction", (r) => console.log("Reaction event:", r));
    sock.ev.on("presence.update", (p) => console.log("Presence update"));
    
    return sock;
}

startBot().catch(console.error);
