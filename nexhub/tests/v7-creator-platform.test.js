import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const dir=mkdtempSync(join(tmpdir(),'nexo-v7-'));
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
async function register(w){const r=await api(w,'/api/register','POST',{username:'v7_'+w,email:w+'@v7.test',password:'hello_world_123'});assert.equal(r.status,201,JSON.stringify(r.data));return r.data.user;}

test('v7: painel do criador lista usuários, estatísticas, auditoria e banimento global',async()=>{
 let db;
 try{
  const creator=await register('creator');
  const user=await register('user');
  db=openDatabase(process.env.DB_PATH);db.prepare('INSERT INTO platform_admins(user_id) VALUES(?)').run(creator.id);
  const created=await api('creator','/api/servers','POST',{name:'Servidor v7'});assert.equal(created.status,201,JSON.stringify(created.data));
  const sid=created.data.server.id;
  const invite=(await api('creator',`/api/servers/${sid}/invites`,'POST',{})).data.code;
  assert.equal((await api('user',`/api/invites/${invite}`,'POST',{})).status,200);
  const report=await api('user','/api/reports','POST',{targetUserId:creator.id,serverId:sid,reason:'Teste de denúncia para o painel do criador'});
  assert.equal(report.status,201,JSON.stringify(report.data));
  assert.equal((await api('user','/api/creator/overview')).status,403);
  const overview=await api('creator','/api/creator/overview');
  assert.equal(overview.status,200,JSON.stringify(overview.data));
  assert.equal(overview.data.counts.users,2);
  assert.equal(overview.data.counts.servers,1);
  assert.equal(overview.data.counts.reportsPending,1);
  const users=await api('creator','/api/creator/users?q=v7_user');
  assert.equal(users.status,200,JSON.stringify(users.data));
  assert.equal(users.data.users.length,1);
  assert.equal(users.data.users[0].id,user.id);
  const detail=await api('creator','/api/creator/users/'+user.id);
  assert.equal(detail.status,200,JSON.stringify(detail.data));
  assert.equal(detail.data.user.username,'v7_user');
  assert.equal(detail.data.stats.reportsMade,1);
  assert.equal((await api('creator',`/api/mod/users/${user.id}/ban`,'POST',{reason:'Teste de banimento global pelo criador'})).status,200);
  const banned=await api('creator','/api/creator/users?status=banned');
  assert.equal(banned.data.users.some(u=>u.id===user.id&&u.banned),true);
  const audit=await api('creator','/api/creator/audit');
  assert.equal(audit.status,200);
  assert.equal(audit.data.entries.some(e=>e.action==='account:ban'&&e.targetId===user.id),true);
  assert.equal((await api('user','/api/login','POST',{login:'v7_user',password:'hello_world_123'})).status,403);
  assert.equal((await api('creator',`/api/mod/users/${user.id}/unban`,'POST',{})).status,200);
  assert.equal((await api('user','/api/login','POST',{login:'v7_user',password:'hello_world_123'})).status,200);
 }finally{try{db?.close();}catch{}await new Promise(ok=>server.close(ok));rmSync(dir,{recursive:true,force:true});}
});
