import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {Store} from '../worker/index.mjs';
import {MAX_BACKGROUND_BYTES} from '../worker/background.mjs';
const admin='a'.repeat(40);
const png=Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64'));
function setup(){const db=new DatabaseSync(':memory:');const storage={sql:{exec(query,...params){const statement=db.prepare(query);if(query.startsWith('SELECT'))return {toArray:()=>statement.all(...params)};statement.run(...params);return {toArray:()=>[]};}},transactionSync(fn){db.exec('BEGIN IMMEDIATE');try{const result=fn();db.exec('COMMIT');return result;}catch(error){db.exec('ROLLBACK');throw error;}}};const env={ADMIN_TOKEN:admin};let store=new Store({storage},env);async function request(path,{method='GET',body,token=admin,headers={}}={}){const binary=body instanceof Uint8Array;const response=await store.fetch(new Request('https://moon.test/api/'+path,{method,headers:{...(token?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':binary?'image/png':'application/json'}:{}),...headers},body:body?(binary?body:JSON.stringify(body)):undefined}));return {status:response.status,headers:response.headers,body:response.headers.get('Content-Type')?.includes('application/json')?await response.json():new Uint8Array(await response.arrayBuffer())};}return {request,restart(){store=new Store({storage},env);}};}
test('background upload requires admin, validates type and size, and rejects stale edits',async()=>{
 const {request}=setup();const upload=(body,headers={},token=admin)=>request('admin/background',{method:'POST',body,token,headers:{'X-Background-Version':'0',...headers}});
 assert.equal((await upload(png,{},null)).status,401);
 assert.equal((await upload(png,{Origin:'https://evil.test'})).status,403);
 assert.equal((await upload(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>'),{'Content-Type':'image/svg+xml'})).status,400);
 assert.equal((await upload(png,{'Content-Type':'image/jpeg'})).status,400);
 assert.equal((await upload(new Uint8Array(MAX_BACKGROUND_BYTES+1))).status,413);
 assert.equal((await request('admin/background',{method:'POST',body:png})).status,409);
 const saved=await upload(png);assert.equal(saved.status,200);assert.equal(saved.body.background.active,true);assert.equal(saved.body.background.version,1);
 assert.equal((await upload(png)).status,409);
});
test('background stays in draft until publication and preserves published bytes across metadata toggles',async()=>{
 const f=setup(),{background}=(await f.request('admin/background',{method:'POST',body:png,headers:{'X-Background-Version':'0'}})).body;
 f.restart();const publicCatalog=await f.request('catalog',{token:null});assert.equal(publicCatalog.body.site.backgroundImage,'');
 const draft=(await f.request('admin/state')).body.editor;const saved=(await f.request('admin/site-draft',{method:'PUT',body:{version:draft.version,section:'appearance',value:{...draft.appearance,backgroundImage:background.url}}})).body.draft;assert.equal((await f.request('catalog',{token:null})).body.site.backgroundImage,'');await f.request('admin/site-publish',{method:'POST',body:{version:saved.editor.version}});
 const image=await f.request(background.url.slice('/api/'.length),{token:null});assert.equal(image.status,200);assert.equal(image.headers.get('Content-Type'),'image/png');assert.equal(image.headers.get('X-Content-Type-Options'),'nosniff');assert.deepEqual(image.body,png);
 assert.equal((await f.request(background.url.slice('/api/'.length),{token:null,headers:{'If-None-Match':image.headers.get('ETag')}})).status,304);
 assert.equal((await f.request('site-background?v=old',{token:null})).status,404);
 const {config}=(await f.request('admin/state')).body;config.site.homeTitle='Novo título';assert.equal((await f.request('admin/config',{method:'PUT',body:config})).status,200);
 assert.equal((await f.request('catalog',{token:null})).body.site.backgroundImage,background.url);
 const disabled=await f.request('admin/background',{method:'PUT',body:{version:1,active:false}});assert.equal(disabled.body.background.version,2);
 assert.equal((await f.request('catalog',{token:null})).body.site.backgroundImage,background.url);
 assert.equal((await f.request('admin/background',{method:'PUT',body:{version:1,active:true}})).status,409);
 assert.equal((await f.request('admin/background',{method:'PUT',body:{version:2,active:true}})).status,200);
 assert.equal((await f.request('catalog',{token:null})).body.site.backgroundImage,background.url);
});
test('background storage handles multiple chunks and replacement gets a new cache URL',async()=>{
 const {request}=setup(),large=new Uint8Array(600000);large.set(png);
 const first=(await request('admin/background',{method:'POST',body:large,headers:{'X-Background-Version':'0'}})).body.background;
 assert.equal(first.chunks,4);assert.deepEqual((await request(first.url.slice('/api/'.length),{token:null})).body,large);
 const second=(await request('admin/background',{method:'POST',body:png,headers:{'X-Background-Version':'1'}})).body.background;
 assert.equal(second.version,2);assert.notEqual(second.url,first.url);assert.equal(second.chunks,1);
 assert.equal((await request(first.url.slice('/api/'.length),{token:null})).status,200);assert.deepEqual((await request(first.url.slice('/api/'.length),{token:null})).body,large);
 assert.deepEqual((await request(second.url.slice('/api/'.length),{token:null})).body,png);
});
