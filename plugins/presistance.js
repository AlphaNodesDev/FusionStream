export const name = "Presistance";
export const version = "1.0.2";
export const description = "Tracks and displays your watch history directly in the FusionStream interface.";
export const image = "https://i.ibb.co/DH1sVskT/Chat-GPT-Image-Apr-11-2025-01-42-34-PM.png";

export function register({ electronApp }) {
  console.log("🔌 Presistance plugin loaded");

  // Function to listen to API calls to the '/watch' endpoint
  const listenToWatchRoute = (window) => {
    const { webContents } = window;

    // Listen for requests to the /watch API endpoint
    webContents.session.webRequest.onCompleted((details) => {
      // Check if the request is to the '/watch' endpoint
      if (details.url.includes("/watch")) {
        // Extract the query parameters
        const urlParams = new URLSearchParams(details.url.split('?')[1]);
        const episodeId = urlParams.get('episodeId');
        const providerKey = urlParams.get('provider');

        if (episodeId && providerKey) {
          // Use the episodeId and providerKey to fetch episode info
          // Note: You can adjust this based on how the API responds
          fetch(`https://your-api-endpoint.com/watch?episodeId=${episodeId}&provider=${providerKey}`)
            .then(res => res.json())
            .then(data => {
              // Save the watched episode to localStorage
              webContents.executeJavaScript(`
                let watchHistory = JSON.parse(localStorage.getItem('watchHistory')) || [];
                watchHistory.push({
                  title: "${data.title}",
                  thumbnail: "${data.thumbnail}",
                  episodeId: "${episodeId}",
                  provider: "${providerKey}"
                });
                localStorage.setItem('watchHistory', JSON.stringify(watchHistory));
                console.log('Updated Watch History:', watchHistory);
              `).catch(err => {
                console.error("Error saving watch history:", err);
              });
            })
            .catch(err => {
              console.error("Failed to fetch episode data:", err);
            });
        }
      }
    });
  };

  const injectInto = (window) => {
    window.webContents.on('did-finish-load', async () => {
      const url = await window.webContents.getURL();

      // Optional: only inject on homepage or specific page
      if (!url.includes("index.html")) return;

      window.webContents.executeJavaScript(`
        // Fetch watch history from localStorage
        let watchHistory = JSON.parse(localStorage.getItem('watchHistory')) || [];

        // Create the copyright div
        const copyrightDiv = document.createElement('div');
        copyrightDiv.className = 'copyright';
        copyrightDiv.textContent = 'Test';

        // Create the history section
        const historySection = document.createElement('div');
        historySection.setAttribute('bis_skin_checked', '1');
        historySection.innerHTML = "<h2>Watch History</h2>";

        const list = document.createElement('div');
        list.className = "movie-grid";
        list.setAttribute('bis_skin_checked', '1');

        // Check if history exists
        if (watchHistory.length === 0) {
          const noHistoryMessage = document.createElement('p');
          noHistoryMessage.textContent = 'No History Available';
          historySection.appendChild(noHistoryMessage);
        } else {
          // Display the history from localStorage
          watchHistory.forEach(item => {
            const card = document.createElement('div');
            card.className = "movie-card";
            card.setAttribute('bis_skin_checked', '1');
            
            const img = document.createElement('img');
            img.src = item.thumbnail;
            img.alt = item.title;

            const title = document.createElement('p');
            title.className = "card-title";
            title.textContent = item.title;

            card.appendChild(img);
            card.appendChild(title);

            list.appendChild(card);
          });
        }

        historySection.appendChild(list);

        const viewMoreButton = document.createElement('button');
        viewMoreButton.className = "view-more-button";
        viewMoreButton.textContent = "View More";
        viewMoreButton.style.marginTop = "10px";
        historySection.appendChild(viewMoreButton);

        // Create the new presistance section
        const presistanceSection = document.createElement('section');
        presistanceSection.className = 'movies container';
        presistanceSection.id = 'presistance';

        // Add the copyright and history section to the new presistance section
        presistanceSection.appendChild(copyrightDiv);
        presistanceSection.appendChild(historySection);

        // Get the catalogSection and insert the presistance section above it
        const catalogSection = document.getElementById("catalogSection");
        if (catalogSection && catalogSection.parentNode) {
          catalogSection.parentNode.insertBefore(presistanceSection, catalogSection);
        }
      `).then(() => {
        listenToWatchRoute(window); // Start listening to the watch route after injecting
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
