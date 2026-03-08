const fs = require('fs');
const path = require('path');
const axios = require('axios');

const TEMP_DIR = path.join(process.cwd(), 'temp');
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
    return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

async function downCommand(sock, chatId, message, url) {
    if (!url) {
        await sock.sendMessage(chatId, { 
            text: '❌ Please provide a direct download link!\nExample: .down https://example.com/file.pdf' 
        });
        return;
    }

    let tempFile = null;
    let progressMsg = null;
    
    try {
        // Send initial progress message
        progressMsg = await sock.sendMessage(chatId, { 
            text: '⏳ Checking file...' 
        });

        // Get file info
        const headResponse = await axios({
            method: 'HEAD',
            url: url,
            timeout: 10000,
            maxRedirects: 5
        }).catch(() => ({ headers: {} }));

        const contentLength = headResponse.headers['content-length'];
        const contentType = headResponse.headers['content-type'] || 'application/octet-stream';
        
        // Extract filename
        let fileName = url.split('/').pop().split('?')[0] || 'file';
        const contentDisposition = headResponse.headers['content-disposition'];
        if (contentDisposition) {
            const match = contentDisposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
            if (match) fileName = match[1].replace(/['"]/g, '');
        }

        // Download file with progress tracking
        const safeFileName = fileName.replace(/[^a-zA-Z0-9.-]/g, '_');
        tempFile = path.join(TEMP_DIR, `download_${Date.now()}_${safeFileName}`);
        
        const downloadResponse = await axios({
            method: 'GET',
            url: url,
            responseType: 'stream',
            timeout: 7200000, // 2 hours
            onDownloadProgress: (progressEvent) => {
                if (progressEvent.lengthComputable && progressMsg) {
                    const percent = Math.round((progressEvent.loaded * 100) / progressEvent.total);
                    const downloaded = formatFileSize(progressEvent.loaded);
                    const total = formatFileSize(progressEvent.total);
                    
                    // Create progress bar
                    const barLength = 20;
                    const filled = Math.round((percent * barLength) / 100);
                    const bar = '█'.repeat(filled) + '░'.repeat(barLength - filled);
                    
                    // Update the same message
                    sock.sendMessage(chatId, {
                        text: `📥 *Downloading...*\n\n${bar} ${percent}%\n📦 Downloaded: ${downloaded} / ${total}\n📁 File: ${fileName}`,
                        edit: progressMsg.key // Edit the previous message
                    });
                }
            }
        });

        const writer = fs.createWriteStream(tempFile);
        downloadResponse.data.pipe(writer);
        
        await new Promise((resolve, reject) => {
            writer.on('finish', resolve);
            writer.on('error', reject);
        });

        // Verify download
        const stats = fs.statSync(tempFile);
        if (stats.size === 0) throw new Error('File is empty');

        // Update progress message to 100%
        if (progressMsg) {
            await sock.sendMessage(chatId, {
                text: `✅ *Download complete!*\n\n📁 File: ${fileName}\n📦 Size: ${formatFileSize(stats.size)}\n⏳ Preparing to send...`,
                edit: progressMsg.key
            });
        }

        // Send file
        const fileBuffer = fs.readFileSync(tempFile);
        await sock.sendMessage(chatId, {
            document: fileBuffer,
            fileName: fileName,
            mimetype: contentType,
            caption: `✅ *Download complete!*\n\n📁 *File:* ${fileName}\n📦 *Size:* ${formatFileSize(stats.size)}`
        });

        // Delete the progress message
        if (progressMsg) {
            await sock.sendMessage(chatId, {
                delete: progressMsg.key
            });
        }

        // Clean up
        fs.unlinkSync(tempFile);

    } catch (error) {
        console.error('Download error:', error);
        
        if (tempFile && fs.existsSync(tempFile)) {
            fs.unlinkSync(tempFile);
        }
        
        // Update progress message with error
        if (progressMsg) {
            let errorMsg = '❌ Download failed.';
            if (error.response?.status === 404) errorMsg = '❌ File not found (404).';
            else if (error.response?.status === 403) errorMsg = '❌ Access denied (403).';
            else if (error.code === 'ECONNABORTED') errorMsg = '❌ Download timeout.';
            
            await sock.sendMessage(chatId, {
                text: errorMsg,
                edit: progressMsg.key
            });
        } else {
            await sock.sendMessage(chatId, { text: '❌ Download failed.' });
        }
    }
}

module.exports = downCommand;
