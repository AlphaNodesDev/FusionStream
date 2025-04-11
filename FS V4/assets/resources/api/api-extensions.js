// extensions.js
import fs from 'fs';
import path from 'path';
import { pathToFileURL, fileURLToPath } from 'url';
import https from 'https';
import http from 'http';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Use home directory fallback
const userHomeDir = process.env.APPDATA || process.env.HOME;
const extFolder = path.join(userHomeDir, 'FusionStream', 'extensions');

export default function (api) {
  console.log('Extensions folder:', extFolder);
  if (!fs.existsSync(extFolder)) fs.mkdirSync(extFolder, { recursive: true });

  // GET: List all extensions
  api.get('/extensions', async (req, res) => {
    try {
      const files = fs.readdirSync(extFolder).filter(file => file.endsWith('.js'));
      const extensions = [];

      for (const file of files) {
        const fullPath = path.join(extFolder, file);

        try {
          const mod = await import(`${pathToFileURL(fullPath).href}?${Date.now()}`);

          extensions.push({
            id: file,
            name: mod.name || file.replace('.js', ''),
            description: mod.description || 'No description provided.',
            version: mod.version || '1.0.0',
            image: mod.image || 'https://via.placeholder.com/150',
          });
        } catch (e) {
          console.error(`Failed to import extension "${file}":`, e);
        }
      }

      res.json(extensions);
    } catch (err) {
      console.error("Failed to load extensions:", err);
      res.status(500).json({ error: "Could not load extensions" });
    }
  });

  // POST: Install new extension
  api.post('/extensions/install', async (req, res) => {
    const { id, url } = req.body;
    if (!id || !url) {
      return res.status(400).json({ error: "Missing id or url" });
    }

    const fileName = id.endsWith('.js') ? id : `${id}.js`;
    const filePath = path.join(extFolder, fileName);
    const fileStream = fs.createWriteStream(filePath);
    const protocol = url.startsWith('https') ? https : http;

    protocol.get(url, (response) => {
      if (response.statusCode !== 200) {
        return res.status(400).json({ error: `Failed to download: ${response.statusCode}` });
      }

      response.pipe(fileStream);
      fileStream.on('finish', async () => {
        fileStream.close();

        try {
          const freshImport = await import(`${pathToFileURL(filePath).href}?${Date.now()}`);

          if (typeof freshImport.register === 'function') {
            freshImport.register();
          }

          res.json({
            success: true,
            message: `Extension "${freshImport.name}" installed successfully.`,
            metadata: {
              id: fileName,
              name: freshImport.name || fileName.replace('.js', ''),
              version: freshImport.version || '1.0.0',
              description: freshImport.description || 'No description provided.',
              image: freshImport.image || 'https://via.placeholder.com/150',
            }
          });

        } catch (err) {
          console.error("Extension install error:", err);
          res.status(500).json({ error: "Extension installed but failed to load." });
        }
      });

    }).on('error', (err) => {
      console.error("Download error:", err);
      res.status(500).json({ error: "Download failed" });
    });
  });

  // POST: Uninstall extension
  api.post('/extensions/uninstall', async (req, res) => {
    const { id } = req.body;
    if (!id) {
      return res.status(400).json({ error: "Missing id" });
    }

    const fileName = id.endsWith('.js') ? id : `${id}.js`;
    const filePath = path.join(extFolder, fileName);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: "Extension not found" });
    }

    try {
      const mod = await import(`${pathToFileURL(filePath).href}?${Date.now()}`);
      const extName = mod.name || id;

      fs.unlinkSync(filePath);

      res.json({
        success: true,
        message: `Extension "${extName}" was uninstalled successfully.`,
        metadata: {
          id: fileName,
          name: mod.name || fileName.replace('.js', ''),
          version: mod.version || '1.0.0',
          description: mod.description || '',
        }
      });

    } catch (err) {
      console.error("Error reading extension metadata:", err);
      fs.unlinkSync(filePath);
      res.json({
        success: true,
        message: `Extension ${id} uninstalled (metadata could not be read).`
      });
    }
  });
}
