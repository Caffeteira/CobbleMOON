(async()=>{
 try{const r=await fetch('/api/catalog',{cache:'no-store',signal:AbortSignal.timeout(8000)});if(r.ok){const c=await r.json();window.COBBLEMOON={...window.COBBLEMOON,...c.site};window.STORE_PRODUCTS=c.products;window.CHECKOUT_ENABLED=c.checkoutEnabled;}}
 catch{window.CHECKOUT_ENABLED=false;}
 for(const src of ['./app.js','./store.js'])await new Promise((resolve,reject)=>{const s=document.createElement('script');s.src=src;s.onload=resolve;s.onerror=()=>reject(Error('Falha ao carregar '+src));document.body.append(s);});
})().catch(()=>{document.getElementById('app').textContent='Não foi possível carregar o site. Atualize a página.';});
