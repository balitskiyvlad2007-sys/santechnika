const https = require('https');
const fs = require('fs');
const path = require('path');

// Usage: node scripts/download_ukrpost_dump.js <raw_url>
const url = process.argv[2];
if (!url) {
  console.error('Provide raw URL to ukrpost dump JSON.');
  process.exit(2);
}

const outDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, 'ukrpost.json');

console.log('Downloading', url);
https.get(url, res => {
  if (res.statusCode !== 200) {
    console.error('Failed to download, status', res.statusCode);
    process.exit(3);
  }
  const chunks = [];
  res.on('data', c => chunks.push(c));
  res.on('end', () => {
    const body = Buffer.concat(chunks).toString('utf8');
    try {
      JSON.parse(body); // validate
      fs.writeFileSync(outFile, body, 'utf8');
      console.log('Saved to', outFile);
    } catch (e) {
      console.error('Downloaded file is not valid JSON:', e.message);
      process.exit(4);
    }
  });
}).on('error', err => {
  console.error('Download error', err.message);
  process.exit(5);
});
