# 🛡️ TruthGuard — AI-Powered Fake News Detection Platform

<div align="center">

![TruthGuard](https://img.shields.io/badge/TruthGuard-V14.0-7C3AED?style=for-the-badge&logo=shield&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-Express-339933?style=for-the-badge&logo=node.js&logoColor=white)
![MySQL](https://img.shields.io/badge/MySQL-Sequelize-4479A1?style=for-the-badge&logo=mysql&logoColor=white)
![AI](https://img.shields.io/badge/AI-Groq%20%7C%20NLI%20%7C%20ONNX-06B6D4?style=for-the-badge&logo=openai&logoColor=white)
![Language](https://img.shields.io/badge/Language-Bengali%20%7C%20English-F59E0B?style=for-the-badge)

**A full-stack fact-checking system built for the Bangladeshi news ecosystem.**  
Paste a URL or article text — TruthGuard runs it through an 8-stage AI pipeline and returns a verdict.

</div>

---

## 📖 Table of Contents

- [Overview](#-overview)
- [Features](#-features)
- [System Architecture](#-system-architecture)
- [The 4 Core Features](#-the-4-core-features)
- [8-Stage Analysis Pipeline](#-8-stage-analysis-pipeline)
- [API Endpoints](#-api-endpoints)
- [Tech Stack](#-tech-stack)
- [Project Structure](#-project-structure)
- [Installation & Setup](#-installation--setup)
- [Environment Variables](#-environment-variables)
- [How the Data Flows](#-how-the-data-flows)
- [Error Handling](#-error-handling)
- [Verdict System](#-verdict-system)

---

## 🔍 Overview

TruthGuard is a **Bengali-language fact-checking platform** that uses a combination of NLP, web search, NLI (Natural Language Inference), and LLM-based reasoning to analyze news articles for credibility. It supports both **URL-based** and **text-based** analysis, and provides emotion detection and claim extraction as standalone tools.

> **Key insight:** The frontend never reads from the database directly. It sends a `fetch()` request → the backend processes it → returns JSON → the frontend saves that JSON to `localStorage` → redirects to `results.html` which reads from `localStorage`. No direct DB access from the browser. Ever.

---

## ✨ Features

| Feature | Description |
|---|---|
| 🌐 **URL Analysis** | Scrape and analyze any news article URL |
| 📝 **Text Analysis** | Paste raw article text for direct analysis |
| 🎭 **Emotion Detection** | Detect the dominant emotion in Bengali/English news text |
| 🔍 **Claim Extraction** | Extract key verifiable claims from an article using LLaMA via Groq |

---

## 🏗️ System Architecture

```
index.html (User Input)
      │
      ▼
authMiddleware.js  ←  Verifies JWT token
      │
      ▼
analyzeRoutes.js   ←  Routes request to correct controller
      │
      ├──▶ analyzeController.js   (8-stage AI pipeline)
      ├──▶ emotionController.js   (emotion detection)
      └──▶ claimsController.js    (claim extraction)
            │
            ▼
      Analysis.create()  →  MySQL (via Sequelize)
            │
            ▼
      JSON response  →  localStorage  →  results.html
```

---

## 🚀 The 4 Core Features

### 1. 🌐 URL Analysis
- User submits a news article URL
- The Python scraper service fetches the page and extracts the article body, headline, domain age, and HTTPS status
- The extracted text is passed into the full 8-stage analysis pipeline

### 2. 📝 Text Analysis
- User pastes raw article text (20–2,500 words)
- Skips the scraping stage and goes directly into the AI pipeline
- Domain-based scores (`domainScore`, `headlineScore`) are `null` for text input

### 3. 🎭 Emotion Detection (`/api/analyze/emotion`)
Dual-layer detection using local keyword scoring + optional AI microservice fallback.

**How it works:**
- A keyword dictionary covers both **English and Bengali** emotion words across 5 categories: `sadness`, `fear`, `anger`, `excitement`, `joy`
- Contextual boosts are applied for narrative sadness patterns (e.g., `কাঁদতে`, `চোখের জল`, `দারিদ্র্য`)
- If local detection finds a high-confidence result (`sadness`, `fear`, `anger`), it is trusted directly
- Otherwise, an external AI microservice at `http://127.0.0.1:8001/analyze-emotion` is consulted for a second opinion

**Response:**
```json
{
  "dominant_emotion": "sadness",
  "emotion_scores": { "sadness": 100, "fear": 40, "anger": 20 },
  "intensity": 78,
  "color": "blue",
  "label_bn": "শোক / দুঃখ"
}
```

### 4. 🔍 Claim Extraction (`/api/analyze/claims`)
Uses **LLaMA 3.1 8B** (via Groq) to forensically extract verifiable factual claims from articles.

**How it works:**
- Dynamically adjusts the number of claims to extract based on article length (1–5 claims)
- Enforces Bengali output for `summary`, `claim_text`, and `why_important`
- Filters out vague opinions, predictions, and duplicate claims

**Response:**
```json
{
  "summary": "নিবন্ধটি বাংলাদেশের দারিদ্র্য হার নিয়ে একটি অস্বাভাবিক দাবি করেছে...",
  "claims": [
    {
      "claim_text": "বাংলাদেশে এক বছরে দারিদ্র্যের হার ৯০% কমেছে",
      "claim_type": "statistic",
      "confidence": "low",
      "why_important": "এটি একটি যাচাইযোগ্য পরিসংখ্যান দাবি যা আন্তর্জাতিক সংস্থাগুলির রিপোর্টের বিরুদ্ধে যায়।"
    }
  ]
}
```

---

## ⚙️ 8-Stage Analysis Pipeline

The core of TruthGuard. Runs inside `analyzeController.js` for every analysis request.

```
STEP 0A │ Word Count Gate        → Reject if < 20 or > 2,500 words
STEP 0B │ URL Scraper            → Python microservice extracts article text from URL
STEP 1  │ Claim Extraction       → Groq LLaMA identifies the main claim + category
STEP 2  │ Web Search             → Searches Google/Bing for the main claim
STEP 3  │ Contradiction Check    → Groq LLaMA checks if web results contradict the claim
STEP 4  │ Explanation            → Groq LLaMA writes a human-readable verdict explanation
STEP 5A │ Domain Score           → Scores the source domain (age, HTTPS, known credibility)
STEP 5B │ NLI Score              → ONNX NLI model compares claim vs web evidence
STEP 6  │ Score Aggregation      → Combines all scores into a final 0–100 credibility score
STEP 7  │ Database Save          → Saves full result to MySQL via Sequelize
```

---

## 📡 API Endpoints

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `POST` | `/api/auth/register` | ❌ Public | Register a new user |
| `POST` | `/api/auth/login` | ❌ Public | Login, receive JWT token |
| `POST` | `/api/analyze/` | ✅ JWT | Run full fake news analysis |
| `GET` | `/api/analyze/history` | ✅ JWT | Get current user's analysis history |
| `POST` | `/api/analyze/emotion` | ✅ JWT | Detect emotion in text |
| `POST` | `/api/analyze/claims` | ✅ JWT | Extract verifiable claims from text |

All protected routes require an `Authorization: Bearer <token>` header.

---

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| **Backend** | Node.js, Express.js |
| **Database** | MySQL + Sequelize ORM |
| **Authentication** | JWT (`jsonwebtoken`) |
| **LLM** | Groq API (LLaMA 3.1 8B Instant) |
| **NLI Model** | ONNX Runtime (local inference) |
| **Scraping** | Python microservice (port 8001) |
| **Emotion AI** | Python AI microservice (port 8001) |
| **Frontend** | Vanilla HTML/CSS/JS |

---

## 📁 Project Structure

```
truthguard/
├── backend/
│   ├── server.js                    # Entry point — Express app, routes, DB sync
│   ├── config/
│   │   └── db.js                    # Sequelize MySQL connection
│   ├── middleware/
│   │   └── authMiddleware.js        # JWT verification (protect)
│   ├── models/
│   │   ├── User.js                  # Users table schema
│   │   └── Analysis.js              # Analysis results table schema
│   ├── routes/
│   │   ├── authRoutes.js            # /api/auth/*
│   │   └── analyzeRoutes.js         # /api/analyze/*
│   └── controllers/
│       ├── authController.js        # register + login logic
│       ├── analyzeController.js     # 8-stage AI pipeline
│       ├── emotionController.js     # Emotion detection (local + AI)
│       └── claimsController.js      # Claim extraction via Groq
├── index.html                       # Main frontend (input form)
├── results.html                     # Results display page
├── auth.html                        # Login / Register page
└── .env                             # Environment variables (not committed)
```

---

## 🚀 Installation & Setup

### Prerequisites
- Node.js v18+
- MySQL 8+
- Python 3.9+ (for the scraper/emotion microservice)
- A [Groq API key](https://console.groq.com)

### 1. Clone the repository
```bash
git clone https://github.com/your-username/truthguard.git
cd truthguard
```

### 2. Install Node.js dependencies
```bash
cd backend
npm install
```

### 3. Set up the database
Create a MySQL database:
```sql
CREATE DATABASE truthguard;
```

### 4. Configure environment variables
```bash
cp .env.example .env
# Then fill in your values (see below)
```

### 5. Start the Python microservice
```bash
# In a separate terminal
cd python_service
pip install -r requirements.txt
python app.py
# Runs on port 8001
```

### 6. Start the Node.js backend
```bash
cd backend
node server.js
# Runs on port 5000
# Sequelize auto-creates tables on first run
```

### 7. Open the frontend
```
http://localhost:5000/index.html
```

---

## 🔐 Environment Variables

Create a `.env` file in the `backend/` directory:

```env
# Database
DB_HOST=localhost
DB_NAME=truthguard
DB_USER=root
DB_PASS=your_mysql_password

# JWT
JWT_SECRET=your_super_secret_key_here

# Groq LLM API
GROQ_API_KEY=your_groq_api_key_here
```

---

## 🔄 How the Data Flows

### Full Analysis Flow
1. User fills in text/URL on `index.html` and clicks **Analyze**
2. `index.html` reads the JWT from `localStorage` and adds it as `Authorization: Bearer <token>`
3. `authMiddleware.js` verifies the token and attaches `req.user` (contains `id`, `name`, `email`)
4. `analyzeController.js` runs the 8-stage pipeline
5. Result is saved to MySQL via `Analysis.create()`
6. Backend returns `{ result: record }` as JSON with HTTP 201
7. `index.html` saves the result to `localStorage` as `truthguard_result`
8. User is redirected to `results.html`, which reads from `localStorage` and renders the verdict

### The Full Result Object
```json
{
  "id": 188,
  "userId": 5,
  "inputType": "text",
  "inputContent": "বাংলাদেশে এক বছরে...",
  "totalScore": 28,
  "verdict": "SUSPICIOUS",
  "textScore": 50,
  "domainScore": null,
  "headlineScore": null,
  "createdAt": "2026-04-22T01:54:00Z",
  "details": {
    "articleText": "...",
    "category": "ECONOMY",
    "mainClaim": "Poverty rate in Bangladesh decreased by 90% in one year",
    "webMatchResult": "UNKNOWN",
    "contradictionFound": false,
    "nliVerdict": "NEUTRAL",
    "groqExplanation": "The claim could not be confirmed by web sources...",
    "pipelineSucceeded": true
  }
}
```

---

## ⚠️ Error Handling

| Scenario | What Happens |
|---|---|
| No token / expired token | `authMiddleware` returns HTTP 401; frontend shows "Login Required" or "Session Expired" card |
| Text too short / too long | Backend Step 0A returns HTTP 400; frontend shows yellow error card, auto-dismisses after 8 seconds |
| Pipeline partially fails | Falls back to `score=50`, `verdict=SUSPICIOUS`; saves to DB with `pipelineSucceeded: false` |
| Server unreachable | `fetch()` network error caught; frontend shows red "Connection Failed" card and re-enables the button |

---

## 🏆 Verdict System

| Score Range | Verdict | Meaning |
|---|---|---|
| 75 – 100 | ✅ **REAL** | High credibility, well-supported by evidence |
| 50 – 74 | 🟡 **LIKELY REAL** | Probably credible, minor concerns |
| 25 – 49 | 🟠 **SUSPICIOUS** | Low credibility, significant red flags |
| 0 – 24 | 🔴 **FAKE** | Very likely misinformation |

---

## 🌐 Microservice Ports

| Service | Port | Purpose |
|---|---|---|
| Node.js Backend | `5000` | Main API + static file serving |
| Python Microservice | `8001` | URL scraping + AI emotion analysis |

---

## 📄 License

This project is for educational and research purposes. See `LICENSE` for details.

---

<div align="center">

**TruthGuard V14.0** · Built for Bangladesh · April 2026

*Helping people distinguish fact from fiction, one article at a time.*

</div>
