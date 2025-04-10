const { ipcMain, BrowserWindow } = require('electron');

ipcMain.on('REMOTE_BROWSER_GET_CURRENT_WINDOW', (event) => {
  const win = BrowserWindow.getFocusedWindow();
  event.returnValue = win;
});
