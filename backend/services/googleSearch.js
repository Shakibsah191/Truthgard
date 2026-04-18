const axios = require('axios'); 

const getLiveContext = async (claim) => {
    try {
        const apiKey = process.env.GOOGLE_API_KEY;
        const cx = process.env.GOOGLE_CX;

        const response = await axios.get(`https://www.googleapis.com/customsearch/v1`, {
            params: {
                key: apiKey,
                cx: cx,
                q: claim,
                num: 3
            }
        });

        const data = response.data;

        if (!data.items || data.items.length === 0) {
            return "No recent news or live web results found for this claim.";
        }

        const searchSnippets = data.items.map(item => `- ${item.title}: ${item.snippet}`).join('\n');
        return searchSnippets;

    } catch (error) {
        // This is the magic line that catches the real Google error
        const apiErrorMessage = error.response ? error.response.data.error.message : error.message;
        console.error("🚨 Google API Error:", apiErrorMessage);
        return null; 
    }
}

module.exports = { getLiveContext };