const axios = require('axios');

/**
 * POST /api/emotion
 * Body: { text: string }
 * Calls the Python ai-service /analyze-emotion endpoint independently.
 * Zero coupling with the main analyze pipeline.
 */
const detectEmotion = async (req, res) => {
    try {
        const { text } = req.body;

        if (!text || text.trim().length < 10) {
            return res.status(400).json({ message: 'Text too short for emotion analysis.' });
        }

        console.log('\n[Emotion Controller] 🎭 Calling emotion service...');

        // Calling the Python AI service
        // Ensure your Python service is running on exactly port 8001 
        // and has a route setup as @app.post("/analyze-emotion")
        const aiRes = await axios.post('http://127.0.0.1:8001/analyze-emotion', 
            {
                text: text.substring(0, 5000)
            },
            {
                headers: {
                    'Content-Type': 'application/json'
                }
            }
        );

        const {
            dominant_emotion,
            emotion_scores,
            intensity,
            color,
            label_bn
        } = aiRes.data;

        console.log(`        ✅ Emotion: ${dominant_emotion} (intensity: ${intensity})`);

        return res.status(200).json({
            dominant_emotion,
            emotion_scores,
            intensity,
            color,
            label_bn
        });

    } catch (err) {
        console.log(`        ❌ Emotion service error: ${err.message}`);
        
        // Log more specific error details if Axios failed
        if (err.response) {
            console.log(`        ❌ AI Service responded with status: ${err.response.status}`);
        }

        return res.status(500).json({
            message: 'Emotion service unavailable.',
            error: err.message
        });
    }
};

module.exports = { detectEmotion };