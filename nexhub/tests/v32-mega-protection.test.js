import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

async function withApp(fn){
  const dir=mkdtempSync(join(tmpdir(),'nexhub-v32-'));
  process.env.DB_PATH=join(dir,'test.sqlite');
  process.env.MEDIA_PATH=join(dir,'media');
  process.env.NODE_ENV='test';
  process.env.CREATOR_SETUP_CODE='creator-v32-secret';
  process.env.PIX_RANDOM_KEY='33333333-3333-4333-8333-333333333333';
  process.env.PIX_MERCHANT_NAME='NEXHUB VIP';
  process.env.PIX_MERCHANT_CITY='BRASIL';
  process.env.PIX_WEBHOOK_SECRET='segredo-pix-v32';
  const mod=await import('../src/server.js?case='+Math.random());
  const server=mod.createApp();
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  const jar={user:'',admin:'',bad:''};
  async function api(route,method='GET',body,as='user',headers={}){
    const res=await fetch(base+route,{method,headers:{...(jar[as]?{Cookie:jar[as]}:{}),...(body!==undefined?{'Content-Type':'application/json'}:{}),...headers},body:body!==undefined?JSON.stringify(body):undefined});
    const cookie=res.headers.get('set-cookie');if(cookie&&cookie.startsWith('nexo_session='))jar[as]=cookie.split(';')[0];
    return {status:res.status,data:await res.json().catch(()=>({}))};
  }
  try{await fn({api,base,jar});}
  finally{await new Promise(resolve=>server.close(resolve));rmSync(dir,{recursive:true,force:true});}
}

test('v32: mega atualização cobre anti-hack, checkout VIP, bot, uploads e painel do criador',async()=>withApp(async({api,base,jar})=>{
  const reg=await api('/api/register','POST',{username:'mega_v32',email:'mega-v32@example.com',password:'safe_password1'},'user');
  assert.equal(reg.status,201,JSON.stringify(reg.data));
  const bad=await api('/api/login','POST',{login:'mega_v32',password:'errada'},'bad');
  assert.equal(bad.status,401);

  const sec=await api('/api/security/status','GET',undefined,'user');
  assert.equal(sec.status,200,JSON.stringify(sec.data));
  assert.equal(sec.data.apkHackCannotUnlockVip,true);
  assert.ok(sec.data.sessions.length>=1);
  assert.ok(sec.data.events.some(e=>e.kind==='account_created'));
  assert.ok(sec.data.score<=100);

  const catalog=await api('/api/vip/catalog','GET',undefined,'user');
  assert.equal(catalog.status,200,JSON.stringify(catalog.data));
  assert.equal(catalog.data.rules.adminIncluded,false);
  assert.equal(catalog.data.plans[0].priceBRL,5);

  const checkout=await api('/api/payments/pix/checkout','GET',undefined,'user');
  assert.equal(checkout.status,200,JSON.stringify(checkout.data));
  assert.equal(checkout.data.checkout.amountBRL,5);
  assert.match(checkout.data.payment.pixPayload,/BR.GOV.BCB.PIX/);

  const server=await api('/api/servers','POST',{name:'Mega Proteção'},'user');
  assert.equal(server.status,201,JSON.stringify(server.data));
  const sid=server.data.server.id;
  const install=await api(`/api/servers/${sid}/bots/guardian`,'POST',{},'user');
  assert.equal(install.status,200,JSON.stringify(install.data));
  const action=await api(`/api/servers/${sid}/bots/guardian/action`,'POST',{action:'status',detail:'teste v32'},'user');
  assert.equal(action.status,200,JSON.stringify(action.data));
  assert.equal(action.data.action,'status');

  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=','base64');
  const upload=await fetch(base+'/api/me/media/avatar',{method:'PUT',headers:{Cookie:jar.user,'content-type':'application/octet-stream'},body:png});
  assert.equal(upload.status,200,await upload.text());

  const admin=await api('/api/register','POST',{username:'admin_v32',email:'admin-v32@example.com',password:'safe_password1'},'admin');
  assert.equal(admin.status,201,JSON.stringify(admin.data));
  const claim=await api('/api/creator/claim','POST',{code:'creator-v32-secret'},'admin');
  assert.equal(claim.status,200,JSON.stringify(claim.data));

  const dash=await api('/api/creator/security-dashboard','GET',undefined,'admin');
  assert.equal(dash.status,200,JSON.stringify(dash.data));
  assert.ok(dash.data.summary.events24h>=1);
  assert.ok(dash.data.uploads.some(u=>u.kind==='avatar'&&u.verdict==='accepted'));
  assert.ok(dash.data.readiness.some(x=>x.id==='pix'&&x.ok));

  const ready=await api('/api/creator/production-checklist','GET',undefined,'admin');
  assert.equal(ready.status,200,JSON.stringify(ready.data));
  assert.ok(ready.data.items.some(x=>x.id==='uploads'&&x.ok));

  const appcheck=await api('/api/security/app-check','GET',undefined,'user');
  assert.equal(appcheck.status,200,JSON.stringify(appcheck.data));
  assert.equal(appcheck.data.vipServerOnly,true);
}));
