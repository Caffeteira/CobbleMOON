(async()=>{
 try{const r=await fetch('/api/catalog',{cache:'no-store',signal:AbortSignal.timeout(8000)});if(r.ok){const c=await r.json();window.COBBLEMOON={...window.COBBLEMOON,...c.site};window.STORE_PRODUCTS=c.products;window.CHECKOUT_ENABLED=c.checkoutEnabled;window.PAYMENT_METHODS=c.paymentMethods;}}
 catch{window.CHECKOUT_ENABLED=false;}
 try{const r=await fetch('/api/blog',{cache:'no-store',signal:AbortSignal.timeout(5000)});if(r.ok)window.BLOG_POSTS=(await r.json()).posts;}catch{window.BLOG_POSTS=[];}
 for(const src of ['./background.js','./guide.js','./blog.js','./app.js','./store.js'])await new Promise((resolve,reject)=>{const s=document.createElement('script');s.src=src;s.onload=resolve;s.onerror=()=>reject(Error('Falha ao carregar '+src));document.body.append(s);});
})().catch(()=>{document.getElementById('app').textContent='Não foi possível carregar o site. Atualize a página.';});
