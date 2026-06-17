const fetch = require('node-fetch');
(async()=>{
  try{
    const r = await fetch('http://localhost:3000/api/np/branches?cityRef=e718a680-4b33-11e4-ab6d-005056801329');
    const j = await r.json();
    console.log('count', Array.isArray(j)?j.length:typeof j);
    console.log(JSON.stringify(j, null, 2).slice(0,2000));
  }catch(e){console.error('ERROR', e.message);} 
})();
