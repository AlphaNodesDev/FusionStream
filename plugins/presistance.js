export const name = "Presistance";
export const version = "1.0.3";
export const description = "Tracks and displays your watch history directly in the FusionStream interface. [Note] This Option Will Work only for V1(Anime)";
export const image = "https://i.ibb.co/DH1sVskT/Chat-GPT-Image-Apr-11-2025-01-42-34-PM.png";

export function register({ electronApp }) {
  console.log("🔌 Presistance plugin loaded");

  const listenToWatchRoute = (window) => {
    const { webContents } = window;

    webContents.session.webRequest.onCompleted((details) => {
      if (details.url.includes("/watch")) {
        const urlParams = new URLSearchParams(details.url.split('?')[1]);
        const episodeId = urlParams.get('episodeId');
        const id = episodeId?.split('$episode')[0];
        const providerKey = urlParams.get('provider');

        if (episodeId && providerKey) {
          fetch(`http://localhost:3000/info?id=${id}&provider=${providerKey}`)
            .then(res => res.json())
            .then(data => {
              const matchingEpisode = data.episodes?.find(ep => ep.id === episodeId);

              webContents.executeJavaScript(`
                (() => {
                  var watchHistory = JSON.parse(localStorage.getItem('watchHistory')) || [];

                  // Remove old entry with same episodeId
                  watchHistory = watchHistory.filter(item => item.episodeId !== "${episodeId}");

                  // Add new one at the beginning
                  watchHistory.unshift({
                    title: "${data.title}",
                    epno: "${matchingEpisode?.number || 'N/A'}",
                    thumbnail: "${data.thumbnail}",
                    episodeId: "${episodeId}",
                    provider: "${providerKey}"
                  });

                  localStorage.setItem('watchHistory', JSON.stringify(watchHistory));
                  console.log('✅ Updated Watch History:', watchHistory);
                })();
              `).catch(err => {
                console.error("❌ Error saving watch history:", err);
              });
            })
            .catch(err => {
              console.error("❌ Failed to fetch episode data:", err);
            });
        }
      }
    });
  };

  const injectInto = (window) => {
    window.webContents.on('did-finish-load', async () => {
      const url = await window.webContents.getURL();

      // Inject Watch History on homepage
      if (url.includes("index.html")) {
        window.webContents.executeJavaScript(`
          (() => {
            var watchHistory = JSON.parse(localStorage.getItem('watchHistory')) || [];

            const copyrightDiv = document.createElement('div');
            copyrightDiv.className = 'copyright';
            copyrightDiv.textContent = 'Presistance V1.0.3';

            const historySection = document.createElement('div');
            historySection.setAttribute('bis_skin_checked', '1');
            historySection.innerHTML = "<h2>Watch History</h2>";

            const list = document.createElement('div');
            list.className = "movie-grid";
            list.setAttribute('bis_skin_checked', '1');

           if (watchHistory.length === 0) {
  const noHistoryMessage = document.createElement('p');
  noHistoryMessage.textContent = 'No History Available';
  historySection.appendChild(noHistoryMessage);
} else {
  const uniqueByTitle = [];
  const seenTitles = new Set();

  for (const item of watchHistory) {
    if (!seenTitles.has(item.title)) {
      seenTitles.add(item.title);
      uniqueByTitle.push(item);
    }
  }

  uniqueByTitle.forEach(item => {
    const link = document.createElement('a');
    link.href = \`player.html?episodeId=\${item.episodeId}&title=\${encodeURIComponent(item.title)}&provider=\${item.provider}\`;
    link.style.textDecoration = 'none';
    link.style.color = 'inherit';

    const card = document.createElement('div');
    card.className = "movie-card";
    card.setAttribute('bis_skin_checked', '1');

    const img = document.createElement('img');
    img.src = item.thumbnail;
    img.alt = item.title;

    const epBadge = document.createElement('div');
    epBadge.textContent = item.epno;
    epBadge.style.position = 'absolute';
    epBadge.style.top = '8px';
    epBadge.style.right = '8px';
    epBadge.style.backgroundColor = 'rgba(0, 0, 0, 0.8)';
    epBadge.style.color = '#fff';
    epBadge.style.padding = '2px 6px';
    epBadge.style.borderRadius = '6px';
    epBadge.style.fontSize = '12px';
    epBadge.style.zIndex = '1';

    const imgWrapper = document.createElement('div');
    imgWrapper.style.position = 'relative';
    imgWrapper.appendChild(img);
    imgWrapper.appendChild(epBadge);

    const title = document.createElement('p');
    title.className = "card-title";
    title.textContent = item.title;

    card.appendChild(imgWrapper);
    card.appendChild(title);
    link.appendChild(card);
    list.appendChild(link);
  });
}


            historySection.appendChild(list);

            const viewMoreButton = document.createElement('button');
            viewMoreButton.className = "view-more-button";
            viewMoreButton.textContent = "View More";
            viewMoreButton.style.marginTop = "10px";
            historySection.appendChild(viewMoreButton);

            const presistanceSection = document.createElement('section');
            presistanceSection.className = 'movies container';
            presistanceSection.id = 'presistance';
            presistanceSection.appendChild(copyrightDiv);
            presistanceSection.appendChild(historySection);

            const catalogSection = document.getElementById("catalogSection");
            if (catalogSection && catalogSection.parentNode) {
              catalogSection.parentNode.insertBefore(presistanceSection, catalogSection);
            }
          })();
        `).then(() => {
          listenToWatchRoute(window);
        }).catch((err) => {
          console.error("❌ Injection failed:", err);
        });
      }

      // Inject Clear History button on settings page
      if (url.includes("settings.html")) {
        window.webContents.executeJavaScript(`
          (() => {
            const settingsContainer = document.querySelector('.settings') || document.body;

            const clearButton = document.createElement('button');
            clearButton.textContent = "Clear Watch History";
            clearButton.style.padding = "10px 15px";
            clearButton.style.marginTop = "20px";
            clearButton.style.backgroundColor = "#ff4d4f";
            clearButton.style.color = "white";
            clearButton.style.border = "none";
            clearButton.style.borderRadius = "6px";
            clearButton.style.cursor = "pointer";

            clearButton.addEventListener('click', () => {
              localStorage.removeItem('watchHistory');
              alert("✅ Watch history cleared!");
            });

            settingsContainer.appendChild(clearButton);
          })();
        `).catch((err) => {
          console.error("❌ Failed to inject clear history button:", err);
        });
      }
    });
  };

  electronApp.on('browser-window-created', (event, window) => {
    injectInto(window);
  });

  import('electron').then(({ BrowserWindow }) => {
    const allWindows = BrowserWindow.getAllWindows();
    allWindows.forEach((win) => {
      injectInto(win);
    });
  });
}
