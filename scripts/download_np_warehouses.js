const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');

const envPath = path.join(__dirname, '..', '.env');
const envContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
const apiKeyLine = envContent.split(/\r?\n/).find(line => line.startsWith('NP_API_KEY='));
const apiKey = apiKeyLine ? apiKeyLine.split('=')[1].trim() : '';
if (!apiKey) {
  console.error('NP_API_KEY is missing from .env');
  process.exit(1);
}

const NP_API = 'https://api.novaposhta.ua/v2.0/json/';
const outDir = path.join(__dirname, '..', 'data');
const outFile = path.join(outDir, 'np_warehouses.json');

async function apiCall(body) {
  const res = await fetch(NP_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return res.json();
}

async function searchCities(query) {
  const body = {
    apiKey,
    modelName: 'Address',
    calledMethod: 'searchSettlements',
    methodProperties: { CityName: query }
  };
  const result = await apiCall(body);
  if (!result || !result.data) return [];
  const first = result.data[0];
  if (first && Array.isArray(first.Addresses)) {
    return first.Addresses.map(item => ({
      Description: item.Present || item.MainDescription || item.Description,
      Ref: item.Ref,
      DeliveryCity: item.DeliveryCity,
      WarehouseCount: item.Warehouses || 0
    }));
  }
  return result.data.map(item => ({
    Description: item.Description || item.Present || item.MainDescription,
    Ref: item.Ref,
    DeliveryCity: item.DeliveryCity,
    WarehouseCount: item.Warehouses || 0
  }));
}

async function getWarehouses(cityRef) {
  const body = {
    apiKey,
    modelName: 'AddressGeneral',
    calledMethod: 'getWarehouses',
    methodProperties: { CityRef: cityRef }
  };
  const result = await apiCall(body);
  if (!result || !result.data) return [];
  return result.data.map(item => ({
    Description: item.Description,
    Number: item.Number,
    Ref: item.Ref,
    CityRef: cityRef,
    ShortAddress: item.ShortAddress
  }));
}

(async () => {
  try {
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

    const query = 'Ки';
    console.log('Searching settlements for query:', query);
    const cities = await searchCities(query);
    if (!cities.length) {
      console.error('No cities returned from searchSettlements');
      process.exit(1);
    }

    const results = [];
    for (const city of cities) {
      const ref = city.DeliveryCity || city.Ref;
      if (!ref) continue;
      console.log('Fetching warehouses for', city.Description, ref);
      const branches = await getWarehouses(ref);
      results.push({ city, branches });
      console.log('  got', branches.length, 'branches');
      await new Promise(resolve => setTimeout(resolve, 300));
    }

    fs.writeFileSync(outFile, JSON.stringify({ generatedAt: new Date().toISOString(), data: results }, null, 2), 'utf8');
    console.log('Saved:', outFile);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
})();
