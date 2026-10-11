import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

async function withApp(fn){
  const dir=mkdtempSync(join(tmpdir(),'nexhub-v30-'));
  process.env.DB_PATH=join(dir,'test.sqlite');
  process.env.MEDIA_PATH=join(dir,'media');
  process.env.NODE_ENV='test';
  process.env.PIX_RANDOM_KEY='11111111-1111-4111-8111-111111111111';
  process.env.PIX_MERCHANT_NAME='NEXHUB VIP';
  process.env.PIX_MERCHANT_CITY='BRASIL';
  process.env.PIX_WEBHOOK_SECRET='segredo-pix-v30';
  process.env.PIX_PROVIDER='standard-webhook';
  const mod=await import('../src/server.js?case='+Math.random());
  const server=mod.createApp();
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  let cookie='';
  async function api(route,method='GET',body,headers={}){
    const res=await fetch(base+route,{method,headers:{...(cookie?{Cookie:cookie}:{}),...(body!==undefined?{'Content-Type':'application/json'}:{}),...headers},body:body!==undefined?JSON.stringify(body):undefined});
    const set=res.headers.get('set-cookie');if(set&&set.startsWith('nexo_session='))cookie=set.split(';')[0];
    return {status:res.status,data:await res.json().catch(()=>({}))};
  }
  try{await fn({api,base});}
  finally{await new Promise(resolve=>server.close(resolve));rmSync(dir,{recursive:true,force:true});}
}

test('v30: setup do webhook Pix fica pronto e ativa VIP somente com referência, valor e segredo corretos',async()=>withApp(async({api,base})=>{
  const reg=await api('/api/register','POST',{username:'vip_webhook_v30',email:'vip-v30@example.com',password:'safe_password1'});
  assert.equal(reg.status,201,JSON.stringify(reg.data));
  const setup=await api('/api/payments/pix/setup');
  assert.equal(setup.status,200,JSON.stringify(setup.data));
  assert.equal(setup.data.ready,true);
  assert.equal(setup.data.requiredHeader,'x-nexhub-pix-secret');
  assert.match(setup.data.endpoint,/\/api\/payments\/pix\/webhook$/);

  const configuredKey=process.env.PIX_RANDOM_KEY;
  process.env.PIX_RANDOM_KEY='';
  const incomplete=await api('/api/vip/payments','POST',{});
  assert.equal(incomplete.status,201,JSON.stringify(incomplete.data));
  assert.equal(incomplete.data.payment.pixPayload,'');
  process.env.PIX_RANDOM_KEY=configuredKey;

  const payment=await api('/api/vip/payments','POST',{});
  assert.equal(payment.status,201,JSON.stringify(payment.data));
  assert.equal(payment.data.payment.status,'pending');
  assert.equal(payment.data.payment.id,incomplete.data.payment.id,'pedido sem chave deve ser atualizado após configurar o Pix');
  assert.equal(payment.data.payment.pixKey,configuredKey);
  assert.ok(payment.data.payment.pixPayload.includes(configuredKey));
  assert.match(payment.data.payment.pixQrSvg,/^<svg/);

  const wrongAmount=await fetch(base+'/api/payments/pix/webhook',{method:'POST',headers:{'content-type':'application/json','x-nexhub-pix-secret':'segredo-pix-v30'},body:JSON.stringify({reference:payment.data.payment.reference,status:'paid',amountCents:100})});
  assert.equal(wrongAmount.status,400);

  const ok=await fetch(base+'/api/payments/pix/webhook',{method:'POST',headers:{'content-type':'application/json','x-nexhub-pix-secret':'segredo-pix-v30'},body:JSON.stringify({data:{externalReference:payment.data.payment.reference,status:'approved',amount:5,transactionId:'E2EV30PIX'}})});
  assert.equal(ok.status,200);
  const paid=await ok.json();
  assert.equal(paid.activated,true);
  const fresh=await api('/api/vip/payments/'+payment.data.payment.id);
  assert.equal(fresh.data.payment.status,'paid');
  assert.equal(fresh.data.vip.active,true);
  const security=await api('/api/security/status');
  assert.equal(security.data.pixWebhookReady,true);
  assert.equal(security.data.pixRequiresSecretHeader,'x-nexhub-pix-secret');
}));
