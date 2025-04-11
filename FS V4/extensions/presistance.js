export const name = "Presistance";
export const version = "1.0.0";
export const description = "Saves the watch history";
export const image = "";

export function register({ electronApp }) {
  console.log("🔌 Presistance plugin loaded");

  const injectInto = (window) => {
    window.webContents.on('did-finish-load', async () => {
      const url = await window.webContents.getURL();

      // Optional: only inject on homepage
      if (!url.includes("index.html")) return;
      setTimeout(() => {
        globalThis.sendFrontendMessage({
          type: 'error',
          message: '[Presistance] Error Loading Plugin Outdated Version',
          time: Date.now()
        });
      }, 1000); 
      window.webContents.executeJavaScript(`
     ;
      
        const fakeHistory = [
          {
            title: "Recent Episode",
            thumbnail: "https://i.ibb.co/s9qS9TRp/error-2129569-640.jpg"
          },
        ];
      
        const historySection = document.createElement('div');
        historySection.id = "plugin-history";
        historySection.style.padding = "20px";
        historySection.innerHTML = "<h2 style='color: #fff;'>Watch History</h2>";
      
        const list = document.createElement('div');
        list.style.display = "flex";
        list.style.flexWrap = "wrap";
        list.style.gap = "20px";
      
        fakeHistory.forEach(item => {
          const card = document.createElement('div');
          card.style.width = "180px";
          card.style.background = "#1e1e1e";
          card.style.borderRadius = "10px";
          card.style.overflow = "hidden";
          card.style.boxShadow = "0 4px 8px rgba(0,0,0,0.3)";
          card.innerHTML = \`
            <img src="\${item.thumbnail}" alt="\${item.title}" style="width:100%; height: auto;" />
            <div style="padding: 10px; color: #fff; font-size: 14px;">\${item.title}</div>
          \`;
          list.appendChild(card);
        });
      
        historySection.appendChild(list);
      
        const catalogSection = document.getElementById("catalogSection");
        if (catalogSection && catalogSection.parentNode) {
          catalogSection.parentNode.insertBefore(historySection, catalogSection);
        }
      `)
      
      .then(() => {
      }).catch((err) => {
        console.error("❌ Injection failed:", err);
      });
    });
  };

  // Inject into future windows
  electronApp.on('browser-window-created', (event, window) => {
    injectInto(window);
  });

  // Inject into already open windows
  import('electron').then(({ BrowserWindow }) => {
    const allWindows = BrowserWindow.getAllWindows();
    allWindows.forEach((win) => {
      injectInto(win);
    });
  });
}
