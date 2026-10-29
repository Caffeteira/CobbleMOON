import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {Store} from '../worker/index.mjs';
import {editorDefaults,validateSection} from '../worker/site-editor.mjs';
const token='a'.repeat(40),png=Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64'));
function setup(){const db=new DatabaseSync(':memory:');const storage={sql:{exec(q,...args){const st=db.prepare(q);if(q.startsWith('SELECT'))return {toArray:()=>st.all(...args)};st.run(...args);return {toArray:()=>[]};}},transactionSync(fn){db.exec('BEGIN IMMEDIATE');try{const result=fn();db.exec('COMMIT');return result;}catch(error){db.exec('ROLLBACK');throw error;}}};let store=new Store({storage},{ADMIN_TOKEN:token});async function req(path,method='GET',body,auth=token,headers={}){const binary=body instanceof Uint8Array;const response=await store.fetch(new Request('https://moon.test/api/'+path,{method,headers:{...(auth?{Authorization:'Bearer '+auth}:{}),'Content-Type':binary?'image/png':'application/json',...headers},body:body?(binary?body:JSON.stringify(body)):undefined}));return {status:response.status,body:response.headers.get('Content-Type')?.includes('application/json')?await response.json():new Uint8Array(await response.arrayBuffer())};}return {req,restart(){store=new Store({storage},{ADMIN_TOKEN:token});}};}
test('editor authorization, section revisions, persistence and catalog isolation',async()=>{
 const f=setup(),state=(await f.req('admin/state')).body,editor=state.editor;
 assert.equal((await f.req('admin/site-editor','PUT',{version:editor.version,section:'appearance',value:editor.appearance},null)).status,401);
 assert.equal((await f.req('admin/site-editor','PUT',{version:editor.version,section:'appearance',value:editor.appearance},token,{Origin:'https://evil.test'})).status,403);
 const saved=await f.req('admin/site-editor','PUT',{version:editor.version,section:'appearance',value:{...editor.appearance,backgroundOpacity:35,overlayOpacity:70,backgroundBlur:4}});assert.equal(saved.status,200);
 assert.equal(saved.body.editor.appearance.backgroundOpacity,35);assert.deepEqual(saved.body.editor.home,editor.home);
 assert.equal((await f.req('admin/site-editor','PUT',{version:editor.version,section:'home',value:editor.home})).status,409);
 const home={...editor.home,title:'Nova jornada',blocks:[...editor.home.blocks].reverse()};
 assert.equal((await f.req('admin/site-editor','PUT',{version:saved.body.editor.version,section:'home',value:home})).status,200);
 assert.equal((await f.req('admin/config','PUT',state.config)).status,200);f.restart();
 const pub=(await f.req('catalog','GET',null,null)).body;assert.equal(pub.editor.appearance.backgroundOpacity,35);assert.equal(pub.editor.home.title,'Nova jornada');assert.deepEqual(pub.editor.home.blocks,home.blocks);
});
test('hidden pages and guides remain private; unsafe styles and links cannot be saved',async()=>{
 const f=setup();let editor=(await f.req('admin/state')).body.editor;
 for(const section of ['pages','guides']){const items=structuredClone(editor[section]);items[0].enabled=false;items[0].body='PRIVATE_DRAFT_CONTENT';const result=await f.req('admin/site-editor','PUT',{version:editor.version,section,value:items});assert.equal(result.status,200);editor=result.body.editor;}
 const publicCatalog=(await f.req('catalog','GET',null,null)).body;assert.ok(!JSON.stringify(publicCatalog).includes('PRIVATE_DRAFT_CONTENT'));
 const defaults=editorDefaults();
 for(const change of [{primary:'red; background:url(https://evil.test)'},{backgroundOpacity:101},{backgroundBlur:-1},{font:'url(https://evil.test)'},{backgroundSize:'expression(alert(1))'}])assert.throws(()=>validateSection('appearance',{...defaults.appearance,...change}));
 assert.throws(()=>validateSection('brand',{...defaults.brand,logo:'javascript:alert(1)'}));
 assert.throws(()=>validateSection('navigation',{...defaults.navigation,items:[{id:'x',label:'X',path:'//evil.test',enabled:true}]}));
 assert.throws(()=>validateSection('home',{...defaults.home,blocks:defaults.home.blocks.map(()=>({id:'blog',enabled:true}))}));
 assert.throws(()=>validateSection('payments',{}));
});
test('logo, hero, store images and the site background use independent persistent slots',async()=>{
 const f=setup();const versions={};for(const path of ['background','media/logo','media/hero','media/shop']){const result=await f.req('admin/'+path,'POST',png,token,{'X-Background-Version':'0'});assert.equal(result.status,200);const meta=result.body.media||result.body.background;versions[path]=meta;assert.deepEqual((await f.req(meta.url.slice('/api/'.length),'GET',null,null)).body,png);}
 assert.equal((await f.req('admin/media/unknown','POST',png,token,{'X-Background-Version':'0'})).status,400);
 assert.equal(new Set(Object.values(versions).map(v=>v.url)).size,4);f.restart();const state=(await f.req('admin/state')).body;assert.equal(state.media.logo.url,versions['media/logo'].url);assert.equal(state.background.url,versions.background.url);
});
test('public editor renders editable content as text and registers only published custom routes',()=>{
 const ed=editorDefaults();ed.home.title='<img src=x onerror=alert(1)>';ed.home.blocks=ed.home.blocks.map(p=>({...p,enabled:p.id==='features'}));ed.home.features[0].text='<script>alert(1)</script>';ed.pages.push({id:'custom',title:'Minha página',kicker:'GUIA',body:'Texto seguro',enabled:true});ed.pages.push({id:'hidden',title:'Oculta',kicker:'',body:'Segredo',enabled:false});
 const root={style:{setProperty(){}},classList:{add(){}}};const sandbox={window:{SITE_EDITOR:ed},document:{documentElement:root},Date,console};const ctx=vm.createContext(sandbox);
 vm.runInContext(`const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));const CFG={minecraft:'1.21.1',cobblemon:'1.8+'};let logo,header,footer,art,home;const NAV=[];const PAGES={};const CATEGORIES=[['vips','VIPs']];const COMMANDS=[];const GUIDE_PAGES=[{id:'entrar',path:'/como-jogar/primeiros-passos/entrar'},{id:'comandos',path:'/como-jogar/primeiros-passos/comandos'},{id:'vender',path:'/como-jogar/mercado/vender'}];let guideContent=()=>({body:'default'});const guidePage=()=>'<main>Guide</main>';const external=()=>'';const ipButton=()=>'<button>IP</button>';const glyph=()=>'';const cartCount=()=>0;const latestBlog=()=>'';const PRODUCTS=[];const POKEMON=[];const productArt=()=>'';const POKE_SPRITE=()=>'';let shop=()=>'<main>Shop</main>';const standardDoc=(title,kicker,body)=>'<main><h1>'+title+'</h1>'+body+'</main>';function navigate(){}`,ctx);
 vm.runInContext(readFileSync(new URL('../site-theme.js',import.meta.url),'utf8'),ctx);vm.runInContext(readFileSync(new URL('../site-editor.js',import.meta.url),'utf8'),ctx);
 const html=vm.runInContext("PAGES['/']()",ctx);assert.ok(html.includes('&lt;img'));assert.ok(html.includes('&lt;script&gt;'));assert.ok(!html.includes('<script>'));assert.ok(!html.includes('<img src=x'));
 assert.ok(vm.runInContext("PAGES['/paginas/custom']()",ctx).includes('Texto seguro'));assert.equal(vm.runInContext("PAGES['/paginas/hidden']",ctx),undefined);
});
test('full public script pipeline opens the first visible guide after customization',()=>{
 const ed=editorDefaults();ed.guides[0].enabled=false;
 const hashListeners=[];const app={innerHTML:''},root={style:{setProperty(){}},classList:{add(){}}},location={hash:'#/como-jogar'};
 const sandbox={SITE_EDITOR:ed,COBBLEMOON:{minecraft:'1.21.1',cobblemon:'1.8+',discord:'https://discord.gg/example'},STORE_PRODUCTS:[],CHECKOUT_ENABLED:false,PAYMENT_METHODS:[],BLOG_POSTS:[],document:{documentElement:root,getElementById:id=>id==='app'?app:null,querySelector:()=>null,querySelectorAll:()=>[],addEventListener(){},title:''},location,history:{replaceState(a,b,url){location.hash=url}},localStorage:{getItem(){return null},setItem(){}},console,Date,Intl,URL,AbortSignal,crypto:globalThis.crypto,setTimeout,clearTimeout,addEventListener(type,handler){if(type==='hashchange')hashListeners.push(handler);},scrollTo(){},matchMedia:()=>({matches:false})};sandbox.window=sandbox;
 const ctx=vm.createContext(sandbox);for(const file of ['site-theme.js','background.js','guide.js','blog.js','app.js','store.js','site-editor.js','store-updates.js'])vm.runInContext(readFileSync(new URL('../'+file,import.meta.url),'utf8'),ctx,{filename:file});
 assert.equal(location.hash,'#/como-jogar/primeiros-passos/comandos');assert.ok(app.innerHTML.includes('<h1>Comandos principais</h1>'));assert.ok(!app.innerHTML.includes('404'));location.hash='#/loja';hashListeners[0]();assert.equal(sandbox.document.title,'Loja oficial | CobbleMOON');
});
test('panel serializes zero opacity, unchecked switches and reordered blocks without dropping other fields',()=>{
 const listeners={},sandbox={console,structuredClone,crypto:globalThis.crypto,document:{addEventListener:(type,fn)=>listeners[type]=fn,getElementById:()=>null}};sandbox.window=sandbox;const ctx=vm.createContext(sandbox);
 vm.runInContext(readFileSync(new URL('../admin/site-editor-panel.js',import.meta.url),'utf8'),ctx);const ui=sandbox.SiteEditorUI,state={editor:editorDefaults()};ui.render('appearance',state);
 const form={dataset:{section:'appearance',version:'1'},querySelectorAll:()=>[{name:'overlayOpacity',type:'range',value:'0'},{name:'backgroundFixed',type:'checkbox',checked:false},{name:'backgroundSize',type:'select-one',value:'custom'},{name:'backgroundScale',type:'range',value:'150'}]};
 const value=ui.read(form);assert.equal(value.value.overlayOpacity,0);assert.equal(value.value.backgroundFixed,false);assert.equal(value.value.backgroundScale,150);assert.equal(value.value.primary,state.editor.appearance.primary);validateSection('appearance',value.value);
 ui.render('homepage',state);const homeForm={dataset:{section:'home',version:'1'},querySelectorAll:()=>[],outerHTML:''};const target={dataset:{editorMove:'blocks:4:-1'},closest:()=>homeForm,hasAttribute:()=>false};listeners.click({target:{closest:()=>target},preventDefault(){}});
 assert.equal(ui.read(homeForm).value.blocks[3].id,'cta');assert.equal(ui.read(homeForm).value.blocks[4].id,'team');assert.equal(ui.read(homeForm).value.title,state.editor.home.title);
});
