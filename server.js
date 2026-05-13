// server.js — local dev entry point
require('dotenv').config();
const app = require('./app');

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Yunique checkout dev server → http://localhost:${PORT}`);
});
