// Edite apenas os valores abaixo. Não coloque senhas neste arquivo público.
window.COBBLEMOON = {
  serverIp: "", // IP real do Minecraft. Ex.: jogar.seudominio.com.br
  discord: "https://discord.gg/a5p9HemHS", // Convite completo: https://discord.gg/...
  shop: "", // URL da sua loja externa, quando estiver pronta
  modpack: "", // Link do modpack oficial, quando disponível
  minecraft: "1.21.1",
  cobblemon: "1.8+"
};

// Preços em reais; null = consultar a equipe. Não invente benefícios antes de configurá-los no jogo.
// duration e benefits aparecem na ficha do produto.
window.STORE_PRODUCTS = [
  ...[
    ['vip','VIP','#f5c75c'],['vip_plus','VIP+','#77d7ff'],['nova','Nova','#ffb374'],
    ['moon','Moon','#c6b7ff'],['lunar','Lunar','#89dfcf'],['astral','Astral','#c69dff'],
    ['cosmic','Cosmic','#82b8ff'],['eclipse','Eclipse','#ff7a83']
  ].map(([id,name,color])=>({id,name,category:'vips',image:'./assets/ranks/'+id+'.png',color,price:null,duration:'',benefits:[],description:'Conheça o VIP '+name+' da CobbleMOON. Consulte a equipe para confirmar benefícios, duração e valor.',draft:false})),
  {id:'cosmeticos',name:'Cosméticos',category:'cosmeticos',icon:'spark',color:'#e6a2ff',price:null,draft:true,description:'Espaço reservado para os cosméticos que serão disponibilizados no servidor.',benefits:[]},
  {id:'bau-lunar',name:'Baú Lunar',category:'baus',icon:'chest',color:'#b6a5ff',price:null,draft:true,description:'Produto em preparação. Conteúdo, quantidade e disponibilidade ainda serão definidos.',benefits:[]},
  {id:'chave-lunar',name:'Chave Lunar',category:'chaves',icon:'key',color:'#ffc87b',price:null,draft:true,description:'Produto em preparação. A equipe divulgará o uso e os itens disponíveis antes da venda.',benefits:[]},
  {id:'moedas',name:'Moedas',category:'moedas',icon:'coin',color:'#ffe18c',price:null,draft:true,description:'Pacotes de moedas em preparação. Quantidades e valores serão anunciados pela equipe.',benefits:[]},
  {id:'extras',name:'Extras',category:'extras',icon:'gift',color:'#9ce5cf',price:null,draft:true,description:'Novos produtos e pacotes poderão aparecer aqui. Acompanhe os anúncios no Discord.',benefits:[]}
];
