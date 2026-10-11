import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

async function withApp(fn){
  const dir=mkdtempSync(join(tmpdir(),'nexhub-v28-'));
  process.env.DB_PATH=join(dir,'test.sqlite');
  process.env.MEDIA_PATH=join(dir,'media');
  process.env.NODE_ENV='test';
  process.env.PIX_RANDOM_KEY='123e4567-e89b-12d3-a456-426614174000';
  process.env.PIX_MERCHANT_NAME='NEXHUB';
  process.env.PIX_MERCHANT_CITY='IPOJUCA';
  process.env.PIX_WEBHOOK_SECRET='segredo-pix-v28';
  const mod=await import('../src/server.js?case='+Math.random());
  const server=mod.createApp();
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  const agents={u:''};
  async function api(route,method='GET',body,headers={}){
    const res=await fetch(base+route,{method,headers:{...(agents.u?{Cookie:agents.u}:{}),...(body!==undefined?{'Content-Type':'application/json'}:{}),...headers},body:body!==undefined?JSON.stringify(body):undefined});
    const cookie=res.headers.get('set-cookie');if(cookie&&cookie.startsWith('nexo_session='))agents.u=cookie.split(';')[0];
    return {status:res.status,data:await res.json().catch(()=>({}))};
  }
  try{await fn({api,base});}
  finally{await new Promise(resolve=>server.close(resolve));rmSync(dir,{recursive:true,force:true});}
}

test('v28: Pix verificado ativa VIP, libera boost e protege contra webhook falso',async()=>withApp(async({api,base})=>{
  const reg=await api('/api/register','POST',{username:'pix_vip',email:'pix@example.com',password:'safe_password1'});
  assert.equal(reg.status,201,JSON.stringify(reg.data));
  const payment=await api('/api/vip/payments','POST',{});
  assert.equal(payment.status,201,JSON.stringify(payment.data));
  assert.match(payment.data.payment.pixPayload,/BR.GOV.BCB.PIX/);
  assert.equal(payment.data.payment.status,'pending');
  const bad=await fetch(base+'/api/payments/pix/webhook',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({reference:payment.data.payment.reference,status:'paid',amountCents:500})});
  assert.equal(bad.status,403);
  const ok=await fetch(base+'/api/payments/pix/webhook',{method:'POST',headers:{'content-type':'application/json','x-nexhub-pix-secret':'segredo-pix-v28'},body:JSON.stringify({reference:payment.data.payment.reference,status:'paid',amountCents:500,transactionId:'E2EPIXTESTE'})});
  assert.equal(ok.status,200);
  assert.equal((await ok.json()).activated,true);
  const me=await api('/api/me');
  assert.equal(me.data.user.vipActive,true);
  const security=await api('/api/security/status');
  assert.equal(security.data.apkHackCannotUnlockVip,true);
  assert.equal(security.data.adminIncludedInVip,false);
  const s1=await api('/api/servers','POST',{name:'Servidor Boost 1'});
  assert.equal(s1.status,201,JSON.stringify(s1.data));
  const boost=await api(`/api/servers/${s1.data.server.id}/boosts`,'POST',{});
  assert.equal(boost.status,201,JSON.stringify(boost.data));
  assert.equal(boost.data.boosts.remaining,1);
  const bots=await api(`/api/servers/${s1.data.server.id}/bots/guardian`,'POST',{});
  assert.equal(bots.status,200,JSON.stringify(bots.data));
  const bot2=await api(`/api/servers/${s1.data.server.id}/bots/welcome`,'POST',{});
  assert.equal(bot2.status,200,JSON.stringify(bot2.data));
  const custom=await api(`/api/servers/${s1.data.server.id}/bots/welcome/customize`,'PATCH',{customName:'Bot VIP',avatarUrl:'/media/fake.png'});
  assert.equal(custom.status,200,JSON.stringify(custom.data));
  assert.equal(custom.data.config.customName,'Bot VIP');
}));
