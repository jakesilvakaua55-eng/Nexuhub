import http from 'node:http';
import { readFileSync, statSync, existsSync, mkdirSync, cpSync } from 'node:fs';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, randomUUID, createHash, createHmac, createECDH, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { openDatabase } from './database.js';
import { readUpload, removeMedia, serveMedia } from './media.js';
import { iceStatus, resolveIceConfiguration, turnSetupGuide } from './ice.js';

function loadLocalEnv(){
  const file=resolve(process.cwd(),'.env');
  if(!existsSync(file))return;
  try{
    for(const line of readFileSync(file,'utf8').split(/\r?\n/)){
      const raw=line.trim();
      if(!raw||raw.startsWith('#')||!raw.includes('='))continue;
      const i=raw.indexOf('=');
      const key=raw.slice(0,i).trim();
      let val=raw.slice(i+1).trim();
      if((val.startsWith('"')&&val.endsWith('"'))||(val.startsWith("'")&&val.endsWith("'")))val=val.slice(1,-1);
      if(key&&!process.env[key])process.env[key]=val;
    }
  }catch{}
}
loadLocalEnv();

const scrypt = promisify(scryptCb);
const db = openDatabase();
const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../public');
const streams = new Map();
const calls = new Map(); // chamadas individuais ativas, sinalização efêmera por SSE
const voiceRooms = new Map(); // salas de voz em grupo: participantes e sinalização WebRTC efêmera
const limits = new Map();
const id = () => randomUUID();
let lastMessageTime = 0;
const messageId = () => { lastMessageTime = Math.max(Date.now(), lastMessageTime + 1); return lastMessageTime.toString().padStart(13, '0') + '-' + randomBytes(8).toString('hex'); };
const now = () => Date.now();
const row = (sql, ...params) => db.prepare(sql).get(...params);
const all = (sql, ...params) => db.prepare(sql).all(...params);
const run = (sql, ...params) => db.prepare(sql).run(...params);
const fail = (status, error) => { const e = new Error(error); e.status = status; throw e; };
const must = (condition, status = 403, error = 'Sem permissão.') => { if (!condition) fail(status, error); };
const clean = (value, max = 120) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const cleanLogin = value => clean(value, 200).toLowerCase().replace(/^@+/, '');
const cleanServerName = value => {
  if (typeof value !== 'string') return '';
  return value.replace(/[-]/g, '').replace(/\s+/g, ' ').trim().slice(0, 80);
};
function secureEquals(a,b){const x=Buffer.from(String(a||''));const y=Buffer.from(String(b||''));return x.length===y.length && x.length>0 && timingSafeEqual(x,y);}
const profileEffectList = ['none','flowers','pixel_hearts','sparkles','neon_aura','cute_pink','sakura','snow','butterflies','glitch','premium_purple','galaxy_pulse','neon_grid','soft_gradient','video_cosmic_rings','video_spirit_mask','video_night_study','video_neon_eye','video_crystal_eye','video_sunset_dream','video_lonely_night','video_neon_car','video_dark_petal_eye'];
const safeProfileEffect = value => profileEffectList.includes(value) ? value : 'none';
const profileFields = 'id, username, email, email_verified AS emailVerified, display_name AS displayName, bio, premium_bio AS premiumBio, color, status, activity_text AS activityText, activity_kind AS activityKind, favorite_server_id AS favoriteServerId, theme, allow_dm AS allowDm, avatar_url AS avatarUrl, banner_url AS bannerUrl, banner_type AS bannerType, profile_effect AS profileEffect, twofa_enabled AS twofaEnabled, vip_since AS vipSince, vip_until AS vipUntil, vip_plan AS vipPlan, vip_note AS vipNote, vip_name_style AS vipNameStyle, vip_profile_animation_url AS vipProfileAnimationUrl';
const isPlaceholderEmail = value => typeof value === 'string' && value.endsWith('@accounts.nexhub.invalid');
function isVipActive(u){
  if(!u?.vipUntil && !u?.vip_until)return false;
  const raw=String(u.vipUntil||u.vip_until||'');
  if(raw==='forever')return true;
  const t=Date.parse(raw.includes('T')?raw:raw.replace(' ','T')+'Z');
  return Number.isFinite(t)&&t>Date.now();
}
function vipDaysLeft(u){
  if(!isVipActive(u))return 0;
  const raw=String(u.vipUntil||u.vip_until||'');
  if(raw==='forever')return 9999;
  const t=Date.parse(raw.includes('T')?raw:raw.replace(' ','T')+'Z');
  return Math.max(1,Math.ceil((t-Date.now())/86400000));
}
function decorateVip(u){return u?{...u,emailVerified:!!u.emailVerified,twofaEnabled:!!u.twofaEnabled,vipActive:isVipActive(u),vipDaysLeft:vipDaysLeft(u)}:u;}

const vipNameStyles = ['neon','gold','rainbow','ice','fire','glitch','angel','shadow'];
const safeVipNameStyle = value => vipNameStyles.includes(String(value||'')) ? String(value) : '';
function vipFeatureFlags(u){
  const active=isVipActive(u);
  return {
    active,
    adminIncluded:false,
    vipDays:30,
    maxBoosts:active?2:0,
    maxServerBots:active?2:1,
    profileVideo:true,
    customNameStyle:active,
    customBotBranding:active,
    screenShare:true,
    antiHack:'Todos os benefícios VIP são validados no servidor; APK modificado não libera VIP sem pagamento confirmado.'
  };
}
function logSecurity(userId,kind,detail='',ip=''){
  try{run('INSERT INTO security_events(id,user_id,kind,detail,ip) VALUES(?,?,?,?,?)',id(),userId||'',kind,clean(detail,800),clean(ip,120));}catch{}
}

function auditUpload(userId,kind,upload,ip=''){
  if(!upload)return;
  try{run('INSERT INTO upload_audit(id,user_id,kind,url,ext,bytes,sha256,verdict,ip) VALUES(?,?,?,?,?,?,?,?,?)',id(),userId||'',kind,upload.url||'',upload.ext||'',Number(upload.bytes||0),upload.sha256||'',upload.verdict||'accepted',clean(ip,120));}catch{}
}
function securityScoreForUser(userId){
  const failed=Number(row("SELECT COUNT(*) AS n FROM security_events WHERE user_id=? AND kind IN ('login_failed','login_unknown') AND created_at>datetime('now','-1 day')",userId).n||0);
  const twofa=!!row('SELECT twofa_enabled AS enabled FROM users WHERE id=?',userId)?.enabled;
  const sessions=Number(row('SELECT COUNT(*) AS n FROM sessions WHERE user_id=? AND expires_at>?',userId,now()).n||0);
  const score=Math.max(20,100-(failed*12)-(sessions>5?10:0)+(twofa?10:0));
  return Math.min(100,score);
}
function platformSecuritySummary(){
  return {
    events24h:Number(row("SELECT COUNT(*) AS n FROM security_events WHERE created_at>datetime('now','-1 day')").n||0),
    failedLogins24h:Number(row("SELECT COUNT(*) AS n FROM security_events WHERE kind IN ('login_failed','login_unknown') AND created_at>datetime('now','-1 day')").n||0),
    suspiciousPix24h:Number(row("SELECT COUNT(*) AS n FROM security_events WHERE kind LIKE 'pix_%' AND created_at>datetime('now','-1 day')").n||0),
    activeSessions:Number(row('SELECT COUNT(*) AS n FROM sessions WHERE expires_at>?',now()).n||0),
    uploads24h:Number(row("SELECT COUNT(*) AS n FROM upload_audit WHERE created_at>datetime('now','-1 day')").n||0),
    reportsPending:Number(row("SELECT COUNT(*) AS n FROM reports WHERE status='pending'").n||0)
  };
}
function productionChecklist(){
  const pix=!!(process.env.PIX_RANDOM_KEY&&process.env.PIX_WEBHOOK_SECRET);
  const turn=iceStatus();
  const push=pushRuntimeStatus('');
  return [
    {id:'pix',title:'Pix automático',ok:pix,detail:pix?'Chave Pix e segredo webhook configurados.':'Configure PIX_RANDOM_KEY e PIX_WEBHOOK_SECRET.'},
    {id:'turn',title:'TURN para chamadas',ok:!!turn.turnConfigured,detail:turn.turnConfigured?(turn.provider==='Metered'?'Metered configurado para chamadas.':'TURN detectado para internet móvel.'):'Configure Metered ou TURN_URLS e credenciais.'},
    {id:'push',title:'Push com app fechado',ok:!!push.webPushConfigured,detail:push.webPushConfigured?'VAPID configurado.':'Configure VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY.'},
    {id:'creator',title:'Criador protegido',ok:Number(row('SELECT COUNT(*) AS n FROM platform_admins').n||0)>0,detail:'Mantenha o painel do criador fora do VIP.'},
    {id:'uploads',title:'Upload protegido',ok:true,detail:'Assinatura do arquivo, tamanho e conteúdo suspeito são validados no servidor.'},
    {id:'vip',title:'VIP server-side',ok:true,detail:'VIP, boosts e bots são validados no banco/servidor, não no APK.'}
  ];
}
function userPublic(userId){
  const u=row(`SELECT id,username,display_name AS displayName,color,status,bio,avatar_url AS avatarUrl,banner_url AS bannerUrl,banner_type AS bannerType,profile_effect AS profileEffect,email_verified AS emailVerified,created_at AS createdAt,vip_since AS vipSince,vip_until AS vipUntil,vip_plan AS vipPlan FROM users WHERE id=?`, userId);
  return u?{...decorateVip(u),isPlatformAdmin:platformAdmin(userId),badges:badgeListForUser({...u,id:userId})}:null;
}
function safeUser(userId) {
  const u=row(`SELECT ${profileFields},created_at AS createdAt FROM users WHERE id=?`, userId);
  if(!u)return null;
  const hasEmail=!isPlaceholderEmail(u.email);
  return {...decorateVip(u),email:hasEmail?u.email:'',hasEmail,isPlatformAdmin:platformAdmin(userId),badges:badgeListForUser({...u,id:userId})};
}
function cookieToken(req) {
  const cookies = (req.headers.cookie || '').split(';').map(s => s.trim());
  return cookies.find(v => v.startsWith('nexo_session='))?.slice(13) || '';
}
function currentUser(req) {
  const token = cookieToken(req);
  if (!/^[a-f0-9]{64}$/.test(token)) return null;
  const hash = createHash('sha256').update(token).digest('hex');
  const session = row('SELECT user_id FROM sessions WHERE token_hash=? AND expires_at>?', hash, now());
  return session && !accountBlockForUser(session.user_id).blocked ? safeUser(session.user_id) : null;
}
async function hashPassword(password, salt = randomBytes(16).toString('hex')) {
  const key = await scrypt(password, salt, 64);
  return salt + ':' + key.toString('hex');
}
async function passwordMatches(password, encoded) {
  const [salt, expected] = encoded.split(':');
  if (!salt || !expected || !/^[a-f0-9]{128}$/.test(expected)) return false;
  const actual = await scrypt(password, salt, 64);
  return timingSafeEqual(actual, Buffer.from(expected, 'hex'));
}
const base32Alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function base32(buffer){
  let bits=0,value=0,out='';
  for(const b of buffer){value=(value<<8)|b;bits+=8;while(bits>=5){out+=base32Alphabet[(value>>>(bits-5))&31];bits-=5;}}
  if(bits>0)out+=base32Alphabet[(value<<(5-bits))&31];
  return out;
}
function base32Decode(text){
  const cleanText=String(text||'').toUpperCase().replace(/[^A-Z2-7]/g,'');
  let bits=0,value=0,bytes=[];
  for(const ch of cleanText){const i=base32Alphabet.indexOf(ch);if(i<0)continue;value=(value<<5)|i;bits+=5;if(bits>=8){bytes.push((value>>>(bits-8))&255);bits-=8;}}
  return Buffer.from(bytes);
}
function totp(secret, step=Math.floor(Date.now()/30000)){
  const key=base32Decode(secret);if(!key.length)return '';
  const msg=Buffer.alloc(8);msg.writeBigUInt64BE(BigInt(step));
  const h=createHmac('sha1',key).update(msg).digest();const o=h[h.length-1]&15;
  return ((h.readUInt32BE(o)&0x7fffffff)%1000000).toString().padStart(6,'0');
}
function verifyTotp(secret, token){
  const cleanToken=String(token||'').replace(/\s+/g,'');
  if(!/^\d{6}$/.test(cleanToken))return false;
  const step=Math.floor(Date.now()/30000);
  return [-1,0,1].some(offset=>totp(secret,step+offset)===cleanToken);
}
function recoveryCodes(){return Array.from({length:8},()=>randomBytes(4).toString('hex').toUpperCase().match(/.{1,4}/g).join('-'));}
function consumeRecoveryCode(userId, code){
  const cleanCode=String(code||'').trim().toUpperCase();
  const rec=row('SELECT recovery_codes AS codes FROM users WHERE id=?',userId);if(!rec)return false;
  const codes=JSON.parse(rec.codes||'[]');const idx=codes.indexOf(cleanCode);if(idx<0)return false;
  codes.splice(idx,1);run('UPDATE users SET recovery_codes=? WHERE id=?',JSON.stringify(codes),userId);return true;
}
function voiceRoom(channelId){
  if(!voiceRooms.has(channelId))voiceRooms.set(channelId,{participants:new Map(),signals:[],seq:0});
  return voiceRooms.get(channelId);
}
function voiceRoomView(channelId){
  const room=voiceRooms.get(channelId); if(!room) return {channelId,participants:[],latestSeq:0};
  const participants=[...room.participants.entries()].map(([uid,p])=>({...userPublic(uid),muted:!!p.muted,cameraOff:!!p.cameraOff,joinedAt:p.joinedAt,lastSeen:p.lastSeen})).filter(x=>x.id);
  return {channelId,participants,latestSeq:room.seq};
}
function leaveVoice(channelId,userId,reason='left'){
  const room=voiceRooms.get(channelId); if(!room || !room.participants.has(userId)) return;
  room.participants.delete(userId);
  room.signals=room.signals.filter(signal=>signal.from!==userId&&signal.to!==userId);
  const ch=row('SELECT server_id FROM channels WHERE id=?',channelId);
  if(ch)emitServer(ch.server_id,'voice',{action:'left',channelId,userId,reason,room:voiceRoomView(channelId)});
  if(!room.participants.size)voiceRooms.delete(channelId);
}
function setSession(res, req, userId) {
  const token = randomBytes(32).toString('hex');
  run('INSERT INTO sessions(token_hash,user_id,expires_at,ip,user_agent) VALUES(?,?,?,?,?)', createHash('sha256').update(token).digest('hex'), userId, now() + 30 * 86400000, clean((process.env.TRUST_PROXY === 'true' ? String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() : req.socket.remoteAddress)||'',120), clean(req.headers['user-agent']||'',240));
  const secure = req.socket.encrypted || (process.env.TRUST_PROXY === 'true' && req.headers['x-forwarded-proto'] === 'https');
  res.setHeader('Set-Cookie', `nexo_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${secure ? '; Secure' : ''}`);
}
function json(res, status = 200, data = {}) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(JSON.stringify(data));
}
async function parse(req) {
  if (!req.headers['content-type']?.startsWith('application/json')) fail(415, 'Envie JSON válido.');
  let text = '';
  for await (const chunk of req) {
    text += chunk;
    if (text.length > 20000) fail(413, 'Conteúdo muito grande.');
  }
  try { const value = JSON.parse(text || '{}'); if (!value || typeof value !== 'object' || Array.isArray(value)) fail(400, 'JSON inválido.'); return value; }
  catch (e) { if (e.status) throw e; fail(400, 'JSON inválido.'); }
}
function verifyOrigin(req) {
  if (!['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method)) return;
  const origin = req.headers.origin;
  if (!origin) return;
  const expected = process.env.SITE_ORIGIN || requestOriginFromHeaders(req);
  must(origin === expected, 403, 'Origem não autorizada.');
}
function requestOriginFromHeaders(req) {
  const trustProxy = process.env.TRUST_PROXY === 'true';
  const forwarded = name => String(req.headers[name] || '').split(',')[0].trim();
  const host = (trustProxy && forwarded('x-forwarded-host')) || req.headers.host;
  const protocol = trustProxy ? forwarded('x-forwarded-proto').toLowerCase() : '';
  return `${req.socket.encrypted || protocol === 'https' ? 'https' : 'http'}://${host}`;
}
function throttle(key, limit, duration) {
  const t = now(); let item = limits.get(key);
  if (!item || item.until <= t) item = { n: 0, until: t + duration };
  item.n++; limits.set(key, item);
  if (item.n > limit) fail(429, 'Muitas tentativas. Aguarde um momento.');
  if (limits.size > 12000) for (const [k, v] of limits) if (v.until < t) limits.delete(k);
}
const permissionList = ['manage_server','manage_channels','manage_messages','manage_members','manage_roles','manage_bots','view_reports','create_invites','send_messages','use_voice'];
const moderatorPermissions = ['manage_channels','manage_messages','manage_members','view_reports','create_invites','send_messages','use_voice'];
function membership(serverId, userId) {
  return row('SELECT role, custom_role_id AS customRoleId FROM memberships WHERE server_id=? AND user_id=?', serverId, userId);
}
function permissions(serverId, userId) {
  const m = member(serverId,userId);
  if (m.role === 'owner') return permissionList;
  const result = new Set(m.role === 'moderator' ? moderatorPermissions : ['send_messages','use_voice','create_invites']);
  if (m.customRoleId) {
    const r = row('SELECT permissions FROM custom_roles WHERE id=? AND server_id=?',m.customRoleId,serverId);
    if (r) for (const p of JSON.parse(r.permissions)) if(permissionList.includes(p))result.add(p);
  }
  return [...result];
}
function allowed(serverId,userId,permission) {return permissions(serverId,userId).includes(permission);}
function requirePermission(serverId,userId,permission) {must(allowed(serverId,userId,permission),403,'Seu cargo não tem permissão para esta ação.');}
function platformAdmin(userId) {return !!row('SELECT user_id FROM platform_admins WHERE user_id=?',userId);}


const officialTitleCatalog = [
  {id:'owner',label:'Dono do NexHub',tone:'gold',scope:'app',description:'Responsável pelo projeto e pelo futuro da comunidade.'},
  {id:'admin',label:'Admin',tone:'blue',scope:'app',description:'Equipe com acesso ao painel administrativo.'},
  {id:'moderator',label:'Moderador',tone:'purple',scope:'app',description:'Ajuda a manter o NexHub seguro e organizado.'},
  {id:'verified',label:'Verificado',tone:'cyan',scope:'identity',description:'Identidade confirmada pela equipe do NexHub.'},
  {id:'vip',label:'VIP',tone:'violet',scope:'vip',description:'Membro VIP com benefícios exclusivos.'},
  {id:'partner',label:'Parceiro',tone:'orange',scope:'partner',description:'Comunidade, criador ou marca parceira do NexHub.'},
  {id:'influencer',label:'Influenciador',tone:'pink',scope:'creator',description:'Divulga o NexHub e ajuda a comunidade a crescer.'},
  {id:'content_creator',label:'Criador de Conteúdo',tone:'pink',scope:'creator',description:'Cria conteúdo para a comunidade.'},
  {id:'booster',label:'Booster',tone:'neon',scope:'supporter',description:'Impulsiona servidores e apoia novas conquistas.'},
  {id:'bot_official',label:'Bot Oficial',tone:'teal',scope:'bot',description:'Bot verificado que faz parte da equipe NexHub.'},
  {id:'founder',label:'Fundador',tone:'gold',scope:'special',description:'Pessoa importante da fase inicial do app.'},
  {id:'trusted',label:'Usuário Confiável',tone:'green',scope:'safety',description:'Conta com histórico positivo na comunidade.'}
];
const officialTitleMap = new Map(officialTitleCatalog.map(t=>[t.id,t]));
const safeTitleId = value => officialTitleMap.has(String(value||'')) ? String(value) : '';
function activeTitleRows(userId){
  return all(`SELECT title_id AS titleId,reason,expires_at AS expiresAt,created_at AS createdAt FROM user_titles
    WHERE user_id=? AND (expires_at IS NULL OR expires_at='forever' OR datetime(expires_at)>datetime('now'))
    ORDER BY created_at DESC`,userId);
}
function titleBadgesForUser(userId){
  return activeTitleRows(userId).map(t=>({...(officialTitleMap.get(t.titleId)||{id:t.titleId,label:t.titleId,tone:'default'}),id:t.titleId,expiresAt:t.expiresAt||null,official:true,icon:''}));
}
function resolveUserLogin(value){
  const raw=clean(String(value||''),200).trim().replace(/^@+/, '');
  must(raw.length>=2,400,'Informe o nome de usuário, ID, e-mail ou nome da conta.');
  const lower=raw.toLowerCase();
  const exact=row(`SELECT id,username,email,display_name AS displayName,avatar_url AS avatarUrl,color,banned_at AS bannedAt,suspended_until AS suspendedUntil FROM users
    WHERE id=? OR username=? OR email=? OR lower(display_name)=?`, raw, lower, lower, lower);
  if(exact)return exact;
  const matches=all(`SELECT id,username,email,display_name AS displayName,avatar_url AS avatarUrl,color,banned_at AS bannedAt,suspended_until AS suspendedUntil FROM users
    WHERE username LIKE ? OR lower(display_name) LIKE ? ORDER BY created_at DESC LIMIT 5`, raw+'%', lower+'%');
  must(matches.length!==0,404,'Conta não encontrada.');
  must(matches.length===1,409,'Mais de uma conta encontrada. Digite o @usuário ou ID exato.');
  return matches[0];
}
function titleExpiryFromDays(days){
  if(String(days||'').toLowerCase()==='forever' || String(days||'')==='0')return 'forever';
  const n=Math.min(3650,Math.max(1,Number(days||30)));
  return new Date(Date.now()+n*86400000).toISOString().slice(0,19).replace('T',' ');
}
function isSuspendedRow(u){
  const raw=String(u?.suspended_until||u?.suspendedUntil||'');
  if(!raw)return false;
  const t=Date.parse(raw.includes('T')?raw:raw.replace(' ','T')+'Z');
  return Number.isFinite(t)&&t>Date.now();
}
function accountBlockForUser(userId){
  const u=row('SELECT banned_at AS bannedAt,ban_reason AS banReason,suspended_until AS suspendedUntil,suspension_reason AS suspensionReason FROM users WHERE id=?',userId);
  if(!u)return {blocked:true,reason:'Conta não encontrada.'};
  if(u.bannedAt)return {blocked:true,type:'ban',reason:u.banReason||'Conta banida.'};
  if(isSuspendedRow(u))return {blocked:true,type:'suspension',until:u.suspendedUntil,reason:u.suspensionReason||'Conta suspensa temporariamente.'};
  return {blocked:false};
}
function publicPunishmentRows(){
  return all(`SELECT id,username,email,display_name AS displayName,banned_at AS bannedAt,ban_reason AS banReason,
      suspended_until AS suspendedUntil,suspension_reason AS suspensionReason,suspended_by AS suspendedBy,last_login_at AS lastLoginAt
    FROM users WHERE banned_at IS NOT NULL OR (suspended_until IS NOT NULL AND suspended_until!='' AND datetime(suspended_until)>datetime('now'))
    ORDER BY COALESCE(banned_at,suspended_until) DESC LIMIT 200`);
}
function hikariMascot(){
  return {name:'Hikari',title:'Mascote oficial do NexHub',tagline:'A luz do NexHub',phrase:'Conectando pessoas com mais brilho.',image:'/hikari-mascote.png',avatar:'/hikari-avatar.png',uses:['tela inicial','página VIP','eventos','avisos','tela de erro','onboarding']};
}


const exploreCategories = ['jogos','anime','musica','amizade','free-fire','roblox','minecraft','estudos','comunidade-br','criadores','comunidade'];
const activityKinds = ['online','away','busy','invisible','in_call','typing','recording_audio','watching','playing'];
function safeCategory(value){const v=clean(value,40).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');return exploreCategories.includes(v)?v:'comunidade';}
function safeActivityKind(value){const v=String(value||'online');return activityKinds.includes(v)?v:'online';}
function premiumProfile(userId){
  const u=safeUser(userId);must(u,404,'Usuário não encontrado.');
  const owned=all('SELECT id,name,category,verified_badge AS verifiedBadge,featured,safe_community AS safeCommunity FROM servers WHERE owner_id=? ORDER BY created_at DESC LIMIT 20',userId).map(s=>({...s,featured:!!s.featured,safeCommunity:!!s.safeCommunity}));
  const inventory=all(`SELECT i.item_id AS itemId,s.name,s.category,s.effect_key AS effectKey,i.active,i.acquired_at AS acquiredAt FROM user_effect_inventory i JOIN app_shop_items s ON s.id=i.item_id WHERE i.user_id=? ORDER BY i.active DESC,i.acquired_at DESC`,userId).map(i=>({...i,active:!!i.active}));
  return {user:u,badges:badgeListForUser({...u,id:userId}),titles:titleBadgesForUser(userId),inventory,ownedServers:owned,mascot:hikariMascot()};
}
function shopCatalogForUser(user){
  const owned=new Set(all('SELECT item_id AS id FROM user_effect_inventory WHERE user_id=?',user.id).map(x=>x.id));
  return all('SELECT id,name,category,description,price_kind AS priceKind,vip_only AS vipOnly,effect_key AS effectKey FROM app_shop_items WHERE enabled=1 ORDER BY vip_only,category,name').map(item=>({...item,vipOnly:!!item.vipOnly,owned:owned.has(item.id),locked:!!item.vipOnly&&!isVipActive(user)}));
}
function claimShopItem(user,itemId){
  const item=row('SELECT id,name,category,vip_only AS vipOnly,effect_key AS effectKey FROM app_shop_items WHERE id=? AND enabled=1',itemId);must(item,404,'Item da loja não encontrado.');
  must(!item.vipOnly || isVipActive(user),403,'Esse item é exclusivo VIP.');
  run('INSERT OR IGNORE INTO user_effect_inventory(user_id,item_id) VALUES(?,?)',user.id,item.id);
  return item;
}
function dailyRewardFor(userId){
  const today=new Date().toISOString().slice(0,10);
  let current=row('SELECT reward_date AS rewardDate,streak,reward,claimed_at AS claimedAt FROM daily_rewards WHERE user_id=? AND reward_date=?',userId,today);
  if(current)return {claimed:true,...current};
  const yesterday=new Date(Date.now()-86400000).toISOString().slice(0,10);
  const prev=row('SELECT streak FROM daily_rewards WHERE user_id=? AND reward_date=?',userId,yesterday);
  const streak=(prev?.streak||0)+1;
  const rewards=['Moldura simples','Efeito temporário','Selo temporário','Tema de chat','Destaque Hikari','Item da loja','Prêmio especial'];
  const reward=rewards[Math.min((streak-1)%7,6)];
  run('INSERT INTO daily_rewards(user_id,reward_date,streak,reward) VALUES(?,?,?,?)',userId,today,streak,reward);
  return {claimed:false,rewardDate:today,streak,reward,claimedAt:new Date().toISOString()};
}
function missionListFor(userId){
  return all(`SELECT m.id,m.title,m.description,m.target,m.reward,m.active,COALESCE(p.progress,0) AS progress,p.completed_at AS completedAt
    FROM mission_catalog m LEFT JOIN mission_progress p ON p.mission_id=m.id AND p.user_id=? WHERE m.active=1 ORDER BY m.id`,userId)
    .map(m=>({...m,active:!!m.active,completed:!!m.completedAt,progress:Math.min(Number(m.progress||0),Number(m.target||1))}));
}
function advanceMission(userId,missionId,amount=1){
  const m=row('SELECT id,target FROM mission_catalog WHERE id=? AND active=1',missionId);if(!m)return null;
  const old=row('SELECT progress,completed_at AS completedAt FROM mission_progress WHERE user_id=? AND mission_id=?',userId,missionId);
  if(old?.completedAt)return {...m,progress:old.progress,completed:true};
  const progress=Math.min(Number(m.target||1),Number(old?.progress||0)+Math.max(1,Number(amount||1)));
  const done=progress>=Number(m.target||1);
  run(`INSERT INTO mission_progress(user_id,mission_id,progress,completed_at,updated_at) VALUES(?,?,?,?,datetime('now'))
    ON CONFLICT(user_id,mission_id) DO UPDATE SET progress=excluded.progress,completed_at=excluded.completed_at,updated_at=datetime('now')`,userId,m.id,progress,done?new Date().toISOString().slice(0,19).replace('T',' '):null);
  if(done)notify(userId,'Missão concluída no NexHub!','/app?tab=missions');
  return {id:m.id,progress,target:m.target,completed:done};
}
function globalRankings(){
  return {
    servers:all(`SELECT s.id,s.name,s.category,s.verified_badge AS verifiedBadge,COUNT(m.user_id) AS members FROM servers s LEFT JOIN memberships m ON m.server_id=s.id GROUP BY s.id ORDER BY members DESC,s.created_at DESC LIMIT 20`),
    boosts:all(`SELECT s.id,s.name,COUNT(b.id) AS boosts FROM servers s LEFT JOIN server_boosts b ON b.server_id=s.id GROUP BY s.id ORDER BY boosts DESC,s.created_at DESC LIMIT 20`),
    vip:all(`SELECT id,username,display_name AS displayName,avatar_url AS avatarUrl,vip_until AS vipUntil FROM users WHERE vip_until IS NOT NULL AND vip_until!='' ORDER BY vip_since DESC LIMIT 20`),
    creators:all(`SELECT u.id,u.username,u.display_name AS displayName,COUNT(s.id) AS servers FROM users u LEFT JOIN servers s ON s.owner_id=u.id GROUP BY u.id ORDER BY servers DESC LIMIT 20`),
    partners:all(`SELECT u.id,u.username,u.display_name AS displayName,t.title_id AS titleId FROM user_titles t JOIN users u ON u.id=t.user_id WHERE t.title_id IN ('partner','influencer','content_creator') ORDER BY t.created_at DESC LIMIT 20`)
  };
}
function exploreServers(category=''){
  const cat=safeCategory(category||'comunidade');
  return all(`SELECT s.id,s.name,s.description,s.icon_url AS iconUrl,s.category,s.verified_badge AS verifiedBadge,s.featured,s.safe_community AS safeCommunity,
    COUNT(m.user_id) AS members,(SELECT COUNT(*) FROM server_boosts b WHERE b.server_id=s.id) AS boosts
    FROM servers s LEFT JOIN memberships m ON m.server_id=s.id
    WHERE (?='' OR s.category=?) GROUP BY s.id ORDER BY s.featured DESC,boosts DESC,members DESC,s.created_at DESC LIMIT 60`,category?cat:'',cat)
    .map(s=>({...s,featured:!!s.featured,safeCommunity:!!s.safeCommunity}));
}
function callFeaturePack(){return {screenShare:true,lowDataMode:true,speakerIndicator:true,muteUser:true,kickFromCall:true,micWarning:true,mobileAudioTips:['Use fone de ouvido.','Ative modo baixa internet em rede fraca.','Permita microfone no navegador.']};}
function nexBotPack(){return {name:'NexBot',official:true,actions:['boas-vindas','regras','alerta de ban','alerta de VIP','ranking do servidor','ajuda para novos usuários'],prefix:'/'}};

function accountExport(userId){
  const profile=row(`SELECT id,username,email,email_verified AS emailVerified,display_name AS displayName,bio,color,status,theme,allow_dm AS allowDm,avatar_url AS avatarUrl,banner_url AS bannerUrl,banner_type AS bannerType,profile_effect AS profileEffect,created_at AS createdAt,twofa_enabled AS twofaEnabled FROM users WHERE id=?`,userId);
  const servers=all(`SELECT s.id,s.name,s.description,s.owner_id AS ownerId,s.icon_url AS iconUrl,m.role,m.joined_at AS joinedAt FROM memberships m JOIN servers s ON s.id=m.server_id WHERE m.user_id=? ORDER BY m.joined_at DESC`,userId);
  const ownedServers=all(`SELECT id,name,description,icon_url AS iconUrl,created_at AS createdAt FROM servers WHERE owner_id=? ORDER BY created_at DESC`,userId);
  const messages=all(`SELECT msg.id,msg.channel_id AS channelId,c.name AS channelName,c.server_id AS serverId,s.name AS serverName,msg.content,msg.created_at AS createdAt,msg.updated_at AS editedAt,msg.pinned FROM messages msg JOIN channels c ON c.id=msg.channel_id JOIN servers s ON s.id=c.server_id WHERE msg.user_id=? ORDER BY msg.created_at DESC LIMIT 1000`,userId);
  const dms=all(`SELECT d.id,d.from_id AS fromId,d.to_id AS toId,uf.username AS fromUsername,ut.username AS toUsername,d.content,d.created_at AS createdAt FROM dms d LEFT JOIN users uf ON uf.id=d.from_id LEFT JOIN users ut ON ut.id=d.to_id WHERE d.from_id=? OR d.to_id=? ORDER BY d.created_at DESC LIMIT 1000`,userId,userId);
  const notifications=all(`SELECT id,text,href,read,created_at AS createdAt FROM notifications WHERE user_id=? ORDER BY created_at DESC LIMIT 500`,userId);
  return {app:'NexHub',exportedAt:new Date().toISOString(),profile:{...profile,twofaEnabled:!!profile?.twofaEnabled,emailVerified:!!profile?.emailVerified},servers,ownedServers,messages,dms,notifications};
}
function createBackupSnapshot(adminId){
  const dbPath=resolve(process.env.DB_PATH||'./data/nexo.sqlite');
  must(existsSync(dbPath),500,'Banco ainda não existe para backup.');
  const mediaPath=resolve(process.env.MEDIA_PATH||'./data/media');
  const destRoot=resolve(process.env.BACKUP_PATH||'./backups');
  const tag=new Date().toISOString().replace(/[:.]/g,'-');
  const out=join(destRoot,tag);
  mkdirSync(out,{recursive:true});
  const databaseDest=join(out,'nexhub.sqlite');
  db.exec("VACUUM INTO '"+databaseDest.replaceAll("'","''")+"'");
  let mediaCopied=false;
  if(existsSync(mediaPath)){cpSync(mediaPath,join(out,'media'),{recursive:true});mediaCopied=true;}
  const size=statSync(databaseDest).size;
  run('INSERT INTO platform_audit(id,admin_id,action,target_id,reason) VALUES(?,?,?,?,?)',id(),adminId,'backup:create',adminId,'Backup manual criado em '+out);
  return {folder:out,database:'nexhub.sqlite',databaseBytes:size,mediaCopied,createdAt:new Date().toISOString()};
}

function member(serverId, userId) { const m = membership(serverId, userId); must(m, 403, 'Entre no servidor antes.'); return m; }
function moderator(serverId, userId) { requirePermission(serverId,userId,'manage_members');return member(serverId,userId); }
function owner(serverId, userId) { const m = member(serverId, userId); must(m.role === 'owner'); return m; }
function channelMember(channelId, userId) {
  const channel = row('SELECT * FROM channels WHERE id=?', channelId);
  must(channel, 404, 'Canal não encontrado.'); member(channel.server_id, userId); return channel;
}
function log(serverId, actorId, action, targetId = '', detail = '') {
  run('INSERT INTO audit (id,server_id,actor_id,target_id,action,detail) VALUES (?,?,?,?,?,?)', id(), serverId, actorId, targetId, action, detail);
}
function emitUser(userId, name, data = {}) {
  const set = streams.get(userId);
  if (!set) return;
  for (const res of set) { try { res.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`); } catch { /* stream closed */ } }
}
function emitServer(serverId, name, data = {}) {
  for (const u of all('SELECT user_id FROM memberships WHERE server_id=?', serverId)) emitUser(u.user_id, name, data);
}
function notify(userId, text, href = '') {
  run('INSERT INTO notifications(id,user_id,text,href) VALUES(?,?,?,?)', id(), userId, text.slice(0, 240), href.slice(0, 300));
  emitUser(userId, 'notification', { text, href });
}
function markChannelRead(userId, channelId){
  run(`INSERT INTO channel_reads(user_id,channel_id,last_read_at) VALUES(?,?,datetime('now'))
    ON CONFLICT(user_id,channel_id) DO UPDATE SET last_read_at=datetime('now')`, userId, channelId);
}
function markDmRead(userId, peerId){
  run(`INSERT INTO dm_reads(user_id,peer_id,last_read_at) VALUES(?,?,datetime('now'))
    ON CONFLICT(user_id,peer_id) DO UPDATE SET last_read_at=datetime('now')`, userId, peerId);
}
function badgeListForUser(u){
  const badges=[];
  const userId=u?.id;
  const add=(b)=>{if(!badges.some(x=>x.id===b.id))badges.push({...b,icon:b.icon||''});};
  for(const b of userId?titleBadgesForUser(userId):[])add(b);
  if(u.isPlatformAdmin || userId && platformAdmin(userId))add({id:'owner',label:'Dono do NexHub',tone:'gold',official:true,icon:''});
  if(isVipActive(u))add({id:'vip',label:'VIP',tone:'violet',official:true,icon:''});
  if(u.emailVerified || u.email_verified)add({id:'verified',label:'Verificado',tone:'cyan',official:true,icon:''});
  if(u.created_at || u.createdAt){
    const date=new Date(String(u.created_at||u.createdAt).replace(' ','T')+'Z');
    if(Number.isFinite(date.getTime()) && Date.now()-date.getTime()>30*86400000)add({id:'old_member',label:'Membro antigo',tone:'silver',official:true,icon:''});
  }
  return badges;
}

const vipPriceBRL = 5;
const vipBenefits = [
  {id:'badge',title:'Badge VIP NexHub',desc:'Selo 💎 VIP no perfil, lista de membros e mensagens.'},
  {id:'glow',title:'Nome com brilho',desc:'Destaque visual sem atrapalhar o chat.'},
  {id:'frame',title:'Moldura no avatar',desc:'Avatar com borda premium e aparência mais rara.'},
  {id:'profile_video',title:'Vídeo/animação no perfil',desc:'Use banner em vídeo e estilo visual premium no perfil.'},
  {id:'name_style',title:'Estilo do nome',desc:'Escolha estilo VIP seguro para o nome, sem CSS livre perigoso.'},
  {id:'boosts',title:'2 impulsos de servidor',desc:'VIP recebe até 2 boosts ativos para apoiar servidores e liberar recompensas.'},
  {id:'bots',title:'Bot personalizado',desc:'VIP pode personalizar foto/banner/nome do bot do servidor e usar até 2 bots.'},
  {id:'voice',title:'Voz, call e compartilhamento de tela',desc:'Experiência premium em áudio, chamadas e tela quando o navegador permitir.'}
];
function vipViewForUser(u){
  return {active:isVipActive(u),plan:u?.vipPlan||'',since:u?.vipSince||u?.vip_since||'',until:u?.vipUntil||u?.vip_until||'',daysLeft:vipDaysLeft(u),priceBRL:vipPriceBRL,benefits:vipBenefits,features:vipFeatureFlags(u)};
}

function emv(id,value){value=String(value??'');return id+String(value.length).padStart(2,'0')+value;}
function crc16(payload){let crc=0xffff;for(let i=0;i<payload.length;i++){crc^=payload.charCodeAt(i)<<8;for(let j=0;j<8;j++)crc=(crc&0x8000)?((crc<<1)^0x1021):(crc<<1);crc&=0xffff;}return crc.toString(16).toUpperCase().padStart(4,'0');}
function pixPayload({key,amount,txid}){
  key=clean(key,120); if(!key)return '';
  const merchant=clean(process.env.PIX_MERCHANT_NAME||'NEXHUB',25).toUpperCase()||'NEXHUB';
  const city=clean(process.env.PIX_MERCHANT_CITY||'BRASIL',15).toUpperCase()||'BRASIL';
  const mai=emv('00','BR.GOV.BCB.PIX')+emv('01',key)+emv('02','NexHub VIP 30 dias');
  const tx=clean(txid,25)||'NEXHUBVIP';
  const raw=emv('00','01')+emv('26',mai)+emv('52','0000')+emv('53','986')+emv('54',Number(amount).toFixed(2))+emv('58','BR')+emv('59',merchant)+emv('60',city)+emv('62',emv('05',tx))+'6304';
  return raw+crc16(raw);
}
function pixConfig(){
  const key=process.env.PIX_RANDOM_KEY||process.env.PIX_KEY||'';
  return {configured:Boolean(key),keyMasked:key?key.slice(0,4)+'…'+key.slice(-4):'',merchant:process.env.PIX_MERCHANT_NAME||'NEXHUB',city:process.env.PIX_MERCHANT_CITY||'BRASIL',provider:process.env.PIX_PROVIDER||'standard-webhook',webhookConfigured:Boolean(process.env.PIX_WEBHOOK_SECRET)};
}
function requestOrigin(req){
  return process.env.PIX_WEBHOOK_PUBLIC_URL || process.env.SITE_ORIGIN || requestOriginFromHeaders(req);
}
function pixWebhookSetup(req){
  const origin=requestOrigin(req).replace(/\/$/,'');
  const cfg=pixConfig();
  return {
    ready:!!(cfg.configured&&cfg.webhookConfigured),
    configured:cfg,
    endpoint:origin+'/api/payments/pix/webhook',
    path:'/api/payments/pix/webhook',
    method:'POST',
    requiredHeader:'x-nexhub-pix-secret',
    secretConfigured:cfg.webhookConfigured,
    secretPreview:cfg.webhookConfigured?'configurado no .env':'faltando PIX_WEBHOOK_SECRET',
    acceptedStatuses:['paid','approved','confirmed'],
    requiredAmountCents:500,
    payloadExample:{reference:'NEXHUBREFERENCIA',status:'paid',amountCents:500,transactionId:'E2E_DO_BANCO'},
    antiFraud:['Não ativa por print ou comprovante enviado por usuário.','Precisa do header secreto do webhook.','Precisa bater referência única do pedido.','Precisa bater valor exato de R$ 5,00.','Ativação do VIP acontece somente no servidor.'],
    providerNotes:['Use um provedor Pix/API, banco, automação ou bot confiável para enviar esse webhook.','Não coloque o segredo no frontend.','O provedor deve enviar a referência do pedido criada pelo NexHub.']
  };
}
function normalizePixWebhook(body){
  const b=body||{};
  const nested=b.data||b.payment||b.pix||{};
  const reference=clean(b.reference||b.txid||b.txId||b.paymentReference||b.external_reference||b.externalReference||nested.reference||nested.txid||nested.txId||nested.external_reference||nested.externalReference,80);
  const paymentId=clean(b.paymentId||b.payment_id||b.id||nested.paymentId||nested.payment_id||nested.id,80);
  const status=clean(b.status||b.paymentStatus||nested.status||nested.paymentStatus,30).toLowerCase();
  const transactionId=clean(b.transactionId||b.transaction_id||b.endToEndId||b.end_to_end_id||b.e2eId||nested.transactionId||nested.endToEndId||nested.e2eId,120);
  const rawAmount=b.amountCents??b.amount_cents??b.valueCents??nested.amountCents??nested.amount_cents;
  const amountBRL=b.amount??b.value??b.transaction_amount??nested.amount??nested.value??nested.transaction_amount;
  let amountCents=Number(rawAmount);
  if(!Number.isFinite(amountCents)&&amountBRL!==undefined)amountCents=Math.round(Number(amountBRL)*100);
  return {reference,paymentId,status,transactionId,amountCents:Number.isFinite(amountCents)?amountCents:null};
}
function expireVipPayments(userId=''){
  const params=[];
  let where="status='pending' AND expires_at<=?";
  params.push(now());
  if(userId){where+=' AND user_id=?';params.push(userId);}
  const expired=all('SELECT id,user_id AS userId,reference FROM vip_payments WHERE '+where,...params);
  if(expired.length){
    run('UPDATE vip_payments SET status=\'expired\' WHERE '+where,...params);
    for(const p of expired)logSecurity(p.userId,'vip_payment_expired',p.reference,'system');
  }
  return expired.length;
}
function createVipPayment(userId){
  expireVipPayments(userId);
  const active=row("SELECT vip_until AS vipUntil FROM users WHERE id=?",userId);
  if(isVipActive(active))fail(400,'Seu VIP já está ativo.');
  const pending=row("SELECT id,amount_cents AS amountCents,status,reference,pix_key AS pixKey,pix_payload AS pixPayload,created_at AS createdAt,expires_at AS expiresAt,paid_at AS paidAt,transaction_id AS transactionId FROM vip_payments WHERE user_id=? AND status='pending' AND expires_at>? ORDER BY created_at DESC LIMIT 1",userId,now());
  const key=process.env.PIX_RANDOM_KEY||process.env.PIX_KEY||'';
  if(pending){
    if(!pending.pixKey&&key){
      const payload=pixPayload({key,amount:Number(pending.amountCents||500)/100,txid:pending.reference});
      run("UPDATE vip_payments SET pix_key=?,pix_payload=? WHERE id=? AND status='pending'",key,payload,pending.id);
      return row('SELECT id,amount_cents AS amountCents,status,reference,pix_key AS pixKey,pix_payload AS pixPayload,created_at AS createdAt,expires_at AS expiresAt,paid_at AS paidAt,transaction_id AS transactionId FROM vip_payments WHERE id=?',pending.id);
    }
    return pending;
  }
  const amountCents=500, reference='NEXHUB'+randomBytes(6).toString('hex').toUpperCase();
  const payload=pixPayload({key,amount:amountCents/100,txid:reference});
  const pid=id(), expires=now()+30*60000;
  run('INSERT INTO vip_payments(id,user_id,amount_cents,status,reference,pix_key,pix_payload,expires_at) VALUES(?,?,?,?,?,?,?,?)',pid,userId,amountCents,'pending',reference,key,payload,expires);
  return row('SELECT id,amount_cents AS amountCents,status,reference,pix_key AS pixKey,pix_payload AS pixPayload,created_at AS createdAt,expires_at AS expiresAt,paid_at AS paidAt,transaction_id AS transactionId FROM vip_payments WHERE id=?',pid);
}
function paymentView(p){
  if(!p)return null;
  const expiresAt=Number(p.expiresAt||p.expires_at||0);
  const secondsLeft=p.status==='pending'&&expiresAt?Math.max(0,Math.ceil((expiresAt-now())/1000)):0;
  let confirmationSource='';
  try{
    const event=JSON.parse(String(p.rawEvent||p.raw_event||'{}'));
    if(event?.source==='manual_nubank')confirmationSource='manual_nubank';
  }catch{}
  return {
    id:p.id,amountBRL:Number(p.amountCents||p.amount_cents||500)/100,status:p.status,reference:p.reference,
    pixKeyMasked:(p.pixKey||p.pix_key||'').replace(/^(.{4}).*(.{4})$/,'$1…$2'),pixPayload:p.pixPayload||p.pix_payload||'',
    createdAt:p.createdAt||p.created_at,expiresAt,secondsLeft,expired:p.status==='expired'||secondsLeft===0&&p.status==='pending',
    paidAt:p.paidAt||p.paid_at||'',transactionId:p.transactionId||p.transaction_id||'',
    confirmationSource,
    receipt:p.status==='paid'?{title:'Recibo VIP NexHub',plan:'VIP R$5 Pix · 30 dias',reference:p.reference,transactionId:p.transactionId||p.transaction_id||'',paidAt:p.paidAt||p.paid_at||'',amountBRL:Number(p.amountCents||p.amount_cents||500)/100}:null
  };
}
function creatorPaymentSummary(){
  return {
    pending:row("SELECT COUNT(*) AS n FROM vip_payments WHERE status='pending'").n,
    paid:row("SELECT COUNT(*) AS n FROM vip_payments WHERE status='paid'").n,
    expired:row("SELECT COUNT(*) AS n FROM vip_payments WHERE status='expired'").n,
    cancelled:row("SELECT COUNT(*) AS n FROM vip_payments WHERE status='cancelled'").n,
    revenueBRL:Number(row("SELECT COALESCE(SUM(amount_cents),0) AS cents FROM vip_payments WHERE status='paid'").cents||0)/100
  };
}
function pixFallbackSvg(payload){
  const seed=createHash('sha256').update(String(payload||'')).digest();
  const cells=[];
  for(let y=0;y<21;y++)for(let x=0;x<21;x++){
    const finder=(x<7&&y<7)||(x>13&&y<7)||(x<7&&y>13);
    const on=finder?(x===0||x===6||y===0||y===6||(x>=2&&x<=4&&y>=2&&y<=4)):((seed[(x+y*21)%seed.length]>>(x%8))&1);
    if(on)cells.push(`<rect x="${x*10+15}" y="${y*10+15}" width="10" height="10"/>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240" role="img" aria-label="Pix copia e cola"><rect width="240" height="240" rx="18" fill="#fff"/><g fill="#111827">${cells.join('')}</g></svg>`;
}
async function pixQrSvg(payload){
  if(!payload)return '';
  try{
    const mod=await import('qrcode');
    const QRCode=mod.default||mod;
    return await QRCode.toString(payload,{type:'svg',margin:1,width:240,errorCorrectionLevel:'M'});
  }catch{
    // Fallback visual para ambiente sem node_modules instalado; em produção rode npm install para QR escaneável pelo pacote qrcode.
    return pixFallbackSvg(payload);
  }
}
async function paymentViewWithQr(p){
  const v=paymentView(p);
  if(v)v.pixKey=p?.pixKey||p?.pix_key||'';
  if(v?.pixPayload)v.pixQrSvg=await pixQrSvg(v.pixPayload);
  else if(v)v.pixQrSvg='';
  return v;
}
function activateVipFromPayment(payment,transactionId='',rawEvent='',options={}){
  if(!payment || payment.status==='paid')return false;
  const targetUserId=payment.user_id||payment.userId;
  const manual=options.source==='manual_nubank';
  const actorId=options.actorId||'pix-bot';
  db.exec('BEGIN IMMEDIATE');
  try{
    const result=run("UPDATE vip_payments SET status='paid',transaction_id=?,paid_at=datetime('now'),raw_event=? WHERE id=? AND status<>'paid'",clean(transactionId,120),clean(rawEvent,1500),payment.id);
    const changed=Number(result?.changes||0)>0 && row('SELECT status FROM vip_payments WHERE id=?',payment.id)?.status==='paid';
    if(changed){
      const currentVipUntil=row('SELECT vip_until AS vipUntil FROM users WHERE id=?',targetUserId)?.vipUntil||'';
      let until='forever';
      if(currentVipUntil!=='forever'){
        const expiryText=currentVipUntil?(currentVipUntil.includes('T')?currentVipUntil:currentVipUntil.replace(' ','T')+'Z'):'';
        const existingExpiry=expiryText?Date.parse(expiryText):NaN;
        const startsAt=Number.isFinite(existingExpiry)&&existingExpiry>Date.now()?existingExpiry:Date.now();
        until=new Date(startsAt+30*86400000).toISOString();
      }
      run("UPDATE users SET vip_since=COALESCE(vip_since,datetime('now')),vip_until=?,vip_plan='VIP R$5 Pix',vip_note=? WHERE id=?",until,manual?'Pagamento conferido manualmente no Nubank':'Ativado automaticamente por Pix verificado',targetUserId);
      run('INSERT INTO platform_audit(id,admin_id,action,target_id,reason) VALUES(?,?,?,?,?)',id(),actorId,manual?'vip:pix-manual-confirm':'vip:pix-paid',targetUserId,(manual?'Pagamento de R$ 5,00 conferido no Nubank · ':'Pagamento Pix confirmado automaticamente · ')+(payment.reference||''));
    }
    db.exec('COMMIT');
    if(changed){notify(targetUserId,manual?'Pix conferido no Nubank. Seu VIP NexHub foi ativado por 30 dias.':'Pagamento confirmado! Seu VIP NexHub foi ativado por 30 dias.','/app?tab=settings');emitUser(targetUserId,'profile',{});}
    return changed;
  }catch(e){db.exec('ROLLBACK');throw e;}
}

function boostSummary(serverId,userId=''){
  const total=row('SELECT COUNT(*) AS n FROM server_boosts WHERE server_id=?',serverId).n;
  const mine=userId?row('SELECT COUNT(*) AS n FROM server_boosts WHERE server_id=? AND user_id=?',serverId,userId).n:0;
  const used=userId?row('SELECT COUNT(*) AS n FROM server_boosts WHERE user_id=?',userId).n:0;
  const level=total>=10?3:total>=5?2:total>=2?1:0;
  return {total:Number(total||0),mine:Number(mine||0),used:Number(used||0),remaining:Math.max(0,2-Number(used||0)),level,rewards:level>=1?['Banner boostado','Badge servidor impulsionado','Destaque na lista']:[]};
}

function verificationCode(){return String(Math.floor(100000+Math.random()*900000));}
function canRevealDevCodes(){return process.env.NODE_ENV !== 'production' || process.env.REVEAL_DEV_CODES === 'true';}
function maskEmail(email=''){
  const [name,domain]=String(email).split('@');
  if(!name||!domain)return 'e-mail cadastrado';
  return name.slice(0,2)+'***@'+domain;
}
function createEmailVerificationCode(userId,email){
  run("UPDATE email_verification_codes SET used_at=datetime('now') WHERE user_id=? AND used_at IS NULL",userId);
  const code=verificationCode();
  const codeId=id();
  run('INSERT INTO email_verification_codes(id,user_id,email,code,expires_at) VALUES(?,?,?,?,?)',codeId,userId,email,code,now()+20*60000);
  notify(userId,'Código de verificação do e-mail criado. Abra Configurações > Segurança.','/app?tab=settings');
  return {codeId,code,expiresAt:now()+20*60000,email:maskEmail(email)};
}
function createPasswordResetCode(userLogin,userId){
  const code=verificationCode();
  const codeId=id();
  run('INSERT INTO password_reset_codes(id,user_id,user_login,code,expires_at) VALUES(?,?,?,?,?)',codeId,userId||null,userLogin,code,now()+20*60000);
  if(userId)notify(userId,'Foi criado um código de recuperação de senha para sua conta.','/app');
  return {codeId,code,expiresAt:now()+20*60000};
}

function base64urlBuffer(buffer){
  return Buffer.from(buffer).toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
function generateVapidKeyPair(){
  const ecdh=createECDH('prime256v1');
  ecdh.generateKeys();
  return {publicKey:base64urlBuffer(ecdh.getPublicKey(null,'uncompressed')),privateKey:base64urlBuffer(ecdh.getPrivateKey())};
}

function pushRuntimeStatus(userId) {
  const publicKey = clean(process.env.VAPID_PUBLIC_KEY || '', 240);
  const privateKey = clean(process.env.VAPID_PRIVATE_KEY || '', 240);
  const subject = clean(process.env.VAPID_SUBJECT || '', 240);
  const subscriptions = userId ? row('SELECT COUNT(*) AS n FROM push_subscriptions WHERE user_id=?', userId).n : 0;
  const missing = [];
  if(!publicKey)missing.push('VAPID_PUBLIC_KEY');
  if(!privateKey)missing.push('VAPID_PRIVATE_KEY');
  if(!subject)missing.push('VAPID_SUBJECT');
  return {
    subscriptions, publicKey,
    webPushConfigured: Boolean(publicKey && privateKey && subject),
    vapidConfigured: Boolean(publicKey && privateKey && subject),
    missing,
    note: publicKey && privateKey && subject ? 'VAPID configurado. Para envio com app fechado, conecte o disparo web-push ao notify().' : 'Push local funciona com app aberto. Push com app fechado exige VAPID real e envio web-push em produção.'
  };
}
function pushSetupGuide(userId) {
  const status = pushRuntimeStatus(userId);
  const canGenerate = userId ? platformAdmin(userId) : false;
  return {
    ready: status.vapidConfigured, status, canGenerate,
    exampleEnv: ['# Web Push/PWA do NexHub','VAPID_PUBLIC_KEY=COLE_A_CHAVE_PUBLICA','VAPID_PRIVATE_KEY=COLE_A_CHAVE_PRIVADA','VAPID_SUBJECT=mailto:seu-email@exemplo.com'].join('\n'),
    generatorCommand: 'npm run push:keys -- --subject=mailto:seu-email@exemplo.com',
    checklist: [
      'No terminal do Replit/hospedagem, rode: npm run push:keys -- --subject=mailto:seu-email@exemplo.com',
      'Copie VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY e VAPID_SUBJECT para Secrets/.env.',
      'Reinicie o servidor para carregar as chaves.',
      'Abra Configurações > Notificações > Verificar push.',
      'Instale o NexHub como PWA no celular para testar com a tela fechada.'
    ],
    note: canGenerate ? 'Como criador, você também pode gerar chaves pelo botão do app e colar no Secrets do Replit. A chave privada só aparece nessa tela.' : 'Esta versão salva inscrições Push reais quando o navegador fornece PushManager. O envio em background precisa de chaves VAPID no servidor de produção.'
  };
}
function parseVoiceMessageContent(content='') {
  const match = /^\[\[voice:(\/media\/[a-f0-9-]{36}\.(?:mp3|wav|ogg|webm))\]\]$/.exec(content || '');
  return match ? { url: match[1] } : null;
}
function voicePreview(content='') { return parseVoiceMessageContent(content) ? '🎙️ Mensagem de voz' : content; }
function dmMessagesByRows(rows) {
  return rows.map(d => { const voice = parseVoiceMessageContent(d.content); return { ...d, content: voice ? '' : d.content, voice }; });
}
function messagesByRows(rows, forUserId) {
  return rows.map(m => {
    const reactions = all('SELECT emoji,COUNT(*) AS count,MAX(CASE WHEN user_id=? THEN 1 ELSE 0 END) AS mine FROM reactions WHERE message_id=? GROUP BY emoji ORDER BY count DESC', forUserId, m.id);
    let poll = null;
    if (m.poll_question) {
      const options = JSON.parse(m.poll_options);
      const votes = all('SELECT option_index,COUNT(*) AS count FROM poll_votes WHERE message_id=? GROUP BY option_index', m.id);
      const mine = row('SELECT option_index FROM poll_votes WHERE message_id=? AND user_id=?', m.id, forUserId);
      poll = { question: m.poll_question, options: options.map((label, index) => ({ label, count: votes.find(v => v.option_index === index)?.count || 0 })), myVote: mine?.option_index ?? null };
    }
    let asset = null;
    const voice = parseVoiceMessageContent(m.content || '');
    const assetMatch = /^\[\[asset:([a-f0-9-]{36})\]\]$/.exec(m.content || '');
    if (assetMatch) asset = row('SELECT id,type,name,url FROM server_assets WHERE id=?', assetMatch[1]) || null;
    const mentionNames = (asset || voice) ? [] : [...new Set([...(m.content||'').matchAll(/@([a-z0-9_]{3,24})/gi)].map(x=>x[1].toLowerCase()))];
    const meUsername = row('SELECT username FROM users WHERE id=?', forUserId)?.username?.toLowerCase();
    return { id: m.id, channelId: m.channel_id, userId: m.user_id, author: m.display_name, color: m.color, avatarUrl:m.avatar_url, vipActive:isVipActive(m), vipPlan:m.vip_plan||'',
      content: (asset || voice) ? '' : m.content, asset, voice, replyTo: m.reply_to, pinned: Boolean(m.pinned), createdAt: m.created_at,
      editedAt: m.updated_at, mentionedMe: !!(meUsername && mentionNames.includes(meUsername)), mentions: mentionNames,
      reactions: reactions.map(x => ({ emoji: x.emoji, count: x.count, mine: Boolean(x.mine) })), poll };
  });
}
const msgSelect = `SELECT m.*,u.display_name,u.color,u.avatar_url,u.vip_until,u.vip_plan FROM messages m JOIN users u ON u.id=m.user_id`;
function getMessage(messageId, userId) { const message = row(`${msgSelect} WHERE m.id=?`, messageId); must(message, 404, 'Mensagem não encontrada.'); const channel = channelMember(message.channel_id, userId); return { message, channel }; }
function twoFriends(a, b) {
  return row(`SELECT id FROM friends WHERE state='accepted' AND ((from_id=? AND to_id=?) OR (from_id=? AND to_id=?))`, a, b, b, a);
}
function activeCall(userId) { for (const c of calls.values()) if (c.from===userId || c.to===userId) return c; return null; }
function endCall(c,action='ended',actor=null) {
  if(!c || !calls.has(c.id)) return;
  calls.delete(c.id);
  clearTimeout(c.timeout);
  emitUser(c.from,'call',{action,callId:c.id,by:actor});
  emitUser(c.to,'call',{action,callId:c.id,by:actor});
}
function callView(c,userId) {return {id:c.id,from:c.from,to:c.to,mode:c.mode,status:c.status,peer:userPublic(userId===c.from?c.to:c.from)};}
function getDmUsers(userId) {
  return all(`SELECT u.id,u.username,u.display_name AS displayName,u.color,u.status,u.avatar_url AS avatarUrl,
    (SELECT MAX(created_at) FROM dms WHERE (from_id=? AND to_id=u.id) OR (from_id=u.id AND to_id=?)) AS lastAt,
    (SELECT content FROM dms WHERE (from_id=? AND to_id=u.id) OR (from_id=u.id AND to_id=?) ORDER BY created_at DESC, id DESC LIMIT 1) AS lastPreview,
    (SELECT from_id FROM dms WHERE (from_id=? AND to_id=u.id) OR (from_id=u.id AND to_id=?) ORDER BY created_at DESC, id DESC LIMIT 1) AS lastFromId,
    (SELECT COUNT(*) FROM dms d LEFT JOIN dm_reads r ON r.user_id=? AND r.peer_id=u.id
      WHERE d.from_id=u.id AND d.to_id=? AND d.created_at>COALESCE(r.last_read_at,'1970-01-01 00:00:00')) AS unreadCount
    FROM users u WHERE u.id != ? AND (
      EXISTS (SELECT 1 FROM dms WHERE (from_id=? AND to_id=u.id) OR (from_id=u.id AND to_id=?))
      OR EXISTS (SELECT 1 FROM friends f WHERE f.state='accepted' AND ((f.from_id=? AND f.to_id=u.id) OR (f.to_id=? AND f.from_id=u.id)))
    ) ORDER BY lastAt DESC, displayName COLLATE NOCASE`, userId, userId, userId, userId, userId, userId, userId, userId, userId, userId, userId, userId, userId).map(u=>({...u,lastPreview:voicePreview(u.lastPreview||''),unreadCount:Number(u.unreadCount||0)}));
}
function sse(req, res, user) {
  res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no' });
  res.write(`retry: 3000\nevent: ready\ndata: ${JSON.stringify({ userId: user.id })}\n\n`);
  const before = streams.get(user.id)?.size || 0;
  if (!streams.has(user.id)) streams.set(user.id, new Set());
  streams.get(user.id).add(res);
  if (!before && user.status !== 'invisible') for (const s of all('SELECT server_id FROM memberships WHERE user_id=?', user.id)) emitServer(s.server_id, 'presence', { userId: user.id, online: true });
  const heartbeat = setInterval(() => { try { res.write(': ping\n\n'); } catch {} }, 20000);
  req.on('close', () => {
    clearInterval(heartbeat);
    const group = streams.get(user.id); if (!group) return;
    group.delete(res);
    if (!group.size) {
      streams.delete(user.id);
      if (user.status !== 'invisible') for (const s of all('SELECT server_id FROM memberships WHERE user_id=?', user.id)) emitServer(s.server_id, 'presence', { userId: user.id, online: false });
    }
  });
}
function serverList(userId) {
  return all(`SELECT s.id,s.name,s.description,s.owner_id AS ownerId,s.icon_url AS iconUrl,m.role,
    (SELECT COUNT(*) FROM memberships x WHERE x.server_id=s.id) AS memberCount,
    (SELECT COUNT(*) FROM messages msg JOIN channels ch ON ch.id=msg.channel_id
      LEFT JOIN channel_reads cr ON cr.channel_id=ch.id AND cr.user_id=?
      WHERE ch.server_id=s.id AND ch.type='text' AND msg.user_id!=? AND msg.created_at>COALESCE(cr.last_read_at,'1970-01-01 00:00:00')) AS unreadCount
    FROM servers s JOIN memberships m ON m.server_id=s.id WHERE m.user_id=? ORDER BY m.joined_at DESC`, userId,userId,userId).map(s=>({...s,unreadCount:Number(s.unreadCount||0)}));
}
function detail(serverId, userId) {
  const mem = member(serverId, userId);
  const server = row('SELECT id,name,description,owner_id AS ownerId,icon_url AS iconUrl,automod_enabled AS automodEnabled,block_links AS blockLinks,blocked_words AS blockedWords,welcome_enabled AS welcomeEnabled,text_locked AS textLocked,voice_locked AS voiceLocked FROM servers WHERE id=?', serverId);
  const channels = all(`SELECT c.id,c.name,c.topic,c.slowmode AS slowMode,c.type,c.locked,
    (SELECT COUNT(*) FROM messages msg LEFT JOIN channel_reads cr ON cr.channel_id=c.id AND cr.user_id=?
      WHERE msg.channel_id=c.id AND msg.user_id!=? AND msg.created_at>COALESCE(cr.last_read_at,'1970-01-01 00:00:00')) AS unreadCount
    FROM channels c WHERE c.server_id=? ORDER BY c.created_at,c.id`, userId,userId,serverId).map(c=>({...c,unreadCount:Number(c.unreadCount||0)}));
  const members = all(`SELECT u.id,u.username,u.display_name AS displayName,u.color,u.status,u.avatar_url AS avatarUrl,m.role,m.custom_role_id AS customRoleId
    FROM memberships m JOIN users u ON m.user_id=u.id WHERE m.server_id=? ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'moderator' THEN 1 ELSE 2 END,u.display_name COLLATE NOCASE`, serverId);
  return { ...server, role: mem.role, customRoleId:mem.customRoleId, permissions:permissions(serverId,userId), channels, members: members.map(v => ({ ...v, online: streams.has(v.id) && v.status !== 'invisible' })) , roles: all('SELECT id,name,color,permissions FROM custom_roles WHERE server_id=? ORDER BY created_at,id',serverId).map(r=>({...r,permissions:JSON.parse(r.permissions)})) };
}
function legalTerms(){return `Termos de Uso do NexHub

1. Use o NexHub com respeito.
2. Não envie spam, golpes, ameaças, ódio, conteúdo ilegal ou assédio.
3. Donos de servidores podem moderar seus espaços, mas a equipe da plataforma pode suspender contas em casos graves.
4. Contas podem ser removidas quando violarem regras, segurança ou direitos de outras pessoas.
5. O NexHub ainda está em desenvolvimento; mantenha backup dos dados importantes.
6. Chamadas, uploads e notificações dependem do navegador, HTTPS e configuração do servidor.
`;}
function privacyPolicy(){return `Política de Privacidade do NexHub

Coletamos apenas os dados necessários para o app funcionar: usuário, e-mail, senha protegida por hash, perfil, mensagens, servidores, mídia enviada, logs de moderação e dados técnicos básicos.

Senhas não são salvas em texto puro. Administradores podem acessar denúncias, contas e logs para segurança. Usuários podem exportar os próprios dados nas configurações.

Para produção real, configure HTTPS, backup, SMTP, política pública e retenção de dados conforme a lei aplicável.
`;}
function communityRules(){return `Regras da Comunidade NexHub

• Respeite os outros usuários.
• Não faça spam/flood.
• Não tente invadir contas ou burlar banimentos.
• Não compartilhe conteúdo ilegal ou perigoso.
• Denuncie problemas para a moderação.
• Use servidores e canais de acordo com as regras locais.
`;}
async function api(req, res, url) {
  verifyOrigin(req);
  const route = url.pathname;
  const method = req.method;
  let match;
  if (route === '/api/health' && method === 'GET') return json(res, 200, { ok: true, app: 'NexHub' });
  if (route === '/api/legal' && method === 'GET') return json(res, 200, { terms: legalTerms(), privacy: privacyPolicy(), rules: communityRules() });
  const ip = process.env.TRUST_PROXY === 'true' ? String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress : req.socket.remoteAddress;
  if (route === '/api/register' && method === 'POST') {
    const b = await parse(req);
    const username = clean(b.username, 200).toLowerCase().replace(/^@+/, '');
    const email = clean(b.email, 200).toLowerCase();
    must(username.length > 0, 400, 'Digite um nome de usuário.');
    must(typeof b.password === 'string' && b.password.length > 0, 400, 'Digite uma senha.');
    if(email)must(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email), 400, 'E-mail inválido.');
    const uid = id();
    const storedEmail = email || `${uid}@accounts.nexhub.invalid`;
    must(!row('SELECT id FROM users WHERE username=? OR email=?', username, storedEmail), 409, email?'Usuário ou e-mail já cadastrado.':'Este nome de usuário já está cadastrado.');
    const password = await hashPassword(b.password);
    try { run('INSERT INTO users (id,username,email,password_hash,display_name) VALUES(?,?,?,?,?)', uid, username, storedEmail, password, username); }
    catch { fail(409, email?'Usuário ou e-mail já cadastrado.':'Este nome de usuário já está cadastrado.'); }
    const emailCode=email?createEmailVerificationCode(uid,email):null;
    setSession(res, req, uid);
    logSecurity(uid,'account_created','registro inicial',ip);
    return json(res, 201, { user: safeUser(uid), ...(emailCode?{emailVerification:canRevealDevCodes()?emailCode:{email:emailCode.email,expiresAt:emailCode.expiresAt}}:{}) });
  }
  if (route === '/api/login' && method === 'POST') {
    throttle('login:' + ip, 30, 900000);
    const b = await parse(req);
    const username = cleanLogin(b.login);
    must(username.length > 0, 400, 'Digite seu usuário ou e-mail.');
    const u = row('SELECT id,password_hash,twofa_enabled AS twofaEnabled,twofa_secret AS twofaSecret FROM users WHERE username=? OR email=? OR lower(display_name)=?', username, username, username);
    // Mesmo esforço computacional para usuários inexistentes.
    const dummy = '00000000000000000000000000000000:' + '00'.repeat(64);
    const rawPassword = String(b.password || '');
    let valid = await passwordMatches(rawPassword, u?.password_hash || dummy);
    // Ajuda em celular: aceita quando o teclado coloca espaço sem querer no começo/fim.
    if (!valid && rawPassword.trim() !== rawPassword) valid = await passwordMatches(rawPassword.trim(), u?.password_hash || dummy);
    if (!u) { logSecurity('', 'login_unknown', username, ip); fail(401, 'Conta não encontrada neste servidor. Se você trocou de Replit ou apagou a pasta data/, crie a conta de novo ou restaure o backup.'); }
    if(!valid){ logSecurity(u.id, 'login_failed', 'senha incorreta', ip); fail(401, 'Senha incorreta. Confira se não ficou espaço no começo/fim ou use Recuperar conta.'); }
    const block=accountBlockForUser(u.id); must(!block.blocked,403,block.type==='suspension'?`Sua conta está suspensa até ${block.until}. Motivo: ${block.reason}`:'Esta conta está banida. Use “Recorrer banimento” para pedir análise.');
    if(u.twofaEnabled) {
      const token=String(b.twoFactorCode||'').trim();
      must(token,401,'Código 2FA necessário.');
      must(verifyTotp(u.twofaSecret,token)||consumeRecoveryCode(u.id,token),401,'Código 2FA inválido.');
    }
    setSession(res, req, u.id);
    run("UPDATE users SET last_login_at=datetime('now'),security_score=? WHERE id=?",securityScoreForUser(u.id),u.id);
    logSecurity(u.id,'login_success',clean(req.headers['user-agent']||'',180),ip);
    return json(res, 200, { user: safeUser(u.id) });
  }
  if (route === '/api/appeals' && method === 'POST') {
    throttle('appeal:' + ip, 5, 86400000);
    const b=await parse(req);const login=clean(b.login,200).toLowerCase();const reason=clean(b.reason,1000);
    must(login.length>=3 && reason.length>=20,400,'Informe usuário/e-mail e explique o recurso com pelo menos 20 caracteres.');
    const target=row('SELECT id FROM users WHERE username=? OR email=?',login,login);
    const appealId=id();run('INSERT INTO ban_appeals(id,user_login,user_id,reason) VALUES(?,?,?,?)',appealId,login,target?.id||null,reason);
    return json(res,201,{ok:true,appealId});
  }
  if (route === '/api/account/recovery' && method === 'POST') {
    throttle('recovery:' + ip, 5, 86400000);
    const b=await parse(req);const login=clean(b.login,200).toLowerCase();const reason=clean(b.reason,1000);
    must(login.length>=3 && reason.length>=20,400,'Informe usuário/e-mail e explique a recuperação com pelo menos 20 caracteres.');
    const target=row('SELECT id FROM users WHERE username=? OR email=?',login,login);
    const rid=id();run('INSERT INTO account_recovery_requests(id,user_login,user_id,reason) VALUES(?,?,?,?)',rid,login,target?.id||null,reason);
    return json(res,201,{ok:true,requestId:rid});
  }
  if (route === '/api/account/password-reset/request' && method === 'POST') {
    throttle('password-reset:' + ip, 5, 3600000);
    const b=await parse(req);const login=cleanLogin(b.login);
    must(login.length>=3,400,'Digite usuário ou e-mail.');
    const target=row('SELECT id,email FROM users WHERE username=? OR email=?',login,login);
    let payload={ok:true,note:'Se a conta existir, um código será gerado. Em produção, configure SMTP para enviar por e-mail.'};
    if(target){const reset=createPasswordResetCode(login,target.id);payload={...payload,resetId:reset.codeId,email:maskEmail(target.email),expiresAt:reset.expiresAt};if(canRevealDevCodes())payload.devCode=reset.code;}
    return json(res,200,payload);
  }
  if (route === '/api/account/password-reset/confirm' && method === 'POST') {
    throttle('password-reset-confirm:' + ip, 12, 3600000);
    const b=await parse(req);const login=cleanLogin(b.login);const code=String(b.code||'').trim();
    must(login.length>=3 && /^\d{6}$/.test(code),400,'Informe usuário/e-mail e código de 6 dígitos.');
    must(typeof b.newPassword==='string'&&b.newPassword.length>=6&&b.newPassword.length<=128,400,'Nova senha precisa ter de 6 a 128 caracteres.');
    const target=row('SELECT id FROM users WHERE username=? OR email=?',login,login);
    must(target,404,'Conta não encontrada.');
    const rec=row('SELECT id FROM password_reset_codes WHERE user_id=? AND code=? AND used_at IS NULL AND expires_at>? ORDER BY created_at DESC LIMIT 1',target.id,code,now());
    must(rec,400,'Código inválido ou expirado.');
    run('UPDATE users SET password_hash=? WHERE id=?',await hashPassword(b.newPassword),target.id);
    run("UPDATE password_reset_codes SET used_at=datetime('now') WHERE id=?",rec.id);
    run('DELETE FROM sessions WHERE user_id=?',target.id);
    notify(target.id,'Sua senha foi redefinida. Entre novamente com a nova senha.','/app');
    return json(res,200,{ok:true});
  }
  if (route === '/api/payments/pix/webhook' && method === 'POST') {
    throttle('pix-webhook:' + ip, 60, 60000);
    const secret=process.env.PIX_WEBHOOK_SECRET||'';
    if(!secret || !secureEquals(req.headers['x-nexhub-pix-secret'],secret)){
      logSecurity('', 'pix_webhook_blocked', 'segredo inválido', ip);
      fail(403,'Webhook Pix não autorizado.');
    }
    const b=await parse(req);
    const event=normalizePixWebhook(b);
    must(event.reference||event.paymentId,400,'Webhook sem referência de pagamento.');
    must(Number(event.amountCents)===500,400,'Valor Pix divergente ou ausente.');
    const payment=event.paymentId?row('SELECT id,user_id,status,reference,amount_cents AS amountCents FROM vip_payments WHERE id=?',event.paymentId):row('SELECT id,user_id,status,reference,amount_cents AS amountCents FROM vip_payments WHERE reference=?',event.reference);
    must(payment,404,'Pagamento não encontrado.');
    must(Number(event.amountCents)===Number(payment.amountCents||500),400,'Valor divergente.');
    logSecurity(payment.user_id||payment.userId,'pix_webhook_received',`${event.status||'sem-status'} · ${payment.reference}`,ip);
    if(['paid','approved','confirmed'].includes(event.status)) {
      const ok=activateVipFromPayment(payment,event.transactionId,JSON.stringify(b));
      logSecurity(payment.user_id||payment.userId, ok?'vip_payment_activated':'vip_payment_duplicate', payment.reference, ip);
      return json(res,200,{ok:true,activated:ok,paymentId:payment.id,reference:payment.reference,status:'paid'});
    }
    if(['cancelled','canceled','expired'].includes(event.status)){
      const status=event.status==='expired'?'expired':'cancelled';
      run("UPDATE vip_payments SET status=?,raw_event=? WHERE id=? AND status='pending'",status,clean(JSON.stringify(b),1500),payment.id);
      logSecurity(payment.user_id||payment.userId,'vip_payment_'+status,payment.reference,ip);
    }
    return json(res,200,{ok:true,activated:false,paymentId:payment.id,reference:payment.reference,status:event.status||'ignored'});
  }
  const user = currentUser(req);
  must(user, 401, 'Faça login para continuar.');
  if (route === '/api/events' && method === 'GET') return sse(req, res, user);
  if (route === '/api/me' && method === 'GET') return json(res, 200, { user: {...user,isPlatformAdmin:platformAdmin(user.id)} });
  if (route === '/api/vip' && method === 'GET') {
    expireVipPayments(user.id);
    const last=await Promise.all(all('SELECT id,amount_cents AS amountCents,status,reference,pix_key AS pixKey,pix_payload AS pixPayload,created_at AS createdAt,expires_at AS expiresAt,paid_at AS paidAt,transaction_id AS transactionId FROM vip_payments WHERE user_id=? ORDER BY created_at DESC LIMIT 8',user.id).map(paymentViewWithQr));
    return json(res,200,{vip:vipViewForUser(user),payments:last,pix:pixConfig(),webhook:pixWebhookSetup(req),history:last.map(p=>({id:p.id,status:p.status,reference:p.reference,amountBRL:p.amountBRL,createdAt:p.createdAt,paidAt:p.paidAt,secondsLeft:p.secondsLeft})),note:'NexHub VIP custa R$ 5,00 por 30 dias. O painel admin não faz parte do VIP. O VIP é ativado por webhook Pix verificado ou após conferência manual do crédito pelo criador.'});
  }
  if (route === '/api/vip/catalog' && method === 'GET') {
    return json(res,200,{priceBRL:vipPriceBRL,durationDays:30,plans:[{id:'vip-r5',name:'NexHub VIP',priceBRL:5,durationDays:30,benefits:vipBenefits,exclusive:['Nome com estilo livre seguro','Perfil com vídeo/animação','2 boosts de servidor','2 bots por servidor','Bot com foto/banner/nome personalizado','Destaque visual nas mensagens']}],rules:{adminIncluded:false,payToWin:false,activation:'Pix confirmado por webhook seguro'}});
  }
  if (route === '/api/payments/pix/checkout' && method === 'GET') {
    const payment=createVipPayment(user.id);
    return json(res,200,{checkout:{title:'NexHub VIP',amountBRL:5,durationDays:30,expiresAt:payment.expiresAt,reference:payment.reference,steps:['Copie o Pix ou escaneie o QR Code.','Pague exatamente R$ 5,00.','O criador confirma após conferir o crédito no Nubank; um provedor compatível também pode confirmar por webhook.','O VIP libera por 30 dias após a confirmação.'],antiFraud:'Comprovante/print enviado por usuário não ativa VIP.'},payment:await paymentViewWithQr(payment)});
  }
  if (route === '/api/payments/pix/setup' && method === 'GET') {
    return json(res,200,pixWebhookSetup(req));
  }
  if (route === '/api/vip/payments' && method === 'POST') {
    throttle('vip-payment:'+user.id,8,3600000);
    const payment=createVipPayment(user.id);
    logSecurity(user.id,'vip_payment_created',payment.reference,ip);
    return json(res,201,{payment:await paymentViewWithQr(payment),pix:pixConfig(),warning:payment.pixPayload?'Use o Pix copia-e-cola/QR Code gerado pelo NexHub.':'Configure PIX_RANDOM_KEY no .env para gerar o Pix copia-e-cola e QR Code.'});
  }
  if ((match=route.match(/^\/api\/vip\/payments\/([^/]+)$/)) && method === 'GET') {
    expireVipPayments(user.id);
    const p=row('SELECT id,amount_cents AS amountCents,status,reference,pix_key AS pixKey,pix_payload AS pixPayload,created_at AS createdAt,expires_at AS expiresAt,paid_at AS paidAt,transaction_id AS transactionId FROM vip_payments WHERE id=? AND user_id=?',match[1],user.id);
    must(p,404,'Pagamento não encontrado.');
    return json(res,200,{payment:await paymentViewWithQr(p),vip:vipViewForUser(safeUser(user.id))});
  }
  if (route === '/api/security/status' && method === 'GET') {
    const sessions=all('SELECT created_at AS createdAt,expires_at AS expiresAt,ip,user_agent AS userAgent FROM sessions WHERE user_id=? AND expires_at>? ORDER BY created_at DESC LIMIT 8',user.id,now());
    const events=all('SELECT kind,detail,ip,created_at AS createdAt FROM security_events WHERE user_id=? ORDER BY created_at DESC LIMIT 12',user.id);
    const score=securityScoreForUser(user.id);
    run('UPDATE users SET security_score=? WHERE id=?',score,user.id);
    return json(res,200,{ok:true,score,sessions,events,serverSideVip:true,apkHackCannotUnlockVip:true,adminIncludedInVip:false,pixWebhookConfigured:Boolean(process.env.PIX_WEBHOOK_SECRET),pixWebhookReady:!!(process.env.PIX_RANDOM_KEY&&process.env.PIX_WEBHOOK_SECRET),pixWebhookPath:'/api/payments/pix/webhook',pixRequiresSecretHeader:'x-nexhub-pix-secret',twoFactorAvailable:true,csrfOriginCheck:true,rateLimit:true,uploadProtection:true,notes:['VIP é liberado apenas no servidor, por pagamento Pix verificado ou pelo criador.','Webhook Pix exige segredo, referência única e valor exato de R$ 5,00.','APK modificado pode mudar visual local, mas não altera banco, pagamentos, boosts ou permissões do servidor.','Sessões, uploads e eventos suspeitos ficam registrados para auditoria.']});
  }
  if (route === '/api/security/app-check' && method === 'GET') {
    return json(res,200,{ok:true,app:'NexHub',version:'34.0.0',serverValidated:true,vipServerOnly:true,buildTamperResistant:true,checks:['cookie HttpOnly','origem validada','rate limit','VIP server-side','Pix webhook com segredo','uploads por assinatura']});
  }
  if (route === '/api/me/email-verification/status' && method === 'GET') {
    const fresh=row('SELECT email,email_verified AS emailVerified FROM users WHERE id=?',user.id);
    return json(res,200,{email:fresh.email,emailVerified:!!fresh.emailVerified});
  }
  if (route === '/api/me/email-verification/request' && method === 'POST') {
    throttle('email-verify:'+user.id,6,3600000);
    const fresh=row('SELECT email,email_verified AS emailVerified FROM users WHERE id=?',user.id);
    if(fresh.emailVerified)return json(res,200,{ok:true,emailVerified:true,email:maskEmail(fresh.email)});
    const code=createEmailVerificationCode(user.id,fresh.email);
    return json(res,201,{ok:true,email:code.email,expiresAt:code.expiresAt,...(canRevealDevCodes()?{devCode:code.code}:{})});
  }
  if (route === '/api/me/email-verification/confirm' && method === 'POST') {
    throttle('email-verify-confirm:'+user.id,12,3600000);
    const b=await parse(req);const code=String(b.code||'').trim();
    must(/^\d{6}$/.test(code),400,'Digite o código de 6 dígitos.');
    const rec=row('SELECT id,email FROM email_verification_codes WHERE user_id=? AND code=? AND used_at IS NULL AND expires_at>? ORDER BY created_at DESC LIMIT 1',user.id,code,now());
    must(rec,400,'Código inválido ou expirado.');
    run("UPDATE email_verification_codes SET used_at=datetime('now') WHERE id=?",rec.id);
    run('UPDATE users SET email_verified=1 WHERE id=?',user.id);
    notify(user.id,'E-mail verificado com sucesso.','/app?tab=settings');
    return json(res,200,{ok:true,user:safeUser(user.id)});
  }
  if (route === '/api/me/export' && method === 'GET') {
    throttle('export:'+user.id,6,3600000);
    return json(res,200,accountExport(user.id));
  }
  if (route === '/api/me/security' && method === 'GET') {
    const s=row('SELECT twofa_enabled AS twofaEnabled,recovery_codes AS codes FROM users WHERE id=?',user.id);
    return json(res,200,{twofaEnabled:!!s.twofaEnabled,recoveryCodeCount:JSON.parse(s.codes||'[]').length});
  }
  if (route === '/api/me/2fa/setup' && method === 'POST') {
    throttle('2fa:'+user.id,10,3600000);const b=await parse(req);
    const stored=row('SELECT password_hash FROM users WHERE id=?',user.id);
    must(await passwordMatches(String(b.password||''),stored.password_hash),403,'Senha incorreta.');
    const secret=base32(randomBytes(20));const codes=recoveryCodes();
    run('UPDATE users SET twofa_secret=?,recovery_codes=?,twofa_enabled=0 WHERE id=?',secret,JSON.stringify(codes),user.id);
    const label=encodeURIComponent('NexHub:'+user.username);
    const issuer=encodeURIComponent('NexHub');
    return json(res,200,{secret,otpauth:`otpauth://totp/${label}?secret=${secret}&issuer=${issuer}&digits=6&period=30`,recoveryCodes:codes});
  }
  if (route === '/api/me/2fa/enable' && method === 'POST') {
    const b=await parse(req);const s=row('SELECT twofa_secret AS secret FROM users WHERE id=?',user.id);
    must(s?.secret,400,'Faça a configuração do 2FA primeiro.');
    must(verifyTotp(s.secret,b.token),400,'Código inválido.');
    run('UPDATE users SET twofa_enabled=1 WHERE id=?',user.id);
    return json(res,200,{ok:true,user:safeUser(user.id)});
  }
  if (route === '/api/me/2fa' && method === 'DELETE') {
    const b=await parse(req);const s=row('SELECT password_hash,twofa_secret AS secret,twofa_enabled AS enabled FROM users WHERE id=?',user.id);
    must(s?.enabled,400,'2FA não está ativo.');
    must(await passwordMatches(String(b.password||''),s.password_hash),403,'Senha incorreta.');
    must(verifyTotp(s.secret,b.token)||consumeRecoveryCode(user.id,b.token),403,'Código 2FA inválido.');
    run("UPDATE users SET twofa_enabled=0,twofa_secret='',recovery_codes='[]' WHERE id=?",user.id);
    return json(res,200,{ok:true,user:safeUser(user.id)});
  }
  if (route === '/api/push-subscriptions' && method === 'POST') {
    const b=await parse(req);const endpoint=clean(b.endpoint,600);
    must(/^https:\/\//.test(endpoint)||endpoint.startsWith('local-notifications-')||process.env.NODE_ENV==='test',400,'Endpoint push inválido.');
    const keys=b.keys&&typeof b.keys==='object'?b.keys:{};
    run("INSERT INTO push_subscriptions(id,user_id,endpoint,p256dh,auth,user_agent) VALUES(?,?,?,?,?,?) ON CONFLICT(endpoint) DO UPDATE SET user_id=excluded.user_id,p256dh=excluded.p256dh,auth=excluded.auth,user_agent=excluded.user_agent,updated_at=datetime('now')",id(),user.id,endpoint,clean(keys.p256dh,200),clean(keys.auth,200),clean(req.headers['user-agent']||'',220));
    return json(res,201,{ok:true});
  }
  if (route === '/api/push-status' && method === 'GET') return json(res,200,pushRuntimeStatus(user.id));
  if (route === '/api/push-setup' && method === 'GET') return json(res,200,pushSetupGuide(user.id));
  if (route === '/api/push-vapid-generate' && method === 'POST') {
    must(platformAdmin(user.id),403,'Acesso exclusivo do criador do app.');
    throttle('vapid-generate:'+user.id,5,10*60000);
    const b=await parse(req);
    const subject=clean(b.subject||process.env.VAPID_SUBJECT||'mailto:admin@nexhub.local',240);
    must(/^mailto:[^\s@]+@[^\s@]+\.[^\s@]+$|^https:\/\//i.test(subject),400,'Use VAPID_SUBJECT como mailto:email@dominio.com ou https://seu-site.');
    const pair=generateVapidKeyPair();
    return json(res,200,{...pair,subject,env:['VAPID_PUBLIC_KEY='+pair.publicKey,'VAPID_PRIVATE_KEY='+pair.privateKey,'VAPID_SUBJECT='+subject].join('\n'),warning:'Copie estas variáveis para o Secrets/.env e reinicie o servidor. Não compartilhe a chave privada.'});
  }
  if (route === '/api/calls/ice-config' && method === 'GET') return json(res, 200, await resolveIceConfiguration(user.id));
  if (route === '/api/calls/turn-status' && method === 'GET') {
    const config = await resolveIceConfiguration(user.id);
    return json(res, 200, config.turnStatus);
  }
  if (route === '/api/calls/turn-setup' && method === 'GET') return json(res, 200, turnSetupGuide());
  if ((match=route.match(/^\/api\/users\/([^/]+)$/)) && method === 'GET') {
    const target = userPublic(match[1]); must(target,404,'Perfil não encontrado.');
    return json(res,200,{user:target});
  }
  if (route === '/api/logout' && method === 'POST') {
    const token = cookieToken(req);
    if (token) run('DELETE FROM sessions WHERE token_hash=?', createHash('sha256').update(token).digest('hex'));
    res.setHeader('Set-Cookie', 'nexo_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
    return json(res, 200, { ok: true });
  }
  if(route==='/api/me/password'&&method==='POST') {
    throttle('password:'+user.id,8,3600000);const b=await parse(req);
    const stored=row('SELECT password_hash FROM users WHERE id=?',user.id);
    must(await passwordMatches(String(b.currentPassword||''),stored.password_hash),403,'Senha atual incorreta.');
    must(typeof b.newPassword==='string'&&b.newPassword.length>=6&&b.newPassword.length<=128,400,'Nova senha precisa ter de 6 a 128 caracteres.');
    run('UPDATE users SET password_hash=? WHERE id=?',await hashPassword(b.newPassword),user.id);
    const token=cookieToken(req),hash=createHash('sha256').update(token).digest('hex');
    run('DELETE FROM sessions WHERE user_id=? AND token_hash!=?',user.id,hash);
    return json(res,200,{ok:true});
  }
  if(route==='/api/me/account'&&method==='DELETE') {
    throttle('delete:'+user.id,5,3600000);const b=await parse(req);
    must(b.confirm==='EXCLUIR',400,'Digite EXCLUIR para confirmar.');
    const stored=row('SELECT password_hash,avatar_url,banner_url FROM users WHERE id=?',user.id);
    must(await passwordMatches(String(b.password||''),stored.password_hash),403,'Senha incorreta.');
    // Exclusão completa de conta, das mensagens e dos servidores que ela possui.
    const icons=all('SELECT icon_url FROM servers WHERE owner_id=?',user.id).map(x=>x.icon_url);
    db.exec('BEGIN IMMEDIATE');
    try{
      run('DELETE FROM servers WHERE owner_id=?',user.id);
      run('DELETE FROM reports WHERE reporter_id=? OR target_user_id=?',user.id,user.id);
      run('DELETE FROM invites WHERE creator_id=?',user.id);
      run('DELETE FROM messages WHERE user_id=?',user.id);
      run('DELETE FROM bans WHERE user_id=?',user.id);
      run('DELETE FROM memberships WHERE user_id=?',user.id);
      run('DELETE FROM users WHERE id=?',user.id);
      run("UPDATE audit SET actor_id='excluido' WHERE actor_id=?",user.id);
      run("UPDATE audit SET target_id='excluido' WHERE target_id=?",user.id);
      run("UPDATE platform_audit SET admin_id='excluido' WHERE admin_id=?",user.id);
      db.exec('COMMIT');
    } catch(e) {db.exec('ROLLBACK');throw e;}
    for(const url of [stored.avatar_url,stored.banner_url,...icons])removeMedia(url);
    const call=activeCall(user.id);if(call)endCall(call,'ended',user.id);
    emitUser(user.id,'account_banned',{});
    const group=streams.get(user.id);if(group)for(const response of group)response.end();streams.delete(user.id);
    res.setHeader('Set-Cookie','nexo_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
    return json(res,200,{ok:true});
  }
  if((match=route.match(/^\/api\/users\/([^/]+)\/block$/))&&['POST','DELETE','GET'].includes(method)) {
    const target=match[1];must(target!==user.id,400,'Não é possível bloquear a própria conta.');
    must(row('SELECT id FROM users WHERE id=?',target),404,'Usuário inexistente.');
    if(method==='GET')return json(res,200,{blocked:!!row('SELECT blocker_id FROM user_blocks WHERE blocker_id=? AND blocked_id=?',user.id,target)});
    if(method==='POST')run('INSERT OR IGNORE INTO user_blocks(blocker_id,blocked_id) VALUES(?,?)',user.id,target);
    if(method==='DELETE')run('DELETE FROM user_blocks WHERE blocker_id=? AND blocked_id=?',user.id,target);
    return json(res,200,{ok:true});
  }
  if (['/api/me/media/avatar','/api/me/media/banner'].includes(route) && ['PUT','DELETE'].includes(method)) {
    const kind=route.endsWith('avatar')?'avatar':'banner';
    throttle('media:'+user.id,12,3600000);
    const column=kind==='avatar'?'avatar_url':'banner_url';
    if (method==='DELETE') {
      run(`UPDATE users SET ${column}=''${kind==='banner' ? ",banner_type=''" : ''} WHERE id=?`,user.id);
      removeMedia(user[kind==='avatar'?'avatarUrl':'bannerUrl']);
    } else {
      must(req.headers['content-type']==='application/octet-stream',415,'Envie o arquivo como application/octet-stream.');
      const upload=await readUpload(req,kind);auditUpload(user.id,kind,upload,ip);
      try { run(`UPDATE users SET ${column}=?${kind==='banner' ? ',banner_type=?' : ''} WHERE id=?`,...(kind==='banner'?[upload.url,upload.ext==='mp4'?'video':'image',user.id]:[upload.url,user.id])); }
      catch (e){removeMedia(upload.url);throw e;}
      removeMedia(user[kind==='avatar'?'avatarUrl':'bannerUrl']);
    }
    emitUser(user.id,'profile',{});
    for(const s of all('SELECT server_id FROM memberships WHERE user_id=?',user.id)) emitServer(s.server_id,'members',{serverId:s.server_id});
    return json(res,200,{user:safeUser(user.id)});
  }
  if (route === '/api/me' && method === 'PATCH') {
    const b = await parse(req);
    const name = b.displayName === undefined ? user.displayName : clean(b.displayName, 40);
    must(name.length >= 2, 400, 'Nome muito curto.');
    const bio = b.bio === undefined ? user.bio : clean(b.bio, 180);
    const status = ['online', 'away', 'dnd', 'invisible'].includes(b.status) ? b.status : user.status;
    const theme = ['dark', 'light'].includes(b.theme) ? b.theme : user.theme;
    const color = /^#[0-9a-fA-F]{6}$/.test(b.color) ? b.color : user.color;
    const allowDm = typeof b.allowDm === 'boolean' ? Number(b.allowDm) : user.allowDm;
    const profileEffect = b.profileEffect === undefined ? user.profileEffect : safeProfileEffect(String(b.profileEffect));
    let vipNameStyle = user.vipNameStyle || '';
    if (b.vipNameStyle !== undefined) {
      must(isVipActive(user),403,'Só VIP pode modificar o estilo do nome.');
      vipNameStyle = safeVipNameStyle(b.vipNameStyle);
    }
    run('UPDATE users SET display_name=?,bio=?,color=?,status=?,theme=?,allow_dm=?,profile_effect=?,vip_name_style=? WHERE id=?', name, bio, color, status, theme, allowDm, profileEffect, vipNameStyle, user.id);
    emitUser(user.id, 'profile', {});
    for (const s of all('SELECT server_id FROM memberships WHERE user_id=?', user.id)) emitServer(s.server_id, 'members', { serverId: s.server_id });
    return json(res, 200, { user: safeUser(user.id) });
  }
  if (route === '/api/servers' && method === 'GET') return json(res, 200, { servers: serverList(user.id) });
  if (route === '/api/servers' && method === 'POST') {
    throttle('create:' + user.id, 6, 3600000);
    const b = await parse(req); const name = cleanServerName(b.name);
    must(name.length >= 1, 400, 'Digite um nome para o servidor.');
    const sid = id();
    db.exec('BEGIN IMMEDIATE');
    try {
      run('INSERT INTO servers(id,name,description,owner_id) VALUES(?,?,?,?)', sid, name, clean(b.description, 300), user.id);
      run('INSERT INTO memberships(server_id,user_id,role) VALUES(?,?,?)', sid, user.id, 'owner');
      run('INSERT INTO channels(id,server_id,name,topic) VALUES(?,?,?,?)', id(), sid, 'geral', 'Converse com a comunidade!');
      run('INSERT INTO channels(id,server_id,name,topic) VALUES(?,?,?,?)', id(), sid, 'avisos', 'Novidades e atualizações');
      log(sid, user.id, 'server:create', sid, name);
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
    return json(res, 201, { server: detail(sid, user.id) });
  }
  if ((match = route.match(/^\/api\/servers\/([^/]+)$/))) {
    const sid = match[1];
    if (method === 'GET') return json(res, 200, { server: detail(sid, user.id) });
    if (method === 'PATCH') {
      requirePermission(sid,user.id,'manage_server'); const b = await parse(req);
      const old = row('SELECT * FROM servers WHERE id=?', sid); const name = b.name === undefined ? old.name : cleanServerName(b.name);
      must(name.length >= 1, 400, 'Digite um nome para o servidor.');
      run('UPDATE servers SET name=?,description=? WHERE id=?', name, b.description === undefined ? old.description : clean(b.description, 300), sid);
      log(sid, user.id, 'server:update', sid, name); emitServer(sid, 'server', { serverId: sid });
      return json(res, 200, { server: detail(sid, user.id) });
    }
    if (method === 'DELETE') {
      owner(sid, user.id);
      emitServer(sid, 'server_deleted', { serverId: sid }); run('DELETE FROM servers WHERE id=?', sid);
      return json(res, 200, { ok: true });
    }
  }
  if ((match = route.match(/^\/api\/servers\/([^/]+)\/leave$/)) && method === 'POST') {
    const sid = match[1]; const m = member(sid, user.id); must(m.role !== 'owner', 400, 'O dono precisa excluir o servidor ou transferir a propriedade (não disponível).');
    run('DELETE FROM memberships WHERE server_id=? AND user_id=?', sid, user.id);
    emitServer(sid, 'members', { serverId: sid }); return json(res, 200, { ok: true });
  }
  if ((match = route.match(/^\/api\/servers\/([^/]+)\/channels$/)) && method === 'POST') {
    const sid = match[1]; requirePermission(sid,user.id,'manage_channels'); const b = await parse(req);
    const name = clean(b.name, 35).toLowerCase().replace(/\s+/g, '-');
    must(/^[a-z0-9_\-]{2,35}$/.test(name), 400, 'Nome do canal inválido.');
    must(!row('SELECT id FROM channels WHERE server_id=? AND name=?', sid, name), 409, 'Canal já existe.');
    const type=b.type === 'voice' ? 'voice' : 'text';
    const cid = id(); run('INSERT INTO channels(id,server_id,name,topic,type) VALUES(?,?,?,?,?)', cid, sid, name, clean(b.topic, 200), type);
    log(sid, user.id, 'channel:create', cid, name); emitServer(sid, 'channels', { serverId: sid });
    return json(res, 201, { channel: { id: cid, name } });
  }
  if ((match = route.match(/^\/api\/channels\/([^/]+)$/))) {
    const c = channelMember(match[1], user.id);
    if (method === 'PATCH') {
      requirePermission(c.server_id,user.id,'manage_channels'); const b = await parse(req);
      const name = b.name === undefined ? c.name : clean(b.name, 35).toLowerCase().replace(/\s+/g, '-');
      must(/^[a-z0-9_\-]{2,35}$/.test(name), 400, 'Nome de canal inválido.');
      const slow = b.slowMode === undefined ? c.slowmode : Number(b.slowMode);
      must([0, 5, 10, 30, 60].includes(slow), 400, 'Modo lento inválido.');
      const locked=b.locked === undefined ? c.locked : Number(Boolean(b.locked));
      try { run('UPDATE channels SET name=?,topic=?,slowmode=?,locked=? WHERE id=?', name, b.topic === undefined ? c.topic : clean(b.topic, 200), slow, locked,c.id); }
      catch { fail(409, 'Nome de canal já usado.'); }
      log(c.server_id, user.id, 'channel:update', c.id, name); emitServer(c.server_id, 'channels', { serverId: c.server_id });
      return json(res, 200, { channel: { id: c.id, name, slowMode: slow } });
    }
    if (method === 'DELETE') {
      requirePermission(c.server_id,user.id,'manage_channels');
      must(row('SELECT COUNT(*) AS n FROM channels WHERE server_id=?', c.server_id).n > 1, 400, 'Não exclua o último canal.');
      run('DELETE FROM channels WHERE id=?', c.id); log(c.server_id, user.id, 'channel:delete', c.id, c.name);
      emitServer(c.server_id, 'channels', { serverId: c.server_id }); return json(res, 200, { ok: true });
    }
  }
  // Salas de voz: presença e sinalização WebRTC efêmera entre participantes.
  if ((match=route.match(/^\/api\/channels\/([^/]+)\/voice-access$/))&&method==='GET') {
    const c=channelMember(match[1],user.id);
    must(c.type==='voice',400,'Não é uma sala de voz.');
    const serverLocks=row('SELECT voice_locked FROM servers WHERE id=?',c.server_id);
    return json(res,200,{channelId:c.id,canJoin:allowed(c.server_id,user.id,'use_voice')&&(!(c.locked||serverLocks.voice_locked)||allowed(c.server_id,user.id,'manage_channels')),locked:Boolean(c.locked||serverLocks.voice_locked),note:'Sala de voz em grupo usa WebRTC mesh. Precisa de HTTPS e, em redes difíceis, TURN configurado.'});
  }
  if ((match=route.match(/^\/api\/channels\/([^/]+)\/voice$/))) {
    const c=channelMember(match[1],user.id);
    must(c.type==='voice',400,'Não é uma sala de voz.');
    const serverLocks=row('SELECT voice_locked FROM servers WHERE id=?',c.server_id);
    const canJoin=allowed(c.server_id,user.id,'use_voice')&&(!(c.locked||serverLocks.voice_locked)||allowed(c.server_id,user.id,'manage_channels'));
    if(method==='GET') return json(res,200,{room:voiceRoomView(c.id),canJoin,ice:await resolveIceConfiguration(user.id)});
    if(method==='POST') {
      must(canJoin,403,'Sem permissão para entrar nesta sala de voz.');
      throttle('voice:'+user.id,30,600000);
      const ice=await resolveIceConfiguration(user.id);
      if(voiceRooms.get(c.id)?.participants.has(user.id))leaveVoice(c.id,user.id,'reconnected');
      const room=voiceRoom(c.id);
      room.participants.set(user.id,{joinedAt:now(),lastSeen:now(),muted:false,cameraOff:false});
      emitServer(c.server_id,'voice',{action:'joined',channelId:c.id,userId:user.id,room:voiceRoomView(c.id)});
      return json(res,200,{room:voiceRoomView(c.id),ice});
    }
    if(method==='DELETE') { leaveVoice(c.id,user.id); return json(res,200,{ok:true}); }
  }
  if ((match=route.match(/^\/api\/channels\/([^/]+)\/voice\/(state|signal|signals)$/))) {
    const c=channelMember(match[1],user.id);
    must(c.type==='voice',400,'Não é uma sala de voz.');
    const room=voiceRoom(c.id);must(room.participants.has(user.id),403,'Entre na sala de voz primeiro.');
    if(match[2]==='state' && method==='PATCH') {
      const b=await parse(req);const p=room.participants.get(user.id);
      if(typeof b.muted==='boolean')p.muted=b.muted;if(typeof b.cameraOff==='boolean')p.cameraOff=b.cameraOff;p.lastSeen=now();
      emitServer(c.server_id,'voice',{action:'state',channelId:c.id,userId:user.id,room:voiceRoomView(c.id)});
      return json(res,200,{room:voiceRoomView(c.id)});
    }
    if(match[2]==='signal' && method==='POST') {
      throttle('voice-signal:'+user.id,240,60000);const b=await parse(req);
      const to=String(b.to||'');must(to!==user.id && room.participants.has(to),400,'Participante de destino inválido.');
      must(['offer','answer','ice'].includes(b.type),400,'Sinal inválido.');
      must(b.payload&&typeof b.payload==='object'&&!Array.isArray(b.payload),400,'Sinal inválido.');
      must(JSON.stringify(b.payload).length<=12000,413,'Sinal muito grande.');
      const sig={seq:++room.seq,from:user.id,to,type:b.type,payload:b.payload,createdAt:now()};
      room.signals.push(sig);if(room.signals.length>800)room.signals.shift();
      emitUser(to,'voice',{action:'signal',channelId:c.id,...sig});
      return json(res,200,{ok:true,seq:sig.seq});
    }
    if(match[2]==='signals' && method==='GET') {
      const after=Number(url.searchParams.get('after')||0);must(Number.isSafeInteger(after)&&after>=0,400,'Sequência inválida.');
      return json(res,200,{signals:room.signals.filter(x=>x.to===user.id&&x.seq>after),latestSeq:room.seq,room:voiceRoomView(c.id)});
    }
  }
  if ((match = route.match(/^\/api\/channels\/([^/]+)\/voice-message$/)) && method === 'POST') {
    const c = channelMember(match[1], user.id);
    must(c.type === 'text',400,'Esta é uma sala de voz, não um canal de texto.');
    requirePermission(c.server_id,user.id,'send_messages');
    must(!(c.locked||row('SELECT text_locked FROM servers WHERE id=?',c.server_id)?.text_locked)||allowed(c.server_id,user.id,'manage_channels'),403,'Chat bloqueado pela moderação.');
    throttle('voice-msg:' + user.id, 8, 60000);
    const upload = await readUpload(req,'sound');auditUpload(user.id,'sound',upload,ip);
    const mid = messageId();
    run('INSERT INTO messages(id,channel_id,user_id,content) VALUES (?,?,?,?)', mid, c.id, user.id, `[[voice:${upload.url}]]`);
    const msg = messagesByRows([row(`${msgSelect} WHERE m.id=?`, mid)], user.id)[0];
    emitServer(c.server_id, 'messages', { channelId: c.id, action: 'create', messageId: mid });
    log(c.server_id, user.id, 'message:voice', mid, upload.ext);
    return json(res, 201, { message: msg });
  }
  if ((match = route.match(/^\/api\/channels\/([^/]+)\/messages$/))) {
    const c = channelMember(match[1], user.id);
    must(c.type === 'text',400,'Esta é uma sala de voz, não um canal de texto.');
    if (method === 'GET') {
      const before = url.searchParams.get('before'); const limit = 40;
      const rows = before ? all(`${msgSelect} WHERE m.channel_id=? AND (m.created_at,m.id)<(SELECT created_at,id FROM messages WHERE id=? AND channel_id=?) ORDER BY m.created_at DESC,m.id DESC LIMIT ?`, c.id, before, c.id, limit)
        : all(`${msgSelect} WHERE m.channel_id=? ORDER BY m.created_at DESC,m.id DESC LIMIT ?`, c.id, limit);
      if(!before) markChannelRead(user.id,c.id);
      return json(res, 200, { messages: messagesByRows(rows.reverse(), user.id), hasMore: rows.length === limit });
    }
    if (method === 'POST') {
      requirePermission(c.server_id,user.id,'send_messages');
      must(!(c.locked||row('SELECT text_locked FROM servers WHERE id=?',c.server_id)?.text_locked)||allowed(c.server_id,user.id,'manage_channels'),403,'Chat bloqueado pela moderação.');
      throttle('msg:' + user.id, 15, 10000); const b = await parse(req);
      let content = clean(b.content, 2000);
      let asset = null;
      if (b.assetId) {
        asset = row('SELECT id,type,name,url FROM server_assets WHERE id=? AND server_id=?', String(b.assetId), c.server_id);
        must(asset && ['sticker','gif','sound','emoji'].includes(asset.type),400,'Arquivo personalizado inválido para este servidor.');
        content = `[[asset:${asset.id}]]`;
      }
      must(content.length > 0, 400, 'Mensagem vazia.');
      const settings=row('SELECT automod_enabled,block_links,blocked_words FROM servers WHERE id=?',c.server_id);
      if(!asset && settings?.automod_enabled && !allowed(c.server_id,user.id,'manage_messages')) {
        if(settings.block_links && /https?:\/\/|www\./i.test(content))fail(403,'Guardião: links bloqueados neste servidor.');
        const words=JSON.parse(settings.blocked_words||'[]');
        if(words.some(w=>w && content.toLocaleLowerCase().includes(w.toLocaleLowerCase())))fail(403,'Guardião: mensagem bloqueada pelas regras do servidor.');
      }
      const last = row('SELECT created_at FROM messages WHERE channel_id=? AND user_id=? ORDER BY created_at DESC LIMIT 1', c.id, user.id);
      if (c.slowmode && !allowed(c.server_id,user.id,'manage_messages') && last) {
        const t = Date.parse(last.created_at.replace(' ', 'T') + 'Z');
        must(now() - t >= c.slowmode * 1000, 429, `Modo lento: aguarde ${c.slowmode}s entre mensagens.`);
      }
      const repeated = row('SELECT created_at FROM messages WHERE channel_id=? AND user_id=? AND content=? ORDER BY created_at DESC LIMIT 1', c.id, user.id, content);
      if(repeated && !allowed(c.server_id,user.id,'manage_messages')){
        const t=Date.parse(repeated.created_at.replace(' ','T')+'Z');
        must(now()-t>15000,429,'Evite enviar a mesma mensagem repetida.');
      }
      let reply = null;
      if (b.replyTo) { const original = row('SELECT id FROM messages WHERE id=? AND channel_id=?', b.replyTo, c.id); must(original, 400, 'Resposta inválida.'); reply = original.id; }
      const mid = messageId(); run('INSERT INTO messages(id,channel_id,user_id,content,reply_to) VALUES (?,?,?,?,?)', mid, c.id, user.id, content, reply);
      const msg = messagesByRows([row(`${msgSelect} WHERE m.id=?`, mid)], user.id)[0];
      emitServer(c.server_id, 'messages', { channelId: c.id, action: 'create', messageId: mid });
      if (reply) { const target = row('SELECT user_id FROM messages WHERE id=?', reply); if (target?.user_id !== user.id) notify(target.user_id, `${user.displayName} respondeu à sua mensagem`, `/app?server=${c.server_id}&channel=${c.id}`); }
      // Menções por @username, respeitando participação no servidor.
      const mentions = [...new Set([...content.matchAll(/@([a-z0-9_]{3,24})/gi)].map(x => x[1].toLowerCase()))].slice(0, 8);
      for (const username of mentions) {
        const mentioned = row('SELECT u.id FROM users u JOIN memberships m ON m.user_id=u.id WHERE u.username=? AND m.server_id=?', username, c.server_id);
        if (mentioned && mentioned.id !== user.id) notify(mentioned.id, `${user.displayName} mencionou você em #${c.name}`, `/app?server=${c.server_id}&channel=${c.id}`);
      }
      return json(res, 201, { message: msg });
    }
  }
  if ((match = route.match(/^\/api\/channels\/([^/]+)\/polls$/)) && method === 'POST') {
    const c = channelMember(match[1], user.id);must(c.type==='text',400,'Sala de voz não aceita enquetes.');requirePermission(c.server_id,user.id,'send_messages');must(!(c.locked||row('SELECT text_locked FROM servers WHERE id=?',c.server_id)?.text_locked)||allowed(c.server_id,user.id,'manage_channels'),403,'Chat bloqueado.'); throttle('poll:' + user.id, 6, 600000); const b = await parse(req);
    const question = clean(b.question, 180);
    const options = Array.isArray(b.options) ? b.options.map(o => clean(o, 80)).filter(Boolean) : [];
    must(question.length >= 5 && options.length >= 2 && options.length <= 5 && new Set(options).size === options.length, 400, 'Enquete: pergunta e 2 a 5 opções diferentes.');
    const mid = messageId(); run('INSERT INTO messages(id,channel_id,user_id,poll_question,poll_options) VALUES(?,?,?,?,?)', mid, c.id, user.id, question, JSON.stringify(options));
    emitServer(c.server_id, 'messages', { channelId: c.id, action: 'create', messageId: mid });
    return json(res, 201, { message: messagesByRows([row(`${msgSelect} WHERE m.id=?`, mid)], user.id)[0] });
  }
  if ((match = route.match(/^\/api\/channels\/([^/]+)\/pins$/)) && method === 'GET') {
    const c = channelMember(match[1], user.id);
    return json(res, 200, { messages: messagesByRows(all(`${msgSelect} WHERE m.channel_id=? AND pinned=1 ORDER BY m.created_at DESC LIMIT 40`, c.id), user.id) });
  }
  if ((match = route.match(/^\/api\/messages\/([^/]+)$/))) {
    const { message: m, channel: c } = getMessage(match[1], user.id);
    if (method === 'PATCH') {
      must(m.user_id === user.id, 403, 'Só você pode editar sua mensagem.');
      must(!m.poll_question, 400, 'Enquetes não podem ser editadas.');
      const b = await parse(req); const content = clean(b.content, 2000); must(content, 400, 'Mensagem vazia.');
      run("UPDATE messages SET content=?,updated_at=datetime('now') WHERE id=?", content, m.id);
      emitServer(c.server_id, 'messages', { channelId: c.id, action: 'update', messageId: m.id });
      return json(res, 200, { ok: true });
    }
    if (method === 'DELETE') {
      must(m.user_id === user.id || allowed(c.server_id,user.id,'manage_messages'), 403);
      run('DELETE FROM messages WHERE id=?', m.id); log(c.server_id, user.id, 'message:delete', m.user_id, c.name);
      emitServer(c.server_id, 'messages', { channelId: c.id, action: 'delete', messageId: m.id });
      return json(res, 200, { ok: true });
    }
  }
  if ((match = route.match(/^\/api\/messages\/([^/]+)\/react$/)) && method === 'POST') {
    const { message: m, channel: c } = getMessage(match[1], user.id); const b = await parse(req);
    const emoji = clean(b.emoji, 10); must(['❤️','😂','👍','🔥','🎉','👀','💜','💯'].includes(emoji), 400, 'Reação indisponível.');
    if (row('SELECT 1 FROM reactions WHERE message_id=? AND user_id=? AND emoji=?', m.id, user.id, emoji)) run('DELETE FROM reactions WHERE message_id=? AND user_id=? AND emoji=?', m.id, user.id, emoji);
    else run('INSERT INTO reactions(message_id,user_id,emoji) VALUES(?,?,?)', m.id, user.id, emoji);
    emitServer(c.server_id, 'messages', { channelId: c.id, action: 'reaction', messageId: m.id }); return json(res, 200, { ok: true });
  }
  if ((match = route.match(/^\/api\/messages\/([^/]+)\/pin$/)) && method === 'POST') {
    const { message: m, channel: c } = getMessage(match[1], user.id); requirePermission(c.server_id,user.id,'manage_messages');
    const value = m.pinned ? 0 : 1; run('UPDATE messages SET pinned=? WHERE id=?', value, m.id);
    log(c.server_id, user.id, value ? 'message:pin' : 'message:unpin', m.id);
    emitServer(c.server_id, 'messages', { channelId: c.id, action: 'pin', messageId: m.id }); return json(res, 200, { pinned: !!value });
  }
  if ((match = route.match(/^\/api\/messages\/([^/]+)\/vote$/)) && method === 'POST') {
    const { message: m, channel: c } = getMessage(match[1], user.id); must(m.poll_question, 400, 'Não é enquete.');
    const b = await parse(req); const i = b.optionIndex; must(Number.isInteger(i) && i >= 0 && i < JSON.parse(m.poll_options).length, 400, 'Opção inválida.');
    run('INSERT INTO poll_votes(message_id,user_id,option_index) VALUES(?,?,?) ON CONFLICT(message_id,user_id) DO UPDATE SET option_index=excluded.option_index', m.id, user.id, i);
    emitServer(c.server_id, 'messages', { channelId: c.id, action: 'vote', messageId: m.id }); return json(res, 200, { ok: true });
  }
  if ((match = route.match(/^\/api\/servers\/([^/]+)\/search$/)) && method === 'GET') {
    const sid = match[1]; member(sid, user.id);
    const q = clean(url.searchParams.get('q'), 100);
    const channelId = clean(url.searchParams.get('channelId'), 60);
    const from = clean(url.searchParams.get('from'), 32).replace(/^@/, '').toLowerCase();
    const after = clean(url.searchParams.get('after'), 20);
    const before = clean(url.searchParams.get('before'), 20);
    const pinnedOnly = url.searchParams.get('pinned') === '1';
    const withAsset = url.searchParams.get('asset') === '1';
    must(q.length >= 2 || from.length >= 3 || pinnedOnly || withAsset, 400, 'Digite ao menos 2 caracteres ou use um filtro.');
    const where = ['c.server_id=?'];
    const args = [sid];
    if (q.length >= 2) {
      const like = `%${q}%`;
      where.push('(m.content LIKE ? OR m.poll_question LIKE ?)');
      args.push(like, like);
    }
    if (channelId) { const ch=row('SELECT id FROM channels WHERE id=? AND server_id=?', channelId, sid); must(ch,400,'Canal inválido.'); where.push('m.channel_id=?'); args.push(channelId); }
    if (from) { where.push('LOWER(u.username)=?'); args.push(from); }
    if (/^\d{4}-\d{2}-\d{2}$/.test(after)) { where.push('date(m.created_at)>=date(?)'); args.push(after); }
    if (/^\d{4}-\d{2}-\d{2}$/.test(before)) { where.push('date(m.created_at)<=date(?)'); args.push(before); }
    if (pinnedOnly) where.push('m.pinned=1');
    if (withAsset) where.push("(m.content LIKE '[[asset:%]]' OR m.content LIKE '[[voice:%]]')");
    const matches = all(`${msgSelect} JOIN channels c ON c.id=m.channel_id WHERE ${where.join(' AND ')} ORDER BY m.created_at DESC LIMIT 80`, ...args);
    const channels = Object.fromEntries(all('SELECT id,name FROM channels WHERE server_id=?', sid).map(x => [x.id, x.name]));
    return json(res, 200, { results: messagesByRows(matches, user.id).map(m => ({ ...m, channelName: channels[m.channelId] })) });
  }
  if ((match = route.match(/^\/api\/servers\/([^/]+)\/invites$/)) && method === 'POST') {
    const sid = match[1]; member(sid, user.id); throttle('invite:' + user.id, 10, 3600000);
    const b = await parse(req); const days = Number(b.days || 7); const maxUses = Number(b.maxUses || 25);
    must([1,7,30].includes(days) && Number.isInteger(maxUses) && maxUses >= 1 && maxUses <= 100, 400, 'Limites de convite inválidos.');
    const code = randomBytes(8).toString('base64url');
    run('INSERT INTO invites(code,server_id,creator_id,max_uses,expires_at) VALUES(?,?,?,?,?)', code, sid, user.id, maxUses, now() + days * 86400000);
    return json(res, 201, { code, path: `/invite/${code}` });
  }
  if ((match = route.match(/^\/api\/invites\/([^/]+)$/))) {
    const code = match[1]; const inv = row('SELECT i.*,s.name AS server_name FROM invites i JOIN servers s ON i.server_id=s.id WHERE i.code=?', code);
    must(inv && (!inv.expires_at || inv.expires_at > now()) && (inv.max_uses === null || inv.uses < inv.max_uses), 404, 'Convite inválido, expirado ou esgotado.');
    if (method === 'GET') return json(res, 200, { invite: { serverId: inv.server_id, serverName: inv.server_name, uses: inv.uses, maxUses: inv.max_uses } });
    if (method === 'POST') {
      must(!row('SELECT 1 FROM bans WHERE server_id=? AND user_id=?', inv.server_id, user.id), 403, 'Você foi banido deste servidor.');
      if (!membership(inv.server_id, user.id)) {
        db.exec('BEGIN IMMEDIATE');
        try {
          // Valida o limite novamente dentro da transação.
          const fresh = row('SELECT * FROM invites WHERE code=?', code);
          must(fresh && fresh.expires_at > now() && fresh.uses < fresh.max_uses, 404, 'Convite expirou.');
          run('INSERT INTO memberships(server_id,user_id,role) VALUES(?,?,?)', inv.server_id, user.id, 'member');
          run('UPDATE invites SET uses=uses+1 WHERE code=?', code);
          log(inv.server_id, user.id, 'member:join', user.id);
          db.exec('COMMIT');
        } catch (e) { db.exec('ROLLBACK'); throw e; }
      }
      if(row('SELECT welcome_enabled FROM servers WHERE id=?',inv.server_id)?.welcome_enabled)notify(user.id,'👋 Guardião: bem-vindo ao servidor! Leia as regras e divirta-se.','/app?server='+inv.server_id);
      emitServer(inv.server_id, 'members', { serverId: inv.server_id });
      return json(res, 200, { serverId: inv.server_id });
    }
  }
  if ((match = route.match(/^\/api\/servers\/([^/]+)\/members\/([^/]+)\/(kick|ban|role)$/)) && method === 'POST') {
    const [, sid, target, action] = match; member(sid,user.id); const actorRole = membership(sid, user.id).role;
    if(action==='role')owner(sid,user.id);else requirePermission(sid,user.id,'manage_members');
    const targetMember = membership(sid, target); must(targetMember, 404, 'Membro não encontrado.');
    must(target !== user.id && targetMember.role !== 'owner', 403, 'Não é permitido moderar este membro.');
    must(actorRole === 'owner' || (targetMember.role === 'member' && !permissions(sid,target).some(p=>p.startsWith('manage_'))), 403, 'Não pode moderar alguém do mesmo nível.');
    const b = await parse(req); const reason = clean(b.reason, 160);
    if (action === 'role') {
      must(actorRole === 'owner', 403, 'Somente o dono define moderadores.');
      must(['member','moderator'].includes(b.role), 400, 'Cargo inválido.');
      run('UPDATE memberships SET role=? WHERE server_id=? AND user_id=?', b.role, sid, target);
      log(sid, user.id, 'member:role', target, b.role);
    } else {
      if (action === 'ban') run('INSERT OR REPLACE INTO bans(server_id,user_id,actor_id,reason) VALUES (?,?,?,?)', sid, target, user.id, reason);
      run('DELETE FROM memberships WHERE server_id=? AND user_id=?', sid, target);
      log(sid, user.id, 'member:' + action, target, reason);
      emitUser(target, 'removed', { serverId: sid, action });
    }
    emitServer(sid, 'members', { serverId: sid }); return json(res, 200, { ok: true });
  }
  if ((match = route.match(/^\/api\/servers\/([^/]+)\/bans$/)) && method === 'GET') {
    requirePermission(match[1],user.id,'manage_members');
    const bans = all(`SELECT b.user_id AS userId,u.username,u.display_name AS displayName,b.reason,b.created_at AS createdAt
      FROM bans b JOIN users u ON u.id=b.user_id WHERE b.server_id=? ORDER BY b.created_at DESC LIMIT 100`, match[1]);
    return json(res, 200, { bans });
  }
  if ((match = route.match(/^\/api\/servers\/([^/]+)\/bans\/([^/]+)\/unban$/)) && method === 'POST') {
    const sid=match[1], target=match[2]; requirePermission(sid,user.id,'manage_members');
    const existing=row('SELECT user_id FROM bans WHERE server_id=? AND user_id=?',sid,target);
    must(existing,404,'Banimento não encontrado.');
    run('DELETE FROM bans WHERE server_id=? AND user_id=?',sid,target);
    log(sid,user.id,'member:unban',target);return json(res,200,{ok:true});
  }
  if ((match = route.match(/^\/api\/servers\/([^/]+)\/audit$/)) && method === 'GET') {
    requirePermission(match[1],user.id,'view_reports');
    return json(res, 200, { entries: all('SELECT actor_id AS actorId,target_id AS targetId,action,detail,created_at AS createdAt FROM audit WHERE server_id=? ORDER BY created_at DESC LIMIT 60', match[1]) });
  }
  // Ícone do servidor: somente quem pode editar configurações.
  if ((match=route.match(/^\/api\/servers\/([^/]+)\/icon$/)) && ['PUT','DELETE'].includes(method)) {
    const sid=match[1];requirePermission(sid,user.id,'manage_server');
    const old=row('SELECT icon_url FROM servers WHERE id=?',sid);
    if(method==='DELETE') {run("UPDATE servers SET icon_url='' WHERE id=?",sid);removeMedia(old.icon_url);}
    else {
      must(req.headers['content-type']==='application/octet-stream',415,'Envie a imagem em application/octet-stream.');
      const upload=await readUpload(req,'serverIcon');auditUpload(user.id,'serverIcon',upload,ip);
      try {run('UPDATE servers SET icon_url=? WHERE id=?',upload.url,sid);}catch(e){removeMedia(upload.url);throw e;}
      removeMedia(old.icon_url);
    }
    log(sid,user.id,'server:icon',sid);emitServer(sid,'server',{serverId:sid});
    return json(res,200,{server:detail(sid,user.id)});
  }
  if ((match=route.match(/^\/api\/servers\/([^/]+)\/locks$/))&&method==='PATCH') {
    const sid=match[1];requirePermission(sid,user.id,'manage_channels');const b=await parse(req);
    const old=row('SELECT text_locked,voice_locked FROM servers WHERE id=?',sid);
    run('UPDATE servers SET text_locked=?,voice_locked=? WHERE id=?',b.textLocked===undefined?old.text_locked:Number(Boolean(b.textLocked)),b.voiceLocked===undefined?old.voice_locked:Number(Boolean(b.voiceLocked)),sid);
    log(sid,user.id,'server:locks',sid,JSON.stringify({textLocked:b.textLocked,voiceLocked:b.voiceLocked}));emitServer(sid,'server',{serverId:sid});
    return json(res,200,{server:detail(sid,user.id)});
  }
  if ((match=route.match(/^\/api\/servers\/([^/]+)\/roles$/))) {
    const sid=match[1];member(sid,user.id);
    if(method==='GET')return json(res,200,{roles:detail(sid,user.id).roles,permissions:permissionList});
    if(method==='POST') {
      owner(sid,user.id);throttle('role:'+sid,30,3600000);
      const b=await parse(req),name=clean(b.name,32);
      must(name.length>=2,400,'Nome do cargo muito curto.');
      must(Array.isArray(b.permissions)&&b.permissions.every(p=>permissionList.includes(p)),400,'Permissões inválidas.');
      const color=/^#[0-9a-f]{6}$/i.test(b.color)?b.color:'#8b82ff';
      const roleId=id();
      try {run('INSERT INTO custom_roles(id,server_id,name,color,permissions) VALUES(?,?,?,?,?)',roleId,sid,name,color,JSON.stringify([...new Set(b.permissions)]));}
      catch {fail(409,'Já existe um cargo com este nome.');}
      log(sid,user.id,'role:create',roleId,name);emitServer(sid,'members',{serverId:sid});
      return json(res,201,{id:roleId});
    }
  }
  if ((match=route.match(/^\/api\/servers\/([^/]+)\/roles\/([^/]+)$/))) {
    const [_,sid,rid]=match;owner(sid,user.id);
    const r=row('SELECT * FROM custom_roles WHERE id=? AND server_id=?',rid,sid);must(r,404,'Cargo inexistente.');
    if(method==='DELETE') {
      run('UPDATE memberships SET custom_role_id=NULL WHERE server_id=? AND custom_role_id=?',sid,rid);
      run('DELETE FROM custom_roles WHERE id=?',rid);
      log(sid,user.id,'role:delete',rid,r.name);emitServer(sid,'members',{serverId:sid});return json(res,200,{ok:true});
    }
    if(method==='PATCH') {
      const b=await parse(req), name=b.name===undefined?r.name:clean(b.name,32),ps=b.permissions===undefined?JSON.parse(r.permissions):b.permissions;
      must(name.length>=2 && Array.isArray(ps) && ps.every(p=>permissionList.includes(p)),400,'Cargo inválido.');
      const color=b.color===undefined?r.color:(/^#[0-9a-f]{6}$/i.test(b.color)?b.color:'#8b82ff');
      try {run('UPDATE custom_roles SET name=?,permissions=?,color=? WHERE id=?',name,JSON.stringify([...new Set(ps)]),color,rid);}catch {fail(409,'Já existe um cargo com este nome.');}
      log(sid,user.id,'role:update',rid,name);emitServer(sid,'members',{serverId:sid});return json(res,200,{ok:true});
    }
  }
  if ((match=route.match(/^\/api\/servers\/([^/]+)\/members\/([^/]+)\/custom-role$/)) && method==='POST') {
    const [_,sid,target]=match;owner(sid,user.id);
    const m=member(sid,target);must(m.role!=='owner',403,'O dono não pode ter seu cargo substituído.');
    const b=await parse(req),rid=b.roleId||null;
    if(rid)must(row('SELECT id FROM custom_roles WHERE id=? AND server_id=?',rid,sid),400,'Cargo inválido para este servidor.');
    run('UPDATE memberships SET custom_role_id=? WHERE server_id=? AND user_id=?',rid,sid,target);
    log(sid,user.id,'role:assign',target,rid||'removido');emitServer(sid,'members',{serverId:sid});return json(res,200,{ok:true});
  }
  if ((match=route.match(/^\/api\/servers\/([^/]+)\/bots\/guardian$/))) {
    const sid=match[1];member(sid,user.id);
    if(method==='GET'){const c=row('SELECT automod_enabled AS enabled,block_links AS blockLinks,blocked_words AS blockedWords,welcome_enabled AS welcomeEnabled,text_locked AS textLocked,voice_locked AS voiceLocked FROM servers WHERE id=?',sid);return json(res,200,{bot:{...c,blockedWords:JSON.parse(c.blockedWords)}});}
    if(method==='PATCH') {
      requirePermission(sid,user.id,'manage_bots');const b=await parse(req);
      const old=row('SELECT * FROM servers WHERE id=?',sid);
      const words=Array.isArray(b.blockedWords)?b.blockedWords.map(w=>clean(w,30).toLocaleLowerCase()).filter(Boolean).slice(0,30):JSON.parse(old.blocked_words||'[]');
      run('UPDATE servers SET automod_enabled=?,block_links=?,blocked_words=?,welcome_enabled=? WHERE id=?',b.enabled===undefined?old.automod_enabled:Number(Boolean(b.enabled)),b.blockLinks===undefined?old.block_links:Number(Boolean(b.blockLinks)),JSON.stringify(words),b.welcomeEnabled===undefined?old.welcome_enabled:Number(Boolean(b.welcomeEnabled)),sid);
      log(sid,user.id,'bot:guardian',sid);emitServer(sid,'server',{serverId:sid});return json(res,200,{ok:true});
    }
  }
  if (route==='/api/bots/catalog'&&method==='GET') {
    return json(res,200,{bots:all('SELECT id,name,description,permissions,enabled FROM bot_catalog WHERE enabled=1 ORDER BY name').map(b=>({...b,permissions:JSON.parse(b.permissions)}))});
  }
  if ((match=route.match(/^\/api\/servers\/([^/]+)\/bots$/))) {
    const sid=match[1];member(sid,user.id);
    if(method==='GET')return json(res,200,{bots:all('SELECT c.id,c.name,c.description,c.permissions,b.config,b.added_at AS addedAt FROM server_bots b JOIN bot_catalog c ON c.id=b.bot_id WHERE b.server_id=? ORDER BY c.name',sid).map(b=>({...b,permissions:JSON.parse(b.permissions),config:JSON.parse(b.config||'{}')}))});
  }
  if ((match=route.match(/^\/api\/servers\/([^/]+)\/bots\/([^/]+)$/))) {
    const [_,sid,botId]=match;requirePermission(sid,user.id,'manage_bots');
    const bot=row('SELECT id FROM bot_catalog WHERE id=? AND enabled=1',botId);must(bot,404,'Bot não encontrado na loja.');
    if(method==='POST'){
      const botCount=row('SELECT COUNT(*) AS n FROM server_bots WHERE server_id=?',sid).n;
      const maxBots=isVipActive(user)?2:1;
      must(botCount < maxBots,403,isVipActive(user)?'Limite VIP: até 2 bots por servidor.':'Sem VIP, o servidor pode usar 1 bot. VIP libera até 2 bots.');
      run('INSERT OR REPLACE INTO server_bots(server_id,bot_id,config,added_by) VALUES(?,?,?,?)',sid,botId,JSON.stringify({enabled:true,customName:'',avatarUrl:'',bannerUrl:''}),user.id);log(sid,user.id,'bot:install',botId);emitServer(sid,'server',{serverId:sid});return json(res,200,{ok:true,limits:{maxBots}});
    }
    if(method==='DELETE'){run('DELETE FROM server_bots WHERE server_id=? AND bot_id=?',sid,botId);log(sid,user.id,'bot:remove',botId);emitServer(sid,'server',{serverId:sid});return json(res,200,{ok:true});}
  }
  if ((match=route.match(/^\/api\/servers\/([^/]+)\/bots\/([^/]+)\/customize$/)) && method==='PATCH') {
    const [_,sid,botId]=match;requirePermission(sid,user.id,'manage_bots');
    must(isVipActive(user),403,'Só VIP pode personalizar foto, banner e nome do bot.');
    const installed=row('SELECT config FROM server_bots WHERE server_id=? AND bot_id=?',sid,botId);must(installed,404,'Bot não instalado neste servidor.');
    const b=await parse(req);const cfg=JSON.parse(installed.config||'{}');
    cfg.customName=clean(b.customName,32)||cfg.customName||'';
    cfg.avatarUrl=clean(b.avatarUrl,300)||cfg.avatarUrl||'';
    cfg.bannerUrl=clean(b.bannerUrl,300)||cfg.bannerUrl||'';
    cfg.welcomeMessage=clean(b.welcomeMessage,180)||cfg.welcomeMessage||'';
    cfg.commandPrefix=clean(b.commandPrefix,4)||cfg.commandPrefix||'!';
    cfg.publicBio=clean(b.publicBio,180)||cfg.publicBio||'';
    cfg.note='Personalização VIP segura; não concede permissão de admin.';
    run('UPDATE server_bots SET config=? WHERE server_id=? AND bot_id=?',JSON.stringify(cfg),sid,botId);
    log(sid,user.id,'bot:vip-customize',botId);emitServer(sid,'server',{serverId:sid});return json(res,200,{ok:true,config:cfg});
  }
  if ((match=route.match(/^\/api\/servers\/([^/]+)\/bots\/([^/]+)\/action$/)) && method==='POST') {
    const [_,sid,botId]=match;requirePermission(sid,user.id,'manage_bots');
    const installed=row('SELECT config FROM server_bots WHERE server_id=? AND bot_id=?',sid,botId);must(installed,404,'Bot não instalado neste servidor.');
    const b=await parse(req);const action=clean(b.action,40);must(['welcome-test','rules-test','anti-spam-scan','status'].includes(action),400,'Ação de bot inválida.');
    const detail=clean(b.detail,400)||('ação '+action);
    const logId=id();run('INSERT INTO bot_action_logs(id,server_id,bot_id,actor_id,action,detail) VALUES(?,?,?,?,?,?)',logId,sid,botId,user.id,action,detail);
    log(sid,user.id,'bot:action',botId,action);return json(res,200,{ok:true,logId,action,botId,detail});
  }
  if ((match=route.match(/^\/api\/servers\/([^/]+)\/boosts$/))) {
    const sid=match[1];member(sid,user.id);
    if(method==='GET')return json(res,200,{boosts:boostSummary(sid,user.id)});
    if(method==='POST'){
      must(isVipActive(user),403,'Só VIP pode dar impulso em servidor.');
      const summary=boostSummary(sid,user.id);must(summary.mine<1,409,'Você já impulsionou este servidor.');must(summary.used<2,403,'VIP tem 2 impulsos ativos no máximo.');
      run('INSERT INTO server_boosts(id,server_id,user_id) VALUES(?,?,?)',id(),sid,user.id);
      log(sid,user.id,'server:boost',sid);emitServer(sid,'server',{serverId:sid});return json(res,201,{ok:true,boosts:boostSummary(sid,user.id)});
    }
    if(method==='DELETE'){
      run('DELETE FROM server_boosts WHERE server_id=? AND user_id=?',sid,user.id);
      log(sid,user.id,'server:boost-remove',sid);emitServer(sid,'server',{serverId:sid});return json(res,200,{ok:true,boosts:boostSummary(sid,user.id)});
    }
  }
  if ((match=route.match(/^\/api\/servers\/([^/]+)\/assets$/))) {
    const sid=match[1];member(sid,user.id);
    if(method==='GET'){const type=url.searchParams.get('type');const args=type?[sid,type]:[sid];return json(res,200,{assets:all(`SELECT id,type,name,url,created_by AS createdBy,created_at AS createdAt FROM server_assets WHERE server_id=? ${type?'AND type=?':''} ORDER BY created_at DESC`,...args)});}
    if(method==='POST'){requirePermission(sid,user.id,'manage_server');
      must(req.headers['content-type']==='application/octet-stream',415,'Envie o arquivo como application/octet-stream.');
      const type=clean(url.searchParams.get('type'),20);const name=clean(url.searchParams.get('name'),30).toLowerCase().replace(/\s+/g,'-');
      must(['emoji','sticker','gif','sound'].includes(type),400,'Tipo inválido.');must(/^[a-z0-9_-]{2,30}$/.test(name),400,'Nome inválido.');
      const upload=await readUpload(req,type==='sound'?'sound':'asset');auditUpload(user.id,type==='sound'?'sound':'asset',upload,ip);const aid=id();
      try{run('INSERT INTO server_assets(id,server_id,type,name,url,created_by) VALUES(?,?,?,?,?,?)',aid,sid,type,name,upload.url,user.id);}
      catch(e){removeMedia(upload.url);fail(409,'Já existe item com esse nome neste servidor.');}
      log(sid,user.id,'asset:create',aid,`${type}:${name}`);emitServer(sid,'server',{serverId:sid});return json(res,201,{asset:{id:aid,type,name,url:upload.url}});
    }
  }
  if ((match=route.match(/^\/api\/servers\/([^/]+)\/assets\/([^/]+)$/))&&method==='DELETE') {
    const [_,sid,assetId]=match;requirePermission(sid,user.id,'manage_server');
    const asset=row('SELECT * FROM server_assets WHERE id=? AND server_id=?',assetId,sid);must(asset,404,'Item não encontrado.');
    run('DELETE FROM server_assets WHERE id=?',assetId);removeMedia(asset.url);log(sid,user.id,'asset:delete',assetId,asset.name);emitServer(sid,'server',{serverId:sid});return json(res,200,{ok:true});
  }
  if ((match=route.match(/^\/api\/servers\/([^/]+)\/events$/))) {
    const sid=match[1];member(sid,user.id);
    if(method==='GET')return json(res,200,{events:all(`SELECT e.id,e.title,e.description,e.starts_at AS startsAt,e.location,u.display_name AS creator,
      (SELECT COUNT(*) FROM event_rsvps r WHERE r.event_id=e.id AND r.status='going') AS going,
      (SELECT status FROM event_rsvps r WHERE r.event_id=e.id AND r.user_id=?) AS myStatus
      FROM server_events e JOIN users u ON u.id=e.creator_id WHERE e.server_id=? ORDER BY e.starts_at ASC LIMIT 60`,user.id,sid)});
    if(method==='POST'){requirePermission(sid,user.id,'create_invites');const b=await parse(req);const title=clean(b.title,80),startsAt=Number(b.startsAt);
      must(title.length>=3,400,'Título muito curto.');must(Number.isSafeInteger(startsAt)&&startsAt>Date.now()-3600000,400,'Data do evento inválida.');
      const eid=id();run('INSERT INTO server_events(id,server_id,creator_id,title,description,starts_at,location) VALUES(?,?,?,?,?,?,?)',eid,sid,user.id,title,clean(b.description,500),startsAt,clean(b.location,120));
      log(sid,user.id,'event:create',eid,title);emitServer(sid,'server',{serverId:sid});return json(res,201,{eventId:eid});}
  }
  if ((match=route.match(/^\/api\/events\/([^/]+)\/rsvp$/))&&method==='POST') {
    const ev=row('SELECT * FROM server_events WHERE id=?',match[1]);must(ev,404,'Evento não encontrado.');member(ev.server_id,user.id);
    const b=await parse(req);must(['going','maybe','declined'].includes(b.status),400,'Resposta inválida.');
    run("INSERT INTO event_rsvps(event_id,user_id,status) VALUES(?,?,?) ON CONFLICT(event_id,user_id) DO UPDATE SET status=excluded.status,updated_at=datetime('now')",ev.id,user.id,b.status);
    emitServer(ev.server_id,'server',{serverId:ev.server_id});return json(res,200,{ok:true});
  }
  if (route==='/api/reports'&&method==='POST') {
    throttle('report:'+user.id,8,86400000);const b=await parse(req);
    const target=row('SELECT id FROM users WHERE id=?',b.targetUserId);
    must(target&&target.id!==user.id,400,'Escolha outro usuário existente.');
    const reason=clean(b.reason,500);must(reason.length>=10,400,'Descreva o motivo (pelo menos 10 caracteres).');
    if(b.serverId)member(b.serverId,user.id);
    if(b.messageId){const m=row('SELECT user_id,channel_id FROM messages WHERE id=?',b.messageId);must(m&&m.user_id===target.id,400,'Mensagem não corresponde ao usuário denunciado.');const c=channelMember(m.channel_id,user.id);if(b.serverId)must(c.server_id===b.serverId,400,'Servidor não corresponde à mensagem.');}
    const rid=id();run('INSERT INTO reports(id,reporter_id,target_user_id,message_id,server_id,reason) VALUES(?,?,?,?,?,?)',rid,user.id,target.id,b.messageId||null,b.serverId||null,reason);
    return json(res,201,{ok:true,reportId:rid});
  }
  if (route==='/api/mod/reports/summary'&&method==='GET') {
    must(platformAdmin(user.id),403,'Acesso exclusivo à equipe da plataforma.');
    return json(res,200,{summary:{pending:row("SELECT COUNT(*) AS n FROM reports WHERE status='pending'").n,reviewed:row("SELECT COUNT(*) AS n FROM reports WHERE status='reviewed'").n,rejected:row("SELECT COUNT(*) AS n FROM reports WHERE status='rejected'").n,bannedUsers:row('SELECT COUNT(*) AS n FROM users WHERE banned_at IS NOT NULL').n},recent:all(`SELECT r.id,r.status,r.reason,r.created_at AS createdAt,u.username AS targetUsername,x.username AS reporterUsername FROM reports r JOIN users u ON r.target_user_id=u.id JOIN users x ON r.reporter_id=x.id ORDER BY r.created_at DESC LIMIT 10`)});
  }
  if (route==='/api/mod/reports'&&method==='GET') {
    must(platformAdmin(user.id),403,'Acesso exclusivo à equipe da plataforma.');
    const status=url.searchParams.get('status')||'pending';must(['pending','reviewed','rejected','all'].includes(status),400);
    return json(res,200,{reports:all(`SELECT r.*,u.username AS targetUsername,x.username AS reporterUsername FROM reports r JOIN users u ON r.target_user_id=u.id JOIN users x ON r.reporter_id=x.id ${status==='all'?'':'WHERE r.status=?'} ORDER BY r.created_at DESC LIMIT 100`,...(status==='all'?[]:[status]))});
  }
  if ((match=route.match(/^\/api\/mod\/reports\/([^/]+)$/))&&method==='PATCH') {
    must(platformAdmin(user.id),403);const b=await parse(req);must(['reviewed','rejected'].includes(b.status),400,'Estado inválido.');
    must(row('SELECT id FROM reports WHERE id=?',match[1]),404,'Denúncia não encontrada.');
    run("UPDATE reports SET status=?,reviewer_id=?,reviewed_at=datetime('now'),resolution=? WHERE id=?",b.status,user.id,clean(b.resolution,300),match[1]);
    run('INSERT INTO platform_audit(id,admin_id,action,target_id,reason) VALUES(?,?,?,?,?)',id(),user.id,'report:'+b.status,match[1],clean(b.resolution,300));
    return json(res,200,{ok:true});
  }
  if (route==='/api/mod/appeals'&&method==='GET') {
    must(platformAdmin(user.id),403,'Acesso exclusivo à equipe da plataforma.');
    const status=url.searchParams.get('status')||'pending';must(['pending','reviewed','rejected','all'].includes(status),400);
    return json(res,200,{appeals:all(`SELECT * FROM ban_appeals ${status==='all'?'':'WHERE status=?'} ORDER BY created_at DESC LIMIT 100`,...(status==='all'?[]:[status]))});
  }
  if ((match=route.match(/^\/api\/mod\/appeals\/([^/]+)$/))&&method==='PATCH') {
    must(platformAdmin(user.id),403);const b=await parse(req);must(['reviewed','rejected'].includes(b.status),400,'Estado inválido.');
    const appeal=row('SELECT * FROM ban_appeals WHERE id=?',match[1]);must(appeal,404,'Recurso não encontrado.');
    if(b.unban && appeal.user_id)run("UPDATE users SET banned_at=NULL,ban_reason='' WHERE id=?",appeal.user_id);
    run("UPDATE ban_appeals SET status=?,reviewer_id=?,reviewed_at=datetime('now'),resolution=? WHERE id=?",b.status,user.id,clean(b.resolution,300),appeal.id);
    run('INSERT INTO platform_audit(id,admin_id,action,target_id,reason) VALUES(?,?,?,?,?)',id(),user.id,'appeal:'+b.status,appeal.id,clean(b.resolution,300));
    return json(res,200,{ok:true});
  }
  if (route==='/api/mod/recovery-requests'&&method==='GET') {
    must(platformAdmin(user.id),403,'Acesso exclusivo à equipe da plataforma.');
    const status=url.searchParams.get('status')||'pending';must(['pending','reviewed','rejected','all'].includes(status),400);
    return json(res,200,{requests:all(`SELECT * FROM account_recovery_requests ${status==='all'?'':'WHERE status=?'} ORDER BY created_at DESC LIMIT 100`,...(status==='all'?[]:[status]))});
  }
  if ((match=route.match(/^\/api\/mod\/recovery-requests\/([^/]+)$/))&&method==='PATCH') {
    must(platformAdmin(user.id),403);const b=await parse(req);must(['reviewed','rejected'].includes(b.status),400,'Estado inválido.');
    must(row('SELECT id FROM account_recovery_requests WHERE id=?',match[1]),404,'Solicitação não encontrada.');
    run("UPDATE account_recovery_requests SET status=?,reviewer_id=?,reviewed_at=datetime('now'),resolution=? WHERE id=?",b.status,user.id,clean(b.resolution,300),match[1]);
    run('INSERT INTO platform_audit(id,admin_id,action,target_id,reason) VALUES(?,?,?,?,?)',id(),user.id,'recovery:'+b.status,match[1],clean(b.resolution,300));
    return json(res,200,{ok:true});
  }
  if ((match=route.match(/^\/api\/mod\/users\/([^/]+)\/(ban|unban)$/))&&method==='POST') {
    must(platformAdmin(user.id),403,'Acesso exclusivo da equipe da plataforma.');
    const [_,target,action]=match;must(target!==user.id&&!platformAdmin(target),403,'Não é permitido banir um administrador ou a si mesmo.');
    must(row('SELECT id FROM users WHERE id=?',target),404,'Conta não encontrada.');
    const b=await parse(req), reason=clean(b.reason,300);
    must(action==='unban'||reason.length>=10,400,'Explique o banimento.');
    if(action==='ban'){
      run("UPDATE users SET banned_at=datetime('now'),ban_reason=? WHERE id=?",reason,target);
      run('DELETE FROM sessions WHERE user_id=?',target);
      emitUser(target,'account_banned',{reason:'Conta suspensa pela moderação.'});
      const group=streams.get(target);if(group)for(const response of group)response.end();streams.delete(target);
    }else run("UPDATE users SET banned_at=NULL,ban_reason='' WHERE id=?",target);
    run('INSERT INTO platform_audit(id,admin_id,action,target_id,reason) VALUES(?,?,?,?,?)',id(),user.id,'account:'+action,target,reason);
    return json(res,200,{ok:true});
  }


  if (route === '/api/creator/claim' && method === 'POST') {
    const secret = process.env.CREATOR_SETUP_CODE || '';
    must(secret.length >= 10,403,'Código do criador não foi configurado no servidor. Use npm run grant-admin ou defina CREATOR_SETUP_CODE.');
    const b=await parse(req);
    must(String(b.code||'') === secret,403,'Código do criador inválido.');
    run('INSERT OR IGNORE INTO platform_admins(user_id) VALUES(?)',user.id);
    run('INSERT INTO platform_audit(id,admin_id,action,target_id,reason) VALUES(?,?,?,?,?)',id(),user.id,'creator:claim',user.id,'Conta definida como criador do app por código secreto');
    return json(res,200,{user:{...safeUser(user.id),isPlatformAdmin:true}});
  }

  if (route === '/api/creator/backup' && method === 'POST') {
    must(platformAdmin(user.id),403,'Acesso exclusivo do criador do app.');
    throttle('backup:'+user.id,5,3600000);
    return json(res,201,{backup:createBackupSnapshot(user.id),note:'Guarde a pasta do backup. Para trocar de hospedagem, copie o banco nexhub.sqlite e a pasta media.'});
  }
  if (route === '/api/creator/overview' && method === 'GET') {
    must(platformAdmin(user.id),403,'Acesso exclusivo do criador do app.');
    const counts = {
      users: row('SELECT COUNT(*) AS n FROM users').n,
      bannedUsers: row('SELECT COUNT(*) AS n FROM users WHERE banned_at IS NOT NULL').n,
      platformAdmins: row('SELECT COUNT(*) AS n FROM platform_admins').n,
      vipUsers: row("SELECT COUNT(*) AS n FROM users WHERE vip_until IS NOT NULL AND (vip_until='forever' OR datetime(vip_until)>datetime('now'))").n,
      servers: row('SELECT COUNT(*) AS n FROM servers').n,
      channels: row('SELECT COUNT(*) AS n FROM channels').n,
      messages: row('SELECT COUNT(*) AS n FROM messages').n,
      dms: row('SELECT COUNT(*) AS n FROM dms').n,
      reportsPending: row("SELECT COUNT(*) AS n FROM reports WHERE status='pending'").n,
      appealsPending: row("SELECT COUNT(*) AS n FROM ban_appeals WHERE status='pending'").n,
      recoveriesPending: row("SELECT COUNT(*) AS n FROM account_recovery_requests WHERE status='pending'").n,
      pushSubscriptions: row('SELECT COUNT(*) AS n FROM push_subscriptions').n,
      vipPaymentsPending: row("SELECT COUNT(*) AS n FROM vip_payments WHERE status='pending'").n,
      vipPaymentsPaid: row("SELECT COUNT(*) AS n FROM vip_payments WHERE status='paid'").n,
      vipRevenueBRL: Number(row("SELECT COALESCE(SUM(amount_cents),0) AS cents FROM vip_payments WHERE status='paid'").cents||0)/100,
      installedBots: row('SELECT COUNT(*) AS n FROM server_bots').n,
      securityEvents: row('SELECT COUNT(*) AS n FROM security_events').n,
      uploadsChecked: row('SELECT COUNT(*) AS n FROM upload_audit').n,
      boostedServers: row('SELECT COUNT(*) AS n FROM server_boosts').n,
      officialTitles: row('SELECT COUNT(*) AS n FROM user_titles').n,
      suspendedUsers: row("SELECT COUNT(*) AS n FROM users WHERE suspended_until IS NOT NULL AND suspended_until!='' AND datetime(suspended_until)>datetime('now')").n
    };
    const recentUsers = all("SELECT id,username,display_name AS displayName,avatar_url AS avatarUrl,banned_at AS bannedAt,created_at AS createdAt,vip_until AS vipUntil,vip_plan AS vipPlan FROM users ORDER BY created_at DESC LIMIT 8").map(u=>({...u,vipActive:isVipActive(u)}));
    const recentAudit = all(`SELECT a.id,a.action,a.target_id AS targetId,a.reason,a.created_at AS createdAt,u.username AS adminUsername
      FROM platform_audit a LEFT JOIN users u ON u.id=a.admin_id ORDER BY a.created_at DESC LIMIT 12`);
    const recentPayments = all(`SELECT p.id,p.user_id AS userId,u.username,u.display_name AS displayName,p.amount_cents AS amountCents,p.status,p.reference,p.created_at AS createdAt,p.expires_at AS expiresAt,p.paid_at AS paidAt,p.transaction_id AS transactionId
      FROM vip_payments p JOIN users u ON u.id=p.user_id ORDER BY p.created_at DESC LIMIT 8`).map(paymentView);
    return json(res,200,{counts,recentUsers,recentAudit,recentPayments,paymentSummary:creatorPaymentSummary(),security:platformSecuritySummary(),readiness:productionChecklist()});
  }
  if (route === '/api/creator/security-dashboard' && method === 'GET') {
    must(platformAdmin(user.id),403,'Acesso exclusivo do criador do app.');
    return json(res,200,{summary:platformSecuritySummary(),readiness:productionChecklist(),events:all('SELECT id,user_id AS userId,kind,detail,ip,created_at AS createdAt FROM security_events ORDER BY created_at DESC LIMIT 80'),uploads:all('SELECT id,user_id AS userId,kind,url,ext,bytes,sha256,verdict,ip,created_at AS createdAt FROM upload_audit ORDER BY created_at DESC LIMIT 40')});
  }
  if (route === '/api/creator/production-checklist' && method === 'GET') {
    must(platformAdmin(user.id),403,'Acesso exclusivo do criador do app.');
    return json(res,200,{items:productionChecklist(),version:'34.0.0',note:'Checklist para colocar NexHub com VIP/Pix/chamada em produção.'});
  }
  if (route === '/api/creator/payments' && method === 'GET') {
    must(platformAdmin(user.id),403,'Acesso exclusivo do criador do app.');
    expireVipPayments();
    const status=clean(url.searchParams.get('status'),20);
    const q=clean(url.searchParams.get('q'),50).toLowerCase();
    const where=[];const args=[];
    if(['pending','paid','expired','cancelled'].includes(status)){where.push('p.status=?');args.push(status);}
    if(q){where.push('(lower(u.username) LIKE ? OR lower(u.display_name) LIKE ? OR lower(p.reference) LIKE ?)');args.push('%'+q+'%','%'+q+'%','%'+q+'%');}
    const sql=`SELECT p.id,p.user_id AS userId,u.username,u.display_name AS displayName,p.amount_cents AS amountCents,p.status,p.reference,p.pix_key AS pixKey,p.pix_payload AS pixPayload,p.created_at AS createdAt,p.expires_at AS expiresAt,p.paid_at AS paidAt,p.transaction_id AS transactionId,p.raw_event AS rawEvent
      FROM vip_payments p JOIN users u ON u.id=p.user_id ${where.length?'WHERE '+where.join(' AND '):''} ORDER BY p.created_at DESC LIMIT 80`;
    const payments=all(sql,...args).map(p=>({...paymentView(p),userId:p.userId,username:p.username,displayName:p.displayName,rawEvent:p.rawEvent?JSON.parse(JSON.stringify(String(p.rawEvent).slice(0,500))):''}));
    const events=all("SELECT id,user_id AS userId,kind,detail,ip,created_at AS createdAt FROM security_events WHERE kind LIKE 'pix_%' OR kind LIKE 'vip_payment_%' ORDER BY created_at DESC LIMIT 80");
    return json(res,200,{summary:creatorPaymentSummary(),payments,events});
  }
  if ((match=route.match(/^\/api\/creator\/payments\/([^/]+)\/manual-confirm$/)) && method === 'POST') {
    must(platformAdmin(user.id),403,'Acesso exclusivo do criador do app.');
    const b=await parse(req);
    must(b.verified===true,400,'Confirme que você verificou o crédito no Nubank.');
    const payment=row('SELECT id,user_id AS userId,amount_cents AS amountCents,status,reference FROM vip_payments WHERE id=?',match[1]);
    must(payment,404,'Pagamento não encontrado.');
    must(['pending','expired'].includes(payment.status),409,'Este pedido não está pendente nem expirado.');
    must(Number(payment.amountCents)===500,400,'O valor deste pedido não corresponde a R$ 5,00.');
    const rawEvent=JSON.stringify({source:'manual_nubank',confirmedBy:user.id});
    const activated=activateVipFromPayment(payment,'',rawEvent,{source:'manual_nubank',actorId:user.id});
    if(!activated){
      const latest=row('SELECT status FROM vip_payments WHERE id=?',payment.id);
      if(latest?.status==='paid')return json(res,200,{ok:true,activated:false,alreadyPaid:true,paymentId:payment.id,status:'paid'});
      fail(409,'Não foi possível confirmar este pagamento.');
    }
    logSecurity(payment.userId,'vip_payment_manual_confirmed','Criador confirmou no Nubank · '+payment.reference,ip);
    return json(res,200,{ok:true,activated:true,paymentId:payment.id,reference:payment.reference,status:'paid',confirmationSource:'manual_nubank'});
  }
  if (route === '/api/creator/users' && method === 'GET') {
    must(platformAdmin(user.id),403,'Acesso exclusivo do criador do app.');
    const q = clean(url.searchParams.get('q'), 40).toLowerCase();
    const status = clean(url.searchParams.get('status'), 20);
    const limit = Math.min(100, Math.max(10, Number(url.searchParams.get('limit')||50)));
    const where = [];
    const args = [];
    if (q) { where.push('(lower(username) LIKE ? OR lower(email) LIKE ? OR lower(display_name) LIKE ?)'); args.push('%'+q+'%','%'+q+'%','%'+q+'%'); }
    if (status === 'banned') where.push('banned_at IS NOT NULL');
    if (status === 'active') where.push('banned_at IS NULL');
    const sql = `SELECT id,username,email,display_name AS displayName,avatar_url AS avatarUrl,bio,color,status,created_at AS createdAt,banned_at AS bannedAt,ban_reason AS banReason,
      vip_since AS vipSince,vip_until AS vipUntil,vip_plan AS vipPlan,vip_note AS vipNote,
      EXISTS(SELECT 1 FROM platform_admins p WHERE p.user_id=users.id) AS isPlatformAdmin,
      (SELECT COUNT(*) FROM servers s WHERE s.owner_id=users.id) AS serversOwned,
      (SELECT COUNT(*) FROM memberships m WHERE m.user_id=users.id) AS serversJoined,
      (SELECT COUNT(*) FROM messages msg WHERE msg.user_id=users.id) AS messageCount,
      (SELECT COUNT(*) FROM reports r WHERE r.target_user_id=users.id) AS reportsReceived
      FROM users ${where.length?'WHERE '+where.join(' AND '):''} ORDER BY created_at DESC LIMIT ?`;
    args.push(limit);
     return json(res,200,{users:all(sql,...args).map(u=>({...u,email:isPlaceholderEmail(u.email)?'':u.email,hasEmail:!isPlaceholderEmail(u.email),isPlatformAdmin:Boolean(u.isPlatformAdmin),banned:Boolean(u.bannedAt),vipActive:isVipActive(u),vipDaysLeft:vipDaysLeft(u)}))});
  }
  if ((match=route.match(/^\/api\/creator\/users\/([^/]+)$/)) && method === 'GET') {
    must(platformAdmin(user.id),403,'Acesso exclusivo do criador do app.');
    const target=match[1];
    const u=row(`SELECT id,username,email,display_name AS displayName,bio,color,status,avatar_url AS avatarUrl,banner_url AS bannerUrl,banner_type AS bannerType,profile_effect AS profileEffect,
      created_at AS createdAt,banned_at AS bannedAt,ban_reason AS banReason,twofa_enabled AS twofaEnabled,allow_dm AS allowDm,
      vip_since AS vipSince,vip_until AS vipUntil,vip_plan AS vipPlan,vip_note AS vipNote,
      EXISTS(SELECT 1 FROM platform_admins p WHERE p.user_id=users.id) AS isPlatformAdmin FROM users WHERE id=?`,target);
    must(u,404,'Conta não encontrada.');
    u.hasEmail=!isPlaceholderEmail(u.email);if(!u.hasEmail)u.email='';
    const stats={
      serversOwned: row('SELECT COUNT(*) AS n FROM servers WHERE owner_id=?',target).n,
      serversJoined: row('SELECT COUNT(*) AS n FROM memberships WHERE user_id=?',target).n,
      messages: row('SELECT COUNT(*) AS n FROM messages WHERE user_id=?',target).n,
      dmsSent: row('SELECT COUNT(*) AS n FROM dms WHERE from_id=?',target).n,
      reportsReceived: row('SELECT COUNT(*) AS n FROM reports WHERE target_user_id=?',target).n,
      reportsMade: row('SELECT COUNT(*) AS n FROM reports WHERE reporter_id=?',target).n
    };
    const servers=all('SELECT s.id,s.name,m.role,m.joined_at AS joinedAt FROM memberships m JOIN servers s ON s.id=m.server_id WHERE m.user_id=? ORDER BY m.joined_at DESC LIMIT 20',target);
    const reports=all(`SELECT id,reason,status,created_at AS createdAt,resolution FROM reports WHERE target_user_id=? ORDER BY created_at DESC LIMIT 20`,target);
    return json(res,200,{user:{...u,isPlatformAdmin:Boolean(u.isPlatformAdmin),twofaEnabled:Boolean(u.twofaEnabled),allowDm:Boolean(u.allowDm),banned:Boolean(u.bannedAt),vipActive:isVipActive(u),vipDaysLeft:vipDaysLeft(u),badges:badgeListForUser({...u,id:target})},stats,servers,reports,vip:vipViewForUser(u)});
  }
  if ((match=route.match(/^\/api\/creator\/users\/([^/]+)\/vip$/)) && method === 'POST') {
    must(platformAdmin(user.id),403,'Acesso exclusivo do criador do app.');
    const target=match[1];must(row('SELECT id FROM users WHERE id=?',target),404,'Conta não encontrada.');
    const b=await parse(req);const action=clean(b.action,20);
    must(['activate','remove'].includes(action),400,'Ação VIP inválida.');
    if(action==='remove'){
      run("UPDATE users SET vip_until=NULL,vip_plan='',vip_note='' WHERE id=?",target);
      run('INSERT INTO platform_audit(id,admin_id,action,target_id,reason) VALUES(?,?,?,?,?)',id(),user.id,'vip:remove',target,clean(b.note||'VIP removido pelo criador',300));
      notify(target,'Seu VIP NexHub foi removido pelo criador.','/app?tab=settings');
      emitUser(target,'profile',{});
      return json(res,200,{ok:true,user:safeUser(target)});
    }
    const days=Math.min(365,Math.max(1,Number(b.days||30)));
    const plan=clean(b.plan||'VIP R$5',40)||'VIP R$5';
    const note=clean(b.note||'Ativado manualmente pelo criador',300);
    const until=new Date(Date.now()+days*86400000).toISOString().slice(0,19).replace('T',' ');
    run("UPDATE users SET vip_since=COALESCE(vip_since,datetime('now')),vip_until=?,vip_plan=?,vip_note=? WHERE id=?",until,plan,note,target);
    run('INSERT INTO platform_audit(id,admin_id,action,target_id,reason) VALUES(?,?,?,?,?)',id(),user.id,'vip:activate',target,`${plan} por ${days} dias · ${note}`);
    notify(target,`💎 VIP NexHub ativado por ${days} dias!`,'/app?tab=settings');
    emitUser(target,'profile',{});
    return json(res,200,{ok:true,user:safeUser(target),vip:vipViewForUser(safeUser(target))});
  }

  if (route === '/api/mascot' && method === 'GET') return json(res,200,{mascot:hikariMascot()});

  // v35: ideias completas planejadas — perfil premium, loja, explorar, missões, status, NexBot e notificações.
  if (route === '/api/profile/premium' && method === 'GET') return json(res,200,premiumProfile(user.id));
  if ((match=route.match(/^\/api\/users\/([^/]+)\/premium$/)) && method === 'GET') return json(res,200,premiumProfile(match[1]));

  if (route === '/api/me/activity-status' && method === 'PATCH') {
    const b=await parse(req);const kind=safeActivityKind(b.kind||b.activityKind);const text=clean(b.text||b.activityText,80);
    run('UPDATE users SET activity_kind=?,activity_text=?,status=? WHERE id=?',kind,text,kind==='invisible'?'invisible':(kind==='busy'?'dnd':(kind==='away'?'idle':'online')),user.id);
    emitUser(user.id,'profile',{});
    return json(res,200,{ok:true,user:safeUser(user.id),allowed:activityKinds});
  }

  if (route === '/api/effects-shop' && method === 'GET') return json(res,200,{items:shopCatalogForUser(user),inventory:premiumProfile(user.id).inventory});
  if ((match=route.match(/^\/api\/effects-shop\/([^/]+)\/claim$/)) && method === 'POST') {
    const item=claimShopItem(user,match[1]);
    notify(user.id,`Item desbloqueado na loja: ${item.name}`,'/app?tab=shop');
    return json(res,200,{ok:true,item,inventory:premiumProfile(user.id).inventory});
  }
  if ((match=route.match(/^\/api\/effects-shop\/([^/]+)\/apply$/)) && method === 'POST') {
    const own=row('SELECT item_id AS itemId FROM user_effect_inventory WHERE user_id=? AND item_id=?',user.id,match[1]);must(own,404,'Você ainda não desbloqueou esse item.');
    run('UPDATE user_effect_inventory SET active=0 WHERE user_id=?',user.id);
    run('UPDATE user_effect_inventory SET active=1 WHERE user_id=? AND item_id=?',user.id,match[1]);
    const item=row('SELECT effect_key AS effectKey,category,name FROM app_shop_items WHERE id=?',match[1]);
    if(item?.category==='profile')run('UPDATE users SET profile_effect=? WHERE id=?',safeProfileEffect(item.effectKey)||'none',user.id);
    return json(res,200,{ok:true,active:item,inventory:premiumProfile(user.id).inventory});
  }

  if (route === '/api/daily-reward' && method === 'GET') {
    const today=new Date().toISOString().slice(0,10);
    const current=row('SELECT reward_date AS rewardDate,streak,reward,claimed_at AS claimedAt FROM daily_rewards WHERE user_id=? AND reward_date=?',user.id,today);
    return json(res,200,{today:current||null,history:all('SELECT reward_date AS rewardDate,streak,reward,claimed_at AS claimedAt FROM daily_rewards WHERE user_id=? ORDER BY reward_date DESC LIMIT 14',user.id)});
  }
  if (route === '/api/daily-reward/claim' && method === 'POST') return json(res,200,{ok:true,reward:dailyRewardFor(user.id)});

  if (route === '/api/weekly-events' && method === 'GET') {
    return json(res,200,{events:all(`SELECT id,title,description,category,reward,starts_at AS startsAt,ends_at AS endsAt,active FROM weekly_events WHERE active=1 ORDER BY starts_at DESC LIMIT 20`).map(e=>({...e,active:!!e.active})),mascot:hikariMascot()});
  }

  if (route === '/api/friends/enhanced' && method === 'GET') {
    const rows=all(`SELECT f.id,f.state,f.from_id AS fromId,f.to_id AS toId,u.id AS userId,u.username,u.display_name AS displayName,u.color,u.status,u.activity_kind AS activityKind,u.activity_text AS activityText,u.avatar_url AS avatarUrl,COALESCE(fs.favorite,0) AS favorite,COALESCE(fs.nickname,'') AS nickname
      FROM friends f JOIN users u ON u.id=(CASE WHEN f.from_id=? THEN f.to_id ELSE f.from_id END)
      LEFT JOIN friend_settings fs ON fs.user_id=? AND fs.friend_id=u.id
      WHERE (f.from_id=? OR f.to_id=?) AND f.state='accepted'
      ORDER BY favorite DESC,u.display_name COLLATE NOCASE`,user.id,user.id,user.id,user.id).map(x=>({...x,favorite:!!x.favorite,online:streams.has(x.userId)}));
    return json(res,200,{friends:rows,features:['melhores amigos','apelido local','bloquear usuário','favoritar conversa','amigos online','adicionar por ID']});
  }
  if ((match=route.match(/^\/api\/friends\/([^/]+)\/settings$/)) && method === 'PATCH') {
    const friendId=match[1];
    must(row("SELECT id FROM friends WHERE state='accepted' AND ((from_id=? AND to_id=?) OR (from_id=? AND to_id=?))",user.id,friendId,friendId,user.id),404,'Amigo não encontrado.');
    const b=await parse(req);const fav=Number(Boolean(b.favorite));const nick=clean(b.nickname,32);
    run(`INSERT INTO friend_settings(user_id,friend_id,favorite,nickname) VALUES(?,?,?,?)
      ON CONFLICT(user_id,friend_id) DO UPDATE SET favorite=excluded.favorite,nickname=excluded.nickname,updated_at=datetime('now')`,user.id,friendId,fav,nick);
    return json(res,200,{ok:true,friendId,favorite:!!fav,nickname:nick});
  }

  if (route === '/api/rankings' && method === 'GET') return json(res,200,globalRankings());
  if (route === '/api/explore' && method === 'GET') return json(res,200,{categories:exploreCategories,servers:exploreServers(url.searchParams.get('category')||''),serverBadges:['verified','partner','official','featured','safe']});
  if ((match=route.match(/^\/api\/servers\/([^/]+)\/explore-settings$/)) && method === 'PATCH') {
    const sid=match[1];owner(sid,user.id);const b=await parse(req);const category=safeCategory(b.category);const featured=Number(Boolean(b.featured));
    run('UPDATE servers SET category=?,featured=? WHERE id=?',category,featured,sid);
    return json(res,200,{ok:true,server:detail(sid,user.id)});
  }

  if (route === '/api/calls/features' && method === 'GET') return json(res,200,callFeaturePack());
  if (route === '/api/missions' && method === 'GET') return json(res,200,{missions:missionListFor(user.id),rules:'Missões dão recompensa visual, sem sistema de nível/XP.'});
  if ((match=route.match(/^\/api\/missions\/([^/]+)\/progress$/)) && method === 'POST') {
    const b=await parse(req);const progress=advanceMission(user.id,match[1],b.amount||1);must(progress,404,'Missão não encontrada.');return json(res,200,{ok:true,progress,missions:missionListFor(user.id)});
  }

  if (route === '/api/nexbot' && method === 'GET') return json(res,200,{bot:nexBotPack(),catalog:all("SELECT id,name,description,permissions FROM bot_catalog WHERE enabled=1 ORDER BY name").map(b=>({...b,permissions:JSON.parse(b.permissions||'[]')}))});
  if ((match=route.match(/^\/api\/servers\/([^/]+)\/nexbot\/action$/)) && method === 'POST') {
    const sid=match[1];requirePermission(sid,user.id,'manage_bots');const b=await parse(req);const action=clean(b.action,40)||'help';const message=clean(b.message||b.detail||'',300);
    must(['welcome','rules','ban-alert','vip-alert','ranking','help'].includes(action),400,'Ação do NexBot inválida.');
    const aid=id();run('INSERT INTO nexbot_actions(id,server_id,actor_id,action,message) VALUES(?,?,?,?,?)',aid,sid,user.id,action,message);
    log(sid,user.id,'nexbot:'+action,aid,message);return json(res,200,{ok:true,nexbot:nexBotPack(),action:{id:aid,action,message}});
  }

  if (route === '/api/notifications/center' && method === 'GET') {
    const notifications=all('SELECT id,text,href,read,created_at AS createdAt FROM notifications WHERE user_id=? ORDER BY created_at DESC LIMIT 120',user.id);
    const announcements=all("SELECT id,title,message,audience,created_at AS createdAt FROM app_announcements WHERE audience IN ('all','users') ORDER BY created_at DESC LIMIT 20");
    return json(res,200,{notifications,announcements,unread:notifications.filter(n=>!n.read).length});
  }

  if (route === '/api/reports/center' && method === 'GET') {
    return json(res,200,{mine:all(`SELECT r.id,r.reason,r.status,r.resolution,r.created_at AS createdAt,u.username AS targetUsername FROM reports r JOIN users u ON u.id=r.target_user_id WHERE r.reporter_id=? ORDER BY r.created_at DESC LIMIT 50`,user.id),canReport:['usuário','mensagem','servidor','bot','perfil falso','spam','golpe']});
  }

  if (route === '/api/creator/servers' && method === 'GET') {
    must(platformAdmin(user.id),403,'Acesso exclusivo do criador do app.');
    return json(res,200,{servers:all(`SELECT s.id,s.name,s.category,s.verified_badge AS verifiedBadge,s.featured,s.safe_community AS safeCommunity,u.username AS ownerUsername,
      COUNT(m.user_id) AS members,(SELECT COUNT(*) FROM reports r WHERE r.server_id=s.id) AS reports
      FROM servers s JOIN users u ON u.id=s.owner_id LEFT JOIN memberships m ON m.server_id=s.id GROUP BY s.id ORDER BY s.created_at DESC LIMIT 200`).map(s=>({...s,featured:!!s.featured,safeCommunity:!!s.safeCommunity}))});
  }
  if ((match=route.match(/^\/api\/creator\/servers\/([^/]+)\/verify$/)) && method === 'PATCH') {
    must(platformAdmin(user.id),403,'Acesso exclusivo do criador do app.');const sid=match[1];const b=await parse(req);const badge=clean(b.badge||'verified',30);must(['verified','partner','official','featured','safe'].includes(badge),400,'Selo de servidor inválido.');
    const reason=clean(b.reason||'Selo aplicado pelo criador',300);must(row('SELECT id FROM servers WHERE id=?',sid),404,'Servidor não encontrado.');
    run('UPDATE servers SET verified_badge=?,featured=?,safe_community=? WHERE id=?',badge,badge==='featured'?1:0,badge==='safe'?1:0,sid);
    run(`INSERT INTO server_verifications(server_id,badge,assigned_by,reason) VALUES(?,?,?,?) ON CONFLICT(server_id) DO UPDATE SET badge=excluded.badge,assigned_by=excluded.assigned_by,reason=excluded.reason,created_at=datetime('now')`,sid,badge,user.id,reason);
    run('INSERT INTO platform_audit(id,admin_id,action,target_id,reason) VALUES(?,?,?,?,?)',id(),user.id,'server:verify',sid,`${badge} · ${reason}`);
    return json(res,200,{ok:true,server:row('SELECT id,name,verified_badge AS verifiedBadge,featured,safe_community AS safeCommunity FROM servers WHERE id=?',sid)});
  }
  if (route === '/api/creator/announcements' && method === 'POST') {
    must(platformAdmin(user.id),403,'Acesso exclusivo do criador do app.');const b=await parse(req);const title=clean(b.title,80);const message=clean(b.message,500);must(title.length>=3&&message.length>=5,400,'Informe título e mensagem.');
    const audience=['all','users','vip','admins'].includes(b.audience)?b.audience:'all';const aid=id();run('INSERT INTO app_announcements(id,title,message,audience,created_by) VALUES(?,?,?,?,?)',aid,title,message,audience,user.id);
    if(audience==='all'||audience==='users')for(const r of all('SELECT id FROM users LIMIT 500'))notify(r.id,title,'/app?tab=notifications');
    return json(res,201,{ok:true,announcement:{id:aid,title,message,audience}});
  }

  if (route === '/api/creator/roadmap' && method === 'GET') {
    must(platformAdmin(user.id),403,'Acesso exclusivo do criador do app.');
    return json(res,200,{items:all('SELECT id,title,category,status,priority,note,created_at AS createdAt FROM app_roadmap_items ORDER BY priority,id'),mascot:hikariMascot(),titles:officialTitleCatalog});
  }

  if (route === '/api/creator/titles/catalog' && method === 'GET') {
    must(platformAdmin(user.id),403,'Acesso exclusivo do criador do app.');
    return json(res,200,{titles:officialTitleCatalog,rules:{emojiBadges:false,adminOnly:true,visibleOn:['perfil','chat','lista de membros','call','explorar']}});
  }

  if (route === '/api/creator/titles' && method === 'GET') {
    must(platformAdmin(user.id),403,'Acesso exclusivo do criador do app.');
    return json(res,200,{titles:all(`SELECT t.user_id AS userId,u.username,u.display_name AS displayName,u.avatar_url AS avatarUrl,t.title_id AS titleId,t.reason,t.expires_at AS expiresAt,t.created_at AS createdAt
      FROM user_titles t JOIN users u ON u.id=t.user_id
      WHERE t.expires_at IS NULL OR t.expires_at='forever' OR datetime(t.expires_at)>datetime('now')
      ORDER BY t.created_at DESC LIMIT 200`).map(t=>({...t,title:officialTitleMap.get(t.titleId)||{id:t.titleId,label:t.titleId,tone:'default'}}))});
  }

  if (route === '/api/creator/titles' && method === 'POST') {
    must(platformAdmin(user.id),403,'Acesso exclusivo do criador do app.');
    const b=await parse(req);const target=resolveUserLogin(b.username||b.login||b.user||b.target);
    const titleId=safeTitleId(b.titleId||b.title);
    must(titleId,400,'Título inválido. Use um título do catálogo oficial.');
    const reason=clean(b.reason||'Título oficial aplicado pelo criador',300);
    const expires=titleExpiryFromDays(b.durationDays||b.days||'forever');
    run(`INSERT INTO user_titles(user_id,title_id,assigned_by,reason,expires_at) VALUES(?,?,?,?,?)
      ON CONFLICT(user_id,title_id) DO UPDATE SET assigned_by=excluded.assigned_by,reason=excluded.reason,expires_at=excluded.expires_at,created_at=datetime('now')`,target.id,titleId,user.id,reason,expires);
    run('INSERT INTO platform_audit(id,admin_id,action,target_id,reason) VALUES(?,?,?,?,?)',id(),user.id,'title:grant',target.id,`${titleId} · ${reason}`);
    notify(target.id,`Você recebeu o título ${officialTitleMap.get(titleId).label} no NexHub.`,'/app?tab=settings');
    emitUser(target.id,'profile',{});
    return json(res,200,{ok:true,target:safeUser(target.id),title:officialTitleMap.get(titleId),expiresAt:expires});
  }

  if ((match=route.match(/^\/api\/creator\/titles\/([^/]+)\/([a-z0-9_]+)$/)) && method === 'DELETE') {
    must(platformAdmin(user.id),403,'Acesso exclusivo do criador do app.');
    const target=match[1],titleId=safeTitleId(match[2]);must(titleId,400,'Título inválido.');
    run('DELETE FROM user_titles WHERE user_id=? AND title_id=?',target,titleId);
    run('INSERT INTO platform_audit(id,admin_id,action,target_id,reason) VALUES(?,?,?,?,?)',id(),user.id,'title:remove',target,titleId);
    emitUser(target,'profile',{});
    return json(res,200,{ok:true});
  }

  if (route === '/api/creator/vip/quick' && method === 'POST') {
    must(platformAdmin(user.id),403,'Acesso exclusivo do criador do app.');
    const b=await parse(req);const target=resolveUserLogin(b.username||b.login||b.user);
    must(target.id!==user.id || platformAdmin(user.id),403,'Ação inválida.');
    const duration=String(b.duration||b.days||30).toLowerCase();
    const note=clean(b.note||'VIP enviado pelo painel admin',300);
    let until, daysLabel;
    if(duration==='forever'||duration==='infinito'){until='forever';daysLabel='infinito';}
    else {const days=[3,10,30].includes(Number(duration))?Number(duration):Math.min(3650,Math.max(1,Number(duration||30)));until=new Date(Date.now()+days*86400000).toISOString().slice(0,19).replace('T',' ');daysLabel=days+' dias';}
    run("UPDATE users SET vip_since=COALESCE(vip_since,datetime('now')),vip_until=?,vip_plan=?,vip_note=? WHERE id=?",until,'VIP manual · '+daysLabel,note,target.id);
    run(`INSERT INTO user_titles(user_id,title_id,assigned_by,reason,expires_at) VALUES(?,?,?,?,?)
      ON CONFLICT(user_id,title_id) DO UPDATE SET assigned_by=excluded.assigned_by,reason=excluded.reason,expires_at=excluded.expires_at,created_at=datetime('now')`,target.id,'vip',user.id,'VIP ativo',until);
    run('INSERT INTO platform_audit(id,admin_id,action,target_id,reason) VALUES(?,?,?,?,?)',id(),user.id,'vip:quick-grant',target.id,`${daysLabel} · ${note}`);
    notify(target.id,`VIP NexHub enviado para sua conta por ${daysLabel}.`,'/app?tab=settings');
    emitUser(target.id,'profile',{});
    return json(res,200,{ok:true,user:safeUser(target.id),duration:daysLabel});
  }

  if (route === '/api/creator/users/action-by-name' && method === 'POST') {
    must(platformAdmin(user.id),403,'Acesso exclusivo do criador do app.');
    const b=await parse(req);const target=resolveUserLogin(b.username||b.login||b.user);
    const action=clean(b.action,30);const reason=clean(b.reason||'',300);
    must(target.id!==user.id,403,'Você não pode aplicar punição em si mesmo.');
    must(!platformAdmin(target.id) || action==='info',403,'Não é permitido punir outro administrador pelo painel rápido.');
    must(['ban','unban','suspend','unsuspend'].includes(action),400,'Ação inválida.');
    if(action==='ban'){
      must(reason.length>=5,400,'Informe o motivo do banimento.');
      run("UPDATE users SET banned_at=datetime('now'),ban_reason=? WHERE id=?",reason,target.id);
      run('DELETE FROM sessions WHERE user_id=?',target.id);
      emitUser(target.id,'account_banned',{reason});
      const group=streams.get(target.id);if(group)for(const response of group)response.end();streams.delete(target.id);
    } else if(action==='unban') run("UPDATE users SET banned_at=NULL,ban_reason='' WHERE id=?",target.id);
    else if(action==='suspend'){
      const days=Math.min(3650,Math.max(1,Number(b.days||1)));must(reason.length>=5,400,'Informe o motivo da suspensão.');
      const until=new Date(Date.now()+days*86400000).toISOString().slice(0,19).replace('T',' ');
      run("UPDATE users SET suspended_until=?,suspension_reason=?,suspended_by=? WHERE id=?",until,reason,user.id,target.id);
      run('DELETE FROM sessions WHERE user_id=?',target.id);
      emitUser(target.id,'account_suspended',{reason,until});
      const group=streams.get(target.id);if(group)for(const response of group)response.end();streams.delete(target.id);
    } else run("UPDATE users SET suspended_until=NULL,suspension_reason='',suspended_by='' WHERE id=?",target.id);
    run('INSERT INTO platform_audit(id,admin_id,action,target_id,reason) VALUES(?,?,?,?,?)',id(),user.id,'account:'+action,target.id,reason||'sem motivo');
    return json(res,200,{ok:true,action,target:safeUser(target.id)});
  }

  if (route === '/api/creator/punishments' && method === 'GET') {
    must(platformAdmin(user.id),403,'Acesso exclusivo do criador do app.');
    return json(res,200,{users:publicPunishmentRows()});
  }

  if (route === '/api/creator/audit' && method === 'GET') {
    must(platformAdmin(user.id),403,'Acesso exclusivo do criador do app.');
    return json(res,200,{entries:all(`SELECT a.id,a.admin_id AS adminId,u.username AS adminUsername,a.action,a.target_id AS targetId,a.reason,a.created_at AS createdAt
      FROM platform_audit a LEFT JOIN users u ON u.id=a.admin_id ORDER BY a.created_at DESC LIMIT 120`)});
  }

  if (route === '/api/search/users' && method === 'GET') {
    const q = clean(url.searchParams.get('q'), 24);
    if (q.length < 2) return json(res, 200, { users: [] });
    return json(res, 200, { users: all('SELECT id,username,display_name AS displayName,color,avatar_url AS avatarUrl FROM users WHERE (username LIKE ? OR display_name LIKE ?) AND id!=? LIMIT 12', `%${q.replace(/[%_]/g, '')}%`, `%${q.replace(/[%_]/g, '')}%`, user.id) });
  }
  if (route === '/api/friends' && method === 'GET') {
    const rows = all(`SELECT f.id,f.state,f.from_id AS fromId,f.to_id AS toId, u.id AS userId,u.username,u.display_name AS displayName,u.color,u.status,u.avatar_url AS avatarUrl
      FROM friends f JOIN users u ON u.id=(CASE WHEN f.from_id=? THEN f.to_id ELSE f.from_id END)
      WHERE f.from_id=? OR f.to_id=? ORDER BY f.created_at DESC`, user.id, user.id, user.id);
    return json(res, 200, { friends: rows.filter(f => f.state === 'accepted'), incoming: rows.filter(f => f.state === 'pending' && f.toId === user.id), outgoing: rows.filter(f => f.state === 'pending' && f.fromId === user.id) });
  }
  if (route === '/api/friends/request' && method === 'POST') {
    throttle('friends:' + user.id, 10, 3600000); const b = await parse(req);
    const target = row('SELECT id,username FROM users WHERE username=?', clean(b.username, 24));
    must(target && target.id !== user.id, 404, 'Usuário não encontrado.');
    must(!row('SELECT id FROM friends WHERE (from_id=? AND to_id=?) OR (from_id=? AND to_id=?)', user.id, target.id, target.id, user.id), 409, 'Já existe uma amizade ou solicitação.');
    run('INSERT INTO friends(id,from_id,to_id) VALUES(?,?,?)', id(), user.id, target.id);
    notify(target.id, `${user.displayName} enviou uma solicitação de amizade`, '/app?tab=friends');
    emitUser(target.id, 'friends', {});
    return json(res, 201, { ok: true });
  }
  if ((match = route.match(/^\/api\/friends\/([^/]+)\/(accept|decline|remove)$/)) && method === 'POST') {
    const f = row('SELECT * FROM friends WHERE id=? AND (from_id=? OR to_id=?)', match[1], user.id, user.id);
    must(f, 404, 'Solicitação inexistente.');
    if (match[2] === 'accept') {
      must(f.state === 'pending' && f.to_id === user.id, 403, 'Você não pode aceitar esta solicitação.');
      run("UPDATE friends SET state='accepted' WHERE id=?", f.id);
      notify(f.from_id, `${user.displayName} aceitou sua amizade`, '/app?tab=friends');
    } else if (match[2] === 'decline') {
      must(f.state === 'pending' && f.to_id === user.id, 403, 'Não é sua solicitação.');
      run('DELETE FROM friends WHERE id=?', f.id);
    } else run('DELETE FROM friends WHERE id=?', f.id);
    emitUser(f.from_id, 'friends', {}); emitUser(f.to_id, 'friends', {});
    return json(res, 200, { ok: true });
  }
  if ((match = route.match(/^\/api\/calls\/([a-f0-9-]{36})\/signals$/)) && method === 'GET') {
    const c = calls.get(match[1]); must(c, 404, 'Chamada encerrada.');
    must(c.from === user.id || c.to === user.id, 403, 'Esta chamada não pertence a você.');
    const after = Number(url.searchParams.get('after') || 0);
    must(Number.isSafeInteger(after) && after >= 0, 400, 'Sequência inválida.');
    return json(res, 200, { signals: (c.signals || []).filter(s => s.seq > after && s.from !== user.id),
      latestSeq: c.signalSeq || 0, status: c.status });
  }
  if (route === '/api/calls/active' && method === 'GET') {
    const c=activeCall(user.id);return json(res,200,{call:c?callView(c,user.id):null});
  }
  if (route === '/api/calls' && method === 'POST') {
    throttle('call:'+user.id,12,600000);
    const b=await parse(req); const target=userPublic(String(b.to||''));
    must(target && target.id!==user.id,404,'Contato não encontrado.');
    must(!row('SELECT 1 FROM user_blocks WHERE (blocker_id=? AND blocked_id=?) OR (blocker_id=? AND blocked_id=?)',user.id,target.id,target.id,user.id),403,'Chamada indisponível: contato bloqueado.');
    const allow=row('SELECT allow_dm AS dm FROM users WHERE id=?',target.id);
    must(allow.dm || twoFriends(user.id,target.id),403,'Este contato não permite chamadas de desconhecidos.');
    must(!activeCall(user.id) && !activeCall(target.id),409,'Uma das pessoas já está em chamada.');
    must(streams.has(target.id),409,'Pessoa desconectada. Tente quando estiver online.');
    must(['audio','video'].includes(b.mode),400,'Modo de chamada inválido.');
    const c={id:id(),from:user.id,to:target.id,mode:b.mode,status:'ringing',createdAt:now(),signalSeq:0,signals:[]};
    calls.set(c.id,c);
    c.timeout=setTimeout(()=>endCall(c,'missed'),45000);c.timeout.unref?.();
    emitUser(target.id,'call',{action:'incoming',call:callView(c,target.id)});
    emitUser(user.id,'call',{action:'outgoing',call:callView(c,user.id)});
    return json(res,201,{call:callView(c,user.id)});
  }
  let callMatch=route.match(/^\/api\/calls\/([a-f0-9-]{36})\/(accept|reject|end|signal)$/);
  if(callMatch && method==='POST') {
    const c=calls.get(callMatch[1]);must(c,404,'Chamada encerrada.');
    must(user.id===c.from||user.id===c.to,403,'Esta chamada não pertence a você.');
    const action=callMatch[2];
    if(action==='reject'||action==='end') {endCall(c,action==='reject'?'rejected':'ended',user.id);return json(res,200,{ok:true});}
    if(action==='accept') {
      must(c.to===user.id,403,'Apenas quem recebe pode atender.');
      must(c.status==='ringing',409,'Chamada já atendida.');
      c.status='connected';clearTimeout(c.timeout);
      c.timeout=setTimeout(()=>endCall(c,'timeout'),90*60000);c.timeout.unref?.();
      emitUser(c.from,'call',{action:'accepted',callId:c.id});
      emitUser(c.to,'call',{action:'accepted',callId:c.id});
      return json(res,200,{call:callView(c,user.id)});
    }
    must(c.status==='connected',409,'Atenda antes de transmitir o sinal.');
    throttle('signal:'+user.id,150,60000);
    const b=await parse(req);
    must(['offer','answer','ice'].includes(b.type),400,'Sinal inválido.');
    must(b.payload&&typeof b.payload==='object'&&!Array.isArray(b.payload),400,'Sinal inválido.');
    must(JSON.stringify(b.payload).length<=12000,413,'Sinal muito grande.');
    // Buffer efêmero durante a chamada; permite recuperar SDP/ICE após queda do SSE.
    const sig={seq:++c.signalSeq,from:user.id,type:b.type,payload:b.payload};
    c.signals.push(sig);
    if(c.signals.length>400)c.signals.shift();
    emitUser(user.id===c.from?c.to:c.from,'call',{action:'signal',callId:c.id,...sig});
    return json(res,200,{ok:true,seq:sig.seq});
  }
  if (route === '/api/dms' && method === 'GET') return json(res, 200, { contacts: getDmUsers(user.id) });
  if ((match = route.match(/^\/api\/dms\/([^/]+)\/messages(?:\/voice-message)?$/))) {
    const target = row('SELECT id,username,display_name AS displayName,allow_dm AS allowDm,color,avatar_url AS avatarUrl,banner_url AS bannerUrl,banner_type AS bannerType,bio FROM users WHERE id=?', match[1]);
    must(target && target.id !== user.id, 404, 'Contato não encontrado.');
    if (method === 'GET') { markDmRead(user.id,target.id); return json(res, 200, { contact: target, messages: dmMessagesByRows(all(`SELECT d.id,d.from_id AS fromId,d.to_id AS toId,d.content,d.created_at AS createdAt
      FROM (SELECT * FROM dms WHERE (from_id=? AND to_id=?) OR (from_id=? AND to_id=?) ORDER BY created_at DESC,id DESC LIMIT 80) d ORDER BY d.created_at,d.id`, user.id, target.id, target.id, user.id)) }); }
    if (method === 'POST' && route.endsWith('/voice-message')) {
      must(!row('SELECT 1 FROM user_blocks WHERE (blocker_id=? AND blocked_id=?) OR (blocker_id=? AND blocked_id=?)',user.id,target.id,target.id,user.id),403,'Não é possível enviar PV: usuário bloqueado.');
      must(target.allowDm || twoFriends(user.id, target.id), 403, 'Este usuário não recebe DMs de desconhecidos.');
      throttle('dm-voice:' + user.id, 8, 60000);
      const upload = await readUpload(req,'sound');auditUpload(user.id,'sound',upload,ip);
      const mid = messageId();
      run('INSERT INTO dms(id,from_id,to_id,content) VALUES(?,?,?,?)', mid, user.id, target.id, `[[voice:${upload.url}]]`);
      notify(target.id, `Nova mensagem de voz de ${user.displayName}`, `/app?dm=${user.id}`);
      emitUser(target.id, 'dm', { fromId: user.id }); emitUser(user.id, 'dm', { fromId: target.id });
      return json(res, 201, { ok: true, id: mid, voice: { url: upload.url } });
    }
    if (method === 'POST') {
      must(!row('SELECT 1 FROM user_blocks WHERE (blocker_id=? AND blocked_id=?) OR (blocker_id=? AND blocked_id=?)',user.id,target.id,target.id,user.id),403,'Não é possível enviar PV: usuário bloqueado.');
      must(target.allowDm || twoFriends(user.id, target.id), 403, 'Este usuário não recebe DMs de desconhecidos.');
      throttle('dm:' + user.id, 15, 10000);
      const b = await parse(req); const content = clean(b.content, 2000); must(content, 400, 'Mensagem vazia.');
      const repeated=row('SELECT created_at FROM dms WHERE from_id=? AND to_id=? AND content=? ORDER BY created_at DESC LIMIT 1',user.id,target.id,content);
      if(repeated){const t=Date.parse(repeated.created_at.replace(' ','T')+'Z');must(now()-t>15000,429,'Evite enviar a mesma mensagem repetida no PV.');}
      const mid = messageId(); run('INSERT INTO dms(id,from_id,to_id,content) VALUES(?,?,?,?)', mid, user.id, target.id, content);
      notify(target.id, `Nova DM de ${user.displayName}`, `/app?dm=${user.id}`);
      emitUser(target.id, 'dm', { fromId: user.id }); emitUser(user.id, 'dm', { fromId: target.id });
      return json(res, 201, { ok: true, id: mid });
    }
  }
  if (route === '/api/notifications' && method === 'GET') return json(res, 200, { notifications: all('SELECT id,text,href,read,created_at AS createdAt FROM notifications WHERE user_id=? ORDER BY created_at DESC LIMIT 80', user.id), unread: row('SELECT COUNT(*) AS n FROM notifications WHERE user_id=? AND read=0',user.id).n });
  if (route === '/api/notifications/read' && method === 'POST') {
    run('UPDATE notifications SET read=1 WHERE user_id=?', user.id); return json(res, 200, { ok: true });
  }
  if ((match=route.match(/^\/api\/notifications\/([^/]+)$/)) && ['PATCH','DELETE'].includes(method)) {
    const note=row('SELECT id FROM notifications WHERE id=? AND user_id=?',match[1],user.id);must(note,404,'Notificação não encontrada.');
    if(method==='DELETE')run('DELETE FROM notifications WHERE id=? AND user_id=?',match[1],user.id);
    else run('UPDATE notifications SET read=1 WHERE id=? AND user_id=?',match[1],user.id);
    return json(res,200,{ok:true});
  }
  if (route === '/api/typing' && method === 'POST') {
    throttle('typing:' + user.id, 12, 10000); const b = await parse(req); const c = channelMember(String(b.channelId || ''), user.id);
    emitServer(c.server_id, 'typing', { channelId: c.id, userId: user.id, name: user.displayName });
    return json(res, 200, { ok: true });
  }
  fail(404, 'Recurso não encontrado.');
}
const mime = { '.html':'text/html', '.css':'text/css', '.js':'text/javascript', '.json':'application/json', '.svg':'image/svg+xml', '.png':'image/png', '.ico':'image/x-icon', '.webmanifest':'application/manifest+json' };
function assets(req, res, pathname) {
  let path = pathname;
  if (path === '/' || path === '/app' || path.startsWith('/invite/')) path = '/index.html';
  try { path = decodeURIComponent(path); } catch { fail(400, 'Caminho inválido.'); }
  const target = resolve(webRoot, '.' + path);
  must(target === webRoot || target.startsWith(webRoot + sep), 403);
  const info = statSync(target); must(info.isFile(), 404, 'Página não encontrada.');
  const type = mime[extname(target)] || 'application/octet-stream';
  res.writeHead(200, { 'content-type': type + (type.startsWith('text/') || type === 'application/json' ? '; charset=utf-8' : ''), 'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY', 'referrer-policy': 'same-origin', 'content-security-policy': "default-src 'self'; connect-src 'self'; img-src 'self' data:; media-src 'self' blob:; script-src 'self'; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'", 'cache-control': 'no-cache' });
  res.end(readFileSync(target));
}
export function createApp() {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      if (req.method==='GET' && url.pathname === '/media') json(res,200,{ok:true});
      else if (req.method==='GET' && url.pathname.startsWith('/media/')) { if(!serveMedia(req,res,url.pathname))fail(404,'Arquivo não encontrado.'); }
      else if (req.method==='GET' && url.pathname === '/nexhub-api') {
        const healthUrl = new URL(url);
        healthUrl.pathname = '/api/health';
        await api(req, res, healthUrl);
      }
      else if (url.pathname.startsWith('/nexhub-api/')) {
        const apiUrl = new URL(url);
        apiUrl.pathname = '/api' + url.pathname.slice('/nexhub-api'.length);
        await api(req, res, apiUrl);
      }
      else if (url.pathname.startsWith('/api/')) await api(req, res, url);
      else if (req.method === 'GET') assets(req, res, url.pathname);
      else fail(405, 'Método indisponível.');
    } catch (e) {
      if (res.headersSent) { try { res.end(); } catch {} return; }
      // A API nunca envia stack trace ou SQL aos clientes.
      const status = e.status || 500;
      if (status === 500) console.error('[SERVER]', e);
      json(res, status, { error: status === 500 ? 'Falha interna. Confira os logs.' : e.message });
    }
  });
}
if (process.env.NODE_ENV !== 'test') {
  const host = process.env.HOST || '0.0.0.0'; const port = Number(process.env.PORT || '3000');
  createApp().listen(port, host, () => console.log(`Nexo pronto em http://${host}:${port}`));
}
