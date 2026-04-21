const axios = require('axios');

// ============================================================
//  EMOTION KEYWORD MAPS  —  English + Bangla
// ============================================================

const EMOTION_KEYWORDS = {
    sadness: [
        'died', 'dead', 'death', 'killed', 'murder', 'murdered', 'deceased',
        'passed away', 'lost his life', 'lost her life', 'fatality', 'fatalities',
        'casualties', 'victim', 'victims', 'tragedy', 'tragic', 'mourning', 'grief',
        'funeral', 'buried', 'orphan', 'heartbreaking', 'devastating', 'loss of life',
        'bodies found', 'corpse', 'flood', 'flooding', 'disaster', 'catastrophe',
        'crash', 'accident', 'fire', 'burned', 'burnt', 'blazed', 'inferno',
        'collapsed', 'collapse', 'drowned', 'drowning', 'missing', 'swept away',
        'landslide', 'earthquake', 'cyclone', 'sank', 'wreckage',
        'injured', 'wounded', 'critical condition', 'hospitalized',
        'child dead', 'children dead', 'boy dead', 'girl dead', 'kids dead',
        'pond', 'river', 'lake',  // common context for drowning news
        'মৃত্যু', 'নিহত', 'নিখোঁজ', 'শোক', 'কান্না', 'দুঃখ', 'দুঃখজনক',
        'হতাশা', 'ট্র্যাজেডি', 'প্রাণহানি', 'দুর্ঘটনা', 'বন্যা', 'দুর্যোগ',
        'হারানো', 'এতিম', 'আগুন', 'পুড়ে', 'ভেঙে পড়ে', 'ডুবে', 'ডুবে মৃত্যু',
        'আহত', 'জানাজা', 'দাফন', 'ভূমিকম্প', 'ঘূর্ণিঝড়', 'ধস', 'বিধ্বস্ত',
        'শিশু মৃত্যু', 'পুকুর', 'নদী',
    ],
    fear: [
        'terror', 'terrorist', 'terrorism', 'attack', 'attacked', 'bomb', 'bombing',
        'explosion', 'blast', 'exploded', 'threat', 'threatened', 'panic',
        'horrifying', 'terrifying', 'alarming', 'danger', 'dangerous',
        'shooting', 'gunfire', 'hostage', 'kidnapped', 'abducted',
        'riot', 'violence', 'fled', 'fleeing', 'evacuated', 'curfew', 'lockdown',
        'আতঙ্ক', 'ভয়াবহ', 'হামলা', 'বিস্ফোরণ', 'ভয়', 'সন্ত্রাস', 'বোমা',
        'জরুরি', 'পালিয়ে', 'হুমকি', 'বিপদ', 'অপহরণ', 'কারফিউ',
    ],
    anger: [
        'protest', 'protested', 'outrage', 'outraged', 'furious', 'angry',
        'frustrated', 'rage', 'corruption', 'corrupt', 'injustice', 'scandal',
        'betrayal', 'abuse', 'violated', 'demand', 'demands', 'rally',
        'demonstration', 'condemn', 'condemned', 'criticized', 'accused',
        'allegation', 'bribery', 'fraud', 'theft', 'stolen', 'rape', 'raped',
        'assault', 'clashes', 'clash', 'dispute', 'confrontation', 'harassment',
        'ক্ষোভ', 'দুর্নীতি', 'চুরি', 'ধর্ষণ', 'প্রতিবাদ', 'বিক্ষোভ', 'লুট',
        'আন্দোলন', 'রাগ', 'অভিযোগ', 'দাবি', 'সংঘর্ষ', 'নির্যাতন', 'ঘুষ',
    ],
    excitement: [
        'champion', 'championship', 'final', 'finals', 'victory', 'won', 'wins',
        'winner', 'tournament', 'goal', 'match', 'game', 'football', 'cricket',
        'stadium', 'thrilling', 'thriller', 'legend', 'record', 'trophy', 'medal',
        'gold medal', 'playoffs', 'semifinal', 'hat-trick', 'wicket', 'knockout',
        'উত্তেজনা', 'রোমাঞ্চ', 'চ্যাম্পিয়ন', 'ফাইনাল', 'কিংবদন্তি',
        'ম্যাচ', 'টুর্নামেন্ট', 'শিরোপা', 'গোল', 'জেতা', 'ফুটবল', 'ক্রিকেট',
    ],
    joy: [
        'celebrate', 'celebrated', 'celebration', 'success', 'achievement',
        'proud', 'pride', 'happy', 'happiness', 'delighted', 'congratulations',
        'award', 'awarded', 'recognition', 'development', 'progress', 'breakthrough',
        'launched', 'inauguration', 'milestone',
        'উল্লাস', 'জয়', 'গর্ব', 'সাফল্য', 'উন্নয়ন', 'খুশি', 'বিজয়',
        'অর্জন', 'পুরস্কার', 'উদ্বোধন',
    ],
};

const EMOTION_META = {
    sadness: { color: 'blue', label_bn: 'শোক / দুঃখ' },
    fear: { color: 'red', label_bn: 'ভয় / আতঙ্ক' },
    anger: { color: 'orange', label_bn: 'ক্ষোভ / রাগ' },
    excitement: { color: 'yellow', label_bn: 'উত্তেজনা / রোমাঞ্চ' },
    joy: { color: 'green', label_bn: 'আনন্দ / গর্ব' },
    neutral: { color: 'gray', label_bn: 'নিরপেক্ষ' },
};

// HIGH-TRUST emotions — local keyword match for these always wins over AI
// because AI models tend to hallucinate "joy" for celebration-language
// even in tragedy news ("three kids died" → AI sees "died" differently)
const HIGH_TRUST_LOCAL = ['sadness', 'fear', 'anger'];

function scoreText(text, keywords) {
    const lower = text.toLowerCase();
    let count = 0;
    for (const word of keywords) {
        if (lower.includes(word.toLowerCase())) count++;
    }
    return count;
}

function runLocalDetection(text) {
    const rawScores = {};
    for (const [emotion, keywords] of Object.entries(EMOTION_KEYWORDS)) {
        rawScores[emotion] = scoreText(text, keywords);
    }
    console.log('        📊 Keyword scores:', rawScores);

    const sorted = Object.entries(rawScores).sort((a, b) => b[1] - a[1]);
    const [topEmotion, topCount] = sorted[0];

    if (topCount === 0) {
        return {
            dominant_emotion: 'neutral',
            emotion_scores: { neutral: 10 },
            intensity: 10,
            color: EMOTION_META.neutral.color,
            label_bn: EMOTION_META.neutral.label_bn,
        };
    }

    const total = Object.values(rawScores).reduce((a, b) => a + b, 0);
    const dominance = (topCount / total) * 50;
    const hitBoost = Math.min(topCount * 7, 45);
    const intensity = Math.min(Math.max(Math.round(dominance + hitBoost), 35), 92);

    const emotion_scores = {};
    for (const [emo, cnt] of Object.entries(rawScores)) {
        emotion_scores[emo] = topCount > 0 ? Math.round((cnt / topCount) * 100) : 0;
    }

    const meta = EMOTION_META[topEmotion] || EMOTION_META.neutral;
    return {
        dominant_emotion: topEmotion,
        emotion_scores,
        intensity,
        color: meta.color,
        label_bn: meta.label_bn,
    };
}

// ============================================================
//  CONTROLLER
// ============================================================

const detectEmotion = async (req, res) => {
    try {
        const { text } = req.body;

        if (!text || text.trim().length < 10) {
            return res.status(400).json({ message: 'Text too short for emotion analysis.' });
        }

        console.log('\n[Emotion Controller] 🎭 Detecting emotion...');

        // Step 1: Always run local detection first
        const localResult = runLocalDetection(text);
        console.log(`        🔍 Local → ${localResult.dominant_emotion} (intensity: ${localResult.intensity})`);

        let finalResult = localResult;

        // Step 2: Try AI service — but only let it override under strict conditions
        try {
            const aiRes = await axios.post(
                'http://127.0.0.1:8001/analyze-emotion',
                { text: text.substring(0, 5000) },
                { headers: { 'Content-Type': 'application/json' }, timeout: 4000 }
            );

            const ai = aiRes.data;
            const aiEmotion = (ai.dominant_emotion || '').toLowerCase();
            // Normalise intensity — Python may return 0-1 OR 0-100
            const aiIntRaw = ai.intensity || 0;
            const aiIntensity = aiIntRaw <= 1 ? Math.round(aiIntRaw * 100) : Math.round(aiIntRaw);

            console.log(`        🤖 AI   → ${aiEmotion} (intensity: ${aiIntensity})`);

            // AI can override local ONLY if:
            //   1. AI emotion is non-neutral
            //   2. Local detected nothing meaningful (neutral / 0 keywords)
            //      OR local emotion is NOT a high-trust category (sadness/fear/anger)
            const localIsHighTrust = HIGH_TRUST_LOCAL.includes(localResult.dominant_emotion);
            const localIsEmpty = localResult.dominant_emotion === 'neutral' && localResult.intensity <= 10;

            if (aiEmotion && aiEmotion !== 'neutral' && (localIsEmpty || !localIsHighTrust)) {
                finalResult = {
                    dominant_emotion: ai.dominant_emotion,
                    emotion_scores: ai.emotion_scores || localResult.emotion_scores,
                    intensity: aiIntensity,
                    color: ai.color || (EMOTION_META[aiEmotion] || EMOTION_META.neutral).color,
                    label_bn: ai.label_bn || (EMOTION_META[aiEmotion] || EMOTION_META.neutral).label_bn,
                };
                console.log(`        ✅ Using AI result`);
            } else if (localIsHighTrust) {
                console.log(`        ✅ Local wins (high-trust emotion: ${localResult.dominant_emotion})`);
            } else {
                console.log(`        ✅ Using local result`);
            }

        } catch (aiErr) {
            console.log(`        ⚠️  AI service skipped: ${aiErr.message}`);
        }

        console.log(`        🏁 FINAL → ${finalResult.dominant_emotion} | intensity: ${finalResult.intensity}`);
        return res.status(200).json(finalResult);

    } catch (err) {
        console.log(`        ❌ Error: ${err.message}`);
        return res.status(500).json({ message: 'Emotion detection failed.', error: err.message });
    }
};

module.exports = { detectEmotion };
