// Uploads públicos de perfil: formato inferido por assinatura, não pelo nome do arquivo.
import { mkdirSync, readFileSync, writeFileSync, unlinkSync, existsSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
const root = resolve(process.env.MEDIA_PATH || './data/media');
mkdirSync(root, { recursive: true });
const types = {jpg:'image/jpeg',png:'image/png',gif:'image/gif',webp:'image/webp',mp4:'video/mp4',mp3:'audio/mpeg',wav:'audio/wav',ogg:'audio/ogg',webm:'audio/webm'};
const maxSizes = { avatar: 5 * 1024 * 1024, banner: 18 * 1024 * 1024, serverIcon: 5 * 1024 * 1024, asset: 8 * 1024 * 1024, sound: 4 * 1024 * 1024 };
export function detect(bytes) {
  if (bytes.length >= 3 && bytes.subarray(0,3).toString('hex') === 'ffd8ff') return 'jpg';
  if (bytes.length >= 8 && bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex'))) return 'png';
  if (bytes.length >= 6 && ['GIF87a','GIF89a'].includes(bytes.toString('ascii',0,6))) return 'gif';
  if (bytes.length >= 12 && bytes.toString('ascii',0,4)==='RIFF' && bytes.toString('ascii',8,12)==='WEBP') return 'webp';
  if (bytes.length>=16 && bytes.toString('ascii',4,8)==='ftyp') return 'mp4';
  if (bytes.length>=3 && bytes.toString('ascii',0,3)==='ID3') return 'mp3';
  if (bytes.length>=2 && bytes[0]===0xff && (bytes[1]&0xe0)===0xe0) return 'mp3';
  if (bytes.length>=12 && bytes.toString('ascii',0,4)==='RIFF' && bytes.toString('ascii',8,12)==='WAVE') return 'wav';
  if (bytes.length>=4 && bytes.toString('ascii',0,4)==='OggS') return 'ogg';
  // MediaRecorder no Chrome/Android costuma gerar WebM/Opus para mensagens de voz.
  if (bytes.length>=4 && bytes.subarray(0,4).equals(Buffer.from('1a45dfa3','hex'))) return 'webm';
  return null;
}
// Duração de MP4 sem depender de ffmpeg: caixa moov/mvhd (ISO BMFF).
export function mp4Duration(buffer) {
  function boxes(start,end,depth=0) {
    let p=start;
    while (p+8<=end && depth<3) {
      let length=buffer.readUInt32BE(p), header=8;
      const kind=buffer.toString('ascii',p+4,p+8);
      if(length===1){if(p+16>end)return null;const large=buffer.readBigUInt64BE(p+8);if(large>BigInt(Number.MAX_SAFE_INTEGER))return null;length=Number(large);header=16;}
      else if(length===0)length=end-p;
      if(length<header || p+length>end)return null;
      if(kind==='mvhd') {
        const q=p+header;
        if(buffer.length < q+32)return null;
        const version=buffer[q];
        if(version===0){const scale=buffer.readUInt32BE(q+12), units=buffer.readUInt32BE(q+16);return scale?units/scale:null;}
        if(version===1 && q+32<=buffer.length){const scale=buffer.readUInt32BE(q+20), units=buffer.readBigUInt64BE(q+24);return scale?Number(units)/scale:null;}
        return null;
      }
      if(kind==='moov') {const val=boxes(p+header,p+length,depth+1);if(val!==undefined)return val;}
      p+=length;
    }
    return undefined;
  }
  return boxes(0,buffer.length) ?? null;
}

function uploadFingerprint(buffer){return createHash('sha256').update(buffer).digest('hex');}
function suspiciousMedia(buffer, ext){
  const head=buffer.subarray(0,4096).toString('latin1').toLowerCase();
  if(['jpg','png','gif','webp'].includes(ext)){
    if(head.includes('<script') || head.includes('<?php') || head.includes('<html') || head.includes('javascript:')) return 'Imagem contém marcação/script suspeito.';
  }
  const signatures=[buffer.includes(Buffer.from('MZ')), buffer.includes(Buffer.from('<?php')), buffer.includes(Buffer.from('<script'))].filter(Boolean).length;
  if(signatures && ['jpg','png','gif','webp'].includes(ext)) return 'Arquivo parece esconder conteúdo executável.';
  return '';
}
export async function readUpload(req,kind) {
  if(!maxSizes[kind])throw Object.assign(new Error('Tipo de arquivo inválido.'),{status:400});
  const max=maxSizes[kind]; const sizeHeader=Number(req.headers['content-length'] || 0);
  if(sizeHeader>max)throw Object.assign(new Error('Arquivo muito grande.'),{status:413});
  const chunks=[];let len=0;
  for await(const chunk of req){len+=chunk.length;if(len>max)throw Object.assign(new Error('Arquivo muito grande.'),{status:413});chunks.push(chunk);}
  const data=Buffer.concat(chunks);const ext=detect(data);const sha256=uploadFingerprint(data);
  const imageExt=['jpg','png','gif','webp'];
  const audioExt=['mp3','wav','ogg','webm'];
  const ok = kind==='banner' ? [...imageExt,'mp4'].includes(ext)
    : kind==='asset' ? imageExt.includes(ext)
    : kind==='sound' ? audioExt.includes(ext)
    : imageExt.includes(ext);
  if(!ext || !ok)throw Object.assign(new Error(kind==='sound'?'Use MP3, WAV, OGG ou WebM.':kind==='banner'?'Use JPG, PNG, GIF, WebP ou MP4 de até 10 segundos.':'Use JPG, PNG, GIF ou WebP.'),{status:415});
  const suspicious=ext?suspiciousMedia(data,ext):'';
  if(suspicious)throw Object.assign(new Error(suspicious),{status:415});
  if(ext==='mp4') {const duration=mp4Duration(data);if(!duration||!Number.isFinite(duration)||duration>10 ||duration<0.1)throw Object.assign(new Error('Vídeo do banner precisa ter duração reconhecível de até 10 segundos (MP4).'),{status:400});}
  const filename=randomUUID()+'.'+ext;
  writeFileSync(join(root,filename),data,{flag:'wx',mode:0o644});
  return {url:'/media/'+filename,kind,ext,bytes:data.length,sha256,verdict:'accepted'};
}
export function removeMedia(url){if(typeof url!=='string'||!/^\/media\/[a-f0-9-]{36}\.(?:jpg|png|gif|webp|mp4|mp3|wav|ogg|webm)$/.test(url))return;try{unlinkSync(join(root,url.slice(7)));}catch{}}
export function serveMedia(req,res,url){
  const match=/^\/media\/([a-f0-9-]{36}\.(?:jpg|png|gif|webp|mp4|mp3|wav|ogg|webm))$/.exec(url);
  if(!match)return false;
  const path=join(root,match[1]);if(!existsSync(path))return false;
  const type=types[match[1].split('.').pop()];const size=statSync(path).size;
  let start=0,end=size-1,status=200;
  if(req.headers.range){const range=/^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
    if(!range){res.writeHead(416,{'content-range':`bytes */${size}`});res.end();return true;}
    if(range[1]===''&&range[2]===''){res.writeHead(416,{'content-range':`bytes */${size}`});res.end();return true;}
    if(range[1]===''){const suffix=Number(range[2]);start=Math.max(0,size-suffix);}
    else {start=Number(range[1]);end=range[2]?Math.min(size-1,Number(range[2])):end;}
    if(start>=size||start>end){res.writeHead(416,{'content-range':`bytes */${size}`});res.end();return true;}
    status=206;
  }
  const headers={'content-type':type,'content-length':end-start+1,'accept-ranges':'bytes','cache-control':'public, max-age=86400','x-content-type-options':'nosniff','content-security-policy':"default-src 'none'; sandbox"};
  if(status===206)headers['content-range']=`bytes ${start}-${end}/${size}`;
  res.writeHead(status,headers);res.end(readFileSync(path).subarray(start,end+1));return true;
}
