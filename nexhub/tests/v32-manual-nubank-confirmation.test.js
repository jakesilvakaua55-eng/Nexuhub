import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

async function withApp(fn){
  const dir=mkdtempSync(join(tmpdir(),'nexhub-manual-pix-'));
  process.env.DB_PATH=join(dir,'test.sqlite');
  process.env.MEDIA_PATH=join(dir,'media');
  process.env.NODE_ENV='test';
  process.env.CREATOR_SETUP_CODE='creator-manual-pix-secret';
  process.env.PIX_RANDOM_KEY='33333333-3333-4333-8333-333333333333';
  const mod=await import('../src/server.js?manual='+Math.random());
  const server=mod.createApp();
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  const jar={buyer:'',creator:''};
  async function api(route,method='GET',body,as='buyer'){
    const res=await fetch(base+route,{method,headers:{...(jar[as]?{Cookie:jar[as]}:{}),...(body!==undefined?{'Content-Type':'application/json'}:{})},body:body!==undefined?JSON.stringify(body):undefined});
    const cookie=res.headers.get('set-cookie');
    if(cookie&&cookie.startsWith('nexo_session='))jar[as]=cookie.split(';')[0];
    return {status:res.status,data:await res.json().catch(()=>({}))};
  }
  try{await fn({api});}
  finally{await new Promise(resolve=>server.close(resolve));rmSync(dir,{recursive:true,force:true});}
}

test('manual Nubank confirmation is creator-only, records the payment, and activates VIP once',async()=>withApp(async({api})=>{
  const buyer=await api('/api/register','POST',{username:'comprador_manual_pix',email:'comprador-manual@example.com',password:'safe_password1'},'buyer');
  assert.equal(buyer.status,201,JSON.stringify(buyer.data));
  const payment=await api('/api/vip/payments','POST',{},'buyer');
  assert.equal(payment.status,201,JSON.stringify(payment.data));

  const creator=await api('/api/register','POST',{username:'criador_manual_pix',email:'criador-manual@example.com',password:'safe_password1'},'creator');
  assert.equal(creator.status,201,JSON.stringify(creator.data));
  const claim=await api('/api/creator/claim','POST',{code:'creator-manual-pix-secret'},'creator');
  assert.equal(claim.status,200,JSON.stringify(claim.data));

  const forbidden=await api(`/api/creator/payments/${payment.data.payment.id}/manual-confirm`,'POST',{verified:true},'buyer');
  assert.equal(forbidden.status,403);
  const unchecked=await api(`/api/creator/payments/${payment.data.payment.id}/manual-confirm`,'POST',{verified:false},'creator');
  assert.equal(unchecked.status,400);

  const confirmed=await api(`/api/creator/payments/${payment.data.payment.id}/manual-confirm`,'POST',{verified:true},'creator');
  assert.equal(confirmed.status,200,JSON.stringify(confirmed.data));
  assert.equal(confirmed.data.activated,true);
  assert.equal(confirmed.data.confirmationSource,'manual_nubank');

  const vip=await api('/api/vip','GET',undefined,'buyer');
  assert.equal(vip.status,200,JSON.stringify(vip.data));
  assert.equal(vip.data.vip.active,true);
  const payments=await api('/api/creator/payments?status=paid','GET',undefined,'creator');
  assert.equal(payments.status,200,JSON.stringify(payments.data));
  assert.equal(payments.data.summary.paid,1);
  assert.equal(payments.data.payments[0].confirmationSource,'manual_nubank');
  assert.ok(payments.data.events.some(event=>event.kind==='vip_payment_manual_confirmed'));

  const duplicate=await api(`/api/creator/payments/${payment.data.payment.id}/manual-confirm`,'POST',{verified:true},'creator');
  assert.equal(duplicate.status,409);
  const audit=await api('/api/creator/audit','GET',undefined,'creator');
  assert.ok(audit.data.entries.some(entry=>entry.action==='vip:pix-manual-confirm'));
}));
