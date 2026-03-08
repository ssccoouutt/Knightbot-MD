const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { pipeline } = require('stream/promises');
const { createWriteStream } = require('fs');

// Set to 2GB (2147483648 bytes)
const MAX_FILE_SIZE = 2 * 1024 * 1024 * 1024;
const TEMP_DIR = path.join(process.cwd(), 'temp');

if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
}

async function downCommand(sock, chatId, message, url) {
    if (!url) {
        await sock.sendMessage(chatId, { text: '❌ Please provide a direct download link!' });
        return;
    }

    let tempFile = null;
    try {
        // Send initial message
        await sock.sendMessage(chatId, { text: '⏳ Checking file size...' });

        // Check file size via HEAD request
        const headResponse = await axios({
            method: 'HEAD',
            url: url,
            timeout: 10000,
            maxRedirects: 5
        });

        const contentLength = headResponse.headers['content-length'];
        const contentType = headResponse.headers['content-type'] || 'application/octet-stream';
        
        // Extract filename
        let fileName = url.split('/').pop().split('?')[0] || 'file';
        const contentDisposition = headResponse.headers['content-disposition'];
        if (contentDisposition) {
            const match = contentDisposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
            if (match) fileName = match[1].replace(/['"]/g, '');
        }

        // Validate file size
        if (contentLength) {
            const fileSizeGB = (contentLength / (1024 * 1024 * 1024)).toFixed(2);
            
            if (contentLength > MAX_FILE_SIZE) {
                await sock.sendMessage(chatId, { 
                    text: `❌ File too large! Maximum size is 2GB.\n📁 File size: ${fileSizeGB}GB` 
                });
                return;
            }
            
            await sock.sendMessage(chatId, { 
                text: `📥 Downloading: ${fileName}\n📦 Size: ${fileSizeGB}GB\n⏳ Please wait...` 
            });
        }

        // Create temp file path
        tempFile = path.join(TEMP_DIR, `download_${Date.now()}_${fileName}`);
        const writer = createWriteStream(tempFile);

        // Download the file and stream directly to disk
        const downloadResponse = await axios({
            method: 'GET',
            url: url,
            responseType: 'stream',
            timeout: 7200000, // 2 hour timeout for 2GB files
            maxContentLength: MAX_FILE_SIZE,
        });

        // Pipe the download stream to the file
        await pipeline(downloadResponse.data, writer);

        // Check the final file size
        const stats = await fs.promises.stat(tempFile);
        if (stats.size > MAX_FILE_SIZE) {
            await fs.promises.unlink(tempFile);
            await sock.sendMessage(chatId, { text: '❌ Downloaded file exceeds 2GB limit.' });
            return;
        }

        // --- CRITICAL FIX: Send file WITHOUT loading into memory ---
        // Use a read stream instead of readFileSync
        const fileStream = fs.createReadStream(tempFile);
        const fileSizeGB = (stats.size / (1024 * 1024 * 1024)).toFixed(2);

        await sock.sendMessage(chatId, {
            document: fileStream,  // Pass the stream directly
            fileName: fileName,
            mimetype: contentType,
            caption: `✅ *File downloaded successfully!*\n\n📁 *Name:* ${fileName}\n📦 *Size:* ${fileSizeGB}GB`
        });

        // Clean up temp file
        await fs.promises.unlink(tempFile);
        console.log(`✅ Successfully downloaded and sent: ${fileName}`);

    } catch (error) {
        console.error('Download error:', error);
        
        // Clean up temp file if it exists
        if (tempFile) {
            try { await fs.promises.unlink(tempFile); } catch (e) {}
        }

        let errorMessage = '❌ Failed to download file.';
        if (error.code === 'ECONNABORTED') {
            errorMessage = '❌ Download timeout. File may be too large or server is slow.';
        } else if (error.response?.status === 404) {
            errorMessage = '❌ File not found (404).';
        } else if (error.response?.status === 403) {
            errorMessage = '❌ Access denied (403).';
        }
        
        await sock.sendMessage(chatId, { text: errorMessage });
    }
}

module.exports = downCommand;
