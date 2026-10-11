import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('v11: efeitos visuais do perfil e estados de chamada sem regressão WebRTC', async () => {
  const js = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  const css = await readFile(new URL('../public/styles.css', import.meta.url), 'utf8');
  assert.match(js, /profile-effect-layer-full/);
  assert.match(js, /profile-fx-particle/);
  assert.match(js, /includes\(effect\)\?22:28/);
  assert.match(css, /v11 — efeitos de perfil/);
  assert.match(css, /@keyframes profileFxDrift/);
  assert.match(js, /panel\.dataset\.callState=callPhase/);
  assert.match(js, /aria-live/);
  assert.match(css, /call-status-label\.reconnecting/);
  assert.match(css, /prefers-reduced-motion:reduce/);
  assert.match(js, /function startCallSync/);
  assert.match(js, /setInterval\(\(\)=>\{/);
  assert.match(js, /ensureCallSupport/);
  assert.match(js, /oniceconnectionstatechange/);
  assert.match(js, /call\.lastError/);
});
