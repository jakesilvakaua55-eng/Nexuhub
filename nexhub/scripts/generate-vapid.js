#!/usr/bin/env node
import { createECDH } from 'node:crypto';

function base64url(buffer){
  return Buffer.from(buffer).toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
function arg(name, fallback=''){
  const found=process.argv.find(v=>v.startsWith(`--${name}=`));
  return found ? found.slice(name.length+3).trim() : fallback;
}
const subject=arg('subject', process.env.VAPID_SUBJECT || 'mailto:admin@nexhub.local');
if(!(/^mailto:[^\s@]+@[^\s@]+\.[^\s@]+$|^https:\/\//i.test(subject))){
  console.error('Use --subject=mailto:email@dominio.com ou --subject=https://seu-site.com');
  process.exit(1);
}
const ecdh=createECDH('prime256v1');
ecdh.generateKeys();
const publicKey=base64url(ecdh.getPublicKey(null,'uncompressed'));
const privateKey=base64url(ecdh.getPrivateKey());
console.log('# Cole estas variáveis no Secrets/.env da hospedagem do NexHub');
console.log(`VAPID_PUBLIC_KEY=${publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${privateKey}`);
console.log(`VAPID_SUBJECT=${subject}`);
console.log('\n# Depois reinicie o servidor e abra Configurações > Notificações > Verificar push.');
