import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

async function withApp(fn){
  const dir=mkdtempSync(join(tmpdir(),'nexhub-v27-'));
  process.env.DB_PATH=join(dir,'test.sqlite');
  process.env.MEDIA_PATH=join(dir,'media');
  process.env.NODE_ENV='test';
  process.env.CREATOR_SETUP_CODE='codigo-criador-vip-v27';
  const mod=await import('../src/server.js?case='+Math.random());
  const server=mod.createApp();
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  const agents={admin:'',vip:''};
  async function api(user,route,method='GET',body){
    const res=await fetch(base+route,{method,headers:{...(agents[user]?{Cookie:agents[user]}:{}),...(body!==undefined?{'Content-Type':'application/json'}:{})},body:body!==undefined?JSON.stringify(body):undefined});
    const cookie=res.headers.get('set-cookie');if(cookie&&cookie.startsWith('nexo_session='))agents[user]=cookie.split(';')[0];
    return {status:res.status,data:await res.json().catch(()=>({}))};
  }
  try{await fn({api});}
  finally{await new Promise(resolve=>server.close(resolve));rmSync(dir,{recursive:true,force:true});}
}

test('v27: criador ativa VIP R$5 e usuário recebe badge e status',async()=>withApp(async({api})=>{
  const admin=await api('admin','/api/register','POST',{username:'dono_vip',email:'dono-vip@example.com',password:'safe_password1'});
  assert.equal(admin.status,201,JSON.stringify(admin.data));
  const vip=await api('vip','/api/register','POST',{username:'kaua_vip',email:'kaua-vip@example.com',password:'safe_password2'});
  assert.equal(vip.status,201,JSON.stringify(vip.data));
  assert.equal((await api('admin','/api/creator/claim','POST',{code:'codigo-criador-vip-v27'})).status,200);
  const before=await api('vip','/api/vip');
  assert.equal(before.status,200);
  assert.equal(before.data.vip.active,false);
  const activated=await api('admin',`/api/creator/users/${vip.data.user.id}/vip`,'POST',{action:'activate',days:30,plan:'VIP R$5',note:'Pago via Pix manual'});
  assert.equal(activated.status,200,JSON.stringify(activated.data));
  assert.equal(activated.data.user.vipActive,true);
  assert.ok(activated.data.user.badges.some(b=>b.id==='vip'));
  const after=await api('vip','/api/me');
  assert.equal(after.data.user.vipActive,true);
  assert.ok(after.data.user.vipDaysLeft>=1);
  assert.ok(after.data.user.badges.some(b=>b.label.includes('VIP')));
  const status=await api('vip','/api/vip');
  assert.equal(status.data.vip.priceBRL,5);
  assert.equal(status.data.vip.active,true);
  assert.ok(status.data.vip.benefits.length>=6);
  const overview=await api('admin','/api/creator/overview');
  assert.equal(overview.data.counts.vipUsers,1);
  const removed=await api('admin',`/api/creator/users/${vip.data.user.id}/vip`,'POST',{action:'remove'});
  assert.equal(removed.status,200,JSON.stringify(removed.data));
  assert.equal((await api('vip','/api/me')).data.user.vipActive,false);
}));
