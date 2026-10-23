import Stripe from 'stripe';

export const PAYMENT_EVENTS = ['checkout.session.completed','checkout.session.async_payment_succeeded','checkout.session.async_payment_failed','checkout.session.expired','charge.refunded','charge.dispute.created'];
export const SITE_ORIGIN = 'https://cobblemoon.shop';
export function paymentSettings(env) {
  const keyConfigured = /^(?:rk|sk)_(?:live|test)_\S+$/.test(env.STRIPE_SECRET_KEY || '');
  const mode = keyConfigured && /^(?:rk|sk)_live_/.test(env.STRIPE_SECRET_KEY) ? 'live' : 'test';
  const webhookConfigured = /^whsec_\S+$/.test(env.STRIPE_WEBHOOK_SECRET || '');
  const bridgeConfigured = !!env.BRIDGE_TOKEN && env.BRIDGE_TOKEN.length >= 32 && env.BRIDGE_TOKEN !== env.ADMIN_TOKEN;
  const enabled = env.PAYMENTS_ENABLED === 'true' && keyConfigured && webhookConfigured && bridgeConfigured && mode === 'live';
  return {provider:'stripe',enabled,mode,keyConfigured,webhookConfigured,bridgeConfigured,activationRequested:env.PAYMENTS_ENABLED === 'true',reason:enabled?'Checkout habilitado. Confira os testes e a conexão do servidor.':'Configure a Stripe, teste o fluxo e ative PAYMENTS_ENABLED na Cloudflare.'};
}
export function stripeClient(env) {
  return new Stripe(env.STRIPE_SECRET_KEY, {apiVersion:'2026-08-26.dahlia',httpClient:Stripe.createFetchHttpClient(),maxNetworkRetries:2,timeout:20000});
}
export async function verifiedEvent(req, env) {
  if (Number(req.headers.get('content-length')) > 500000) throw Object.assign(new Error('Notificação muito grande'),{status:413});
  const raw = await req.text();
  if (raw.length > 500000) throw Object.assign(new Error('Notificação muito grande'),{status:413});
  try {
    return await stripeClient(env).webhooks.constructEventAsync(raw,req.headers.get('stripe-signature') || '',env.STRIPE_WEBHOOK_SECRET,300,Stripe.createSubtleCryptoProvider());
  } catch { throw Object.assign(new Error('Assinatura Stripe inválida'),{status:400}); }
}
export function checkoutParameters(order) {
  return {
    mode:'payment',locale:'pt-BR',client_reference_id:order.id,
    integration_identifier:order.integrationIdentifier,
    metadata:{order_id:order.id,store:'cobblemoon'},
    payment_intent_data:{metadata:{order_id:order.id,store:'cobblemoon'}},
    line_items:order.lines.map(line=>({price_data:{currency:'brl',unit_amount:line.unitCents,product_data:{name:line.name}},quantity:line.quantity})),
    success_url:SITE_ORIGIN+'/?payment=return#/pedido/'+order.id+'/'+order.accessToken,
    cancel_url:SITE_ORIGIN+'/#/pedido/'+order.id+'/'+order.accessToken,
    expires_at:order.expiresAt,
    adaptive_pricing:{enabled:false}
  };
}
export function validCheckoutUrl(value) {
  try { const u = new URL(value); return u.protocol === 'https:' && u.hostname === 'checkout.stripe.com' && !u.username && !u.password; } catch { return false; }
}
