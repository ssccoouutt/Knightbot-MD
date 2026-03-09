const fs = require('fs');
const path = require('path');
const axios = require('axios');

const TEMP_DIR = path.join(process.cwd(), 'temp');
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

// Store active downloads with their update functions
const activeDownloads = new Map();

function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
    return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

async function updateProgress(sock, chatId, messageKey, percent, downloaded, total, fileName, status = 'downloading') {
    const barLength = 20;
    const filled = Math.round((percent * barLength) / 100);
    const bar = '█'.repeat(filled) + '░'.repeat(barLength - filled);
    
    let text = '';
    if (status === 'downloading') {
        text = `📥 *Downloading...*\n\n${bar} ${percent}%\n📦 Downloaded: ${downloaded} / ${total}\n📁 File: ${fileName}`;
    } else if (status === 'complete') {
        text = `✅ *Download complete!*\n\n📁 File: ${fileName}\n📦 Size: ${total}\n⏳ Preparing to send...`;
    } else if (status === 'sending') {
        text = `📤 *Sending to WhatsApp...*\n\n📁 File: ${fileName}\n📦 Size: ${total}`;
    } else if (status === 'error') {
        text = `❌ *Download failed*\n\n📁 File: ${fileName}\nError: ${downloaded}`;
    }
    
    await sock.sendMessage(chatId, {
        text: text,
        edit: messageKey
    });
}

async function downloadFile(sock, chatId, messageKey, url, fileName, contentLength, contentType) {
    const downloadId = `${chatId}_${Date.now()}`;
    const safeFileName = fileName.replace(/[^a-zA-Z0-9.-]/g, '_');
    const tempFile = path.join(TEMP_DIR, `download_${Date.now()}_${safeFileName}`);
    
    // Register this download
    activeDownloads.set(downloadId, { chatId, fileName, progress: 0, status: 'starting' });
    
    try {
        const downloadResponse = await axios({
            method: 'GET',
            url: url,
            responseType: 'stream',
            timeout: 7200000,
            onDownloadProgress: (progressEvent) => {
                if (progressEvent.lengthComputable) {
                    const percent = Math.round((progressEvent.loaded * 100) / progressEvent.total);
                    const downloaded = formatFileSize(progressEvent.loaded);
                    const total = formatFileSize(progressEvent.total);
                    
                    // Update progress in map
                    const download = activeDownloads.get(downloadId);
                    if (download) {
                        download.progress = percent;
                        download.status = 'downloading';
                        activeDownloads.set(downloadId, download);
                    }
                    
                    // Update WhatsApp message
                    updateProgress(sock, chatId, messageKey, percent, downloaded, total, fileName);
                }
            }
        });

        const writer = fs.createWriteStream(tempFile);
        downloadResponse.data.pipe(writer);
        
        await new Promise((resolve, reject) => {
            writer.on('finish', resolve);
            writer.on('error', reject);
        });

        const stats = fs.statSync(tempFile);
        if (stats.size === 0) throw new Error('File is empty');

        // Update status
        const download = activeDownloads.get(downloadId);
        if (download) {
            download.progress = 100;
            download.status = 'complete';
            activeDownloads.set(downloadId, download);
        }

        await updateProgress(sock, chatId, messageKey, 100, formatFileSize(stats.size), formatFileSize(stats.size), fileName, 'complete');
        await updateProgress(sock, chatId, messageKey, 100, formatFileSize(stats.size), formatFileSize(stats.size), fileName, 'sending');
        
        // Update status
        if (download) {
            download.status = 'sending';
            activeDownloads.set(downloadId, download);
        }
        
        const fileBuffer = fs.readFileSync(tempFile);
        await sock.sendMessage(chatId, {
            document: fileBuffer,
            fileName: fileName,
            mimetype: contentType,
            caption: `✅ *Download complete!*\n\n📁 *File:* ${fileName}\n📦 *Size:* ${formatFileSize(stats.size)}`
        });

        // Delete progress message
        await sock.sendMessage(chatId, {
            delete: messageKey
        });

        // Clean up
        fs.unlinkSync(tempFile);
        
        // Remove from active downloads
        activeDownloads.delete(downloadId);

    } catch (error) {
        console.error('Download error:', error);
        
        if (fs.existsSync(tempFile)) {
            fs.unlinkSync(tempFile);
        }
        
        let errorMsg = 'Download failed';
        if (error.response?.status === 404) errorMsg = 'File not found (404)';
        else if (error.response?.status === 403) errorMsg = 'Access denied (403)';
        else if (error.code === 'ECONNABORTED') errorMsg = 'Download timeout';
        else errorMsg = error.message;
        
        await updateProgress(sock, chatId, messageKey, 0, errorMsg, '', fileName, 'error');
        
        // Remove from active downloads
        activeDownloads.delete(downloadId);
    }
}

async function downCommand(sock, chatId, message, url) {
    if (!url) {
        await sock.sendMessage(chatId, { 
            text: '❌ Please provide a direct download link!\nExample: .down https://example.com/file.pdf' 
        });
        return;
    }

    try {
        // Send initial progress message
        const progressMsg = await sock.sendMessage(chatId, { 
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

        // Start download in background
        downloadFile(sock, chatId, progressMsg.key, url, fileName, contentLength, contentType)
            .catch(err => console.error('Background download error:', err));

        // Immediate response
        await sock.sendMessage(chatId, { 
            text: `✅ *Download started in background!*\n\n` +
                  `📁 File: ${fileName}\n` +
                  `📦 Size: ${contentLength ? formatFileSize(parseInt(contentLength)) : 'Unknown'}\n\n` +
                  `🔄 You can check status with .dlstatus\n` +
                  `📊 Active downloads: ${activeDownloads.size + 1}`
        });

    } catch (error) {
        console.error('Download command error:', error);
        await sock.sendMessage(chatId, { text: '❌ Failed to start download.' });
    }
}

// Add status command
async function dlstatusCommand(sock, chatId, message) {
    if (activeDownloads.size === 0) {
        await sock.sendMessage(chatId, { text: '📊 No active downloads.' });
        return;
    }
    
    let status = `📊 *Active Downloads: ${activeDownloads.size}*\n\n`;
    let i = 1;
    for (const [id, download] of activeDownloads.entries()) {
        status += `${i}. 📁 ${download.fileName}\n`;
        status += `   📊 Progress: ${download.progress}%\n`;
        status += `   📍 Status: ${download.status}\n`;
        if (i < activeDownloads.size) status += '\n';
        i++;
    }
    
    await sock.sendMessage(chatId, { text: status });
}

module.exports = { downCommand, dlstatusCommand };
