import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clearMeteredIceCache,
  getMeteredIceServers,
  MeteredTurnError
} from '../src/metered.js';
import { resolveIceConfiguration } from '../src/ice.js';

const env = {
  METERED_APP_NAME: 'nexhub-test',
  METERED_TURN_API_KEY: 'metered-credential-key-test',
  METERED_REGION: 'us_east'
};

const response = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body
});

test('Metered: busca credenciais no host correto e não devolve a API Key', async () => {
  clearMeteredIceCache();
  let requestedUrl;
  const result = await getMeteredIceServers(env, {
    now: 1_000,
    fetchImpl: async url => {
      requestedUrl = new URL(url);
      return response([
        { urls: 'stun:stun.relay.metered.ca:80' },
        {
          urls: ['turn:global.relay.metered.ca:443', 'turns:global.relay.metered.ca:443?transport=tcp'],
          username: 'turn-user',
          credential: 'turn-pass'
        }
      ]);
    }
  });

  assert.equal(requestedUrl.hostname, 'nexhub-test.metered.live');
  assert.equal(requestedUrl.pathname, '/api/v1/turn/credentials');
  assert.equal(requestedUrl.searchParams.get('apiKey'), env.METERED_TURN_API_KEY);
  assert.equal(requestedUrl.searchParams.get('region'), 'us_east');
  assert.equal(result.turnUrlCount, 2);
  assert.equal(result.stunUrlCount, 1);
  assert.equal(JSON.stringify(result).includes(env.METERED_TURN_API_KEY), false);
});

test('Metered: mantém apenas ICE URLs válidas e exige usuário/senha TURN', async () => {
  clearMeteredIceCache();
  const result = await getMeteredIceServers(env, {
    fetchImpl: async () => response([
      { urls: ['stun:stun.example.com:3478', 'javascript:alert(1)'] },
      { urls: 'turn:relay.metered.ca:443', username: 'u', credential: 'p' }
    ])
  });
  assert.equal(result.stunUrlCount, 1);
  assert.equal(result.turnUrlCount, 1);
  assert.deepEqual(result.iceServers[0].urls, ['stun:stun.example.com:3478']);
  assert.deepEqual(result.iceServers[1].urls, ['turn:relay.metered.ca:443']);

  clearMeteredIceCache();
  await assert.rejects(
    () => getMeteredIceServers(env, { fetchImpl: async () => response([{ urls: 'turn:relay.metered.ca:443' }]) }),
    error => error instanceof MeteredTurnError && /credenciais TURN utilizáveis/.test(error.message)
  );
});

test('Metered: erros de autenticação não incluem chave nem URL da requisição', async () => {
  clearMeteredIceCache();
  await assert.rejects(
    () => getMeteredIceServers(env, { fetchImpl: async () => response({ error: 'Invalid API Key' }, 401) }),
    error => {
      assert.equal(error.status, 502);
      assert.match(error.message, /API Key TURN/);
      assert.equal(error.message.includes(env.METERED_TURN_API_KEY), false);
      assert.equal(error.message.includes('nexhub-test.metered.live'), false);
      return true;
    }
  );
});

test('Metered: configuração parcial e região inválida falham com mensagem segura', async () => {
  await assert.rejects(
    () => getMeteredIceServers({ METERED_APP_NAME: 'nexhub-test' }),
    /integração Metered está incompleta/
  );
  await assert.rejects(
    () => getMeteredIceServers({ ...env, METERED_REGION: 'unknown-region' }),
    /METERED_REGION/
  );
});

test('NexHub: resolve Metered, aplica relay forçado e usa TURN estático com aviso se Metered falhar', async () => {
  clearMeteredIceCache();
  const metered = await resolveIceConfiguration('user-1', {
    ...env,
    FORCE_TURN: 'true'
  }, 1_000, {
    forceRefresh: true,
    fetchImpl: async () => response([
      { urls: 'turns:global.relay.metered.ca:443?transport=tcp', username: 'u', credential: 'p' }
    ])
  });
  assert.equal(metered.turnEnabled, true);
  assert.equal(metered.iceTransportPolicy, 'relay');
  assert.equal(metered.turnStatus.authMode, 'metered');
  assert.equal(JSON.stringify(metered.turnStatus).includes(env.METERED_TURN_API_KEY), false);

  clearMeteredIceCache();
  const fallback = await resolveIceConfiguration('user-1', {
    ...env,
    TURN_URLS: 'turn:fallback.example.com:3478?transport=udp',
    TURN_USERNAME: 'fallback-user',
    TURN_CREDENTIAL: 'fallback-pass'
  }, 1_000, {
    forceRefresh: true,
    fetchImpl: async () => response({}, 503)
  });
  assert.equal(fallback.turnEnabled, true);
  assert.equal(fallback.turnStatus.authMode, 'static');
  assert.ok(fallback.turnStatus.warnings.some(warning => /Metered indisponível/.test(warning)));
});
