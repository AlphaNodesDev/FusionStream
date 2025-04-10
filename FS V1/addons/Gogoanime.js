const axios = require('axios');
const cheerio = require('cheerio');

async function search(query) {
    try {
        const response = await axios.get(`https://ww6.gogoanime.co.cz/?s=${encodeURIComponent(query)}`);
        const $ = cheerio.load(response.data);

        const results = [];

        // Loop through each search result in <div class="listupd">
        $('.listupd article.bs').each((index, element) => {
            const title = $(element).find('a').attr('title') || 'No Title';
            const url = $(element).find('a').attr('href') || 'No URL';
            const imageUrl = $(element).find('img').attr('src') || 'No Image URL';

            if (title && url && imageUrl) {
                results.push({
                    title: title,
                    url: url.startsWith('http') ? url : `https://ww6.gogoanime.co.cz${url}`, // Ensure full URL
                    thumbnail: imageUrl,
                    website: 'Gogoanime'
                });
            }
        });

        return results;

    } catch (error) {
        console.error('Error fetching data from Gogoanime:', error);
        return [];
    }
}

module.exports = { search };
