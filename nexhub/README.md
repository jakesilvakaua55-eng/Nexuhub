# NexHub v35 — código e interface

Este pacote contém o código, a interface, scripts e testes do NexHub. O banco SQLite, as mídias de usuários e o arquivo de dados sensíveis do ZIP original foram deixados de fora desta cópia de trabalho.

## Como executar

Requisitos: Node.js 22.13 ou superior.

```bash
pnpm install
pnpm --filter @workspace/nexhub run check
pnpm --filter @workspace/nexhub test
pnpm --filter @workspace/nexhub start
```

O servidor usa a porta definida por `PORT` (padrão `3000`) e inicia em `0.0.0.0`. O banco incluído fica em `data/nexo.sqlite`; as mídias ficam em `data/media/`.

## Configuração

Chaves Pix e outros secrets do ambiente **não estão incluídos**. Configure-os pelo gerenciador de Secrets da hospedagem:

- `PIX_RANDOM_KEY`: chave Pix usada para montar o QR Code e o Pix copia-e-cola.
- `PIX_MERCHANT_NAME` e `PIX_MERCHANT_CITY`: identificação opcional do Pix.
- `PORT` e `HOST`: porta e endereço do servidor.
- `DB_PATH` e `MEDIA_PATH`: caminhos opcionais para persistência.
- `SITE_ORIGIN`: origem fixa do site, recomendada quando houver domínio próprio.
- `TRUST_PROXY=true`: use somente atrás de um proxy confiável.
- `PIX_WEBHOOK_SECRET`: só é necessário com um provedor confiável de confirmação automática; a confirmação manual não precisa dele.
- `METERED_APP_NAME`: parte do domínio antes de `.metered.live` (ex.: `nexhub`).
- `METERED_TURN_API_KEY`: API Key da credencial TURN, guardada somente no gerenciador de Secrets; não use a Secret Key geral da conta.
- `METERED_REGION`: região opcional da credencial, se configurada no Metered.
- `FORCE_TURN=true`: força relay apenas para diagnóstico; deixe `false` no uso normal.

O servidor consulta `https://<METERED_APP_NAME>.metered.live/api/v1/turn/credentials`, armazena o resultado em cache por um minuto e envia ao navegador somente os servidores ICE e as credenciais TURN necessárias para WebRTC. A API Key nunca é enviada ao navegador nem incluída em logs ou respostas.

Se o Metered estiver indisponível e houver uma configuração TURN alternativa (`TURN_URLS` e credenciais), o app a usa e mostra o aviso no diagnóstico. Sem alternativa, a chamada recebe um erro claro em vez de falhar silenciosamente.

## Importante: dados sensíveis

O banco exportado do ZIP original pode conter e-mails, mensagens, registros de pagamentos, hashes de senha, segredos e códigos de recuperação de autenticação em duas etapas, além de metadados de sessão/IP. Ele não foi copiado para este projeto. Guarde o ZIP original em local privado e não o publique nem compartilhe sem autorização.

As variáveis e secrets configurados na hospedagem não estavam incluídos no ZIP. Ao executar este código, o servidor cria um banco local novo em `data/nexo.sqlite`; os dados originais não são restaurados.


## v35 Ideias completas

Inclui Explorar, Missões, Loja de efeitos, eventos semanais, ranking global, servidores verificados, status de atividade, NexBot oficial, central de notificações e denúncias melhoradas.
