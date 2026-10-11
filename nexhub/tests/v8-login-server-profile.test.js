import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir=mkdtempSync(join(tmpdir(),'nexo-v8-test-'));
process.env.DB_PATH=join(dir,'test.sqlite');
process.env.NODE_ENV='test';
const { createApp }=await import('../src/server.js');
const server=createApp();
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}`;
const agents={a:'',b:''};
async function api(user, route, method='GET', body){
  const res=await fetch(base+route,{method,headers:{...(agents[user]?{Cookie:agents[user]}:{}),...(body!==undefined?{'Content-Type':'application/json'}:{})},body:body!==undefined?JSON.stringify(body):undefined});
  const cookie=res.headers.get('set-cookie'); if(cookie&&cookie.startsWith('nexo_session='))agents[user]=cookie.split(';')[0];
  return {status:res.status,data:await res.json()};
}

test('v8: login tolerante e nome de servidor livre com emoji e símbolos',async()=>{
  try{
    const reg=await api('a','/api/register','POST',{username:'kauazinhogg',email:'kaua@example.com',password:'abc12345'});
    assert.equal(reg.status,201,JSON.stringify(reg.data));
    const login=await api('b','/api/login','POST',{login:'@Kauazinhogg ',password:'abc12345 ',twoFactorCode:''});
    assert.equal(login.status,200,JSON.stringify(login.data));
    const created=await api('b','/api/servers','POST',{name:'🎮 Tropa do Kauã 🔥 !!! / qualquer nome',description:'Nome livre'});
    assert.equal(created.status,201,JSON.stringify(created.data));
    assert.equal(created.data.server.name,'🎮 Tropa do Kauã 🔥 !!! / qualquer nome');
    const patched=await api('b',`/api/servers/${created.data.server.id}`,'PATCH',{name:'😈 Nexus Store — Compra & Venda #1',description:'Editado'});
    assert.equal(patched.status,200,JSON.stringify(patched.data));
    assert.equal(patched.data.server.name,'😈 Nexus Store — Compra & Venda #1');
    const missing=await api('a','/api/login','POST',{login:'conta_inexistente',password:'abc12345'});
    assert.equal(missing.status,401);
    assert.match(missing.data.error,/Conta não encontrada/);
  } finally { await new Promise(resolve=>server.close(resolve)); rmSync(dir,{recursive:true,force:true}); }
});
