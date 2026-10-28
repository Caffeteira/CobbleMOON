// One-time migration of the unfinished VIP placeholder, preserving later admin edits.
export function prepareVip(config) {
  const vip = config.products.find(p => p.id === 'vip');
  if (!vip || ![null, 0.01].includes(vip.price) || vip.commands?.length) return null;
  const next = structuredClone(config);
  Object.assign(next.products.find(p => p.id === 'vip'), {
    price: 29.90, duration: '30 dias', draft: true,
    description: 'VIP CobbleMOON por 30 dias. Pagamento único de R$ 29,90, sem renovação automática. Compra em preparação enquanto a entrega no servidor é configurada.'
  });
  next.version = config.version + 1;
  return next;
}
