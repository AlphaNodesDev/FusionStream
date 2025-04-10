const axios = require('axios');
const cheerio = require('cheerio');


async function search(query) {
    try {
        const response = await axios.get(`https://kissasian.com.lv/?type=movies&s=${encodeURIComponent(query)}`);
        const $ = cheerio.load(response.data);

        const results = [];

        $('ul.switch-block.list-episode-item li').each((index, element) => {
            const title = $(element).find('a').attr('title') || 'No Title';
            const url = $(element).find('a').attr('href') || 'No URL';
            const imageUrl = $(element).find('img').attr('data-original') || 'No Image URL';
            
               
         
            
            if (title && url && imageUrl) {
                results.push({
                    title: title,
                    url: url,
                    thumbnail: imageUrl,
                    website: 'kissasian', 
                });
            }
        });
      
        
     
        return results;

    } catch (error) {
        console.error('Error fetching data from Another Website:', error);
        return [];
    }
}


module.exports = { search };
