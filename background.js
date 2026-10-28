// The image URL is created by the authenticated upload endpoint, never raw CSS.
(()=>{const image=window.COBBLEMOON?.backgroundImage||'';if(/^\/api\/site-background\?v=[a-f0-9-]{36}$/.test(image)){document.documentElement.style.setProperty('--site-background-image',`url("${image}")`);document.documentElement.classList.add('has-site-background');}})();
