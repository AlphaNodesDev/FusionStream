const api = require('./config');

const searchAnime = async (query, page = 1) => {
  const res = await api.get(`/anime/zoro/${query}?page=${page}`);
  return res.data;
};

const fetchSection = async (filterPath) => {
  const res = await api.get(filterPath);
  return res.data;
};

module.exports = { searchAnime, fetchSection };
