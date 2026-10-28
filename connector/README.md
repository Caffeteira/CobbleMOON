# CobbleMOON Store Bridge 0.1.0 — Fabric 1.21.1

Mod apenas no servidor. Requer Java 21 e Fabric API. Usa comandos já instalados no servidor; não depende diretamente das classes do Cobblemon. Não instala nada no cliente e não abre porta HTTP/RCON.

## Compilar

`gradle --no-daemon build` com Gradle 8.10.2 e Java 21. O workflow **Build Fabric Store Bridge** também gera o artefato no GitHub Actions. Instale o JAR sem o sufixo `-sources` em `mods/`.

## Ativar

1. Inicie o servidor uma vez para criar `config/cobblemoon-store/config.json`.
2. Pare o servidor. Preencha `siteUrl` com a URL HTTPS do site e `bridgeToken` com o MESMO segredo `BRIDGE_TOKEN` cadastrado no Worker. Não use ADMIN_TOKEN.
3. Mude `enabled` para `true`. Preserve `serverId` e a pasta `ledger` em reinicializações, atualizações e backups.
4. Reinicie. O mod consulta a loja a cada 30 segundos, sem bloquear o tick com requisições de rede.
5. No painel, cadastre um produto simples de teste, preço e comando `give {player} minecraft:diamond 1`, ative-o e use a entrega de teste estando online.

As entregas aguardam o jogador entrar. O UUID é vinculado na primeira atribuição, usando o jogador conhecido pelo próprio servidor. Para servidores sem autenticação oficial, a segurança da identidade depende também do sistema de login do servidor.

Cada comando tem ID próprio. O registro local é sincronizado no disco antes da execução. Se houver queda entre o comando e a confirmação, a entrega fica em revisão; o mod não repete o efeito automaticamente. Não exclua o ledger e não restaure backups antigos desse diretório sem reconciliar com os pedidos da loja.

O retorno de sucesso representa o resultado reportado pelo comando do Minecraft. Comandos de outros mods podem ter efeitos assíncronos ou retornar sucesso sem comprovar o conteúdo do inventário. Valide cada comando num servidor de testes antes de vender. Em falhas, confira o console e o histórico antes de qualquer compensação manual.

A loja recebe confirmação assinada da Stripe antes de gerar a fila. O conector não processa pagamentos: ele consulta e confirma os comandos. As vendas só abrem após configurar as credenciais no Worker e testar pagamento e entrega.
