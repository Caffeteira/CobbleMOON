import {prepareVip} from './vip-preparation.mjs';
import {defaultPaymentConfig,validatePaymentConfig,publicPaymentMethods} from './payment-config.mjs';
import seed from './seed.json' with {type:'json'};
import {paymentSettings,stripeClient,verifiedEvent,checkoutParameters,validCheckoutUrl,PAYMENT_EVENTS,SITE_ORIGIN} from './payments.mjs';
const json=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status})};
const id=()=>crypto.randomUUID();
async function body(req){if(Number(req.headers.get('content-length'))>150000)fail('Envio muito grande',413);const t=await req.text();if(t.length>150000)fail('Envio muito grande',413);try{return JSON.parse(t)}catch{fail('JSON inválido')}}
async function authorized(req,secret){if(!secret||secret.length<32)return false;const token=req.headers.get('Authorization')||'';const a=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token)));const b=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode('Bearer '+secret)));let d=0;for(let i=0;i<a.length;i++)d|=a[i]^b[i];return d===0;}
function safeUrl(s){return typeof s==='string'&&!/["'<>`]/.test(s)&&(s===''||/^https:\/\/[^\s]+$/.test(s)||/^\.\/assets\/[a-zA-Z0-9_./-]+$/.test(s))}
export function validateProduct(p){if(!p||['__proto__','constructor','prototype'].includes(p.id)||!/^[-a-z0-9_]{1,60}$/.test(p.id))fail('Identificador inválido');if(typeof p.name!=='string'||p.name.length<1||p.name.length>80)fail('Nome inválido');if(!['vips','cosmeticos','baus','chaves','moedas','extras'].includes(p.category))fail('Categoria inválida');if(p.price!==null&&(!Number.isFinite(p.price)||p.price<0.01||p.price>50000||Math.abs(p.price*100-Math.round(p.price*100))>0.00001))fail('Preço deve ter até duas casas decimais');if(!Array.isArray(p.commands)||p.commands.length>20||p.commands.some(c=>typeof c!=='string'||!c.trim()||c.length>500||/[\r\n\0]/.test(c)||!c.includes('{player}')&&!c.includes('{uuid}')||/\{(?!player\}|uuid\})/.test(c)))fail('Use até 20 comandos, um por linha, com {player} ou {uuid}');if(!safeUrl(p.image||''))fail('Imagem deve usar HTTPS ou ./assets/');if(!/^#[a-fA-F0-9]{6}$/.test(p.color||''))fail('Cor inválida');if(!Array.isArray(p.benefits)||p.benefits.length>40||p.benefits.some(b=>typeof b!=='string'||b.length>200))fail('Benefícios inválidos');if(String(p.description||'').length>3000||String(p.duration||'').length>100)fail('Descrição muito longa');return {id:p.id,name:p.name,category:p.category,image:p.image||'',color:p.color,price:p.price,commands:p.commands.map(c=>c.replace(/^\//,'').trim()),benefits:p.benefits,description:p.description||'',duration:p.duration||'',enabled:!!p.enabled,draft:!!p.draft,icon:p.icon||'gift'};}
export function snapshotOrder(products,input){if(!/^[A-Za-z0-9_]{3,16}$/.test(input.nick||''))fail('Nick inválido');if(!Array.isArray(input.items)||!input.items.length||input.items.length>30)fail('Sacola inválida');const seen=new Set();let cents=0;const lines=input.items.map(x=>{const p=products.find(p=>p.id===x.id);if(seen.has(x.id))fail('Produto repetido');seen.add(x.id);if(!p||!p.enabled||p.draft||!Number.isFinite(p.price)||p.price<.01||!p.commands.length)fail('Produto indisponível');if(!Number.isInteger(x.quantity)||x.quantity<1||x.quantity>99||(p.category==='vips'&&x.quantity!==1))fail('Quantidade inválida');cents+=Math.round(p.price*100)*x.quantity;return {id:p.id,name:p.name,quantity:x.quantity,unitCents:Math.round(p.price*100),commands:[...p.commands]};});if(lines.reduce((n,l)=>n+l.commands.length*l.quantity,0)>200)fail('Pedido excede o limite de comandos');if(cents>5000000)fail('Pedido excede o limite');return {id:id(),nick:input.nick,lines,totalCents:cents,currency:'BRL',createdAt:new Date().toISOString()};}
export class Store {
 constructor(state,env){this.state=state;this.env=env;this.sql=state.storage.sql;this.sql.exec('CREATE TABLE IF NOT EXISTS records (kind TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(kind,id))');if(!this.get('config','main'))this.put('config','main',structuredClone(seed));this.state.storage.transactionSync(()=>{if(!this.get('migration','vip-30d-once-v1')){const next=prepareVip(this.get('config','main'));if(next){this.put('config','main',next);this.audit('vip.prepared',{version:next.version,price:29.9,duration:'30 dias',draft:true});}this.put('migration','vip-30d-once-v1',{appliedAt:new Date().toISOString()});}});}
 get(kind,key){const r=this.sql.exec('SELECT data FROM records WHERE kind=? AND id=?',kind,key).toArray()[0];return r?JSON.parse(r.data):null;}
 put(kind,key,value){this.sql.exec('INSERT INTO records(kind,id,data) VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET data=excluded.data',kind,key,JSON.stringify(value));}
 list(kind){return this.sql.exec('SELECT data FROM records WHERE kind=? ORDER BY rowid DESC LIMIT 500',kind).toArray().map(r=>JSON.parse(r.data));}
 audit(action,detail){const key=id();this.put('audit',key,{id:key,at:new Date().toISOString(),action,detail});}
 paymentConfig(){return this.get('payment-config','main')||defaultPaymentConfig();}
 methods(){return publicPaymentMethods(this.paymentConfig(),paymentSettings(this.env).enabled);}
 stripe(){return stripeClient(this.env);}
 enqueue(order){for(const line of order.lines)for(let q=0;q<line.quantity;q++)for(const command of line.commands){const key=id();this.put('job',key,{id:key,orderId:order.id,nick:order.nick,template:command,status:'queued',test:order.test,createdAt:order.createdAt});}}
 async checkout(req,test=false){
  const settings=paymentSettings(this.env);
  if(test ? !settings.keyConfigured||!settings.webhookConfigured||settings.mode!=='test' : !settings.enabled)fail(test?'Configure chaves de teste e o webhook de teste.':'Pagamentos ainda não foram ativados. Nenhuma cobrança foi criada.',503);
  const origin=req.headers.get('Origin');if(origin&&origin!==new URL(req.url).origin)fail('Origem não autorizada',403);
  const input=await body(req);
  if(!test){const methods=this.methods().filter(m=>m.enabled);if(!methods.length)fail('Os pagamentos ainda não foram configurados. Nenhuma cobrança foi criada.',503);if(!methods.some(m=>m.id===input.paymentMethod))fail('Forma de pagamento indisponível.',400);}
  const discord=typeof input.discord==='string'?input.discord.trim():'';if(!test&&!discord)fail('Informe seu usuário do Discord');if(input.discord!==undefined&&(!discord||discord.length>80||/[\u0000-\u001f<>]/.test(discord)))fail('Discord inválido');
  if(!/^[a-f0-9-]{36}$/.test(input.attemptId||''))fail('Identificador de tentativa inválido');
  const snapshot=snapshotOrder(this.get('config','main').products,input);if(snapshot.totalCents<50)fail('O pedido mínimo é R$ 0,50');
  const fingerprint=JSON.stringify({nick:input.nick,items:input.items.map(x=>({id:x.id,quantity:x.quantity})),discord,paymentMethod:input.paymentMethod||'',test});
  const order=this.state.storage.transactionSync(()=>{
   const attempt=this.get('attempt',input.attemptId);
   if(attempt){if(attempt.fingerprint!==fingerprint)fail('A sacola mudou. Inicie uma nova tentativa.',409);return this.get('order',attempt.orderId);}
   const ip=req.headers.get('CF-Connecting-IP')||'unknown',rate=this.get('checkout-rate',ip);if(rate?.until>Date.now()&&rate.count>=20)fail('Muitas tentativas. Aguarde alguns minutos.',429);
   this.put('checkout-rate',ip,{count:rate?.until>Date.now()?rate.count+1:1,until:rate?.until>Date.now()?rate.until:Date.now()+600000});
   const letters=Array.from(crypto.getRandomValues(new Uint8Array(8)),n=>String.fromCharCode(97+n%26)).join('');
   const o={...snapshot,discord,paymentMethod:input.paymentMethod||'',origin:new URL(req.url).origin,test,status:'creating_payment',paymentStatus:'pending',accessToken:id()+id(),expiresAt:Math.floor(Date.now()/1000)+3600,integrationIdentifier:'cobblemoon_'+letters};
   this.put('order',o.id,o);this.put('attempt',input.attemptId,{orderId:o.id,fingerprint});this.audit('checkout.created',{id:o.id,test});return o;
  });
  if(order.paymentStatus==='approved')return json({orderId:order.id,status:'paid',statusPath:'/#/pedido/'+order.id+'/'+order.accessToken});
  if(order.expiresAt<=Math.floor(Date.now()/1000)+30)fail('Tentativa expirada. Atualize a página e tente novamente.',409);
  if(order.checkoutUrl)return json({orderId:order.id,url:order.checkoutUrl,statusPath:'/#/pedido/'+order.id+'/'+order.accessToken});
  let session;try{session=await this.stripe().checkout.sessions.create(checkoutParameters(order),{idempotencyKey:'cobblemoon-'+order.id});}catch{this.audit('checkout.error',{id:order.id});fail('Não foi possível criar o pagamento. Confira a Stripe no painel e tente novamente.',502);}
  if(!validCheckoutUrl(session.url)||session.livemode===test)fail('Resposta de pagamento incompatível',502);
  this.state.storage.transactionSync(()=>{const current=this.get('order',order.id);current.stripeSessionId=session.id;current.checkoutUrl=session.url;if(current.paymentStatus==='pending')current.status='awaiting_payment';this.put('order',current.id,current);});
  return json({orderId:order.id,url:session.url,statusPath:'/#/pedido/'+order.id+'/'+order.accessToken},201);
 }
 async stripeWebhook(req){
  const settings=paymentSettings(this.env);if(!settings.keyConfigured||!settings.webhookConfigured)fail('Stripe ainda não configurada',503);
  const event=await verifiedEvent(req,this.env);if(event.livemode!==(settings.mode==='live'))fail('Ambiente de pagamento incompatível',400);
  if(!PAYMENT_EVENTS.includes(event.type)||this.get('stripe-event',event.id))return json({received:true});
  const object=event.data?.object;
  if(event.type.startsWith('checkout.session.')){
   const orderId=object?.metadata?.order_id,original=this.get('order',orderId||'');
   if(!original)return json({received:true,ignored:true});
   if(!original.stripeSessionId)fail('Pedido aguardando associação ao pagamento',503);
   if(original.stripeSessionId!==object.id)fail('Sessão não corresponde ao pedido',400);
   let session;try{session=await this.stripe().checkout.sessions.retrieve(original.stripeSessionId);}catch{fail('Não foi possível confirmar o pagamento na Stripe',503);}
   if(session.mode!=='payment'||session.client_reference_id!==original.id||session.metadata?.order_id!==original.id||session.metadata?.store!=='cobblemoon'||session.currency!=='brl'||session.amount_total!==original.totalCents||session.livemode!==!original.test)fail('Pagamento divergente do pedido',400);
   this.state.storage.transactionSync(()=>{
    if(this.get('stripe-event',event.id))return;
    const order=this.get('order',original.id);
    if(session.payment_status==='paid'&&session.status==='complete'&&!order.fulfilledAt){
     const pi=typeof session.payment_intent==='string'?session.payment_intent:session.payment_intent?.id;if(!pi)fail('Pagamento sem identificação',400);
     const owner=this.get('stripe-payment',pi);if(owner&&owner.orderId!==order.id)fail('Pagamento já utilizado',409);
     this.put('stripe-payment',pi,{orderId:order.id});order.stripePaymentIntentId=pi;
     const hold=this.get('stripe-hold',pi);
     order.paymentStatus=hold?hold.status:'approved';order.paidAt=new Date().toISOString();order.fulfilledAt=order.paidAt;
     order.status=hold?'review':order.test?'test_paid_no_delivery':'queued';
     // Sandbox payments never execute commands on the production server.
     if(!order.test&&!hold)this.enqueue(order);
     this.audit('payment.approved',{id:order.id,test:order.test,sessionId:session.id});
    }else if(order.paymentStatus!=='approved'&&!order.fulfilledAt){
     if(session.status==='expired'){order.paymentStatus='expired';order.status='expired';}
     else if(event.type==='checkout.session.async_payment_failed'&&session.payment_status==='unpaid'){order.paymentStatus='failed';order.status='payment_failed';}
    }
    this.put('order',order.id,order);this.put('stripe-event',event.id,{at:new Date().toISOString(),type:event.type});
   });
  }else{
   const pi=typeof object?.payment_intent==='string'?object.payment_intent:object?.payment_intent?.id;
   if(pi)this.put('stripe-hold',pi,{status:event.type==='charge.refunded'?(object.refunded?'refunded':'partially_refunded'):'disputed'});
   const mapped=pi&&this.get('stripe-payment',pi);
   if(mapped)this.state.storage.transactionSync(()=>{
    if(this.get('stripe-event',event.id))return;
    const order=this.get('order',mapped.orderId);order.paymentStatus=event.type==='charge.refunded'?(object.refunded?'refunded':'partially_refunded'):'disputed';order.status='review';
    // Stop unsent jobs; assigned commands may already have executed, so never replay or revoke automatically.
    const jobs=this.sql.exec("SELECT data FROM records WHERE kind='job' AND json_extract(data,'$.orderId')=?",order.id).toArray().map(r=>JSON.parse(r.data));
    for(const job of jobs)if(['queued','assigned'].includes(job.status)){job.status='review';job.result='Pagamento estornado ou contestado. Revisão necessária.';this.put('job',job.id,job);}
    this.put('order',order.id,order);this.audit('payment.review',{id:order.id,event:event.type});this.put('stripe-event',event.id,{at:new Date().toISOString(),type:event.type});
   });
  }
  this.put('payments','webhook',{lastVerifiedAt:new Date().toISOString()});return json({received:true});
 }
 async fetch(req){try{return await this.route(req)}catch(e){if(!e.status)console.error('Store error',e.message);return json({error:e.status?e.message:'Erro interno. Tente novamente.'},e.status||500)}}
 async route(req){const u=new URL(req.url),path=u.pathname,method=req.method,config=this.get('config','main');
 if(path==='/api/catalog'&&method==='GET')return json({site:config.site,products:config.products.filter(p=>p.enabled).map(({commands,enabled,...p})=>({...p,draft:p.draft||!Number.isFinite(p.price)||!commands.length})),checkoutEnabled:this.methods().some(m=>m.enabled),paymentMethods:this.methods(),paymentProvider:'stripe'});
 if(path==='/api/checkout'&&method==='POST')return this.checkout(req);
 if(path==='/api/webhooks/stripe'&&method==='POST')return this.stripeWebhook(req);
 if(path.startsWith('/api/orders/')&&method==='GET'){const key=path.slice('/api/orders/'.length);const o=this.get('order',key);if(!o||!await authorized(req,o.accessToken))fail('Pedido não encontrado',404);return json({id:o.id,nick:o.nick,totalCents:o.totalCents,status:o.status,paymentStatus:o.paymentStatus,test:!!o.test,lines:o.lines.map(({name,quantity})=>({name,quantity})),checkoutUrl:o.paymentStatus==='pending'&&o.expiresAt>Date.now()/1000?o.checkoutUrl:null});}
 if(path.startsWith('/api/webhooks/'))return json({error:'Provedor de pagamento ainda não configurado'},503);
 if(path.startsWith('/api/admin/')){
  if(!this.env.ADMIN_TOKEN||this.env.ADMIN_TOKEN.length<32)return json({error:'Painel aguardando ativação: configure o segredo ADMIN_TOKEN na Cloudflare (mínimo de 32 caracteres).'},503);
  const origin=req.headers.get('Origin');if(origin&&origin!==u.origin)fail('Origem não autorizada',403);
  const ip=req.headers.get('CF-Connecting-IP')||'unknown';const rate=this.get('auth',ip);if(rate&&rate.until>Date.now()&&rate.count>=10)fail('Muitas tentativas. Aguarde 15 minutos.',429);
  if(!await authorized(req,this.env.ADMIN_TOKEN)){this.put('auth',ip,{count:rate?.until>Date.now()?rate.count+1:1,until:rate?.until>Date.now()?rate.until:Date.now()+900000});fail('Chave administrativa inválida',401)}
  if(path==='/api/admin/state'&&method==='GET')return json({config,orders:this.list('order').map(({accessToken,checkoutUrl,...o})=>o),jobs:this.list('job'),audit:this.list('audit'),server:this.get('server','main'),paymentConfig:this.paymentConfig(),paymentMethods:this.methods(),payments:{...paymentSettings(this.env),...this.get('payments','webhook'),webhookUrl:SITE_ORIGIN+'/api/webhooks/stripe'},bridgeConfigured:!!this.env.BRIDGE_TOKEN&&this.env.BRIDGE_TOKEN.length>=32});
  if(path==='/api/admin/payment-config'&&method==='PUT'){const input=await body(req);return this.state.storage.transactionSync(()=>{const next=validatePaymentConfig(input,this.paymentConfig().version);this.put('payment-config','main',next);this.audit('payment-config.updated',{version:next.version});return json({paymentConfig:next,paymentMethods:this.methods()});});}
  if(path==='/api/admin/test-checkout'&&method==='POST')return this.checkout(req,true);
  if(path==='/api/admin/config'&&method==='PUT'){const input=await body(req);return this.state.storage.transactionSync(()=>{const now=this.get('config','main');if(input.version!==now.version)fail('Outra edição foi salva. Atualize antes de salvar.',409);if(!Array.isArray(input.products)||input.products.length>200)fail('Catálogo inválido');const products=input.products.map(validateProduct);if(new Set(products.map(p=>p.id)).size!==products.length)fail('Identificadores repetidos');const site={};for(const key of ['serverIp','discord','shop','modpack','minecraft','cobblemon','homeTitle','homeSubtitle']){const v=input.site?.[key]||'';if(typeof v!=='string'||v.length>1000)fail('Configuração inválida');if(['discord','shop','modpack'].includes(key)&&!safeUrl(v))fail('Links devem usar HTTPS');site[key]=v;}const next={site,products,version:now.version+1};this.put('config','main',next);this.audit('config.updated',{version:next.version});return json({config:next});});}
  if(path==='/api/admin/test-order'&&method==='POST'){const input=await body(req);if(input.confirm!=='EXECUTAR TESTE NO SERVIDOR')fail('Confirme o teste explicitamente');if(!this.env.BRIDGE_TOKEN||this.env.BRIDGE_TOKEN.length<32)fail('Configure o BRIDGE_TOKEN primeiro');const server=this.get('server','main');if(!server||Date.now()-server.seenAt>120000)fail('O conector do servidor está desconectado');return this.state.storage.transactionSync(()=>{const current=this.get('config','main');const order={...snapshotOrder(current.products,input),test:true,status:'test_queued'};this.put('order',order.id,order);this.enqueue(order);this.audit('test.created',{id:order.id,nick:order.nick});return json({order},201)});}
  if(path==='/api/admin/export'&&method==='GET')return json({config,orders:this.list('order').map(({accessToken,checkoutUrl,...o})=>o),jobs:this.list('job'),audit:this.list('audit'),exportedAt:new Date().toISOString()});
  fail('Rota administrativa não encontrada',404);
 }
 if(path.startsWith('/api/bridge/')){
  if(this.env.BRIDGE_TOKEN===this.env.ADMIN_TOKEN)fail('Use chaves diferentes para administrador e conector',503);if(!await authorized(req,this.env.BRIDGE_TOKEN))fail('Conector não autorizado',401);
  if(path==='/api/bridge/poll'&&method==='POST'){const b=await body(req);if(!Array.isArray(b.players)||b.players.length>1000||b.players.some(p=>!/^\w{3,16}$/.test(p.name)||!/^[-a-fA-F0-9]{36}$/.test(p.uuid)))fail('Jogadores inválidos');if(!/^[-a-zA-Z0-9_]{3,80}$/.test(b.serverId||''))fail('Identificador de servidor inválido');return this.state.storage.transactionSync(()=>{const previous=this.get('server','main');if(previous&&previous.serverId!==b.serverId)fail('Outro servidor já está vinculado; mantenha o serverId original.',409);this.put('server','main',{serverId:b.serverId,seenAt:Date.now(),onlinePlayers:b.players.length});const jobs=[];const candidates=this.sql.exec("SELECT data FROM records WHERE kind='job' AND json_extract(data,'$.status') IN ('queued','assigned') AND lower(json_extract(data,'$.nick')) IN (SELECT value FROM json_each(?)) ORDER BY rowid LIMIT 20",JSON.stringify(b.players.map(p=>p.name.toLowerCase()))).toArray().map(r=>JSON.parse(r.data));for(const j of candidates){if(j.status!=='queued'&&!(j.status==='assigned'&&j.serverId===b.serverId))continue;const player=b.players.find(p=>p.name.toLowerCase()===j.nick.toLowerCase());if(!player)continue;if(j.uuid&&j.uuid!==player.uuid)continue;if(j.status==='queued'){j.uuid=player.uuid;j.player=player.name;j.command=j.template.replaceAll('{player}',player.name).replaceAll('{uuid}',player.uuid);j.serverId=b.serverId;j.status='assigned';this.put('job',j.id,j);}jobs.push({id:j.id,orderId:j.orderId,player:j.player,uuid:j.uuid,command:j.command,test:j.test});if(jobs.length===20)break;}return json({jobs});});}
  if(path==='/api/bridge/ack'&&method==='POST'){const b=await body(req);if(!['done','review'].includes(b.status))fail('Resultado inválido');return this.state.storage.transactionSync(()=>{const j=this.get('job',b.id);if(!j||j.serverId!==b.serverId)fail('Entrega não encontrada',404);if(['done','review'].includes(j.status))return json({ok:true,status:j.status});if(j.status!=='assigned')fail('Entrega não atribuída',409);j.status=b.status;j.result=String(b.message||'').slice(0,500);j.completedAt=new Date().toISOString();this.put('job',j.id,j);const o=this.get('order',j.orderId);const siblings=this.sql.exec("SELECT data FROM records WHERE kind='job' AND json_extract(data,'$.orderId')=?",j.orderId).toArray().map(r=>JSON.parse(r.data));o.status=['refunded','partially_refunded','disputed'].includes(o.paymentStatus)||siblings.some(x=>x.status==='review')?'review':siblings.every(x=>x.status==='done')?'delivered':'delivering';this.put('order',o.id,o);this.audit('delivery.'+j.status,{id:j.id,orderId:j.orderId});return json({ok:true,status:j.status});});}
  fail('Rota não encontrada',404);
 }
 fail('Rota não encontrada',404);
 }
}
export default {async fetch(req,env){const p=new URL(req.url).pathname;if(p.startsWith('/api/')){if(!env.STORE)return json({error:'Backend aguardando ativação'},503);return env.STORE.get(env.STORE.idFromName('cobblemoon-store-v1')).fetch(req);}return env.ASSETS.fetch(req);}};
