const axios = require('axios');

const api = axios.create({
  baseURL: 'https://consumet.8man.me',
  headers: {
    Accept: 'application/json',
  },
});

module.exports = api;
the-maid-i-hired-recently-is-mysterious-18085