import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

async function withApp(fn){
  const dir=mkdtempSync(join(tmpdir(),'nexhub-v35-'));
  process.env.DB_PATH=join(dir,'test.sqlite');
  process.env.MEDIA_PATH=join(dir,'media');
  process.env.NODE_ENV='test';
  process.env.CREATOR_SETUP_CODE='creator-v35-secret';
  process.env.PIX_RANDOM_KEY='55555555-5555-4555-8555-555555555555';
  process.env.PIX_WEBHOOK_SECRET='segredo-v35';
  const mod=await import('../src/server.js?v35='+Math.random());
  const server=mod.createApp();
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  const jar={user:'',admin:''};
  async function api(route,method='GET',body,as='user'){
    const res=await fetch(base+route,{method,headers:{...(jar[as]?{Cookie:jar[as]}:{}),...(body!==undefined?{'Content-Type':'application/json'}:{})},body:body!==undefined?JSON.stringify(body):undefined});
    const cookie=res.headers.get('set-cookie');if(cookie&&cookie.startsWith('nexo_session='))jar[as]=cookie.split(';')[0];
    return {status:res.status,data:await res.json().catch(()=>({}))};
  }
  try{await fn({api});}
  finally{await new Promise(resolve=>server.close(resolve));rmSync(dir,{recursive:true,force:true});}
}

test('v35: ideias 1 a 15 ficam disponíveis sem XP/nível',async()=>withApp(async({api})=>{
  const reg=await api('/api/register','POST',{username:'player_v35',email:'player-v35@example.com',password:'safe_password1'},'user');
  assert.equal(reg.status,201,JSON.stringify(reg.data));
  const admin=await api('/api/register','POST',{username:'admin_v35',email:'admin-v35@example.com',password:'safe_password1'},'admin');
  assert.equal(admin.status,201,JSON.stringify(admin.data));
  const claim=await api('/api/creator/claim','POST',{code:'creator-v35-secret'},'admin');
  assert.equal(claim.status,200,JSON.stringify(claim.data));

  const profile=await api('/api/profile/premium','GET');
  assert.equal(profile.status,200,JSON.stringify(profile.data));
  assert.equal(profile.data.mascot.name,'Hikari');

  const status=await api('/api/me/activity-status','PATCH',{kind:'playing',text:'Testando o NexHub'});
  assert.equal(status.status,200,JSON.stringify(status.data));
  assert.equal(status.data.user.activityKind,'playing');

  const shop=await api('/api/effects-shop','GET');
  assert.equal(shop.status,200,JSON.stringify(shop.data));
  assert.ok(shop.data.items.some(x=>x.id==='avatar-purple-frame'));
  const claimItem=await api('/api/effects-shop/avatar-purple-frame/claim','POST',{});
  assert.equal(claimItem.status,200,JSON.stringify(claimItem.data));
  const applyItem=await api('/api/effects-shop/avatar-purple-frame/apply','POST',{});
  assert.equal(applyItem.status,200,JSON.stringify(applyItem.data));

  const daily=await api('/api/daily-reward/claim','POST',{});
  assert.equal(daily.status,200,JSON.stringify(daily.data));
  assert.ok(daily.data.reward.streak>=1);
  const events=await api('/api/weekly-events','GET');
  assert.equal(events.status,200,JSON.stringify(events.data));
  assert.ok(events.data.events.some(x=>x.id==='hikari-week'));

  const missions=await api('/api/missions','GET');
  assert.equal(missions.status,200,JSON.stringify(missions.data));
  assert.match(missions.data.rules,/sem sistema de nível\/XP/);
  const mission=await api('/api/missions/complete-profile/progress','POST',{amount:1});
  assert.equal(mission.status,200,JSON.stringify(mission.data));
  assert.equal(mission.data.progress.completed,true);

  const server=await api('/api/servers','POST',{name:'Comunidade V35'});
  assert.equal(server.status,201,JSON.stringify(server.data));
  const sid=server.data.server.id;
  const exploreSettings=await api(`/api/servers/${sid}/explore-settings`,'PATCH',{category:'jogos',featured:true});
  assert.equal(exploreSettings.status,200,JSON.stringify(exploreSettings.data));

  const verify=await api(`/api/creator/servers/${sid}/verify`,'PATCH',{badge:'verified',reason:'Servidor aprovado'},'admin');
  assert.equal(verify.status,200,JSON.stringify(verify.data));
  assert.equal(verify.data.server.verifiedBadge,'verified');

  const explore=await api('/api/explore?category=jogos','GET');
  assert.equal(explore.status,200,JSON.stringify(explore.data));
  assert.ok(explore.data.servers.some(x=>x.id===sid));
  const rankings=await api('/api/rankings','GET');
  assert.equal(rankings.status,200,JSON.stringify(rankings.data));
  assert.ok(Array.isArray(rankings.data.servers));

  const call=await api('/api/calls/features','GET');
  assert.equal(call.status,200,JSON.stringify(call.data));
  assert.equal(call.data.lowDataMode,true);

  const nexbot=await api('/api/nexbot','GET');
  assert.equal(nexbot.status,200,JSON.stringify(nexbot.data));
  assert.equal(nexbot.data.bot.name,'NexBot');
  const botAction=await api(`/api/servers/${sid}/nexbot/action`,'POST',{action:'help',message:'Ajuda do NexBot'});
  assert.equal(botAction.status,200,JSON.stringify(botAction.data));

  const announcement=await api('/api/creator/announcements','POST',{title:'Aviso V35',message:'Central de notificações funcionando.',audience:'all'},'admin');
  assert.equal(announcement.status,201,JSON.stringify(announcement.data));
  const notes=await api('/api/notifications/center','GET');
  assert.equal(notes.status,200,JSON.stringify(notes.data));
  assert.ok(notes.data.announcements.some(x=>x.title==='Aviso V35'));

  const creatorServers=await api('/api/creator/servers','GET',undefined,'admin');
  assert.equal(creatorServers.status,200,JSON.stringify(creatorServers.data));
  assert.ok(creatorServers.data.servers.some(x=>x.id===sid));
}));
