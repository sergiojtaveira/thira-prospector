const express = require('express');
const fetch = require('node-fetch');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

app.get('/search', async (req, res) => {
  const { q } = req.query;
  const key = process.env.SERPAPI_KEY;
  if (!q) return res.status(400).json({ error: 'Missing query' });
  if (!key) return res.status(500).json({ error: 'SerpApi key not configured' });
  try {
    const url = `https://serpapi.com/search.json?engine=google_maps&q=${encodeURIComponent(q)}&api_key=${key}&type=search&hl=en&gl=uk`;
    const response = await fetch(url);
    const data = await response.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => console.log(`Thira Prospector running on port ${PORT}`));
