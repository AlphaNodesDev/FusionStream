import path from 'path';
import fs from 'fs';
import fetch from 'node-fetch';
import { app } from 'electron';
import { pathToFileURL } from 'url';

export default function (api) {
  const extensionsDir = path.join(app.getPath('userData'), 'extensions');

  if (!fs.existsSync(extensionsDir)) {
    fs.mkdirSync(extensionsDir, { recursive: true });
  }

  
api.get('/extensions', async (req, res) => {
  const files = fs.readdirSync(extensionsDir).filter(f => f.endsWith('.js'));

  const extensions = await Promise.all(files.map(async file => {
    try {
      const fullPath = path.join(extensionsDir, file);
      const fileUrl = pathToFileURL(fullPath).href;

      const mod = await import(fileUrl);
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

  api.post('/extensions/install', async (req, res) => {
    let { url, id } = req.body;

    // Normalize ID
    id = id.replace(/\.js$/, '');
    const fileName = `${id}.js`;
    const filePath = path.join(extensionsDir, fileName);

    console.log("INSTALLING:");
    console.log("url:", url);
    console.log("id:", id);
    console.log("final filename:", fileName);

    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const code = await response.text();
      fs.writeFileSync(filePath, code, 'utf-8');

      res.json({ success: true, message: `${id} installed successfully.` });
    } catch (err) {
      console.error(err);
      res.status(500).json({ success: false, message: 'Failed to install extension.' });
    }
  });

  api.post('/extensions/uninstall', async (req, res) => {
    let { id } = req.body;

    // Normalize ID
    id = id.replace(/\.js$/, '');
    const filePath = path.join(extensionsDir, `${id}.js`);

    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      res.json({ success: true, message: `${id} uninstalled.` });
    } else {
      res.status(404).json({ success: false, message: 'Extension not found.' });
    }
  });
}
