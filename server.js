const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const https = require("https");
const http = require("http");
const archiver = require("archiver");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static("public"));

const downloadDir = path.join(__dirname, "downloads");
if (!fs.existsSync(downloadDir)) {
  fs.mkdirSync(downloadDir);
}

function sanitizeFilename(title) {
  let result = "";
  let hasLeadingApostrophe = false;

  for (let i = 0; i < title.length; i++) {
    const char = title[i];
    const nextChar = title[i + 1];
    if (char === ",") {
      result += "_";
    } else if (char === "-") {
      result += "_";
    } else if (char === "&") {
      result += "_";
    } else if (char === "'") {
      if (result.length === 0) {
        hasLeadingApostrophe = true;
      } else {
        result += "_";
      }
    } else if (char === " ") {
      result += "_";
    } else if (char === "!") {
      result += "__";
      if (nextChar === " ") i++;
    } else if (char === "~") {
      result += "__";
      if (nextChar === " ") i++;
    } else {
      result += char;
    }
  }

  // Handle leading apostrophe - add leading underscore
  if (hasLeadingApostrophe) {
    result = "_" + result;
  }

  // Handle trailing special chars - add trailing underscore
  if (result.endsWith("_") || result.endsWith("__")) {
    result += "_";
  }

  return result;
}

app.post("/download", async (req, res) => {
  const { stationId, songs } = req.body;

  if (!stationId || !songs || !Array.isArray(songs) || songs.length === 0) {
    return res.status(400).json({ error: "Station ID and songs required" });
  }

  const results = [];

  for (const song of songs) {
    const trimmedSong = song.trim();
    if (!trimmedSong) continue;

    const filename = sanitizeFilename(trimmedSong) + ".mp3";
    const filePath = path.join(downloadDir, filename);
    const url = `https://strm.theanchor.app/strm/${stationId}/${filename}`;

    console.log(`URL: ${url}`);

    try {
      await downloadFile(url, filePath);
      results.push({ song: trimmedSong, success: true, filename });
    } catch (e) {
      console.error(`Error downloading ${trimmedSong}:`, e.message);
      results.push({ song: trimmedSong, success: false, error: e.message });
    }
  }

  res.json({ results });
});

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    console.log(`Starting download for: ${url}`);

    const urlObj = new URL(url);

    const options = {
      hostname: urlObj.hostname,
      port: 443,
      path: urlObj.pathname,
      method: "GET",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "*/*",
      },
    };

    const file = fs.createWriteStream(dest);

    const request = https.request(options, (response) => {
      console.log(`Response status: ${response.statusCode}`);
      if (response.statusCode !== 200) {
        file.close();
        if (fs.existsSync(dest)) fs.unlinkSync(dest);
        reject(new Error(`HTTP ${response.statusCode}`));
        return;
      }
      response.pipe(file);
      file.on("finish", () => {
        file.close();
        resolve();
      });
    });

    request.on("error", (e) => {
      console.log(`Request error: ${e.message}`);
      file.close();
      if (fs.existsSync(dest)) fs.unlinkSync(dest);
      reject(e);
    });

    request.setTimeout(30000, () => {
      request.destroy();
      file.close();
      if (fs.existsSync(dest)) fs.unlinkSync(dest);
      reject(new Error("Request timeout"));
    });

    request.end();
  });
}

app.get("/files", (req, res) => {
  const files = fs.readdirSync(downloadDir).filter((f) => f.endsWith(".mp3"));
  res.json(files);
});

app.get("/download-file/:filename", (req, res) => {
  const filename = req.params.filename;
  const filePath = path.join(downloadDir, filename);
  if (fs.existsSync(filePath)) {
    res.download(filePath);
  } else {
    res.status(404).json({ error: "File not found" });
  }
});

app.get("/download-zip", (req, res) => {
  const files = fs.readdirSync(downloadDir).filter((f) => f.endsWith(".mp3"));

  if (files.length === 0) {
    return res.status(404).json({ error: "No files to download" });
  }

  res.setHeader("Content-Disposition", "attachment; filename=Deaf-Songs.zip");
  res.setHeader("Content-Type", "application/zip");

  const archive = archiver("zip", { zlib: { level: 9 } });
  archive.pipe(res);

  for (const file of files) {
    archive.file(path.join(downloadDir, file), { name: file });
  }

  archive.finalize();
});

const CREDENTIALS = {
  stationId: "88bdb544-61a0-42e0-ac1f-5d317969c64c",
  userId: "9c60906a-75ff-4469-aaef-bc43d14ac8d5",
  token: "6267b673-a285-410c-a583-472c262da9fc",
};

app.post("/search-videos", async (req, res) => {
  const songs = req.body.songs;

  if (!songs || !Array.isArray(songs) || songs.length === 0) {
    return res.status(400).json({ error: "songs array required" });
  }

  const { stationId, userId, token } = CREDENTIALS;

  try {
    const postData = JSON.stringify({
      stationid: stationId,
      userid: userId,
      token: token,
    });

    const options = {
      hostname: "api.theanchor.app",
      port: 443,
      path: "/signLanguageRequest",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(postData),
      },
    };

    const response = await new Promise((resolve, reject) => {
      const request = https.request(options, (response) => {
        let data = "";
        response.on("data", (chunk) => (data += chunk));
        response.on("end", () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(e);
          }
        });
      });
      request.on("error", reject);
      request.setTimeout(30000, () => {
        request.destroy();
        reject(new Error("Request timeout"));
      });
      request.write(postData);
      request.end();
    });

    const allVideos = [
      ...(response.approved || []).map(v => ({ ...v, ...v.value })),
      ...(response.waitingApproval || []).map(v => ({ ...v.value })),
      ...(response.withoutLyrics || []).map(v => ({ ...v.value })),
    ];

    const results = [];

    if (songs && Array.isArray(songs)) {
      for (const songTitle of songs) {
        const trimmedTitle = songTitle.trim().toLowerCase();
        const found = allVideos.find((v) => {
          const songField = v.song || "";
          return songField.toLowerCase().includes(trimmedTitle);
        });
        if (found) {
          results.push({
            searchTitle: songTitle,
            found: true,
            song: found.song,
            video: found.video,
            category: found.category,
            doctype: found.doctype,
            lyrics: found.lyrics,
            lyricsby: found.lyricsby,
            videoby: found.videoby,
            submitted: found.submitted,
          });
        } else {
          results.push({ searchTitle: songTitle, found: false });
        }
      }
    }

    res.json({ results });
  } catch (e) {
    console.error("Search error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log(`Server running on http://localhost:${PORT}`),
);
