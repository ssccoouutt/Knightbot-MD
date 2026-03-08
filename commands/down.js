const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { pipeline } = require('stream/promises');
const { createWriteStream } = require('fs');

const MAX_FILE_SIZE = 2 * 1024 * 1024 * 1024; // 2GB
const TEMP_DIR = path.join(process.cwd(), 'temp');

if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
}

// Helper to format file size
function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
    return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

async function downCommand(sock, chatId, message, url) {
    if (!url) {
        await sock.sendMessage(chatId, { text: '❌ Please provide a direct download link!' });
        return;
    }

    let tempFile = null;
    let fileName = 'file';
    let contentType = 'application/octet-stream';
    
    try {
        // Send initial message
        await sock.sendMessage(chatId, { text: '⏳ Checking file...' });

        // Get file info with timeout
        const headResponse = await axios({
            method: 'HEAD',
            url: url,
            timeout: 10000,
            maxRedirects: 5,
            validateStatus: function (status) {
                return status >= 200 && status < 300; // Accept only 2xx
            }
        }).catch(() => ({ headers: {} })); // If HEAD fails, continue anyway

        const contentLength = headResponse.headers?.['content-length'];
        
        // Extract filename
        fileName = url.split('/').pop().split('?')[0] || 'file';
        const contentDisposition = headResponse.headers?.['content-disposition'];
        if (contentDisposition) {
            const match = contentDisposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
            if (match) fileName = match[1].replace(/['"]/g, '');
        }

        // Check size if available
        if (contentLength) {
            const sizeNum = parseInt(contentLength);
            if (sizeNum > MAX_FILE_SIZE) {
                await sock.sendMessage(chatId, { 
                    text: `❌ File too large! Max 2GB\n📁 Size: ${formatFileSize(sizeNum)}` 
                });
                return;
            }
            
            await sock.sendMessage(chatId, { 
                text: `📥 Downloading: ${fileName}\n📦 Size: ${formatFileSize(sizeNum)}\n⏳ Please wait...` 
            });
        } else {
            await sock.sendMessage(chatId, { 
                text: `📥 Downloading: ${fileName}\n⚠️ Size unknown\n⏳ This may take a while...` 
            });
        }

        // Create temp file
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
            onDownloadProgress: (progressEvent) => {
                if (progressEvent.lengthComputable) {
                    const percent = Math.round((progressEvent.loaded * 100) / progressEvent.total);
                    console.log(`Download: ${percent}% (${formatFileSize(progressEvent.loaded)})`);
                }
            }
        });

        const writer = createWriteStream(tempFile);
        
        // Track download progress
        let downloadedBytes = 0;
        downloadResponse.data.on('data', (chunk) => {
            downloadedBytes += chunk.length;
            if (contentLength) {
                const percent = Math.round((downloadedBytes * 100) / parseInt(contentLength));
                if (percent % 10 === 0) {
                    console.log(`Download progress: ${percent}%`);
                }
            }
        });

        // Pipe with error handling
        await new Promise((resolve, reject) => {
            pipeline(downloadResponse.data, writer)
                .then(resolve)
                .catch(reject);
            
            writer.on('error', reject);
            downloadResponse.data.on('error', reject);
        });

        console.log(`✅ Download complete: ${tempFile}`);

        // Verify file
        if (!fs.existsSync(tempFile)) {
            throw new Error('File was not saved');
        }

        const stats = fs.statSync(tempFile);
        if (stats.size === 0) {
            throw new Error('Downloaded file is empty');
        }

        if (stats.size > MAX_FILE_SIZE) {
            fs.unlinkSync(tempFile);
            await sock.sendMessage(chatId, { text: '❌ File exceeds 2GB limit.' });
            return;
        }

        const fileSize = formatFileSize(stats.size);
        console.log(`📤 Sending file: ${fileName} (${fileSize})`);

        // Send file - using buffer but splitting if needed
        const fileBuffer = fs.readFileSync(tempFile);
        
        // Send as document with minimal processing
        await sock.sendMessage(chatId, {
            document: fileBuffer,
            fileName: fileName,
            mimetype: 'application/octet-stream', // Force generic type to avoid processing
            caption: `✅ *Download complete!*\n\n📁 *File:* ${fileName}\n📦 *Size:* ${fileSize}`
        });

        console.log(`✅ File sent successfully`);

        // Clean up
        fs.unlinkSync(tempFile);
        console.log(`🧹 Cleaned up: ${tempFile}`);

    } catch (error) {
        console.error('Download error details:', {
            message: error.message,
            code: error.code,
            stack: error.stack
        });
        
        // Clean up temp file
        if (tempFile && fs.existsSync(tempFile)) {
            try { 
                fs.unlinkSync(tempFile);
                console.log(`🧹 Cleaned up failed download`);
            } catch (e) {}
        }

        // User-friendly error
        let errorMessage = '❌ Download failed.';
        
        if (error.code === 'ECONNABORTED') {
            errorMessage = '❌ Connection timeout. Server too slow.';
        } else if (error.response?.status === 404) {
            errorMessage = '❌ File not found (404).';
        } else if (error.response?.status === 403) {
            errorMessage = '❌ Access denied (403).';
        } else if (error.code === 'ENOENT') {
            errorMessage = '❌ Download failed - file not created.';
        } else if (error.message.includes('toString')) {
            errorMessage = '❌ File may be corrupted or too large for WhatsApp.';
        } else if (error.message.includes('maxContentLength')) {
            errorMessage = '❌ File too large (exceeded 2GB).';
        } else {
            errorMessage = `❌ Download failed: ${error.message.substring(0, 100)}`;
        }
        
        await sock.sendMessage(chatId, { text: errorMessage });
    }
}

module.exports = downCommand;
