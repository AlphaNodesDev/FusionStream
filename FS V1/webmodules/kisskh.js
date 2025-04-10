const axios = require('axios');

async function search(query) {
    try {
        const response = await axios.get(`https://kisskh.co/api/DramaList/Search?q=${query}&type=0`);

        return response.data
            .filter(item => 
                item.title.toLowerCase().includes(query.toLowerCase()) // Filter to only include results with exact match
            )
            .map(item => ({
                title: item.title,
                thumbnail: item.thumbnail,
                episodesCount: item.episodesCount,
                website: 'KissKH', // Mark the website
                id: item.id,
                url: `https://kisskh.co/Drama/${encodeURIComponent(item.title.replace(/\s+/g, '-').replace(/[()]/g, ''))}-?id=${item.id}&q=true` // Construct the URL
            }));
    } catch (error) {
        console.error('Error fetching data from KissKH:', error);
        return [];
    }
}

module.exports = { search };
