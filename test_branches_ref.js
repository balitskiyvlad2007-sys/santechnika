const fetch = require('node-fetch');
(async()=>{
  try{
    const url = 'http://localhost:3000/api/np/branches?cityRef=8d5a980d-391c-11dd-90d9-001a92567626';
    const r = await fetch(url);
    const j = await r.json();
    console.log('len', Array.isArray(j)?j.length:typeof j);
    console.log(JSON.stringify(j, null, 2).slice(0,3000));
  }catch(e){console.error('ERR', e.message)}
})();
