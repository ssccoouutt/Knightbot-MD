const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { pipeline } = require('stream/promises');
const { createWriteStream } = require('fs');

const MAX_FILE_SIZE = 2 * 1024 * 1024 * 1024; // 2GB
const TEMP_DIR = path.join(process.cwd(), 'temp');

// Ensure temp directory exists
if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
}

async function downCommand(sock, chatId, message, url) {
    if (!url) {
        await sock.sendMessage(chatId, { text: '❌ Please provide a direct download link!' });
        return;
    }

    let tempFile = null;
    let fileName = 'file';
    
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
        
        // Extract filename from URL
        fileName = url.split('/').pop().split('?')[0] || 'file';
        
        // Try to get better filename from content-disposition
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
        } else {
            await sock.sendMessage(chatId, { 
                text: `📥 Downloading: ${fileName}\n⚠️ Size unknown\n⏳ Please wait...` 
            });
        }

        // Create temp file path (sanitize filename)
        const safeFileName = fileName.replace(/[^a-zA-Z0-9.-]/g, '_');
        tempFile = path.join(TEMP_DIR, `download_${Date.now()}_${safeFileName}`);
        
        console.log(`📥 Downloading to: ${tempFile}`);

        // Download the file
        const downloadResponse = await axios({
            method: 'GET',
            url: url,
            responseType: 'stream',
            timeout: 7200000, // 2 hours
            maxContentLength: MAX_FILE_SIZE,
        });

        const writer = createWriteStream(tempFile);
        
        // Pipe with progress tracking
        let downloadedBytes = 0;
        downloadResponse.data.on('data', (chunk) => {
            downloadedBytes += chunk.length;
            if (contentLength) {
                const percent = Math.round((downloadedBytes * 100) / contentLength);
                if (percent % 10 === 0) { // Log every 10%
                    console.log(`Download progress: ${percent}%`);
                }
            }
        });

        await pipeline(downloadResponse.data, writer);
        
        console.log(`✅ Download complete: ${tempFile}`);

        // Verify file exists
        if (!fs.existsSync(tempFile)) {
            throw new Error('File was not saved properly');
        }

        // Check file size
        const stats = await fs.promises.stat(tempFile);
        if (stats.size === 0) {
            throw new Error('Downloaded file is empty');
        }

        if (stats.size > MAX_FILE_SIZE) {
            await fs.promises.unlink(tempFile);
            await sock.sendMessage(chatId, { text: '❌ Downloaded file exceeds 2GB limit.' });
            return;
        }

        const fileSizeMB = (stats.size / (1024 * 1024)).toFixed(2);
        const fileSizeGB = (stats.size / (1024 * 1024 * 1024)).toFixed(2);

        console.log(`📤 Sending file: ${fileName} (${fileSizeMB}MB)`);

        // Send file using stream
        const fileStream = fs.createReadStream(tempFile);
        
        await sock.sendMessage(chatId, {
            document: fileStream,
            fileName: fileName,
            mimetype: contentType,
            caption: `✅ *File downloaded successfully!*\n\n📁 *Name:* ${fileName}\n📦 *Size:* ${fileSizeGB}GB (${fileSizeMB}MB)`
        });

        console.log(`✅ File sent successfully`);

        // Clean up
        await fs.promises.unlink(tempFile);
        console.log(`🧹 Cleaned up: ${tempFile}`);

    } catch (error) {
        console.error('Download error:', error);
        
        // Clean up temp file if it exists
        if (tempFile && fs.existsSync(tempFile)) {
            try { 
                await fs.promises.unlink(tempFile);
                console.log(`🧹 Cleaned up failed download: ${tempFile}`);
            } catch (e) {}
        }

        // Send user-friendly error message
        let errorMessage = '❌ Failed to download file.';
        
        if (error.code === 'ECONNABORTED') {
            errorMessage = '❌ Download timeout. The server is too slow.';
        } else if (error.response?.status === 404) {
            errorMessage = '❌ File not found (404).';
        } else if (error.response?.status === 403) {
            errorMessage = '❌ Access denied (403).';
        } else if (error.code === 'ENOENT') {
            errorMessage = '❌ Download failed - file was not created.';
        } else if (error.message.includes('socket')) {
            errorMessage = '❌ Connection lost during download.';
        } else {
            errorMessage = `❌ Download failed: ${error.message.substring(0, 100)}`;
        }
        
        await sock.sendMessage(chatId, { text: errorMessage });
    }
}

module.exports = downCommand;
