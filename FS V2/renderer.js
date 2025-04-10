import modflix from './modflix.json' assert { type: 'json' };

let currentProvider = localStorage.getItem('selectedProvider') || 'consumet';

async function loadProviderFunctions(name) {
  const { [name]: providerInfo } = modflix;
  const { consumet } = await import(`./providers/${name}.js`);
  return consumet(providerInfo.url);
}

async function loadRecentEpisodes() {
  const provider = await loadProviderFunctions(currentProvider);
  const data = await provider.getRecentEpisodes();
  renderAnimeList(data.results || []);
}

function renderAnimeList(animes) {
  const container = document.getElementById('anime-list');
  container.innerHTML = '';

  animes.forEach(anime => {
    const card = document.createElement('div');
    card.classList.add('anime-card');

    const img = document.createElement('img');
    img.src = anime.image || 'fallback.jpg';
    img.alt = anime.title;
    img.classList.add('anime-thumb');

    const title = document.createElement('h3');
    title.innerText = anime.title;
    
    const episode = document.createElement('p');
    episode.innerText = `Episode: ${anime.episodes}`;
      
    const watchBtn = document.createElement('button');
    watchBtn.innerText = 'Watch';
    watchBtn.addEventListener('click', () => {
      window.location.href = `player.html?episodeId=${anime.id}`;
    });

    card.appendChild(img);
    card.appendChild(title);
    card.appendChild(episode);
    card.appendChild(watchBtn);
    container.appendChild(card);
  });
}

document.addEventListener('DOMContentLoaded', () => {
  const searchInput = document.getElementById('search-input');
  const searchBtn = document.getElementById('search-btn');
  const providerSelect = document.getElementById('provider-select');

  // Set the selected provider on load
  providerSelect.value = currentProvider;

  providerSelect.addEventListener('change', () => {
    currentProvider = providerSelect.value;
    localStorage.setItem('selectedProvider', currentProvider); // Save it!
    loadRecentEpisodes();
  });

  searchBtn.addEventListener('click', async () => {
    const query = searchInput.value;
    if (!query) return;

    const provider = await loadProviderFunctions(currentProvider);
    const data = await provider.searchAnime(query);
    renderAnimeList(data.results || []);
  });

  loadRecentEpisodes();
});
