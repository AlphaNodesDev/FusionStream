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
    const navHistory = win.webContents.navigationHistory;
    if (navHistory.canGoBack) {
      navHistory.goBack();
    }
  });
});
