# NexHub v34 — Mega Atualização com Dados + Painel Admin + Selos Oficiais

Esta versão foi criada em cima do ZIP enviado pelo usuário: `NexHub-v32-Completo-com-dados.zip`.

## Importante sobre dados

Este pacote mantém a pasta `data/`, incluindo o banco SQLite e mídias enviados no ZIP base. Isso é útil para continuar o app sem perder contas, mensagens e arquivos.

Não compartilhe este ZIP publicamente, porque ele pode conter dados reais de usuários, mensagens, pagamentos, hashes e metadados de sessão/IP.

## Novidades principais

### 1. Painel admin rápido

No Painel do Criador foram adicionadas ações rápidas para:

- enviar VIP pelo nome de usuário;
- banir pelo nome de usuário;
- suspender pelo nome de usuário;
- remover banimento;
- remover suspensão;
- aplicar títulos oficiais;
- ver roadmap/ideias com Hikari.

### 2. VIP por nome de usuário

Novo endpoint:

```http
POST /api/creator/vip/quick
```

Exemplo:

```json
{
  "username": "usuario",
  "duration": "30",
  "note": "Pagamento confirmado"
}
```

Durações aceitas:

- `3`
- `10`
- `30`
- `forever`
- `infinito`

### 3. Banimento e suspensão por usuário

Novo endpoint:

```http
POST /api/creator/users/action-by-name
```

Exemplo suspensão:

```json
{
  "username": "usuario",
  "action": "suspend",
  "days": 3,
  "reason": "Quebra de regra"
}
```

Ações:

- `ban`
- `unban`
- `suspend`
- `unsuspend`

### 4. Lista de punidos

Novo endpoint:

```http
GET /api/creator/punishments
```

Lista contas banidas e suspensas.

### 5. Títulos e selos oficiais sem emoji

Novo sistema de badges reais, sem usar emoji como verificado.

Títulos disponíveis:

- Dono do NexHub
- Admin
- Moderador
- VIP
- Verificado
- Parceiro
- Influenciador
- Criador de Conteúdo
- Booster
- Bot Oficial
- Fundador
- Usuário Confiável

Endpoints:

```http
GET /api/creator/titles/catalog
GET /api/creator/titles
POST /api/creator/titles
DELETE /api/creator/titles/:userId/:titleId
```

### 6. Hikari integrada no projeto

Mascote oficial escolhida: **Hikari**.

Arquivos adicionados:

- `public/hikari-avatar.png`
- `public/hikari-mascote.png`
- `public/nexhub-logo-neon.png`

Endpoint:

```http
GET /api/mascot
```

### 7. Roadmap interno das ideias

Novo endpoint:

```http
GET /api/creator/roadmap
```

Inclui ideias planejadas:

- Painel Admin/Criador completo;
- títulos e selos oficiais;
- Hikari dentro do app;
- página Explorar servidores;
- loja de efeitos;
- recompensa diária e eventos.

### 8. QR Pix com fallback visual

O pacote `qrcode` continua no `package.json`. Em produção, rode:

```bash
npm install
```

Assim o QR Pix fica escaneável pelo pacote oficial. Se o pacote ainda não estiver instalado, o app mostra um SVG visual temporário e mantém o Pix copia-e-cola.

## Testes

Foram executados:

```bash
npm run check
npm test
```

Resultado: 27/27 testes passaram.
