const { contextBridge } = require('electron');
const { getCurrentWindow } = require('@electron/remote');
const { machineIdSync } = require('node-machine-id');
const os = require('os');

// Expose API to renderer safely
contextBridge.exposeInMainWorld('electronAPI', {
  minimize: () => getCurrentWindow().minimize(),
  close: () => getCurrentWindow().close(),
  goBack: () => {
    const win = getCurrentWindow();
    if (win.webContents.canGoBack()) {
      win.webContents.goBack();
    }
  },
  logUsage: () => {
    const userId = machineIdSync();
    const data = {
      userId,
      platform: os.platform(),
      arch: os.arch(),
      event: 'app_opened',
      timestamp: new Date().toISOString(),
    };

    fetch('https://your-logging-api.com/track', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
    }).catch(err => console.error('Failed to log usage:', err));
  }
});
