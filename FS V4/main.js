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
  const routePath = path.join(apiDir, file);
  const module = await import(pathToFileURL(routePath).href);

  if (typeof module.default === 'function') {
    module.default(api);
    console.log(`✅ Loaded API route: ${file}`);
  } else {
    console.warn(`⚠️ Route file ${file} does not export a default function`);
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
  // frame: false,
 //  titleBarStyle: 'hiddenInset',
   // backgroundColor: '#000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: false,
      nodeIntegration: true,
      enableRemoteModule: false,
    },
  });

  enable(win.webContents);

 
 //win.setMenu(null);

  win.loadFile(path.join(__dirname, './assets/resources/res/UI/index.html'));
}

async function loadExtensions({ electronApp, expressApp }) {
  const extensionsDir = path.join(__dirname, 'extensions');
  if (!fs.existsSync(extensionsDir)) return;

  const files = fs.readdirSync(extensionsDir).filter(f => f.endsWith('.js'));

  for (const file of files) {
    try {
      const modulePath = pathToFileURL(path.join(extensionsDir, file)).href;
      const mod = await import(modulePath);

      if (typeof mod.register === 'function') {
        mod.register({ electronApp, expressApp });
        console.log(`✅ Loaded extension: ${file}`);
      } else {
        console.warn(`⚠️ Extension ${file} does not export 'register'`);
      }

    } catch (err) {
      console.error(`❌ Failed to load extension ${file}:`, err);
    }
  }
}


app.whenReady().then(async () => {
  createWindow();

  // Load extensions with access to both Electron and Express
  await loadExtensions({ electronApp: app, expressApp: api });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});


app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
