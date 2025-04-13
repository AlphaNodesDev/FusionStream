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

  api.post('/extensions/install', async (req, res) => {
    let { url, id } = req.body;
    id = id.replace(/\.js$/, '');
    const filePath = path.join(extensionsDir, `${id}.js`);
  
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const code = await response.text();
      fs.writeFileSync(filePath, code, 'utf-8');
  
      let pluginName = id;
      try {
        const mod = await import(pathToFileURL(filePath).href + `?cacheBust=${Date.now()}`);
        pluginName = mod?.name || id;
      } catch {}
  
      globalThis.sendFrontendMessage?.({
        type: 'info',
        message: `[plugin] installed: ${pluginName}`,
      });
  
      res.json({ success: true });
    } catch (err) {
      console.error("Install failed:", err);
      globalThis.sendFrontendMessage?.({
        type: 'error',
        message: `[plugin] failed to install: ${id}`,
      });
      res.status(500).json({ success: false });
    }
  });
  api.post('/extensions/uninstall', async (req, res) => {
    const id = req.body.id.replace(/\.js$/, '');
    const filePath = path.join(extensionsDir, `${id}.js`);
  
    if (fs.existsSync(filePath)) {
      let pluginName = id;
      try {
        // Try importing the plugin file to get the name
        const mod = await import(pathToFileURL(filePath).href + `?cacheBust=${Date.now()}`);
        pluginName = mod?.name || id;
      } catch (e) {
        console.warn("Could not extract plugin name during uninstall:", e.message);
      }
  
      // Delete the plugin file
      fs.unlinkSync(filePath);
  
      globalThis.sendFrontendMessage?.({
        type: 'success',
        message: `[plugin] uninstalled: ${pluginName}`,
      });
  
      res.json({ success: true });
    } else {
      globalThis.sendFrontendMessage?.({
        type: 'error',
        message: `[plugin] not found: ${id}`,
      });
  
      res.status(404).json({ success: false });
    }
  });
  
  
}