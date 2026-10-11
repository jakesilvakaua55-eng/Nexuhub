import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { iceConfiguration } from '../src/ice.js';

const url = 'turn:turn.exemplo.test:3478?transport=udp';
test('ICE: TURN só é anunciado com credenciais e assinatura temporária verificável', () => {
  const naked=iceConfiguration('alice',{TURN_URLS:url,STUN_URLS:'stun:stun.l.google.com:19302'});
  assert.equal(naked.turnEnabled,false);
  assert.equal(naked.iceServers.length,1);
  const secret='secret-example-for-tests-123456789';
  const cfg=iceConfiguration('alice',{TURN_URLS:url,TURN_SHARED_SECRET:secret,FORCE_TURN:'true'},1000000000000);
  assert.equal(cfg.turnEnabled,true);
  assert.equal(cfg.iceTransportPolicy,'relay');
  const turn=cfg.iceServers.at(-1);
  assert.deepEqual(turn.urls,[url]);
  assert.equal(turn.username,'1000007200:alice');
  assert.equal(turn.credential,createHmac('sha1',secret).update(turn.username).digest('base64'));
});

const dir=mkdtempSync(join(tmpdir(),'nexo-recovery-'));
process.env.DB_PATH=join(dir,'db.sqlite');
process.env.MEDIA_PATH=join(dir,'media');
process.env.NODE_ENV='test';
process.env.TURN_URLS='turn:turn.exemplo.test:3478?transport=udp';
process.env.TURN_SHARED_SECRET='shared-test-secret-12345678901234567890';
const { createApp }=await import('../src/server.js');
const server=createApp();
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}`;
const cookies={};
async function api(who,path,method='GET',body){
  const r=await fetch(base+path,{method,headers:{...(cookies[who]?{cookie:cookies[who]}:{}),...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
  const c=r.headers.get('set-cookie');if(c?.startsWith('nexo_session='))cookies[who]=c.split(';')[0];
  return {status:r.status,data:await r.json()};
}
test('API: configuração ICE autenticada; sinais perdidos durante reconexão podem ser recuperados',async()=>{
  let ctrl;
  try{
    assert.equal((await api('anon','/api/calls/ice-config')).status,401);
    const aa=await api('a','/api/register','POST',{username:'user_aa',email:'aa2@example.com',password:'password12345'});
    const bb=await api('b','/api/register','POST',{username:'user_bb',email:'bb2@example.com',password:'password12345'});
    await api('c','/api/register','POST',{username:'user_cc',email:'cc2@example.com',password:'password12345'});
    const ice=await api('a','/api/calls/ice-config');assert.equal(ice.status,200);
    assert.equal(ice.data.turnEnabled,true);
    ctrl=new AbortController();
    const live=await fetch(base+'/api/events',{signal:ctrl.signal,headers:{cookie:cookies.b}});
    assert.equal(live.status,200);
    const created=await api('a','/api/calls','POST',{to:bb.data.user.id,mode:'video'});
    assert.equal(created.status,201);
    const id=created.data.call.id;
    assert.equal((await api('b',`/api/calls/${id}/accept`,'POST',{})).status,200);
    assert.equal((await api('c',`/api/calls/${id}/signals`)).status,403);
    const offer={type:'offer',sdp:'teste'};
    assert.equal((await api('a',`/api/calls/${id}/signal`,'POST',{type:'offer',payload:offer})).status,200);
    assert.equal((await api('a',`/api/calls/${id}/signal`,'POST',{type:'ice',payload:{candidate:'candidate:1'}})).status,200);
    const replay=await api('b',`/api/calls/${id}/signals?after=0`);
    assert.equal(replay.status,200);
    assert.deepEqual(replay.data.signals.map(e=>e.type),['offer','ice']);
    assert.equal(replay.data.signals[0].seq+1,replay.data.signals[1].seq);
    assert.equal((await api('b',`/api/calls/${id}/signals?after=${replay.data.signals[0].seq}`)).data.signals.length,1);
    assert.equal((await api('a',`/api/calls/${id}/signals?after=0`)).data.signals.length,0);
    assert.equal((await api('a',`/api/calls/${id}/signals?after=-1`)).status,400);
    assert.equal((await api('b',`/api/calls/${id}/end`,'POST',{})).status,200);
    assert.equal((await api('b',`/api/calls/${id}/signals?after=0`)).status,404);
  }finally{ctrl?.abort();await new Promise(resolve=>server.close(resolve));rmSync(dir,{recursive:true,force:true});}
});
