import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

async function withApp(fn){
  const dir=mkdtempSync(join(tmpdir(),'nexhub-v26-'));
  process.env.DB_PATH=join(dir,'test.sqlite');
  process.env.MEDIA_PATH=join(dir,'media');
  process.env.NODE_ENV='test';
  process.env.VAPID_PUBLIC_KEY='BOGUS_PUBLIC_KEY_FOR_TEST';
  process.env.VAPID_PRIVATE_KEY='BOGUS_PRIVATE_KEY_FOR_TEST';
  process.env.VAPID_SUBJECT='mailto:test@example.com';
  const mod=await import('../src/server.js?case='+Math.random());
  const server=mod.createApp();
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  const agents={a:'',b:''};
  async function api(user,route,method='GET',body,headers={}){
    const res=await fetch(base+route,{method,headers:{...(agents[user]?{Cookie:agents[user]}:{}),...(body!==undefined&&!Buffer.isBuffer(body)?{'Content-Type':'application/json'}:{}),...headers},body:body===undefined?undefined:(Buffer.isBuffer(body)?body:JSON.stringify(body))});
    const cookie=res.headers.get('set-cookie');if(cookie&&cookie.startsWith('nexo_session='))agents[user]=cookie.split(';')[0];
    const json=await res.json().catch(()=>({}));return {status:res.status,data:json};
  }
  try{await fn({api,base,agents});}
  finally{await new Promise(resolve=>server.close(resolve));rmSync(dir,{recursive:true,force:true});}
}

const fakeWebm=Buffer.from('1a45dfa300000000000000000000000000','hex');

test('v26: mensagens de voz funcionam em canal e PV',async()=>withApp(async({api})=>{
  const a=await api('a','/api/register','POST',{username:'ana_v26',email:'ana26@example.com',password:'safe_password1'});assert.equal(a.status,201,JSON.stringify(a.data));
  const b=await api('b','/api/register','POST',{username:'bruno_v26',email:'bruno26@example.com',password:'safe_password2'});assert.equal(b.status,201,JSON.stringify(b.data));
  const server=await api('a','/api/servers','POST',{name:'Voz Premium'});assert.equal(server.status,201,JSON.stringify(server.data));
  const channel=server.data.server.channels.find(c=>c.type==='text').id;
  const voice=await api('a',`/api/channels/${channel}/voice-message`,'POST',fakeWebm,{'Content-Type':'audio/webm'});
  assert.equal(voice.status,201,JSON.stringify(voice.data));
  assert.ok(voice.data.message.voice.url.endsWith('.webm'));
  const messages=await api('a',`/api/channels/${channel}/messages`);
  assert.equal(messages.data.messages.at(-1).content,'');
  assert.ok(messages.data.messages.at(-1).voice.url.includes('/media/'));
  const dm=await api('a',`/api/dms/${b.data.user.id}/messages/voice-message`,'POST',fakeWebm,{'Content-Type':'audio/webm'});
  assert.equal(dm.status,201,JSON.stringify(dm.data));
  const dms=await api('b',`/api/dms/${a.data.user.id}/messages`);
  assert.equal(dms.status,200,JSON.stringify(dms.data));
  assert.equal(dms.data.messages[0].content,'');
  assert.ok(dms.data.messages[0].voice.url.endsWith('.webm'));
  const inbox=await api('b','/api/dms');
  assert.equal(inbox.data.contacts.find(x=>x.id===a.data.user.id).lastPreview,'🎙️ Mensagem de voz');
}));

test('v26: push status expõe chave pública sem vazar privada',async()=>withApp(async({api})=>{
  const a=await api('a','/api/register','POST',{username:'push_v26',email:'push26@example.com',password:'safe_password1'});assert.equal(a.status,201);
  const status=await api('a','/api/push-status');
  assert.equal(status.status,200);
  assert.equal(status.data.webPushConfigured,true);
  assert.equal(status.data.publicKey,'BOGUS_PUBLIC_KEY_FOR_TEST');
  assert.equal(JSON.stringify(status.data).includes('BOGUS_PRIVATE_KEY_FOR_TEST'),false);
  const setup=await api('a','/api/push-setup');
  assert.equal(setup.status,200);
  assert.equal(setup.data.ready,true);
  assert.ok(setup.data.exampleEnv.includes('VAPID_PUBLIC_KEY'));
}));
