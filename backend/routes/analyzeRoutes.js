const express = require('express');
const router = express.Router();

// ✅ Use the current controller (not the backup)
const { analyze, getHistory } = require('../controllers/analyzeController.js');

const { detectEmotion } = require('../controllers/emotionController');
const { extractClaims } = require('../controllers/claimsController');
const { protect } = require('../middleware/authMiddleware');

// CORE FEATURES
router.post('/', protect, analyze);
router.get('/history', protect, getHistory);

// INDEPENDENT FEATURES
router.post('/emotion', protect, detectEmotion);
router.post('/claims', protect, extractClaims);

module.exports = router;