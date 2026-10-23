# CobbleMOON — site, administração e integração de entrega

## Estado desta versão

- Painel: `/admin/`. Produtos, preços em BRL, benefícios, duração, imagens, comandos, exibição do catálogo, IP/Discord/modpack, texto da página inicial, pedidos, entregas, status do servidor e exportação JSON.
- Backend persistente: Cloudflare Worker + Durable Object com armazenamento SQLite. Migração automática pelo Wrangler, sem banco externo. Sujeito aos limites do plano Cloudflare da conta.
- Conector: mod server-side Fabric 1.21.1 / Java 21 em `connector/`.
- **Checkout e webhooks reais DESATIVADOS. Nenhum provedor escolhido. Nenhuma cobrança é criada.** A integração com o provedor, validação das notificações e testes de compra/reembolso ainda precisam ser implementados após a escolha.
- A entrega de teste executa comandos reais e é identificada como teste, nunca como receita ou pagamento confirmado.
- O painel cobre as configurações descritas acima. Pokédex, time local e layout/CSS continuam sendo recursos do código; não há editor visual de todas as páginas nesta versão.

## Cloudflare: ativar o painel

O comando já configurado no projeto continua funcionando:

`npx wrangler deploy --name cobblemoon --assets . --compatibility-date 2026-10-19`

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

## Verificação

`npm test` — autenticação, conflito de edição, preço calculado no backend, limites, comandos/URLs inválidos, ausência de checkout falso, fila para jogador online e confirmação idempotente.

`gradle --no-daemon build` em `connector/` — compila o mod com Java 21 e Gradle 8.10.2. O GitHub Actions também gera o JAR em artefato.

Sem teste em um servidor Minecraft real, não é possível validar a entrega dos comandos específicos de cada mod instalado.
