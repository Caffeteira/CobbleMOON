// Runs only inside the same-origin administrative preview. No credentials enter this page.
(()=>{
if(!window.COBBLE_PREVIEW||window.parent===window)return;
const label=document.createElement('div');label.className='cms-preview-notice';label.textContent='PRÉVIA PRIVADA · Selecione uma seção para editar';document.body.append(label);
const style=document.createElement('style');style.textContent='.cms-preview-notice{position:fixed;bottom:10px;left:10px;right:10px;z-index:99999;padding:10px 14px;border:1px solid #d5b8ff;background:#161124;color:#eee9ff;border-radius:10px;font:12px system-ui;pointer-events:none}[data-cms-select]:hover{outline:2px dashed #c9a3ff;outline-offset:-3px;cursor:pointer}';document.head.append(style);
const mark=()=>{for(const node of document.querySelectorAll('.site-header'))node.dataset.cmsSelect='navigation';for(const node of document.querySelectorAll('.site-footer'))node.dataset.cmsSelect='footer';for(const node of document.querySelectorAll('main section'))node.dataset.cmsSelect=location.hash.startsWith('#/loja')?'storeDesign':location.hash.startsWith('#/blog')?'blogDesign':location.hash.startsWith('#/como-jogar')?'guides':location.hash.startsWith('#/')&&location.hash!=='#/'?'pages':'homepage';};
new MutationObserver(mark).observe(document.getElementById('app'),{childList:true,subtree:true});mark();
document.addEventListener('click',event=>{const section=event.target.closest('[data-cms-select]');if(section){event.preventDefault();event.stopImmediatePropagation();window.parent.postMessage({type:'cobblemoon-select-section',section:section.dataset.cmsSelect},location.origin);}else if(event.target.closest('a,button')){event.preventDefault();event.stopImmediatePropagation();}},true);
document.addEventListener('submit',event=>{event.preventDefault();event.stopImmediatePropagation();},true);
})();
