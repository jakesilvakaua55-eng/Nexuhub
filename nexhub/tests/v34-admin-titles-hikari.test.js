import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

async function withApp(fn){
  const dir=mkdtempSync(join(tmpdir(),'nexhub-v34-'));
  process.env.DB_PATH=join(dir,'test.sqlite');
  process.env.MEDIA_PATH=join(dir,'media');
  process.env.NODE_ENV='test';
  process.env.CREATOR_SETUP_CODE='creator-v34-secret';
  process.env.PIX_RANDOM_KEY='44444444-4444-4444-8444-444444444444';
  process.env.PIX_WEBHOOK_SECRET='segredo-v34';
  const mod=await import('../src/server.js?v34='+Math.random());
  const server=mod.createApp();
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  const jar={admin:'',user:''};
  async function api(route,method='GET',body,as='user'){
    const res=await fetch(base+route,{method,headers:{...(jar[as]?{Cookie:jar[as]}:{}),...(body!==undefined?{'Content-Type':'application/json'}:{})},body:body!==undefined?JSON.stringify(body):undefined});
    const cookie=res.headers.get('set-cookie');if(cookie&&cookie.startsWith('nexo_session='))jar[as]=cookie.split(';')[0];
    return {status:res.status,data:await res.json().catch(()=>({}))};
  }
  try{await fn({api});}
  finally{await new Promise(resolve=>server.close(resolve));rmSync(dir,{recursive:true,force:true});}
}

test('v34: admin grants VIP/titles by username, suspends by username, and exposes Hikari roadmap',async()=>withApp(async({api})=>{
  const u=await api('/api/register','POST',{username:'player_v34',email:'player-v34@example.com',password:'safe_password1'},'user');
  assert.equal(u.status,201,JSON.stringify(u.data));
  const a=await api('/api/register','POST',{username:'admin_v34',email:'admin-v34@example.com',password:'safe_password1'},'admin');
  assert.equal(a.status,201,JSON.stringify(a.data));
  const claim=await api('/api/creator/claim','POST',{code:'creator-v34-secret'},'admin');
  assert.equal(claim.status,200,JSON.stringify(claim.data));

  const catalog=await api('/api/creator/titles/catalog','GET',undefined,'admin');
  assert.equal(catalog.status,200,JSON.stringify(catalog.data));
  assert.equal(catalog.data.rules.emojiBadges,false);
  assert.ok(catalog.data.titles.some(t=>t.id==='verified'));

  const grant=await api('/api/creator/titles','POST',{username:'player_v34',titleId:'verified',durationDays:'forever',reason:'Verificado para teste'},'admin');
  assert.equal(grant.status,200,JSON.stringify(grant.data));
  assert.equal(grant.data.title.label,'Verificado');
  assert.ok(grant.data.target.badges.some(b=>b.id==='verified'));
  assert.equal(grant.data.target.badges.find(b=>b.id==='verified').icon,'');

  const vip=await api('/api/creator/vip/quick','POST',{username:'player_v34',duration:'10',note:'Teste v34'},'admin');
  assert.equal(vip.status,200,JSON.stringify(vip.data));
  assert.equal(vip.data.duration,'10 dias');
  assert.equal(vip.data.user.vipActive,true);

  const road=await api('/api/creator/roadmap','GET',undefined,'admin');
  assert.equal(road.status,200,JSON.stringify(road.data));
  assert.equal(road.data.mascot.name,'Hikari');
  assert.ok(road.data.items.some(x=>x.id==='official-badges'));

  const suspend=await api('/api/creator/users/action-by-name','POST',{username:'player_v34',action:'suspend',days:3,reason:'Teste de suspensão'},'admin');
  assert.equal(suspend.status,200,JSON.stringify(suspend.data));
  const blocked=await api('/api/security/status','GET',undefined,'user');
  assert.equal(blocked.status,401);
  const punish=await api('/api/creator/punishments','GET',undefined,'admin');
  assert.equal(punish.status,200,JSON.stringify(punish.data));
  assert.ok(punish.data.users.some(x=>x.username==='player_v34'));

  const unsuspend=await api('/api/creator/users/action-by-name','POST',{username:'player_v34',action:'unsuspend'},'admin');
  assert.equal(unsuspend.status,200,JSON.stringify(unsuspend.data));
  const login=await api('/api/login','POST',{login:'player_v34',password:'safe_password1'},'user');
  assert.equal(login.status,200,JSON.stringify(login.data));
}));
