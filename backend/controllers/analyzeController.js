const Analysis = require('../models/Analysis');
const axios = require('axios');
const Groq = require('groq-sdk');

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// ============================================================
// 🌍 REALITY ANCHOR — The Senior Investigative Journalist
// ============================================================

const today = new Date();
const formattedDate = today.toISOString().split('T')[0];

const REALITY_ANCHOR = `
You are an elite, senior investigative journalist and lead fact-checker in Bangladesh. Today's date is ${formattedDate}.

Your primary goal is to ruthlessly hunt down misinformation, authenticate claims, and verify journalistic integrity. You do not trust claims easily. You look for verified sources, exact dates, and logical consistency.

CONFIRMED CURRENT FACTS (treat these as absolute ground truth):
- Bangladesh PM: Tarique Rahman (took office 2025, BNP-led government)
- Sheikh Hasina: Fled Bangladesh in August 2024, NO longer PM, NO longer in power
- Awami League: Currently NOT in government
- If any article presents Sheikh Hasina as the ACTIVE/CURRENT Prime Minister, that is FACTUALLY WRONG.
- If any article presents an Awami League minister as currently serving in government, that is FACTUALLY WRONG.

Your job is ONLY to follow the exact instruction given. Do not add extra commentary.
Always return valid JSON and nothing else.
`.trim();

// ============================================================
// 📦 CATEGORY DEFINITIONS
// ============================================================
const CATEGORIES = {
    POLITICS: {
        name: 'Politics',
        emoji: '🏛️',
        extractFocus: 'Extract: (1) Full name of the leader/official mentioned, (2) Their claimed title/position, (3) The specific government action or event claimed, (4) Any specific numbers.',
        contradictionFocus: 'Pay special attention to whether the person\'s title/position is correct for 2026.',
    },
    HEALTH: {
        name: 'Health',
        emoji: '🏥',
        extractFocus: 'Extract: (1) Disease or health issue name, (2) Death/affected count, (3) Hospital or health organization name.',
        contradictionFocus: 'Pay special attention to whether the statistics and organization names are real.',
    },
    SPORTS: {
        name: 'Sports',
        emoji: '⚽',
        extractFocus: 'Extract: (1) Sport type, (2) Team or player names, (3) Match result or score, (4) Tournament name, (5) Date of match.',
        contradictionFocus: 'Pay special attention to whether the score and teams match official records.',
    },
    ECONOMY: {
        name: 'Economy',
        emoji: '💰',
        extractFocus: 'Extract: (1) Specific Taka/dollar figures mentioned, (2) Ministry or organization making the claim, (3) Economic indicator.',
        contradictionFocus: 'Pay special attention to whether the figures are realistic and match official announcements.',
    },
    WORLD: {
        name: 'World News',
        emoji: '🌍',
        extractFocus: 'Extract: (1) Country or countries involved, (2) Leader or official name and title, (3) The specific international event.',
        contradictionFocus: 'Pay special attention to whether the leader names and their positions are correct.',
    },
    GENERAL: {
        name: 'General',
        emoji: '📰',
        extractFocus: 'Extract: (1) The single most important claim, (2) Any named person and their role, (3) Specific numbers/statistics.',
        contradictionFocus: 'Pay special attention to whether the main claim can be confirmed by any reliable source.',
    },
};

// ============================================================
// 🧮 FIXED MATH SCORING (Simple & Strict)
// ============================================================
const calculateScore = ({ mlScore, webMatchResult, categoryPenalty, domainBonus }) => {
    let score = 50;

    // 1. Web Match Contribution
    if (webMatchResult === 'YES') score += 40;
    else if (webMatchResult === 'PARTIAL') score += 10;
    else if (webMatchResult === 'NO') score -= 30;
    else score += 0; // UNKNOWN adds nothing

    // 2. NLI Contribution (Capped at ±15)
    let mlContribution = ((mlScore - 50) / 50) * 15;

    // 🛑 STRICT RULE: If Web is UNKNOWN (0 hits), NLI CANNOT add positive points
    if (webMatchResult === 'UNKNOWN' && mlContribution > 0) {
        mlContribution = 0; 
        console.log(`        🛡️ GHOST BLOCK: Web UNKNOWN → NLI positive contribution zeroed`);
    }

    score += mlContribution;
    score -= categoryPenalty;
    score += domainBonus;

    return Math.round(Math.max(0, Math.min(100, score)));
};

const scoreToVerdict = (score) => {
    if (score >= 75) return 'REAL';
    if (score >= 55) return 'LIKELY REAL';
    if (score >= 35) return 'SUSPICIOUS';
    return 'FAKE';
};

// ============================================================
// 🔍 STEP 3A — Detect Category
// ============================================================
const detectCategory = async (articleText) => {
    const prompt = `
Classify this Bengali news article into EXACTLY ONE of these categories:
POLITICS, HEALTH, SPORTS, ECONOMY, WORLD, GENERAL

Return JSON only: { "category": "POLITICS" }

Article: ${articleText.substring(0, 600)}`;

    const res = await groq.chat.completions.create({
        model: 'llama-3.1-8b-instant',
        messages: [
            { role: 'system', content: REALITY_ANCHOR },
            { role: 'user', content: prompt }
        ],
        response_format: { type: 'json_object' },
        temperature: 0,
    });

    const parsed = JSON.parse(res.choices[0].message.content);
    const cat = parsed.category?.toUpperCase();
    return CATEGORIES[cat] ? cat : 'GENERAL';
};

// ============================================================
// 🔎 STEP 3B — Extract MAIN CLAIM + Domain-Strict Search
// ============================================================
const extractClaims = async (articleText, categoryKey) => {
    const cat = CATEGORIES[categoryKey];

    const prompt = `
You are a senior investigative journalist preparing to verify a breaking story.

CATEGORY: ${cat.name}
FOCUS: ${cat.extractFocus}

YOUR TASKS:
1. Extract the MAIN_CLAIM (the central, verifiable fact).
2. Extract SUPPORTING_CLAIMS (numbers, names, dates).
3. Generate a HIGH-PRECISION SEARCH QUERY to verify the claim.

CRITICAL SEARCH QUERY RULES:
- The search query MUST include the year 2026 and the exact name of the key person mentioned (to verify if they are actually in power).
- For local Bangladesh news (Politics, Health, Economy, General), you MUST restrict the search to reliable domains. 
  Append this exact string to your query: site:prothomalo.com OR site:thedailystar.net OR site:bbc.com/bengali OR site:ittefaq.com.bd
- For WORLD or SPORTS news, do not use domain restrictions.
- Example Local Query: "Sheikh Hasina $25 billion semiconductor deal 2026 site:prothomalo.com OR site:thedailystar.net"

Return JSON only:
{
  "main_claim": "One sentence describing the core verifiable claim",
  "supporting_claims": ["claim 1", "claim 2", "claim 3"],
  "search_query": "Your highly targeted search query",
  "key_person": "Full name of main person mentioned or null",
  "key_person_title": "Their claimed title/position or null"
}

Article: ${articleText.substring(0, 1000)}`;

    const res = await groq.chat.completions.create({
        model: 'llama-3.1-8b-instant',
        messages: [
            { role: 'system', content: REALITY_ANCHOR },
            { role: 'user', content: prompt }
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
// ⚖️ STEP 5A — Compare claims vs web reality
// ============================================================
const compareClaimsVsWeb = async (mainClaim, supportingClaims, webContext, categoryKey) => {
    const cat = CATEGORIES[categoryKey];

    const prompt = `
You are a senior investigative journalist. You must compare an unverified claim against your live web research.

UNVERIFIED MAIN CLAIM:
"${mainClaim}"

LIVE WEB RESEARCH RESULTS (From trusted domains):
"${webContext}"

VERIFICATION FOCUS: ${cat.contradictionFocus}

YOUR TASK: Apply strict journalistic standards.

STRICT RULES:
RULE 1 — IDENTITY & ROLE CONTRADICTION: If the claim mentions a specific person in a specific role (e.g., Sheikh Hasina as PM) but your reality anchor or web data shows that person is NO LONGER in that role, you MUST mark this as "NO" immediately. Even if the event is real, the leadership is fake.
RULE 2 — DIRECT CONTRADICTION: If the web explicitly says the opposite, or gives vastly different numbers/timelines → "NO"
RULE 3 — MINOR DETAILS DIFFER: If the core event happened, but numbers/dates are slightly off → "PARTIAL"
RULE 4 — FULLY CONFIRMED: If trusted web sources report the exact same event → "YES"
RULE 5 — THE SILENCE PENALTY (UNKNOWN): If a major event is claimed but your web research returns NOTHING or completely unrelated news, this is highly suspicious. Major news would be covered by reliable sources. If there is no mention of the claim in the web context → "UNKNOWN"

Return JSON only:
{
  "main_claim_verdict": "YES | NO | PARTIAL | UNKNOWN",
  "main_claim_reason": "One sharp, journalistic sentence explaining why.",
  "contradiction_found": true | false,
  "contradiction_detail": "What specifically is contradicted, or null"
}`;

    const res = await groq.chat.completions.create({
        model: 'llama-3.1-8b-instant',
        messages: [
            { role: 'system', content: REALITY_ANCHOR },
            { role: 'user', content: prompt }
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
// 🧠 STEP 3C — Reality Plausibility Pre-Check
// ============================================================
const checkPlausibility = async (mainClaim, categoryKey) => {
    const prompt = `
You are a senior fact-checker. Judge whether this claim is physically and logically possible.

CLAIM: "${mainClaim}"

Ask yourself: Is the timeline realistic? Is the scale realistic? Does this defy physics or basic economics?

Return JSON only:
{
  "is_plausible": true | false,
  "reason": "One sentence why this is or is not physically possible"
}`;

    const res = await groq.chat.completions.create({
        model: 'llama-3.1-8b-instant',
        messages: [
            { role: 'system', content: REALITY_ANCHOR },
            { role: 'user', content: prompt }
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
// 🚨 STEP 5B — GLOBAL Category Reality Penalty (BULLETPROOF)
// ============================================================
const getCategoryPenalty = (categoryKey, extracted, webContext) => {
    let penalty = 0;
    const webLower = webContext.toLowerCase();
    
    // Convert everything extracted into one giant lowercase string for foolproof searching
    const extractionDump = JSON.stringify(extracted).toLowerCase();

    // ──────────────────────────────────────────────────────────
    // 🌍 GLOBAL LEADERSHIP CHECK (English & Bengali)
    // ──────────────────────────────────────────────────────────
    
    // Check for both English and Bengali spellings anywhere in the extracted data
    const hasinaMentioned = extractionDump.includes('hasina') || extractionDump.includes('হাসিনা');
    const pmMentioned = extractionDump.includes('prime minister') || extractionDump.includes('pm') || extractionDump.includes('প্রধানমন্ত্রী');

    if (hasinaMentioned && pmMentioned) {
        penalty += 100; // THE NUKE. Drops score by 100 points instantly.
        console.log('        🚨 FATAL REALITY FAIL: Article claims Hasina is PM (Bengali/English match) → penalty -100 (NUKED)');
    }

    // Check for old ministers in both languages
    const oldMinisters = ['টিপু মুনশি', 'আবুল হাসান মাহমুদ আলী', 'সাবের হোসেন চৌধুরী', 'tipu munshi', 'mahmud ali', 'saber hossain'];
    if (oldMinisters.some(m => extractionDump.includes(m) || webLower.includes(m))) {
        penalty += 50; // Heavy penalty for old ministers
        console.log('        ⚠️ GLOBAL REALITY FAIL: Former Awami League minister found active → penalty -50');
    }

    // ──────────────────────────────────────────────────────────
    // 📉 CATEGORY SPECIFIC CHECKS
    // ──────────────────────────────────────────────────────────
    if (categoryKey === 'HEALTH') {
        const hasOrgConfirmation = webLower.includes('dghs') || webLower.includes('iedcr') ||
            webLower.includes('who') || webLower.includes('health ministry');
        if (!hasOrgConfirmation && extracted.mainClaim.match(/\d{4,}/)) {
            penalty += 10;
        }
    }

    if (categoryKey === 'ECONOMY') {
        const hasSourceConfirmation = webLower.includes('bangladesh bank') ||
            webLower.includes('nbr') || webLower.includes('finance ministry');
        if (!hasSourceConfirmation && extracted.mainClaim.match(/\d+\s*lakh\s*crore|\d+\s*হাজার\s*কোটি/i)) {
            penalty += 15;
        }
    }

    return penalty;
};

// ============================================================
// ✍️ STEP 5E — Generate Explanation
// ============================================================
const generateExplanation = async (finalScore, finalVerdict, mainClaim, webMatchResult, contradictionDetail, categoryKey) => {
    const cat = CATEGORIES[categoryKey];

    const prompt = `
Write a 2-sentence explanation for a fact-check result. Be direct and clear.

Category: ${cat.name}
Final Verdict: ${finalVerdict}
Main Claim Checked: "${mainClaim}"
Web Verification Result: ${webMatchResult}
Contradiction Found: ${contradictionDetail || 'None'}

Write as if explaining to a regular reader why this article got this verdict. Do NOT mention the score.

Return JSON only: { "explanation": "2 sentences here." }`;

    const res = await groq.chat.completions.create({
        model: 'llama-3.1-8b-instant',
        messages: [
            { role: 'system', content: REALITY_ANCHOR },
            { role: 'user', content: prompt }
        ],
        response_format: { type: 'json_object' },
        temperature: 0.3,
    });

    const parsed = JSON.parse(res.choices[0].message.content);
    return parsed.explanation || 'Verification complete.';
};

// ============================================================
// 🚀 MAIN ANALYZE FUNCTION
// ============================================================
const analyze = async (req, res) => {
    try {
        const { inputType, inputContent } = req.body;
        const userId = req.user.id;

        // 🛑 STEP 0A: Word count gate
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
        // 🛑 STEP 0B: CONTENT TYPE GATE (Isolated from Politics)
        // ─────────────────────────────────────────────────────
        if (inputType === 'text') {
            console.log('\n[STEP 0B] 🔍 Content Type & AI Detection Gate');
            try {
                const GATEKEEPER_SYSTEM = `
                You are a strict Editorial Filter for a news agency. 
                Your ONLY job is to determine if a submitted text is structurally a real news report.
                Ignore fact-checking. Ignore politics. Focus entirely on writing style, genre, and journalistic format.
                Always return valid JSON.
                `.trim();

                const gateCheck = await groq.chat.completions.create({
                    model: 'llama-3.1-8b-instant',
                    messages: [
                        { role: 'system', content: GATEKEEPER_SYSTEM },
                        {
                            role: 'user', content: `
Analyze this Bengali text and categorize it. You are the first line of defense against junk data.

RULES FOR REJECTION (Set is_valid_news to false if ANY match):
1. FICTION/STORY: It reads like a fairy tale, moral lesson, or children's story (e.g., "রাজু নামের একটি ছেলে...", "এক দেশে ছিল...").
2. LACK OF SPECIFICS: It makes big claims but names no specific dates, no exact locations, and no verifiable real-world officials.
3. AI TEMPLATE: It feels robotic, overly perfect, or lists "levels" (স্তর ১, স্তর ২).
4. OPINION/POEM: It is an essay, creative writing, or personal rant.

A valid news article MUST have a journalistic tone, specific entities (real people/places), and report on an event.

Return JSON only:
{
  "is_valid_news": boolean,
  "rejection_reason": "If false, write a sharp 1-sentence reason in English explaining why it fails journalistic standards. If true, write null."
}

Text to analyze:
${inputContent.substring(0, 1000)}`
                        }
                    ],
                    response_format: { type: 'json_object' },
                    temperature: 0,
                });

                const gate = JSON.parse(gateCheck.choices[0].message.content);

                console.log(`        📋 Is Valid News : ${gate.is_valid_news}`);
                
                if (!gate.is_valid_news) {
                    console.log(`        🚫 GATE BLOCKED: ${gate.rejection_reason}`);
                    return res.status(400).json({
                        message: `This content was rejected by our editorial filter: ${gate.rejection_reason}`,
                        gate_result: 'REJECTED_CONTENT',
                    });
                }
                console.log(`        ✅ Gate passed — confirmed as valid news structure`);

            } catch (gateErr) {
                console.log(`        ⚠️ [WARNING] Gate check completely failed to parse JSON: ${gateErr.message}`);
            }
        }

        console.log('\n==================================================');
        console.log('🔍 NEW ANALYSIS REQUEST: TRUTHGUARD V10.0 PIPELINE');
        console.log('==================================================');
        console.log(`👤 User ID    : ${userId}`);
        console.log(`📄 Input      : "${inputContent.substring(0, 60)}..."`);
        console.log('--------------------------------------------------');

        // ─────────────────────────────────────────────────────
        // 🌐 STEP 1: SCRAPE & CLEAN
        // ─────────────────────────────────────────────────────
        console.log('\n[STEP 1] 🌐 Scraping & Preparing Content');
        let articleText = inputContent;
        let domainAge = null;
        let isHttps = false;

        try {
            const scraperRes = await axios.post('http://127.0.0.1:8000/scrape', { inputType, inputContent }, { timeout: 8000 });
            articleText = scraperRes.data.article_text || inputContent;
            domainAge = scraperRes.data.domain_age;
            isHttps = scraperRes.data.is_https;
            console.log(`        ✅ Scraper OK | Length: ${articleText.length} chars`);
        } catch (e) {
            console.log(`        ⚠️ Scraper offline → using raw input text`);
        }

        let domainBonus = 0;
        if (isHttps) domainBonus += 5;
        if (domainAge && domainAge > 365) domainBonus += 5;

        // ─────────────────────────────────────────────────────
        // 🔬 STEP 2: NLI placeholder
        // ─────────────────────────────────────────────────────
        console.log('\n[STEP 2] ⏭️ NLI placeholder — runs after web search (Step 5C)');
        let mlScore = 50; 

        let finalScore = 50;
        let finalVerdict = 'SUSPICIOUS';
        let groqExplanation = 'Analysis pipeline partially failed. Result based on available signals only.';
        let pipelineSucceeded = false;
        let detectedCategory = 'GENERAL';
        let extracted = {};
        let comparisonResult = {};
        let nliVerdict = 'NEUTRAL';
        let plausibility = { isPlausible: true, reason: 'Pre-check not reached' };
        let webIsEmpty = false; 

        try {
            // ─────────────────────────────────────────────────────
            // 🏷️ STEP 3A: DETECT CATEGORY
            // ─────────────────────────────────────────────────────
            console.log('\n[STEP 3A] 🏷️ Detecting Article Category');
            detectedCategory = await detectCategory(articleText);
            const cat = CATEGORIES[detectedCategory];
            console.log(`        ✅ Category: ${cat.emoji} ${cat.name}`);

            // ─────────────────────────────────────────────────────
            // 🔎 STEP 3B: EXTRACT MAIN CLAIM & GENERATE QUERY
            // ─────────────────────────────────────────────────────
            console.log('\n[STEP 3B] 🔎 Extracting Claims & Generating Search Query');
            extracted = await extractClaims(articleText, detectedCategory);
            console.log(`        ✅ Main Claim  : "${extracted.mainClaim}"`);
            console.log(`        🔑 Key Person  : ${extracted.keyPerson || 'None'} (${extracted.keyPersonTitle || 'N/A'})`);
            console.log(`        🔍 Search Query: "${extracted.searchQuery}"`);

            // ─────────────────────────────────────────────────────
            // 🧠 STEP 3C: PLAUSIBILITY PRE-CHECK
            // ─────────────────────────────────────────────────────
            console.log('\n[STEP 3C] 🧠 Reality Plausibility Pre-Check');
            plausibility = await checkPlausibility(extracted.mainClaim, detectedCategory);
            console.log(`        ${plausibility.isPlausible ? '✅' : '🚨'} Plausible: ${plausibility.isPlausible} | Reason: ${plausibility.reason}`);

            // ─────────────────────────────────────────────────────
            // 🌐 STEP 4: LIVE WEB SEARCH (Using Generated Query directly)
            // ─────────────────────────────────────────────────────
            console.log('\n[STEP 4] 🌐 Cross-Referencing Live Web');

            const tavilyRes = await axios.post('https://api.tavily.com/search', {
                api_key: process.env.TAVILY_API_KEY,
                query: extracted.searchQuery, // Passed exactly as LLM generated it
                search_depth: 'basic',
                include_answer: true,
                max_results: 5,
            }, { timeout: 10000 });

            const rawWebAnswer = tavilyRes.data.answer || '';
            const webResultsCount = tavilyRes.data.results?.length || 0;

            webIsEmpty = !rawWebAnswer || rawWebAnswer.trim().length < 30 || webResultsCount === 0;
            const webContext = rawWebAnswer || 'No relevant information found online.';

            console.log(`        ✅ Web Search Done | Results: ${webResultsCount} | Context: ${webContext.length} chars | Empty: ${webIsEmpty}`);

            // ─────────────────────────────────────────────────────
            // ⚖️ STEP 5A: COMPARE CLAIMS VS WEB
            // ─────────────────────────────────────────────────────
            console.log('\n[STEP 5A] ⚖️ Comparing Main Claim Against Web Reality');
            comparisonResult = await compareClaimsVsWeb(
                extracted.mainClaim,
                extracted.supportingClaims,
                webContext,
                detectedCategory
            );
            console.log(`        ✅ Web Match  : ${comparisonResult.webMatchResult}`);
            console.log(`        📌 Reason     : ${comparisonResult.mainClaimReason}`);

            // ─────────────────────────────────────────────────────
            // 🚨 STEP 5B: APPLY CATEGORY & GLOBAL PENALTIES
            // ─────────────────────────────────────────────────────
            console.log('\n[STEP 5B] 🚨 Applying Reality & Plausibility Checks');
            let categoryPenalty = getCategoryPenalty(detectedCategory, extracted, webContext);

            if (!plausibility.isPlausible) {
                categoryPenalty += 20;
                console.log(`        🚨 PLAUSIBILITY FAIL: "${plausibility.reason}" → penalty -20`);
            }

            console.log(`        📉 Total Penalties Applied: -${categoryPenalty} pts`);

            // ─────────────────────────────────────────────────────
            // 🔬 STEP 5C: NLI FACT VERIFICATION
            // ─────────────────────────────────────────────────────
            console.log('\n[STEP 5C] 🔬 NLI Fact Verification');
            try {
                const nliPremise = `According to web research: ${webContext}. The article claims: "${extracted.mainClaim}". Do these agree?`;

                const nliRes = await axios.post('http://127.0.0.1:8001/nli-verify', {
                    web_context: nliPremise,
                    main_claim: extracted.mainClaim
                }, { timeout: 10000 });

                mlScore = nliRes.data.nli_score ?? 50;
                nliVerdict = nliRes.data.verdict ?? 'NEUTRAL';
                console.log(`        ✅ NLI Verdict: ${nliVerdict} (${Math.round(mlScore)}/100)`);
            } catch (nliErr) {
                console.log(`        ⚠️ NLI offline → using neutral 50`);
            }

            // ─────────────────────────────────────────────────────
            // 🧮 STEP 5D: FIXED MATH SCORING & SIMPLE GUARDRAILS
            // ─────────────────────────────────────────────────────
            console.log('\n[STEP 5D] 🧮 Calculating Final Score');

            finalScore = calculateScore({
                mlScore,
                webMatchResult: comparisonResult.webMatchResult,
                categoryPenalty,
                domainBonus,
            });

            const nliContrib = Math.round(((mlScore - 50) / 50) * 15);
            const nliContribActual = (comparisonResult.webMatchResult === 'UNKNOWN' && nliContrib > 0) ? 0 : nliContrib;

            console.log(`        📊 Score Breakdown:`);
            console.log(`            Base Score            : 50`);
            console.log(`            Web Match (${comparisonResult.webMatchResult.padEnd(7)}): ${comparisonResult.webMatchResult === 'YES' ? '+40' : comparisonResult.webMatchResult === 'PARTIAL' ? '+10' : comparisonResult.webMatchResult === 'NO' ? '-30' : '  0'}`);
            console.log(`            NLI Contribution      : ${nliContribActual >= 0 ? '+' : ''}${nliContribActual} (verdict: ${nliVerdict})`);
            console.log(`            Category Penalty      : -${categoryPenalty}`);
            console.log(`            Domain Bonus          : +${domainBonus}`);
            console.log(`            ──────────────────────────`);
            console.log(`            RAW SCORE             : ${finalScore}/100`);

            // 🛑 THE SIMPLE OVERRIDE LOGIC
            if (webIsEmpty || comparisonResult.webMatchResult === 'UNKNOWN') {
                finalVerdict = 'SUSPICIOUS';
                console.log(`        🛡️ GUARDRAIL: 0 Web Search Found → Forced SUSPICIOUS`);
                
            } else if (mlScore < 20 && comparisonResult.webMatchResult !== 'NO') {
                finalVerdict = 'SUSPICIOUS';
                console.log(`        🛡️ GUARDRAIL: NLI is less than 20 → Forced SUSPICIOUS`);
                
            } else {
                finalVerdict = scoreToVerdict(finalScore);
            }

            console.log(`        🎯 FINAL VERDICT: ${finalVerdict}`);

            // ─────────────────────────────────────────────────────
            // ✍️ STEP 5E: GENERATE EXPLANATION
            // ─────────────────────────────────────────────────────
            console.log('\n[STEP 5E] ✍️ Generating Explanation');
            groqExplanation = await generateExplanation(
                finalScore,
                finalVerdict,
                extracted.mainClaim,
                comparisonResult.webMatchResult,
                comparisonResult.contradictionDetail,
                detectedCategory
            );
            console.log(`        ✅ Explanation: "${groqExplanation}"`);

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
                groqExplanation,
                pipelineSucceeded,
            }
        });

        console.log('\n==================================================');
        console.log('🏁 ANALYSIS COMPLETE — TRUTHGUARD V10.0');
        console.log(`   ⚖️  Verdict      : ${finalVerdict}`);
        console.log('==================================================\n');

        res.status(201).json({ result: record });

    } catch (err) {
        console.log('\n❌ CRITICAL SERVER ERROR:', err.message);
        console.error(err);
        res.status(500).json({ message: 'Internal server error during analysis.' });
    }
};

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