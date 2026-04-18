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
            console.log(`[Claims Controller] 🚫 Blocked request: Text too long (${wordCount} words)`);
            return res.status(400).json({ 
                message: `Content exceeds the 3,000 word limit. You submitted ${wordCount} words.` 
            });
        }
        // ------------------------

        console.log('\n[Claims Controller] 🔍 Extracting claims via Groq...');

        // 🎯 THE FIX: Updated Prompt to enforce Bengali output for text, but English for JSON keys/logic
        const claimsPrompt = `
You are a forensic claim extractor for a Bangladeshi fact-checking platform.
Read the article below and extract exactly 2 to 3 main factual claims that can be independently verified.

CRITICAL INSTRUCTIONS: 
1. You MUST write the "summary", "claim_text", and "why_important" fields in BENGALI (বাংলা).
2. The JSON keys and the exact words for "claim_type" and "confidence" MUST remain in English so the system can parse them.

Each claim must be:
- A single, self-contained factual statement
- Specific (contains names, numbers, dates, or events)
- Verifiable (a journalist could check it)

You MUST respond ONLY in this exact JSON format. No other text outside the JSON.

{
  "summary": "[Write a 2-3 sentence overall assessment of the text here in BENGALI]",
  "claims": [
    {
      "claim_text": "[The exact claim in one sentence here in BENGALI]",
      "claim_type": "statistic | event | quote | accusation | policy",
      "confidence": "high | medium | low",
      "why_important": "[One sentence on why this claim matters to the story here in BENGALI]"
    }
  ]
}

=== ARTICLE ===
${text}
`;

        const groqRes = await groq.chat.completions.create({
            model: 'llama-3.1-8b-instant',
            messages: [{ role: 'user', content: claimsPrompt }],
            temperature: 0.1
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