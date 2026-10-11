import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const dir=mkdtempSync(join(tmpdir(),'nexo-v5-'));
process.env.DB_PATH=join(dir,'test.sqlite');
process.env.MEDIA_PATH=join(dir,'media');
process.env.NODE_ENV='test';
const { createApp }=await import('../src/server.js');
const {openDatabase}=await import('../src/database.js');
const server=createApp();await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
const base=`http://127.0.0.1:${server.address().port}`;
const cookies={};
async function api(w,path,method='GET',body){
 const res=await fetch(base+path,{method,headers:{...(cookies[w]?{Cookie:cookies[w]}:{}),...(body!==undefined?{'Content-Type':'application/json'}:{})},body:body!==undefined?JSON.stringify(body):undefined});
 const cookie=res.headers.get('set-cookie');if(cookie?.startsWith('nexo_session='))cookies[w]=cookie.split(';')[0];
 return {status:res.status,data:await res.json()};
}
async function register(w){const r=await api(w,'/api/register','POST',{username:'tester_'+w,email:w+'@example.com',password:'hello_world_123'});assert.equal(r.status,201,JSON.stringify(r.data));return r.data.user;}
test('v5: cargos, bloqueios, bot, denúncias, banimento da conta, segurança e persistência',async()=>{
 let externalDb;
 try {
  const a=await register('a'),b=await register('b'),c=await register('c');
  externalDb=openDatabase(process.env.DB_PATH);
  externalDb.prepare('INSERT INTO platform_admins(user_id) VALUES(?)').run(a.id);
  assert.equal((await api('a','/api/me')).data.user.isPlatformAdmin,true);
  const created=await api('a','/api/servers','POST',{name:'Servidor Seguro'});assert.equal(created.status,201,JSON.stringify(created.data));
  const sid=created.data.server.id, cid=created.data.server.channels[0].id;
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/qx0AAAAASUVORK5CYII=','base64');
  const putIcon=async(w,method='PUT')=>fetch(base+`/api/servers/${sid}/icon`,{method,headers:{Cookie:cookies[w],...(method==='PUT'?{'Content-Type':'application/octet-stream'}:{})},body:method==='PUT'?png:undefined});
  assert.equal((await putIcon('b')).status,403);
  const iconResult=await putIcon('a');assert.equal(iconResult.status,200);const icon=(await iconResult.json()).server.iconUrl;
  assert.match(icon,/^\/media\/.*\.png$/);assert.equal((await fetch(base+icon)).status,200);
  assert.equal((await putIcon('a','DELETE')).status,200);

  assert.equal((await api('b',`/api/servers/${sid}/roles`,'POST',{name:'hacker',permissions:['manage_roles']})).status,403);
  const invite=(await api('a',`/api/servers/${sid}/invites`,'POST',{})).data.code;
  for(const w of ['b','c'])assert.equal((await api(w,`/api/invites/${invite}`,'POST',{})).status,200);
  const role=await api('a',`/api/servers/${sid}/roles`,'POST',{name:'Equipe',color:'#7c3aed',permissions:['manage_channels','manage_bots']});
  assert.equal(role.status,201,JSON.stringify(role.data));
  assert.equal((await api('b',`/api/servers/${sid}/roles`,'POST',{name:'Super',permissions:['manage_server']})).status,403);
  assert.equal((await api('b',`/api/servers/${sid}/members/${b.id}/custom-role`,'POST',{roleId:role.data.id})).status,403);
  assert.equal((await api('a',`/api/servers/${sid}/members/${b.id}/custom-role`,'POST',{roleId:role.data.id})).status,200);
  assert.equal((await api('b',`/api/servers/${sid}/channels`,'POST',{name:'sala-voz',type:'voice'})).status,201);
  const voice=(await api('b',`/api/servers/${sid}`)).data.server.channels.find(x=>x.type==='voice');
  assert.equal(voice.type,'voice');
  assert.equal((await api('c',`/api/channels/${voice.id}/messages`)).status,400);
  assert.equal((await api('c',`/api/channels/${voice.id}/voice-access`)).data.canJoin,true);
  assert.equal((await api('c',`/api/servers/${sid}/locks`,'PATCH',{voiceLocked:true})).status,403);
  assert.equal((await api('b',`/api/servers/${sid}/locks`,'PATCH',{voiceLocked:true,textLocked:true})).status,200);
  assert.equal((await api('c',`/api/channels/${cid}/messages`,'POST',{content:'Oi, todos'})).status,403);
  assert.equal((await api('c',`/api/channels/${voice.id}/voice-access`)).data.canJoin,false);
  assert.equal((await api('b',`/api/servers/${sid}/locks`,'PATCH',{voiceLocked:false,textLocked:false})).status,200);
  assert.equal((await api('b',`/api/servers/${sid}/bots/guardian`,'PATCH',{enabled:true,blockLinks:true,blockedWords:['palavra proibida'],welcomeEnabled:true})).status,200);
  assert.equal((await api('c',`/api/channels/${cid}/messages`,'POST',{content:'https://example.com'})).status,403);
  assert.equal((await api('c',`/api/channels/${cid}/messages`,'POST',{content:'palavra proibida'})).status,403);
  const msg=await api('c',`/api/channels/${cid}/messages`,'POST',{content:'Mensagem liberada'});assert.equal(msg.status,201,JSON.stringify(msg.data));
  assert.equal((await api('c',`/api/servers/${sid}/roles/${role.data.id}`,'DELETE')).status,403);
  // Controle de conta bloqueada aplica-se a PV e ligações.
  assert.equal((await api('b',`/api/users/${c.id}/block`,'POST',{})).status,200);
  assert.equal((await api('c',`/api/dms/${b.id}/messages`,'POST',{content:'ola'})).status,403);
  assert.equal((await api('c','/api/calls','POST',{to:b.id,mode:'audio'})).status,403);
  assert.equal((await api('b',`/api/users/${c.id}/block`)).data.blocked,true);
  assert.equal((await api('b',`/api/users/${c.id}/block`,'DELETE')).status,200);
  assert.equal((await api('b',`/api/users/${c.id}/block`)).data.blocked,false);
  // Usuário comum denuncia; painel só está disponível ao admin explicitamente cadastrado.
  assert.equal((await api('b','/api/mod/reports')).status,403);
  const report=await api('b','/api/reports','POST',{targetUserId:c.id,serverId:sid,messageId:msg.data.message.id,reason:'Mensagem ofensiva para análise'});
  assert.equal(report.status,201,JSON.stringify(report.data));
  assert.equal((await api('a','/api/mod/reports')).data.reports.length,1);
  assert.equal((await api('a',`/api/mod/reports/${report.data.reportId}`,'PATCH',{status:'reviewed',resolution:'Foi verificado'})).status,200);
  assert.equal((await api('a',`/api/mod/users/${c.id}/ban`,'POST',{reason:'Teste de moderação documentado'})).status,200);
  assert.equal((await api('c','/api/me')).status,401);
  assert.equal((await api('c','/api/login','POST',{login:'tester_c',password:'hello_world_123'})).status,403);
  assert.equal((await api('b',`/api/mod/users/${c.id}/unban`,'POST',{})).status,403);
  assert.equal((await api('a',`/api/mod/users/${c.id}/unban`,'POST',{})).status,200);
  assert.equal((await api('c','/api/login','POST',{login:'tester_c',password:'hello_world_123'})).status,200);
  // Dados sobrevivem a uma nova conexão ao banco persistente.
  const db2=openDatabase(process.env.DB_PATH);
  try {
   assert.equal(db2.prepare('SELECT name FROM custom_roles WHERE id=?').get(role.data.id).name,'Equipe');
   assert.equal(db2.prepare('SELECT content FROM messages WHERE id=?').get(msg.data.message.id).content,'Mensagem liberada');
   assert.equal(db2.prepare('SELECT COUNT(*) AS n FROM users').get().n,3);
  }finally{db2.close();}
  assert.equal((await api('c','/api/me/password','POST',{currentPassword:'hello_world_123',newPassword:'nova_senha_segura'})).status,200);
  assert.equal((await api('c','/api/me/account','DELETE',{password:'errada',confirm:'EXCLUIR'})).status,403);
  assert.equal((await api('c','/api/me/account','DELETE',{password:'nova_senha_segura',confirm:'EXCLUIR'})).status,200);
  assert.equal((await api('c','/api/me')).status,401);
  assert.equal((await api('c','/api/login','POST',{login:'tester_c',password:'nova_senha_segura'})).status,401);
  assert.equal((await api('a',`/api/servers/${sid}`)).status,200);
 }finally{try{externalDb?.close();}catch{}await new Promise(ok=>server.close(ok));rmSync(dir,{recursive:true,force:true});}
});
