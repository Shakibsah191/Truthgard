const Analysis = require('../models/Analysis');
const axios = require('axios');
const Groq = require('groq-sdk');

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// ============================================================
// 🌍 REALITY ANCHOR
// ============================================================
const today = new Date();
const formattedDate = today.toISOString().split('T')[0];

const REALITY_ANCHOR = `
You are a senior Bangladeshi fact-checker. Today's date is ${formattedDate}.

CONFIRMED CURRENT FACTS (absolute ground truth — never override these):
- Bangladesh PM: Tarique Rahman (took office 2025, BNP-led government)
- Sheikh Hasina: Fled Bangladesh in August 2024, NO longer PM, NO longer in power
- Awami League: Currently NOT in government
- If any article presents Sheikh Hasina as the ACTIVE/CURRENT Prime Minister → FACTUALLY WRONG
- If any article presents an Awami League minister as currently serving → FACTUALLY WRONG

Your job is ONLY to follow the exact instruction given.
Always return valid JSON and nothing else.
`.trim();

// ============================================================
// 📦 CATEGORY DEFINITIONS
// ============================================================
const CATEGORIES = {
    POLITICS: {
        name: 'Politics',
        emoji: '🏛️',
        extractFocus: 'Extract: (1) Full name of the leader/official, (2) Their claimed title/position, (3) The specific government action or event, (4) Any specific numbers.',
        contradictionFocus: 'Pay special attention to whether the person title/position is correct for 2026.',
    },
    HEALTH: {
        name: 'Health',
        emoji: '🏥',
        extractFocus: 'Extract: (1) Disease or health issue name, (2) Death/affected count, (3) Hospital or health organization name (DGHS, WHO, IEDCR), (4) Location.',
        contradictionFocus: 'Pay special attention to whether the statistics and organization names are real.',
    },
    SPORTS: {
        name: 'Sports',
        emoji: '⚽',
        extractFocus: 'Extract: (1) Sport type, (2) Team or player names, (3) Match result or score, (4) Tournament name, (5) Date.',
        contradictionFocus: 'Pay special attention to whether the score and teams match official records.',
    },
    ECONOMY: {
        name: 'Economy',
        emoji: '💰',
        extractFocus: 'Extract: (1) Specific Taka/dollar figures, (2) Ministry or organization, (3) Economic indicator (inflation, GDP, budget), (4) Time period.',
        contradictionFocus: 'Pay special attention to whether the figures match official announcements.',
    },
    WORLD: {
        name: 'World News',
        emoji: '🌍',
        extractFocus: 'Extract: (1) Countries involved, (2) Leader name and title, (3) The specific international event, (4) Date or timeframe.',
        contradictionFocus: 'Pay special attention to whether leader names and positions are correct.',
    },
    ENTERTAINMENT: {
        name: 'Entertainment',
        emoji: '🎬',
        extractFocus: 'Extract: (1) Celebrity or artist name, (2) The specific event (movie release, award, controversy, death), (3) Any specific platform or production house, (4) Date or timeframe.',
        contradictionFocus: 'Pay special attention to whether the celebrity name, event, and platform details are real and verifiable.',
    },
    GENERAL: {
        name: 'General',
        emoji: '📰',
        extractFocus: 'Extract: (1) The single most important claim, (2) Any named person and their role, (3) Any specific numbers, (4) Location of the event.',
        contradictionFocus: 'Pay special attention to whether the main claim can be confirmed by any reliable source.',
    },
};

// ============================================================
// 🧮 SCORING
//
// PHILOSOPHY:
//   Web match is the dominant signal.
//   NLI is tiebreaker only for PARTIAL/UNKNOWN (capped ±8 pts).
//   Ghost entailment block: UNKNOWN → NLI cannot add positive pts.
//
// 🔒 SAFE-ZONE GUARDRAIL LOGIC (overrides raw score):
//   Web 0 results   → SUSPICIOUS  (no evidence either way)
//   Web UNKNOWN     → SUSPICIOUS  (unconfirmed)
//   Web PARTIAL     → SUSPICIOUS  (not fully confirmed)
//   Web NO          → SUSPICIOUS  (contradiction ≠ proof of fake)
//   Web YES         → trust score → REAL / LIKELY REAL
//
// FAKE verdict is ONLY assigned by hard overrides:
//   - Sheikh Hasina presented as active PM
//   - Physically impossible claims
//   - Non-news content (gate rejected)
//
// FALLBACK (web API failed entirely):
//   NLI score alone decides verdict via nliOnlyVerdict()
// ============================================================
const calculateScore = ({ mlScore, webMatchResult, domainBonus }) => {
    let score = 50;

    if (webMatchResult === 'YES') score += 40;
    else if (webMatchResult === 'PARTIAL') score += 10;
    else if (webMatchResult === 'NO') score -= 30;

    let nliContribution = ((mlScore - 50) / 50) * 8;
    if (webMatchResult === 'UNKNOWN' && nliContribution > 0) {
        nliContribution = 0;
        console.log(`         🛡️ GHOST BLOCK: Web UNKNOWN → NLI positive blocked`);
    }

    score += nliContribution;
    score += domainBonus;

    return Math.round(Math.max(0, Math.min(100, score)));
};

const scoreToVerdict = (score) => {
    if (score >= 75) return 'REAL';
    if (score >= 55) return 'LIKELY REAL';
    if (score >= 35) return 'SUSPICIOUS';
    return 'FAKE';
};

// ── NLI-only verdict when web API fails completely ──
// NLI score 0-100:
//   High entailment (≥70)   → LIKELY REAL  (not REAL — web didn't confirm)
//   Neutral (30-69)         → SUSPICIOUS
//   Low/contradiction (<30) → FAKE
const nliOnlyVerdict = (mlScore, nliVerdictLabel) => {
    console.log(`         🔄 WEB FAILED — using NLI-only verdict (score: ${mlScore}, verdict: ${nliVerdictLabel})`);
    if (nliVerdictLabel === 'CONTRADICTION' || mlScore < 30) return 'FAKE';
    if (mlScore >= 70 && nliVerdictLabel === 'ENTAILMENT') return 'LIKELY REAL';
    return 'SUSPICIOUS';
};

// ============================================================
// 🔍 STEP 3A — Detect Category
// ============================================================
const detectCategory = async (articleText) => {
    const prompt = `
Classify this Bengali news article into EXACTLY ONE category:
POLITICS, HEALTH, SPORTS, ECONOMY, WORLD, ENTERTAINMENT, GENERAL

Rules:
- POLITICS: Bangladesh government, ministers, PM, elections, parliament
- HEALTH: disease, hospital, medicine, outbreak, death from illness
- SPORTS: cricket, football, match, tournament, player, score
- ECONOMY: taka, budget, price, inflation, bank, GDP, export, import
- WORLD: international events, foreign countries, global leaders
- ENTERTAINMENT: celebrity, actor, singer, movie, drama, award, film, music, OTT
- GENERAL: anything else

Return JSON only: { "category": "POLITICS" }

Article: ${articleText.substring(0, 600)}`;

    const res = await groq.chat.completions.create({
        model: 'llama-3.1-8b-instant',
        messages: [
            { role: 'system', content: REALITY_ANCHOR },
            { role: 'user', content: prompt },
        ],
        response_format: { type: 'json_object' },
        temperature: 0,
    });

    const parsed = JSON.parse(res.choices[0].message.content);
    const cat = parsed.category?.toUpperCase();
    return CATEGORIES[cat] ? cat : 'GENERAL';
};

// ============================================================
// 🔎 STEP 3B — Extract Main Claim + Search Query
// ============================================================
const extractClaims = async (articleText, categoryKey) => {
    const cat = CATEGORIES[categoryKey];

    const prompt = `
You are extracting claims from a Bengali news article for fact-checking.

CATEGORY: ${cat.name}
FOCUS: ${cat.extractFocus}

YOUR TASKS:
1. MAIN_CLAIM: The single most central, verifiable fact. One sentence in English.
2. SUPPORTING_CLAIMS: 2-4 secondary details (numbers, names, dates).
3. SEARCH_QUERY: A precise 6-10 word English query to find this exact event on the internet.
   - Always include the year 2026.
   - Always include the key person's full name if there is one.
   - Use official English acronyms for Bangladeshi orgs (BRTA, DGHS, NBR, BB, ACC).
   - Be specific enough to find THIS exact event — not a general topic.
   - GOOD: "Tarique Rahman Bangladesh digital currency launch 2026"
   - BAD:  "Bangladesh economy news 2026"

Return JSON only:
{
  "main_claim": "One sentence in English describing the core verifiable claim",
  "supporting_claims": ["claim 1", "claim 2", "claim 3"],
  "search_query": "your precise search query here",
  "key_person": "Full name of main person or null",
  "key_person_title": "Their claimed title/position or null"
}

Article: ${articleText.substring(0, 1000)}`;

    const res = await groq.chat.completions.create({
        model: 'llama-3.1-8b-instant',
        messages: [
            { role: 'system', content: REALITY_ANCHOR },
            { role: 'user', content: prompt },
        ],
        response_format: { type: 'json_object' },
        temperature: 0,
    });

    const parsed = JSON.parse(res.choices[0].message.content);
    return {
        mainClaim: parsed.main_claim || 'Unknown main claim',
        supportingClaims: Array.isArray(parsed.supporting_claims) ? parsed.supporting_claims : [],
        searchQuery: parsed.search_query || '',
        keyPerson: parsed.key_person || null,
        keyPersonTitle: parsed.key_person_title || null,
    };
};

// ============================================================
// ⚖️ STEP 5A — Compare Claim vs Web Reality
// ============================================================
const compareClaimsVsWeb = async (mainClaim, supportingClaims, webContext, categoryKey) => {
    const cat = CATEGORIES[categoryKey];

    const prompt = `
You are a strict fact-checker comparing an article's main claim against live web research.

MAIN CLAIM:
"${mainClaim}"

SUPPORTING CLAIMS:
${supportingClaims.map((c, i) => `${i + 1}. ${c}`).join('\n')}

WEB RESEARCH RESULT:
"${webContext}"

VERIFICATION FOCUS: ${cat.contradictionFocus}

STRICT RULES — apply in this exact order:

RULE 1 — IDENTITY/ROLE WRONG:
If the claim states a specific person in a role (e.g. Sheikh Hasina as PM)
but reality or web shows that person is NOT in that role → "NO" immediately.

RULE 2 — DIRECT CONTRADICTION:
If web explicitly states the opposite, or gives vastly different numbers/timelines → "NO"

RULE 3 — TIMELINE/SCALE CONTRADICTION:
Claim says "within days/next week/next month" but web says "long-term/by 2030/future plan" → "NO"
Claim says extreme scale but web describes gradual/partial plan → "NO"

RULE 4 — CORE EVENT CONFIRMED, MINOR DETAILS DIFFER:
Core event confirmed as real but only small numbers or dates differ slightly → "PARTIAL"
NOTE: If the KEY SPECIFIC CLAIM (the unusual part) is not confirmed → use UNKNOWN not PARTIAL.

RULE 5 — FULLY CONFIRMED:
Web directly and clearly confirms the main claim with matching details → "YES"

RULE 6 — NO OVERLAP / NOT CONFIRMED:
Web result is about a different topic OR does not mention this event at all → "UNKNOWN"
WARNING: If web contradicts timeline or scale → use "NO" not "UNKNOWN".

Return JSON only:
{
  "main_claim_verdict": "YES | NO | PARTIAL | UNKNOWN",
  "main_claim_reason": "One sharp sentence explaining the verdict",
  "contradiction_found": true | false,
  "contradiction_detail": "What specifically is contradicted, or null"
}`;

    const res = await groq.chat.completions.create({
        model: 'llama-3.1-8b-instant',
        messages: [
            { role: 'system', content: REALITY_ANCHOR },
            { role: 'user', content: prompt },
        ],
        response_format: { type: 'json_object' },
        temperature: 0,
    });

    const parsed = JSON.parse(res.choices[0].message.content);
    return {
        webMatchResult: parsed.main_claim_verdict || 'UNKNOWN',
        mainClaimReason: parsed.main_claim_reason || '',
        contradictionFound: parsed.contradiction_found || false,
        contradictionDetail: parsed.contradiction_detail || null,
    };
};

// ============================================================
// 🧠 STEP 3C — Plausibility Check
// Hard override ONLY for physically impossible claims.
// Normal political/economic announcements must pass through.
// ============================================================
const checkPlausibility = async (mainClaim) => {
    const prompt = `
You are a senior fact-checker. Judge ONLY whether this claim is physically and logically possible.

CLAIM: "${mainClaim}"

Only mark impossible if it CLEARLY defies physics, basic economics, or governance reality.
Do NOT flag things that are merely surprising, unlikely, or politically controversial.

IMPOSSIBLE — flag these:
- "Bangladesh runs 100% on solar within a month"
- "Every citizen gets free phone tomorrow"
- "New city built in 3 days"
- "GDP doubled overnight"
- "50,000 people died in Dhaka in 24 hours from a new virus"

PLAUSIBLE — do NOT flag these (even if they seem unlikely):
- "Government plans solar capacity increase by 2030"
- "Bangladesh beat India by 5 wickets"
- "New hospital inaugurated in Dhaka"
- "PM signed trade deal with China"
- "All university students to get free laptops and 50,000 Taka stipend"
- Any normal political announcement, sports result, economic news, local event
- Any celebrity news, film release, award, entertainment event

Return JSON only:
{
  "is_plausible": true | false,
  "reason": "One sentence. Only explain if false."
}`;

    const res = await groq.chat.completions.create({
        model: 'llama-3.1-8b-instant',
        messages: [
            { role: 'system', content: REALITY_ANCHOR },
            { role: 'user', content: prompt },
        ],
        response_format: { type: 'json_object' },
        temperature: 0,
    });

    const parsed = JSON.parse(res.choices[0].message.content);
    return {
        isPlausible: parsed.is_plausible !== false,
        reason: parsed.reason || '',
    };
};

// ============================================================
// 🚨 HARD OVERRIDES
// Non-negotiable known facts. Triggers → FAKE immediately.
// Bypasses all scoring and web search.
// ============================================================
const checkHardOverrides = (extracted) => {
    const dump = JSON.stringify(extracted).toLowerCase();

    const hashinaMentioned = dump.includes('hasina') || dump.includes('হাসিনা');
    const pmMentioned = dump.includes('prime minister') || dump.includes('প্রধানমন্ত্রী') || dump.includes(' pm ');

    if (hashinaMentioned && pmMentioned) {
        return {
            triggered: true,
            reason: 'Article presents Sheikh Hasina as active Prime Minister — she left power in August 2024.',
        };
    }

    return { triggered: false, reason: null };
};

// ============================================================
// ✍️ STEP 5D — Generate Explanation
// ============================================================
const generateExplanation = async (finalVerdict, mainClaim, webMatchResult, contradictionDetail, categoryKey) => {
    const cat = CATEGORIES[categoryKey];

    const prompt = `
Write a 2-sentence explanation for a fact-check result. Be direct and clear.

Category: ${cat.name}
Final Verdict: ${finalVerdict}
Main Claim Checked: "${mainClaim}"
Web Verification Result: ${webMatchResult}
Contradiction Found: ${contradictionDetail || 'None'}

Rules:
- If verdict is SUSPICIOUS: explain that the claim could not be confirmed by web sources.
- If verdict is FAKE: explain what specifically was contradicted or disproved.
- If verdict is REAL or LIKELY REAL: explain what sources confirmed it.
- Write as if explaining to a regular reader.
- Do NOT mention any score. Do NOT say "Based on our analysis".

Return JSON only: { "explanation": "2 sentences here." }`;

    const res = await groq.chat.completions.create({
        model: 'llama-3.1-8b-instant',
        messages: [
            { role: 'system', content: REALITY_ANCHOR },
            { role: 'user', content: prompt },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.3,
    });

    const parsed = JSON.parse(res.choices[0].message.content);
    return parsed.explanation || 'Verification complete.';
};

// ============================================================
// 🛠️ HELPER — Save record and return response
// Used for early exits: hard overrides, gate blocks, implausible.
// ============================================================
const saveAndReturn = async (res, {
    userId, inputType, inputContent, articleText,
    detectedCategory, extracted, finalScore, finalVerdict,
    groqExplanation, webMatchResult, contradictionDetail,
    nliVerdict, webIsEmpty, mlScore,
}) => {
    const record = await Analysis.create({
        userId, inputType, inputContent,
        totalScore: finalScore,
        verdict: finalVerdict,
        textScore: mlScore,
        details: {
            articleText,
            category: detectedCategory,
            mainClaim: extracted.mainClaim || null,
            supportingClaims: extracted.supportingClaims || [],
            keyPerson: extracted.keyPerson || null,
            keyPersonTitle: extracted.keyPersonTitle || null,
            webMatchResult,
            contradictionFound: !!contradictionDetail,
            contradictionDetail: contradictionDetail || null,
            nliVerdict,
            webIsEmpty,
            groqExplanation,
            pipelineSucceeded: true,
        },
    });

    console.log(`\n==================================================`);
    console.log(`🏁 ANALYSIS COMPLETE — TRUTHGUARD V13.0`);
    console.log(`   ⚖️  Verdict : ${finalVerdict}`);
    console.log(`   💡 Reason  : ${groqExplanation}`);
    console.log(`==================================================\n`);

    return res.status(201).json({ result: record });
};

// ============================================================
// 🚀 MAIN ANALYZE FUNCTION
// ============================================================
const analyze = async (req, res) => {
    try {
        const { inputType, inputContent } = req.body;
        const userId = req.user.id;

        // ─────────────────────────────────────────────────────
        // 🛑 STEP 0A: Word Count Gate
        // ─────────────────────────────────────────────────────
        if (inputType === 'text') {
            const wordCount = inputContent.trim().split(/\s+/).length;
            if (wordCount > 2500) {
                return res.status(400).json({ message: `Text is too long (${wordCount} words). Max is 2500.` });
            }
            if (wordCount < 20) {
                return res.status(400).json({ message: 'Text is too short to analyze reliably. Please provide a full article.' });
            }
        }

        // ─────────────────────────────────────────────────────
        // 🛑 STEP 0B: Content Type Gate
        //
        // ONLY checks writing style/structure — NOT fact-checking.
        // Blocks obvious non-news: fiction, poems, reading exercises.
        //
        // If gate says NOT valid → save as FAKE directly (no crash).
        // If gate crashes → continue pipeline normally.
        // ─────────────────────────────────────────────────────
        if (inputType === 'text') {
            console.log('\n[STEP 0B] 🔍 Content Type Gate');
            try {
                const gateRes = await groq.chat.completions.create({
                    model: 'llama-3.1-8b-instant',
                    messages: [
                        {
                            role: 'system',
                            content: 'You are a writing style classifier. You ONLY check if text is structured like a news article. You do NOT fact-check, do NOT verify sources, do NOT judge if events are real or credible. Return valid JSON only.',
                        },
                        {
                            role: 'user',
                            content: `
Look ONLY at the WRITING STYLE and STRUCTURE of this text.
Do NOT think about whether the content is true or credible.
Do NOT check sources or media coverage.

REJECT (set is_valid_news: false) ONLY if it is clearly one of these:
1. CHILDREN'S STORY / FICTION: "রাজু নামের একটি ছেলে...", "এক দেশে ছিল...", fairy tale style
2. READING EXERCISE: Has "স্তর ১", "স্তর ২", "Level 1", "Level 2", or multiple versions of same story
3. POEM / CREATIVE WRITING: Verse format, rhyming, personal diary, essay
4. SOCIAL MEDIA POST: Casual chat language, no journalistic structure

ACCEPT (set is_valid_news: true) for EVERYTHING ELSE including:
- Any news article even if the content seems unlikely or extraordinary
- Any article with a newspaper header like "প্রথম আলো", "Daily Star" etc.
- Any article reporting a political, sports, health, economic, or entertainment event
- Any article that uses journalistic writing style

When in doubt → ACCEPT. Your job is only to block obvious non-news content.

Return JSON only:
{
  "is_valid_news": true | false,
  "rejection_reason": "One sentence in English if false, otherwise null"
}

Text:
${inputContent.substring(0, 1000)}`,
                        },
                    ],
                    response_format: { type: 'json_object' },
                    temperature: 0,
                });

                const gate = JSON.parse(gateRes.choices[0].message.content);
                console.log(`         📋 Valid News: ${gate.is_valid_news}`);

                if (!gate.is_valid_news) {
                    // ── Gate blocked: save as FAKE, never crash ──
                    console.log(`         🚫 GATE: Not a news article → saving as FAKE`);
                    return saveAndReturn(res, {
                        userId, inputType, inputContent,
                        articleText: inputContent,
                        detectedCategory: 'GENERAL',
                        extracted: {
                            mainClaim: 'Content does not appear to be a news article.',
                            supportingClaims: [],
                            keyPerson: null,
                            keyPersonTitle: null,
                        },
                        finalScore: 5,
                        finalVerdict: 'FAKE',
                        groqExplanation: `এই কন্টেন্টটি সংবাদ নিবন্ধ নয়: ${gate.rejection_reason || 'Not structured as a news article.'}`,
                        webMatchResult: 'GATE_REJECTED',
                        contradictionDetail: gate.rejection_reason || null,
                        nliVerdict: 'SKIPPED',
                        webIsEmpty: true,
                        mlScore: 50,
                    });
                }

                console.log(`         ✅ Gate passed`);
            } catch (gateErr) {
                // Gate crashed → continue pipeline, don't block user
                console.log(`         ⚠️ Gate failed (${gateErr.message}) → continuing`);
            }
        }

        console.log('\n==================================================');
        console.log('🔍 NEW ANALYSIS REQUEST: TRUTHGUARD V13.0 PIPELINE');
        console.log('==================================================');
        console.log(`👤 User ID : ${userId}`);
        console.log(`📄 Input   : "${inputContent.substring(0, 60)}..."`);
        console.log('--------------------------------------------------');

        // ─────────────────────────────────────────────────────
        // 🌐 STEP 1: SCRAPE & CLEAN
        // ─────────────────────────────────────────────────────
        console.log('\n[STEP 1] 🌐 Scraping & Preparing Content');
        let articleText = inputContent;
        let domainAge = null;
        let isHttps = false;

        try {
            const scraperRes = await axios.post(
                'http://127.0.0.1:8000/scrape',
                { inputType, inputContent },
                { timeout: 8000 }
            );
            articleText = scraperRes.data.article_text || inputContent;
            domainAge = scraperRes.data.domain_age;
            isHttps = scraperRes.data.is_https;
            console.log(`         ✅ Scraper OK | Length: ${articleText.length} chars | HTTPS: ${isHttps} | Domain Age: ${domainAge || 'unknown'}`);
        } catch {
            console.log(`         ⚠️ Scraper offline → using raw input`);
        }

        let domainBonus = 0;
        if (isHttps) domainBonus += 5;
        if (domainAge && domainAge > 365) domainBonus += 5;

        // ─────────────────────────────────────────────────────
        // Pipeline state
        // ─────────────────────────────────────────────────────
        let mlScore = 50;
        let finalScore = 50;
        let finalVerdict = 'SUSPICIOUS';
        let groqExplanation = 'Analysis pipeline partially failed. Please verify manually.';
        let pipelineSucceeded = false;
        let detectedCategory = 'GENERAL';
        let extracted = {};
        let comparisonResult = {};
        let nliVerdict = 'NEUTRAL';
        let webIsEmpty = false;
        let webContext = 'No relevant information found online.';
        let webApiFailed = false;
        let webResultsCount = 0;

        try {
            // ─────────────────────────────────────────────────────
            // 🏷️ STEP 3A: DETECT CATEGORY
            // ─────────────────────────────────────────────────────
            console.log('\n[STEP 3A] 🏷️ Detecting Article Category');
            detectedCategory = await detectCategory(articleText);
            console.log(`         ✅ Category: ${CATEGORIES[detectedCategory].emoji} ${CATEGORIES[detectedCategory].name}`);

            // ─────────────────────────────────────────────────────
            // 🔎 STEP 3B: EXTRACT CLAIM + SEARCH QUERY
            // ─────────────────────────────────────────────────────
            console.log('\n[STEP 3B] 🔎 Extracting Main Claim & Search Query');
            extracted = await extractClaims(articleText, detectedCategory);
            console.log(`         ✅ Main Claim  : "${extracted.mainClaim}"`);
            console.log(`         📋 Supporting  : [${extracted.supportingClaims.join(' | ')}]`);
            console.log(`         🔑 Key Person  : ${extracted.keyPerson || 'None'} (${extracted.keyPersonTitle || 'N/A'})`);
            console.log(`         🔍 Search Query: "${extracted.searchQuery}"`);

            // ─────────────────────────────────────────────────────
            // 🚨 HARD OVERRIDE CHECK
            // ─────────────────────────────────────────────────────
            const hardOverride = checkHardOverrides(extracted);
            if (hardOverride.triggered) {
                console.log(`\n         🚨 HARD OVERRIDE: ${hardOverride.reason}`);
                return saveAndReturn(res, {
                    userId, inputType, inputContent, articleText,
                    detectedCategory, extracted,
                    finalScore: 5, finalVerdict: 'FAKE',
                    groqExplanation: hardOverride.reason,
                    webMatchResult: 'HARD_OVERRIDE',
                    contradictionDetail: hardOverride.reason,
                    nliVerdict, webIsEmpty, mlScore,
                });
            }

            // ─────────────────────────────────────────────────────
            // 🧠 STEP 3C: PLAUSIBILITY CHECK
            // ─────────────────────────────────────────────────────
            console.log('\n[STEP 3C] 🧠 Plausibility Check');
            const plausibility = await checkPlausibility(extracted.mainClaim);
            console.log(`         ${plausibility.isPlausible ? '✅' : '🚨'} Plausible: ${plausibility.isPlausible} | ${plausibility.reason}`);

            if (!plausibility.isPlausible) {
                console.log(`         🚨 IMPLAUSIBLE → Hard override to FAKE`);
                return saveAndReturn(res, {
                    userId, inputType, inputContent, articleText,
                    detectedCategory, extracted,
                    finalScore: 10, finalVerdict: 'FAKE',
                    groqExplanation: `This claim is physically or logically impossible: ${plausibility.reason}`,
                    webMatchResult: 'IMPLAUSIBLE',
                    contradictionDetail: plausibility.reason,
                    nliVerdict, webIsEmpty, mlScore,
                });
            }

            // ─────────────────────────────────────────────────────
            // 🌐 STEP 4: LIVE WEB SEARCH
            // ─────────────────────────────────────────────────────
            console.log('\n[STEP 4] 🌐 Cross-Referencing Live Web');
            try {
                const tavilyRes = await axios.post('https://api.tavily.com/search', {
                    api_key: process.env.TAVILY_API_KEY,
                    query: extracted.searchQuery,
                    search_depth: 'basic',
                    include_answer: false,
                    max_results: 5,
                }, { timeout: 10000 });

                const results = tavilyRes.data.results || [];
                webResultsCount = results.length;
                webIsEmpty = webResultsCount === 0;

                webContext = results
                    .slice(0, 3)
                    .map(r => `${r.title}: ${(r.content || '').substring(0, 200)}`)
                    .join(' | ') || 'No relevant information found online.';

                console.log(`         ✅ Web Done | Results: ${webResultsCount} | Chars: ${webContext.length} | Empty: ${webIsEmpty}`);
                console.log(`         📄 Summary: "${webContext.substring(0, 120)}..."`);

            } catch (tavilyErr) {
                webApiFailed = true;
                webIsEmpty = true;
                webResultsCount = 0;
                console.log(`         ❌ Web API failed (${tavilyErr.message}) → will use NLI-only fallback`);
            }

            // ─────────────────────────────────────────────────────
            // 🔬 STEP 5B: NLI VERIFICATION
            // ─────────────────────────────────────────────────────
            console.log('\n[STEP 5B] 🔬 NLI Verification');

            const nliNeeded = webApiFailed ||
                ['PARTIAL', 'UNKNOWN'].includes(comparisonResult.webMatchResult);

            if (!webApiFailed && !webIsEmpty) {
                console.log('\n[STEP 5A] ⚖️ Comparing Claim Against Web Reality');
                comparisonResult = await compareClaimsVsWeb(
                    extracted.mainClaim,
                    extracted.supportingClaims,
                    webContext,
                    detectedCategory
                );
                console.log(`         ✅ Web Match : ${comparisonResult.webMatchResult}`);
                console.log(`         📌 Reason    : ${comparisonResult.mainClaimReason}`);
                if (comparisonResult.contradictionFound) {
                    console.log(`         🚨 Contradiction: ${comparisonResult.contradictionDetail}`);
                }
            } else if (!webApiFailed && webIsEmpty) {
                console.log('\n[STEP 5A] ⚖️ Skipped — web returned 0 results');
                comparisonResult = { webMatchResult: 'UNKNOWN', mainClaimReason: 'No web results found.', contradictionFound: false, contradictionDetail: null };
            }

            try {
                const nliPremise = `Web research says: ${webContext}. The article claims: "${extracted.mainClaim}". Do these agree on timeline, scale, and core facts?`;
                const nliRes = await axios.post('http://127.0.0.1:8001/nli-verify', {
                    web_context: nliPremise,
                    main_claim: extracted.mainClaim,
                }, { timeout: 10000 });

                mlScore = nliRes.data.nli_score ?? 50;
                nliVerdict = nliRes.data.verdict ?? 'NEUTRAL';
                console.log(`         ✅ NLI Score  : ${Math.round(mlScore)}/100`);
                console.log(`         🧠 NLI Verdict: ${nliVerdict}`);
            } catch {
                console.log(`         ⚠️ NLI offline → neutral 50`);
                mlScore = 50;
                nliVerdict = 'OFFLINE';
            }

            // ─────────────────────────────────────────────────────
            // 🧮 STEP 5C: FINAL SCORE + GUARDRAILS
            // ─────────────────────────────────────────────────────
            console.log('\n[STEP 5C] 🧮 Calculating Final Score + Guardrails');

            if (webApiFailed) {
                finalScore = Math.round(mlScore);
                finalVerdict = nliOnlyVerdict(mlScore, nliVerdict);
                console.log(`         🔄 WEB FAILED MODE: NLI-only verdict → ${finalVerdict}`);

            } else if (webIsEmpty || webResultsCount === 0) {
                finalScore = 40;
                finalVerdict = 'SUSPICIOUS';
                console.log(`         🔒 SAFE-ZONE RULE: Web returned 0 results → ALWAYS SUSPICIOUS`);

            } else {
                finalScore = calculateScore({
                    mlScore,
                    webMatchResult: comparisonResult.webMatchResult,
                    domainBonus,
                });

                const nliContrib = Math.round(((mlScore - 50) / 50) * 8);
                const nliActual = (comparisonResult.webMatchResult === 'UNKNOWN' && nliContrib > 0) ? 0 : nliContrib;

                console.log(`         📊 Score Breakdown:`);
                console.log(`            Base Score       : 50`);
                console.log(`            Web Match        : ${comparisonResult.webMatchResult === 'YES' ? '+40' :
                        comparisonResult.webMatchResult === 'PARTIAL' ? '+10' :
                            comparisonResult.webMatchResult === 'NO' ? '-30' : '  0'
                    } (${comparisonResult.webMatchResult})`);
                console.log(`            NLI Contribution : ${nliActual >= 0 ? '+' : ''}${nliActual} (${nliVerdict}, max ±8)`);
                console.log(`            Domain Bonus     : +${domainBonus}`);
                console.log(`            ─────────────────────────`);
                console.log(`            RAW SCORE        : ${finalScore}/100`);

                if (comparisonResult.webMatchResult === 'UNKNOWN') {
                    finalVerdict = finalScore <= 25 ? 'FAKE' : 'SUSPICIOUS';
                    console.log(`            🛡️ GUARDRAIL 1: Web UNKNOWN (Score: ${finalScore}) → ${finalVerdict}`);
                } else if (comparisonResult.webMatchResult === 'PARTIAL') {
                    finalVerdict = finalScore <= 25 ? 'FAKE' : 'SUSPICIOUS';
                    console.log(`            🛡️ GUARDRAIL 2: Web PARTIAL (Score: ${finalScore}) → ${finalVerdict}`);
                } else if (comparisonResult.webMatchResult === 'NO') {
                    finalVerdict = finalScore <= 25 ? 'FAKE' : 'SUSPICIOUS';
                    console.log(`            🛡️ GUARDRAIL 3: Web NO (Score: ${finalScore}) → ${finalVerdict}`);
                } else {
                    finalVerdict = scoreToVerdict(finalScore);
                    console.log(`            ✅ Web YES → score-based verdict`);
                }
            }

            console.log(`            FINAL VERDICT    : ${finalVerdict}`);

            // ─────────────────────────────────────────────────────
            // ✍️ STEP 5D: GENERATE EXPLANATION
            // ─────────────────────────────────────────────────────
            console.log('\n[STEP 5D] ✍️ Generating Explanation');
            groqExplanation = await generateExplanation(
                finalVerdict,
                extracted.mainClaim,
                webApiFailed ? 'WEB_API_FAILED' : comparisonResult.webMatchResult,
                comparisonResult.contradictionDetail,
                detectedCategory
            );
            console.log(`         ✅ "${groqExplanation}"`);

            pipelineSucceeded = true;

        } catch (err) {
            console.log(`\n[FALLBACK] ⚠️ Pipeline error: ${err.message}`);
            finalScore = 50;
            finalVerdict = 'SUSPICIOUS';
            groqExplanation = 'Live verification failed. Please verify this article manually.';
        }

        // ─────────────────────────────────────────────────────
        // 💾 STEP 6: SAVE TO DATABASE
        // ─────────────────────────────────────────────────────
        console.log('\n[STEP 6] 💾 Saving to Database');
        const record = await Analysis.create({
            userId,
            inputType,
            inputContent,
            totalScore: finalScore,
            verdict: finalVerdict,
            textScore: mlScore,
            details: {
                articleText,
                category: detectedCategory,
                mainClaim: extracted.mainClaim || null,
                supportingClaims: extracted.supportingClaims || [],
                keyPerson: extracted.keyPerson || null,
                keyPersonTitle: extracted.keyPersonTitle || null,
                webMatchResult: comparisonResult.webMatchResult || null,
                contradictionFound: comparisonResult.contradictionFound || false,
                contradictionDetail: comparisonResult.contradictionDetail || null,
                nliVerdict,
                webIsEmpty,
                webApiFailed,
                webResultsCount,
                groqExplanation,
                pipelineSucceeded,
            },
        });
        console.log(`         ✅ Saved | Record ID: ${record.id}`);

        console.log('\n==================================================');
        console.log('🏁 ANALYSIS COMPLETE — TRUTHGUARD V13.0');
        console.log(`   🏷️  Category : ${CATEGORIES[detectedCategory].emoji} ${CATEGORIES[detectedCategory].name}`);
        console.log(`   🌐 Web Match : ${comparisonResult.webMatchResult || (webApiFailed ? 'API_FAILED' : 'N/A')}`);
        console.log(`   📊 Web Count : ${webResultsCount} results`);
        console.log(`   🔬 NLI       : ${nliVerdict}`);
        console.log(`   🎯 Score     : ${finalScore} / 100`);
        console.log(`   ⚖️  Verdict   : ${finalVerdict}`);
        console.log(`   💡 Reason    : ${groqExplanation}`);
        console.log('==================================================\n');

        res.status(201).json({ result: record });

    } catch (err) {
        console.log('\n❌ CRITICAL SERVER ERROR:', err.message);
        console.error(err);
        res.status(500).json({ message: 'Internal server error during analysis.' });
    }
};

// ============================================================
// 📜 GET HISTORY
// ============================================================
const getHistory = async (req, res) => {
    try {
        const records = await Analysis.findAll({
            where: { userId: req.user.id },
            order: [['createdAt', 'DESC']],
        });
        res.json(records);
    } catch (err) {
        console.error('History fetch error:', err.message);
        res.status(500).json({ message: 'Failed to fetch history.' });
    }
};

module.exports = { analyze, getHistory };