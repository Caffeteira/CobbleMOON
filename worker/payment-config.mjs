// Administrative preferences only. Provider secrets stay in Cloudflare Secrets.
export function defaultPaymentConfig() {
  return {version:1,pix:{key:'',keyType:'random',receiver:'',city:'',configurationId:'',requested:false},card:{configurationId:'',requested:false},paypal:{email:'',clientId:'',environment:'sandbox',requested:false}};
}
export function validatePaymentConfig(input,currentVersion) {
  if(input?.version!==currentVersion)throw Object.assign(new Error('As configurações foram alteradas. Atualize antes de salvar.'),{status:409});
  const text=(value,max)=>{if(typeof value!=='string'||value.length>max||/[\u0000-\u001f<>]/.test(value))throw Object.assign(new Error('Revise os dados de pagamento.'),{status:400});return value.trim();};
  const out=defaultPaymentConfig();out.version=currentVersion+1;
  out.pix.key=text(input.pix?.key??'',200);out.pix.receiver=text(input.pix?.receiver??'',100);out.pix.city=text(input.pix?.city??'',80);
  if(!['random','email','cpf','cnpj','phone'].includes(input.pix?.keyType))throw Object.assign(new Error('Tipo de chave Pix inválido.'),{status:400});
  for(const method of ['pix','card']){out[method].configurationId=text(input[method]?.configurationId??'',100);if(out[method].configurationId&&!/^pmc_[a-zA-Z0-9]+$/.test(out[method].configurationId))throw Object.assign(new Error('ID de configuração Stripe inválido. Use pmc_...'),{status:400});}
  out.pix.keyType=input.pix.keyType;out.pix.requested=input.pix.requested===true;out.card.requested=input.card?.requested===true;
  out.paypal.email=text(input.paypal?.email??'',254);out.paypal.clientId=text(input.paypal?.clientId??'',200);
  if(out.paypal.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(out.paypal.email))throw Object.assign(new Error('E-mail PayPal inválido.'),{status:400});
  if(!['sandbox','live'].includes(input.paypal?.environment))throw Object.assign(new Error('Ambiente PayPal inválido.'),{status:400});
  out.paypal.environment=input.paypal.environment;out.paypal.requested=input.paypal.requested===true;
  return out;
}
export function publicPaymentMethods(config,stripeReady) {
  return [
    {id:'pix',name:'Pix',enabled:stripeReady&&config.pix.requested&&!!config.pix.configurationId,description:'QR Code e código copia e cola no checkout.'},
    {id:'card',name:'Cartão',enabled:stripeReady&&config.card.requested&&!!config.card.configurationId,description:'Pagamento protegido pela Stripe.'},
    {id:'paypal',name:'PayPal',enabled:false,description:'Integração pendente de configuração e validação.'}
  ];
}
