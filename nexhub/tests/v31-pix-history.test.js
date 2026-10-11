import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

async function withApp(fn){
  const dir=mkdtempSync(join(tmpdir(),'nexhub-v31-'));
  process.env.DB_PATH=join(dir,'test.sqlite');
  process.env.MEDIA_PATH=join(dir,'media');
  process.env.NODE_ENV='test';
  process.env.CREATOR_SETUP_CODE='creator-v31-secret';
  process.env.PIX_RANDOM_KEY='22222222-2222-4222-8222-222222222222';
  process.env.PIX_MERCHANT_NAME='NEXHUB VIP';
  process.env.PIX_MERCHANT_CITY='BRASIL';
  process.env.PIX_WEBHOOK_SECRET='segredo-pix-v31';
  const mod=await import('../src/server.js?case='+Math.random());
  const server=mod.createApp();
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  const jar={user:'',admin:''};
  async function api(route,method='GET',body,as='user',headers={}){
    const res=await fetch(base+route,{method,headers:{...(jar[as]?{Cookie:jar[as]}:{}),...(body!==undefined?{'Content-Type':'application/json'}:{}),...headers},body:body!==undefined?JSON.stringify(body):undefined});
    const cookie=res.headers.get('set-cookie');if(cookie&&cookie.startsWith('nexo_session='))jar[as]=cookie.split(';')[0];
    return {status:res.status,data:await res.json().catch(()=>({}))};
  }
  try{await fn({api,base});}
  finally{await new Promise(resolve=>server.close(resolve));rmSync(dir,{recursive:true,force:true});}
}

test('v31: painel do criador lista pagamentos Pix, resumo e logs anti-golpe',async()=>withApp(async({api,base})=>{
  const user=await api('/api/register','POST',{username:'comprador_v31',email:'comprador-v31@example.com',password:'safe_password1'},'user');
  assert.equal(user.status,201,JSON.stringify(user.data));
  const pay=await api('/api/vip/payments','POST',{},'user');
  assert.equal(pay.status,201,JSON.stringify(pay.data));
  assert.equal(pay.data.payment.status,'pending');
  assert.ok(pay.data.payment.secondsLeft>0);

  const again=await api('/api/vip/payments','POST',{},'user');
  assert.equal(again.status,201,JSON.stringify(again.data));
  assert.equal(again.data.payment.id,pay.data.payment.id,'pedido pendente deve ser reutilizado antes de expirar');

  const admin=await api('/api/register','POST',{username:'admin_v31',email:'admin-v31@example.com',password:'safe_password1'},'admin');
  assert.equal(admin.status,201,JSON.stringify(admin.data));
  const claim=await api('/api/creator/claim','POST',{code:'creator-v31-secret'},'admin');
  assert.equal(claim.status,200,JSON.stringify(claim.data));

  const before=await api('/api/creator/payments','GET',undefined,'admin');
  assert.equal(before.status,200,JSON.stringify(before.data));
  assert.equal(before.data.summary.pending,1);
  assert.equal(before.data.payments[0].reference,pay.data.payment.reference);

  const ok=await fetch(base+'/api/payments/pix/webhook',{method:'POST',headers:{'content-type':'application/json','x-nexhub-pix-secret':'segredo-pix-v31'},body:JSON.stringify({reference:pay.data.payment.reference,status:'paid',amountCents:500,transactionId:'E2EV31PIX'})});
  assert.equal(ok.status,200);

  const after=await api('/api/creator/payments?status=paid','GET',undefined,'admin');
  assert.equal(after.status,200,JSON.stringify(after.data));
  assert.equal(after.data.summary.paid,1);
  assert.equal(after.data.summary.revenueBRL,5);
  assert.equal(after.data.payments[0].status,'paid');
  assert.equal(after.data.payments[0].receipt.transactionId,'E2EV31PIX');
  assert.ok(after.data.events.some(e=>e.kind==='vip_payment_activated'));
}));
