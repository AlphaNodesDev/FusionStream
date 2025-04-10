const { contextBridge, ipcRenderer, shell } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
    openVideoWindow: (url) => ipcRenderer.send("open-video-window", url),
    openExternal: (url) => shell.openExternal(url),
    goBackToSearch: () => ipcRenderer.send("go-back-to-search"),
    getAppVersion: () => ipcRenderer.invoke("getAppVersion"),

    // Fetch all loaded modules and their states
    getModules: async () => {
        return await ipcRenderer.invoke("get-modules");
    },
    installModule: (name, url) => ipcRenderer.invoke("installModule", name, url),
    uninstallModule: (name) => ipcRenderer.invoke("uninstallModule", name),
    // Toggle a module and return its new state
    toggleModule: async (moduleName) => {
        return await ipcRenderer.invoke("toggle-module", moduleName);
    },

    // Toggle AdBlocker state
    toggleAdBlocker: async () => {
        return await ipcRenderer.invoke("toggle-adblocker");
    }
});
