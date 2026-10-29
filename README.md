# CobbleMOON — site, administração e integração de entrega

## Estado desta versão

- Painel: `/admin/`. Produtos, preços em BRL, benefícios, duração, imagens, comandos, exibição do catálogo, IP/Discord/modpack, texto da página inicial, pedidos, entregas, status do servidor e exportação JSON.
- Backend persistente: Cloudflare Worker + Durable Object com armazenamento SQLite. Migração automática pelo Wrangler, sem banco externo. Sujeito aos limites do plano Cloudflare da conta.
- Conector: mod server-side Fabric 1.21.1 / Java 21 em `connector/`.
- Stripe Checkout em BRL, métodos elegíveis controlados no Dashboard (incluindo Pix), acompanhamento privado do pedido e webhook assinado. **Vendas bloqueadas por padrão** até configurar credenciais, validar pagamento/entrega e ativar PAYMENTS_ENABLED.
- A entrega de teste executa comandos reais e é identificada como teste, nunca como receita ou pagamento confirmado.
- Editor por seções, prévia completa em celular/computador, rascunhos e histórico de publicação. Não inclui posicionamento livre por pixels. A Pokédex foi substituída pelo blog; o montador de times continua disponível.

## Cloudflare: ativar o painel

O comando já configurado no projeto continua funcionando:

`npx wrangler deploy --name cobblemoon --assets . --compatibility-date 2026-10-19 --keep-vars`

O deploy usa `keep_vars: true` para preservar as variáveis de runtime cadastradas no Dashboard. Não adicione valores ou padrões em `vars` no repositório para substituir os dados do painel. Os secrets criptografados são mantidos pelo Wrangler; não execute comandos de exclusão de secrets nas atualizações. A opção não restaura valores removidos em deploys anteriores.

O arquivo `wrangler.jsonc` adiciona o Worker, binding ASSETS e Durable Object STORE. `.assetsignore` exclui backend, testes e código do conector dos arquivos públicos. O código-fonte do repositório permanece público; nunca coloque segredos nele.

Depois da publicação, no Worker `cobblemoon` → Settings → Variables and Secrets, adicione duas variáveis **do tipo Secret**:

| Nome | Uso |
| --- | --- |
| ADMIN_TOKEN | Chave aleatória de pelo menos 32 caracteres para acessar `/admin/`. |
| BRIDGE_TOKEN | Outra chave aleatória de pelo menos 32 caracteres, exclusiva do conector Minecraft. |

Use um gerenciador de senhas para gerar as chaves. Não compartilhe no chat nem faça commit delas. Segredos são guardados pela Cloudflare, não pelo catálogo. As chaves devem ser diferentes. O painel mantém a chave administrativa só na memória da aba e a remove ao sair/recarregar.

Acesse `/admin/`, entre com ADMIN_TOKEN e cadastre os dados reais. Os VIPs iniciais aparecem em preparação até configurar preço e comandos; as outras categorias começam ocultas. Exibir um produto sem preço ou comando o mantém como em preparação para compra. Um preço ou benefício de um VIP não foi inventado automaticamente.

Alterações de catálogo são persistidas no servidor, auditadas e usam versão para evitar sobrescrever alterações concorrentes. Um novo deploy não repõe o catálogo inicial sobre dados já salvos.

## Testar o servidor

Veja `connector/README.md`. Instale o JAR em um servidor de teste, configure o conector e cadastre um produto de teste. No painel → Servidor e ativação, informe o nick online e a frase de confirmação para executar os comandos.

A fila usa um ID por comando, confirmação autenticada e registro local durável antes da execução. Quedas com efeito incerto resultam em **review**, sem reexecução automática. Isso evita prometer “exactly once” para efeitos arbitrários no Minecraft. Confira cada comando no ambiente real antes de ativar vendas. Não exclua nem restaure uma versão antiga do ledger do mod sem reconciliar as entregas.

## Stripe e Pix

O conector ChatGPT–Stripe permite administrar a conta, mas não instala credenciais de execução na Cloudflare. No Worker → Settings → Variables and Secrets, configure:

| Nome | Tipo / finalidade |
| --- | --- |
| STRIPE_SECRET_KEY | Secret. Prefira chave restrita Stripe, com permissões necessárias para criar e consultar Checkout Sessions e seus recursos associados. Valide as permissões no ambiente de teste antes de produção. |
| STRIPE_WEBHOOK_SECRET | Secret. Segredo `whsec_…` do endpoint e ambiente correspondente. Não é uma chave de API. |
| PAYMENTS_ENABLED | Texto `true` somente após os testes; remova ou defina `false` para bloquear novos checkouts sem bloquear notificações de pedidos existentes. |

Use um sandbox separado para os testes: chave restrita de teste + endpoint de teste. Em Painel → Pagamentos, crie o checkout de teste e conclua-o no ambiente Stripe. Ele deve chegar como `test_paid_no_delivery`, sem comandos no servidor. O botão só funciona com credenciais de teste; não converte uma compra real em teste. Não reutilize segredos entre ambientes. Antes de substituir credenciais, reconcilie pedidos pendentes do ambiente anterior.

Endpoint obrigatório: `https://cobblemoon.shop/api/webhooks/stripe`. Versão: `2026-08-26.dahlia`. Eventos:

- `checkout.session.completed`
- `checkout.session.async_payment_succeeded`
- `checkout.session.async_payment_failed`
- `checkout.session.expired`
- `charge.refunded`
- `charge.dispute.created`

O backend verifica assinatura sobre o corpo original (tolerância de 5 minutos), ambiente e correspondência com o pedido. Consulta a sessão na API Stripe e compara total, moeda, referência e metadados. Só `payment_status=paid` com sessão completa aprova o pedido. O retorno do navegador nunca aprova compras. Eventos e pagamentos repetidos não recriam entregas. Retentativas de checkout da mesma sacola usam a mesma sessão e chave de idempotência; pedido mínimo R$ 0,50.

Reembolsos e contestações levam o pedido para revisão e suspendem comandos ainda não enviados. Comandos já executados não são desfeitos automaticamente. Se o servidor ficar offline, pagamentos aprovados permanecem na fila até o conector encontrar o jogador online. O link de acompanhamento contém uma chave de acesso privada no fragmento da URL; não compartilhe esse link.

O pagamento pode ser configurado antes do Minecraft: configure as credenciais Stripe e o segredo do endpoint correspondente, valide a confirmação e só abra vendas quando desejar. PAYMENTS_ENABLED=true habilita o checkout em produção sem exigir BRIDGE_TOKEN; os pedidos pagos aguardam na fila até o conector ser configurado. O teste explícito da entrega Minecraft fica para a etapa seguinte. Confirme a situação da conta e os métodos disponíveis na Stripe. A disponibilidade de Pix no Dashboard não substitui a validação de uma compra completa. Um teste local com mocks não é uma transação real.

## Verificação

`npm ci && npm test` — autenticação, edição, preço no backend, assinatura e validade dos webhooks, notificações assíncronas/duplicadas, isolamento de teste, reembolsos, privacidade do pedido e confirmação idempotente. Os testes Stripe usam respostas simuladas e assinaturas locais.

`gradle --no-daemon build` em `connector/` — compila o mod com Java 21 e Gradle 8.10.2. O GitHub Actions também gera o JAR em artefato.

Sem teste em um servidor Minecraft real, não é possível validar a entrega dos comandos específicos de cada mod instalado.


## Checkout e entrega automática

A loja cria uma Checkout Session para cada pedido, com nick e Discord armazenados no pedido e preço calculado no servidor. Não é preciso criar Payment Links. Os métodos elegíveis são definidos no Dashboard Stripe e exibidos no checkout, sem chave Pix manual e sem IDs `pmc_...` obrigatórios.

O formulário antigo de Pix/PayPal foi removido. Os dados antigos permanecem privados para compatibilidade, mas não ativam nem confirmam pagamentos. PayPal só será apresentado caso a própria Stripe o disponibilize para a conta e transação; não existe integração PayPal separada.

O fluxo é: pedido → Stripe → webhook assinado e consulta do pagamento → fila → conector Fabric → comando → confirmação no histórico. Pedidos pagos aguardam servidor e jogador online; notificações repetidas não repetem a entrega. Configure os Secrets e a variável de ativação conforme descrito acima. É indispensável testar os comandos reais e o retorno do conector antes de abrir vendas.

## Blog da CobbleMOON

O painel inclui **Blog e novidades**: crie posts nas categorias Updates, Notícias e Promoções, salve rascunhos, confira a prévia e publique. Título, endereço, resumo, capa opcional e conteúdo são editáveis. O texto usa parágrafos separados por linha em branco; HTML é exibido como texto para impedir scripts. Arquivar retira o post do site e permite restaurá-lo como rascunho.

Os posts ficam no Durable Object STORE, separados do catálogo, com autenticação administrativa, revisão para evitar sobrescritas e histórico de atividades. Deploys não recriam nem substituem publicações. A API pública só retorna posts publicados. A página inicial destaca automaticamente o de data de publicação mais recente; editar o texto de um post antigo não muda sua data de publicação. Retirar e republicar cria uma nova data de publicação.

Rotas públicas: `/#/blog`, `/#/blog/endereco-do-post`, `/api/blog` e `/api/blog/endereco-do-post`. A antiga rota da Pokédex redireciona para o blog. Os dados de Pokémon que o montador de times utiliza continuam disponíveis internamente.

## Imagem de fundo pelo painel

Em **Personalizar o site → Aparência e fundo**, selecionar um JPG, PNG ou WebP envia a imagem para o editor. Salve o rascunho e publique quando estiver pronto. O navegador otimiza arquivos de até 20 MB para até 2200 pixels e no máximo 1,5 MB. A interface permite escolher o fundo; esvazie o campo da imagem para remover o fundo no rascunho. O site mantém uma camada escura para leitura e usa a imagem na inicial, loja, blog e guias; cartões e textos preservam seus contrastes.

O envio exige autenticação administrativa, origem correspondente e revisão atual. O servidor verifica tamanho e assinatura do formato; SVG e conteúdo HTML não são aceitos. A imagem fica persistida no STORE em blocos separados, sem nova conta ou serviço externo, e os metadados ficam separados do catálogo. Alterar os links do site ou publicar código não remove o fundo. A API pública entrega o arquivo com tipo de imagem, `nosniff` e URL de revisão para evitar cache de uma imagem antiga. Cada nova imagem tem uma URL imutável. As anteriores são preservadas para que rascunhos e restaurações continuem funcionando. O backup JSON não inclui os bytes da imagem; mantenha também seu arquivo original.


## Editor organizado do site

O painel separa Conteúdo, Personalização, Vendas e Configurações. Em Personalizar o site, ajuste aparência, identidade, inicial, menu, rodapé, loja e blog. Aparência inclui opacidade da imagem, camada de escurecimento e sua cor, desfoque, posição horizontal/vertical, tamanho, repetição, fixação, transparência dos cartões/cabeçalho/rodapé, cores, fontes, largura, arredondamento e espaçamento. O mini site ao lado acompanha os campos; **Salvar rascunho** persiste somente a seção aberta sem alterar a versão pública. Em **Rascunhos e publicação**, confira e publique todas as seções salvas juntas. Descartar campos retorna ao último rascunho salvo da seção.

Identidade visual permite enviar logo e arte principal; Visual da loja permite enviar a imagem do destaque. Todos os envios preenchem o rascunho e só entram no layout público depois de salvar e publicar. Os arquivos são independentes, persistidos no STORE e não dependem de outro serviço. As páginas e os guias aceitam conteúdo em parágrafos; guias podem ser agrupados em categorias e reorganizados. Páginas novas têm a rota `/#/paginas/identificador`. Guias novos têm `/#/como-jogar/artigos/identificador`. Páginas e guias despublicados não aparecem na API pública. Os comandos de jogadores são separados dos comandos de entrega dos produtos.

As configurações do editor são persistidas à parte do catálogo, com revisão para evitar sobrescritas, validação de cores, tamanhos e links e histórico administrativo. Não há execução de HTML, CSS ou JavaScript enviado nos campos. As chaves de pagamento e autenticação continuam nos Secrets da Cloudflare, preservadas pelo deploy com keep_vars. O editor é baseado em campos e ordem de seções; não é uma ferramenta de posicionamento livre como um canvas.


## Atualização: prévia, publicação, cupons e equipe

- **Prévia completa:** abra no editor ou na publicação; alterne 390 px e 1280 px e escolha inicial, loja, blog, guias ou página do servidor. Tocar uma seção abre os campos correspondentes. A ordem dos blocos da inicial é alterada pelos botões ↑/↓. A prévia recebe somente o rascunho e dados públicos via postMessage entre frames da mesma origem; não recebe chaves nem cria pagamentos. Não é um canvas de posição livre.
- **Publicação:** editor e rascunho têm revisões verificadas no backend; publicação troca todas as seções de uma vez. As últimas 20 versões anteriores ficam disponíveis para restaurar como rascunho. Restauração nunca muda preços, pedidos ou comandos. Produtos, links do servidor, posts, cupons e notas continuam sendo salvos pelos próprios formulários, fora das versões do editor. Backup JSON contém rascunho/histórico, mas não as imagens binárias.
- **Pedidos:** a compra mostra o código privado antes de abrir a Stripe. `/#/pedidos` aceita código ou link de acompanhamento. O status mostra o progresso dos comandos sem revelá-los; o código usa o ID do pedido e uma chave opaca, sem busca pública por nick ou Discord.
- **Central de entregas:** filtros Todos, Pagos, Na fila, Em revisão e Entregues; detalhes com produtos, desconto, pagamento, comandos e notas internas com revisão. O proprietário pode pausar um comando ainda não atribuído e retomar somente pausas manuais que nunca foram enviadas. Um resultado incerto já atribuído pode ser registrado como concluído após conferência explícita; nunca há botão de reexecutar comandos atribuídos ou concluídos. Estornos bloqueiam essas ações. A confirmação manual registra uma entrega que já ocorreu, não executa comando.
- **Cupons:** percentual (até 90%) ou valor em centavos, início/fim, pedido mínimo, limite global e produtos participantes; sem acúmulo. As cotações não reservam usos. A criação atômica do pedido reserva um uso até a expiração da sessão; pedidos pagos consomem o uso. Falha de rede ao criar a sessão conserva a reserva durante a mesma janela para permitir retentativa idempotente. Pedidos de teste não consomem o limite de produção. Cupons alterados/desativados não invalidam valores de pedidos já criados. O backend calcula e distribui os centavos entre linhas; a Stripe recebe preços finais por pacote com quantidade descrita no nome. O valor aprovado precisa corresponder exatamente ao snapshot com desconto. Nenhum cupom é criado ou ativado automaticamente no deploy.
- **Equipe:** somente o proprietário cria chaves individuais, exibidas uma única vez e armazenadas como hash SHA-256. Perfis: Conteúdo (blog), Design (editor e publicação + blog), Catálogo (produtos e cupons, preservando comandos), Atendimento (pedidos e notas, sem executar comandos). O backend aplica permissões por rota e filtra o retorno de state/config; colaboradores não recebem configuração de pagamentos, exportação, chaves ou gestão da equipe. Desativar tem efeito na próxima requisição. O ADMIN_TOKEN da Cloudflare continua sendo o acesso do proprietário; o deploy não cria colaboradores nem altera Secrets.

Os testes automatizados usam SQLite local, sessões Stripe simuladas e assinaturas locais. A conferência visual usa um ambiente descartável separado com pedidos e produtos fictícios; o harness não faz parte dos arquivos publicados. Uma cobrança Stripe real e comandos no Minecraft precisam ser validados no ambiente real, conforme as etapas acima.
