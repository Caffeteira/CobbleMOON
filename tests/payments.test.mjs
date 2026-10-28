import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createHmac} from 'node:crypto';
import {Store} from '../worker/index.mjs';
import {defaultPaymentConfig} from '../worker/payment-config.mjs';
import {paymentSettings,checkoutParameters,validCheckoutUrl} from '../worker/payments.mjs';
const product={id:'diamond',name:'Diamante',category:'extras',price:3.5,image:'',color:'#abcdef',commands:['give {player} minecraft:diamond 1'],benefits:[],enabled:true,draft:false};
const env={ADMIN_TOKEN:'a'.repeat(40),BRIDGE_TOKEN:'b'.repeat(40),STRIPE_SECRET_KEY:'rk_live_fixture',STRIPE_WEBHOOK_SECRET:'whsec_fixture',PAYMENTS_ENABLED:'true'};
function setup(overrides={}){
 const db=new DatabaseSync(':memory:');const storage={sql:{exec(q,...p){const st=db.prepare(q);if(q.startsWith('SELECT'))return {toArray:()=>st.all(...p)};st.run(...p);return {toArray:()=>[]};}},transactionSync(fn){db.exec('BEGIN IMMEDIATE');try{const r=fn();db.exec('COMMIT');return r;}catch(e){db.exec('ROLLBACK');throw e;}}};
 const runtime={...env,...overrides},store=new Store({storage},runtime);const config=store.get('config','main');config.products=[structuredClone(product)];store.put('config','main',config);
 const preferences=defaultPaymentConfig();preferences.card={requested:true,configurationId:'pmc_cardFixture'};store.put('payment-config','main',preferences);
 const sessions=new Map();let calls=0;
 store.stripe=()=>({checkout:{sessions:{async create(params){calls++;const session={...params,id:'cs_'+params.client_reference_id,url:'https://checkout.stripe.com/c/pay/'+params.client_reference_id,livemode:/_live_/.test(runtime.STRIPE_SECRET_KEY),amount_total:params.line_items.reduce((n,l)=>n+l.quantity*l.price_data.unit_amount,0),currency:'brl',payment_status:'unpaid',status:'open',payment_intent:'pi_'+params.client_reference_id};sessions.set(session.id,session);return session;},async retrieve(key){if(!sessions.has(key))throw Error('Not found');return sessions.get(key);}}}});
 async function request(path,method='GET',payload,token){const r=await store.fetch(new Request('https://cobblemoon.shop/api/'+path,{method,headers:{...(token?{Authorization:'Bearer '+token}:{}),'Content-Type':'application/json'},body:payload?JSON.stringify(payload):undefined}));return {status:r.status,body:await r.json()};}
 async function webhook(type,session,options={}){const event={id:options.id||crypto.randomUUID(),type,livemode:options.livemode??session.livemode,data:{object:session}};const raw=JSON.stringify(event),t=options.timestamp??Math.floor(Date.now()/1000),sig=createHmac('sha256',runtime.STRIPE_WEBHOOK_SECRET).update(t+'.'+raw).digest('hex');const r=await store.fetch(new Request('https://cobblemoon.shop/api/webhooks/stripe',{method:'POST',headers:{'Stripe-Signature':`t=${t},v1=${options.invalid?'0'.repeat(64):sig}`},body:raw}));return {status:r.status,body:await r.json()};}
 async function checkout(test=false){const input={attemptId:crypto.randomUUID(),nick:'MoonPlayer',discord:'moon.player',paymentMethod:'stripe',items:[{id:product.id,quantity:2}],paid:true,total:.01};const response=await request(test?'admin/test-checkout':'checkout','POST',input,test?env.ADMIN_TOKEN:undefined);assert.ok([200,201].includes(response.status),JSON.stringify(response));const order=store.get('order',response.body.orderId);return {order,session:sessions.get(order.stripeSessionId),input,response};}
 return {store,request,webhook,checkout,sessions,get calls(){return calls;}};
}
test('activation fails closed, authoritative price, retry reuses session, order privacy',async()=>{
 assert.equal(paymentSettings({...env,PAYMENTS_ENABLED:'false'}).enabled,false);assert.equal(paymentSettings({...env,BRIDGE_TOKEN:env.ADMIN_TOKEN}).bridgeConfigured,false);assert.equal(paymentSettings({...env,BRIDGE_TOKEN:''}).enabled,true);assert.equal(paymentSettings({...env,STRIPE_SECRET_KEY:'rk_test_fixture'}).enabled,false);
 assert.equal(validCheckoutUrl('https://checkout.stripe.com.evil.test/x'),false);
 const f=setup(),{order,input,response}=await f.checkout();assert.equal(order.totalCents,700);assert.equal(f.store.list('job').length,0);
 const parameters=checkoutParameters(order);assert.equal(parameters.payment_method_types,undefined);assert.equal(parameters.adaptive_pricing.enabled,false);assert.match(parameters.integration_identifier,/^cobblemoon_[a-z]{8}$/);
 const repeat=await f.request('checkout','POST',input);assert.equal(repeat.body.url,response.body.url);assert.equal(f.calls,1);
 assert.equal((await f.request('checkout','POST',{...input,nick:'ChangedPlayer'})).status,409);
 assert.equal((await f.request('orders/'+order.id)).status,404);
 const publicOrder=await f.request('orders/'+order.id,'GET',null,order.accessToken);assert.equal(publicOrder.status,200);assert.equal(publicOrder.body.lines[0].commands,undefined);assert.equal(publicOrder.body.accessToken,undefined);
 const admin=await f.request('admin/state','GET',null,env.ADMIN_TOKEN);assert.equal(admin.body.orders[0].accessToken,undefined);
});
test('invalid, stale, wrong-mode and mismatched payments cannot deliver; retry after network error',async()=>{
 const f=setup(),{order,session}=await f.checkout();session.status='complete';session.payment_status='paid';
 assert.equal((await f.webhook('checkout.session.completed',session,{invalid:true})).status,400);
 assert.equal((await f.webhook('checkout.session.completed',session,{timestamp:1})).status,400);
 assert.equal((await f.webhook('checkout.session.completed',session,{livemode:false})).status,400);
 session.amount_total=1;assert.equal((await f.webhook('checkout.session.completed',session)).status,400);assert.equal(f.store.list('job').length,0);session.amount_total=700;
 const saved=f.sessions.get(session.id);f.sessions.delete(session.id);assert.equal((await f.webhook('checkout.session.completed',session)).status,503);f.sessions.set(session.id,saved);
 assert.equal((await f.webhook('checkout.session.completed',session)).status,200);assert.equal(f.store.get('order',order.id).paymentStatus,'approved');assert.equal(f.store.list('job').length,2);
});
test('unpaid completed waits; paid async enqueues snapshots once across duplicate events and old failures',async()=>{
 const f=setup(),{order,session}=await f.checkout();session.status='complete';assert.equal((await f.webhook('checkout.session.completed',session)).status,200);assert.equal(f.store.list('job').length,0);
 const config=f.store.get('config','main');config.products[0].commands=['say changed {player}'];f.store.put('config','main',config);
 session.payment_status='paid';const eventId=crypto.randomUUID();await Promise.all([f.webhook('checkout.session.async_payment_succeeded',session,{id:eventId}),f.webhook('checkout.session.async_payment_succeeded',session,{id:eventId})]);
 await f.webhook('checkout.session.completed',session);await f.webhook('checkout.session.async_payment_failed',session);assert.equal(f.store.list('job').length,2);assert.equal(f.store.list('job')[0].template,product.commands[0]);assert.equal(f.store.get('order',order.id).paymentStatus,'approved');
});
test('sandbox paid order never sends commands and production checkout stays disabled',async()=>{
 const f=setup({STRIPE_SECRET_KEY:'rk_test_fixture'});assert.equal((await f.request('checkout','POST',{})).status,503);assert.equal((await f.request('catalog')).body.checkoutEnabled,false);
 const {order,session}=await f.checkout(true);session.status='complete';session.payment_status='paid';await f.webhook('checkout.session.completed',session);
 assert.equal(f.store.list('job').length,0);assert.equal(f.store.get('order',order.id).status,'test_paid_no_delivery');
});
test('refund before paid holds delivery; refund after paid halts unsent commands and never regrants',async()=>{
 for(const before of [true,false]){const f=setup(),{order,session}=await f.checkout();session.status='complete';session.payment_status='paid';
  if(!before)await f.webhook('checkout.session.completed',session);
  await f.webhook('charge.refunded',{id:'ch_test',payment_intent:session.payment_intent,refunded:true,livemode:true});
  await f.webhook('checkout.session.async_payment_succeeded',session);
  assert.equal(f.store.get('order',order.id).paymentStatus,'refunded');assert.equal(f.store.get('order',order.id).status,'review');assert.equal(f.store.list('job').filter(j=>j.status==='queued').length,0);
 }
});

 test('legacy payment fields stay private; Stripe uses dynamic methods without configuration IDs',async()=>{
 const f=setup(),initial=defaultPaymentConfig();f.store.put('payment-config','main',initial);
 assert.equal((await f.request('catalog')).body.checkoutEnabled,true);
 assert.equal((await f.request('admin/payment-config','PUT',initial)).status,401);
 initial.pix.key='private-key@example.test';initial.paypal.email='merchant@example.test';initial.paypal.clientId='public-client';initial.paypal.requested=true;
 const saved=await f.request('admin/payment-config','PUT',initial,env.ADMIN_TOKEN);assert.equal(saved.status,200);
 assert.equal(saved.body.paymentConfig.version,2);assert.deepEqual(saved.body.paymentMethods.map(m=>[m.id,m.enabled]),[['stripe',true]]);
 assert.equal((await f.request('admin/payment-config','PUT',initial,env.ADMIN_TOKEN)).status,409);
 const catalog=await f.request('catalog');assert.equal(catalog.body.checkoutEnabled,true);assert.equal(JSON.stringify(catalog.body).includes('private-key'),false);assert.equal(JSON.stringify(catalog.body).includes('merchant@example'),false);
 const ready=saved.body.paymentConfig;ready.card={requested:true,configurationId:'pmc_cardFixture'};
 assert.equal((await f.request('admin/payment-config','PUT',ready,env.ADMIN_TOKEN)).status,200);
 const input={attemptId:crypto.randomUUID(),nick:'MoonPlayer',discord:'moon.player',paymentMethod:'paypal',items:[{id:product.id,quantity:1}]};
 assert.equal((await f.request('checkout','POST',input)).status,400);
 const response=await f.request('checkout','POST',{...input,paymentMethod:'stripe'});assert.equal(response.status,201);
 const order=f.store.get('order',response.body.orderId),session=f.sessions.get(order.stripeSessionId);
 assert.equal(order.discord,'moon.player');assert.equal(session.payment_method_configuration,undefined);assert.equal(session.payment_method_types,undefined);assert.match(session.success_url,/^https:\/\/cobblemoon.shop\//);
 });

test('confirmed payment flows through bridge delivery and duplicate webhook never executes again',async()=>{
 const f=setup(),{order,session}=await f.checkout();
 const poll={serverId:'moon-production',players:[{name:'MoonPlayer',uuid:'11111111-1111-4111-8111-111111111111'}]};
 const request=(path,b)=>f.request(path,'POST',b,env.BRIDGE_TOKEN);
 assert.equal((await request('bridge/poll',poll)).body.jobs.length,0);
 session.status='complete';session.payment_status='paid';
 assert.equal((await f.webhook('checkout.session.completed',session)).status,200);
 const jobs=(await request('bridge/poll',poll)).body.jobs;
 assert.equal(jobs.length,2);assert.equal(jobs[0].command,'give MoonPlayer minecraft:diamond 1');
 for(const job of jobs)assert.equal((await request('bridge/ack',{id:job.id,serverId:poll.serverId,status:'done',message:'Command succeeded'})).status,200);
 assert.equal(f.store.get('order',order.id).status,'delivered');
 await f.webhook('checkout.session.async_payment_succeeded',session);
 assert.equal((await request('bridge/poll',poll)).body.jobs.length,0);
 assert.equal(f.store.list('job').length,2);
});

test('payment approval works before connecting Minecraft and delivery stays queued',async()=>{
 const f=setup({BRIDGE_TOKEN:''}),{order,session}=await f.checkout();
 session.status='complete';session.payment_status='paid';
 assert.equal((await f.webhook('checkout.session.completed',session)).status,200);
 assert.equal(f.store.get('order',order.id).paymentStatus,'approved');
 assert.equal(f.store.get('order',order.id).status,'queued');
 assert.equal(f.store.list('job').length,2);
 assert.equal((await f.request('bridge/poll','POST',{serverId:'offline-test',players:[]})).status,401);
 assert.equal(f.store.list('job').every(j=>j.status==='queued'),true);
});

test('credentials trim outer whitespace and report only a safe category, never secret values',()=>{
 const configured=paymentSettings({...env,STRIPE_SECRET_KEY:' \nrk_live_fixture\r\n',STRIPE_WEBHOOK_SECRET:' whsec_fixture\n'});
 assert.equal(configured.enabled,true);assert.equal(configured.keyIssue,null);
 assert.equal(JSON.stringify(configured).includes('rk_live_fixture'),false);
 assert.equal(paymentSettings({...env,STRIPE_SECRET_KEY:'pk_live_fixture'}).keyIssue,'publishable');
 assert.equal(paymentSettings({...env,STRIPE_SECRET_KEY:''}).keyIssue,'missing');
 assert.equal(paymentSettings({...env,STRIPE_SECRET_KEY:'"rk_live_fixture"'}).keyIssue,'invalid_format');
 assert.equal(paymentSettings({...env,STRIPE_SECRET_KEY:'rk_live_bad key'}).enabled,false);
});
