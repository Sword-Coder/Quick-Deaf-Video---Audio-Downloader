const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const https = require('https');
const archiver = require('archiver');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const downloadDir = path.join(__dirname, 'downloads');
if (!fs.existsSync(downloadDir)) {
    fs.mkdirSync(downloadDir);
}

function sanitizeFilename(title) {
    let result = '';
    
    for (let i = 0; i < title.length; i++) {
        const char = title[i];
        const nextChar = title[i + 1];
        
        if (char === ',') {
            result += '__';
            if (nextChar === ' ') i++;
        } else if (char === '-') {
            result += '___';
            if (nextChar === ' ') i++;
        } else if (char === '&') {
            result += '___';
            if (nextChar === ' ') i++;
        } else if (char === '\'') {
            if (nextChar && /[a-zA-Z]/.test(nextChar)) {
                result += '_';
            } else {
                result += '__';
                if (nextChar === ' ') i++;
            }
        } else if (char === '`') {
            result += '__';
            if (nextChar === ' ') i++;
        } else if (char === ' ') {
            result += '_';
        } else {
            result += char;
        }
    }
    
    return result.replace(/^_|_$/g, '').replace(/_+/g, (match) => {
        if (match.length >= 3) return '___';
        if (match.length === 2) return '__';
        return '_';
    });
}

function downloadFile(url, dest) {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        
        const options = {
            hostname: urlObj.hostname,
            port: 443,
            path: urlObj.pathname,
            method: 'GET',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': '*/*'
            }
        };

        const file = fs.createWriteStream(dest);
        
        const request = https.request(options, (response) => {
            if (response.statusCode !== 200) {
                file.close();
                if (fs.existsSync(dest)) fs.unlinkSync(dest);
                reject(new Error(`HTTP ${response.statusCode}`));
                return;
            }
            response.pipe(file);
            file.on('finish', () => {
                file.close();
                resolve();
            });
        });
        
        request.on('error', (e) => {
            file.close();
            if (fs.existsSync(dest)) fs.unlinkSync(dest);
            reject(e);
        });
        
        request.setTimeout(60000, () => {
            request.destroy();
            file.close();
            if (fs.existsSync(dest)) fs.unlinkSync(dest);
            reject(new Error('Request timeout'));
        });
        
        request.end();
    });
}

app.post('/download', async (req, res) => {
    const { stationId, songs } = req.body;

    if (!stationId || !songs || !Array.isArray(songs) || songs.length === 0) {
        return res.status(400).json({ error: 'Station ID and songs required' });
    }

    const results = [];

    for (const song of songs) {
        const trimmedSong = song.trim();
        if (!trimmedSong) continue;

        const filename = sanitizeFilename(trimmedSong) + '.mp3';
        const filePath = path.join(downloadDir, filename);
        const url = `https://strm.theanchor.app/strm/${stationId}/${filename}`;

        try {
            await downloadFile(url, filePath);
            results.push({ song: trimmedSong, success: true, filename });
        } catch (e) {
            results.push({ song: trimmedSong, success: false, error: e.message });
        }
    }

    res.json({ results });
});

app.get('/download-zip', (req, res) => {
    const files = fs.readdirSync(downloadDir).filter(f => f.endsWith('.mp3'));
    
    if (files.length === 0) {
        return res.status(404).json({ error: 'No files to download' });
    }

    res.setHeader('Content-Disposition', 'attachment; filename=songs.zip');
    res.setHeader('Content-Type', 'application/zip');

    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.pipe(res);

    for (const file of files) {
        archive.file(path.join(downloadDir, file), { name: file });
    }

    archive.finalize();
});

app.get('/files-count', (req, res) => {
    const files = fs.readdirSync(downloadDir).filter(f => f.endsWith('.mp3'));
    res.json({ count: files.length });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));