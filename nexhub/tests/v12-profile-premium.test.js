import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('v12: perfil premium tem galeria de efeitos e estilos novos inspirados nas referências', () => {
  const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../public/styles.css', import.meta.url), 'utf8');
  const server = readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');
  for (const effect of ['premium_purple','galaxy_pulse','neon_grid','soft_gradient']) {
    assert.match(app, new RegExp(effect));
    assert.match(server, new RegExp(effect));
    assert.match(css, new RegExp('profile-effect-' + effect));
  }
  assert.match(app, /effect-gallery/);
  assert.match(app, /profile-live-preview/);
  assert.match(css, /profile-avatar-decoration/);
  assert.match(css, /profile-badges/);
});
