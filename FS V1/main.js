const { app, BrowserWindow, ipcMain, session, Menu, shell } = require("electron");
const path = require("path");
const axios = require("axios");
const express = require("express");
const { ElectronBlocker } = require('@cliqz/adblocker-electron');
const fetch = require("cross-fetch");
const fs = require("fs");
const server = express();
const PORT = 3001;
server.use(express.json());
const cors = require("cors");
server.use(cors());
let mainWindow;
let blocker = null;
let adblockerEnabled = true;

async function enableAdBlocker() {
    const ses = session.defaultSession;

    try {
        blocker = await ElectronBlocker.fromPrebuiltAdsAndTracking(fetch);
        blocker.enableBlockingInSession(ses);
        console.log("✅ Adblocker enabled for all web requests (including iframes)");

        // Additional filtering for known ad domains
        const adBlockList = [
            "*://*.doubleclick.net/*",
            "*://*.googleadservices.com/*",
            "*://*.googlesyndication.com/*",
            "*://*.ads.yahoo.com/*",
            "*://*.ads.yahoo.com/*",
            "*://*.9anime.com.in/*",
            "*://*.google-analytics.com/*",
            "*://*.google.com/*",
            "*://*.googletagmanager.com/*",
            "*://*.google-analytics.com/*",
            "*://*.taboola.com/*",
            "*://*.outbrain.com/*"
        ];

        ses.webRequest.onBeforeRequest({ urls: adBlockList }, (details, callback) => {
            console.log("🚫 Blocking ad request:", details.url);
            callback({ cancel: true });
        });

    } catch (err) {
        console.error("❌ Failed to enable Adblocker:", err);
    }
}

// Disable the adblocker in the current session
function disableAdBlocker() {
    const ses = session.defaultSession;
    if (blocker) {
        blocker.disableBlockingInSession(ses);
        console.log("🚫 Adblocker disabled");
    }
}
ipcMain.on("open-video-window", (event, url) => {
    let videoWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        webPreferences: {
            nodeIntegration: false, 
            contextIsolation: true
        }
    });

    toggleAdBlocker(adblockerEnabled); // Ensure adblocker is active
    videoWindow.loadURL(url);
});

// Toggle the adblocker based on the current state
function toggleAdBlocker(enabled) {
    adblockerEnabled = enabled;
    if (adblockerEnabled) {
        enableAdBlocker();
    } else {
        disableAdBlocker();
    }
}

// Get app version for update checking
server.get('/version', (req, res) => {
    res.json({ version: app.getVersion() });
});
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-gpu-compositing');

// Create the Electron main window
function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        webPreferences: {
            preload: path.join(__dirname, "preload.js"),
            nodeIntegration: true,
            contextIsolation: true,
        },
        icon: path.join(__dirname, 'src', 'assets', 'logo.png')
    });

    toggleAdBlocker(adblockerEnabled);

    mainWindow.loadFile(path.join(__dirname, "src", "index.html"));

    createMenu();
}
server.get("/search", (req, res) => {
    const query = req.query.q;
    console.log("[Backend] Received search query:", query);

    // Dummy response to verify frontend gets something
    res.json([
        {
            title: "Sample Movie",
            url: "https://example.com",
            thumbnail: "https://via.placeholder.com/150",
            description: "This is a test movie",
            website: "TestSite"
        }
    ]);
});



const configPath = path.join(__dirname,'webmodules', "modules.json");

// Load config file or create default
function loadModuleConfig() {
    if (!fs.existsSync(configPath)) {
        fs.writeFileSync(configPath, JSON.stringify({ modules: {} }, null, 2));
    }
    return JSON.parse(fs.readFileSync(configPath));
}

// Save updated module config
function saveModuleConfig(config) {
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
}

// Load modules based on config
async function loadSearchModules() {
    const modulesDir = path.join(__dirname, "webmodules");
    const moduleFiles = fs.readdirSync(modulesDir);
    const config = loadModuleConfig();

    const searchModules = [];

    for (const file of moduleFiles) {
        if (file.endsWith(".js")) {
            const modulePath = path.join(modulesDir, file);
            const isEnabled = config.modules[file] ?? true; // Default to enabled if not set

            if (isEnabled) {
                try {
                    const module = require(modulePath);
                    if (typeof module.search === 'function') {
                        searchModules.push(module);
                        console.log(`✅ Loaded module: ${file}`);
                    }
                } catch (error) {
                    console.error(`❌ Error loading module ${file}:`, error);
                }
            }
        }
    }

    return searchModules;
}

ipcMain.handle("toggle-module", async (event, moduleName) => {
    try {
        const config = loadModuleConfig();
        config.modules[moduleName] = !config.modules[moduleName]; // Toggle module state
        saveModuleConfig(config);
        
        console.log(`🔄 Module ${moduleName} is now ${config.modules[moduleName] ? "enabled" : "disabled"}`);
        
        return config.modules[moduleName];
    } catch (error) {
        console.error("❌ Error toggling module:", error);
        return false;
    }
});


ipcMain.handle("get-modules", async () => {
    const config = loadModuleConfig();
    return config.modules;
});

// Toggle AdBlocker
ipcMain.handle("toggle-adblocker", async () => {
    adblockerEnabled = !adblockerEnabled;
    toggleAdBlocker(adblockerEnabled);
    return adblockerEnabled;
});


function openSettings() {
    let settingsWindow = new BrowserWindow({
        width: 600,
        height: 400,
        webPreferences: {
            preload: path.join(__dirname, "preload.js"),
            nodeIntegration: false,  // Prevent direct access to Node.js
            contextIsolation: true   // Ensures `window.electron` works
        }
    });

    settingsWindow.loadFile(path.join(__dirname, "src", "settings.html"));
}


function createMenu() {
    const menuTemplate = [
        {
            label: 'File',
            submenu: [
                { label: 'Quit', role: 'quit' }
            ]
        },
        {
            label: 'Settings',
            submenu: [
                {
                    label: 'Open Settings',
                    click: () => {
                        openSettings();
                    }
                }
            ]
        },
        {
            label: 'Help',
            submenu: [
                {
                    label: 'GitHub Page',
                    click: () => {
                        shell.openExternal('https://github.com/AlphaNodesDev/FusionStream');
                    }
                }
            ]
        },
        {
            label: 'Developer',
            submenu: [
                {
                    label: 'Toggle Developer Tools',
                    accelerator: 'CmdOrCtrl+Shift+I',
                    click: () => {
                        const focusedWindow = BrowserWindow.getFocusedWindow();
                        if (focusedWindow) {
                            focusedWindow.webContents.toggleDevTools();
                        }
                    }
                }
            ]
        }
    ];

    const menu = Menu.buildFromTemplate(menuTemplate);
    Menu.setApplicationMenu(menu);
}

app.whenReady().then(() => {
    createWindow();

    // Prevent websites from opening pop-ups
    session.defaultSession.setWindowOpenHandler(({ url }) => {
        console.log("Blocked pop-up:", url);
        return { action: "deny" }; // Block new windows
    });

    // Prevent navigation to unwanted pages
    session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
        const blockedUrls = ["ads.com", "trackers.com", "redirect.xyz"]; // Add known ad domains
        if (blockedUrls.some(domain => details.url.includes(domain))) {
            console.log("Blocked redirect:", details.url);
            return callback({ cancel: true });
        }
        callback({ cancel: false });
    });
});
const modulesDir = path.join(__dirname, "webmodules"); // Module storage folder

ipcMain.handle("installModule", async (_, moduleName, moduleUrl) => {
    console.log("📥 Installing module:", moduleName);
    console.log("🔗 Module URL:", moduleUrl);

    if (!moduleUrl || typeof moduleUrl !== "string") {
        console.error("❌ Invalid module URL:", moduleUrl);
        return false;
    }

    const config = loadModuleConfig();
    const moduleFilename = moduleName.endsWith(".js") ? moduleName : `${moduleName}.js`;  // Ensure only one `.js`
    const modulePath = path.join(modulesDir, moduleFilename);

    try {
        // Download and save the module file
        const response = await axios.get(moduleUrl, { responseType: "arraybuffer" });
        fs.writeFileSync(modulePath, response.data);

        config.modules[moduleFilename] = true;
        saveModuleConfig(config);

        console.log(`✅ Installed module: ${moduleFilename}`);
        return true;
    } catch (error) {
        console.error(`❌ Failed to install module ${moduleFilename}:`, error);
        return false;
    }
});

ipcMain.handle("uninstallModule", async (_, moduleName) => {
    const config = loadModuleConfig();
    const moduleFilename = moduleName.endsWith(".js") ? moduleName : `${moduleName}.js`;  // Ensure correct filename
    const modulePath = path.join(modulesDir, moduleFilename);

    console.log("🗑️ Attempting to uninstall:", modulePath);

    try {
        // Ensure module is not cached
        if (require.cache[require.resolve(modulePath)]) {
            delete require.cache[require.resolve(modulePath)];
            console.log("🔄 Cleared module cache.");
        }

        // Check if the file exists before deleting
        if (fs.existsSync(modulePath)) {
            fs.unlinkSync(modulePath);
            console.log(`✅ Deleted module file: ${moduleFilename}`);
        } else {
            console.error("❌ Module file not found:", modulePath);
        }

        // Update JSON config
        console.log("📝 Modules before removal:", config.modules);
        delete config.modules[moduleFilename]; // Ensure correct key removal
        saveModuleConfig(config);
        console.log("📝 Modules after removal:", config.modules);

        return true;
    } catch (error) {
        console.error(`❌ Failed to uninstall module ${moduleFilename}:`, error);
        return false;
    }
});

app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
        app.quit();
    }
});

server.use(cors({
    origin: "http://localhost:3001", // or whatever port Electron is serving the UI
  }));
  
  server.listen(3001, () => {
    console.log("Server running on port 3001");
  });
  