import { app, BrowserWindow } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function createWindow() {
  try {
    const win = new BrowserWindow({
      width: 1000,
      height: 700,
      webPreferences: {
        preload: path.join(__dirname, 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: false,
        allowRunningInsecureContent: true
      }
    });

    await win.loadFile('index.html');
  } catch (err) {
    console.error('Failed to create window:', err);
  }
}
app.on('certificate-error', (event, webContents, url, error, certificate, callback) => {
  event.preventDefault();
  console.warn(`Bypassing certificate error for: ${url}`);
  callback(true); // Proceed anyway
});

app.whenReady().then(createWindow);
