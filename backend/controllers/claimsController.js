const Groq = require('groq-sdk');
require('dotenv').config();

const groq = new Groq({ 
    apiKey: process.env.GROQ_API_KEY 
});

const extractClaims = async (req, res) => {
    try {
        const { text } = req.body;

        if (!text || text.trim().length < 20) {
            return res.status(400).json({ message: 'Text too short for claim extraction.' });
        }

        // --- WORD LIMIT CHECK ---
        const wordCount = text.trim().split(/\s+/).filter(w => w.length > 0).length;
        if (wordCount > 3000) {
            console.log(`[Claims Controller] 🚫 Blocked: Text too long (${wordCount} words)`);
            return res.status(400).json({ 
                message: `Content exceeds the 3,000 word limit. You submitted ${wordCount} words.` 
            });
        }

        // Decide claim count range based on article length
        let minClaims, maxClaims;
        if (wordCount < 80) {
            minClaims = 1; maxClaims = 2;
        } else if (wordCount < 200) {
            minClaims = 1; maxClaims = 3;
        } else if (wordCount < 600) {
            minClaims = 2; maxClaims = 4;
        } else {
            minClaims = 3; maxClaims = 5;
        }

        console.log(`\n[Claims Controller] 🔍 Extracting claims (${wordCount} words → expect ${minClaims}–${maxClaims} claims)...`);

        const claimsPrompt = `
You are a forensic claim extractor for a Bangladeshi fact-checking platform.
Read the article below and extract the most important verifiable factual claims.

CRITICAL INSTRUCTIONS:
1. Extract ONLY genuinely distinct, checkable factual claims. Do NOT pad or invent claims.
2. If the article only has ${minClaims === 1 ? 'one clear claim' : 'a few clear claims'}, extract only that many. Do not force extra claims.
3. Extract between ${minClaims} and ${maxClaims} claims based on what the article actually contains.
4. You MUST write "summary", "claim_text", and "why_important" in BENGALI (বাংলা).
5. JSON keys, "claim_type" values, and "confidence" values MUST stay in English.

A valid claim must be:
- A single self-contained factual statement
- Specific (has a name, number, date, place, or event)
- Something a journalist could independently verify

A claim is NOT valid if it is:
- Vague or general (e.g. "The situation is bad")
- An opinion or prediction
- A repeat of another claim already listed

Respond ONLY with this exact JSON. No text before or after.

{
  "summary": "[2-3 sentence overall assessment in BENGALI]",
  "claims": [
    {
      "claim_text": "[The exact claim in one sentence in BENGALI]",
      "claim_type": "statistic | event | quote | accusation | policy",
      "confidence": "high | medium | low",
      "why_important": "[One sentence on why this matters in BENGALI]"
    }
  ]
}

=== ARTICLE ===
${text}
`;

        const groqRes = await groq.chat.completions.create({
            model: 'llama-3.1-8b-instant',
            messages: [{ role: 'user', content: claimsPrompt }],
            temperature: 0.2
        });

        const raw = groqRes.choices[0]?.message?.content?.trim();

        let parsed;
        try {
            parsed = JSON.parse(raw);
        } catch (parseErr) {
            const cleaned = raw.replace(/```json|```/g, '').trim();
            parsed = JSON.parse(cleaned);
        }

        const claims = parsed.claims || [];
        const summary = parsed.summary || "বিশ্লেষণ সম্পন্ন হয়েছে। যাচাই করার জন্য তথ্যগত দাবিগুলো বের করা হয়েছে।";

        console.log(`        ✅ Extracted ${claims.length} claims`);
        
        return res.status(200).json({ claims, summary });

    } catch (err) {
        console.log(`        ❌ Claims extraction error: ${err.message}`);
        return res.status(500).json({
            message: 'Claims service unavailable.',
            error: err.message
        });
    }
};

module.exports = { extractClaims };