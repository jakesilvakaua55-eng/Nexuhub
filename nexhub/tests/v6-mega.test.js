import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHmac } from 'node:crypto';
const dir=mkdtempSync(join(tmpdir(),'nexo-v6-'));
process.env.DB_PATH=join(dir,'test.sqlite');
process.env.MEDIA_PATH=join(dir,'media');
process.env.NODE_ENV='test';
const { createApp }=await import('../src/server.js');
const { openDatabase }=await import('../src/database.js');
const server=createApp();await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
const base=`http://127.0.0.1:${server.address().port}`;
const cookies={};
async function api(w,path,method='GET',body){
 const res=await fetch(base+path,{method,headers:{...(cookies[w]?{Cookie:cookies[w]}:{}),...(body!==undefined?{'Content-Type':'application/json'}:{})},body:body!==undefined?JSON.stringify(body):undefined});
 const cookie=res.headers.get('set-cookie');if(cookie?.startsWith('nexo_session='))cookies[w]=cookie.split(';')[0];
 return {status:res.status,data:await res.json().catch(()=>({}))};
}
async function raw(w,path,method='PUT',body,contentType='application/octet-stream'){
 const res=await fetch(base+path,{method,headers:{...(cookies[w]?{Cookie:cookies[w]}:{}),'Content-Type':contentType},body});
 return {status:res.status,data:await res.json().catch(()=>({}))};
}
async function register(w){const r=await api(w,'/api/register','POST',{username:'v6_'+w,email:w+'@v6.test',password:'hello_world_123'});assert.equal(r.status,201,JSON.stringify(r.data));return r.data.user;}
const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function decodeBase32(text){let bits=0,value=0,bytes=[];for(const ch of text.toUpperCase().replace(/[^A-Z2-7]/g,'')){const i=alphabet.indexOf(ch);if(i<0)continue;value=(value<<5)|i;bits+=5;if(bits>=8){bytes.push((value>>>(bits-8))&255);bits-=8;}}return Buffer.from(bytes);}
function totp(secret, step=Math.floor(Date.now()/30000)){const key=decodeBase32(secret);const msg=Buffer.alloc(8);msg.writeBigUInt64BE(BigInt(step));const h=createHmac('sha1',key).update(msg).digest();const o=h[h.length-1]&15;return ((h.readUInt32BE(o)&0x7fffffff)%1000000).toString().padStart(6,'0');}

test('v6: itens 1 a 7 — call em grupo, push, loja de bots, assets, 2FA, eventos e recursos',async()=>{
 let db;
 try{
  const a=await register('a'), b=await register('b');
  db=openDatabase(process.env.DB_PATH);db.prepare('INSERT INTO platform_admins(user_id) VALUES(?)').run(a.id);
  const created=await api('a','/api/servers','POST',{name:'Comunidade V6'});assert.equal(created.status,201,JSON.stringify(created.data));
  const sid=created.data.server.id;
  const invite=(await api('a',`/api/servers/${sid}/invites`,'POST',{})).data.code;
  assert.equal((await api('b',`/api/invites/${invite}`,'POST',{})).status,200);
  const voice=await api('a',`/api/servers/${sid}/channels`,'POST',{name:'call-geral',type:'voice'});assert.equal(voice.status,201,JSON.stringify(voice.data));
  const vid=voice.data.channel.id;
  assert.equal((await api('a',`/api/channels/${vid}/voice`,'POST',{})).status,200);
  assert.equal((await api('b',`/api/channels/${vid}/voice`,'POST',{})).data.room.participants.length,2);
  const sig=await api('a',`/api/channels/${vid}/voice/signal`,'POST',{to:b.id,type:'offer',payload:{type:'offer',sdp:'fake-sdp'}});assert.equal(sig.status,200,JSON.stringify(sig.data));
  const signals=await api('b',`/api/channels/${vid}/voice/signals?after=0`);assert.equal(signals.data.signals[0].from,a.id);
  assert.equal((await api('b',`/api/channels/${vid}/voice/state`,'PATCH',{muted:true,cameraOff:true})).data.room.participants.find(p=>p.id===b.id).muted,true);
  assert.equal((await api('b',`/api/channels/${vid}/voice`,'DELETE')).status,200);

  assert.equal((await api('a','/api/push-subscriptions','POST',{endpoint:'test-endpoint-1',keys:{p256dh:'k',auth:'a'}})).status,201);
  assert.equal((await api('a','/api/push-status')).data.subscriptions,1);

  const catalog=await api('a','/api/bots/catalog');assert(catalog.data.bots.some(x=>x.id==='tickets'));
  assert.equal((await api('a',`/api/servers/${sid}/bots/tickets`,'POST',{})).status,200);
  assert.equal((await api('a',`/api/servers/${sid}/bots`)).data.bots.some(x=>x.id==='tickets'),true);

  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/qx0AAAAASUVORK5CYII=','base64');
  const sticker=await raw('a',`/api/servers/${sid}/assets?type=sticker&name=ok-sticker`,'POST',png);assert.equal(sticker.status,201,JSON.stringify(sticker.data));
  const cid=created.data.server.channels[0].id;
  const msg=await api('a',`/api/channels/${cid}/messages`,'POST',{assetId:sticker.data.asset.id});assert.equal(msg.status,201,JSON.stringify(msg.data));
  const messages=await api('b',`/api/channels/${cid}/messages`);assert.equal(messages.data.messages.at(-1).asset.name,'ok-sticker');

  const startsAt=Date.now()+3600000;
  const event=await api('a',`/api/servers/${sid}/events`,'POST',{title:'Noite da comunidade',description:'Teste de evento',startsAt,location:'online'});assert.equal(event.status,201,JSON.stringify(event.data));
  assert.equal((await api('b',`/api/events/${event.data.eventId}/rsvp`,'POST',{status:'going'})).status,200);
  assert.equal((await api('b',`/api/servers/${sid}/events`)).data.events[0].myStatus,'going');

  const setup=await api('b','/api/me/2fa/setup','POST',{password:'hello_world_123'});assert.equal(setup.status,200,JSON.stringify(setup.data));
  assert.equal((await api('b','/api/me/2fa/enable','POST',{token:totp(setup.data.secret)})).status,200);
  assert.equal((await api('b','/api/logout','POST',{})).status,200);cookies.b='';
  assert.equal((await api('b','/api/login','POST',{login:'v6_b',password:'hello_world_123'})).status,401);
  assert.equal((await api('b','/api/login','POST',{login:'v6_b',password:'hello_world_123',twoFactorCode:totp(setup.data.secret)})).status,200);

  assert.equal((await api('a',`/api/mod/users/${b.id}/ban`,'POST',{reason:'Teste do recurso contra banimento'})).status,200);
  const appeal=await api('x','/api/appeals','POST',{login:'v6_b',reason:'Peço revisão do banimento porque foi um teste automatizado.'});assert.equal(appeal.status,201,JSON.stringify(appeal.data));
  assert.equal((await api('a','/api/mod/appeals')).data.appeals.length,1);
  assert.equal((await api('a',`/api/mod/appeals/${appeal.data.appealId}`,'PATCH',{status:'reviewed',resolution:'Recurso aceito',unban:true})).status,200);
  assert.equal((await api('b','/api/login','POST',{login:'v6_b',password:'hello_world_123',twoFactorCode:totp(setup.data.secret)})).status,200);
  const rec=await api('x','/api/account/recovery','POST',{login:'v6_b',reason:'Solicito recuperação manual para testar o painel de suporte.'});assert.equal(rec.status,201);
  assert.equal((await api('a','/api/mod/recovery-requests')).data.requests.length,1);
 }finally{try{db?.close();}catch{}await new Promise(ok=>server.close(ok));rmSync(dir,{recursive:true,force:true});}
});
