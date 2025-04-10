const { getCurrentWindow } = require('@electron/remote');

document.addEventListener('DOMContentLoaded', () => {
  const win = getCurrentWindow();

  document.getElementById('minimize').addEventListener('click', () => {
    win.minimize();
  });

  document.getElementById('close').addEventListener('click', () => {
    win.close();
  });

  document.getElementById('back').addEventListener('click', () => {
    if (win.webContents.canGoBack()) {
      win.webContents.goBack();
    }
  });
});


