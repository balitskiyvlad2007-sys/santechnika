require('dotenv').config();
const express = require('express');
const fetch = require('node-fetch');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { Pool } = require('pg');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// ---- POSTGRES ----
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

// Create table if not exists
(async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS announcements (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        image_url TEXT DEFAULT '',
        price TEXT DEFAULT '',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ
      )
    `);
    console.log('DB ready');
  } catch (e) {
    console.error('DB init error:', e.message);
  }
})();

// ---- NOVA POSHTA ----
const NP_API = 'https://api.novaposhta.ua/v2.0/json/';
let ukrData = null;
const ukrPath = './data/ukrpost.json';
if (fs.existsSync(ukrPath)) {
  try { ukrData = JSON.parse(fs.readFileSync(ukrPath, 'utf8')); } catch (e) {}
}

const cache = new Map();
function getCached(key) {
  const rec = cache.get(key);
  if (!rec) return null;
  if (Date.now() - rec.ts > 1000*60*60) { cache.delete(key); return null; }
  return rec.value;
}
function setCached(key, value) { cache.set(key, { ts: Date.now(), value }); }

app.get('/api/np/search', async (req, res) => {
  const q = req.query.q || '';
  const cacheKey = `np:search:${q}`;
  const cached = getCached(cacheKey);
  if (cached) return res.json(cached);
  try {
    const body = { apiKey: process.env.NP_API_KEY || '', modelName: 'Address', calledMethod: 'searchSettlements', methodProperties: { CityName: q } };
    const r = await fetch(NP_API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await r.json();
    let items = [];
    if (data?.data) {
      const first = data.data[0];
      if (first && Array.isArray(first.Addresses)) {
        items = first.Addresses.map(s => ({ Description: s.Present || s.MainDescription || s.Description, Ref: s.Ref, DeliveryCity: s.DeliveryCity }));
      } else {
        items = data.data.map(s => ({ Description: s.Description || s.Present || s.MainDescription, Ref: s.Ref, DeliveryCity: s.DeliveryCity }));
      }
    }
    setCached(cacheKey, items);
    res.json(items);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/np/branches', async (req, res) => {
  const cityRef = req.query.cityRef;
  const cityName = req.query.cityName;
  if (!cityRef && !cityName) return res.status(400).json({ error: 'Provide cityRef or cityName' });
  try {
    let ref = cityRef;
    if (!ref && cityName) {
      const searchRes = await fetch('http://localhost:3000/api/np/search?q=' + encodeURIComponent(cityName));
      const settlements = await searchRes.json();
      if (settlements?.length) {
        const norm = cityName.trim().toLowerCase();
        const exact = settlements.find(s => (s.Description||'').toLowerCase() === norm);
        const candidates = exact ? [exact, ...settlements.filter(s => s !== exact)] : settlements;
        for (const s of candidates) {
          const refs = [s.Ref, s.DeliveryCity !== s.Ref ? s.DeliveryCity : null].filter(Boolean);
          for (const candidate of refs) {
            try {
              const pb = { apiKey: process.env.NP_API_KEY || '', modelName: 'AddressGeneral', calledMethod: 'getWarehouses', methodProperties: { CityRef: candidate } };
              const pr = await fetch(NP_API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(pb) });
              const pj = await pr.json();
              if (Array.isArray(pj?.data) && pj.data.length) { ref = candidate; break; }
            } catch(e) {}
          }
          if (ref) break;
        }
        if (!ref) ref = settlements[0].Ref || settlements[0].DeliveryCity;
      }
    }
    if (!ref) return res.status(404).json({ error: 'City not found' });
    const cacheKey = `np:branches:${ref}`;
    const cached = getCached(cacheKey);
    if (cached) return res.json(cached);
    const body = { apiKey: process.env.NP_API_KEY || '', modelName: 'AddressGeneral', calledMethod: 'getWarehouses', methodProperties: { CityRef: ref } };
    const r = await fetch(NP_API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await r.json();
    const items = data?.data ? data.data.map(w => ({ Description: w.Description, Number: w.Number, Ref: w.Ref })) : [];
    setCached(cacheKey, items);
    res.json(items);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/ukr/search', (req, res) => {
  const q = (req.query.q || '').toLowerCase();
  if (ukrData?.cities) return res.json(ukrData.cities.filter(c => c.name.toLowerCase().includes(q)).slice(0, 50));
  res.status(501).json({ error: 'Ukrposhta not implemented.' });
});
app.get('/api/ukr/branches', (req, res) => {
  const city = req.query.city || req.query.cityName || '';
  if (ukrData?.branches) return res.json(ukrData.branches[city] || ukrData.branches[city.toLowerCase()] || []);
  res.status(501).json({ error: 'Ukrposhta not implemented.' });
});

// ---- ANNOUNCEMENTS (PostgreSQL) ----
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

function rowToObj(r) {
  return { id: r.id, title: r.title, description: r.description, imageUrl: r.image_url, price: r.price, createdAt: r.created_at, updatedAt: r.updated_at };
}

app.get('/api/announcements', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM announcements ORDER BY created_at ASC');
    res.json(result.rows.map(rowToObj));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/announcements', async (req, res) => {
  const { password, title, description, imageUrl, price } = req.body;
  if (password !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Invalid password' });
  if (!title || !description) return res.status(400).json({ error: 'Title and description are required' });
  try {
    const id = Date.now().toString();
    const result = await pool.query(
      'INSERT INTO announcements (id, title, description, image_url, price) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [id, title, description, imageUrl || '', price || '']
    );
    res.json({ success: true, announcement: rowToObj(result.rows[0]) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/announcements/:id', async (req, res) => {
  const { password, title, description, imageUrl, price } = req.body;
  if (password !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Invalid password' });
  if (!title || !description) return res.status(400).json({ error: 'Title and description are required' });
  try {
    const result = await pool.query(
      'UPDATE announcements SET title=$1, description=$2, image_url=$3, price=$4, updated_at=NOW() WHERE id=$5 RETURNING *',
      [title, description, imageUrl || '', price || '', req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true, announcement: rowToObj(result.rows[0]) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/announcements/:id', async (req, res) => {
  const { password } = req.body;
  if (password !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Invalid password' });
  try {
    const result = await pool.query('DELETE FROM announcements WHERE id=$1', [req.params.id]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---- ORDER ----
app.post('/api/order', async (req, res) => {
  const { name, phone, delivery, city, branch, comment } = req.body;
  if (!name || !phone) return res.status(400).json({ error: "Ім'я та телефон обов'язкові" });
  const TG_TOKEN = process.env.TG_TOKEN;
  const chatIds = (process.env.TG_CHAT_IDS || process.env.TG_CHAT_ID || '').split(',').map(s => s.trim()).filter(Boolean);
  const text = [
    '🛒 *Нове замовлення!*',
    `👤 *Ім'я:* ${name}`,
    `📞 *Телефон:* ${phone}`,
    `🚚 *Доставка:* ${delivery || '—'}`,
    `📍 *Місто:* ${city || '—'}`,
    `🏪 *Відділення:* ${branch || '—'}`,
    `💬 *Товар/Коментар:* ${comment || '—'}`,
  ].join('\n');
  try {
    await Promise.all(chatIds.map(chat_id =>
      fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id, text, parse_mode: 'Markdown' }),
      })
    ));
    res.json({ success: true });
  } catch (err) {
    console.error('Telegram error:', err.message);
    res.status(500).json({ error: 'Помилка відправки в Telegram' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Listening on', PORT));
