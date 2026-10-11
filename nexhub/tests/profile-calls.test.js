import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const dir=mkdtempSync(join(tmpdir(),'nexo-profile-'));
process.env.DB_PATH=join(dir,'database.sqlite');
process.env.MEDIA_PATH=join(dir,'media');
process.env.NODE_ENV='test';
const {createApp}=await import('../src/server.js');
const {mp4Duration}=await import('../src/media.js');
const server=createApp();
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}`;
const cookies={};
async function call(who,path,method='GET',body,raw=false){
  const res=await fetch(base+path,{method,headers:{...(cookies[who]?{cookie:cookies[who]}:{}),...(body!==undefined?{'Content-Type':raw?'application/octet-stream':'application/json'}:{})},body:body===undefined?undefined:raw?body:JSON.stringify(body)});
  const cookie=res.headers.get('set-cookie');if(cookie?.startsWith('nexo_session='))cookies[who]=cookie.split(';')[0];
  return {status:res.status,data:await res.json()};
}
function mp4(seconds){
  function box(type,data){const buf=Buffer.alloc(data.length+8);buf.writeUInt32BE(buf.length,0);buf.write(type,4,'ascii');data.copy(buf,8);return buf;}
  const ftyp=box('ftyp',Buffer.from('isom0000isom','ascii'));
  const mvhd=Buffer.alloc(100);mvhd.writeUInt32BE(1000,12);mvhd.writeUInt32BE(seconds*1000,16);
  const moov=box('moov',box('mvhd',mvhd));return Buffer.concat([ftyp,moov]);
}
test('contas, perfis e upload seguro: imagem livre e vídeo de até 10s',async()=>{
  try{
    const first=await call('a','/api/register','POST',{username:'estrela',email:'estrela@example.com',password:'1234567890!'});
    assert.equal(first.status,201);
    const second=await call('b','/api/register','POST',{username:'astro',email:'astro@example.com',password:'1234567890!'});
    assert.equal(second.status,201);
    const a=first.data.user.id;
    assert.equal((await call('b','/api/users/'+a)).status,200);
    const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO//ekcAAAAASUVORK5CYII=','base64');
    const upload=await call('a','/api/me/media/avatar','PUT',png,true);
    assert.equal(upload.status,200,JSON.stringify(upload.data));
    assert.match(upload.data.user.avatarUrl,/^\/media\/[a-f0-9-]+\.png$/);
    assert.equal((await call('b','/api/users/'+a)).data.user.avatarUrl,upload.data.user.avatarUrl);
    const img=await fetch(base+upload.data.user.avatarUrl);assert.equal(img.status,200);assert.equal(img.headers.get('content-type'),'image/png');
    assert.equal((await call('b','/api/me/media/avatar','PUT',Buffer.from('hello'),true)).status,415);
    assert.equal((await call('a','/api/me/media/avatar','PUT',mp4(3),true)).status,415);
    assert.equal((await call('a','/api/me/media/banner','PUT',mp4(11),true)).status,400);
    assert.equal((await call('a','/api/me/media/banner','PUT',Buffer.concat([Buffer.alloc(4),Buffer.from('ftypxxxxxxxxxxxx')]),true)).status,400);
    assert.equal(mp4Duration(mp4(10)),10);
    const banner=await call('a','/api/me/media/banner','PUT',mp4(10),true);
    assert.equal(banner.status,200,JSON.stringify(banner.data));assert.equal(banner.data.user.bannerType,'video');
    const media=await fetch(base+banner.data.user.bannerUrl,{headers:{range:'bytes=0-15'}});
    assert.equal(media.status,206);assert.match(media.headers.get('content-range'),/^bytes 0-15\//);
    assert.equal((await call('a','/api/me/media/banner','DELETE')).status,200);
    assert.equal((await fetch(base+banner.data.user.bannerUrl)).status,404);
    assert.equal((await call('a','/api/me/media/avatar','DELETE')).data.user.avatarUrl,'');
    assert.equal((await fetch(base+upload.data.user.avatarUrl)).status,404);
    assert.equal((await call('b','/api/me')).data.user.id,second.data.user.id);
  }finally{await new Promise(resolve=>server.close(resolve));rmSync(dir,{recursive:true,force:true});}
});
