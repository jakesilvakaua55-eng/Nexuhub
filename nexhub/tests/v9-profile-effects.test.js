import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir=mkdtempSync(join(tmpdir(),'nexo-v9-effects-'));
process.env.DB_PATH=join(dir,'test.sqlite');
process.env.NODE_ENV='test';
const { createApp }=await import('../src/server.js');
const server=createApp();
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}`;
let cookie='';
async function api(route, method='GET', body){
  const res=await fetch(base+route,{method,headers:{...(cookie?{Cookie:cookie}:{}),...(body!==undefined?{'Content-Type':'application/json'}:{})},body:body!==undefined?JSON.stringify(body):undefined});
  const set=res.headers.get('set-cookie'); if(set?.startsWith('nexo_session='))cookie=set.split(';')[0];
  return {status:res.status,data:await res.json()};
}

test('v9: usuário escolhe animação de perfil e perfil público mostra o efeito',async()=>{
  try{
    const reg=await api('/api/register','POST',{username:'kawaii',email:'kawaii@example.com',password:'1234567890'});
    assert.equal(reg.status,201,JSON.stringify(reg.data));
    assert.equal(reg.data.user.profileEffect,'none');
    const save=await api('/api/me','PATCH',{displayName:'Kawaii Player',bio:'perfil animado',profileEffect:'pixel_hearts'});
    assert.equal(save.status,200,JSON.stringify(save.data));
    assert.equal(save.data.user.profileEffect,'pixel_hearts');
    const publicProfile=await api('/api/users/'+reg.data.user.id);
    assert.equal(publicProfile.status,200,JSON.stringify(publicProfile.data));
    assert.equal(publicProfile.data.user.profileEffect,'pixel_hearts');
    const video=await api('/api/me','PATCH',{profileEffect:'video_neon_eye'});
    assert.equal(video.status,200,JSON.stringify(video.data));
    assert.equal(video.data.user.profileEffect,'video_neon_eye');
    const invalid=await api('/api/me','PATCH',{profileEffect:'hello_kitty_oficial'});
    assert.equal(invalid.status,200,JSON.stringify(invalid.data));
    assert.equal(invalid.data.user.profileEffect,'none');
  } finally {
    await new Promise(resolve=>server.close(resolve));
    rmSync(dir,{recursive:true,force:true});
  }
});
