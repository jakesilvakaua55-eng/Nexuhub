// WebRTC ICE: configuração fica exclusivamente no servidor; nunca publique segredo TURN no JS.
import { createHmac } from 'node:crypto';
import { getMeteredIceServers, isMeteredConfigured } from './metered.js';

const DEFAULT_STUN = 'stun:stun.l.google.com:19302';

function list(value) {
  return String(value || '').split(',').map(v => v.trim()).filter(Boolean);
}

function validIceUrl(url, kind) {
  if (typeof url !== 'string' || url.length > 300 || /[\s@#]/.test(url)) return false;
  return kind === 'turn' ? /^turns?:[^/]+$/i.test(url) : /^stuns?:[^/]+$/i.test(url);
}

function uniq(items) {
  return [...new Set(items)];
}

function redactedUrls(urls) {
  return urls.map(url => url.replace(/([?&](?:transport|protocol)=)[^&]+/gi, '$1…'));
}

export function iceStatus(env = process.env) {
  const rawStun = list(env.STUN_URLS || DEFAULT_STUN);
  const rawTurn = list(env.TURN_URLS);
  const stunUrls = uniq(rawStun.filter(v => validIceUrl(v, 'stun')));
  const turnUrls = uniq(rawTurn.filter(v => validIceUrl(v, 'turn')));
  const invalidStun = rawStun.filter(v => !validIceUrl(v, 'stun'));
  const invalidTurn = rawTurn.filter(v => !validIceUrl(v, 'turn'));
  const secretOk = String(env.TURN_SHARED_SECRET || '').length >= 16;
  const staticOk = Boolean(env.TURN_USERNAME && env.TURN_CREDENTIAL);
  const meteredAppName = Boolean(String(env.METERED_APP_NAME || '').trim());
  const meteredApiKey = Boolean(String(env.METERED_TURN_API_KEY || '').trim());
  const meteredConfigured = isMeteredConfigured(env);
  const meteredPartial = meteredAppName !== meteredApiKey;
  const turnConfigured = meteredConfigured || (turnUrls.length > 0 && (secretOk || staticOk));
  const relayForced = env.FORCE_TURN === 'true' && turnConfigured;
  const authMode = meteredConfigured ? 'metered' : secretOk ? 'temporary' : staticOk ? 'static' : 'missing';
  const warnings = [];
  if (meteredPartial) warnings.push('A configuração Metered está incompleta. Configure METERED_APP_NAME e METERED_TURN_API_KEY.');
  if (!turnUrls.length && !meteredConfigured) warnings.push('TURN_URLS não está configurado. Em internet móvel ou Wi‑Fi restrito, a call pode falhar.');
  if (turnUrls.length && !secretOk && !staticOk) warnings.push('TURN_URLS existe, mas faltam TURN_SHARED_SECRET ou TURN_USERNAME/TURN_CREDENTIAL.');
  if (invalidTurn.length) warnings.push('Algumas URLs TURN foram ignoradas por formato inválido.');
  if (invalidStun.length) warnings.push('Algumas URLs STUN foram ignoradas por formato inválido.');
  if (env.FORCE_TURN === 'true' && !turnConfigured) warnings.push('FORCE_TURN=true está ligado, mas TURN não está completo; o app vai usar política normal.');
  if (turnConfigured && !meteredConfigured && !turnUrls.some(v => /^turns:/i.test(v))) warnings.push('TURN está configurado sem turns:. Para produção, prefira também uma URL TLS turns:.');
  return {
    app: 'NexHub',
    provider: meteredConfigured ? 'Metered' : turnConfigured ? 'TURN próprio/alternativo' : 'nenhum',
    stunConfigured: stunUrls.length > 0,
    turnConfigured,
    turnEnabled: turnConfigured,
    relayForced,
    iceTransportPolicy: relayForced ? 'relay' : 'all',
    authMode,
    stunUrlCount: stunUrls.length,
    turnUrlCount: turnUrls.length,
    urls: { stun: redactedUrls(stunUrls), turn: redactedUrls(turnUrls) },
    warnings,
    advice: meteredConfigured
      ? 'Metered está configurado. O servidor valida a API antes de entregar a configuração ICE para a chamada.'
      : turnConfigured
      ? (relayForced ? 'TURN está configurado e o tráfego será forçado pelo relay para diagnóstico.' : 'TURN está pronto. Use FORCE_TURN=true apenas para diagnosticar redes difíceis.')
      : 'Configure TURN_URLS e credenciais no .env para melhorar chamadas em dados móveis, NAT restrito e Wi‑Fi bloqueado.'
  };
}

export function iceConfiguration(userId, env = process.env, time = Date.now()) {
  const status = iceStatus(env);
  const stunUrls = uniq(list(env.STUN_URLS || DEFAULT_STUN).filter(v => validIceUrl(v, 'stun')));
  const turnUrls = uniq(list(env.TURN_URLS).filter(v => validIceUrl(v, 'turn')));
  const iceServers = stunUrls.map(urls => ({ urls }));
  if (turnUrls.length) {
    const secret = env.TURN_SHARED_SECRET || '';
    let username, credential;
    if (secret.length >= 16) {
      const ttl = Math.max(600, Math.min(86400, Number(env.TURN_TTL_SECONDS) || 7200));
      username = `${Math.floor(time / 1000) + ttl}:${String(userId).replace(/[^a-zA-Z0-9-]/g, '')}`;
      credential = createHmac('sha1', secret).update(username).digest('base64');
    } else if (env.TURN_USERNAME && env.TURN_CREDENTIAL) {
      username = env.TURN_USERNAME;
      credential = env.TURN_CREDENTIAL;
    }
    if (username && credential) iceServers.push({ urls: turnUrls, username, credential });
  }
  const turnEnabled = iceServers.some(s => s.username && s.credential);
  const iceTransportPolicy = env.FORCE_TURN === 'true' && turnEnabled ? 'relay' : 'all';
  return {
    iceServers,
    turnEnabled,
    iceTransportPolicy,
    relayForced: iceTransportPolicy === 'relay',
    turnStatus: { ...status, turnEnabled, turnConfigured: turnEnabled, iceTransportPolicy, relayForced: iceTransportPolicy === 'relay' }
  };
}

export async function resolveIceConfiguration(userId, env = process.env, time = Date.now(), meteredOptions = {}) {
  try {
    const metered = await getMeteredIceServers(env, meteredOptions);
    if (!metered) return iceConfiguration(userId, env, time);

    const relayForced = env.FORCE_TURN === 'true';
    const turnStatus = {
      app: 'NexHub',
      provider: 'Metered',
      meteredConfigured: true,
      meteredAvailable: true,
      stunConfigured: metered.stunUrlCount > 0,
      turnConfigured: true,
      turnEnabled: true,
      relayForced,
      iceTransportPolicy: relayForced ? 'relay' : 'all',
      authMode: 'metered',
      stunUrlCount: metered.stunUrlCount,
      turnUrlCount: metered.turnUrlCount,
      urls: {
        stun: redactedUrls(metered.urls.stun),
        turn: redactedUrls(metered.urls.turn)
      },
      warnings: metered.urls.turn.some(url => /^turns:/i.test(url))
        ? []
        : ['A configuração Metered não incluiu uma URL turns: com TLS.'],
      advice: relayForced
        ? 'Metered está ativo e o tráfego será forçado pelo relay para diagnóstico.'
        : 'Credenciais TURN do Metered carregadas. Use FORCE_TURN=true apenas para diagnosticar redes difíceis.'
    };
    return {
      iceServers: metered.iceServers,
      turnEnabled: true,
      iceTransportPolicy: turnStatus.iceTransportPolicy,
      relayForced,
      turnStatus
    };
  } catch (error) {
    const fallback = iceConfiguration(userId, env, time);
    if (!fallback.turnEnabled) throw error;

    const warning = error instanceof Error
      ? error.message
      : 'Falha ao carregar credenciais da Metered.';
    const turnStatus = {
      ...fallback.turnStatus,
      provider: 'TURN alternativo',
      meteredConfigured: true,
      meteredAvailable: false,
      authMode: String(env.TURN_SHARED_SECRET || '').length >= 16 ? 'temporary' : 'static',
      warnings: [`Metered indisponível; usando TURN alternativo. ${warning}`, ...fallback.turnStatus.warnings]
    };
    return { ...fallback, turnStatus };
  }
}

export function turnSetupGuide(env = process.env) {
  const status = iceStatus(env);
  const exampleEnv = [
    '# NexHub — Metered TURN para chamadas WebRTC',
    'METERED_APP_NAME=nome-do-app',
    '# Guarde METERED_TURN_API_KEY no gerenciador de Secrets, nunca no frontend.',
    'METERED_TURN_API_KEY=configure-no-gerenciador-de-secrets',
    '# Opcional; sem esta variável, o Metered usa a região padrão da credencial.',
    '# METERED_REGION=global',
    'FORCE_TURN=false',
    '',
    '# Alternativa: TURN próprio com segredo compartilhado',
    'STUN_URLS=stun:stun.l.google.com:19302',
    'TURN_URLS=turn:turn.seudominio.com:3478?transport=udp,turn:turn.seudominio.com:3478?transport=tcp,turns:turn.seudominio.com:5349?transport=tcp',
    'TURN_SHARED_SECRET=COLE_AQUI_UM_SEGREDO_FORTE_DE_32_CARACTERES_OU_MAIS',
    'TURN_TTL_SECONDS=7200'
  ].join('\n');
  const staticExampleEnv = [
    '# Alternativa com provedor que entrega usuário/senha fixos',
    'TURN_URLS=turn:turn.provedor.com:3478?transport=udp,turns:turn.provedor.com:5349?transport=tcp',
    'TURN_USERNAME=SEU_USUARIO_TURN',
    'TURN_CREDENTIAL=SUA_SENHA_TURN',
    'FORCE_TURN=false'
  ].join('\n');
  const coturnConfig = [
    '# /etc/turnserver.conf — exemplo seguro para coturn',
    'listening-port=3478',
    'tls-listening-port=5349',
    'fingerprint',
    'lt-cred-mech',
    'use-auth-secret',
    'static-auth-secret=COLE_O_MESMO_VALOR_DO_TURN_SHARED_SECRET',
    'realm=turn.seudominio.com',
    'server-name=turn.seudominio.com',
    'no-multicast-peers',
    'no-cli',
    'cert=/etc/letsencrypt/live/turn.seudominio.com/fullchain.pem',
    'pkey=/etc/letsencrypt/live/turn.seudominio.com/privkey.pem'
  ].join('\n');
  const missing = [];
  if (!status.turnConfigured) {
    if (!String(env.METERED_APP_NAME || '').trim()) missing.push('METERED_APP_NAME');
    if (!String(env.METERED_TURN_API_KEY || '').trim()) missing.push('METERED_TURN_API_KEY');
    if (!status.turnUrlCount) missing.push('TURN_URLS');
    if (status.authMode === 'missing') missing.push('TURN_SHARED_SECRET ou TURN_USERNAME/TURN_CREDENTIAL');
  } else if (status.provider !== 'Metered' && status.authMode === 'missing') {
    missing.push('TURN_SHARED_SECRET ou TURN_USERNAME/TURN_CREDENTIAL');
  }
  const checklist = [
    'No Metered, configure METERED_APP_NAME com a parte anterior a .metered.live.',
    'Guarde a API Key da credencial TURN em Secrets como METERED_TURN_API_KEY; não use a Secret Key geral da conta.',
    'O NexHub busca as URLs ICE no servidor Metered e não envia a API Key ao navegador.',
    'Como alternativa, crie um servidor TURN próprio e configure TURN_URLS e as credenciais no servidor.',
    'Reiniciar o servidor do NexHub depois de alterar variáveis.',
    'Abrir Configurações > Teste de áudio e call > Verificar TURN.',
    'Testar uma call em Wi‑Fi e outra em dados móveis.',
    'Usar FORCE_TURN=true só para diagnóstico; depois voltar para false.'
  ];
  return {
    app: 'NexHub',
    status,
    missing,
    ready: status.turnConfigured,
    exampleEnv,
    staticExampleEnv,
    coturnConfig,
    checklist,
    notes: [
      'O NexHub nunca envia a API Key Metered nem TURN_SHARED_SECRET para o frontend.',
      'A resposta contém somente a configuração ICE e as credenciais TURN necessárias para WebRTC.',
      'Com TURN_SHARED_SECRET, o servidor gera credenciais temporárias para cada usuário.',
      'URLs turn: ajudam, mas em produção também é recomendado ter turns: com TLS.'
    ]
  };
}
