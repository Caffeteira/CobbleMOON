import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {Store} from '../worker/index.mjs';
import {savePost,publishedPosts} from '../worker/blog.mjs';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const token='a'.repeat(40);
const input={version:0,title:'Novidades da comunidade',slug:'novidades-da-comunidade',category:'noticias',content:'Primeiro parágrafo.\n\nSegundo parágrafo.',excerpt:'Saiba o que está chegando.',image:'',status:'draft'};
function setup(){const db=new DatabaseSync(':memory:');const storage={sql:{exec(query,...params){const statement=db.prepare(query);if(query.startsWith('SELECT'))return {toArray:()=>statement.all(...params)};statement.run(...params);return {toArray:()=>[]};}},transactionSync(fn){db.exec('BEGIN IMMEDIATE');try{const result=fn();db.exec('COMMIT');return result;}catch(error){db.exec('ROLLBACK');throw error;}}};const store=new Store({storage},{ADMIN_TOKEN:token});async function req(path,method='GET',value,auth=token,origin){const response=await store.fetch(new Request('https://moon.test/api/'+path,{method,headers:{...(auth?{Authorization:'Bearer '+auth}:{}),...(origin?{Origin:origin}:{}),'Content-Type':'application/json'},body:value?JSON.stringify(value):undefined}));return {status:response.status,body:await response.json()};}return {store,req};}
test('blog requires admin authentication and keeps drafts private; publication, conflicts, archive and restore work',async()=>{
 const {req}=setup();
 assert.equal((await req('admin/posts','POST',input,null)).status,401);
 assert.equal((await req('admin/posts','POST',input,token,'https://evil.test')).status,403);
 const created=await req('admin/posts','POST',input);assert.equal(created.status,201);const draft=created.body.post;
 assert.equal((await req('blog','GET',null,null)).body.posts.length,0);
 assert.equal((await req('blog/'+draft.slug,'GET',null,null)).status,404);
 const published=(await req('admin/posts/'+draft.id,'PUT',{...draft,status:'published'})).body.post;
 assert.equal(published.version,2);assert.ok(published.publishedAt);
 const publicList=(await req('blog','GET',null,null)).body.posts;assert.equal(publicList[0].id,draft.id);assert.equal(publicList[0].content,undefined);
 assert.equal((await req('blog/'+draft.slug,'GET',null,null)).body.post.content,input.content);
 assert.equal((await req('admin/posts/'+draft.id,'PUT',draft)).status,409);
 assert.equal((await req('admin/posts','POST',input)).status,409);
 const edited=(await req('admin/posts/'+draft.id,'PUT',{...published,title:'Título atualizado'})).body.post;
 assert.equal(edited.publishedAt,published.publishedAt);
 assert.equal((await req('admin/posts/'+draft.id,'DELETE',{version:2})).status,409);
 assert.equal((await req('admin/posts/'+draft.id,'DELETE',{version:edited.version})).status,200);
 assert.equal((await req('blog','GET',null,null)).body.posts.length,0);
 assert.equal((await req('admin/posts/'+draft.id+'/restore','POST',{version:edited.version+1})).body.post.status,'draft');
 assert.equal((await req('blog/'+draft.slug,'GET',null,null)).status,404);
});
test('newest published post sorts first; editing keeps its position and invalid inputs fail',()=>{
 const older=savePost({...input,status:'published'},null,'2026-10-27T12:00:00.000Z');
 const newer=savePost({...input,slug:'novo',status:'published'},null,'2026-10-28T12:00:00.000Z');
 const edited=savePost({...older,title:'Edição do post antigo'},older,'2026-10-29T12:00:00.000Z');
 assert.equal(publishedPosts([edited,newer,{...newer,id:'draft',status:'draft'},{...newer,id:'removed',deleted:true}])[0].id,newer.id);
 for(const change of [{image:'javascript:alert(1)'},{slug:'../admin'},{category:'<script>'},{content:''},{title:' '},{version:9}])assert.throws(()=>savePost({...input,...change},null));
});
test('blog cards escape author content and home feature uses the newest published summary',()=>{
 const ctx=vm.createContext({window:{BLOG_POSTS:[{id:'one',title:'<img src=x onerror=alert(1)>',slug:'novo',category:'updates',excerpt:'<script>alert(1)</script>',image:'',publishedAt:'2026-10-28T12:00:00Z'}]},document:{addEventListener(){}},Date,setTimeout,clearTimeout});
 vm.runInContext("const esc=v=>String(v??'').replace(/[&<>\"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',\"'\":'&#39;'}[c]));",ctx);
 vm.runInContext(readFileSync(new URL('../blog.js',import.meta.url),'utf8'),ctx);
 const html=vm.runInContext('latestBlog()',ctx);assert.match(html,/ÚLTIMA PUBLICAÇÃO/);assert.match(html,/href="#\/blog\/novo"/);assert.ok(html.includes('&lt;img'));assert.ok(!html.includes('<script>'));assert.ok(!html.includes('<img src=x'));
});
