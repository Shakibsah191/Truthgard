const express = require('express');
const cors = require('cors');
require('dotenv').config();
const path = require('path');

const sequelize = require('./config/db');
const authRoutes = require('./routes/authRoutes');
const analyzeRoutes = require('./routes/analyzeRoutes');

const app = express();

app.use(cors());
app.use(express.json());

/* ✅ SERVE FRONTEND FILES (THIS FIXES FAVICON) */
app.use(express.static(path.join(__dirname, '..')));

/* API ROUTES */
app.use('/api/auth', authRoutes);
app.use('/api/analyze', analyzeRoutes);

/* Optional: load index.html on root */
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'index.html'));
});

const PORT = process.env.PORT || 5000;

/* ⚠️ SAFE START (prevents crash) */
sequelize.sync({ force: false })
  .then(() => {
    console.log('Database connected & synced');
    app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
  })
  .catch(err => {
    console.error('DB connection failed:', err);
    
    /* 🔥 STILL RUN SERVER EVEN IF DB FAILS */
    app.listen(PORT, () => console.log(`Server running WITHOUT DB on port ${PORT}`));
  });