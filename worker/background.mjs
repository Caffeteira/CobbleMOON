export const MAX_BACKGROUND_BYTES=1572864;
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status})};
const chunkSize=196608;
export function backgroundState(store){const meta=store.get('background','main');return meta?{...meta,url:'/api/site-background?v='+meta.revision}:{version:0,active:false,url:'',size:0};}
export function backgroundImage(store){const meta=backgroundState(store);return meta.active?meta.url:'';}
function encode(bytes){let raw='';for(let i=0;i<bytes.length;i+=8192)raw+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(raw);}
function imageType(bytes){
 if(bytes.length<12)return '';
 if([137,80,78,71,13,10,26,10].every((n,i)=>bytes[i]===n))return 'image/png';
 if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return 'image/jpeg';
 if(String.fromCharCode(...bytes.slice(0,4))==='RIFF'&&String.fromCharCode(...bytes.slice(8,12))==='WEBP')return 'image/webp';
 return '';
}
export async function uploadBackground(store,req){
 const expected=req.headers.get('X-Background-Version');if(expected===null||!/^\d+$/.test(expected))fail('Atualize o painel antes de enviar a imagem.',409);
 if(Number(req.headers.get('Content-Length'))>MAX_BACKGROUND_BYTES)fail('Imagem muito grande. O limite otimizado é 1,5 MB.',413);
 if(!req.body)fail('Selecione uma imagem.');const reader=req.body.getReader(),parts=[];let total=0;
 while(true){const {done,value}=await reader.read();if(done)break;total+=value.length;if(total>MAX_BACKGROUND_BYTES){await reader.cancel();fail('Imagem muito grande. O limite otimizado é 1,5 MB.',413);}parts.push(value);}
 const bytes=new Uint8Array(total);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}
 const type=imageType(bytes);if(!type||req.headers.get('Content-Type')?.split(';')[0]!==type)fail('Envie uma imagem PNG, JPG ou WebP válida.');
 return store.state.storage.transactionSync(()=>{const current=backgroundState(store);if(Number(expected)!==current.version)fail('O fundo foi alterado em outra aba. Atualize e tente novamente.',409);
  store.sql.exec("DELETE FROM records WHERE kind='background-chunk'");let chunks=0;
  for(let i=0;i<bytes.length;i+=chunkSize)store.put('background-chunk',String(chunks++),encode(bytes.subarray(i,i+chunkSize)));
  const meta={version:current.version+1,revision:crypto.randomUUID(),active:true,size:total,type,chunks,updatedAt:new Date().toISOString()};store.put('background','main',meta);store.audit('background.uploaded',{version:meta.version,size:total,type});return backgroundState(store);
 });
}
export function setBackgroundActive(store,input){return store.state.storage.transactionSync(()=>{const meta=store.get('background','main');if(!meta)fail('Nenhuma imagem enviada.');if(input.version!==meta.version)fail('O fundo foi alterado. Atualize o painel.',409);if(typeof input.active!=='boolean')fail('Opção inválida.');store.put('background','main',{...meta,active:input.active,version:meta.version+1,updatedAt:new Date().toISOString()});store.audit('background.toggled',{active:input.active});return backgroundState(store);});}
export function serveBackground(store,req){
 const meta=store.get('background','main'),version=new URL(req.url).searchParams.get('v');if(!meta||(version&&version!==meta.revision))return new Response('Imagem não encontrada',{status:404,headers:{'Cache-Control':'no-store'}});
 const headers={'Content-Type':meta.type,'Cache-Control':'public, max-age=3600','ETag':'"'+meta.revision+'"','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox"};
 if(req.headers.get('If-None-Match')===headers.ETag)return new Response(null,{status:304,headers});
 const bytes=new Uint8Array(meta.size);let offset=0;for(let i=0;i<meta.chunks;i++){const raw=atob(store.get('background-chunk',String(i))||'');for(let j=0;j<raw.length;j++)bytes[offset++]=raw.charCodeAt(j);}if(offset!==meta.size)fail('Não foi possível carregar a imagem.',503);
 return new Response(bytes,{headers});
}
