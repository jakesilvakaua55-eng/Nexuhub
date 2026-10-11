import { existsSync, readFileSync } from 'node:fs';
const required = [
  'public/manifest.webmanifest', 'public/sw.js', 'public/icon-192.png', 'public/icon-512.png',
  'capacitor.config.json', 'platforms/android/README_ANDROID.md', 'platforms/ios/README_IOS.md', 'platforms/desktop/electron/main.cjs',
  'platforms/desktop/README_PC.md', 'PUBLICAR_ANDROID_IPHONE_PC.md'
];
let ok = true;
for (const file of required) {
  if (!existsSync(file)) { console.error('Faltando:', file); ok = false; }
}
try {
  const manifest = JSON.parse(readFileSync('public/manifest.webmanifest','utf8'));
  for (const key of ['name','short_name','start_url','display','icons']) if (!manifest[key]) { console.error('Manifest sem', key); ok = false; }
  if (!manifest.icons?.some(icon => icon.sizes === '512x512')) { console.error('Manifest precisa de ícone 512x512.'); ok = false; }
} catch (error) { console.error('Manifest inválido:', error.message); ok = false; }
if (!ok) process.exit(1);
console.log('Base PWA/Android/iPhone/PC verificada. Ainda é necessário gerar APK/AAB/IPA/instalador em ambiente próprio.');
