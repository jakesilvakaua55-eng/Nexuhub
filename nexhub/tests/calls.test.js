import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const dir=mkdtempSync(join(tmpdir(),'nexo-calls-'));
process.env.DB_PATH=join(dir,'db.sqlite');process.env.MEDIA_PATH=join(dir,'media');process.env.NODE_ENV='test';
const {createApp}=await import('../src/server.js');
const server=createApp();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}`;const cookies={};
async function api(who,path,method='GET',body){const r=await fetch(base+path,{method,headers:{...(cookies[who]?{cookie:cookies[who]}:{}),...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});const c=r.headers.get('set-cookie');if(c?.startsWith('nexo_session='))cookies[who]=c.split(';')[0];return {status:r.status,data:await r.json()};}
test('sinalização WebRTC da chamada: apenas participantes, ocupado, atender e desligar',async()=>{
  let receiver;
  try{
    const aa=await api('a','/api/register','POST',{username:'alice_call',email:'ac@example.com',password:'password1234'});
    const bb=await api('b','/api/register','POST',{username:'bob_call',email:'bc@example.com',password:'password1234'});
    await api('c','/api/register','POST',{username:'eve_call',email:'ec@example.com',password:'password1234'});
    const a=aa.data.user.id,b=bb.data.user.id;
    assert.equal((await api('a','/api/calls','POST',{to:b,mode:'audio'})).status,409);
    const ctrl=new AbortController();
    receiver=ctrl;
    const response=await fetch(base+'/api/events',{headers:{cookie:cookies.b},signal:ctrl.signal});assert.equal(response.status,200);
    const reader=response.body.getReader();const decoder=new TextDecoder();
    const waiting=(async()=>{let buf='';for(let i=0;i<10;i++){const part=await reader.read();if(part.done)break;buf+=decoder.decode(part.value);if(buf.includes('"action":"incoming"'))return true;}return false;})();
    const start=await api('a','/api/calls','POST',{to:b,mode:'video'});
    assert.equal(start.status,201,JSON.stringify(start.data));
    assert.equal(await Promise.race([waiting,new Promise((_,reject)=>setTimeout(()=>reject(Error('Timeout SSE')),2000))]),true);
    const id=start.data.call.id;
    assert.equal((await api('c',`/api/calls/${id}/accept`,'POST',{})).status,403);
    assert.equal((await api('a',`/api/calls/${id}/accept`,'POST',{})).status,403);
    assert.equal((await api('a','/api/calls','POST',{to:b,mode:'audio'})).status,409);
    assert.equal((await api('a',`/api/calls/${id}/signal`,'POST',{type:'offer',payload:{sdp:'abc'}})).status,409);
    assert.equal((await api('b',`/api/calls/${id}/accept`,'POST',{})).status,200);
    assert.equal((await api('b',`/api/calls/${id}/accept`,'POST',{})).status,409);
    assert.equal((await api('c',`/api/calls/${id}/signal`,'POST',{type:'offer',payload:{}})).status,403);
    assert.equal((await api('a',`/api/calls/${id}/signal`,'POST',{type:'offer',payload:{type:'offer',sdp:'hello'}})).status,200);
    assert.equal((await api('a','/api/calls/active')).data.call.status,'connected');
    assert.equal((await api('b',`/api/calls/${id}/end`,'POST',{})).status,200);
    assert.equal((await api('a','/api/calls/active')).data.call,null);
    assert.equal((await api('a',`/api/calls/${id}/end`,'POST',{})).status,404);
  }finally{receiver?.abort();await new Promise(resolve=>server.close(resolve));rmSync(dir,{recursive:true,force:true});}
});
