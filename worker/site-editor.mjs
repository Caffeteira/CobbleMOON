import {backgroundImage} from './background.mjs';
import defaults from '../site-defaults.json' with {type:'json'};
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status})};
export const EDITOR_SECTIONS=['brand','appearance','home','navigation','footer','shop','blog','pages','guides','commands'];
export function editorDefaults(){return structuredClone(defaults);}
export function siteEditor(store){const saved=store.get('site-editor','main');if(saved)return {...saved,appearance:{...defaults.appearance,...saved.appearance,backgroundImage:saved.appearance.backgroundImage??backgroundImage(store)}};const initial=editorDefaults();initial.appearance.backgroundImage=backgroundImage(store);const site=store.get('config','main')?.site;if(site?.homeTitle)initial.home.title=site.homeTitle.replace(/<br\s*\/?>/gi,'\n').replace(/<[^>]*>/g,'');if(site?.homeSubtitle)initial.home.subtitle=site.homeSubtitle;return initial;}
export function publicSiteEditor(store){const value=structuredClone(siteEditor(store));value.pages=value.pages.filter(p=>p.enabled);value.guides=value.guides.filter(p=>p.enabled);return value;}
const limits={backgroundOpacity:[0,100],overlayOpacity:[0,100],backgroundBlur:[0,20],backgroundScale:[30,250],backgroundPositionX:[0,100],backgroundPositionY:[0,100],cardOpacity:[10,100],headerOpacity:[0,100],footerOpacity:[0,100],radius:[0,40],width:[960,1600],fontSize:[12,22],sectionSpacing:[30,140]};
const safeUrl=value=>value===''||['discord','modpack','shop'].includes(value)||/^\.\/assets\/[A-Za-z0-9_./-]+$/.test(value)||/^\/(?!\/)[A-Za-z0-9_/?=&-]*$/.test(value)||(()=>{try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password&&!/[\s"'<>`]/.test(value)}catch{return false}})();
export function validateSection(section,value){
 if(!EDITOR_SECTIONS.includes(section))fail('Seção inválida.');
 const walk=(input,template,path)=>{
  const key=path.split('.').at(-1);
  if(Array.isArray(template)){const max=key==='blocks'?5:key==='features'?9:key==='faq'?20:key==='items'||key==='links'?12:section==='commands'?100:30;if(!Array.isArray(input)||input.length>max)fail('Revise a quantidade de itens da seção.');return input.map((item,i)=>walk(item,template[0],path+'.'+i));}
  if(template&&typeof template==='object'){if(!input||Array.isArray(input)||typeof input!=='object'||Object.keys(input).some(k=>!Object.hasOwn(template,k)))fail('Configuração de seção inválida.');return Object.fromEntries(Object.entries(template).map(([k,v])=>[k,walk(input[k],v,path+'.'+k)]));}
  if(typeof template==='boolean'){if(typeof input!=='boolean')fail('Opção inválida.');return input;}
  if(typeof template==='number'){const [min,max]=limits[key]||[0,100];if(!Number.isFinite(input)||input<min||input>max)fail('Valor fora do intervalo permitido: '+key);return input;}
  const max=key==='icon'?16:['title','label','name','tagline'].includes(key)?180:key==='body'?8000:key==='text'||key==='subtitle'||key==='disclaimer'?2000:1000;if(typeof input!=='string'||input.length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(input))fail('Texto inválido ou muito longo: '+key);const result=input.trim();
  if(section==='appearance'){
   if(['primary','accent','text','muted','page','card','header','footer','overlayColor'].includes(key)&&!/^#[a-fA-F0-9]{6}$/.test(result))fail('Escolha uma cor válida.');
   if(key==='backgroundSize'&&!['cover','contain','stretch','custom'].includes(result))fail('Tamanho de fundo inválido.');
   if(key==='backgroundRepeat'&&!['no-repeat','repeat'].includes(result))fail('Repetição inválida.');
   if(['font','headingFont'].includes(key)&&!['DM Sans','Outfit','system-ui','Arial','Georgia'].includes(result))fail('Fonte inválida.');
  }
  if(['url','path','primaryUrl','secondaryUrl','ctaUrl','logo','heroImage','bannerImage','backgroundImage'].includes(key)&&!safeUrl(result))fail('Use um link interno, HTTPS ou uma imagem enviada.');
  if(key==='id'&&!/^[a-z0-9][a-z0-9-]{0,59}$/.test(result))fail('Identificador inválido.');
  if(section==='home'&&key==='heroAlignment'&&!['left','center'].includes(result))fail('Alinhamento inválido.');
  if(section==='commands'&&key==='command'&&(!/^\/[A-Za-z0-9_][^\r\n<>]{0,119}$/.test(result)))fail('Informe um comando começando com /.');
  return result;
 };
 const out=walk(value,defaults[section],section);
 for(const list of [Array.isArray(out)?out:out.blocks, out.items].filter(Array.isArray)){if(list[0]&&Object.hasOwn(list[0],'id')&&new Set(list.map(p=>p.id)).size!==list.length)fail('Há identificadores repetidos.');}
 if(section==='home'&&(out.blocks.length!==5||out.blocks.some(p=>!['blog','features','shop','team','cta'].includes(p.id))))fail('A ordem deve conter as cinco seções da inicial.');
 return out;
}
export function updateEditor(store,input){return store.state.storage.transactionSync(()=>{const current=siteEditor(store);if(input.version!==current.version)fail('Outra alteração foi salva. Atualize o painel antes de continuar.',409);const value=validateSection(input.section,input.value);const next={...current,[input.section]:value,version:current.version+1};store.put('site-editor','main',next);store.audit('site-editor.updated',{section:input.section,version:next.version});return next;});}
