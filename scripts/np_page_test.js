const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');

const env = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
const key = env.split(/\r?\n/).find(line => line.startsWith('NP_API_KEY='));
if (!key) {
  console.error('No NP_API_KEY found'); process.exit(1);
}
const apiKey = key.split('=')[1].trim();

(async () => {
  for (const page of [1,2]) {
    const body = {
      apiKey,
      modelName: 'Address',
      calledMethod: 'searchSettlements',
      methodProperties: { CityName: 'Ки', Page: page }
    };
    const r = await fetch('https://api.novaposhta.ua/v2.0/json/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await r.json();
    console.log('page', page, JSON.stringify(data, null, 2).slice(0, 1600));
  }
})();
