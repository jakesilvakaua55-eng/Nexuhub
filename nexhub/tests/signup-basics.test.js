import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir=mkdtempSync(join(tmpdir(),'nexhub-signup-'));
process.env.DB_PATH=join(dir,'database.sqlite');
process.env.MEDIA_PATH=join(dir,'media');
process.env.NODE_ENV='test';
const {createApp}=await import('../src/server.js');
const server=createApp();
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}`;
const cookies={};

async function call(who,path,method='GET',body){
  const res=await fetch(base+path,{
    method,
    headers:{...(cookies[who]?{cookie:cookies[who]}:{}),...(body!==undefined?{'Content-Type':'application/json'}:{})},
    body:body===undefined?undefined:JSON.stringify(body)
  });
  const cookie=res.headers.get('set-cookie');
  if(cookie?.startsWith('nexo_session='))cookies[who]=cookie.split(';')[0];
  return {status:res.status,data:await res.json()};
}

test('cadastro aceita somente usuário e senha curtos, sem limite antigo de tentativas',async()=>{
  try{
    const first=await call('first','/api/register','POST',{username:'x',password:'1'});
    assert.equal(first.status,201,JSON.stringify(first.data));
    assert.equal(first.data.user.username,'x');
    assert.equal(first.data.user.email,'');
    assert.equal(first.data.user.hasEmail,false);
    assert.equal(first.data.emailVerification,undefined);

    for(let i=0;i<8;i++){
      const created=await call('user'+i,'/api/register','POST',{username:'user'+i,password:'p'});
      assert.equal(created.status,201,JSON.stringify(created.data));
    }
    const login=await call('login','/api/login','POST',{login:'x',password:'1'});
    assert.equal(login.status,200,JSON.stringify(login.data));
    assert.equal(login.data.user.id,first.data.user.id);

    const duplicate=await call('duplicate','/api/register','POST',{username:'x',password:'another'});
    assert.equal(duplicate.status,409);
    assert.equal((await call('empty','/api/register','POST',{username:'',password:''})).status,400);
  }finally{
    await new Promise(resolve=>server.close(resolve));
    rmSync(dir,{recursive:true,force:true});
  }
});
