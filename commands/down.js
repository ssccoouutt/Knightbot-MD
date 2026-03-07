const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { downloadContentFromMessage } = require('@whiskeysockets/baileys');

async function downCommand(sock, chatId, message, url) {
    if (!url) {
        await sock.sendMessage(chatId, { 
            text: '❌ Please provide a direct download link!\nExample: .down https://example.com/file.pdf' 
        });
        return;
    }

    try {
        await sock.sendMessage(chatId, { text: '⏳ Downloading file...' });

        // Get file info
        const response = await axios({
            method: 'HEAD',
            url: url,
            timeout: 5000
        });

        const contentType = response.headers['content-type'];
        const contentLength = response.headers['content-length'];
        const fileName = url.split('/').pop().split('?')[0] || 'file';

        // Check file size (max 50MB)
        if (contentLength > 50 * 1024 * 1024) {
            await sock.sendMessage(chatId, { 
                text: '❌ File too large! Maximum size is 50MB.' 
            });
            return;
        }

        // Download the file
        const downloadResponse = await axios({
            method: 'GET',
            url: url,
            responseType: 'arraybuffer',
            timeout: 30000
        });

        const fileBuffer = Buffer.from(downloadResponse.data);

        // Send as document
        await sock.sendMessage(chatId, {
            document: fileBuffer,
            fileName: fileName,
            mimetype: contentType || 'application/octet-stream',
            caption: `✅ File downloaded successfully!\n📁 Name: ${fileName}\n📦 Size: ${(contentLength / 1024 / 1024).toFixed(2)}MB`
        });

    } catch (error) {
        console.error('Download error:', error);
        await sock.sendMessage(chatId, { 
            text: '❌ Failed to download file. Make sure the link is direct and accessible.' 
        });
    }
}

module.exports = downCommand;
