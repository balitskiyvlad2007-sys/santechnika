const fetch = require('node-fetch');
(async()=>{
  try{
    const r = await fetch('http://localhost:3000/api/np/search?q=Київ');
    const j = await r.json();
    console.log(JSON.stringify(j, null, 2));
  }catch(e){console.error('ERROR', e.message);}
})();
