export const consumet = (baseURL) => {
    return {
      async getRecentEpisodes() {
        const res = await fetch(`${baseURL}/anime/zoro/recent-episodes`);
        return res.json();
      },
      async getTopAiring() {
        const res = await fetch(`${baseURL}/anime/zoro/top-airing`);
        return res.json();
      },
      async searchAnime(query) {
        const res = await fetch(`${baseURL}/anime/zoro/${query}?&page=1`);
        return res.json();
      
      },
      async getInfo(id) {
        const res = await fetch(`${baseURL}/anime/zoro/info?id=${id}`);
        return res.json();
      },
      async getWatch(episodeId) {
        const res = await fetch(`${baseURL}/anime/zoro/watch/${episodeId}$sub`);
        return res.json();
      }
    };
  };
  