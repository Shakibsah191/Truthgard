const axios = require('axios');

// ============================================================
//  EMOTION KEYWORD MAPS  —  Expanded (English + Bangla)
// ============================================================

const EMOTION_KEYWORDS = {
    sadness: [
        // --- Existing ---
        'died','dead','death','killed','murder','fatality','victim','tragedy','mourning',
        'grief','funeral','buried','orphan','heartbreaking','devastating',
        'accident','fire','collapse','drowned','injured',

        'মৃত্যু','নিহত','নিখোঁজ','শোক','দুঃখ','দুর্ঘটনা','প্রাণহানি','আহত',

        // --- NEW (Narrative / Human story sadness) ---
        'কান্না','কাঁদতে','কাঁদছে','চোখের জল','চোখে পানি',
        'স্বপ্ন ভেঙে','স্বপ্ন ভেঙে গেছে','স্বপ্ন হারানো','স্বপ্ন হারিয়ে',
        'হারিয়ে গেছে','হারিয়ে গেল','অসহায়','দারিদ্র্য','অভাব',
        'কষ্ট','বেদনা','মায়ের চোখের জল','নীরব কষ্ট','বঞ্চিত',
        'হতাশা','জীবনসংগ্রাম','সংগ্রাম','দুর্দশা','অসহায়তা',
        'পড়াশোনা ছেড়ে','স্কুল ছাড়তে','শিশুশ্রম','কঠিন জীবন',
        'কাঁদতে কাঁদতে','চোখ ভিজে','নিঃশব্দে হারিয়ে'
    ],

    fear: [
        'terror','attack','bomb','explosion','panic','danger','shooting',
        'hostage','kidnapped','violence','lockdown',

        'আতঙ্ক','ভয়াবহ','হামলা','বিস্ফোরণ','ভয়','সন্ত্রাস',
        'হুমকি','বিপদ','অপহরণ','কারফিউ','চাঞ্চল্য','ভীতিকর'
    ],

    anger: [
        'protest','outrage','angry','corruption','injustice','scandal',
        'abuse','demand','rally','demonstration','accused','fraud',

        'ক্ষোভ','দুর্নীতি','প্রতিবাদ','বিক্ষোভ','রাগ','অভিযোগ',
        'দাবি','সংঘর্ষ','নির্যাতন','ঘুষ','ক্ষুব্ধ','তীব্র প্রতিক্রিয়া'
    ],

    excitement: [
        'champion','victory','won','winner','goal','match','tournament',
        'record','trophy','final','thrilling',

        'উত্তেজনা','রোমাঞ্চ','চ্যাম্পিয়ন','ফাইনাল','ম্যাচ',
        'টুর্নামেন্ট','শিরোপা','গোল','জেতা','রেকর্ড'
    ],

    joy: [
        'celebrate','success','achievement','happy','award','progress',
        'milestone','breakthrough',

        'উল্লাস','জয়','গর্ব','সাফল্য','উন্নয়ন','খুশি',
        'বিজয়','অর্জন','পুরস্কার','উদ্বোধন','সুখবর'
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

const HIGH_TRUST_LOCAL = ['sadness', 'fear', 'anger'];

// ============================================================
//  SCORING FUNCTION
// ============================================================

function scoreText(text, keywords) {
    const lower = text.toLowerCase();
    let count = 0;

    for (const word of keywords) {
        if (lower.includes(word.toLowerCase())) {
            count++;
        }
    }

    return count;
}

// ============================================================
//  LOCAL DETECTION (IMPROVED)
// ============================================================

function runLocalDetection(text) {
    const rawScores = {};

    for (const [emotion, keywords] of Object.entries(EMOTION_KEYWORDS)) {
        rawScores[emotion] = scoreText(text, keywords);
    }

    // 🔥 Contextual boost for narrative sadness
    if (
        text.includes('কাঁদ') ||
        text.includes('চোখের জল') ||
        (text.includes('স্বপ্ন') && text.includes('ভেঙে')) ||
        text.includes('দারিদ্র্য')
    ) {
        rawScores.sadness += 3;
    }

    console.log('        📊 Keyword scores:', rawScores);

    const sorted = Object.entries(rawScores).sort((a, b) => b[1] - a[1]);
    const [topEmotion, topCount] = sorted[0];

    // Improved neutral handling
    if (topCount <= 1) {
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
//  CONTROLLER (UNCHANGED LOGIC)
// ============================================================

const detectEmotion = async (req, res) => {
    try {
        const { text } = req.body;

        if (!text || text.trim().length < 10) {
            return res.status(400).json({ message: 'Text too short for emotion analysis.' });
        }

        console.log('\n[Emotion Controller] 🎭 Detecting emotion...');

        const localResult = runLocalDetection(text);
        console.log(`        🔍 Local → ${localResult.dominant_emotion}`);

        let finalResult = localResult;

        try {
            const aiRes = await axios.post(
                'http://127.0.0.1:8001/analyze-emotion',
                { text: text.substring(0, 5000) },
                { headers: { 'Content-Type': 'application/json' }, timeout: 4000 }
            );

            const ai = aiRes.data;
            const aiEmotion = (ai.dominant_emotion || '').toLowerCase();

            const localIsHighTrust = HIGH_TRUST_LOCAL.includes(localResult.dominant_emotion);
            const localIsEmpty = localResult.dominant_emotion === 'neutral';

            if (aiEmotion && aiEmotion !== 'neutral' && (localIsEmpty || !localIsHighTrust)) {
                finalResult = {
                    dominant_emotion: ai.dominant_emotion,
                    emotion_scores: ai.emotion_scores || localResult.emotion_scores,
                    intensity: ai.intensity || localResult.intensity,
                    color: ai.color || EMOTION_META[aiEmotion]?.color,
                    label_bn: ai.label_bn || EMOTION_META[aiEmotion]?.label_bn,
                };
            }

        } catch (err) {
            console.log('        ⚠️ AI skipped');
        }

        return res.status(200).json(finalResult);

    } catch (err) {
        return res.status(500).json({ message: 'Emotion detection failed.' });
    }
};

module.exports = { detectEmotion };