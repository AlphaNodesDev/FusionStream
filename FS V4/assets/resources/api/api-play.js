import { app } from 'electron';
import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import fetch from 'node-fetch'; // or global fetch if you're on Node 18+
import { v4 as uuidv4 } from 'uuid';

export default function (api) {
  api.post("/play-vlc", async (req, res) => {
    const { url, subtitle } = req.body;

    if (!url) return res.status(400).send("No video URL");

    let subtitlePath = null;

    // Build AppData-based tmp dir
    const appDataPath = app.getPath('userData');
    const tmpDir = path.join(appDataPath, 'tmp');

    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, { recursive: true });
    }

    // Download subtitle if provided
    if (subtitle && subtitle.startsWith("http")) {
      try {
        const subtitleRes = await fetch(subtitle);
        const buffer = await subtitleRes.buffer();
        subtitlePath = path.join(tmpDir, `${uuidv4()}.vtt`);
        fs.writeFileSync(subtitlePath, buffer);
      } catch (err) {
        console.error("Failed to download subtitle:", err);
        return res.status(500).send("Failed to download subtitle");
      }
    }

    // VLC command
    let command = `"C:\\Program Files\\VideoLAN\\VLC\\vlc.exe" "${url}" \
    --network-caching=100000 \
    --file-caching=100000 \
    --http-caching=100000 \
    --rtsp-caching=100000 \
    --tcp-caching=100000 \
    --play-and-pause`;
  

    if (subtitlePath) {
      command += ` --sub-file="${subtitlePath}"`;
    }

    exec(command, (err) => {
      if (err) {
        console.error("VLC error:", err);
        return res.status(500).send("Failed to launch VLC");
      }
      res.status(200).send("Launched VLC");
    });
  });
}
