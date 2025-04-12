import path from 'path';
import fs from 'fs';
import fetch from 'node-fetch';
import { app } from 'electron';
import { pathToFileURL } from 'url';
export default function (api) {
  const extensionsDir = path.join(app.getPath('userData'), 'extensions');
  if (!fs.existsSync(extensionsDir)) fs.mkdirSync(extensionsDir, { recursive: true });

  // List installed extensions
  api.get('/extensions', async (req, res) => {
    const files = fs.readdirSync(extensionsDir).filter(f => f.endsWith('.js'));

    const extensions = await Promise.all(files.map(async file => {
      try {
        const fileUrl = pathToFileURL(path.join(extensionsDir, file)).href;
        const mod = await import(fileUrl + `?cacheBust=${Date.now()}`);
        return {
          id: path.basename(file, '.js'),
          name: mod.name || 'Unnamed Extension',
          version: mod.version || '1.0.0',
          description: mod.description || '',
          image: mod.image || ''
        };
      } catch (err) {
        console.error(`Failed to load ${file}:`, err);
        return null;
      }
    }));

    res.json(extensions.filter(Boolean));
  });

  // Install new extension
  api.post('/extensions/install', async (req, res) => {
    let { url, id } = req.body;
    id = id.replace(/\.js$/, '');
    const filePath = path.join(extensionsDir, `${id}.js`);

    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const code = await response.text();
      fs.writeFileSync(filePath, code, 'utf-8');

      let extInfo = id;
      try {
        const mod = await import(pathToFileURL(filePath).href + `?cacheBust=${Date.now()}`);
        extInfo = mod?.name || id;
      } catch {}

      res.json({ success: true, message: `${extInfo} installed successfully.` });
    } catch (err) {
      console.error("Install failed:", err);
      res.status(500).json({ success: false, message: 'Failed to install extension.' });
    }
  });

  // Uninstall extension
  api.post('/extensions/uninstall', async (req, res) => {
    const id = req.body.id.replace(/\.js$/, '');
    const filePath = path.join(extensionsDir, `${id}.js`);

    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      res.json({ success: true, message: `Extension "${id}" uninstalled.` });
    } else {
      res.status(404).json({ success: false, message: 'Extension not found.' });
    }
  });
}