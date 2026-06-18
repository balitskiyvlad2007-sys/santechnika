require('dotenv').config();
const express = require('express');
const fetch = require('node-fetch');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

const NP_API = 'https://api.novaposhta.ua/v2.0/json/';

// Try to load local Ukrposhta dump if present
const fs = require('fs');
let ukrData = null;
const ukrPath = './data/ukrpost.json';
if (fs.existsSync(ukrPath)) {
  try {
    ukrData = JSON.parse(fs.readFileSync(ukrPath, 'utf8'));
    console.log('Loaded local Ukrposhta dump:', ukrPath);
  } catch (e) {
    console.warn('Failed to parse ukrpost.json:', e.message);
  }
}

// Simple in-memory cache
const cache = new Map();
function getCached(key) {
  const rec = cache.get(key);
  if (!rec) return null;
  if (Date.now() - rec.ts > (1000 * 60 * 60)) { // 1h ttl
    cache.delete(key);
    return null;
  }
  return rec.value;
}
function setCached(key, value) {
  cache.set(key, { ts: Date.now(), value });
}

app.get('/', (req, res) => res.send('Proxy for Nova Poshta / Ukrposhta'));

// Nova Poshta: search settlements
app.get('/api/np/search', async (req, res) => {
  const q = req.query.q || '';
  const cacheKey = `np:search:${q}`;
  const cached = getCached(cacheKey);
  if (cached) return res.json(cached);
  try {
    const body = {
      apiKey: process.env.NP_API_KEY || '',
      modelName: 'Address',
      calledMethod: 'searchSettlements',
      methodProperties: { CityName: q }
    };
    const r = await fetch(NP_API, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    const data = await r.json();
    console.log('NP search raw response for q=', q, JSON.stringify(data).slice(0,400));
    // Normalize to simple array of { Description, Ref }
    let items = [];
    if (data && data.data) {
      // Newer NP responses may nest results under data[0].Addresses
      const first = data.data[0];
      if (first && Array.isArray(first.Addresses)) {
        items = first.Addresses.map(s => ({ Description: s.Present || s.MainDescription || s.Description, Ref: s.Ref, DeliveryCity: s.DeliveryCity }));
      } else {
        items = data.data.map(s => ({ Description: s.Description || s.Present || s.MainDescription, Ref: s.Ref, DeliveryCity: s.DeliveryCity }));
      }
    }
    
    setCached(cacheKey, items);
    res.json(items);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Nova Poshta: get warehouses by cityRef or by city name (best-effort)
app.get('/api/np/branches', async (req, res) => {
  const cityRef = req.query.cityRef;
  const cityName = req.query.cityName;
  if (!cityRef && !cityName) return res.status(400).json({ error: 'Provide cityRef or cityName' });
  try {
    let ref = cityRef;
    if (!ref && cityName) {
      // try to resolve cityName -> Ref
      const searchRes = await fetch('http://localhost:3000/api/np/search?q=' + encodeURIComponent(cityName));
      const settlements = await searchRes.json();
      if (settlements && settlements.length) {
        const normalizedCity = cityName.trim().toLowerCase();
        const exactMatch = settlements.find(s => {
          const title = (s.Description || s.Present || s.MainDescription || '').toString().toLowerCase();
          return title === normalizedCity;
        });
        const candidates = exactMatch ? [exactMatch, ...settlements.filter(s => s !== exactMatch)] : settlements;

        for (const s of candidates) {
          const refs = [];
          if (s.Ref) refs.push(s.Ref);
          if (s.DeliveryCity && s.DeliveryCity !== s.Ref) refs.push(s.DeliveryCity);
          for (const candidate of refs) {
            if (!candidate) continue;
            try {
              const probeBody = {
                apiKey: process.env.NP_API_KEY || '',
                modelName: 'AddressGeneral',
                calledMethod: 'getWarehouses',
                methodProperties: { CityRef: candidate }
              };
              const probeRes = await fetch(NP_API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(probeBody) });
              const probeJson = await probeRes.json();
              const probeItems = (probeJson && probeJson.data) ? probeJson.data : [];
              if (Array.isArray(probeItems) && probeItems.length) {
                ref = candidate;
                break;
              }
            } catch (e) {
              // ignore probe errors and try next candidate
            }
          }
          if (ref) break;
        }
        // fallback to first candidate if none produced warehouses
        if (!ref) ref = settlements[0].Ref || settlements[0].DeliveryCity;
      }
    }
    if (!ref) return res.status(404).json({ error: 'City not found' });
    const cacheKey = `np:branches:${ref}`;
    const cached = getCached(cacheKey);
    if (cached) return res.json(cached);
    const body = {
      apiKey: process.env.NP_API_KEY || '',
      modelName: 'AddressGeneral',
      calledMethod: 'getWarehouses',
      methodProperties: { CityRef: ref }
    };
    const r = await fetch(NP_API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await r.json();
    console.log('NP getWarehouses raw for ref=', ref, JSON.stringify(data).slice(0,800));
    const items = (data && data.data) ? data.data.map(w => ({ Description: w.Description, Number: w.Number, Ref: w.Ref })) : [];
    setCached(cacheKey, items);
    res.json(items);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Ukrposhta endpoints - placeholder: many users prefer downloading official dumps
app.get('/api/ukr/search', (req, res) => {
  const q = (req.query.q || '').toLowerCase();
  if (ukrData && Array.isArray(ukrData.cities)) {
    const matches = ukrData.cities.filter(c => c.name.toLowerCase().includes(q)).slice(0, 50);
    return res.json(matches);
  }
  res.status(501).json({ error: 'Ukrposhta proxy not implemented. Place data/ukrpost.json with { cities, branches }.' });
});
app.get('/api/ukr/branches', (req, res) => {
  const city = req.query.city || req.query.cityName || '';
  if (ukrData && ukrData.branches) {
    const b = ukrData.branches[city] || ukrData.branches[city.toLowerCase()] || [];
    return res.json(b);
  }
  res.status(501).json({ error: 'Ukrposhta proxy not implemented. Place data/ukrpost.json with { cities, branches }.' });
});

// Announcements management
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const ANNOUNCEMENTS_FILE = './data/announcements.json';

function loadAnnouncements() {
  if (!fs.existsSync('./data')) fs.mkdirSync('./data', { recursive: true });
  if (fs.existsSync(ANNOUNCEMENTS_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(ANNOUNCEMENTS_FILE, 'utf8'));
    } catch (e) {
      console.warn('Failed to parse announcements:', e.message);
      return [];
    }
  }
  return [];
}

function saveAnnouncements(data) {
  if (!fs.existsSync('./data')) fs.mkdirSync('./data', { recursive: true });
  fs.writeFileSync(ANNOUNCEMENTS_FILE, JSON.stringify(data, null, 2));
}

// GET /api/announcements - get all announcements
app.get('/api/announcements', (req, res) => {
  const announcements = loadAnnouncements();
  res.json(announcements);
});

// POST /api/announcements - add announcement (requires password)
app.post('/api/announcements', (req, res) => {
  const { password, title, description, imageUrl } = req.body;
  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Invalid password' });
  }
  if (!title || !description) {
    return res.status(400).json({ error: 'Title and description are required' });
  }
  const announcements = loadAnnouncements();
  const newAnnouncement = {
        id: Date.now().toString(),
        title,
        description,
        imageUrl: imageUrl || '',
        price: price || 'Договірна', // <--- ВОТ ТУТ ЦЕНА ПРИНИМАЕТСЯ
        createdAt: new Date().toISOString()
    };
  announcements.push(newAnnouncement);
  saveAnnouncements(announcements);
  res.json({ success: true, announcement: newAnnouncement });
});

// DELETE /api/announcements/:id - delete announcement (requires password)
app.delete('/api/announcements/:id', (req, res) => {
  const { password } = req.body;
  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Invalid password' });
  }
  const announcements = loadAnnouncements();
  const filtered = announcements.filter(a => a.id !== req.params.id);
  if (filtered.length === announcements.length) {
    return res.status(404).json({ error: 'Announcement not found' });
  }
  saveAnnouncements(filtered);
  res.json({ success: true, message: 'Announcement deleted' });
});

// Order form — send to Telegram bot
app.post('/api/order', async (req, res) => {
  const { name, phone, delivery, city, branch, comment } = req.body;
  if (!name || !phone) {
    return res.status(400).json({ error: "Ім'я та телефон обов'язкові" });
  }

  const TG_TOKEN = process.env.TG_TOKEN;
  // TG_CHAT_IDS — через кому: 123456,789012,345678
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
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
app.listen(PORT, () => console.log('Proxy listening on', PORT));
