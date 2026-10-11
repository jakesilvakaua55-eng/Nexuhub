import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('v11.1: áudio da chamada tem sink persistente, desbloqueio e diagnóstico', async () => {
  const js = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  const css = await readFile(new URL('../public/styles.css', import.meta.url), 'utf8');
  assert.match(js, /let callAudioSink=null/);
  assert.match(js, /function ensureCallAudioSink/);
  assert.match(js, /global-call-audio-sink/);
  assert.match(js, /function attachRemoteAudio/);
  assert.match(js, /callAudioConstraints/);
  assert.match(js, /echoCancellation:true/);
  assert.match(js, /C\.audioUnlocked=true; callAudioUnlockToken=true/);
  assert.match(js, /function repairCallAudio/);
  assert.match(js, /Forçar áudio/);
  assert.match(js, /call-audio-debug/);
  assert.match(js, /áudio remoto/);
  assert.match(css, /v11\.1: saída de áudio persistente/);
});
