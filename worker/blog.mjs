const invalid=(message,status=400)=>{throw Object.assign(new Error(message),{status})};
export const BLOG_CATEGORIES=['updates','noticias','promocoes'];
export function savePost(input,current,now=new Date().toISOString()){
 if(input?.version!==(current?.version||0))invalid('Este post foi alterado. Atualize antes de salvar.',409);
 const text=(value,max,required=false)=>{if(typeof value!=='string'||value.length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value))invalid('Revise os campos do post.');const result=value.trim();if(required&&!result)invalid('Preencha título e conteúdo.');return result;};
 const title=text(input.title,160,true),content=text(input.content,40000,true),excerpt=text(input.excerpt||'',320)||content.replace(/\s+/g,' ').slice(0,240);
 const slug=text(input.slug,100,true);if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug))invalid('Use letras minúsculas, números e hífens no endereço.');
 if(!BLOG_CATEGORIES.includes(input.category)||!['draft','published'].includes(input.status))invalid('Categoria ou status inválido.');
 const image=text(input.image||'',1000);if(image&&!/^https:\/\/[^\s"'<>`]+$/.test(image)&&!/^\.\/assets\/[a-zA-Z0-9_./-]+$/.test(image))invalid('A capa deve usar HTTPS ou ./assets/.');
 return {id:current?.id||crypto.randomUUID(),version:(current?.version||0)+1,title,slug,category:input.category,content,excerpt,image,status:input.status,createdAt:current?.createdAt||now,updatedAt:now,publishedAt:input.status==='published'?(current?.status==='published'?current.publishedAt:now):current?.publishedAt||null,deleted:false};
}
export function publishedPosts(posts){return posts.filter(p=>!p.deleted&&p.status==='published').sort((a,b)=>b.publishedAt.localeCompare(a.publishedAt)||b.createdAt.localeCompare(a.createdAt)||b.id.localeCompare(a.id));}
export function postSummary({content,...post}){return post;}
