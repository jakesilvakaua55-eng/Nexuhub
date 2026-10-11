# Guia v34 — Mega atualização do NexHub

## O que esta versão junta

Esta versão junta o arquivo enviado com dados reais (`data/nexo.sqlite` e `data/media`) com uma nova atualização grande focada no painel do criador e na identidade visual do app.

## Onde encontrar o painel

No app, o botão do painel aparece apenas para conta criadora/admin:

```txt
Painel do Criador
```

Usuário comum e VIP não acessam esse painel.

## Fluxo recomendado

### Dar VIP

1. Abra Painel do Criador.
2. Toque em **VIP por usuário**.
3. Digite o nome de usuário.
4. Escolha 3, 10, 30 dias ou infinito.
5. Confirme.

A pessoa recebe o VIP na hora.

### Banir ou suspender

1. Abra Painel do Criador.
2. Toque em **Ban/Suspensão por usuário**.
3. Digite o nome de usuário.
4. Escolha banir, suspender, remover ban ou remover suspensão.
5. Coloque motivo.
6. Confirme.

Ban/suspensão derruba sessões da conta.

### Aplicar título ou selo

1. Abra Painel do Criador.
2. Toque em **Títulos e Selos**.
3. Digite o usuário.
4. Escolha o título.
5. Escolha duração.
6. Confirme.

Os selos aparecem sem emoji simples, como badges visuais.

## Segurança

- VIP continua separado de painel admin.
- Usuário VIP não ganha ferramentas de administração.
- IP/aparelho e dados sensíveis ficam só no painel admin.
- Banimento/suspensão são registrados no log.
- Títulos oficiais são controlados pelo criador.

## Atenção

Como este ZIP contém banco de dados e mídia, não envie para outras pessoas.
