const jwt = require('jsonwebtoken');
require('dotenv').config();

// Minting a 1-year token specifically for Rakib (User ID: 3)
const token = jwt.sign({ id: 3 }, process.env.JWT_SECRET, { expiresIn: '365d' });

console.log("\n🔑 YOUR 1-YEAR POSTMAN TOKEN (USER ID: 3) 🔑\n");
console.log(`Bearer ${token}\n`);