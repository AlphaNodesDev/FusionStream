import electron from 'electron';
const { app, BrowserWindow } = electron;
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import express from 'express';
import cors from 'cors';
import { EventEmitter } from 'events';

EventEmitter.defaultMaxListeners = 20;

import { initialize, enable } from '@electron/remote/main/index.js';


initialize();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// === EXPRESS SETUP ===
const api = express();
api.use(cors());
api.use(express.json());


const PORT = 3000;


const apiDir = path.join(__dirname, '/assets/resources/api');
const apiFiles = fs.readdirSync(apiDir).filter(f => f.endsWith('.js'));

for (const file of apiFiles) {
  try {
    const routePath = path.join(apiDir, file);
    const module = await import(pathToFileURL(routePath).href);

    if (typeof module.default === 'function') {
      module.default(api);
      console.log(`✅ Loaded API route: ${file}`);
    } else {
      console.warn(`⚠️ Route file ${file} does not export a default function`);
    }
  } catch (err) {
    console.error(`❌ Failed to load API route ${file}:`, err);
  }
}



api.listen(PORT, () => {
  console.log(`✅ API Server running at http://localhost:${PORT}`);
});

// === ELECTRON WINDOW ===
let win;

function createWindow() {
  win = new BrowserWindow({
    width: 1000,
    height: 800,
    icon: path.join(__dirname, 'logo.png'),
   frame: false,
  titleBarStyle: 'hiddenInset',
    backgroundColor: '#000000',
   webPreferences: {
    preload: path.join(__dirname, 'preload.js'),
    contextIsolation: false,
    nodeIntegration: true,
    enableRemoteModule: false,
    backgroundThrottling: false 
  },
  
  });

  enable(win.webContents);

 
 //win.setMenu(null);

  win.loadFile(path.join(__dirname, './assets/resources/res/UI/index.html'));
}


//Extensions Loading From UserData {appdata}
import { createRequire } from 'module';
const appRequire = createRequire(import.meta.url);
let loadedExtensions = [];
export async function loadExtensions({ electronApp, expressApp }) {
  for (const ext of loadedExtensions) {
    try {
      if (ext?.unregister) ext.unregister();
    } catch (e) {
      console.warn(`Failed to unregister ${ext.name}`, e);
    }
  }
  loadedExtensions = [];

  const extensionsDir = path.join(electronApp.getPath('userData'), 'extensions');
  if (!fs.existsSync(extensionsDir)) fs.mkdirSync(extensionsDir, { recursive: true });

  const files = fs.readdirSync(extensionsDir).filter(f => f.endsWith('.js'));

  for (const file of files) {
    const filePath = path.join(extensionsDir, file);
    const fileUrl = pathToFileURL(filePath).href;
    const pluginName = path.basename(file, '.js');

    try {
      const mod = await import(fileUrl + `?cacheBust=${Date.now()}`);
      if (typeof mod.register === 'function') {
        mod.register({
          electronApp,
          expressApp,
          require: (modName) => {
            try {
              return createRequire(filePath)(modName);
            } catch {
              return appRequire(modName);
            }
          },
        });
        loadedExtensions.push({ name: pluginName, unregister: mod.unregister });
        console.log(`✅ Loaded extension: ${pluginName}`);
        
      } else {
        console.warn(`⚠️ Extension ${pluginName} does not export 'register'`);
      }
    } catch (err) {
      console.error(`Failed to load extension: ${pluginName}`, err);
      globalThis.sendFrontendMessage?.({
        type: 'info',
        message: `[Extensions] Failed to load plugin: ${pluginName}`,
      });
    }
  }
}

app.whenReady().then(async () => {
  createWindow();

  // Defer the extension and API loading to avoid UI freezing
  setTimeout(async () => {
    await loadExtensions({ electronApp: app, expressApp: api });
  }, 300);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});


app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
