import test from 'node:test';
import assert from 'node:assert/strict';
import { turnSetupGuide } from '../src/ice.js';

test('v25: assistente TURN não vaza segredo real', () => {
  const env = {
    TURN_URLS: 'turn:turn.example.com:3478?transport=udp',
    TURN_SHARED_SECRET: 'segredo-real-que-nao-pode-vazar-123456',
    FORCE_TURN: 'false'
  };
  const guide = turnSetupGuide(env);
  assert.equal(guide.ready, true);
  const serialized = JSON.stringify(guide);
  assert.equal(serialized.includes(env.TURN_SHARED_SECRET), false);
  assert.ok(guide.exampleEnv.includes('TURN_SHARED_SECRET=COLE_AQUI'));
  assert.ok(guide.coturnConfig.includes('static-auth-secret=COLE'));
});

test('v25: assistente TURN lista pendências quando não configurado', () => {
  const guide = turnSetupGuide({});
  assert.equal(guide.ready, false);
  assert.ok(guide.missing.includes('TURN_URLS'));
  assert.ok(guide.checklist.length >= 5);
  assert.ok(guide.staticExampleEnv.includes('TURN_USERNAME'));
});
