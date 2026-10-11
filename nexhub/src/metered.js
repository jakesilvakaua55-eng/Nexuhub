import { createHash } from 'node:crypto';

const CACHE_TTL_MS = 60_000;
const REQUEST_TIMEOUT_MS = 5_000;
const APP_NAME_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;
const REGIONS = new Set([
  'global', 'north_america', 'europe', 'eu', 'asia', 'oceania',
  'us_west', 'us_central', 'us_east', 'canada_central', 'canada_east',
  'europe_west', 'europe_central', 'asia_west', 'asia_east', 'middle_east',
  'canada', 'usa', 'uk', 'singapore', 'india', 'australia', 'france',
  'germany', 'italy', 'japan', 'sweden', 'spain', 'netherlands', 'qatar',
  'standard'
]);

let cache = null;
const inFlight = new Map();

export class MeteredTurnError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.name = 'MeteredTurnError';
    this.status = status;
  }
}

function cloneServers(servers) {
  return servers.map(server => ({ ...server, urls: [...server.urls] }));
}

function validIceUrl(url) {
  return typeof url === 'string'
    && url.length <= 300
    && !/[\s@#]/.test(url)
    && /^(?:stun|stuns|turn|turns):[^/]+$/i.test(url);
}

function normalizeIceServers(payload) {
  const entries = Array.isArray(payload) ? payload : payload?.iceServers;
  if (!Array.isArray(entries)) {
    throw new MeteredTurnError('A Metered retornou uma configuração ICE inválida.');
  }

  const result = [];
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue;
    const rawUrls = Array.isArray(entry.urls) ? entry.urls : [entry.urls];
    const urls = [...new Set(rawUrls.filter(validIceUrl))];
    const stunUrls = urls.filter(url => /^stuns?:/i.test(url));
    const turnUrls = urls.filter(url => /^turns?:/i.test(url));

    if (stunUrls.length) result.push({ urls: stunUrls });

    const username = typeof entry.username === 'string' ? entry.username.trim() : '';
    const credential = typeof entry.credential === 'string' ? entry.credential.trim() : '';
    if (turnUrls.length && username && credential) {
      result.push({ urls: turnUrls, username, credential });
    }
  }

  if (!result.some(server => server.username && server.credential
    && server.urls.some(url => /^turns?:/i.test(url)))) {
    throw new MeteredTurnError('A Metered não retornou credenciais TURN utilizáveis.');
  }
  return result;
}

function serverSummary(iceServers) {
  const stun = [...new Set(iceServers.flatMap(server => server.urls)
    .filter(url => /^stuns?:/i.test(url)))];
  const turn = [...new Set(iceServers.flatMap(server => server.urls)
    .filter(url => /^turns?:/i.test(url)))];
  return {
    iceServers,
    stunUrlCount: stun.length,
    turnUrlCount: turn.length,
    urls: { stun, turn }
  };
}

function getSettings(env) {
  const appName = String(env.METERED_APP_NAME || '').trim();
  const apiKey = String(env.METERED_TURN_API_KEY || '').trim();
  const region = String(env.METERED_REGION || '').trim();
  if (!appName && !apiKey) return null;
  if (!appName || !apiKey) {
    throw new MeteredTurnError(
      'A integração Metered está incompleta. Configure METERED_APP_NAME e METERED_TURN_API_KEY.'
    );
  }
  if (!APP_NAME_PATTERN.test(appName)) {
    throw new MeteredTurnError('METERED_APP_NAME deve ser apenas o subdomínio do Metered.');
  }
  if (region && !REGIONS.has(region)) {
    throw new MeteredTurnError('METERED_REGION não é uma região aceita pela Metered.');
  }
  return { appName, apiKey, region };
}

export function isMeteredConfigured(env = process.env) {
  return Boolean(String(env.METERED_APP_NAME || '').trim()
    && String(env.METERED_TURN_API_KEY || '').trim());
}

export async function getMeteredIceServers(
  env = process.env,
  { fetchImpl = globalThis.fetch, now = Date.now(), forceRefresh = false } = {}
) {
  const settings = getSettings(env);
  if (!settings) return null;
  if (typeof fetchImpl !== 'function') {
    throw new MeteredTurnError('Este servidor Node.js não oferece suporte a chamadas HTTPS.');
  }

  const cacheKey = createHash('sha256')
    .update(`${settings.appName}\0${settings.apiKey}\0${settings.region}`)
    .digest('hex');
  if (!forceRefresh && cache?.key === cacheKey && now - cache.fetchedAt < CACHE_TTL_MS) {
    return serverSummary(cloneServers(cache.iceServers));
  }
  if (!forceRefresh && inFlight.has(cacheKey)) {
    return serverSummary(cloneServers(await inFlight.get(cacheKey)));
  }

  const request = (async () => {
    const endpoint = new URL(`https://${settings.appName}.metered.live/api/v1/turn/credentials`);
    endpoint.searchParams.set('apiKey', settings.apiKey);
    if (settings.region) endpoint.searchParams.set('region', settings.region);

    let response;
    try {
      response = await fetchImpl(endpoint, {
        method: 'GET',
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
      });
    } catch {
      throw new MeteredTurnError('Não foi possível conectar à API TURN da Metered.');
    }

    if (response.status === 401 || response.status === 403) {
      throw new MeteredTurnError('A Metered recusou a API Key TURN. Confira a chave da credencial no painel.');
    }
    if (!response.ok) {
      throw new MeteredTurnError('A API TURN da Metered está indisponível no momento.');
    }

    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new MeteredTurnError('A Metered retornou uma resposta inválida.');
    }
    const iceServers = normalizeIceServers(payload);
    cache = { key: cacheKey, fetchedAt: Date.now(), iceServers: cloneServers(iceServers) };
    return iceServers;
  })();

  inFlight.set(cacheKey, request);
  try {
    return serverSummary(cloneServers(await request));
  } finally {
    inFlight.delete(cacheKey);
  }
}

export function clearMeteredIceCache() {
  cache = null;
  inFlight.clear();
}
