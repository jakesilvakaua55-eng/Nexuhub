import test from 'node:test';
import assert from 'node:assert/strict';
import { iceConfiguration, iceStatus } from '../src/ice.js';

test('v24: status TURN não vaza segredo e força relay quando configurado', () => {
  const env = {
    STUN_URLS: 'stun:stun.example.com:19302',
    TURN_URLS: 'turn:turn.example.com:3478?transport=udp,turns:turn.example.com:5349?transport=tcp',
    TURN_SHARED_SECRET: 'segredo-super-forte-para-coturn',
    TURN_TTL_SECONDS: '7200',
    FORCE_TURN: 'true'
  };
  const status = iceStatus(env);
  assert.equal(status.turnConfigured, true);
  assert.equal(status.relayForced, true);
  assert.equal(status.authMode, 'temporary');
  assert.equal(JSON.stringify(status).includes(env.TURN_SHARED_SECRET), false);
  const config = iceConfiguration('user_123', env, 1700000000000);
  assert.equal(config.turnEnabled, true);
  assert.equal(config.iceTransportPolicy, 'relay');
  assert.equal(config.iceServers.some(s => s.username && s.credential), true);
  assert.equal(JSON.stringify(config.turnStatus).includes(env.TURN_SHARED_SECRET), false);
});

test('v24: avisa quando FORCE_TURN está ligado sem credenciais TURN', () => {
  const status = iceStatus({ TURN_URLS: 'turn:turn.example.com:3478?transport=udp', FORCE_TURN: 'true' });
  assert.equal(status.turnConfigured, false);
  assert.equal(status.relayForced, false);
  assert.ok(status.warnings.some(w => /faltam/i.test(w)));
});
