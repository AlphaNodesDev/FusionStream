document.addEventListener('DOMContentLoaded', async function () {
  const updateModal = document.getElementById('updateModal');
  const newsModal = document.getElementById('newsModal');
  const changelogPre = document.getElementById('changelogContent');
  const downloadUpdate = document.getElementById('downloadUpdate');

  const currentVersion = '1.0.7';
 
  document.getElementById('closeModal').onclick = () => updateModal.style.display = 'none';
  document.getElementById('closeNews').onclick = () => newsModal.style.display = 'none';

  window.onclick = function (event) {
    if (event.target === updateModal) updateModal.style.display = 'none';
    if (event.target === newsModal) newsModal.style.display = 'none';
  };

  downloadUpdate.onclick = function (e) {
    e.preventDefault();
    window.electronAPI?.openExternal('https://github.com/AlphaNodesDev/FusionStream/releases/latest');
  };

  fetch('https://api.github.com/repos/AlphaNodesDev/FusionStream/releases/latest')
    .then(res => res.json())
    .then(data => {
      const latestVersion = data.tag_name.replace(/^v/, '');
      if (isNewerVersion(currentVersion, latestVersion)) {
        document.getElementById('newVersion').textContent = latestVersion;
        document.getElementById('currentVersion').textContent = currentVersion;
        changelogPre.textContent = data.body || 'No changelog provided.';
        updateModal.style.display = 'block';
      }
    })
    .catch(err => console.error('Update check failed:', err));

  fetch('https://raw.githubusercontent.com/AlphaNodesDev/FusionStream/main/news.json')
    .then(res => res.json())
    .then(news => {
      if (news.show && isNewsActive(news.startDate, news.endDate)) {
        document.getElementById('newsTitle').textContent = news.title;
        document.getElementById('newsMessage').textContent = news.message;
        newsModal.style.display = 'block';
      }
    })
    .catch(err => console.error('News fetch error:', err));

  // 🔍 Version comparison logic
  function isNewerVersion(current, latest) {
    const currentParts = current.split('.').map(Number);
    const latestParts = latest.split('.').map(Number);
    for (let i = 0; i < latestParts.length; i++) {
      if (latestParts[i] > (currentParts[i] || 0)) return true;
      if (latestParts[i] < (currentParts[i] || 0)) return false;
    }
    return false;
  }

  // 🕒 Date range check for news
  function isNewsActive(start, end) {
    const now = new Date();
    const startDate = new Date(start);
    const endDate = new Date(end);
    return now >= startDate && now <= endDate;
  }
});
