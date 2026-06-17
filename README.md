Proxy server for Nova Poshta / Ukrposhta

Steps to run locally:

1. Install dependencies:

```bash
npm install
```

2. Create `.env` based on `.env.example` and set `NP_API_KEY`.

3. Start the server:

```bash
npm start
```

4. The server exposes endpoints used by the order form:

- `GET /api/np/search?q=...` — search settlements (uses Nova Poshta `searchSettlements`)
- `GET /api/np/branches?cityRef=...` or `?cityName=...` — get warehouses for a city

Ukrposhta endpoints are placeholders — you can either:
- implement direct API calls in `server.js` if you have access to their API, or
- download and serve official dumps (JSON) and create `GET /api/ukr/search` and `GET /api/ukr/branches` routes to serve that data.

Downloading Ukrposhta dump:

- If you have a raw URL to a JSON dump (format: `{ "cities": [{"name":"Київ"}], "branches": {"Київ": ["..."] } }`), run:

```bash
node scripts/download_ukrpost_dump.js https://raw.githubusercontent.com/your/repo/path/ukrpost.json
```

- This will save `data/ukrpost.json` and the server will automatically serve `GET /api/ukr/search` and `GET /api/ukr/branches`.

Where to put Nova Poshta API key:

- Create a `.env` in project root (based on `.env.example`) and set `NP_API_KEY`.


Security notes:
- Never commit real API keys to the repository. Use `.env` and add it to `.gitignore`.
- Consider adding rate-limiting and persistent cache for production.
