const root = document.getElementById('app');
const toastRoot = document.getElementById('toast');
const modalRoot = document.getElementById('modal-root');
const callRoot = document.getElementById('call-root');
let C = null;
let G = null;
let callAudioSink=null;
let callAudioContext=null;
let callAudioUnlockToken=false;
let callAudioSelectedInput=localStorage.getItem('nexhub.audioInput')||'';
let callAudioSelectedOutput=localStorage.getItem('nexhub.audioOutput')||'';
let turnDiagnostics=null;
let callLocalAudioMeter=null;
let callRemoteAudioMeter=null;
let activeVoiceRecorder=null;
let vipPaymentPoll=null;
let callEventQueue = Promise.resolve();
let voiceEventQueue = Promise.resolve();
let callSyncTimer = null;
let installPrompt = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installPrompt = e; });
function newCallState(view,role){return {id:view.id,peer:view.peer,mode:view.mode,role,status:view.status,pc:null,local:null,remote:null,ice:[],lastSeq:0,offerSent:false,restarts:0,muted:false,cameraOff:false,turnEnabled:false,turnStatus:null,needsPlayback:false,audioUnlocked:false,audioDiagnostics:{local:false,remote:false,playing:false,error:'',localLevel:0,remoteLevel:0,input:'',output:''},lastError:'',connectionState:'new',screenSharing:false,screenTrack:null};}
function queueCallEvent(event){callEventQueue=callEventQueue.then(()=>handleCallEvent(event)).catch(e=>toast(e.message||"Erro ao processar chamada.",true));return callEventQueue;}
const S = { me:null, servers:[], server:null, channelId:null, page:'chat', creator:null, messages:[], hasMore:false, friends:null, contacts:[], notifications:[], dmUser:null, dmMessages:[], drawer:false, membersOpen:false, reply:null, eventSource:null, typingTimeout:0, pendingInvite:null, mobilePane:'list', collapsedCategories:{}, channelFilter:'' };
const $ = s => document.querySelector(s);
const make = (tag, attrs = {}, ...children) => {
  const n = document.createElement(tag);
  for (const [k,v] of Object.entries(attrs || {})) {
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v ?? '';
    else if (k === 'style') n.setAttribute('style', v);
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'value') n.value = v;
    else if (k === 'checked') n.checked = v;
    else if (v !== null && v !== undefined && v !== false) n.setAttribute(k, v === true ? '' : String(v));
  }
  const add = item => { if (item === null || item === undefined || item === false) return; if (Array.isArray(item)) { item.forEach(add); return; } n.append(item instanceof Node ? item : document.createTextNode(String(item))); };
  children.forEach(add); return n;
};
const div=(c,...x)=>make('div',{class:c},...x);
const btn=(text, onClick, cls='btn secondary')=>make('button',{type:'button',class:cls,onClick},text);
const label=(text, control)=>make('label',{class:'field'},make('span',{text}),control);
const input=(placeholder='',value='',type='text')=>make('input',{type,placeholder,value});
const short = text => text?.length>90 ? text.slice(0,87)+'…' : text;
const unreadBadge = n => Number(n||0)>0 ? make('span',{class:'unread-badge',text:String(Math.min(99,Number(n)))}) : null;
const isVipUser=u=>!!(u?.vipActive || (u?.vipUntil && (u.vipUntil==='forever' || Date.parse(String(u.vipUntil).replace(' ','T')+'Z')>Date.now())) || (u?.badges||[]).some(b=>b.id==='vip'));
const vipDaysText=u=>isVipUser(u)?(Number(u?.vipDaysLeft||0)>365?'ativo':(Number(u?.vipDaysLeft||0)||'')+' dia(s) restantes'):'inativo';
const vipBenefits=[
  ['💎','Badge VIP no perfil'],['✨','Nome com brilho e estilo seguro'],['🎬','Vídeo/animação no perfil'],['🚀','2 impulsos de servidor'],['🤖','Bot com foto/banner/nome personalizado'],['🎙️','Mensagem de voz premium'],['🖥️','Compartilhamento de tela em call'],['🛡️','VIP validado no servidor contra APK hackeado']
];
const avatar=(name,color='#7be0cf',size='',url='')=>{
  const node=make('span',{class:'avatar '+size,style:`background:${/^#[0-9a-f]{6}$/i.test(color) ? color : '#7be0cf'}`});
  if(url?.startsWith('/media/')) node.append(make('img',{src:url,alt:'Foto de '+name,loading:'lazy'}));
  else node.textContent=(name||'?').slice(0,2).toUpperCase();
  return node;
};
const strokes={
 'message-circle':'<path d="M20 11.5a8.5 8.5 0 0 1-8.5 8.5 9 9 0 0 1-4.3-1.1L3 20l1.2-4.2A8.5 8.5 0 1 1 20 11.5Z"/>',
 'users':'<path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><path d="M20 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/>',
 'plus':'<path d="M12 5v14M5 12h14"/>','search':'<circle cx="11" cy="11" r="7"/><path d="m16 16 5 5"/>',
 'bell':'<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/>',
 'settings':'<circle cx="12" cy="12" r="3"/><path d="M19.4 15a2 2 0 0 0 .4 2.2l-2.6 2.6a2 2 0 0 0-2.2-.4l-.9 1.9h-4.2L9 19.4a2 2 0 0 0-2.2.4l-2.6-2.6a2 2 0 0 0 .4-2.2L2.7 14v-4L4.6 9a2 2 0 0 0-.4-2.2l2.6-2.6a2 2 0 0 0 2.2.4L10 2.7h4l1 1.9a2 2 0 0 0 2.2-.4l2.6 2.6a2 2 0 0 0-.4 2.2l1.9 1v4z"/>',
 'hourglass':'<path d="M5 3h14M5 21h14M7 3c0 4 1 5 5 9-4 4-5 5-5 9M17 3c0 4-1 5-5 9 4 4 5 5 5 9"/>',
 'user-plus':'<path d="M14 21v-2a4 4 0 0 0-4-4H4a4 4 0 0 0-4 4v2"/><circle cx="7" cy="7" r="4"/><path d="M20 8v6m-3-3h6"/>',
 'phone':'<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19 19 0 0 1-17.7-17.7A2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 2.1.8 3a2 2 0 0 1-.4 2.1L8.1 10a16 16 0 0 0 5.9 5.9l1.3-1.4a2 2 0 0 1 2.1-.4c.9.4 2 .7 3 .8A2 2 0 0 1 22 16.9z"/>',
 'phone-off':'<path d="m3 3 18 18M8.6 8.6 8.1 10a16 16 0 0 0 5.9 5.9l1.3-1.4a2 2 0 0 1 2.1-.4c.9.4 2 .7 3 .8a2 2 0 0 1 1.6 2v3a2 2 0 0 1-2.2 2A19 19 0 0 1 2.1 4.3 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.6.2 1.1.4 1.6"/>',
 'video':'<rect x="2" y="5" width="15" height="14" rx="2"/><path d="m17 10 5-3v10l-5-3"/>',
 'video-off':'<path d="m2 2 20 20M9 5h6a2 2 0 0 1 2 2v3l5-3v10l-5-3m0 3a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7c0-.5.2-.9.4-1.2"/>',
 'mic':'<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0M12 17v5m-4 0h8"/>',
 'mic-off':'<path d="m2 2 20 20M9 9v2a3 3 0 0 0 5 2M15 9V5a3 3 0 0 0-6 0v1M5 10a7 7 0 0 0 12 5M12 17v5m-4 0h8"/>',
 'arrow-left':'<path d="m15 18-6-6 6-6M9 12h12"/>',
 'chevron-down':'<path d="m6 9 6 6 6-6"/>',
 'chevron-right':'<path d="m9 6 6 6-6 6"/>',
 'send':'<path d="m22 2-7 20-4-9-9-4 20-7ZM22 2 11 13"/>',
 'volume-2':'<path d="M11 5 6 9H3v6h3l5 4zM15 9a5 5 0 0 1 0 6M18 6a9 9 0 0 1 0 12"/>',
 'shield':'<path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11z"/>',
 'hash':'<path d="M5 9h14M4 15h14M11 3 7 21M17 3l-4 18"/>',
 'pin':'<path d="m16 9 3-3-5-5-3 3-1 6-3 3 5 5 3-3zM9 15l-7 7"/>',
 'more':'<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
 'refresh-cw':'<path d="M20 7v5h-5M4 17v-5h5M6 9a7 7 0 0 1 12-2l2 5M4 12l2 5a7 7 0 0 0 12-2"/>',
 'check':'<path d="m5 12 4 4L19 6"/>',
 'clock':'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
 'monitor':'<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 21h8M12 16v5"/>'
};
const pict=(name)=>{const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('fill','none');svg.setAttribute('stroke','currentColor');svg.setAttribute('stroke-width','1.8');svg.setAttribute('stroke-linecap','round');svg.setAttribute('stroke-linejoin','round');svg.setAttribute('aria-hidden','true');svg.classList.add('ui-icon');svg.innerHTML=strokes[name];return svg;};
const symbol=name=>strokes[name]?pict(name):name;
const icon=(char,fn,title='',extra='')=>make('button',{type:'button',title,'aria-label':title||char,class:'icon-btn '+extra,onClick:fn},symbol(char));
const isMobile=()=>window.matchMedia('(max-width:780px)').matches;
const hasPerm=p=>!!S.server?.permissions?.includes(p);
const roleLabels={manage_server:'Editar nome/foto do servidor',manage_channels:'Criar/editar salas e bloqueá-las',manage_messages:'Moderar mensagens',manage_members:'Expulsar e banir membros',manage_roles:'Gerenciar cargos (reservado ao dono)',manage_bots:'Configurar bot Guardião',view_reports:'Ler auditoria',create_invites:'Criar convites',send_messages:'Enviar mensagens',use_voice:'Entrar em sala de voz em grupo'};
const profileEffectVideos={
  video_cosmic_rings:{src:'/effects/cosmic_rings.mp4',poster:'/effects/cosmic_rings.jpg',title:'🌌 Cosmic Rings'},
  video_spirit_mask:{src:'/effects/spirit_mask.mp4',poster:'/effects/spirit_mask.jpg',title:'🐺 Spirit Mask'},
  video_night_study:{src:'/effects/night_study.mp4',poster:'/effects/night_study.jpg',title:'🌃 Night Study'},
  video_neon_eye:{src:'/effects/neon_eye.mp4',poster:'/effects/neon_eye.jpg',title:'👁️ Neon Eye'},
  video_crystal_eye:{src:'/effects/crystal_eye.mp4',poster:'/effects/crystal_eye.jpg',title:'❄️ Crystal Eye'},
  video_sunset_dream:{src:'/effects/sunset_dream.mp4',poster:'/effects/sunset_dream.jpg',title:'🌇 Sunset Dream'},
  video_lonely_night:{src:'/effects/lonely_night.mp4',poster:'/effects/lonely_night.jpg',title:'🌙 Lonely Night'},
  video_neon_car:{src:'/effects/neon_car.mp4',poster:'/effects/neon_car.jpg',title:'🏎️ Neon Car'},
  video_dark_petal_eye:{src:'/effects/dark_petal_eye.mp4',poster:'/effects/dark_petal_eye.jpg',title:'🌺 Dark Petal Eye'}
};
const profileEffectOptions=[
  ['none','Sem animação'],['flowers','🌸 Flores caindo'],['pixel_hearts','💗 Corações pixelados'],['sparkles','✨ Brilhos'],
  ['neon_aura','🟣 Aura neon'],['cute_pink','🎀 Cute pink'],['sakura','🌺 Pétalas sakura'],['snow','❄️ Neve'],
  ['butterflies','🦋 Borboletas'],['glitch','🎮 Glitch gamer'],
  ['premium_purple','💜 Roxo premium'],['galaxy_pulse','🌠 Galáxia pulsante'],['neon_grid','🧬 Neon cyber'],['soft_gradient','🌈 Gradient clean'],
  ...Object.entries(profileEffectVideos).map(([id,info])=>[id,'🎬 '+info.title])
];
const isProfileVideoEffect=value=>Object.prototype.hasOwnProperty.call(profileEffectVideos,value);
const profileEffectClass=value=>'profile-effect-'+(profileEffectOptions.some(([id])=>id===value)?value:'none');
const profileEffectTitle=value=>(profileEffectOptions.find(([id])=>id===value)?.[1]||'Sem animação');
const profileEffectPreviewText=value=>isProfileVideoEffect(value)?'Vídeo premium':value==='none'?'Sem partículas':'Efeito animado';
const statusLabel=s=>({'online':'Disponível','idle':'Ausente','dnd':'Não perturbe','invisible':'Invisível','offline':'Offline'}[s]||'Offline');
const channelGroup=name=>/aviso|regra|termo|boas-vindas|atualiza|anúncio/i.test(name)?'INÍCIO':/loja|produto|preço|compra|venda|game-pass|vip/i.test(name)?'PRODUTOS':'COMUNIDADE';
const formatDate = value => { const date = new Date((value||'').replace(' ','T')+'Z'); return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}); };
const stateUrl = () => {
  const q = new URLSearchParams();
  if (S.page === 'chat' && S.server) { q.set('server',S.server.id); if (S.channelId) q.set('channel',S.channelId); }
  else if (S.page === 'dm' && S.dmUser) q.set('dm',S.dmUser);
  else q.set('tab', S.page);
  history.replaceState(null, '', '/app?'+q);
};
function apiUrl(path){return path.replace(/^\/api(?=\/|$)/,'/nexhub-api');}
async function request(url, method='GET', body) {
  const opt={ method,credentials:'same-origin',headers:body!==undefined?{'Content-Type':'application/json'}:{}};
  if (body!==undefined) opt.body=JSON.stringify(body);
  let res;
  try { res=await fetch(apiUrl(url),opt); } catch { throw Error('Sem conexão com o servidor. Verifique sua internet.'); }
  const data=await res.json().catch(()=>({error:'Resposta inválida.'}));
  if (!res.ok) { if (res.status === 401 && !url.includes('/login') && !url.includes('/register')) { closeEvents(); S.me=null; renderAuth(); } throw Error(data.error||`Erro ${res.status}`); }
  return data;
}
function toast(text,isError=false) {
  const el=div(isError?'error':'', text); toastRoot.append(el);
  setTimeout(()=>el.remove(),3800);
}
async function task(fn){ try{return await fn();}catch(e){ toast(e.message||'Não foi possível realizar a ação.',true); return undefined; } }
function closeEvents(){ S.eventSource?.close(); S.eventSource=null; }
function openEvents(){
  closeEvents(); const es=new EventSource(apiUrl('/api/events')); S.eventSource=es;
  es.addEventListener('messages',async e=>{const data=JSON.parse(e.data); if(S.page==='chat'&&data.channelId===S.channelId) await task(()=>refreshMessages());});
  for(const event of ['channels','members','server']) es.addEventListener(event,async e=>{const d=JSON.parse(e.data);if(S.server?.id===d.serverId) await task(async()=>{S.server=(await request('/api/servers/'+S.server.id)).server;render();});});
  es.addEventListener('server_deleted',async e=>{const d=JSON.parse(e.data);if(S.server?.id===d.serverId){await reloadServers(); S.server=null;S.page='friends';render();}});
  es.addEventListener('removed',async e=>{const d=JSON.parse(e.data);if(S.server?.id===d.serverId){await reloadServers();S.server=null;S.page='friends';render();toast('Você não participa mais deste servidor.',true);}});
  es.addEventListener('friends',async()=>{if(S.page==='friends')await task(()=>openFriends());});
  es.addEventListener('notification',async e=>{
    const data=JSON.parse(e.data||'{}');
    if('Notification' in window && Notification.permission==='granted')new Notification('NexHub',{body:data.text||'Nova notificação'});
    await task(loadNotifications);if(S.page==='notifications')render();else renderRail();
  });
  es.addEventListener('dm',async e=>{const d=JSON.parse(e.data);if(S.page==='dm'&&S.dmUser===d.fromId)await task(()=>openDM(S.dmUser,true));else if(S.page==='dms')await task(()=>openDMs());});
  es.addEventListener('typing',e=>{const d=JSON.parse(e.data);if(d.userId!==S.me.id&&S.page==='chat'&&S.channelId===d.channelId){const node=$('#typing');if(node)node.textContent=`${d.name} está digitando…`;clearTimeout(S.typingTimeout);S.typingTimeout=setTimeout(()=>{const n=$('#typing');if(n)n.textContent='';},1900);}});
  es.addEventListener('profile',async()=>{await task(async()=>{S.me=(await request('/api/me')).user;render();});});
  es.addEventListener('call',e=>queueCallEvent(JSON.parse(e.data)));
  es.addEventListener('voice',e=>queueVoiceEvent(JSON.parse(e.data)));
  es.addEventListener('account_banned',()=>{closeEvents();S.me=null;renderAuth();toast('Sua conta foi suspensa pela equipe da plataforma.',true);});
  es.addEventListener('open',()=>task(syncLiveCalls));
  es.addEventListener('presence',async e=>{const d=JSON.parse(e.data);if(S.server?.members){const m=S.server.members.find(m=>m.id===d.userId);if(m){m.online=d.online;renderMembers();}}});
  es.onerror=()=>{};
  // Em cada reconexão SSE, recuperar chamada e sinais (SDP/ICE) que possam ter se perdido.
}
function startCallSync(){
  if(callSyncTimer)return;
  callSyncTimer=setInterval(()=>{
    if(C&&S.me)task(syncActiveCall);
    if(G&&S.me)task(syncGroupVoiceSignals);
    if(!C&&!G)stopCallSync();
  },2500);
}
function stopCallSync(){
  if(callSyncTimer){clearInterval(callSyncTimer);callSyncTimer=null;}
}

async function reloadServers(){S.servers=(await request('/api/servers')).servers;}
async function loadNotifications(){S.notifications=(await request('/api/notifications')).notifications;}
async function initialize(){
  try { S.me=(await request('/api/me')).user; } catch { renderAuth(); return; }
  document.documentElement.dataset.theme=S.me.theme;
  await task(async()=>{
    await Promise.all([reloadServers(),loadNotifications()]);
    openEvents();
    const invite=location.pathname.match(/^\/invite\/([^/]+)$/);
    const params=new URLSearchParams(location.search);
    if(invite){ S.pendingInvite=invite[1]; await openFriends(); await enterInvite(S.pendingInvite); return; }
    if(params.has('dm')){await openDM(params.get('dm'));return;}
    if(params.has('tab') && ['home','friends','dms','settings','notifications','search','creator','shop','explore','missions'].includes(params.get('tab'))){await navigate(params.get('tab'));return;}
    const sid=params.get('server')||S.servers[0]?.id;
    if(sid) await openServer(sid,params.get('channel'));
    else await openFriends();
  });
}
function renderAuth(register=false){
  root.replaceChildren(); document.documentElement.dataset.theme='dark';
  const name=input('Seu nome de usuário'); name.autocomplete='username';name.autocapitalize='none';name.spellcheck=false;name.required=true;
  const pass=input('Digite sua senha','','password');pass.autocomplete=register?'new-password':'current-password';pass.required=true;
  const login=input('Usuário, @usuário ou e-mail');login.autocomplete='username';login.autocapitalize='none';login.spellcheck=false;
  const twofa=input('Código 2FA ou código de recuperação (se ativou)');twofa.autocomplete='one-time-code';twofa.maxLength=20;
  const togglePass=btn('👁 Mostrar senha',()=>{pass.type=pass.type==='password'?'text':'password';togglePass.textContent=pass.type==='password'?'👁 Mostrar senha':'🙈 Esconder senha';},'btn ghost small auth-pass-toggle');
  const f=make('form', {onSubmit:async e=>{
    e.preventDefault(); const button=f.querySelector('button[type=submit]');button.disabled=true;
    await task(async()=>{
      const data=register?await request('/api/register','POST',{username:name.value.trim(),password:pass.value}):await request('/api/login','POST',{login:login.value.trim().replace(/^@+/,''),password:pass.value,twoFactorCode:twofa.value.trim()});
      S.me=data.user;document.documentElement.dataset.theme=S.me.theme;if(data.emailVerification?.devCode)setTimeout(()=>toast('Código de verificação do e-mail: '+data.emailVerification.devCode),350);
      await Promise.all([reloadServers(),loadNotifications()]);openEvents();
      if(location.pathname.startsWith('/invite/')){const code=location.pathname.split('/').pop();await openFriends();await enterInvite(code);}
      else if(new URLSearchParams(location.search).has('dm'))await openDM(new URLSearchParams(location.search).get('dm'));
      else if(S.servers[0])await openServer(S.servers[0].id);else await openFriends();
      toast('Bem-vindo ao NexHub! ✨');
    });button.disabled=false;
  }},
  register?label('NOME DE USUÁRIO',name):label('USUÁRIO OU E-MAIL',login),
  label('SENHA',pass),togglePass,
  register?make('p',{class:'auth-mini-note'},'Crie sua conta só com usuário e senha. O nome de usuário precisa ser único.'):label('2FA (opcional)',twofa),
  register?null:make('p',{class:'auth-mini-note'},'Dica: pode entrar com usuário, @usuário ou e-mail. Se mudou de Replit, precisa preservar a pasta data/.'),
  make('button',{class:'btn primary full',type:'submit'},register?'Criar minha conta':'Entrar na minha conta'));
  const hero = div('auth-hero',
    div('brand', make('span',{class:'brand-symbol'},'N'), 'NexHub'),
    make('h1',{},'Seu espaço. ',make('span',{class:'gradient'},'Sua galera.')),
    make('p',{},'Crie comunidades, troque ideias, converse por texto, voz e vídeo em tempo real — tudo em um só lugar.'),
    div('feature-tags',
      make('span',{},'👥 Comunidades'),
      make('span',{},'🎙️ Call em grupo'),
      make('span',{},'👑 Perfis premium'),
      make('span',{},'🛡️ Moderação')
    ),
    div('auth-scene',
      div('auth-device',
        div('auth-device-rail',
          make('span',{class:'orb active'},'N'),
          make('span',{class:'orb'},''),
          make('span',{class:'orb'},''),
          make('span',{class:'orb'},'')
        ),
        div('auth-device-main',
          div('auth-device-lines',
            make('span',{class:'line short'}),
            make('span',{class:'line'}),
            make('span',{class:'line'}),
            make('span',{class:'line medium'})
          ),
          div('auth-device-call',
            make('span',{class:'mini-avatar'}),
            make('span',{class:'mini-avatar alt'}),
            make('span',{class:'mini-avatar alt2'}),
            div('auth-device-controls',
              make('span',{class:'dot-control'}),
              make('span',{class:'dot-control'}),
              make('span',{class:'dot-control end'})
            )
          )
        )
      )
    )
  );
  const card = div('auth-card',
    make('span',{class:'eyebrow'},'SEU PONTO DE ENCONTRO'),
    make('h2',{},register?'Crie sua conta':'Entre na sua conta'),
    make('p',{},register?'Um novo começo para a sua comunidade.':'Que bom te ver de novo! Continue suas conversas com a sua galera.'),
    f,
    div('auth-switch', register?'Já tem conta? ':'Ainda não tem conta? ', btn(register?'Fazer login':'Criar conta',()=>renderAuth(!register),'link')),
    register?null:div('auth-switch', btn('Recorrer banimento',()=>appealAccountModal(),'link'), btn('Recuperar conta',()=>recoveryAccountModal(),'link')),
    make('div',{class:'auth-footer-note',text:'Novas amizades. Grandes conversas. NexHub.'})
  );
  root.append(div('auth-screen', hero, div('auth-right', card)));
}
function appealAccountModal(){showModal('Recorrer banimento','Envie seu usuário/e-mail e explique o motivo. A equipe da plataforma precisa analisar manualmente.',[{label:'Usuário ou e-mail',key:'login',required:true},{label:'Explique o recurso',key:'reason',type:'textarea',required:true}],async v=>{await request('/api/appeals','POST',v);toast('Recurso enviado para análise.');},'Enviar recurso');}
function recoveryAccountModal(){
  chooseModal('Recuperar conta','Escolha o melhor caminho. O código rápido funciona no Replit/desenvolvimento; e-mail real em produção precisa SMTP configurado.',[
    {label:'🔑 Recuperar por código',onClick:async()=>passwordResetRequestModal()},
    {label:'📝 Solicitação manual para suporte',onClick:async()=>manualRecoveryModal()}
  ]);
}
function manualRecoveryModal(){showModal('Solicitação manual','Envie seu usuário/e-mail e explique o problema. A equipe do app analisa pelo painel do criador.',[{label:'Usuário ou e-mail',key:'login',required:true},{label:'Explique o problema',key:'reason',type:'textarea',required:true}],async v=>{await request('/api/account/recovery','POST',v);toast('Solicitação enviada para suporte.');},'Enviar solicitação');}
function passwordResetRequestModal(){showModal('Recuperar por código','Digite seu usuário ou e-mail. Em desenvolvimento o NexHub mostra o código na tela; em produção precisa SMTP para enviar por e-mail.',[{label:'Usuário ou e-mail',key:'login',required:true}],async v=>{const data=await request('/api/account/password-reset/request','POST',{login:v.login});closeModal();passwordResetConfirmModal(v.login,data);},'Gerar código');}
function passwordResetConfirmModal(login,data={}){showModal('Confirmar nova senha',data.devCode?`Código gerado: ${data.devCode}
E-mail: ${data.email||'cadastrado'}`:'Digite o código enviado para o e-mail cadastrado.',[{label:'Usuário ou e-mail',key:'login',value:login,required:true},{label:'Código de 6 dígitos',key:'code',required:true,maxLength:6},{label:'Nova senha',key:'newPassword',type:'password',required:true}],async v=>{await request('/api/account/password-reset/confirm','POST',v);toast('Senha redefinida. Entre com a nova senha.');},'Redefinir senha');}
async function openServer(serverId,channelId){
  S.server=(await request('/api/servers/'+encodeURIComponent(serverId))).server;
  S.page='chat';S.drawer=false;S.dmUser=null;S.reply=null;S.mobilePane=(isMobile()&&!channelId?'list':'content');
  S.channelId=S.server.channels.some(c=>c.id===channelId)?channelId:S.server.channels[0]?.id;
  await loadMessages(); await reloadServers().catch(()=>{}); stateUrl();render();
}
async function loadMessages(){ if(!S.channelId || S.server?.channels.find(c=>c.id===S.channelId)?.type==='voice'){S.messages=[];S.hasMore=false;return;}
  const data=await request('/api/channels/'+S.channelId+'/messages');S.messages=data.messages;S.hasMore=data.hasMore;
}
async function refreshMessages(){
  if(!S.channelId||S.server?.channels.find(c=>c.id===S.channelId)?.type==='voice')return;
  const data=await request('/api/channels/'+S.channelId+'/messages');
  // Preserva mensagens antigas carregadas e atualiza/deleta as que fazem parte da janela recente.
  const old=S.messages.length>40?S.messages.slice(0,-40):[];
  S.messages=[...old.filter(m=>!data.messages.some(n=>n.id===m.id)),...data.messages];
  const unique=new Map(S.messages.map(m=>[m.id,m]));S.messages=[...unique.values()];
  if(S.page==='chat')renderMessages();
}
async function chooseChannel(id){ S.channelId=id;S.reply=null;S.drawer=false;S.mobilePane='content';await loadMessages();await reloadServers().catch(()=>{});stateUrl();render(); }
async function navigate(page){
  S.page=page;S.drawer=false;S.reply=null;
  if(page==='home'){S.contacts=(await request('/api/dms')).contacts;await loadNotifications();}
  if(page==='friends')S.friends=await request('/api/friends');
  if(page==='dms')S.contacts=(await request('/api/dms')).contacts;
  if(page==='notifications')await loadNotifications();
  if(page==='creator')await loadCreatorOverview();
  stateUrl();render();
}
async function openFriends(){ S.friends=await request('/api/friends');S.page='friends';S.drawer=false;stateUrl();render(); }
async function openDMs(){ S.contacts=(await request('/api/dms')).contacts;S.page='dms';S.mobilePane='list';S.drawer=false;stateUrl();render(); }
async function openDM(uid,fromEvent=false){
  const draft=fromEvent?document.querySelector('#dm-compose')?.value:null;
  const data=await request('/api/dms/'+encodeURIComponent(uid)+'/messages');S.dmUser=uid;S.dmContact=data.contact;S.dmMessages=data.messages;S.page='dm';S.drawer=false;S.mobilePane='content';
  if(!fromEvent)stateUrl();render();
  if(draft!==null && document.querySelector('#dm-compose'))document.querySelector('#dm-compose').value=draft;
  try { S.contacts=(await request('/api/dms')).contacts; } catch {}
}
async function showInvite(){ if(!S.server)return;await task(async()=>{
  const data=await request('/api/servers/'+S.server.id+'/invites','POST',{});
  const url=location.origin+data.path;
  showModal('Convide seus amigos',`Este link pode ser usado até 25 vezes e expira em 7 dias.`,[
    {label:'Link do convite',value:url,readonly:true}],async()=>{ try{await navigator.clipboard.writeText(url);toast('Convite copiado!');}catch{toast('Copie o link do campo.');} },'Copiar link');
 });}
async function enterInvite(code){ await task(async()=>{
  const data=await request('/api/invites/'+encodeURIComponent(code));
  confirmModal('Entrar no servidor?',`Você recebeu um convite para “${data.invite.serverName}”. Deseja entrar?`,async()=>{
    const joined=await request('/api/invites/'+encodeURIComponent(code),'POST',{});
    await reloadServers();await openServer(joined.serverId);toast('Você entrou no servidor!');
  },'Entrar');
 }); }
function render(){
  if(!S.me)return renderAuth();document.documentElement.dataset.theme=S.me.theme;
  root.replaceChildren();
  const cls='app-layout'+(S.page==='chat'?'':' social-view')+(S.page==='chat'&&S.mobilePane==='list'?' mobile-list':'')+(S.drawer?' drawer-open':'');
  const app=div(cls);app.id='layout';
  app.append(div('drawer-shade',make('button',{type:'button',class:'full',style:'width:100%;height:100%',onClick:()=>{S.drawer=false;render();},'aria-label':'Fechar canais'},'')));
  app.append(buildRail(),buildSidebar());
  const main=div('content');main.id='main';app.append(main);
  app.append(div('members'),buildAccountBar());root.append(app);renderMain();
}
function buildAccountBar(){
  const unread=S.notifications.filter(n=>!n.read).length;
  return div('mobile-accountbar',btn('',()=>task(()=>navigate('settings')),'account-open'),
    div('account-identity',avatar(S.me.displayName,S.me.color,'',S.me.avatarUrl),
      div('account-names',make('strong',{text:S.me.displayName}),make('span',{text:statusLabel(S.me.status)}))),
    icon('chevron-down',()=>task(()=>navigate('settings')),'Abrir meu perfil'),
    div('grow'),icon('bell',()=>task(()=>navigate('notifications')),`Notificações${unread?' ('+unread+')':''}`,'account-notification'),unread?make('span',{class:'notif-bubble',text:String(unread)}):null);
}
function buildRail(){
  const rail=div('rail');rail.id='rail';
  rail.append(icon('message-circle',()=>task(()=>navigate('home')),'Início','rail-item rail-logo'+(S.page==='home'?' active':'')));
  const dmItem=icon('bell',()=>task(()=>openDMs()),'Mensagens','rail-item'+(['dms','dm'].includes(S.page)?' active':''));
  const dmUnread=S.contacts.reduce((a,c)=>a+Number(c.unreadCount||0),0); if(dmUnread)dmItem.append(unreadBadge(dmUnread)); rail.append(dmItem);
  rail.append(icon('hourglass',()=>task(()=>openFriends()),'Amigos','rail-item'+(S.page==='friends'?' active':'')));
  rail.append(icon('search',()=>task(()=>navigate('explore')),'Explorar','rail-item'+(S.page==='explore'?' active':'')));
  rail.append(icon('check',()=>task(()=>navigate('missions')),'Missões','rail-item'+(S.page==='missions'?' active':'')));
  rail.append(icon('monitor',()=>task(()=>navigate('shop')),'Loja','rail-item'+(S.page==='shop'?' active':'')));
  rail.append(make('hr',{class:'rail-divider'}));
  for(const sv of S.servers){
    const item=icon(sv.iconUrl?'':sv.name.slice(0,2).toUpperCase(),()=>task(()=>openServer(sv.id)),sv.name,'rail-item server-rail'+(S.server?.id===sv.id&&S.page==='chat'?' active':''));
    if(sv.iconUrl?.startsWith('/media/'))item.append(make('img',{src:sv.iconUrl,alt:'Ícone de '+sv.name,class:'server-icon'}));
    if(sv.unreadCount)item.append(unreadBadge(sv.unreadCount));
    rail.append(item);
  }
  rail.append(icon('plus',()=>createServerModal(),'Criar servidor','rail-item rail-add'));
  rail.append(div('rail-spacer'));
  if(S.me?.isPlatformAdmin)rail.append(icon('shield',()=>task(()=>navigate('creator')),'Painel do Criador','rail-item rail-settings'+(S.page==='creator'?' active':'')));
  rail.append(icon('settings',()=>task(()=>navigate('settings')),'Configurações','rail-item rail-settings'));
  return rail;
}
function renderRail(){const old=$('#rail');if(old)old.replaceWith(buildRail());}
function buildSidebar(){
  const side=div('sidebar');if(S.page!=='chat'||!S.server)return side;
  side.append(div('side-heading',make('strong',{text:S.server.name}),icon('chevron-down',()=>serverMenu(),'Opções do servidor')));
  const search=input('Buscar canal…');search.className='sidebar-search';search.type='search';search.value=S.channelFilter;
  const scroll=div('side-section');scroll.id='side-scroll';
  const fill=()=>{
    scroll.replaceChildren();const channels=S.server.channels.filter(c=>c.name.toLocaleLowerCase().includes(S.channelFilter.toLocaleLowerCase()));
    for(const group of ['INÍCIO','COMUNIDADE','PRODUTOS','SALAS DE VOZ']){
      const items=channels.filter(c=>(c.type==='voice'?'SALAS DE VOZ':channelGroup(c.name))===group);
      if(!items.length)continue;
      const collapsed=!!S.collapsedCategories[S.server.id+group];
      scroll.append(make('button',{class:'side-label category-toggle','aria-expanded':String(!collapsed),onClick:()=>{S.collapsedCategories[S.server.id+group]=!collapsed;fill();}},
        symbol(collapsed?'chevron-right':'chevron-down'),make('span',{text:group})));
      if(!collapsed){for(const c of items)scroll.append(make('button',{type:'button',class:'side-channel'+(S.channelId===c.id?' selected':'')+(c.unreadCount?' has-unread':''),onClick:()=>task(()=>chooseChannel(c.id))},symbol(c.type==='voice'?'volume-2':'hash'),make('span',{class:'channel-title',text:c.name+(c.locked?' 🔒':'' )}),unreadBadge(c.unreadCount)));}
    }
    if(!channels.length)scroll.append(make('p',{class:'sidebar-empty'},'Nenhum canal encontrado.'));
    if(hasPerm('manage_channels'))scroll.append(make('button',{class:'side-channel new-channel',onClick:()=>channelModal()},symbol('plus'),' Criar canal'));
  };
  search.addEventListener('input',()=>{S.channelFilter=search.value;fill();});
  side.append(div('sidebar-search-row',search,icon('user-plus',()=>task(showInvite),'Convidar')));
  const onlineCount=(S.server.members||[]).filter(m=>m.online).length;
  const serverMiniIcon=div('server-mini-icon', S.server.iconUrl?.startsWith('/media/')?make('img',{src:S.server.iconUrl,alt:'Ícone de '+S.server.name}):make('span',{text:(S.server.name||'NH').slice(0,2).toUpperCase()}));
  side.append(div('server-mini-card',
    serverMiniIcon,
    div('server-mini-copy',make('strong',{text:S.server.name}),make('span',{text:`${S.server.members?.length||0} membros · ${onlineCount} online`})),
    div('server-mini-actions',icon('user-plus',()=>task(showInvite),'Convidar'),hasPerm('manage_server')?icon('settings',()=>serverMenu(),'Configurar servidor'):null)
  ));
  side.append(scroll);fill();
  side.append(div('side-footer',avatar(S.me.displayName,S.me.color,'',S.me.avatarUrl),div('self-text',make('strong',{text:S.me.displayName}),make('small',{text:statusLabel(S.me.status)})),icon('settings',()=>task(()=>navigate('settings')),'Configurações')));
  return side;
}
function renderMain(){
  const main=$('#main');if(!main)return;main.replaceChildren();
  if(S.page==='chat')renderChat(main);
  else if(S.page==='home')renderHome(main);
  else if(S.page==='friends')renderFriends(main);
  else if(S.page==='dms')renderDMs(main);
  else if(S.page==='dm')renderDM(main);
  else if(S.page==='notifications')renderNotifications(main);
  else if(S.page==='shop')renderShop(main);
  else if(S.page==='explore')renderExplore(main);
  else if(S.page==='missions')renderMissions(main);
  else if(S.page==='settings')renderSettings(main);
  else if(S.page==='creator')renderCreator(main);
  else if(S.page==='search')renderSearch(main);
  else if(S.page==='audit')renderAudit(main);
  const app=$('#layout');
  if(S.page==='chat')app.classList.remove('no-members'); else app.classList.add('no-members');
  if(window.innerWidth <= 1150) app.classList.add('no-members');
  // A navegação mobile usa a barra lateral e o retorno próprio de cada tela.
}
function buildMobileBottom(){
  return div('mobile-bottom',icon('☰',()=>{S.drawer=true;render();},'Abrir canais'),icon('♟',()=>task(()=>openFriends()),'Amigos'),icon('✉',()=>task(()=>openDMs()),'DMs'),icon('🔔',()=>task(()=>navigate('notifications')),'Notificações'),icon('⚙',()=>task(()=>navigate('settings')),'Configurações'));
}
function topbar(title,desc='',actions=[]){
  return div('topbar',icon('arrow-left',()=>{if(S.page==='chat'){S.mobilePane='list';S.drawer=false;render();}else task(()=>openDMs());},'Voltar','mobile-only'),make('h2',{text:title}),desc?make('span',{class:'topic',text:desc}):null,div('grow'),...actions);
}
function empty(iconText,title,desc){return div('empty',div('large-emoji',iconText),make('h3',{text:title}),make('p',{text:desc}));}
function renderChat(main){
  const c=S.server?.channels.find(x=>x.id===S.channelId);
  if(c?.type==='voice'){renderVoiceChannel(main,c);return;}
  main.append(topbar('# '+(c?.name||'sem-canal'),c?.topic||'',[
    icon('search',()=>task(()=>navigate('search')),'Pesquisar'),icon('pin',()=>task(showPins),'Fixados'),icon('users',()=>membersModal(),'Ver membros'),icon('more',()=>channelMenu(),'Opções do canal')]));
  const scroll=div('chat-area');scroll.id='chat-scroll';main.append(scroll);
  renderMessages(true);
  const typing=div('typing');typing.id='typing';
  const response=div('responding');response.id='responding';if(!S.reply)response.classList.add('hide');
  const field=make('textarea',{placeholder:c?`Escreva em #${c.name}`:'Selecione um canal',rows:1,'aria-label':'Sua mensagem'});
  field.disabled=!c || (!!(c.locked||S.server?.textLocked)&&!hasPerm('manage_channels'));
  if((c?.locked||S.server?.textLocked)&&!hasPerm('manage_channels'))field.placeholder='🔒 Chat bloqueado pela moderação';
  field.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send();}});
  let typingAt=0;field.addEventListener('input',()=>{if(Date.now()-typingAt>3000&&S.channelId){typingAt=Date.now();request('/api/typing','POST',{channelId:S.channelId}).catch(()=>{});}});
  const send=()=>task(async()=>{
    const value=field.value.trim(); if(!value||!S.channelId)return;
    field.disabled=true;
    try {await request('/api/channels/'+S.channelId+'/messages','POST',{content:value,replyTo:S.reply?.id});field.value='';S.reply=null;renderReply();await refreshMessages();}
    finally {field.disabled=false;field.focus();}
  });
  const compose=div('composer',icon('plus',()=>pollModal(),'Criar enquete'),icon('mic',()=>task(()=>voiceMessageModal('channel')),'Gravar mensagem de voz','voice-record-trigger'),field,btn(symbol('send'),send,'btn primary send-btn'));
  if((c?.locked||S.server?.textLocked)&&!hasPerm('manage_channels'))compose.append(make('span',{class:'voice-note'},'Chat bloqueado'));
  main.append(div('chat-bottom',response,compose,typing));renderReply();renderMembers();
}
function renderReply(){const e=$('#responding');if(!e)return;if(!S.reply){e.classList.add('hide');return;}e.classList.remove('hide');e.replaceChildren(`Respondendo a ${S.reply.author}: ${short(S.reply.content||'enquete')}`,icon('×',()=>{S.reply=null;renderReply();},'Cancelar resposta'));}
function renderMessages(scrollBottom=false){
  const scroll=$('#chat-scroll');if(!scroll)return;
  const atBottom=scrollBottom || scroll.scrollHeight-scroll.scrollTop-scroll.clientHeight<140;
  const oldHeight=scroll.scrollHeight,oldTop=scroll.scrollTop;
  scroll.replaceChildren();
  const c=S.server?.channels.find(x=>x.id===S.channelId);
  if(S.hasMore)scroll.append(btn('↑ Carregar mensagens antigas',()=>task(async()=>{
    const previous=S.messages[0]?.id;const data=await request('/api/channels/'+S.channelId+'/messages?before='+previous);
    S.messages=[...data.messages,...S.messages];S.hasMore=data.hasMore;renderMessages();
  }),'old-messages'));
  scroll.append(div('welcome channel-welcome',div('bubble-icon','#'),make('h2',{text:'Bem-vindo a #'+(c?.name||'geral')}),make('p',{},'Este é o começo da conversa neste canal do NexHub. Converse, compartilhe ideias e mantenha a comunidade viva.'),div('welcome-actions',make('span',{},'✨ Chat premium'),make('span',{},'🛡️ Moderação ativa'),make('span',{},'💬 Reações e respostas'))));
  for(const m of S.messages)scroll.append(renderMessage(m));
  if(atBottom)scroll.scrollTop=scroll.scrollHeight;
  else scroll.scrollTop=oldTop+(scroll.scrollHeight-oldHeight);
}
function renderMessage(m){
  const mine=m.userId===S.me.id;
  const body=div('msg-body');
  body.append(div('msg-meta',make('strong',{class:m.vipActive?'vip-name':'' ,text:m.author}),m.vipActive?make('span',{class:'vip-mini-badge',text:'VIP'}):null,make('time',{text:formatDate(m.createdAt)+(m.editedAt?' · editada':'')})));
  if(m.replyTo)body.append(div('reply-chip','↪ Resposta a outra mensagem'));
  if(m.pinned)body.append(div('pinned-label','📌 Mensagem fixada'));
  if(m.content)body.append(div('msg-content',m.content));
  if(m.asset){
    if(m.asset.type==='sound')body.append(make('audio',{controls:true,src:m.asset.url,class:'msg-audio'}));
    else body.append(div('msg-asset',make('img',{src:m.asset.url,alt:m.asset.name,loading:'lazy'}),make('small',{text:(m.asset.type==='emoji'?'Emoji':m.asset.type==='gif'?'GIF':'Figurinha')+' · '+m.asset.name})));
  }
  if(m.voice)body.append(voicePlayer(m.voice,'Mensagem de voz de '+m.author));
  if(m.poll){
    const total=m.poll.options.reduce((t,o)=>t+o.count,0);
    const box=div('poll',make('strong',{text:'📊 '+m.poll.question}));
    m.poll.options.forEach((o,i)=>box.append(make('button',{type:'button',class:'poll-choice'+(m.poll.myVote===i?' chosen':''),onClick:()=>task(async()=>{await request('/api/messages/'+m.id+'/vote','POST',{optionIndex:i});await refreshMessages();})},make('span',{class:'poll-bar',style:`width:${total?100*o.count/total:0}%`}),make('span',{text:o.label}),make('span',{text:total?`${o.count} · ${Math.round(100*o.count/total)}%`:`0`}))));
    box.append(make('small',{text:`${total} voto(s) · Você pode mudar seu voto`}));body.append(box);
  }
  const tools=div('msg-tools');
  for(const r of m.reactions)tools.append(btn(r.emoji+' '+r.count,()=>task(async()=>{await request('/api/messages/'+m.id+'/react','POST',{emoji:r.emoji});await refreshMessages();}),'react-chip'+(r.mine?' mine':'')));
  tools.append(btn('♡',()=>reactionsModal(m),'tool-chip'),btn('↩ Responder',()=>{S.reply=m;renderReply();$('#main textarea')?.focus();},'tool-chip'));
  if(mine)tools.append(btn('✎',()=>editMessage(m),'tool-chip'));
  if(mine||hasPerm('manage_messages'))tools.append(btn('🗑',()=>confirmModal('Apagar mensagem?','Essa mensagem será excluída para todos.',async()=>{await request('/api/messages/'+m.id,'DELETE');await refreshMessages();},'Excluir'),'tool-chip'));
  if(hasPerm('manage_messages'))tools.append(btn(m.pinned?'📌 Desafixar':'📌 Fixar',()=>task(async()=>{await request('/api/messages/'+m.id+'/pin','POST',{});await refreshMessages();}),'tool-chip'));
  if(!mine)tools.append(btn('⚑ Denunciar',()=>reportModal(m.userId,m.id),'tool-chip'));
  body.append(tools);
  return div('msg'+(m.mentionedMe?' mentioned-me':'')+(m.vipActive?' vip-msg':''),div('vip-avatar-wrap',avatar(m.author,m.color,'',m.avatarUrl),m.vipActive?make('span',{class:'vip-avatar-gem',text:'◆'}):null),body);
}
async function showPins(){if(!S.channelId)return;await task(async()=>{
  const data=await request('/api/channels/'+S.channelId+'/pins');
  const box=modalFrame('📌 Mensagens fixadas',data.messages.length?'Mensagens importantes deste canal.':'Nenhuma mensagem fixada ainda.');
  const list=div('pins-list');
  if(!data.messages.length)list.append(empty('📌','Nada fixado','Quando a moderação fixar algo, aparece aqui.'));
  for(const m of data.messages){
    const preview=m.asset?`${m.asset.type}: ${m.asset.name}`:(m.content||m.poll?.question||'Mensagem');
    list.append(div('pin-card',avatar(m.author,m.color,'',m.avatarUrl),div('grow',make('strong',{text:m.author}),make('p',{text:short(preview,180)}),make('small',{text:formatDate(m.createdAt)})),div('profile-tools',btn('Abrir canal',()=>task(async()=>{closeModal();await openServer(S.server.id,m.channelId);}), 'btn primary small'),hasPerm('manage_messages')?btn('Desafixar',()=>task(async()=>{await request('/api/messages/'+m.id+'/pin','POST',{});closeModal();await refreshMessages();toast('Mensagem desafixada.');}), 'btn secondary small'):null)));
  }
  box.append(list,div('modal-actions',btn('Fechar',closeModal,'btn ghost')));
});}
function reactionsModal(m){
  chooseModal('Reagir à mensagem','Escolha um emoji:', ['❤️','😂','👍','🔥','🎉','👀','💜','💯'].map(e=>({label:e,onClick:async()=>{await request('/api/messages/'+m.id+'/react','POST',{emoji:e});await refreshMessages();}})));
}
function editMessage(m){showModal('Editar mensagem','Atualize seu texto.',[{label:'Mensagem',key:'content',type:'textarea',value:m.content,required:true}],async v=>{await request('/api/messages/'+m.id,'PATCH',{content:v.content});await refreshMessages();},'Salvar');}
function pollModal(){if(!S.channelId)return;showModal('Criar enquete','Pergunte algo à comunidade. Mínimo de 2 e máximo de 5 opções.',[
  {label:'Pergunta',key:'question',required:true},{label:'Opção 1',key:'a',required:true},{label:'Opção 2',key:'b',required:true},{label:'Opção 3 (opcional)',key:'c'},{label:'Opção 4 (opcional)',key:'d'},{label:'Opção 5 (opcional)',key:'e'}],async v=>{await request('/api/channels/'+S.channelId+'/polls','POST',{question:v.question,options:[v.a,v.b,v.c,v.d,v.e].filter(Boolean)});await refreshMessages();},'Criar enquete');}
function renderMembers(){
  const pane=$('.members');if(!pane||S.page!=='chat')return;
  pane.replaceChildren(div('side-label',`MEMBROS — ${S.server?.members.length||0}`));
  for(const m of S.server?.members||[]){
    const badge=div('avatar-wrap',avatar(m.displayName,m.color,'',m.avatarUrl),div('dot'+(m.online?' online':'')));
    pane.append(make('button',{class:'member-row',title:'Ver membro',onClick:()=>memberModal(m)},badge,div('',make('span',{text:m.displayName}),make('small',{class:'member-role',text:m.role==='owner'?'👑 Dono':m.role==='moderator'?'🛡️ Moderador':S.server?.roles?.find(r=>r.id===m.customRoleId)?.name|| (m.online?'Online':'Membro')}))));
  }
}
function membersModal(){
  if(!S.server){toast('Escolha um servidor.');return;}
  chooseModal(`Membros de ${S.server.name}`,`${S.server.members.length} participante(s)`,S.server.members.map(m=>({label:`${m.role==='owner'?'👑 ':m.role==='moderator'?'🛡️ ':''}${m.displayName} (@${m.username})`,onClick:async()=>{memberModal(m);}})));
}
function memberModal(m){
  const actions=[];
  if(m.id!==S.me.id)actions.push({label:'💬 Enviar mensagem privada',onClick:()=>openDM(m.id)},{label:'📞 Chamada de voz',onClick:()=>startCall(m.id,'audio')},{label:'📹 Chamada de vídeo',onClick:()=>startCall(m.id,'video')});
  const canManage=hasPerm('manage_members') && (S.server?.role==='owner'||(m.role==='member'&&!S.server?.roles?.some(r=>r.id===m.customRoleId&&r.permissions.some(p=>p.startsWith('manage_')))));
  if(canManage&&m.id!==S.me.id&&m.role!=='owner'){
    if(S.server.role==='owner')actions.push({label:m.role==='moderator'?'⬇ Remover moderação':'🛡️ Tornar moderador',onClick:async()=>{
      await request(`/api/servers/${S.server.id}/members/${m.id}/role`,'POST',{role:m.role==='moderator'?'member':'moderator'});
      S.server=(await request('/api/servers/'+S.server.id)).server;render();toast('Cargo atualizado.');
    }});
    actions.push({label:'↪ Expulsar do servidor',onClick:async()=>confirmModal('Expulsar membro?',`Remover ${m.displayName} deste servidor?`,async()=>{
      await request(`/api/servers/${S.server.id}/members/${m.id}/kick`,'POST',{reason:'Decisão de moderação'});
      S.server=(await request('/api/servers/'+S.server.id)).server;render();toast('Membro expulso.');
    },'Expulsar')});
    actions.push({label:'⛔ Banir do servidor',onClick:async()=>confirmModal('Banir membro?',`${m.displayName} não poderá entrar novamente por convite.`,async()=>{
      await request(`/api/servers/${S.server.id}/members/${m.id}/ban`,'POST',{reason:'Decisão de moderação'});
      S.server=(await request('/api/servers/'+S.server.id)).server;render();toast('Membro banido.');
    },'Banir')});
  }
  if(S.server?.role==='owner'&&m.id!==S.me.id&&m.role!=='owner')actions.push({label:'🎨 Definir cargo personalizado',onClick:async()=>assignRoleModal(m)});
  if(!actions.length)actions.push({label:'Voltar',onClick:async()=>{}});
  task(()=>showProfile(m.id,actions));
}
function renderVoiceChannel(main,c){
  main.append(topbar('🎧 '+c.name,c.topic||'Sala de voz',[icon('more',()=>channelMenu(),'Configurar sala')]));
  const view=div('center-view',make('span',{class:'eyebrow'},'SALA DE VOZ EM GRUPO'),make('h1',{text:(c.locked||S.server?.voiceLocked)?'🔒 Sala bloqueada':'🎧 '+c.name}),
    make('p',{class:'view-description',text:'Agora a sala tem entrada, lista de participantes e sinalização WebRTC em grupo. Para áudio real funcionar, use HTTPS e configure TURN quando a rede exigir.'}));
  const active=G?.channelId===c.id;
  view.append(div('section-card',make('h3',{},'Entrar na call'),make('p',{class:'dim',text:(c.locked||S.server?.voiceLocked)?'Esta sala está fechada pela moderação.':'Entre para aparecer na chamada em grupo.'}),
    active?btn('Sair da call em grupo',()=>task(leaveGroupVoice),'btn danger'):btn('Entrar na call em grupo',()=>task(()=>joinGroupVoice(c.id)),'btn primary'),
    btn('Verificar acesso',()=>task(async()=>{const data=await request('/api/channels/'+c.id+'/voice-access');toast(data.canJoin?'Você tem permissão para entrar na sala.':'Sem permissão para esta sala.');}),'btn secondary')));
  main.append(view);
}
async function serverIconModal(){
  const box=modalFrame('Foto do servidor','Escolha JPG, PNG, GIF ou WebP de até 5 MB.');
  const upload=make('input',{type:'file',accept:'image/jpeg,image/png,image/gif,image/webp',class:'file-upload'});
  upload.addEventListener('change',()=>task(async()=>{
    const file=upload.files?.[0];if(!file)return;if(file.size>5*1024*1024)throw Error('Imagem maior que 5 MB.');
    const res=await fetch(apiUrl(`/api/servers/${S.server.id}/icon`),{method:'PUT',headers:{'Content-Type':'application/octet-stream'},credentials:'same-origin',body:file});
    const data=await res.json();if(!res.ok)throw Error(data.error||'Falha no envio.');
    S.server=data.server;await reloadServers();closeModal();render();toast('Foto do servidor atualizada.');
  }));
  box.append(label('Imagem',upload),div('modal-actions',btn('Remover foto',()=>task(async()=>{await request(`/api/servers/${S.server.id}/icon`,'DELETE');S.server=(await request(`/api/servers/${S.server.id}`)).server;await reloadServers();closeModal();render();}),'btn secondary'),btn('Fechar',closeModal)));
}
function rolesModal(){
  const roles=S.server?.roles||[];
  chooseModal('🎭 Cargos de '+S.server.name,'Apenas o dono pode criar cargos e atribuir permissões. Cada cargo é independente.',[
    {label:'➕ Criar novo cargo',onClick:async()=>roleEditor()},
    ...roles.map(r=>({label:`🎨 ${r.name} (${r.permissions.length} permissões)`,onClick:async()=>roleEditor(r)}))
  ]);
}
function roleEditor(role=null){
  const box=modalFrame(role?'Editar cargo':'Criar cargo','Marque somente as permissões necessárias.');
  const name=input('Ex.: Moderador, Suporte, VIP',role?.name||'');name.maxLength=32;
  const color=make('input',{type:'color',value:role?.color||'#8b82ff'});
  const checks=Object.entries(roleLabels).filter(([key])=>key!=='manage_roles').map(([key,title])=>({key,ctl:make('input',{type:'checkbox',checked:!!role?.permissions?.includes(key)}),title}));
  const form=make('form',{onSubmit:e=>{e.preventDefault();task(async()=>{
    const payload={name:name.value,color:color.value,permissions:checks.filter(x=>x.ctl.checked).map(x=>x.key)};
    if(role)await request(`/api/servers/${S.server.id}/roles/${role.id}`,'PATCH',payload);
    else await request(`/api/servers/${S.server.id}/roles`,'POST',payload);
    S.server=(await request(`/api/servers/${S.server.id}`)).server;closeModal();render();toast('Cargo salvo.');
  });}});
  form.append(label('Nome do cargo',name),label('Cor do cargo',color));
  for(const r of checks)form.append(make('label',{class:'permission-item'},r.ctl,make('span',{text:r.title})));
  form.append(div('modal-actions',btn('Cancelar',closeModal,'btn ghost'),make('button',{type:'submit',class:'btn primary'},'Salvar cargo')));
  if(role)form.append(btn('🗑 Excluir cargo',()=>confirmModal('Excluir cargo?',`Quem estiver com ${role.name} perderá esse cargo.`,async()=>{
    await request(`/api/servers/${S.server.id}/roles/${role.id}`,'DELETE');S.server=(await request(`/api/servers/${S.server.id}`)).server;render();
  },'Excluir'),'btn danger'));
  box.append(form);
}
async function assignRoleModal(m){
  const roles=S.server?.roles||[];
  chooseModal('Cargo de '+m.displayName,'Selecione um cargo personalizado:',[
    {label:'Sem cargo personalizado',onClick:async()=>changeRole(m.id,null)},
    ...roles.map(r=>({label:`🎨 ${r.name}`,onClick:async()=>changeRole(m.id,r.id)}))
  ]);
}
async function changeRole(uid,rid){
  await request(`/api/servers/${S.server.id}/members/${uid}/custom-role`,'POST',{roleId:rid});
  S.server=(await request(`/api/servers/${S.server.id}`)).server;render();toast('Cargo aplicado.');
}
function serverLocksModal(){
  showModal('🔒 Bloqueios do servidor','Bloqueios globais para salas de texto e salas de voz. Equipe com permissão de gerenciamento pode continuar administrando.',[
    {label:'Bloquear envio de mensagens em todos os canais',key:'textLocked',type:'checkbox',value:!!S.server.textLocked},
    {label:'Bloquear todas as salas de call',key:'voiceLocked',type:'checkbox',value:!!S.server.voiceLocked}
  ],async v=>{S.server=(await request(`/api/servers/${S.server.id}/locks`,'PATCH',v)).server;render();toast('Bloqueios atualizados.');},'Salvar bloqueios');
}
function guardianModal(){
  showModal('🤖 Guardião — bot interno','Filtra links e palavras proibidas. Não instala bots externos.',[
    {label:'Ativar filtro',key:'enabled',type:'checkbox',value:!!S.server.automodEnabled},
    {label:'Bloquear links',key:'blockLinks',type:'checkbox',value:!!S.server.blockLinks},
    {label:'Boas-vindas ao entrar',key:'welcomeEnabled',type:'checkbox',value:!!S.server.welcomeEnabled},
    {label:'Palavras bloqueadas (separe por vírgula)',key:'words',type:'textarea',value:JSON.parse(S.server.blockedWords||'[]').join(', ')}
  ],async v=>{await request(`/api/servers/${S.server.id}/bots/guardian`,'PATCH',{
    enabled:v.enabled,blockLinks:v.blockLinks,welcomeEnabled:v.welcomeEnabled,blockedWords:v.words.split(',').map(x=>x.trim()).filter(Boolean)
  });S.server=(await request(`/api/servers/${S.server.id}`)).server;render();toast('Guardião configurado.');},'Salvar bot');
}
async function botStoreModal(){
  const [catalog,installed]=await Promise.all([request('/api/bots/catalog'),request(`/api/servers/${S.server.id}/bots`)]);
  const installedIds=new Set(installed.bots.map(b=>b.id));
  chooseModal('🧩 Loja de bots','Instale bots internos com permissões controladas. Bots externos ainda entram em etapa futura.',catalog.bots.map(bot=>({
    label:`${installedIds.has(bot.id)?'✅':'➕'} ${bot.name} — ${bot.description.slice(0,60)}`,
    onClick:async()=>{
      if(installedIds.has(bot.id))await request(`/api/servers/${S.server.id}/bots/${bot.id}`,'DELETE',{});
      else await request(`/api/servers/${S.server.id}/bots/${bot.id}`,'POST',{});
      toast(installedIds.has(bot.id)?'Bot removido.':'Bot instalado.');
    }
  })));
}
async function assetsModal(){
  const data=await request(`/api/servers/${S.server.id}/assets`);
  const box=modalFrame('✨ Emojis, figurinhas, GIFs e sons','Envie arquivos do servidor. Imagens/GIF/WebP para emoji, figurinha e GIF; MP3/WAV/OGG para som.');
  const name=input('nome-do-item');name.maxLength=30;
  const type=make('select',{},...['emoji','sticker','gif','sound'].map(v=>make('option',{value:v},v==='sticker'?'figurinha':v==='sound'?'som':v)));
  const file=make('input',{type:'file',class:'file-upload',accept:'image/*,audio/*'});
  const form=make('form',{onSubmit:e=>{e.preventDefault();task(async()=>{
    const f=file.files?.[0];if(!f)throw Error('Escolha um arquivo.');
    const res=await fetch(apiUrl(`/api/servers/${S.server.id}/assets?type=${encodeURIComponent(type.value)}&name=${encodeURIComponent(name.value)}`),{method:'POST',headers:{'Content-Type':'application/octet-stream'},credentials:'same-origin',body:f});
    const out=await res.json();if(!res.ok)throw Error(out.error||'Falha no envio.');
    closeModal();toast('Item enviado.');
  });}},label('Tipo',type),label('Nome',name),label('Arquivo',file),make('button',{type:'submit',class:'btn primary'},'Enviar item'));
  box.append(form);
  const list=div('section-card',make('h3',{},'Itens salvos'));
  if(!data.assets.length)list.append(make('p',{class:'dim'},'Nenhum item ainda.'));
  for(const a of data.assets)list.append(div('asset-row',
    div('asset-preview',a.type==='sound'?make('audio',{controls:true,src:a.url}):make('img',{src:a.url,alt:a.name,loading:'lazy'})),
    div('grow',make('strong',{text:`${a.type}: ${a.name}`}),make('small',{text:'Item do servidor · pronto para enviar no chat'})),
    btn('Enviar no chat',()=>task(async()=>{if(!S.channelId)throw Error('Abra um canal de texto.');await request(`/api/channels/${S.channelId}/messages`,'POST',{assetId:a.id});closeModal();await refreshMessages();}),'btn secondary small'),
    hasPerm('manage_server')?btn('Excluir',()=>confirmModal('Excluir item?',`Remover ${a.name} do servidor?`,async()=>{await request(`/api/servers/${S.server.id}/assets/${a.id}`,'DELETE');closeModal();await assetsModal();},'Excluir'),'btn ghost small'):null));
  box.append(list,div('modal-actions',btn('Fechar',closeModal,'btn ghost')));
}
async function eventsModal(){
  const data=await request(`/api/servers/${S.server.id}/events`);
  const box=modalFrame('📅 Eventos da comunidade','Crie encontros e marque presença.');
  const list=div('section-card',make('h3',{},'Próximos eventos'));
  if(!data.events.length)list.append(make('p',{class:'dim'},'Nenhum evento criado.'));
  for(const e of data.events)list.append(div('event-row',make('strong',{text:e.title}),make('p',{text:(e.description||'Sem descrição')+' · '+new Date(e.startsAt).toLocaleString('pt-BR')}),make('small',{text:`${e.going} confirmado(s) · Você: ${e.myStatus||'sem resposta'}`}),div('modal-actions',btn('Vou participar',()=>task(async()=>{await request(`/api/events/${e.id}/rsvp`,'POST',{status:'going'});closeModal();await eventsModal();}),'btn primary small'),btn('Talvez',()=>task(async()=>{await request(`/api/events/${e.id}/rsvp`,'POST',{status:'maybe'});closeModal();await eventsModal();}),'btn secondary small'))));
  box.append(list);
  if(hasPerm('create_invites'))box.append(btn('➕ Criar evento',()=>showModal('Criar evento','Defina o encontro da comunidade.',[{label:'Título',key:'title',required:true},{label:'Descrição',key:'description',type:'textarea'},{label:'Data e hora',key:'date',type:'datetime-local',required:true},{label:'Local/Link',key:'location'}],async v=>{
    await request(`/api/servers/${S.server.id}/events`,'POST',{title:v.title,description:v.description,startsAt:new Date(v.date).getTime(),location:v.location});toast('Evento criado.');
  },'Criar evento'),'btn primary'));
  box.append(div('modal-actions',btn('Fechar',closeModal,'btn ghost')));
}
function reportModal(uid,messageId=null){
  showModal('⚑ Denunciar usuário','Sua denúncia será enviada à equipe da plataforma, que deverá analisar antes de tomar uma decisão.',[
    {label:'Motivo da denúncia',key:'reason',type:'textarea',required:true}
  ],async v=>{
    await request('/api/reports','POST',{targetUserId:uid,messageId,serverId:messageId?S.server?.id:null,reason:v.reason});toast('Denúncia registrada para análise.');
  },'Enviar denúncia');
}
function createServerModal(){ showModal('Crie sua comunidade','Agora o nome do servidor aceita letras, números, espaço, emoji e símbolos. Ex.: 🎮 Tropa do Kauã, NEXUS STORE ou Meu grupo 🔥.',[
  {label:'Nome do servidor',key:'name',required:true,maxLength:80,placeholder:'Digite qualquer nome para o servidor'},{label:'Descrição (opcional)',key:'description',type:'textarea'}],async values=>{
    values.name=(values.name||'').trim();
    const data=await request('/api/servers','POST',values);await reloadServers();await openServer(data.server.id);toast('Servidor criado! 🎉');
  },'Criar servidor');}
function channelModal(){if(!S.server)return;showModal('Criar sala','Separe canais de conversa e salas de voz.',[
  {label:'Nome da sala',key:'name',required:true},{label:'Tipo',key:'type',type:'select',value:'text',options:[['text','💬 Sala de texto'],['voice','🎧 Sala de voz (áudio coletivo futuro)']]},{label:'Assunto (opcional)',key:'topic'}],async v=>{
    const data=await request('/api/servers/'+S.server.id+'/channels','POST',v);
    S.server=(await request('/api/servers/'+S.server.id)).server;
    await chooseChannel(data.channel.id);toast('Canal criado!');
  },'Criar canal');}
function channelMenu(){
  const c=S.server?.channels.find(x=>x.id===S.channelId);
  if(!c)return;
  if(!hasPerm('manage_channels')){chooseModal('Sobre o canal',c.topic||'Canal de mensagens de texto',[{label:'Entendi',onClick:async()=>{}}]);return;}
  chooseModal('Configurar #'+c.name,c.topic||'Sem descrição',[{label:'✎ Editar canal',onClick:async()=>showModal('Editar canal','Personalize o canal.',[
    {label:'Nome',key:'name',value:c.name,required:true},{label:'Assunto',key:'topic',value:c.topic},
    {label:'Modo lento',key:'slowMode',type:'select',value:String(c.slowMode),options:[['0','Desativado'],['5','5 segundos'],['10','10 segundos'],['30','30 segundos'],['60','1 minuto']]},
    {label:'🔒 Bloquear sala',key:'locked',type:'checkbox',value:!!c.locked}
  ],async v=>{await request('/api/channels/'+c.id,'PATCH',{...v,slowMode:Number(v.slowMode)});S.server=(await request('/api/servers/'+S.server.id)).server;render();toast('Canal atualizado.');},'Salvar')},
  {label:'🗑 Excluir canal',onClick:async()=>confirmModal('Excluir canal?',`Todas as mensagens de #${c.name} serão apagadas. Esta ação não tem volta.`,async()=>{await request('/api/channels/'+c.id,'DELETE');S.server=(await request('/api/servers/'+S.server.id)).server;await chooseChannel(S.server.channels[0]?.id);toast('Canal excluído.');},'Excluir canal')}]);
}
async function bannedMembersModal(){
  await task(async()=>{
    const data=await request('/api/servers/'+S.server.id+'/bans');
    const choices=data.bans.map(m=>({label:`⛔ ${m.displayName} (@${m.username})`,onClick:async()=>confirmModal('Revogar banimento?',`Permitir que ${m.displayName} entre novamente usando um convite?`,async()=>{
      await request(`/api/servers/${S.server.id}/bans/${m.userId}/unban`,'POST',{});
      toast('Banimento revogado.');await bannedMembersModal();
    },'Desbanir')}));
    chooseModal('Usuários banidos',choices.length?'Toque em um usuário para desbanir.':'Não há usuários banidos neste servidor.',choices.length?choices:[{label:'Fechar',onClick:async()=>{}}]);
  });
}
function serverMenu(){
  if(!S.server)return;
  const choices=[{label:'✉ Criar convite',onClick:()=>showInvite()},{label:'👥 Ver membros',onClick:async()=>membersModal()}];
  if(hasPerm('manage_channels'))choices.push({label:'➕ Criar canal',onClick:async()=>channelModal()},{label:'🔒 Bloquear chats e calls',onClick:()=>serverLocksModal()});
  if(hasPerm('view_reports'))choices.push({label:'📜 Histórico de moderação',onClick:async()=>{S.page='audit';await loadAudit();render();}});
  if(hasPerm('manage_members'))choices.push({label:'⛔ Gerenciar banimentos',onClick:()=>bannedMembersModal()});
  if(hasPerm('manage_bots'))choices.push({label:'🤖 Bot Guardião',onClick:()=>guardianModal()},{label:'🧩 Loja de bots',onClick:()=>botStoreModal()});
  if(hasPerm('manage_server'))choices.push({label:'✨ Emojis, figurinhas e sons',onClick:()=>assetsModal()});
  choices.push({label:'📅 Eventos da comunidade',onClick:()=>eventsModal()});
  if(S.server.role==='owner')choices.push({label:'🎭 Criar/gerenciar cargos',onClick:()=>rolesModal()});
  if(hasPerm('manage_server'))choices.push({label:'🖼 Alterar foto do servidor',onClick:()=>serverIconModal()}, {label:'⚙ Nome e descrição',onClick:async()=>showModal('Configurações do servidor','Personalize sua comunidade.',[
    {label:'Nome',key:'name',value:S.server.name,required:true,maxLength:80}, {label:'Descrição',key:'description',type:'textarea',value:S.server.description}],async v=>{
      await request('/api/servers/'+S.server.id,'PATCH',v);await reloadServers();S.server=(await request('/api/servers/'+S.server.id)).server;render();toast('Servidor atualizado.');
    },'Salvar')});
  if(S.server.role==='owner')choices.push(
    {label:'🗑 Excluir servidor',onClick:async()=>confirmModal('Excluir o servidor?',`Apagar “${S.server.name}” e todo seu histórico? Não será possível recuperar.`,async()=>{await request('/api/servers/'+S.server.id,'DELETE');await reloadServers();S.server=null;await openFriends();toast('Servidor excluído.');},'Excluir')});
  else choices.push({label:'↪ Sair do servidor',onClick:async()=>confirmModal('Sair do servidor?',`Você deixará de ver os canais de “${S.server.name}”.`,async()=>{
    await request('/api/servers/'+S.server.id+'/leave','POST',{});await reloadServers();S.server=null;await openFriends();
  },'Sair')});
  chooseModal(S.server.name,S.server.description||'Sua comunidade, suas regras.',choices);
}

function renderV35Card(title,desc,action){return div('v35-card',make('strong',{text:title}),make('p',{class:'dim',text:desc}),action||null);}
function renderShop(main){
  main.append(topbar('🛒 Loja de Efeitos','Molduras, temas e efeitos visuais sem emote de verificado.'));
  const area=div('center-view',make('span',{class:'eyebrow'},'NEXHUB STORE'),make('h1',{},'Loja de efeitos'),make('p',{class:'view-description'},'Itens visuais para perfil, nome, chat e eventos. Itens VIP continuam validados no servidor.'));
  main.append(area);area.append(empty('⏳','Carregando loja','Buscando itens...'));
  request('/api/effects-shop').then(data=>{area.replaceChildren(make('span',{class:'eyebrow'},'NEXHUB STORE'),make('h1',{},'Loja de efeitos'),div('v35-grid',...(data.items||[]).map(item=>renderV35Card(item.name,(item.description||'')+(item.locked?' · Exclusivo VIP':''),div('profile-tools',item.owned?make('span',{class:'v35-badge',text:'Desbloqueado'}):btn('Desbloquear',()=>task(async()=>{await request('/api/effects-shop/'+item.id+'/claim','POST',{});toast('Item desbloqueado.');renderShop(main);}),item.locked?'btn secondary small':'btn primary small'),item.owned?btn('Usar',()=>task(async()=>{await request('/api/effects-shop/'+item.id+'/apply','POST',{});toast('Item aplicado.');}),'btn secondary small'):null)))));}).catch(e=>{area.replaceChildren(empty('⚠️','Erro ao carregar',e.message));});
}
function renderExplore(main){
  main.append(topbar('🔎 Explorar','Encontre servidores por categoria, destaque e selos oficiais.'));
  const area=div('center-view',make('span',{class:'eyebrow'},'EXPLORAR'),make('h1',{},'Servidores em destaque'));
  main.append(area);area.append(empty('⏳','Carregando','Buscando comunidades...'));
  request('/api/explore').then(data=>{area.replaceChildren(make('span',{class:'eyebrow'},'EXPLORAR'),make('h1',{},'Servidores em destaque'),div('profile-tools',...(data.categories||[]).slice(0,10).map(c=>btn(c,()=>task(async()=>{const next=await request('/api/explore?category='+encodeURIComponent(c));drawExplore(area,next);}), 'btn secondary small'))));drawExplore(area,data);}).catch(e=>{area.replaceChildren(empty('⚠️','Erro ao carregar',e.message));});
}
function drawExplore(area,data){
  const old=area.querySelector('.v35-grid');if(old)old.remove();
  area.append(div('v35-grid',...(data.servers||[]).map(s=>renderV35Card(s.name,`${s.category||'comunidade'} · ${s.members||0} membros · ${s.boosts||0} boosts`,div('profile-tools',s.verifiedBadge?make('span',{class:'v35-title-chip',text:s.verifiedBadge}):null,btn('Abrir',()=>task(()=>openServer(s.id)),'btn primary small'))))));
}
function renderMissions(main){
  main.append(topbar('🎯 Missões','Recompensas visuais sem sistema de XP/nível.'));
  const area=div('center-view',make('span',{class:'eyebrow'},'MISSÕES'),make('h1',{},'Missões e recompensas'),make('p',{class:'view-description'},'Complete ações simples e receba recompensas visuais.'));
  main.append(area);area.append(empty('⏳','Carregando','Buscando missões...'));
  request('/api/missions').then(data=>{
    const tools=div('profile-tools',
      btn('Resgatar diária',()=>task(async()=>{const r=await request('/api/daily-reward/claim','POST',{});toast('Recompensa: '+r.reward.reward);renderMissions(main);}), 'btn primary'),
      btn('Eventos semanais',()=>task(async()=>{const ev=await request('/api/weekly-events');showModal('Eventos semanais',ev.events.map(e=>`${e.title}: ${e.reward}`).join('\n')||'Nenhum evento ativo.',[],async()=>{},'Fechar');}), 'btn secondary')
    );
    const cards=(data.missions||[]).map(m=>{
      const action=m.completed?make('span',{class:'v35-badge',text:'Completa'}):btn('Marcar progresso',()=>task(async()=>{await request('/api/missions/'+m.id+'/progress','POST',{amount:1});toast('Progresso salvo.');renderMissions(main);}), 'btn secondary small');
      return renderV35Card(m.title,`${m.description} · ${m.progress}/${m.target} · recompensa: ${m.reward}`,action);
    });
    area.replaceChildren(make('span',{class:'eyebrow'},'MISSÕES'),make('h1',{},'Missões e recompensas'),make('p',{class:'view-description',text:data.rules||''}),tools,div('v35-grid',...cards));
  }).catch(e=>{area.replaceChildren(empty('⚠️','Erro ao carregar',e.message));});
}

function renderHome(main){
  main.append(topbar('🏠 Início NexHub','Continue de onde parou',[icon('bell',()=>task(()=>navigate('notifications')),'Notificações')]));
  const unreadServers=S.servers.reduce((a,s)=>a+Number(s.unreadCount||0),0);
  const unreadDms=S.contacts.reduce((a,c)=>a+Number(c.unreadCount||0),0);
  const area=div('center-view home-view',make('span',{class:'eyebrow'},'NEXHUB HOME'),make('h1',{},'Seu painel rápido'),make('p',{class:'view-description'},'Atalhos para conversas, servidores, notificações e criação de comunidade.'));
  area.append(div('home-grid',
    div('home-card',make('strong',{text:'Servidores'}),make('span',{text:String(S.servers.length)}),make('small',{text:unreadServers?unreadServers+' mensagem(ns) nova(s)':'Tudo lido'}),btn('Abrir último servidor',()=>S.servers[0]?task(()=>openServer(S.servers[0].id)):createServerModal(),'btn primary small')),
    div('home-card',make('strong',{text:'Mensagens privadas'}),make('span',{text:String(S.contacts.length)}),make('small',{text:unreadDms?unreadDms+' PV(s) novo(s)':'Nenhum PV pendente'}),btn('Abrir PVs',()=>task(()=>openDMs()),'btn primary small')),
    div('home-card',make('strong',{text:'Notificações'}),make('span',{text:String(S.notifications.filter(n=>!n.read).length)}),make('small',{text:'Menções, respostas, amizade e avisos'}),btn('Ver alertas',()=>task(()=>navigate('notifications')),'btn secondary small')),
    div('home-card',make('strong',{text:'Criar comunidade'}),make('span',{text:'+'}),make('small',{text:'Monte um novo servidor no NexHub'}),btn('Criar servidor',createServerModal,'btn secondary small'))
  ));
  const recent=div('section-card',make('h3',{},'Conversas recentes'));
  const items=[...S.contacts].filter(c=>c.lastAt).slice(0,5);
  if(!items.length)recent.append(make('p',{class:'dim'},'Adicione amigos ou entre em um servidor para começar.'));
  for(const u of items)recent.append(contactRow(u,[u.unreadCount?make('span',{class:'dm-unread-pill',text:u.unreadCount+' nova(s)'}):null,btn('Abrir',()=>task(()=>openDM(u.id)),'btn primary small')]));
  area.append(recent,div('section-card',make('h3',{},'Documentos importantes'),make('p',{class:'dim'},'Termos, privacidade e regras da comunidade ficam disponíveis nas configurações.'),div('profile-tools',btn('Termos e privacidade',()=>task(legalModal),'btn secondary small'),btn('Configurações',()=>task(()=>navigate('settings')),'btn primary small'))));
  main.append(area);
}

function renderFriends(main){
  main.append(topbar('♟ Amigos','Conecte-se com sua galera.'));
  const area=div('center-view',make('span',{class:'eyebrow'},'NEXHUB SOCIAL'),make('h1',{},'Sua galera'),make('p',{class:'view-description'},'Adicione amigos, crie conexões e leve suas conversas para o privado quando quiser.'));
  const requestField=input('Digite o @usuário, sem @');requestField.maxLength=24;
  const submit=async()=>task(async()=>{
    await request('/api/friends/request','POST',{username:requestField.value.replace(/^@/,'')});requestField.value='';toast('Solicitação enviada.');await openFriends();
  });
  const form=make('form',{class:'inline-form',onSubmit:e=>{e.preventDefault();submit();}},requestField,make('button',{type:'submit',class:'btn primary'},'Enviar convite'));
  area.append(div('section-card',make('h3',{},'Adicionar amigo'),form));
  const f=S.friends||{friends:[],incoming:[],outgoing:[]};
  const incoming=div('section-card',make('h3',{},`Solicitações recebidas (${f.incoming.length})`));
  if(!f.incoming.length)incoming.append(make('p',{class:'dim'},'Nenhuma solicitação pendente.'));
  for(const u of f.incoming)incoming.append(contactRow(u,[btn('Aceitar',()=>task(async()=>{await request('/api/friends/'+u.id+'/accept','POST',{});await openFriends();}),'btn primary small'),btn('Recusar',()=>task(async()=>{await request('/api/friends/'+u.id+'/decline','POST',{});await openFriends();}),'btn secondary small')]));
  area.append(incoming);
  const friends=div('section-card',make('h3',{},`Amigos (${f.friends.length})`));
  if(!f.friends.length)friends.append(make('p',{class:'dim'},'Seus novos amigos aparecerão aqui.'));
  for(const u of f.friends)friends.append(contactRow(u,[btn('Mensagem',()=>task(()=>openDM(u.userId)),'btn primary small'),btn('Remover',()=>confirmModal('Remover amigo?',`Remover ${u.displayName} dos amigos?`,async()=>{await request('/api/friends/'+u.id+'/remove','POST',{});await openFriends();},'Remover'),'btn ghost small')]));
  area.append(friends);
  if(f.outgoing.length){const requests=div('section-card',make('h3',{},`Enviadas (${f.outgoing.length})`));for(const u of f.outgoing)requests.append(contactRow(u,[btn('Cancelar',()=>task(async()=>{await request('/api/friends/'+u.id+'/remove','POST',{});await openFriends();}),'btn secondary small')]));area.append(requests);}
  area.append(btn('Criar minha comunidade',createServerModal,'btn primary'));
  main.append(area);
}
function contactRow(u,actions){return div('contact',avatar(u.displayName,u.color,'',u.avatarUrl),div('grow',btn(u.displayName,()=>task(()=>showProfile(u.userId||u.id)),'contact-name'),make('small',{text:'@'+u.username})),...actions);}
function renderDMs(main){
  const header=div('inbox-header',make('h1',{text:'Mensagens'}),make('p',{text:'Todas as suas conversas do NexHub em um só lugar'}));
  main.append(header);
  const search=input('Pesquisar por nome ou @usuário');search.type='search';search.className='inbox-search';
  const list=div('inbox-list');
  const populate=()=>{
    list.replaceChildren();const query=search.value.trim().toLocaleLowerCase();
    const matches=S.contacts.filter(u=>[u.displayName,u.username].some(str=>str?.toLocaleLowerCase().includes(query)));
    if(!matches.length){list.append(empty('💬',query?'Nenhum resultado':'Ainda sem conversas',query?'Tente buscar outro nome.':'Adicione amigos e comece seu primeiro PV.'));return;}
    for(const u of matches){
      const card=make('button',{class:'inbox-contact',onClick:()=>task(()=>openDM(u.id))},
        div('inbox-avatar',avatar(u.displayName,u.color,'',u.avatarUrl),make('span',{class:'presence-dot'+(u.status==='online'?' online':'')})),
        div('inbox-contact-info',div('inbox-contact-head',make('strong',{text:u.displayName}),u.unreadCount?make('span',{class:'dm-unread-pill',text:u.unreadCount+' nova(s)'}):null,u.lastAt?make('time',{text:formatDate(u.lastAt)}):null),
          make('span',{text:u.lastPreview?(u.lastFromId===S.me.id?'Você: ':'')+u.lastPreview:'@'+u.username+' · Toque para conversar'})));
      list.append(card);
    }
  };
  search.addEventListener('input',populate);
  const count=S.notifications.filter(n=>!n.read).length;
  main.append(div('inbox-tools',div('inbox-search-wrap',symbol('search'),search),
    icon('bell',()=>task(()=>navigate('notifications')),`Notificações: ${count}`,'inbox-tool'),
    icon('user-plus',()=>task(()=>openFriends()),'Adicionar amigo','inbox-tool')),
    div('inbox-actions',btn(symbol('plus'),()=>task(()=>openFriends()),'btn primary inbox-plus'),
      btn('Adicionar amigos',()=>task(()=>openFriends()),'btn secondary inbox-add')),
    div('inbox-section-title',make('h2',{text:'Conversas recentes'}),make('span',{text:`${S.contacts.length} contato(s)`})),list);
  populate();
}
function renderDM(main){
  const c=S.dmContact;if(!c){main.append(empty('☁','Contato não encontrado','Volte à lista de conversas.'));return;}
  const header=div('topbar dm-topbar',icon('arrow-left',()=>task(()=>openDMs()),'Voltar às mensagens','mobile-only'),
    avatar(c.displayName,c.color,'',c.avatarUrl),div('dm-title',make('h2',{text:c.displayName}),make('small',{text:'@'+c.username})),div('grow'),
    icon('phone',()=>task(()=>startCall(c.id,'audio')),'Chamada de voz'),icon('video',()=>task(()=>startCall(c.id,'video')),'Chamada de vídeo'),icon('users',()=>task(()=>showProfile(c.id)),'Ver perfil'));
  main.append(header);
  const scroll=div('chat-area dm-area');scroll.id='dm-scroll';
  if(!S.dmMessages.length)scroll.append(empty('💬','Comece essa conversa','Envie uma mensagem para iniciar.'));
  for(const msg of S.dmMessages)scroll.append(renderDMMessage(msg));
  main.append(scroll);scroll.scrollTop=scroll.scrollHeight;
  const field=make('textarea',{rows:1,id:'dm-compose',placeholder:'Enviar mensagem para '+c.displayName,'aria-label':'Mensagem privada'});
  const send=()=>task(async()=>{const content=field.value.trim();if(!content)return;field.disabled=true;try{await request('/api/dms/'+S.dmUser+'/messages','POST',{content});field.value='';await openDM(S.dmUser,true);}finally{field.disabled=false;}});
  field.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send();}});
  main.append(div('chat-bottom',div('composer',icon('mic',()=>task(()=>voiceMessageModal('dm')),'Gravar mensagem de voz','voice-record-trigger'),field,btn(symbol('send'),send,'btn primary send-btn'))));
}
function voicePlayer(voice,label='Mensagem de voz') {
  return div('voice-message',div('voice-icon','🎙️'),div('grow',make('strong',{text:label}),make('audio',{controls:true,preload:'metadata',src:voice.url,class:'voice-audio'})));
}
function renderDMMessage(msg){
  const box=div('dm-msg'+(msg.fromId===S.me.id?' mine':''));
  if(msg.voice)box.append(voicePlayer(msg.voice,msg.fromId===S.me.id?'Sua mensagem de voz':'Mensagem de voz'));
  else box.append(msg.content);
  box.append(make('small',{text:formatDate(msg.createdAt)}));
  return box;
}
function voiceMimeType(){
  if(!window.MediaRecorder)return '';
  for(const type of ['audio/webm;codecs=opus','audio/webm','audio/ogg;codecs=opus','audio/ogg'])if(MediaRecorder.isTypeSupported?.(type))return type;
  return '';
}
async function sendVoiceBlob(kind,blob){
  const endpoint=apiUrl(kind==='dm'?('/api/dms/'+S.dmUser+'/messages/voice-message'):('/api/channels/'+S.channelId+'/voice-message'));
  const res=await fetch(endpoint,{method:'POST',credentials:'same-origin',headers:{'Content-Type':blob.type||'application/octet-stream'},body:blob});
  const data=await res.json().catch(()=>({error:'Falha ao enviar áudio.'}));
  if(!res.ok)throw Error(data.error||'Falha ao enviar áudio.');
  if(kind==='dm')await openDM(S.dmUser,true); else await refreshMessages();
}
async function voiceMessageModal(kind='channel'){
  if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder)throw Error('Seu navegador não suporta gravação de voz. Use Chrome/Edge/Firefox atualizado com HTTPS.');
  const stream=await navigator.mediaDevices.getUserMedia({audio:callAudioConstraints(),video:false});
  const chunks=[]; let blob=null; let startedAt=0;
  const type=voiceMimeType();
  const recorder=new MediaRecorder(stream,type?{mimeType:type}:undefined);
  activeVoiceRecorder=recorder;
  const box=modalFrame('Mensagem de voz','Grave um áudio curto para enviar no chat. Funciona melhor em HTTPS no celular.');
  const status=make('p',{class:'voice-rec-status',text:'Pronto para gravar.'});
  const timer=make('strong',{class:'voice-rec-timer',text:'00:00'});
  const preview=div('voice-preview');
  let timerId=null;
  const stopTracks=()=>{try{stream.getTracks().forEach(t=>t.stop());}catch{} if(activeVoiceRecorder===recorder)activeVoiceRecorder=null;};
  const updateTimer=()=>{const s=Math.floor((Date.now()-startedAt)/1000);timer.textContent=String(Math.floor(s/60)).padStart(2,'0')+':'+String(s%60).padStart(2,'0');};
  recorder.ondataavailable=e=>{if(e.data?.size)chunks.push(e.data);};
  recorder.onstop=()=>{clearInterval(timerId);blob=new Blob(chunks,{type:recorder.mimeType||'audio/webm'});status.textContent='Gravação pronta. Escute antes de enviar.';preview.replaceChildren(make('audio',{controls:true,src:URL.createObjectURL(blob),class:'voice-audio'}));stopBtn.disabled=true;startBtn.disabled=true;sendBtn.disabled=false;};
  const startBtn=btn('● Começar gravação',()=>{chunks.length=0;blob=null;startedAt=Date.now();timer.textContent='00:00';timerId=setInterval(updateTimer,300);recorder.start();status.textContent='Gravando... fale perto do microfone.';startBtn.disabled=true;stopBtn.disabled=false;sendBtn.disabled=true;},'btn danger');
  const stopBtn=btn('■ Parar',()=>{if(recorder.state==='recording')recorder.stop();},'btn secondary');stopBtn.disabled=true;
  const sendBtn=btn('Enviar áudio',()=>task(async()=>{if(!blob)throw Error('Grave o áudio primeiro.');sendBtn.disabled=true;await sendVoiceBlob(kind,blob);stopTracks();closeModal();toast('Mensagem de voz enviada.');}),'btn primary');sendBtn.disabled=true;
  const cancelBtn=btn('Cancelar',()=>{if(recorder.state==='recording')recorder.stop();stopTracks();closeModal();},'btn ghost');
  box.append(div('voice-recorder-card',div('voice-rec-dot'),timer,status,preview),div('modal-actions',startBtn,stopBtn,sendBtn,cancelBtn));
}
function renderNotifications(main){
  main.append(topbar('🔔 Notificações','Tudo que importa no NexHub em um só lugar'));
  const unread=S.notifications.filter(n=>!n.read).length;
  const area=div('center-view',make('span',{class:'eyebrow'},'NEXHUB ALERTAS'),make('h1',{},'Sua central de notificações'),make('p',{class:'view-description'},unread?`${unread} notificação(ões) não lida(s).`:'Tudo lido por enquanto.'));
  const card=div('section-card notifications-card',make('h3',{},'Últimas novidades'));
  if(!S.notifications.length)card.append(empty('🔔','Nenhuma notificação','As novidades aparecerão por aqui.'));
  for(const n of S.notifications){
    const open=()=>task(async()=>{await request('/api/notifications/'+n.id,'PATCH',{}).catch(()=>{});await loadNotifications();if(n.href?.startsWith('/app?')) {const q=new URLSearchParams(n.href.split('?')[1]);if(q.has('server'))await openServer(q.get('server'),q.get('channel'));else if(q.has('dm'))await openDM(q.get('dm'));else if(q.has('tab'))await navigate(q.get('tab'));else render();}else render();});
    const row=div('notification-row'+(n.read?'':' unread'),make('button',{class:'notification-main',onClick:open},make('strong',{text:(n.read?'':'●  ')+n.text}),make('small',{text:formatDate(n.createdAt)})),div('notification-actions',n.read?null:btn('Lida',()=>task(async()=>{await request('/api/notifications/'+n.id,'PATCH',{});await loadNotifications();render();}),'btn secondary small'),btn('Apagar',()=>task(async()=>{await request('/api/notifications/'+n.id,'DELETE',{});await loadNotifications();render();}),'btn ghost small')));
    card.append(row);
  }
  area.append(card,div('profile-tools',btn('Marcar todas como lidas',()=>task(async()=>{await request('/api/notifications/read','POST',{});await loadNotifications();render();}),'btn secondary'),btn('Atualizar',()=>task(async()=>{await loadNotifications();render();}),'btn ghost')));
  main.append(area);
}

async function vipModal(){
  const data=await request('/api/vip');
  const vip=data.vip||{};
  const box=modalFrame('💎 NexHub VIP','Plano de R$ 5 por 30 dias. No Pix direto ao Nubank, o criador libera o VIP depois de conferir o crédito; com provedor compatível, a confirmação pode ser automática. VIP não libera painel admin.');
  const hero=div('vip-hero',make('span',{class:'vip-price',text:'R$ 5'}),make('h2',{text:vip.active?'Você já é VIP':'NexHub VIP'}),make('p',{text:vip.active?('Seu VIP está ativo: '+vipDaysText(vip)):'Benefícios visuais e sociais sem dar acesso administrativo.'}));
  const grid=div('vip-benefits',...vipBenefits.map(([icon,text])=>div('vip-benefit',make('strong',{text:icon}),make('span',{text}))));
  const current=div('section-card',make('h3',{},'Status do seu VIP'),make('p',{class:vip.active?'vip-ok':'dim',text:vip.active?`Ativo até ${vip.until==='forever'?'sem data final':formatDate(vip.until)} · Plano: ${vip.plan||'VIP R$5'}`:'VIP ainda não está ativo na sua conta.'}),make('p',{class:'dim'},'Administração do app não faz parte do VIP. O VIP só recebe benefícios de perfil, boost, bot e visual.'));
  const pay=div('section-card vip-pay-card',make('h3',{},'Pagar com Pix'),make('p',{class:'dim'},data.pix?.configured?'Gere o Pix de R$ 5 com sua chave, QR Code e copia-e-cola. O criador libera o VIP depois de conferir o crédito no Nubank; print enviado não confirma pagamento.':'Chave Pix ainda não configurada. Depois de configurar PIX_RANDOM_KEY nos Secrets do Replit, o sistema gera o QR Code e o copia-e-cola.'));
  const webhook=data.webhook||{};
  pay.append(div('pix-ready-note',make('strong',{text:webhook.ready?'✅ Webhook automático pronto':'ℹ️ Confirmação manual disponível'}),make('p',{text:webhook.ready?'O provedor pode ativar o VIP automaticamente; no Pix direto para a chave, o criador também pode conferir o crédito no Nubank.':'O Pix cai direto na chave. O criador confirma o pagamento no painel depois de conferir o crédito no Nubank. Um provedor com webhook é opcional para automatizar.'}),webhook.endpoint?make('small',{text:'Endpoint para provedor: '+webhook.endpoint}):null));
  const paymentBox=div('vip-payment-box');
  const pollPayment=p=>{
    if(vipPaymentPoll){clearInterval(vipPaymentPoll);vipPaymentPoll=null;}
    if(!p||!['pending','expired'].includes(p.status))return;
    vipPaymentPoll=setInterval(async()=>{
      try{
        if(!document.body.contains(paymentBox)){clearInterval(vipPaymentPoll);vipPaymentPoll=null;return;}
        const fresh=await request('/api/vip/payments/'+p.id);
        if(fresh.payment?.status!==p.status)renderPayment(fresh.payment);
        if(fresh.vip?.active){S.me={...S.me,vipActive:true,vipUntil:fresh.vip.until,vipDaysLeft:fresh.vip.daysLeft};toast('Pagamento confirmado. Seu VIP NexHub foi ativado!');clearInterval(vipPaymentPoll);vipPaymentPoll=null;}
      }catch{}
    },8000);
  };
  const renderPayment=p=>{
    paymentBox.replaceChildren();
    if(!p)return;
    const qr=div('pix-qr-box');
    if(p.pixQrSvg){qr.innerHTML=p.pixQrSvg;qr.append(make('small',{text:'Escaneie este QR Code no app do seu banco.'}));}
    paymentBox.append(make('p',{class:p.status==='paid'?'vip-ok':'dim',text:'Referência: '+p.reference+' · Status: '+p.status}),
      p.status==='pending'?make('p',{class:'dim'},'Aguardando conferência do pagamento. Print enviado por usuário não libera o VIP.'):null,
      p.status==='expired'?make('p',{class:'dim'},'Este pedido expirou. Se você já pagou, o criador pode conferir o crédito no Nubank e confirmar o VIP.'):null,
      p.pixQrSvg?qr:null,
      p.pixKey?div('pix-key-card',
        make('strong',{text:'Chave Pix aleatória'}),
        make('textarea',{class:'pix-copy pix-key-copy',readonly:true,value:p.pixKey}),
        btn('Copiar chave Pix',()=>navigator.clipboard?.writeText(p.pixKey).then(()=>toast('Chave Pix copiada!')),'btn secondary small')
      ):null,
      p.pixPayload?make('textarea',{class:'pix-copy',readonly:true,value:p.pixPayload}):make('p',{class:'dim'},'Sem payload Pix porque falta configurar PIX_RANDOM_KEY.'),
      div('profile-tools',p.pixPayload?btn('Copiar Pix copia-e-cola',()=>navigator.clipboard?.writeText(p.pixPayload).then(()=>toast('Pix copiado!')),'btn primary small'):null,btn('Atualizar status',()=>task(async()=>{const fresh=await request('/api/vip/payments/'+p.id);renderPayment(fresh.payment);if(fresh.vip?.active){S.me={...S.me,vipActive:true,vipUntil:fresh.vip.until,vipDaysLeft:fresh.vip.daysLeft};toast('VIP ativado!');}}),'btn secondary small')));
    pollPayment(p);
  };
  if((data.payments||[])[0])renderPayment(data.payments[0]);
  pay.append(paymentBox,div('profile-tools',vip.active?make('span',{class:'pill vip-pill',text:'💎 VIP ativo'}):btn('Gerar Pix R$ 5',()=>task(async()=>{const r=await request('/api/vip/payments','POST',{});renderPayment(r.payment);toast('Pix gerado. Pague pelo QR Code ou copia-e-cola.');}),'btn primary')),
    make('p',{class:'dim'},'Anti-golpe: comprovante enviado pelo usuário não ativa VIP. O provedor confirma por webhook ou o criador confirma depois de conferir o crédito no Nubank.'));
  box.append(hero,grid,current,pay,div('modal-actions',btn('Fechar',closeModal,'btn ghost')));
}
async function vipCatalogModal(){
  const data=await request('/api/vip/catalog');
  const box=modalFrame('Catálogo VIP NexHub','Tudo que o VIP de R$ 5 libera sem dar acesso de admin.');
  const plan=data.plans?.[0]||{};
  box.append(div('vip-catalog-card',make('h2',{},plan.name||'NexHub VIP'),make('strong',{class:'vip-price',text:'R$ '+Number(plan.priceBRL||5).toFixed(2)+' / 30 dias'}),make('p',{class:'dim'},'Benefícios visuais, sociais e de personalização. Não é pay-to-win e não libera painel admin.')));
  const list=div('vip-benefit-grid');
  for(const b of plan.benefits||[])list.append(div('vip-mini-benefit',make('strong',{text:b.title}),make('small',{text:b.desc})));
  for(const x of plan.exclusive||[])list.append(div('vip-mini-benefit premium',make('strong',{text:'💎 '+x}),make('small',{text:'Exclusivo VIP validado no servidor.'})));
  box.append(list,div('modal-actions',btn('Abrir pagamento Pix',()=>task(vipModal),'btn primary'),btn('Fechar',closeModal,'btn ghost')));
}
async function securityStatusModal(){
  const data=await request('/api/security/status');
  const box=modalFrame('Anti-hack da conta','Status de segurança do seu dispositivo, login e benefícios VIP.');
  const meter=div('security-score',make('strong',{text:String(data.score||0)}),make('span',{text:'pontos de segurança'}));
  const sessions=div('section-card compact-card',make('h3',{},'Sessões recentes'));
  for(const s of data.sessions||[])sessions.append(div('audit-row',make('strong',{text:s.ip||'IP oculto'}),make('p',{text:s.userAgent||'navegador'}),make('small',{text:formatDate(s.createdAt)})));
  const events=div('section-card compact-card',make('h3',{},'Eventos de segurança'));
  for(const e of data.events||[])events.append(div('audit-row',make('strong',{text:e.kind}),make('p',{text:e.detail||'sem detalhe'}),make('small',{text:formatDate(e.createdAt)+' · '+(e.ip||'')})));
  if(!(data.events||[]).length)events.append(make('p',{class:'dim'},'Nada suspeito nessa conta.'));
  box.append(meter,div('turn-status-box',...(data.notes||[]).map(x=>make('p',{class:'dim',text:x}))),sessions,events,div('modal-actions',btn('Fechar',closeModal,'btn primary')));
}
async function creatorSecurityModal(){
  const data=await request('/api/creator/security-dashboard');
  const box=modalFrame('Central anti-hack','Eventos, uploads e checklist de produção do NexHub.');
  const s=data.summary||{};
  box.append(div('creator-grid compact',statCard('Eventos 24h',s.events24h||0,'Segurança'),statCard('Login falho',s.failedLogins24h||0,'24h'),statCard('Pix suspeito',s.suspiciousPix24h||0,'24h'),statCard('Uploads',s.uploads24h||0,'24h')));
  const ready=div('section-card',make('h3',{},'Checklist produção'));
  for(const item of data.readiness||[])ready.append(div('checklist-row '+(item.ok?'ok':'warn'),make('strong',{text:(item.ok?'✅ ':'⚠️ ')+item.title}),make('p',{text:item.detail})));
  const events=div('section-card',make('h3',{},'Últimos eventos'));
  for(const e of data.events||[])events.append(div('audit-row',make('strong',{text:e.kind}),make('p',{text:e.detail||'sem detalhe'}),make('small',{text:formatDate(e.createdAt)+' · '+(e.ip||'')})));
  const uploads=div('section-card',make('h3',{},'Uploads auditados'));
  for(const u of data.uploads||[])uploads.append(div('audit-row',make('strong',{text:u.kind+' · '+u.ext+' · '+Math.round((u.bytes||0)/1024)+' KB'}),make('p',{text:u.verdict+' · '+(u.sha256||'').slice(0,16)}),make('small',{text:formatDate(u.createdAt)})));
  box.append(ready,events,uploads,div('modal-actions',btn('Fechar',closeModal,'btn primary')));
}
async function productionChecklistModal(){
  const data=await request('/api/creator/production-checklist');
  const box=modalFrame('Checklist de produção','O que falta configurar para rodar com Pix, VIP, áudio e PWA em produção.');
  box.append(div('turn-status-box',make('p',{class:'dim',text:data.note||''}),...(data.items||[]).map(item=>div('checklist-row '+(item.ok?'ok':'warn'),make('strong',{text:(item.ok?'✅ ':'⚠️ ')+item.title}),make('p',{text:item.detail})))),div('modal-actions',btn('Fechar',closeModal,'btn primary')));
}
function vipAdminModal(u){
  showModal('Gerenciar VIP de @'+u.username,'Ative ou remova o VIP manualmente. Use isso depois de receber R$ 5 por Pix ou outro pagamento.',[
    {label:'Dias de VIP',key:'days',type:'number',value:'30',required:true},
    {label:'Plano',key:'plan',value:'VIP R$5',required:true},
    {label:'Observação',key:'note',type:'textarea',value:'Pago manualmente pelo plano de R$ 5'}
  ],async v=>{await request('/api/creator/users/'+u.id+'/vip','POST',{action:'activate',days:Number(v.days||30),plan:v.plan,note:v.note});toast('VIP ativado para @'+u.username);closeModal();await showCreatorUser(u.id);},'Ativar VIP');
}
async function removeVipAdmin(u){
  await request('/api/creator/users/'+u.id+'/vip','POST',{action:'remove',note:'Removido pelo criador'});
  toast('VIP removido de @'+u.username);closeModal();await showCreatorUser(u.id);
}
function renderSettings(main){
  main.append(topbar('⚙ Configurações','Sua conta, seu estilo'));
  const area=div('center-view',make('span',{class:'eyebrow'},'NEXHUB ID'),make('h1',{},'Sua identidade'),make('p',{class:'view-description'},'Personalize seu perfil, sua presença e sua experiência no NexHub. Alterações ficam salvas na sua conta.'));
  const name=input('Nome de exibição',S.me.displayName);name.maxLength=40;
  const bio=make('textarea',{rows:3,placeholder:'Conte algo sobre você...',value:S.me.bio});bio.maxLength=180;
  const color=make('input',{type:'color',class:'color-input',value:S.me.color});
  const status=make('select',{},...[['online','🟢 Online'],['away','🌙 Ausente'],['dnd','🔕 Não perturbe'],['invisible','⚪ Invisível']].map(([value,title])=>make('option',{value,selected:S.me.status===value},title)));
  const theme=make('select',{},...[['dark','🌙 Escuro'],['light','☀ Claro']].map(([value,title])=>make('option',{value,selected:S.me.theme===value},title)));
  const profileEffect=make('select',{class:'sr-only','aria-label':'Animação de perfil'},...profileEffectOptions.map(([value,title])=>make('option',{value,selected:(S.me.profileEffect||'none')===value},title)));
  const vipNameStyle=make('select',{},...[["","Padrão"],["neon","Neon"],["gold","Dourado"],["rainbow","Arco-íris"],["ice","Gelo"],["fire","Fogo"],["glitch","Glitch"],["angel","Angel"],["shadow","Sombra"]].map(([value,title])=>make('option',{value,selected:(S.me.vipNameStyle||'')===value},title)));
  const previewHolder=div('profile-live-preview');
  const renderProfilePreview=()=>{previewHolder.replaceChildren(profileDisplay({...S.me,displayName:name.value||S.me.displayName,bio:bio.value||S.me.bio,color:color.value||S.me.color,profileEffect:profileEffect.value},true));};
  const effectGallery=div('effect-gallery');
  const syncEffectCards=()=>{for(const card of effectGallery.querySelectorAll('.effect-card'))card.classList.toggle('active',card.dataset.effect===profileEffect.value);};
  for(const [value,title] of profileEffectOptions){
    const sample=div('effect-sample '+profileEffectClass(value),profileEffectLayer(value));
    const card=make('button',{type:'button',class:'effect-card'+(((S.me.profileEffect||'none')===value)?' active':''),'data-effect':value,onClick:()=>{profileEffect.value=value;syncEffectCards();renderProfilePreview();}},sample,make('strong',{text:title}),make('span',{text:profileEffectPreviewText(value)}));
    effectGallery.append(card);
  }
  name.addEventListener('input',renderProfilePreview);bio.addEventListener('input',renderProfilePreview);color.addEventListener('input',renderProfilePreview);
  renderProfilePreview();
  const allowDm=make('input',{type:'checkbox',checked:!!S.me.allowDm});
  const form=make('form',{onSubmit:e=>{e.preventDefault();task(async()=>{
    const data=await request('/api/me','PATCH',{displayName:name.value,bio:bio.value,color:color.value,status:status.value,theme:theme.value,profileEffect:profileEffect.value,allowDm:allowDm.checked,vipNameStyle:vipNameStyle.value});
    S.me=data.user;render();toast('Seu perfil foi salvo!');
  });}},div('settings-grid settings-grid-premium',div('',label('Nome de exibição',name),label('Sua bio',bio),label('Cor do avatar',color),label('Seu status',status),label('Aparência',theme),label('Estilo do nome VIP',vipNameStyle),label('Privacidade',div('',allowDm,'  Permitir DMs de outros usuários'))),div('profile-customizer',make('span',{class:'eyebrow'},'PRÉVIA AO VIVO'),previewHolder,make('h3',{},'Efeitos do perfil'),make('p',{class:'dim'},'Escolha uma animação igual card premium: ela aparece para você e para quem abrir seu perfil.'),profileEffect,effectGallery)),make('button',{type:'submit',class:'btn primary'},'Salvar alterações'));
  const avatarInput=make('input',{type:'file',accept:'image/*',class:'file-upload','aria-label':'Escolher foto de perfil'});
  const bannerInput=make('input',{type:'file',accept:'image/*,video/mp4',class:'file-upload','aria-label':'Escolher imagem ou vídeo para o banner'});
  avatarInput.addEventListener('change',()=>task(()=>uploadProfileMedia('avatar',avatarInput)));
  bannerInput.addEventListener('change',()=>task(()=>uploadProfileMedia('banner',bannerInput)));
  const mediaBox=div('section-card',make('h3',{},'Foto e banner do perfil'),profileDisplay(S.me),
    make('p',{class:'dim'},'Escolha sua própria imagem da galeria. Para banner animado, use vídeo MP4 de até 10 segundos. Foto: até 5 MB. Banner: até 18 MB. O efeito escolhido aparece quando alguém abre seu perfil. A v11 também tem efeitos de vídeo premium enviados por você.'),
    div('profile-upload-grid',label('Sua foto de perfil',avatarInput),label('Imagem ou vídeo do banner',bannerInput)),
    div('profile-tools',btn('Remover foto',()=>task(()=>deleteProfileMedia('avatar')),'btn secondary small'),btn('Remover banner',()=>task(()=>deleteProfileMedia('banner')),'btn secondary small'),btn('Ver meu perfil',()=>task(()=>showProfile(S.me.id)),'btn primary small')));
  area.append(div('section-card install-card',make('h3',{},'📲 Instalar o NexHub'),make('p',{class:'dim'},'Você pode instalar o NexHub no Android, iPhone e PC como aplicativo. Em alguns navegadores o botão de instalar aparece automaticamente.'),div('profile-tools',btn('Instalar app',()=>task(installPWA),'btn primary small'))),mediaBox,div('section-card',make('h3',{},`Dados de @${S.me.username}`),form));
  area.append(div('section-card backup-card',make('h3',{},'💾 Backup e exportação'),
    make('p',{class:'dim'},'Exporte uma cópia dos seus dados. O criador do app também pode gerar backup completo do banco e da mídia no servidor.'),
    div('profile-tools',btn('Exportar minha conta',()=>task(exportMyData),'btn primary small'),S.me.isPlatformAdmin?btn('Criar backup completo',()=>task(createCreatorBackup),'btn secondary small'):null),
    make('p',{class:'dim'},S.me.isPlatformAdmin?'Backup completo salva banco e mídia em /backups. Copie essa pasta antes de trocar de Replit/hospedagem.':'Seu arquivo JSON ajuda a guardar suas informações principais.')));
  area.append(div('section-card email-security-card',make('h3',{},'📧 Verificação de e-mail'),
    make('p',{class:'dim'},!S.me.hasEmail?'Esta conta foi criada sem e-mail. O acesso funciona com usuário e senha; a recuperação por e-mail não está disponível.':S.me.emailVerified?'Seu e-mail está verificado: '+(S.me.email||'cadastrado'):'Verifique o e-mail da conta para reforçar recuperação e segurança. Em produção, configure SMTP para enviar o código automaticamente.'),
    div('profile-tools',!S.me.hasEmail?make('span',{class:'pill',text:'Sem e-mail'}):S.me.emailVerified?make('span',{class:'pill',text:'Verificado'}):btn('Gerar código',()=>task(requestEmailVerification),'btn primary small'),S.me.hasEmail&&!S.me.emailVerified?btn('Confirmar código',()=>emailVerificationConfirmModal(),'btn secondary small'):null)));
  area.append(div('section-card vip-settings-card',make('span',{class:'eyebrow'},'NEXHUB VIP'),make('h3',{},'💎 VIP por R$ 5,00'),
    make('p',{class:'dim'},isVipUser(S.me)?'Seu VIP está ativo: '+vipDaysText(S.me):'Plano tipo Nitro simples: badge, nome brilhando, moldura, efeitos e destaque visual.'),
    div('profile-tools',isVipUser(S.me)?make('span',{class:'pill vip-pill',text:'💎 VIP ativo'}):make('span',{class:'pill',text:'R$ 5/mês'}),btn('Ver benefícios VIP',()=>task(vipCatalogModal),'btn primary small'),btn('Pagar com Pix',()=>task(vipModal),'btn secondary small'))));
  area.append(div('section-card',make('h3',{},'🔐 Segurança extra e notificações'),
    btn('Ativar 2FA',()=>task(()=>setup2FA()),'btn secondary'),
    btn('Desativar 2FA',()=>task(()=>disable2FA()),'btn secondary'),
    btn('Ativar notificações no dispositivo',()=>task(()=>enableDeviceNotifications()),'btn primary'),
    btn('Ver anti-hack da conta',()=>task(securityStatusModal),'btn secondary'),
    btn('Verificar push',()=>task(pushStatusModal),'btn secondary'),
    btn('Assistente push',()=>task(pushSetupModal),'btn secondary'),
    make('p',{class:'dim'},'2FA usa aplicativo autenticador. As notificações funcionam melhor quando o app está instalado como PWA; envio com app fechado exige configuração Web Push em produção.')));
  area.append(div('section-card call-doctor-card',make('h3',{},'📞 Teste de áudio e call'),
    make('p',{class:'dim'},'Antes de testar chamada com outra pessoa, use estes botões para confirmar permissão do microfone, saída de som, WebRTC/HTTPS e TURN para internet móvel.'),
    div('profile-tools',btn('Abrir diagnóstico da call',()=>callDoctorModal(),'btn primary small'),btn('Configurar áudio',()=>task(callAudioSettingsModal),'btn secondary small'),btn('Verificar TURN',()=>task(turnStatusModal),'btn secondary small'),btn('Assistente TURN',()=>task(turnSetupWizardModal),'btn secondary small'),btn('Testar microfone',()=>task(testLocalMicrophone),'btn secondary small'),btn('Testar som do aparelho',()=>task(testDeviceSpeaker),'btn secondary small')),
    make('p',{class:'dim'},'Se o vídeo aparecer mas o som não, toque em Forçar áudio dentro da call. Se áudio remoto não chegar em dados móveis, configure TURN real no .env e use esta tela para verificar.')));
  if(S.me.isPlatformAdmin)area.append(div('section-card',make('h3',{},'🛡️ Moderação da plataforma'),btn('Analisar denúncias',()=>task(()=>moderationPanel()),'btn primary'),btn('Recursos e recuperação',()=>task(()=>appealsPanel()),'btn secondary'),btn('Central anti-hack',()=>task(creatorSecurityModal),'btn secondary'),btn('Checklist produção',()=>task(productionChecklistModal),'btn secondary')));
  area.append(div('section-card legal-card',make('h3',{},'📜 Termos, privacidade e regras'),make('p',{class:'dim'},'Documentos básicos para deixar o NexHub com cara de app profissional e preparado para produção.'),div('profile-tools',btn('Abrir documentos',()=>task(legalModal),'btn primary small'))));
  area.append(div('section-card',make('h3',{},'Segurança e conta'),
    btn('🔑 Trocar senha',()=>showModal('Alterar senha','Sua senha protege sua conta nos três dispositivos.',[{label:'Senha atual',key:'currentPassword',type:'password',required:true},{label:'Nova senha (10+ caracteres)',key:'newPassword',type:'password',required:true}],async v=>{await request('/api/me/password','POST',v);toast('Senha alterada. Outras sessões encerradas.');},'Alterar senha'),'btn secondary'),
    btn('🗑 Excluir minha conta',()=>showModal('Excluir permanentemente a conta','Isto remove seu perfil, mensagens e servidores criados por você. Não é possível desfazer.',[{label:'Sua senha',key:'password',type:'password',required:true},{label:'Digite EXCLUIR',key:'confirm',required:true}],async v=>{await request('/api/me/account','DELETE',v);closeEvents();S.me=null;S.servers=[];S.server=null;renderAuth();toast('Conta excluída.');},'Excluir definitivamente'),'btn danger'),make('p',{class:'dim'},'Sua senha é protegida por hash scrypt e sua sessão fica em cookie HttpOnly. Para recuperar senha por e-mail ou entrar com Google será necessária uma integração de produção.'),
    btn('Sair da minha conta',()=>confirmModal('Encerrar sessão?','Você precisará entrar novamente.',async()=>{await request('/api/logout','POST',{});closeEvents();S.me=null;S.server=null;S.servers=[];renderAuth();},'Sair'),'btn danger')));
  main.append(area);
}


async function getTurnStatus(){
  try{turnDiagnostics=await request('/api/calls/turn-status');return turnDiagnostics;}
  catch(e){turnDiagnostics={turnConfigured:false,warnings:['Não foi possível consultar o status TURN: '+(e.message||'erro')],advice:'Tente recarregar o app.'};return turnDiagnostics;}
}
async function getTurnSetupGuide(){
  try{return await request('/api/calls/turn-setup');}
  catch(e){return {ready:false,missing:['Não foi possível abrir o assistente TURN'],checklist:['Recarregue o app e tente de novo.'],notes:[e.message||'erro'],exampleEnv:'',staticExampleEnv:'',coturnConfig:'',status:turnDiagnostics||null};}
}
async function copyText(text,label='Texto'){
  try{await navigator.clipboard.writeText(String(text||''));toast(label+' copiado.');}
  catch{toast('Não consegui copiar automaticamente. Segure no texto e copie manualmente.',true);}
}
function turnStatusSummary(status){
  if(!status)return 'Ainda não verificado.';
  if(status.provider==='Metered'&&status.turnConfigured)return status.relayForced?'Metered configurado e relay forçado para diagnóstico.':'TURN da Metered carregado e pronto para redes móveis difíceis.';
  if(status.meteredConfigured&&status.meteredAvailable===false)return status.turnConfigured?'Metered indisponível; usando TURN alternativo.':'Metered indisponível; as chamadas podem falhar.';
  if(status.turnConfigured&&status.relayForced)return 'TURN configurado e relay forçado para diagnóstico.';
  if(status.turnConfigured)return 'TURN configurado e pronto para redes móveis difíceis.';
  return 'TURN ainda não está configurado no .env.';
}
function turnStatusDetails(status){
  if(!status)return ['Clique em verificar TURN.'];
  const lines=[
    'STUN: '+(status.stunConfigured?'ok ('+(status.stunUrlCount||0)+')':'não configurado'),
    'TURN: '+(status.turnConfigured?'ok ('+(status.turnUrlCount||0)+')':'não configurado'),
    'Provedor: '+(status.provider||'TURN próprio/alternativo'),
    'Modo: '+(status.authMode==='metered'?'credenciais da API Metered':status.authMode==='temporary'?'credencial temporária segura':status.authMode==='static'?'usuário/senha fixos':'sem credencial'),
    'Política ICE: '+(status.iceTransportPolicy||'all')
  ];
  if(status.warnings?.length)lines.push('Avisos: '+status.warnings.join(' | '));
  if(status.advice)lines.push('Dica: '+status.advice);
  return lines;
}
function turnStatusBadge(status){return make('span',{class:'turn-badge '+(status?.turnConfigured?'ok':'warn'),text:status?.turnConfigured?'TURN pronto':'TURN pendente'});}
async function turnStatusModal(){
  const status=await getTurnStatus();
  const box=modalFrame('TURN e internet móvel','TURN ajuda chamadas em dados móveis, Wi‑Fi bloqueado e NAT restrito. O segredo fica só no servidor; o frontend recebe apenas credenciais temporárias.');
  const rows=div('turn-status-box',
    div('turn-status-head',turnStatusBadge(status),make('strong',{text:turnStatusSummary(status)})),
    ...turnStatusDetails(status).map(text=>make('p',{class:'dim',text}))
  );
  box.append(rows,div('modal-actions',btn('Verificar de novo',()=>task(turnStatusModal),'btn secondary'),btn('Abrir assistente TURN',()=>task(turnSetupWizardModal),'btn primary'),btn('Fechar',closeModal,'btn ghost')));
}
async function turnSetupWizardModal(){
  const guide=await getTurnSetupGuide();
  const status=guide.status||turnDiagnostics;
  const box=modalFrame('Assistente TURN do NexHub','Use este assistente para preparar o .env e o servidor TURN real. Nenhum segredo atual aparece aqui.');
  const envPre=make('pre',{class:'code-card',text:guide.exampleEnv||''});
  const staticPre=make('pre',{class:'code-card',text:guide.staticExampleEnv||''});
  const coturnPre=make('pre',{class:'code-card',text:guide.coturnConfig||''});
  const missing=(guide.missing||[]).length?('Falta configurar: '+guide.missing.join(', ')):'TURN parece pronto.';
  const steps=make('ol',{class:'turn-checklist'},...(guide.checklist||[]).map(text=>make('li',{text})));
  const notes=div('turn-notes',...(guide.notes||[]).map(text=>make('p',{class:'dim',text})));
  box.append(div('turn-status-box turn-wizard-box',
    div('turn-status-head',turnStatusBadge(status),make('strong',{text:missing})),
    make('p',{class:'dim',text:turnStatusSummary(status)}),
    make('h3',{},'Passo a passo'),steps,
    make('h3',{},'.env recomendado'),envPre,
    make('h3',{},'.env alternativo com usuário/senha'),staticPre,
    make('h3',{},'Exemplo coturn'),coturnPre,
    make('h3',{},'Observações'),notes
  ),div('modal-actions',btn('Copiar .env',()=>task(()=>copyText(guide.exampleEnv,'.env TURN')),'btn primary'),btn('Copiar coturn',()=>task(()=>copyText(guide.coturnConfig,'Config coturn')),'btn secondary'),btn('Verificar TURN',()=>task(turnStatusModal),'btn secondary'),btn('Fechar',closeModal,'btn ghost')));
}

async function exportMyData(){
  const data=await request('/api/me/export');
  const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url;a.download='nexhub-minha-conta-'+new Date().toISOString().slice(0,10)+'.json';
  document.body.appendChild(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1500);
  toast('Exportação da sua conta baixada.');
}
async function createCreatorBackup(){
  const data=await request('/api/creator/backup','POST',{});
  showModal('Backup criado','O backup foi salvo no servidor. Copie essa pasta junto com o projeto quando trocar de hospedagem.',[
    {label:'Pasta do backup',value:data.backup.folder,readonly:true},
    {label:'Banco',value:data.backup.database+' · '+Math.round(data.backup.databaseBytes/1024)+' KB',readonly:true},
    {label:'Mídia copiada',value:data.backup.mediaCopied?'sim':'não',readonly:true}
  ],async()=>{},'Fechar',data.note||'');
  toast('Backup criado com sucesso.');
}
async function requestEmailVerification(){
  const data=await request('/api/me/email-verification/request','POST',{});
  if(data.emailVerified){toast('Seu e-mail já está verificado.');return;}
  toast(data.devCode?'Código do e-mail: '+data.devCode:'Código solicitado. Confira o e-mail configurado.');
  emailVerificationConfirmModal(data.devCode||'');
}
function emailVerificationConfirmModal(code=''){
  showModal('Confirmar e-mail','Digite o código de 6 dígitos gerado para sua conta NexHub.',[{label:'Código',key:'code',value:code,maxLength:6,required:true}],async v=>{const data=await request('/api/me/email-verification/confirm','POST',v);S.me=data.user;render();toast('E-mail verificado com sucesso.');},'Confirmar e-mail');
}
async function legalModal(){
  const data=await request('/api/legal');
  const box=modalFrame('Termos, privacidade e regras','Leia as regras básicas do NexHub.');
  box.classList.add('legal-modal');
  box.append(div('legal-text',make('h3',{},'Termos de uso'),make('pre',{text:data.terms}),make('h3',{},'Privacidade'),make('pre',{text:data.privacy}),make('h3',{},'Regras da comunidade'),make('pre',{text:data.rules})),div('modal-actions',btn('Fechar',closeModal,'btn primary')));
}

async function installPWA(){
  if(installPrompt){
    installPrompt.prompt();
    const result=await installPrompt.userChoice.catch(()=>({outcome:'dismissed'}));
    installPrompt=null;
    toast(result.outcome==='accepted'?'Instalação iniciada.':'Instalação cancelada.');
  }else{
    toast('No Android/PC use o botão instalar do navegador. No iPhone use Safari > Compartilhar > Adicionar à Tela de Início.');
  }
}

async function setup2FA(){
  showModal('Ativar 2FA','Digite sua senha. Depois coloque o segredo no Google Authenticator, Authy ou outro app e confirme o código gerado.',[{label:'Senha atual',key:'password',type:'password',required:true}],async v=>{
    const setup=await request('/api/me/2fa/setup','POST',v);
    closeModal();
    showModal('Confirmar 2FA','Copie este segredo no seu app autenticador. Guarde também os códigos de recuperação.',[{label:'Segredo 2FA',key:'secret',value:setup.secret,readonly:true},{label:'Código do app',key:'token',required:true}],async x=>{
      await request('/api/me/2fa/enable','POST',{token:x.token});S.me=(await request('/api/me')).user;toast('2FA ativado. Guarde seus códigos: '+setup.recoveryCodes.join('  '));
    },'Confirmar 2FA','Códigos de recuperação:\n'+setup.recoveryCodes.join('\n')+'\n\nURI: '+setup.otpauth);
  },'Gerar segredo');
}
async function disable2FA(){
  showModal('Desativar 2FA','Use sua senha e o código atual do autenticador ou um código de recuperação.',[{label:'Senha atual',key:'password',type:'password',required:true},{label:'Código 2FA',key:'token',required:true}],async v=>{await request('/api/me/2fa','DELETE',v);S.me=(await request('/api/me')).user;toast('2FA desativado.');},'Desativar');
}
function urlBase64ToUint8Array(base64String){
  const padding='='.repeat((4-base64String.length%4)%4);
  const base64=(base64String+padding).replace(/-/g,'+').replace(/_/g,'/');
  const raw=atob(base64);
  return Uint8Array.from([...raw].map(ch=>ch.charCodeAt(0)));
}
async function enableDeviceNotifications(){
  if(!('Notification' in window))throw Error('Este navegador não suporta notificações.');
  const permission=await Notification.requestPermission();
  if(permission!=='granted')throw Error('Notificação não permitida.');
  let registered=false;
  if('serviceWorker' in navigator && 'PushManager' in window){
    const reg=await navigator.serviceWorker.ready.catch(()=>null);
    const status=await request('/api/push-status').catch(()=>({}));
    if(reg&&status.publicKey){
      let sub=await reg.pushManager.getSubscription();
      if(!sub)sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:urlBase64ToUint8Array(status.publicKey)});
      await request('/api/push-subscriptions','POST',sub.toJSON());
      registered=true;
    }else{
      await request('/api/push-subscriptions','POST',{endpoint:'local-notifications-'+Date.now(),keys:{p256dh:'local',auth:'local'}}).catch(()=>{});
    }
  }
  new Notification('NexHub',{body:registered?'Push real inscrito neste dispositivo.':'Notificações locais ativadas neste dispositivo.'});
  toast(registered?'Push real ativado neste dispositivo.':'Notificações locais ativadas. Configure VAPID para push com app fechado.');
}
async function pushStatusModal(){
  const status=await request('/api/push-status');
  const box=modalFrame('Push notification','Status das notificações do NexHub neste dispositivo e no servidor.');
  const rows=[
    'Dispositivos inscritos: '+(status.subscriptions||0),
    'VAPID: '+(status.webPushConfigured?'configurado':'pendente'),
    'Pendências: '+((status.missing||[]).join(', ')||'nenhuma'),
    status.note||''
  ];
  box.append(div('turn-status-box',...rows.map(text=>make('p',{class:'dim',text}))),div('modal-actions',btn('Ativar neste aparelho',()=>task(enableDeviceNotifications),'btn primary'),btn('Assistente push',()=>task(pushSetupModal),'btn secondary'),btn('Fechar',closeModal,'btn ghost')));
}
async function pushSetupModal(){
  const guide=await request('/api/push-setup');
  const box=modalFrame('Assistente Push/PWA','Prepare o NexHub para notificações com o app fechado.');
  const actions=[btn('Copiar .env',()=>task(()=>copyText(guide.exampleEnv,'.env Push')),'btn primary'),btn('Verificar push',()=>task(pushStatusModal),'btn secondary')];
  if(guide.canGenerate)actions.push(btn('Gerar chaves VAPID',()=>vapidGenerateModal(),'btn secondary'));
  actions.push(btn('Fechar',closeModal,'btn ghost'));
  box.append(div('turn-status-box',make('strong',{text:guide.ready?'Push pronto no servidor':'Push ainda precisa de VAPID'}),make('p',{class:'dim',text:guide.note||''}),make('h3',{},'.env Web Push'),make('pre',{class:'code-card',text:guide.exampleEnv||''}),guide.generatorCommand?make('p',{class:'dim',text:'Comando: '+guide.generatorCommand}):null,make('h3',{},'Checklist'),make('ol',{class:'turn-checklist'},...(guide.checklist||[]).map(x=>make('li',{text:x})))),div('modal-actions',...actions));
}
async function vapidGenerateModal(){
  showModal('Gerar chaves VAPID','Use um e-mail seu para identificar o NexHub nos serviços de push. A chave privada aparece só agora; copie para Secrets/.env e não compartilhe.',[{label:'VAPID_SUBJECT',key:'subject',value:'mailto:seu-email@exemplo.com',required:true}],async v=>{
    const data=await request('/api/push-vapid-generate','POST',{subject:v.subject});
    const box=modalFrame('Chaves VAPID geradas','Copie para o Secrets/.env do Replit/hospedagem e reinicie o servidor.');
    box.append(div('turn-status-box',make('p',{class:'dim',text:data.warning||'Guarde a chave privada com segurança.'}),make('pre',{class:'code-card',text:data.env||''}),make('ol',{class:'turn-checklist'},make('li',{text:'Abra Secrets ou .env da hospedagem.'}),make('li',{text:'Cole VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY e VAPID_SUBJECT.'}),make('li',{text:'Reinicie o servidor.'}),make('li',{text:'Volte em Verificar push e ative no aparelho.'}))),div('modal-actions',btn('Copiar chaves',()=>task(()=>copyText(data.env,'chaves VAPID')),'btn primary'),btn('Verificar push',()=>task(pushStatusModal),'btn secondary'),btn('Fechar',closeModal,'btn ghost')));
  },'Gerar chaves');
}
async function appealsPanel(){
  const [appeals,recovery]=await Promise.all([request('/api/mod/appeals'),request('/api/mod/recovery-requests')]);
  chooseModal('Recursos e recuperação',`${appeals.appeals.length} recurso(s) e ${recovery.requests.length} recuperação(ões) pendentes.`,[
    ...appeals.appeals.map(a=>({label:`⚖️ Recurso: ${a.user_login}`,onClick:async()=>showModal('Analisar recurso',a.reason,[{label:'Resposta',key:'resolution',type:'textarea',value:'Revisado pela equipe'}],async v=>{await request(`/api/mod/appeals/${a.id}`,'PATCH',{status:'reviewed',resolution:v.resolution,unban:true});toast('Recurso analisado.');},'Aprovar e desbanir')})),
    ...recovery.requests.map(r=>({label:`🔑 Recuperação: ${r.user_login}`,onClick:async()=>showModal('Analisar recuperação',r.reason,[{label:'Resposta',key:'resolution',type:'textarea',value:'Revisado pela equipe'}],async v=>{await request(`/api/mod/recovery-requests/${r.id}`,'PATCH',{status:'reviewed',resolution:v.resolution});toast('Solicitação analisada.');},'Marcar como analisada')})),
    ...(!appeals.appeals.length&&!recovery.requests.length?[{label:'Nada pendente',onClick:async()=>{}}]:[])
  ]);
}
async function moderationPanel(){
  const data=await request('/api/mod/reports');
  const reports=data.reports;
  chooseModal('🛡️ Denúncias pendentes',`${reports.length} denúncia(s) aguardando análise.`,reports.length?reports.map(r=>({
    label:`⚑ ${r.targetUsername} — ${r.reason.slice(0,70)}`,
    onClick:async()=>moderationAction(r)
  })):[{label:'Nenhuma denúncia pendente',onClick:async()=>{}}]);
}
function moderationAction(r){
  chooseModal('Denúncia contra '+r.targetUsername,r.reason,[
    {label:'✓ Marcar como analisada',onClick:async()=>{await request('/api/mod/reports/'+r.id,'PATCH',{status:'reviewed',resolution:'Analisada'});toast('Denúncia analisada.');}},
    {label:'↩ Rejeitar denúncia',onClick:async()=>{await request('/api/mod/reports/'+r.id,'PATCH',{status:'rejected',resolution:'Sem evidências suficientes'});toast('Denúncia encerrada.');}},
    {label:'⛔ Suspender conta',onClick:async()=>showModal('Banimento da conta','Atenção: isto bloqueia o login na plataforma inteira.',[{label:'Motivo do banimento',key:'reason',type:'textarea',required:true}],async v=>{
      await request(`/api/mod/users/${r.target_user_id}/ban`,'POST',{reason:v.reason});
      await request('/api/mod/reports/'+r.id,'PATCH',{status:'reviewed',resolution:v.reason});toast('Conta suspensa.');
    },'Confirmar suspensão')}
  ]);
}

async function loadCreatorOverview(){S.creator=await request('/api/creator/overview');}
function renderCreator(main){
  if(!S.me?.isPlatformAdmin){main.append(topbar('Acesso negado','Apenas o criador do app pode abrir este painel.'),empty('🛡️','Sem permissão','Esta área é separada dos cargos dos servidores.'));return;}
  if(!S.creator){main.append(topbar('🛡️ Painel do Criador','Carregando dados...'),empty('⏳','Carregando','Aguarde um momento.'));return;}
  const data=S.creator;
  main.append(topbar('🛡️ Painel do Criador','Moderação da plataforma inteira',[icon('refresh-cw',()=>task(async()=>{await loadCreatorOverview();render();}),'Atualizar') ]));
  const area=div('center-view creator-view',make('span',{class:'eyebrow'},'NEXHUB CONTROL'),make('h1',{},'Controle geral do NexHub'),make('p',{class:'view-description'},'Aqui você analisa denúncias, contas, recursos, recuperação e banimentos globais. Essa área é separada dos cargos dos servidores.'));
  const c=data.counts||{};
  const stats=div('creator-grid',
    statCard('Contas',c.users,'Usuários cadastrados'),statCard('VIPs',c.vipUsers,'Apoiadores ativos'),statCard('Suspensas',c.bannedUsers,'Banidas da plataforma'),statCard('Servidores',c.servers,'Comunidades criadas'),
    statCard('Mensagens',c.messages,'Mensagens em servidores'),statCard('Denúncias',c.reportsPending,'Aguardando análise'),statCard('Recursos',c.appealsPending,'Pedidos contra banimento'),
    statCard('Pagos Pix',c.vipPaymentsPaid||0,'VIPs pagos confirmados'),statCard('Pendentes Pix',c.vipPaymentsPending||0,'Aguardando webhook'),statCard('R$',(c.vipRevenueBRL||0).toFixed?c.vipRevenueBRL.toFixed(2):c.vipRevenueBRL,'Receita VIP'),
    statCard('Push',c.pushSubscriptions,'Dispositivos inscritos'),statCard('Bots',c.installedBots,'Bots instalados'),statCard('Anti-hack',c.securityEvents||0,'Eventos'),statCard('Uploads',c.uploadsChecked||0,'Auditados'),statCard('Boosts',c.boostedServers||0,'Ativos'),statCard('Selos',c.officialTitles||0,'Títulos oficiais'),statCard('Suspensões',c.suspendedUsers||0,'Temporárias'));
  area.append(stats);
  const actions=div('section-card creator-actions',make('h3',{},'Ações rápidas'),
    btn('📋 Denúncias pendentes',()=>task(()=>moderationPanel()),'btn primary'),
    btn('⚖️ Recursos e recuperação',()=>task(()=>appealsPanel()),'btn secondary'),
    btn('👥 Ver usuários',()=>task(()=>creatorUsersModal()),'btn secondary'),
    btn('⚡ VIP por usuário',()=>task(()=>quickVipModal()),'btn secondary'),
    btn('🚫 Ban/Suspensão por usuário',()=>task(()=>quickPunishmentModal()),'btn secondary'),
    btn('🏷️ Títulos e Selos',()=>task(()=>officialTitlesModal()),'btn secondary'),
    btn('🌟 Hikari e roadmap',()=>task(()=>roadmapModal()),'btn secondary'),
    btn('💸 Pagamentos VIP Pix',()=>task(()=>creatorPaymentsModal()),'btn secondary'),
    btn('🛡️ Central anti-hack',()=>task(()=>creatorSecurityModal()),'btn secondary'),
    btn('✅ Checklist produção',()=>task(()=>productionChecklistModal()),'btn secondary'),
    btn('⬇ Instalar app neste dispositivo',()=>task(()=>installPWA()),'btn secondary'));
  area.append(actions);
  if((data.readiness||[]).length){
    const ready=div('section-card readiness-preview',make('h3',{},'Checklist rápido de produção'));
    for(const item of data.readiness)ready.append(div('checklist-row '+(item.ok?'ok':'warn'),make('strong',{text:(item.ok?'✅ ':'⚠️ ')+item.title}),make('p',{text:item.detail})));
    area.append(ready);
  }
  const users=div('section-card',make('h3',{},'Contas recentes'));
  for(const u of data.recentUsers||[])users.append(make('button',{class:'creator-user-row',onClick:()=>task(()=>showCreatorUser(u.id))},avatar(u.displayName,'#7be0cf','',u.avatarUrl),div('',make('strong',{text:u.displayName}),make('small',{text:'@'+u.username+' · '+formatDate(u.createdAt)})),u.vipActive?make('span',{class:'pill vip-pill',text:'VIP'}):null,u.bannedAt?make('span',{class:'pill danger',text:'Banido'}):make('span',{class:'pill',text:'Ativo'})));
  if(!(data.recentUsers||[]).length)users.append(empty('👥','Sem contas ainda','Quando as pessoas criarem conta, aparecerão aqui.'));
  area.append(users);
  if((data.recentPayments||[]).length){
    const pay=div('section-card creator-pay-preview',make('h3',{},'Pagamentos VIP recentes'));
    for(const p of data.recentPayments)pay.append(div('payment-row '+p.status,make('strong',{text:'R$ '+Number(p.amountBRL||5).toFixed(2)+' · '+p.status}),make('p',{text:p.reference+' · '+formatDate(p.createdAt)}),make('small',{text:p.paidAt?('Pago em '+formatDate(p.paidAt)):(p.secondsLeft?('expira em '+Math.ceil(p.secondsLeft/60)+' min'):'pendente/expirado')})));
    pay.append(div('profile-tools',btn('Abrir pagamentos',()=>task(()=>creatorPaymentsModal()),'btn secondary small')));
    area.append(pay);
  }
  const audit=div('section-card',make('h3',{},'Últimas ações do criador'));
  for(const a of data.recentAudit||[])audit.append(div('audit-row',make('strong',{text:a.action}),make('p',{text:(a.reason||'Sem motivo')+' · alvo: '+a.targetId}),make('small',{text:formatDate(a.createdAt)+' por @'+(a.adminUsername||'sistema')})));
  if(!(data.recentAudit||[]).length)audit.append(make('p',{class:'dim'},'Nenhuma ação global registrada ainda.'));
  area.append(audit);main.append(area);
}
function statCard(label,value,desc){return div('stat-card',make('strong',{text:String(value??0)}),make('span',{text:label}),make('small',{text:desc}));}

async function quickVipModal(){
  showModal('VIP rápido por usuário','Digite o @usuário e escolha a duração. A pessoa recebe o VIP na hora.',[
    {key:'username',label:'Nome de usuário, ID ou e-mail',placeholder:'@usuario',required:true,autocapitalize:'none'},
    {key:'duration',label:'Duração',type:'select',value:'30',options:[['3','3 dias'],['10','10 dias'],['30','30 dias'],['forever','Infinito']]},
    {key:'note',label:'Observação',placeholder:'Pagamento confirmado / prêmio / teste'}
  ],async values=>{
    const r=await request('/api/creator/vip/quick','POST',values);
    toast('VIP enviado para @'+r.user.username+' por '+r.duration+'.');
    await loadCreatorOverview();render();
  },'Enviar VIP');
}
async function quickPunishmentModal(){
  showModal('Banimento e suspensão rápida','Digite o usuário e escolha a ação. Use com cuidado: ban/suspensão derruba as sessões da conta.',[
    {key:'username',label:'Nome de usuário, ID ou e-mail',placeholder:'@usuario',required:true,autocapitalize:'none'},
    {key:'action',label:'Ação',type:'select',value:'suspend',options:[['suspend','Suspender temporariamente'],['ban','Banir conta'],['unsuspend','Remover suspensão'],['unban','Remover banimento']]},
    {key:'days',label:'Dias de suspensão',type:'select',value:'3',options:[['1','1 dia'],['3','3 dias'],['7','7 dias'],['15','15 dias'],['30','30 dias']]},
    {key:'reason',label:'Motivo',placeholder:'Explique o motivo para ficar nos logs'}
  ],async values=>{
    const r=await request('/api/creator/users/action-by-name','POST',values);
    toast('Ação aplicada: '+r.action+' em @'+r.target.username+'.');
    await loadCreatorOverview();render();
  },'Aplicar ação');
}
async function officialTitlesModal(){
  const data=await request('/api/creator/titles/catalog');
  const active=await request('/api/creator/titles');
  const box=modalFrame('Títulos e selos oficiais','Badges reais do NexHub, sem usar emotes como verificação. Eles aparecem no perfil, chat, lista de membros e explorar.');
  const grid=div('title-catalog-grid');
  for(const t of data.titles)grid.append(div('title-sample badge-tone-'+(t.tone||'default'),make('strong',{text:t.label}),make('small',{text:t.description})));
  box.append(grid);
  box.append(make('h3',{text:'Aplicar título'}));
  const form=div('quick-admin-grid');
  box.append(form,div('modal-actions',btn('Fechar',closeModal,'btn ghost'),btn('Aplicar título',()=>task(async()=>{
    const values={username:form.querySelector('[name=username]').value,titleId:form.querySelector('[name=titleId]').value,durationDays:form.querySelector('[name=duration]').value,reason:form.querySelector('[name=reason]').value};
    const r=await request('/api/creator/titles','POST',values);
    toast('Título '+r.title.label+' aplicado para @'+r.target.username+'.');
    closeModal();
  }),'btn primary')));
  form.append(label('Usuário',make('input',{name:'username',placeholder:'@usuario',required:true})),label('Título',make('select',{name:'titleId'},...data.titles.map(t=>make('option',{value:t.id},t.label)))),label('Duração',make('select',{name:'duration'},make('option',{value:'forever'},'Permanente'),make('option',{value:'3'},'3 dias'),make('option',{value:'10'},'10 dias'),make('option',{value:'30'},'30 dias'))),label('Motivo',make('input',{name:'reason',placeholder:'Verificado pela equipe'})));
  if(active.titles?.length){const list=div('section-card compact-list',make('h3',{text:'Títulos ativos'}));for(const x of active.titles.slice(0,12))list.append(div('audit-row',make('strong',{text:'@'+x.username+' · '+x.title.label}),make('p',{text:x.reason||'Sem motivo'}),make('small',{text:x.expiresAt==='forever'?'permanente':(x.expiresAt?formatDate(x.expiresAt):'sem expiração')})));box.append(list);}
}
async function roadmapModal(){
  const data=await request('/api/creator/roadmap');
  const box=modalFrame('Hikari e ideias da mega atualização','Lista planejada dentro do projeto para continuar evoluindo o NexHub.');
  const m=data.mascot||{};
  box.append(div('hikari-card',make('img',{src:m.avatar||'/hikari-avatar.png',alt:'Hikari'}),div('',make('strong',{text:m.name||'Hikari'}),make('p',{text:m.phrase||'Conectando pessoas com mais brilho.'}))));
  const list=div('roadmap-list');
  for(const item of data.items||[])list.append(div('roadmap-item',make('strong',{text:item.priority+'. '+item.title}),make('small',{text:item.category+' · '+item.status}),make('p',{text:item.note})));
  box.append(list,div('modal-actions',btn('Fechar',closeModal,'btn primary')));
}
async function creatorUsersModal(){
  const box=modalFrame('Usuários da plataforma','Pesquise, abra perfil, suspenda ou reative contas.');
  const q=input('Pesquisar nome, usuário ou e-mail…');q.type='search';
  const status=make('select',{},make('option',{value:'all'},'Todos'),make('option',{value:'active'},'Ativos'),make('option',{value:'banned'},'Banidos'));
  const list=div('creator-user-list');
  const load=async()=>{
    const data=await request('/api/creator/users?q='+encodeURIComponent(q.value)+'&status='+encodeURIComponent(status.value));
    list.replaceChildren();
    for(const u of data.users)list.append(make('button',{class:'creator-user-row',onClick:()=>task(()=>showCreatorUser(u.id))},avatar(u.displayName,u.color,'',u.avatarUrl),div('',make('strong',{text:u.displayName}),make('small',{text:'@'+u.username+' · '+u.email})),u.vipActive?make('span',{class:'pill vip-pill',text:'VIP'}):null,u.banned?make('span',{class:'pill danger',text:'Banido'}):make('span',{class:'pill',text:'Ativo'})));
    if(!data.users.length)list.append(make('p',{class:'dim'},'Nenhum usuário encontrado.'));
  };
  q.addEventListener('input',()=>task(load));status.addEventListener('change',()=>task(load));
  box.append(div('inline-form',q,status),list,div('modal-actions',btn('Fechar',closeModal,'btn ghost')));await load();
}
function manualConfirmPixPayment(p,reload){
  showModal('Confirmar recebimento no Nubank',`Confira no app Nubank que o crédito de R$ ${Number(p.amountBRL||5).toFixed(2)} entrou. Pedido de @${p.username} · ${p.reference}. Esta ação marca o pedido como pago e libera 30 dias de VIP.`,[
    {key:'verified',label:'Conferi o crédito deste Pix no Nubank.',type:'checkbox'}
  ],async values=>{
    if(!values.verified)throw Error('Marque a confirmação somente depois de conferir o crédito no Nubank.');
    const result=await request('/api/creator/payments/'+encodeURIComponent(p.id)+'/manual-confirm','POST',{verified:true});
    toast(result.alreadyPaid?'Este Pix já estava confirmado.':'Pix confirmado e VIP liberado por 30 dias.');
    await reload();
  },'Confirmar recebimento');
}

async function creatorPaymentsModal(){
  const box=modalFrame('Pagamentos VIP Pix','O criador pode confirmar manualmente depois de conferir o crédito no Nubank. Print enviado por usuário não confirma pagamento.');
  const status=make('select',{},make('option',{value:''},'Todos'),make('option',{value:'pending'},'Pendentes'),make('option',{value:'paid'},'Pagos'),make('option',{value:'expired'},'Expirados'),make('option',{value:'cancelled'},'Cancelados'));
  const q=input('Buscar @usuário ou referência Pix...');q.type='search';
  const summary=div('creator-grid compact');
  const list=div('creator-payment-list');
  const events=div('section-card',make('h3',{},'Logs Pix/anti-golpe'));
  const load=async()=>{
    const data=await request('/api/creator/payments?status='+encodeURIComponent(status.value)+'&q='+encodeURIComponent(q.value));
    const s=data.summary||{};
    summary.replaceChildren(statCard('Pendentes',s.pending||0,'Aguardando'),statCard('Pagos',s.paid||0,'Confirmados'),statCard('Expirados',s.expired||0,'Sem pagamento'),statCard('Receita','R$ '+Number(s.revenueBRL||0).toFixed(2),'VIP pago'));
    list.replaceChildren();
    for(const p of data.payments||[]){
      list.append(div('payment-admin-row '+p.status,
        div('',make('strong',{text:(p.displayName||p.username)+' · '+p.status}),make('small',{text:'@'+p.username+' · '+p.reference})),
        div('payment-admin-summary',
          make('span',{class:'pill '+(p.status==='paid'?'vip-pill':p.status==='pending'?'':'danger'),text:'R$ '+Number(p.amountBRL||5).toFixed(2)}),
          make('small',{text:p.paidAt?formatDate(p.paidAt):(p.secondsLeft?('expira em '+Math.ceil(p.secondsLeft/60)+' min'):'sem confirmação')}),
          p.receipt?make('small',{text:p.confirmationSource==='manual_nubank'?'Crédito conferido no Nubank pelo criador':'Transação: '+(p.receipt.transactionId||'confirmada')}):null,
          ['pending','expired'].includes(p.status)?btn('Confirmar no Nubank',()=>manualConfirmPixPayment(p,load),'btn primary small'):null)));
    }
    if(!(data.payments||[]).length)list.append(make('p',{class:'dim'},'Nenhum pagamento encontrado.'));
    events.replaceChildren(make('h3',{},'Logs Pix/anti-golpe'));
    for(const e of data.events||[])events.append(div('audit-row',make('strong',{text:e.kind}),make('p',{text:e.detail||'sem detalhe'}),make('small',{text:formatDate(e.createdAt)+' · '+(e.ip||'')})));
  };
  q.addEventListener('input',()=>task(load));status.addEventListener('change',()=>task(load));
  box.append(div('inline-form',q,status),summary,list,events,div('modal-actions',btn('Fechar',closeModal,'btn ghost')));await load();
}

async function showCreatorUser(uid){
  const data=await request('/api/creator/users/'+uid);
  const u=data.user;
  const box=modalFrame('Conta de @'+u.username,'Análise completa pelo criador do app.');
  box.append(profileDisplay(u));
  box.append(div('creator-grid compact',statCard('Servidores',data.stats.serversJoined,'Participa'),statCard('Mensagens',data.stats.messages,'No chat'),statCard('Denúncias',data.stats.reportsReceived,'Recebidas'),statCard('DMs',data.stats.dmsSent,'Enviadas')));
  const info=div('section-card',make('h3',{},'Dados da conta'),make('p',{text:'E-mail: '+u.email}),make('p',{text:'Criada em: '+formatDate(u.createdAt)}),make('p',{text:'2FA: '+(u.twofaEnabled?'ativado':'desativado')}),make('p',{class:u.vipActive?'vip-ok':'dim',text:u.vipActive?'VIP ativo · '+vipDaysText(u)+' · '+(u.vipPlan||'VIP R$5'):'VIP inativo'}),u.banned?make('p',{class:'danger-text',text:'Banida: '+(u.banReason||'sem motivo')}):make('p',{class:'dim'},'Conta ativa.'));
  box.append(info);
  if(data.reports?.length){const rep=div('section-card',make('h3',{},'Denúncias contra esta conta'));for(const r of data.reports)rep.append(div('audit-row',make('strong',{text:r.status}),make('p',{text:r.reason}),make('small',{text:formatDate(r.createdAt)})));box.append(rep);}
  const tools=div('profile-tools');
  if(uid!==S.me.id&&!u.isPlatformAdmin){
    tools.append(u.vipActive?btn('💎 Remover VIP',()=>confirmModal('Remover VIP?',`Remover VIP de @${u.username}?`,async()=>removeVipAdmin(u),'Remover'),'btn ghost small'):btn('💎 Ativar VIP R$5',()=>vipAdminModal(u),'btn primary small'));
    if(u.banned)tools.append(btn('✅ Reativar conta',()=>task(async()=>{await request('/api/mod/users/'+uid+'/unban','POST',{});S.creator=null;closeModal();toast('Conta reativada.');}),'btn primary small'));
    else tools.append(btn('⛔ Suspender conta',()=>showModal('Suspender @'+u.username,'Esta ação derruba sessões e impede login.',[{label:'Motivo do banimento',key:'reason',type:'textarea',required:true}],async v=>{await request('/api/mod/users/'+uid+'/ban','POST',{reason:v.reason});S.creator=null;closeModal();toast('Conta suspensa.');},'Suspender'),'btn danger small'));
  }
  tools.append(btn('Abrir perfil público',()=>task(()=>showProfile(uid)),'btn secondary small'),btn('Fechar',closeModal,'btn ghost small'));
  box.append(tools);
}

function renderSearch(main){
  main.append(topbar('⌕ Pesquisar','Busca avançada em mensagens, fixados e anexos'));
  const area=div('center-view search-view',make('span',{class:'eyebrow'},'BUSCA AVANÇADA'),make('h1',{},'Encontrar mensagens'));
  if(!S.server){area.append(empty('🧭','Escolha um servidor','Entre em uma comunidade antes de pesquisar.'));main.append(area);return;}
  const query=input('Palavra, frase, enquete ou parte da mensagem...');
  const author=input('@usuário opcional');
  const after=make('input',{type:'date','aria-label':'Data inicial'});
  const before=make('input',{type:'date','aria-label':'Data final'});
  const channel=make('select',{},make('option',{value:''},'Todos os canais'),...(S.server.channels||[]).filter(c=>c.type==='text').map(c=>make('option',{value:c.id},'# '+c.name)));
  const pinned=make('label',{class:'check-row'},make('input',{type:'checkbox'}),' Só fixadas');
  const asset=make('label',{class:'check-row'},make('input',{type:'checkbox'}),' Só anexos/itens');
  const results=div('section-card search-results-card',make('h3',{},`Resultados em ${S.server.name}`),make('p',{class:'dim'},'Use filtros para encontrar mensagens antigas, anexos, fixadas ou mensagens de um usuário específico.'));
  const runSearch=async()=>{
    const params=new URLSearchParams();
    if(query.value.trim())params.set('q',query.value.trim());
    if(channel.value)params.set('channelId',channel.value);
    if(author.value.trim())params.set('from',author.value.trim().replace(/^@/,''));
    if(after.value)params.set('after',after.value);
    if(before.value)params.set('before',before.value);
    if(pinned.querySelector('input').checked)params.set('pinned','1');
    if(asset.querySelector('input').checked)params.set('asset','1');
    const data=await request('/api/servers/'+S.server.id+'/search?'+params.toString());
    results.replaceChildren(make('h3',{},`${data.results.length} resultado(s)`));
    if(!data.results.length)results.append(make('p',{class:'dim'},'Nenhuma mensagem encontrada com esses filtros.'));
    for(const m of data.results){
      const preview=m.asset?`${m.asset.type}: ${m.asset.name}`:(m.content||m.poll?.question||'Mensagem');
      results.append(make('button',{class:'search-result',onClick:()=>task(()=>openServer(S.server.id,m.channelId))},
        div('',make('strong',{text:`#${m.channelName} · ${m.author}`}),make('small',{text:' · '+formatDate(m.createdAt)})),
        make('p',{text:short(preview)}),
        div('search-result-tags',m.pinned?make('span',{},'📌 Fixada'):null,m.mentionedMe?make('span',{},'@ menciona você'):null,m.asset?make('span',{},'📎 Item/anexo'):null)
      ));
    }
  };
  const form=make('form',{class:'search-advanced-form',onSubmit:e=>{e.preventDefault();task(runSearch);}},
    label('Texto',query),label('Canal',channel),label('Autor',author),label('De',after),label('Até',before),div('search-filter-line',pinned,asset),make('button',{type:'submit',class:'btn primary'},'Pesquisar'));
  area.append(div('section-card',make('h3',{},'Filtros'),form),results);main.append(area);
}

async function loadAudit(){ S.audit=(await request('/api/servers/'+S.server.id+'/audit')).entries; }
function renderAudit(main){
  main.append(topbar('📜 Auditoria','Ações administrativas',[icon('←',()=>task(()=>openServer(S.server.id,S.channelId)),'Voltar')]));
  const area=div('center-view',make('span',{class:'eyebrow'},'NEXHUB LOGS'),make('h1',{},'Histórico de moderação'),make('p',{class:'view-description'},'Registro de ações importantes do servidor, visível apenas para a equipe.'));
  const card=div('section-card');if(!(S.audit||[]).length)card.append(empty('📜','Sem atividades ainda','As ações serão registradas aqui.'));
  for(const a of S.audit||[])card.append(div('audit-row',make('strong',{text:a.action}),make('p',{text:a.detail||'Sem descrição'}),make('small',{text:formatDate(a.createdAt)})));
  area.append(card);main.append(area);
}
function profileEffectLayer(effect){
  effect=profileEffectOptions.some(([id])=>id===effect)?effect:'none';
  if(effect==='none')return null;
  if(isProfileVideoEffect(effect)){
    const info=profileEffectVideos[effect];
    const layer=div('profile-effect-layer profile-effect-video-layer');
    layer.setAttribute('aria-hidden','true');
    const video=make('video',{src:info.src,poster:info.poster,autoplay:true,loop:true,muted:true,playsinline:true,preload:'metadata'});
    video.muted=true;
    video.addEventListener('canplay',()=>video.play().catch(()=>{}),{once:true});
    layer.append(video,make('span',{class:'profile-effect-video-vignette'}));
    return layer;
  }
  const count=['neon_aura','glitch'].includes(effect)?22:28;
  const layer=div('profile-effect-layer profile-effect-layer-full');
  layer.setAttribute('aria-hidden','true');
  layer.append(
    make('span',{class:'profile-fx-halo'}),
    make('span',{class:'profile-fx-orbit'}),
    make('span',{class:'profile-fx-sweep'})
  );
  for(let i=0;i<count;i++){
    layer.append(make('span',{
      class:'profile-fx-particle profile-fx-particle-shape-'+(i%4),
      style:`--i:${i};--x:${(i*37+13)%100}%;--y:${(i*47+9)%100}%;--d:${-(i%9)*.34}s;--r:${(i*31)%360}deg;--s:${5+(i%5)*2}px;--dx:${(i%2?-1:1)*(10+(i%5)*8)}px`,
    }));
  }
  return layer;
}
function profileDisplay(u,animated=true){
  const banner=div('profile-banner');
  if(u.bannerUrl?.startsWith('/media/')) {
    if(u.bannerType==='video'){const vid=make('video',{src:u.bannerUrl,autoplay:true,loop:true,muted:true,playsinline:true,preload:'metadata','aria-label':'Vídeo do banner'});vid.muted=true;banner.append(vid);}
    else banner.append(make('img',{src:u.bannerUrl,alt:'Banner de '+u.displayName,loading:'lazy'}));
  }else banner.append(make('span',{class:'banner-placeholder'},'✦ Seu espaço, seu estilo'));
  const effect=profileEffectOptions.some(([id])=>id===u.profileEffect)?u.profileEffect:'none';
  const layer=profileEffectLayer(effect);
  const avatarStage=div('profile-avatar-stage '+(isVipUser(u)?'vip-avatar-stage':''),avatar(u.displayName,u.color,'avatar-large',u.avatarUrl),make('span',{class:'profile-avatar-decoration'}),isVipUser(u)?make('span',{class:'vip-crown',text:'💎'}):null);
  const badges=div('profile-badges',make('span',{text:profileEffectTitle(effect).replace(/^.+? /,'')||'Perfil'}),make('span',{text:statusLabel(u.status)}),...(u.badges||[]).map(b=>make('span',{class:'profile-badge-special badge-tone-'+(b.tone||b.id||'default'),text:b.label})));
  const card=div('profile-display '+(animated?'profile-animated':'profile-static')+' '+profileEffectClass(effect)+(isVipUser(u)?' vip-profile':'') ,layer,banner,div('profile-info',avatarStage,badges,div('profile-name',make('strong',{class:(isVipUser(u)?'vip-name ':'')+(u.vipNameStyle?'vip-name-style-'+u.vipNameStyle:''),text:u.displayName}),make('span',{text:'@'+u.username})),isVipUser(u)?make('small',{class:'vip-profile-note',text:'💎 VIP NexHub · '+vipDaysText(u)}):null,make('p',{text:u.bio||'Ainda sem biografia.'})));
  card.setAttribute('tabindex','0');
  card.dataset.profileEffect=effect;
  return card;
}
async function showProfile(uid,actions=[]){
  const {user}=await request('/api/users/'+encodeURIComponent(uid));
  const box=modalFrame('Perfil de '+user.displayName,'Card premium do NexHub com banner, avatar, status e efeito visual do perfil.');
  box.classList.add('profile-modal');
  box.append(profileDisplay(user,true));
  const buttons=div('profile-tools');
  if(uid!==S.me.id){
    const blocked=(await request('/api/users/'+uid+'/block')).blocked;
    buttons.append(btn(blocked?'✅ Desbloquear':'🚫 Bloquear',()=>task(async()=>{await request('/api/users/'+uid+'/block',blocked?'DELETE':'POST');closeModal();toast(blocked?'Usuário desbloqueado.':'Usuário bloqueado: PV e chamadas impedidos.');}),'btn secondary small'));
    buttons.append(btn('⚑ Denunciar',()=>{closeModal();reportModal(uid);},'btn secondary small'));
    buttons.append(btn('💬 Conversar no PV',()=>task(async()=>{closeModal();await openDM(uid);}), 'btn primary small'),
      btn('📞 Voz',()=>task(async()=>{closeModal();await startCall(uid,'audio');}), 'btn secondary small'),
      btn('📹 Vídeo',()=>task(async()=>{closeModal();await startCall(uid,'video');}), 'btn secondary small'));
  }else buttons.append(btn('Editar perfil',()=>task(async()=>{closeModal();await navigate('settings');}), 'btn primary small'));
  box.append(buttons);
  for(const action of actions){
    if(action.label.startsWith('💬')||action.label.startsWith('📞')||action.label.startsWith('📹'))continue;
    box.append(btn(action.label,()=>task(async()=>{closeModal();await action.onClick();}),'btn secondary small'));
  }
  box.append(div('modal-actions',btn('Fechar',closeModal,'btn ghost')));
}
async function deleteProfileMedia(kind){
  const {user}=await request('/api/me/media/'+kind,'DELETE'); S.me=user;render();toast('Arquivo removido do perfil.');
}
async function uploadProfileMedia(kind,input){
  const file=input.files?.[0];if(!file)return;
  const max=kind==='avatar'?5*1024*1024:18*1024*1024;
  if(file.size>max)throw Error('Arquivo maior que o limite permitido.');
  const isVideo=file.type==='video/mp4';
  if(kind==='avatar' && !file.type.startsWith('image/'))throw Error('A foto precisa ser uma imagem.');
  if(isVideo){
    const url=URL.createObjectURL(file);
    try {
      const duration=await new Promise((resolve,reject)=>{const vid=document.createElement('video');vid.preload='metadata';vid.onloadedmetadata=()=>resolve(vid.duration);vid.onerror=()=>reject(Error('Não foi possível ler este MP4.'));vid.src=url;});
      if(!Number.isFinite(duration)||duration>10||duration<.1)throw Error('O vídeo precisa ter no máximo 10 segundos.');
    } finally {URL.revokeObjectURL(url);}
  }
  input.disabled=true;
  try {
    const res=await fetch(apiUrl('/api/me/media/'+kind),{method:'PUT',credentials:'same-origin',headers:{'Content-Type':'application/octet-stream'},body:file});
    const data=await res.json().catch(()=>({error:'Falha ao enviar arquivo.'}));
    if(!res.ok)throw Error(data.error||'Falha no upload.');
    S.me=data.user;render();toast(kind==='avatar'?'Foto de perfil atualizada!':'Banner atualizado!');
  }finally{input.disabled=false;}
}
// WebRTC 1:1 e salas: apenas SDP/ICE passam pelo servidor; mídia vai direto entre navegadores.
function queueVoiceEvent(event){
  voiceEventQueue=voiceEventQueue.then(()=>handleVoiceEvent(event)).catch(error=>toast(error.message||'Erro ao conectar o áudio da sala.',true));
  return voiceEventQueue;
}
async function joinGroupVoice(channelId){
  if(C)throw Error('Encerre a chamada privada antes de entrar em sala de voz.');
  if(G&&G.channelId!==channelId)await leaveGroupVoice();
  if(!window.RTCPeerConnection||!navigator.mediaDevices?.getUserMedia)throw Error('Chamadas precisam de HTTPS e de um navegador com suporte a WebRTC.');
  if(!window.isSecureContext&&!['localhost','127.0.0.1'].includes(location.hostname))throw Error('Chamadas só funcionam em HTTPS. Abra pelo link seguro do app.');
  const data=await request('/api/channels/'+channelId+'/voice','POST',{});
  const group={channelId,room:data.room,ice:data.ice||{},muted:false,cameraOff:true,local:null,lastSeq:0,peers:new Map(),pendingSignals:[],needsPlayback:false,minimized:false};
  G=group;
  try{
    group.local=await navigator.mediaDevices.getUserMedia({audio:callAudioConstraints(),video:false});
    if(G!==group){group.local.getTracks().forEach(track=>track.stop());return;}
    startCallSync();
    for(const participant of group.room?.participants||[]){
      if(participant.id!==S.me.id&&String(S.me.id)<String(participant.id))await startGroupOffer(group,participant.id);
    }
    for(const signal of group.pendingSignals.splice(0))await queueVoiceEvent(signal);
    await syncGroupVoiceSignals();
    renderCall();
  }catch(error){
    if(G===group)await leaveGroupVoice();
    if(['NotAllowedError','PermissionDeniedError'].includes(error?.name))throw Error('Permita o acesso ao microfone para entrar na call.');
    if(error?.name==='NotFoundError')throw Error('Não foi encontrado um microfone neste dispositivo.');
    throw error;
  }
}
function createGroupPeer(group,remoteId){
  const existing=group.peers.get(remoteId);
  if(existing)return existing;
  if(!group.local)throw Error('Aguarde a liberação do microfone.');
  const config=group.ice||{};
  const options={iceServers:Array.isArray(config.iceServers)?config.iceServers:[]};
  if(config.iceTransportPolicy)options.iceTransportPolicy=config.iceTransportPolicy;
  const pc=new RTCPeerConnection(options);
  const peer={pc,pendingIce:[],offerSent:false,restarts:0,audio:null,remoteStream:null};
  group.peers.set(remoteId,peer);
  group.local.getAudioTracks().forEach(track=>pc.addTrack(track,group.local));
  pc.onicecandidate=event=>{
    if(event.candidate&&G===group)request('/api/channels/'+group.channelId+'/voice/signal','POST',{to:remoteId,type:'ice',payload:event.candidate.toJSON()})
      .catch(error=>{if(G===group)toast('Falha ao enviar sinal de rede: '+error.message,true);});
  };
  pc.ontrack=event=>{
    if(G!==group)return;
    let stream=event.streams?.[0];
    if(!stream){
      stream=peer.remoteStream||new MediaStream();
      if(!stream.getTracks().some(track=>track.id===event.track.id))stream.addTrack(event.track);
    }
    peer.remoteStream=stream;
    if(!peer.audio){
      peer.audio=document.createElement('audio');
      peer.audio.autoplay=true;peer.audio.playsInline=true;
      peer.audio.style.cssText='position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;left:-10px;bottom:-10px';
      document.body.append(peer.audio);
    }
    peer.audio.srcObject=stream;
    applyAudioOutput(peer.audio);
    const playback=peer.audio.play();
    if(playback?.catch)playback.catch(()=>{if(G===group){group.needsPlayback=true;renderCall();}});
    renderCall();
  };
  pc.onconnectionstatechange=()=>{
    if(G!==group)return;
    if(pc.connectionState==='failed'&&String(S.me.id)<String(remoteId)&&peer.restarts<2){
      peer.restarts++;
      task(()=>startGroupOffer(group,remoteId,true));
    }
  };
  return peer;
}
async function startGroupOffer(group,remoteId,restart=false){
  if(G!==group||String(S.me.id)>=String(remoteId))return;
  const peer=createGroupPeer(group,remoteId);
  if(peer.offerSent&&!restart)return;
  peer.offerSent=true;
  try{
    const offer=await peer.pc.createOffer(restart?{iceRestart:true}:{});
    if(G!==group)return;
    await peer.pc.setLocalDescription(offer);
    await request('/api/channels/'+group.channelId+'/voice/signal','POST',{to:remoteId,type:'offer',payload:{type:offer.type,sdp:offer.sdp}});
  }catch(error){peer.offerSent=false;throw error;}
}
async function handleGroupSignal(event,group=G){
  if(!group||G!==group||event.to&&event.to!==S.me.id)return;
  if(!group.local){group.pendingSignals.push(event);return;}
  if(event.seq&&event.seq<=group.lastSeq)return;
  if(event.seq)group.lastSeq=Math.max(group.lastSeq,event.seq);
  if(!(group.room?.participants||[]).some(participant=>participant.id===event.from))return;
  const peer=createGroupPeer(group,event.from);
  if(event.type==='ice'){
    if(peer.pc.remoteDescription)await peer.pc.addIceCandidate(event.payload);
    else peer.pendingIce.push(event.payload);
    return;
  }
  if(event.type==='offer'){
    await peer.pc.setRemoteDescription(event.payload);
    for(const candidate of peer.pendingIce.splice(0))await peer.pc.addIceCandidate(candidate);
    const answer=await peer.pc.createAnswer();
    await peer.pc.setLocalDescription(answer);
    await request('/api/channels/'+group.channelId+'/voice/signal','POST',{to:event.from,type:'answer',payload:{type:answer.type,sdp:answer.sdp}});
  }else if(event.type==='answer'){
    await peer.pc.setRemoteDescription(event.payload);
    for(const candidate of peer.pendingIce.splice(0))await peer.pc.addIceCandidate(candidate);
  }
}
function closeGroupPeer(group,remoteId){
  const peer=group.peers.get(remoteId);
  if(!peer)return;
  group.peers.delete(remoteId);
  peer.pc.ontrack=null;peer.pc.onicecandidate=null;peer.pc.close();
  if(peer.audio){peer.audio.pause();peer.audio.srcObject=null;peer.audio.remove();}
  peer.remoteStream?.getTracks?.().forEach(track=>track.stop());
}
async function unlockGroupAudio(){
  const group=G;if(!group)return;
  let blocked=false;
  await Promise.all([...group.peers.values()].map(async peer=>{
    if(!peer.audio)return;
    try{await peer.audio.play();}catch{blocked=true;}
  }));
  if(G===group){group.needsPlayback=blocked;renderCall();}
}
async function leaveGroupVoice(){
  if(!G)return;const group=G;const channelId=group.channelId;
  G=null;
  for(const peerId of [...group.peers.keys()])closeGroupPeer(group,peerId);
  group.local?.getTracks().forEach(track=>track.stop());
  if(!C)stopCallSync();
  renderCall();
  await request('/api/channels/'+channelId+'/voice','DELETE',{}).catch(()=>{});
}
async function handleVoiceEvent(ev){
  const group=G;if(!group||ev.channelId!==group.channelId)return;
  if(ev.room)group.room=ev.room;
  if(ev.action==='signal'){await handleGroupSignal(ev,group);return;}
  if(ev.action==='left'&&ev.userId===S.me.id){
    G=null;
    for(const peerId of [...group.peers.keys()])closeGroupPeer(group,peerId);
    group.local?.getTracks().forEach(track=>track.stop());
    if(!C)stopCallSync();
    renderCall();toast('Esta sala foi aberta em outra sessão.',true);return;
  }
  if(ev.action==='left'&&ev.userId)closeGroupPeer(group,ev.userId);
  if(ev.action==='joined'&&ev.userId&&ev.userId!==S.me.id&&group.local&&String(S.me.id)<String(ev.userId)){
    await startGroupOffer(group,ev.userId);
  }
  renderCall();
}
function renderGroupCall(){
  if(!G)return;
  const channel=S.server?.channels?.find(c=>c.id===G.channelId);
  if(G.minimized){
    callRoot.append(div('call-minibar',make('span',{class:'avatar'},'🎧'),div('minibar-label',make('strong',{text:'NexHub Voice'}),make('small',{class:'call-minibar-state active',text:channel?'# '+channel.name:'Sala de voz'})),icon('chevron-right',()=>{G.minimized=false;renderCall();},'Voltar à chamada'),icon('phone-off',()=>task(leaveGroupVoice),'Sair da call','minibar-end')));
    return;
  }
  const layer=div('call-layer group-call-layer');const panel=div('call-panel');
  panel.append(div('call-header',icon('chevron-down',()=>{G.minimized=true;renderCall();},'Recolher'),div('call-header-center',make('strong',{text:'NexHub Voice'}),make('span',{text:channel?'# '+channel.name:'Sala de voz'})),icon('users',()=>toast((G.room?.participants?.length||0)+' participante(s)'),'Participantes')));
  const tiles=div('call-tiles');
  for(const p of G.room?.participants||[])tiles.append(div('call-tile remote-tile',div('call-user-fallback',avatar(p.displayName,p.color,'avatar-large',p.avatarUrl)),div('call-name',symbol(p.muted?'mic-off':'mic'),make('span',{text:p.id===S.me.id?p.displayName+' (você)':p.displayName}))));
  if(!(G.room?.participants||[]).length)tiles.append(empty('🎧','Sala vazia','Aguardando participantes.'));
  panel.append(tiles);
  const controls=div('call-controlbar');
  controls.append(icon(G.muted?'mic-off':'mic',()=>task(async()=>{G.muted=!G.muted;G.local?.getAudioTracks().forEach(t=>t.enabled=!G.muted);const data=await request('/api/channels/'+G.channelId+'/voice/state','PATCH',{muted:G.muted,cameraOff:G.cameraOff});G.room=data.room;renderCall();}),G.muted?'Ativar microfone':'Silenciar microfone','call-action'+(G.muted?' action-off':'')),
    icon('phone-off',()=>task(leaveGroupVoice),'Sair da call','call-action hangup-call'));
  if(G.needsPlayback)controls.append(btn('Ativar áudio',()=>task(unlockGroupAudio),'btn secondary small'));
  panel.append(controls,make('small',{class:'call-tip',text:'NexHub Voice usa salas de voz + sinalização WebRTC. Teste em HTTPS e configure TURN para redes móveis difíceis.'}));
  layer.append(panel);callRoot.append(layer);
}
function mediaStreamFor(kind, stream){
  if(!stream)return null;
  const tracks=kind==='audio'?stream.getAudioTracks():stream.getVideoTracks();
  return tracks.length?new MediaStream(tracks):null;
}
function callAudioConstraints(){
  const base={echoCancellation:true,noiseSuppression:true,autoGainControl:true};
  if(callAudioSelectedInput)base.deviceId={exact:callAudioSelectedInput};
  return base;
}
function callMediaConstraints(mode){return {audio:callAudioConstraints(),video:mode==='video'?{facingMode:'user'}:false};}
async function applyAudioOutput(media){
  if(!media || !callAudioSelectedOutput || typeof media.setSinkId!=='function')return false;
  try{await media.setSinkId(callAudioSelectedOutput);setCallAudioDiagnostic({output:'selecionada'});return true;}
  catch(e){setCallAudioDiagnostic({output:'falhou: '+(e.name||e.message||'erro')});return false;}
}
function stopAudioMeter(which='both'){
  const stop=m=>{if(!m)return;try{m.raf&&cancelAnimationFrame(m.raf);}catch{}try{m.ctx&&m.ctx.close&&m.ctx.close();}catch{}};
  if(which==='both'||which==='local'){stop(callLocalAudioMeter);callLocalAudioMeter=null;}
  if(which==='both'||which==='remote'){stop(callRemoteAudioMeter);callRemoteAudioMeter=null;}
}
function startAudioMeter(stream,type='local'){
  if(!stream?.getAudioTracks?.().length)return;
  stopAudioMeter(type);
  try{
    const AudioCtx=window.AudioContext||window.webkitAudioContext;
    if(!AudioCtx)return;
    const ctx=new AudioCtx();
    const source=ctx.createMediaStreamSource(new MediaStream(stream.getAudioTracks()));
    const analyser=ctx.createAnalyser();
    analyser.fftSize=512;
    source.connect(analyser);
    const data=new Uint8Array(analyser.frequencyBinCount);
    const tick=()=>{
      analyser.getByteFrequencyData(data);
      let sum=0;for(const v of data)sum+=v;
      const level=Math.min(100,Math.round((sum/data.length)/1.8));
      if(C){
        if(type==='local')setCallAudioDiagnostic({localLevel:level,local:true,input:stream.getAudioTracks()[0]?.label||'microfone'});
        else setCallAudioDiagnostic({remoteLevel:level,remote:true});
      }
      const holder=document.querySelector(type==='local'?'.local-mic-level .meter-fill':'.remote-mic-level .meter-fill');
      if(holder)holder.style.width=level+'%';
      const tile=document.querySelector(type==='local'?'.local-tile':'.remote-tile');
      if(tile)tile.classList.toggle('speaking',level>18);
      const meter=type==='local'?callLocalAudioMeter:callRemoteAudioMeter;
      if(meter)meter.raf=requestAnimationFrame(tick);
    };
    const meter={ctx,source,analyser,raf:requestAnimationFrame(tick)};
    if(type==='local')callLocalAudioMeter=meter; else callRemoteAudioMeter=meter;
  }catch(e){}
}
function audioMeter(label,level=0,cls=''){
  return div('audio-meter '+cls,make('span',{text:label}),div('meter-track',make('span',{class:'meter-fill',style:'width:'+Math.max(0,Math.min(100,level||0))+'%'})));
}

function ensureCallAudioSink(){
  if(callAudioSink&&document.body.contains(callAudioSink))return callAudioSink;
  callAudioSink=document.createElement('audio');
  callAudioSink.className='global-call-audio-sink';
  callAudioSink.autoplay=true;
  callAudioSink.playsInline=true;
  callAudioSink.setAttribute('playsinline','');
  callAudioSink.setAttribute('aria-hidden','true');
  callAudioSink.volume=1;
  applyAudioOutput(callAudioSink);
  document.body.appendChild(callAudioSink);
  return callAudioSink;
}
function setCallAudioDiagnostic(patch){if(C)C.audioDiagnostics={...(C.audioDiagnostics||{}),...patch};}
async function resumeCallAudioEngine(){
  try{
    const AudioCtx=window.AudioContext||window.webkitAudioContext;
    if(!AudioCtx)return false;
    if(!callAudioContext)callAudioContext=new AudioCtx();
    if(callAudioContext.state!=='running')await callAudioContext.resume();
    return callAudioContext.state==='running';
  }catch(e){return false;}
}
function callDoctorModal(){
  const box=modalFrame('Diagnóstico da call','Use isto antes de chamar alguém ou durante uma chamada para descobrir se o problema é permissão, saída de áudio, conexão ou TURN.');
  const out=div('call-doctor-box');
  const line=(k,v,ok=true)=>div('doctor-row '+(ok?'ok':'warn'),make('strong',{text:k}),make('span',{text:v}));
  const refresh=async()=>{
    out.replaceChildren(line('HTTPS',window.isSecureContext?'ok':'bloqueado',window.isSecureContext),line('WebRTC',window.RTCPeerConnection?'ok':'não suportado',!!window.RTCPeerConnection),line('Microfone API',navigator.mediaDevices?.getUserMedia?'ok':'não disponível',!!navigator.mediaDevices?.getUserMedia),line('Saída dedicada',HTMLMediaElement.prototype.setSinkId?'suportada':'não suportada neste navegador',!!HTMLMediaElement.prototype.setSinkId),line('Contexto de áudio',callAudioContext?.state||'ainda não iniciado',callAudioContext?.state==='running'||!callAudioContext));
    const status=C?.turnStatus||turnDiagnostics||await getTurnStatus();
    out.append(line('TURN servidor',turnStatusSummary(status),!!status?.turnConfigured),line('Política ICE',status?.iceTransportPolicy||'all',true));
    if(status?.warnings?.length)out.append(line('Avisos TURN',status.warnings.join(' | '),false));
    if(C){const d=C.audioDiagnostics||{};out.append(line('Estado da chamada',String(C.connectionState||C.status||'nova')),line('Seu microfone',d.local?'detectado':'não detectado',!!d.local),line('Áudio remoto',d.remote?'chegou':'não chegou',!!d.remote),line('Saída de áudio',d.playing?'tocando':(C.audioUnlocked?'liberada':'bloqueada'),!!d.playing),line('TURN usado na call',C.turnEnabled?(C.turnStatus?.relayForced?'relay forçado':'configurado'):'não configurado',!!C.turnEnabled),line('Nível do seu mic',String(d.localLevel||0)+'%',(d.localLevel||0)>0||!!d.local),line('Nível remoto',String(d.remoteLevel||0)+'%',(d.remoteLevel||0)>0||!!d.remote),line('Entrada escolhida',d.input||'padrão do aparelho',true),line('Saída escolhida',d.output|| (callAudioSelectedOutput?'selecionada':'padrão do aparelho'),true));}
  };
  box.append(out,div('modal-actions',btn('Testar microfone',()=>task(testLocalMicrophone),'btn secondary'),btn('Testar som do aparelho',()=>task(testDeviceSpeaker),'btn secondary'),btn('Configurar áudio',()=>task(callAudioSettingsModal),'btn secondary'),btn('Verificar TURN',()=>task(turnStatusModal),'btn secondary'),C?btn('Forçar áudio da call',()=>task(repairCallAudio),'btn primary'):null,btn('Atualizar',()=>task(refresh),'btn secondary'),btn('Fechar',closeModal,'btn ghost')));
  task(refresh);
}
async function testDeviceSpeaker(){
  const ok=await resumeCallAudioEngine();
  if(!ok){toast('O navegador bloqueou o som. Toque no botão de novo e confira o volume/mídia do celular.',true);return;}
  try{
    const osc=callAudioContext.createOscillator();const gain=callAudioContext.createGain();
    osc.type='sine';osc.frequency.value=660;gain.gain.value=.06;osc.connect(gain);gain.connect(callAudioContext.destination);osc.start();setTimeout(()=>{try{osc.stop();osc.disconnect();gain.disconnect();}catch{}},350);
    toast('Se você ouviu um bip, a saída de som do aparelho está funcionando.');
  }catch(e){toast('Não consegui tocar o bip: '+(e.message||e.name),true);}
}
async function testLocalMicrophone(){
  try{
    const stream=await navigator.mediaDevices.getUserMedia({audio:callAudioConstraints(),video:false});
    const track=stream.getAudioTracks()[0];
    startAudioMeter(stream,'local');
    toast(track?'Microfone liberado: '+(track.label||'detectado')+'. Fale agora: o medidor deve mexer.':'Microfone não apareceu.',!track);
    setTimeout(()=>{stream.getTracks().forEach(t=>t.stop());stopAudioMeter('local');},2500);
  }catch(e){toast('Microfone bloqueado: '+(e.name||e.message||'permissão negada'),true);}
}
async function callAudioSettingsModal(){
  const box=modalFrame('Configurar áudio','Escolha microfone e saída de som quando o navegador permitir. No celular, alguns navegadores usam sempre o padrão do aparelho.');
  const mic=make('select',{});const out=make('select',{});
  const fill=async()=>{
    if(!navigator.mediaDevices?.enumerateDevices){toast('Este navegador não lista dispositivos de áudio.',true);return;}
    try{await navigator.mediaDevices.getUserMedia({audio:true,video:false}).then(s=>s.getTracks().forEach(t=>t.stop())).catch(()=>{});}catch{}
    const devices=await navigator.mediaDevices.enumerateDevices();
    mic.replaceChildren(make('option',{value:'',text:'Microfone padrão'}));
    out.replaceChildren(make('option',{value:'',text:'Saída padrão do aparelho'}));
    devices.filter(d=>d.kind==='audioinput').forEach((d,i)=>mic.append(make('option',{value:d.deviceId,selected:d.deviceId===callAudioSelectedInput,text:d.label||'Microfone '+(i+1)})));
    devices.filter(d=>d.kind==='audiooutput').forEach((d,i)=>out.append(make('option',{value:d.deviceId,selected:d.deviceId===callAudioSelectedOutput,text:d.label||'Saída '+(i+1)})));
  };
  box.append(label('Microfone',mic),label('Saída de áudio',out),make('p',{class:'dim'},HTMLMediaElement.prototype.setSinkId?'Seu navegador permite escolher saída de áudio.':'Este navegador não permite trocar a saída de áudio diretamente; use o controle do celular/fone.'),div('modal-actions',btn('Testar microfone',()=>task(testLocalMicrophone),'btn secondary'),btn('Testar som',()=>task(testDeviceSpeaker),'btn secondary'),btn('Salvar áudio',()=>task(async()=>{callAudioSelectedInput=mic.value;callAudioSelectedOutput=out.value;localStorage.setItem('nexhub.audioInput',callAudioSelectedInput);localStorage.setItem('nexhub.audioOutput',callAudioSelectedOutput);if(callAudioSink)await applyAudioOutput(callAudioSink);setCallAudioDiagnostic({input:mic.options[mic.selectedIndex]?.text||'',output:out.options[out.selectedIndex]?.text||''});toast('Preferências de áudio salvas.');closeModal();renderCall();}),'btn primary'),btn('Fechar',closeModal,'btn ghost')));
  task(fill);
}

function attachRemoteAudio(stream){
  if(!C)return false;
  const audioStream=mediaStreamFor('audio',stream||C.remote);
  setCallAudioDiagnostic({local:!!C.local?.getAudioTracks?.().length,remote:!!audioStream?.getAudioTracks?.().length});
  if(!audioStream)return false;
  const sink=ensureCallAudioSink();
  if(sink.srcObject!==audioStream)sink.srcObject=audioStream;
  applyAudioOutput(sink);
  startAudioMeter(audioStream,'remote');
  sink.muted=!C.audioUnlocked;
  sink.volume=1;
  if(C.audioUnlocked){
    sink.play().then(()=>{setCallAudioDiagnostic({playing:true,error:''}); if(C)C.needsPlayback=false;})
      .catch(err=>{setCallAudioDiagnostic({playing:false,error:err?.name||err?.message||'play bloqueado'}); if(C&&!C.needsPlayback){C.needsPlayback=true;renderCall();}});
  }
  return true;
}
function playCallMedia(media){
  if(!media)return;
  media.volume=1;
  applyAudioOutput(media);
  if(media.classList?.contains('remote-audio'))media.muted=!C?.audioUnlocked;
  media.play().then(()=>{if(C){C.needsPlayback=false;setCallAudioDiagnostic({playing:true,error:''});}})
    .catch(err=>{if(C){setCallAudioDiagnostic({playing:false,error:err?.name||err?.message||'play bloqueado'});if(!C.needsPlayback){C.needsPlayback=true;renderCall();}}});
}
function enableCallAudioByGesture(){
  if(!C)return false;
  resumeCallAudioEngine();
  callAudioUnlockToken=true;
  C.audioUnlocked=true;
  C.needsPlayback=false;
  const attached=attachRemoteAudio(C.remote);
  for(const media of [...document.querySelectorAll('.remote-audio, .remote-video')]){
    media.muted=media.classList.contains('remote-video');
    if(media.classList.contains('remote-audio'))media.muted=false;
    media.volume=1;
    media.play().catch(()=>{});
  }
  return attached;
}
function unlockCallAudio(){
  if(!C)return;
  const attached=enableCallAudioByGesture();
  renderCall();
  enableCallAudioByGesture();
  toast(attached?'Som da chamada ativado.':'Áudio liberado. Quando o áudio da outra pessoa chegar, ele toca automático.');
}
async function repairCallAudio(){
  if(!C)return;
  enableCallAudioByGesture();
  if(!C.local?.getAudioTracks?.().length){
    const audioOnly=await navigator.mediaDevices.getUserMedia({audio:callAudioConstraints(),video:false});
    const track=audioOnly.getAudioTracks()[0];
    if(!C.local)C.local=new MediaStream();
    C.local.addTrack(track);
    const pc=await createPeer();
    const sender=pc?.getSenders?.().find(s=>s.track?.kind==='audio');
    if(sender)await sender.replaceTrack(track); else pc?.addTrack(track,C.local);
  }
  if(C.role==='caller')await sendOffer(C,true).catch(e=>{C.lastError=e.message;});
  renderCall();
  setTimeout(()=>{attachRemoteAudio(C?.remote);},250);
  toast('Tentando recuperar o áudio da chamada…');
}
async function toggleScreenShare(){
  if(!C||!C.pc)return;
  if(C.screenSharing){
    C.screenTrack?.stop?.();
    C.screenSharing=false;C.screenTrack=null;renderCall();toast('Compartilhamento de tela encerrado.');return;
  }
  if(!navigator.mediaDevices?.getDisplayMedia)throw Error('Seu navegador não suporta compartilhar tela.');
  const display=await navigator.mediaDevices.getDisplayMedia({video:true,audio:false});
  const track=display.getVideoTracks()[0];
  if(!track)throw Error('Nenhuma tela selecionada.');
  C.screenTrack=track;C.screenSharing=true;
  track.onended=()=>{if(C){C.screenSharing=false;C.screenTrack=null;renderCall();}};
  const sender=C.pc.getSenders().find(s=>s.track?.kind==='video');
  if(sender)await sender.replaceTrack(track);else C.pc.addTrack(track,display);
  if(!C.local)C.local=new MediaStream();
  if(!C.local.getTracks().some(t=>t.id===track.id))C.local.addTrack(track);
  C.mode='video';renderCall();toast('Compartilhamento de tela iniciado.');
}
function renderCall(){
  callRoot.replaceChildren();if(!C){renderGroupCall();return;}
  const network=String(C.connectionState||'new').toLowerCase();
  const callPhase=C.status==='ringing'?'ringing':
    C.status==='failed'||network==='failed'||network==='closed'?'failed':
    network==='disconnected'?'reconnecting':
    ['new','checking','connecting'].includes(network)?'connecting':'active';
  const callLabel=callPhase==='ringing'?(C.role==='receiver'?'Chamada recebida':'Chamando…'):
    callPhase==='connecting'?'Conectando…':
    callPhase==='reconnecting'?'Reconectando…':
    callPhase==='failed'?'Falha na conexão':'Em chamada';
  if(C.minimized){
    callRoot.append(div('call-minibar',
      avatar(C.peer.displayName,C.peer.color,'',C.peer.avatarUrl),
      div('minibar-label',make('strong',{text:C.peer.displayName}),make('small',{class:'call-minibar-state '+callPhase,text:callLabel})),
      icon('volume-2',()=>unlockCallAudio(),'Ativar som','minibar-sound'),
      icon('chevron-right',()=>{C.minimized=false;renderCall();},'Voltar à chamada'),
      icon('phone-off',()=>task(()=>hangup('end')),'Encerrar chamada','minibar-end')));
    return;
  }
  const layer=div('call-layer call-layer-state-'+callPhase);const panel=div('call-panel');
  panel.dataset.callState=callPhase;
  panel.dataset.callMode=C.mode||'audio';
  panel.dataset.connectionState=network;
  panel.append(div('call-header',icon('chevron-down',()=>{C.minimized=true;renderCall();},'Recolher chamada'),
      div('call-header-center',make('strong',{text:'NexHub Call'}),make('span',{class:'call-status-label '+callPhase,'aria-live':'polite','aria-atomic':'true',text:callLabel})),
      icon('users',()=>toast('Chamada privada individual do NexHub.'),'Participantes')));
  const tiles=div('call-tiles');
  const peerTile=div('call-tile remote-tile');
  peerTile.dataset.callState=callPhase;
  if(C.status!=='ringing'){
    const audioStream=mediaStreamFor('audio',C.remote);
    const videoStream=mediaStreamFor('video',C.remote);
    if(C.mode==='video'){
      const remoteVideo=make('video',{autoplay:true,playsinline:true,muted:true,class:'remote-video'});
      remoteVideo.muted=true;
      if(videoStream){remoteVideo.srcObject=videoStream;playCallMedia(remoteVideo);peerTile.classList.add('has-remote-video');}
      peerTile.append(remoteVideo);
      if(audioStream){
        const remoteAudio=make('audio',{autoplay:true,playsinline:true,class:'remote-audio remote-audio-track','aria-label':'Áudio remoto da chamada'});
        remoteAudio.srcObject=audioStream;
        remoteAudio.muted=!C.audioUnlocked;
        playCallMedia(remoteAudio);
        peerTile.append(remoteAudio);
      }
    }else{
      const remoteAudio=make('audio',{autoplay:true,playsinline:true,class:'remote-audio','aria-label':'Áudio remoto da chamada'});
      if(audioStream){remoteAudio.srcObject=audioStream;remoteAudio.muted=!C.audioUnlocked;playCallMedia(remoteAudio);}
      peerTile.append(remoteAudio);
      if(videoStream){const remoteVideo=make('video',{autoplay:true,playsinline:true,muted:true,class:'remote-video screen-video'});remoteVideo.muted=true;remoteVideo.srcObject=videoStream;playCallMedia(remoteVideo);peerTile.prepend(remoteVideo);peerTile.classList.add('has-remote-video');}
    }
    if(audioStream){peerTile.classList.add('has-remote-audio');attachRemoteAudio(C.remote);}
  }
  peerTile.append(div('call-user-fallback',avatar(C.peer.displayName,C.peer.color,'avatar-large',C.peer.avatarUrl)),
    div('call-name',symbol(C.remote?.getAudioTracks?.().length?'volume-2':'mic'),make('span',{text:C.peer.displayName})),
    audioMeter('áudio recebido',C.audioDiagnostics?.remoteLevel||0,'remote-mic-level'));
  tiles.append(peerTile);
  const ownTile=div('call-tile local-tile');
  ownTile.dataset.callState=callPhase;
  if(C.status!=='ringing'&&C.local&&(C.mode==='video'||C.screenSharing)){
    const local=make('video',{class:'local-video',autoplay:true,muted:true,playsinline:true});local.muted=true;local.srcObject=C.local;ownTile.append(local);
    if(!C.cameraOff)ownTile.classList.add('has-local-video');
  }
  ownTile.append(div('call-user-fallback',avatar(S.me.displayName,S.me.color,'avatar-large',S.me.avatarUrl)),
    div('call-name',symbol(C.muted?'mic-off':'mic'),make('span',{text:S.me.displayName+' (você)'})),
    audioMeter('seu microfone',C.audioDiagnostics?.localLevel||0,'local-mic-level'));
  tiles.append(ownTile);panel.append(tiles);
  const controls=div('call-controlbar');
  if(C.status==='ringing'&&C.role==='receiver'){
    controls.append(icon('check',()=>task(acceptCall),'Atender ligação','call-action accept-call'),
      icon('phone-off',()=>task(()=>hangup('reject')),'Recusar ligação','call-action hangup-call'));
  }else{
    if(C.status!=='ringing'){
      if(C.mode==='video')controls.append(icon(C.cameraOff?'video-off':'video',()=>{C.cameraOff=!C.cameraOff;C.local?.getVideoTracks().forEach(t=>t.enabled=!C.cameraOff);renderCall();},C.cameraOff?'Ligar câmera':'Desligar câmera','call-action'+(C.cameraOff?' action-off':'')));
      controls.append(icon(C.muted?'mic-off':'mic',()=>{C.muted=!C.muted;C.local?.getAudioTracks().forEach(t=>t.enabled=!C.muted);renderCall();},C.muted?'Ativar microfone':'Silenciar microfone','call-action'+(C.muted?' action-off':'')));
      controls.append(icon('volume-2',()=>unlockCallAudio(),C.audioUnlocked?'Som ativado':'Ativar som da pessoa','call-action'+(C.audioUnlocked?'':' action-warn')));
      controls.append(icon('refresh-cw',()=>task(repairCallAudio),'Forçar áudio','call-action'));
      if(navigator.mediaDevices?.getDisplayMedia)controls.append(icon('monitor',()=>task(toggleScreenShare),C.screenSharing?'Parar compartilhamento de tela':'Compartilhar tela','call-action'+(C.screenSharing?' action-on':'')));
      controls.append(icon('settings',()=>task(callAudioSettingsModal),'Configurar áudio','call-action'));
      controls.append(icon('shield',()=>callDoctorModal(),'Diagnóstico','call-action'));
    }
    if(C.status==='failed' && C.role==='caller')controls.append(icon('refresh-cw',()=>task(()=>sendOffer(C,true)),'Tentar conectar novamente','call-action'));
    if(C.needsPlayback)controls.append(icon('volume-2',()=>unlockCallAudio(),'Toque para liberar o áudio','call-action action-warn'));
    controls.append(icon('phone-off',()=>task(()=>hangup('end')),'Desligar ligação','call-action hangup-call'));
  }
  const diag=C.audioDiagnostics||{};
  const audioDetail='mic '+(diag.local?'ok':'não detectado')+' '+(diag.localLevel||0)+'% · áudio remoto '+(diag.remote?'chegou':'não chegou')+' '+(diag.remoteLevel||0)+'% · saída '+(diag.playing?'tocando':(C.audioUnlocked?'liberada':'bloqueada'));
  const detail=C.lastError||('Estado: '+(C.status==='active'?'conectada':C.status==='ringing'?'tocando':C.status||'preparando')+' · rede '+(C.connectionState||'nova'));
  const networkDetail=C.turnEnabled?(C.turnStatus?.relayForced?'TURN relay forçado.':'TURN configurado.'):(C.turnStatus?.warnings?.[0]||'use HTTPS; em internet móvel pode precisar de TURN.');
  panel.append(controls,make('small',{class:'call-tip call-audio-debug',text:detail+' — '+audioDetail+' — '+networkDetail}));
  layer.append(panel);callRoot.append(layer);
}
async function ensureCallSupport(mode){
  if(!window.RTCPeerConnection || !navigator.mediaDevices?.getUserMedia)throw Error('Seu navegador precisa de HTTPS para chamadas. Abra pelo link https do Replit/hospedagem.');
  if(!window.isSecureContext && !['localhost','127.0.0.1'].includes(location.hostname))throw Error('Chamadas só funcionam em HTTPS. Abra pelo link seguro do app.');
  let probe=null;
  try{probe=await navigator.mediaDevices.getUserMedia(callMediaConstraints(mode));}
  catch(e){throw Error((mode==='video'?'Permita câmera e microfone para iniciar a chamada.':'Permita o microfone para iniciar a chamada.')+' Erro: '+(e.name||e.message||'permissão negada'));}
  finally{probe?.getTracks().forEach(t=>t.stop());}
}
async function startCall(to,mode){
  if(C)throw Error('Encerre a chamada atual primeiro.');
  if(G)throw Error('Saia da call em grupo antes de iniciar uma chamada privada.');
  await ensureCallSupport(mode);
  const {call}=await request('/api/calls','POST',{to,mode});
  if(!C)C=newCallState(call,'caller');
  C.audioUnlocked=true; callAudioUnlockToken=true;
  startCallSync();
  renderCall();
}
async function createPeer(){
  if(!C)return null;
  if(C.pc)return C.pc;
  const call=C;
  const local=await navigator.mediaDevices.getUserMedia(callMediaConstraints(call.mode));
  if(C!==call){local.getTracks().forEach(t=>t.stop());return null;}
  call.local=local;
  startAudioMeter(local,'local');
  try {
    const config=await request('/api/calls/ice-config');
    if(C!==call){local.getTracks().forEach(t=>t.stop());return null;}
    call.turnEnabled=Boolean(config.turnEnabled);
    call.turnStatus=config.turnStatus||null;turnDiagnostics=config.turnStatus||turnDiagnostics;
    const pc=new RTCPeerConnection({iceServers:config.iceServers,iceTransportPolicy:config.iceTransportPolicy});
    call.pc=pc;
    local.getTracks().forEach(track=>pc.addTrack(track,local));
    pc.ontrack=e=>{
      if(C!==call)return;
      if(!call.remote)call.remote=new MediaStream();
      if(!call.remote.getTracks().some(t=>t.id===e.track.id))call.remote.addTrack(e.track);
      if(e.track.kind==='audio'){attachRemoteAudio(call.remote);startAudioMeter(call.remote,'remote');}
      renderCall();
    };
    pc.onicecandidate=e=>{
      if(e.candidate&&C===call)request('/api/calls/'+call.id+'/signal','POST',{type:'ice',payload:e.candidate.toJSON()})
        .catch(err=>{if(C===call)toast('Falha ao enviar sinal de rede: '+err.message,true);});
    };
    const updateConnectionState=()=>{
      if(C!==call)return;
      call.connectionState=pc.connectionState||pc.iceConnectionState||'new';
      if(pc.connectionState==='connected'||pc.iceConnectionState==='connected'||pc.iceConnectionState==='completed'){
        call.status='active';call.restarts=0;call.lastError='';renderCall();
      } else if(pc.connectionState==='failed'||pc.iceConnectionState==='failed'){
        call.status='failed';call.lastError='Não conectou áudio/vídeo. Se estiver em internet móvel, configure TURN.';renderCall();
        if(call.role==='caller'&&call.restarts<2){call.restarts++;task(()=>sendOffer(call,true));}
        else toast(call.lastError,true);
      } else if(pc.connectionState==='disconnected'||pc.iceConnectionState==='disconnected'){
        call.status='connected';call.lastError='Reconectando a chamada…';renderCall();
      }
    };
    pc.onconnectionstatechange=updateConnectionState;
    pc.oniceconnectionstatechange=updateConnectionState;
    renderCall();return pc;
  }catch(error){
    local.getTracks().forEach(t=>t.stop());call.local=null;throw error;
  }
}
async function sendOffer(call,restart=false){
  if(!call || C!==call || call.role!=='caller')return;
  if(call.offerSent&&!restart)return;
  call.offerSent=true;
  try{
    const pc=await createPeer();if(!pc || C!==call)return;
    const offer=await pc.createOffer(restart?{iceRestart:true}:{});
    await pc.setLocalDescription(offer);
    await request('/api/calls/'+call.id+'/signal','POST',{type:'offer',payload:{type:offer.type,sdp:offer.sdp}});
    call.status='connected';renderCall();
  }catch(error){call.offerSent=false;throw error;}
}
async function acceptCall(){
  if(!C||C.role!=='receiver'||C.status!=='ringing')return;
  const call=C;
  C.audioUnlocked=true; callAudioUnlockToken=true;
  try{
    await createPeer();
    if(C!==call)return;
    const {call:result}=await request('/api/calls/'+call.id+'/accept','POST',{});
    if(C===call){call.status=result.status;renderCall();}
  }catch(e){if(C===call){await hangup('reject').catch(()=>{});}throw e;}
}
async function hangup(action='end'){
  if(!C)return;const call=C;
  releaseCall();
  await request('/api/calls/'+call.id+'/'+action,'POST',{}).catch(()=>{});
}
function releaseCall(){if(!C)return;stopAudioMeter('both');C.pc?.close();C.local?.getTracks().forEach(t=>t.stop());C.remote?.getTracks?.().forEach(t=>t.stop());if(callAudioSink){callAudioSink.pause();callAudioSink.srcObject=null;callAudioSink.muted=true;}C=null;if(!G)stopCallSync();renderCall();}
async function syncActiveCall(){
  if(!S.me)return;
  const {call}=await request('/api/calls/active');
  if(!call){if(C)releaseCall();return;}
  if(C && C.id!==call.id)releaseCall();
  if(!C){C=newCallState(call,call.to===S.me.id?'receiver':'caller');startCallSync();renderCall();}
  if(call.status==='connected' && C.role==='caller' && !C.offerSent){
    await sendOffer(C).catch(e=>toast(e.message,true));
  }
  const data=await request('/api/calls/'+call.id+'/signals?after='+C.lastSeq);
  for(const signal of data.signals){
    await queueCallEvent({action:'signal',callId:call.id,...signal});
  }
}
async function syncGroupVoiceSignals(){
  const group=G;if(!group||!S.me)return;
  const data=await request('/api/channels/'+group.channelId+'/voice/signals?after='+group.lastSeq);
  if(G!==group)return;
  if(data.room)group.room=data.room;
  for(const signal of data.signals||[]){
    await queueVoiceEvent({action:'signal',channelId:group.channelId,...signal});
  }
  if(G===group)group.lastSeq=Math.max(group.lastSeq,Number(data.latestSeq||0));
}
async function syncLiveCalls(){
  const tasks=[];
  if(S.me)tasks.push(syncActiveCall());
  if(G&&S.me)tasks.push(syncGroupVoiceSignals());
  await Promise.all(tasks);
}
async function handleCallEvent(ev){
  if(ev.action==='incoming'){
    if(C && C.id!==ev.call.id)return;
    if(!C)C=newCallState(ev.call,'receiver');
    startCallSync();
    renderCall();return;
  }
  if(ev.action==='outgoing' && !C){
    C=newCallState(ev.call,'caller');startCallSync();renderCall();return;
  }
  if(!C||ev.callId!==C.id)return;
  if(['ended','missed','rejected','timeout'].includes(ev.action)){
    const notice=ev.action==='missed'?'Chamada não atendida.':ev.action==='rejected'?'Chamada recusada.':'Chamada encerrada.';
    releaseCall();toast(notice);return;
  }
  if(ev.action==='accepted' && C.role==='caller'){
    if(C.status==='ringing')C.status='connected';
    try{await sendOffer(C);}catch(e){toast(e.message,true);await hangup();}
    return;
  }
  if(ev.action==='signal'){
    const call=C;
    if(ev.seq && ev.seq<=call.lastSeq)return;
    try{
      const pc=await createPeer();if(!pc || C!==call)return;
      if(ev.type==='ice'){
        if(pc.remoteDescription)await pc.addIceCandidate(ev.payload);
        else call.ice.push(ev.payload);
      }else{
        if(ev.type==='offer' && call.role!=='receiver')return;
        if(ev.type==='answer' && call.role!=='caller')return;
        await pc.setRemoteDescription(ev.payload);
        for(const ice of call.ice.splice(0))await pc.addIceCandidate(ice);
        if(ev.type==='offer'){
          const answer=await pc.createAnswer();await pc.setLocalDescription(answer);
          await request('/api/calls/'+call.id+'/signal','POST',{type:'answer',payload:{type:answer.type,sdp:answer.sdp}});
        }
      }
      if(ev.seq)call.lastSeq=ev.seq;
    }catch(e){
      if(C===call){
        call.lastError='Sinal da chamada falhou, tentando manter a ligação: '+(e.message||'erro desconhecido');
        call.connectionState=call.connectionState||'checking';
        renderCall();
        toast(call.lastError,true);
        if(call.role==='caller'&&call.restarts<2){call.restarts++;await sendOffer(call,true).catch(()=>{});}
      }
    }
  }
}
window.addEventListener('pagehide',()=>{
  // Não encerramos a chamada automaticamente no pagehide, porque Android/iPhone podem disparar
  // este evento ao trocar de app, bloquear tela ou abrir seletor de permissões. O usuário encerra
  // a ligação pelo botão vermelho; se a página recarregar, syncActiveCall tenta recuperar a sessão.
  if(G){
    const group=G;G=null;
    for(const peerId of [...group.peers.keys()])closeGroupPeer(group,peerId);
    group.local?.getTracks().forEach(track=>track.stop());
    fetch(apiUrl('/api/channels/'+group.channelId+'/voice'),{method:'DELETE',credentials:'same-origin',keepalive:true}).catch(()=>{});
  }
});
window.addEventListener('pageshow',()=>{ if(S.me)task(syncActiveCall); });
window.addEventListener('visibilitychange',()=>{ if(!document.hidden&&S.me)task(syncActiveCall); });
function closeModal(){if(vipPaymentPoll){clearInterval(vipPaymentPoll);vipPaymentPoll=null;}modalRoot.replaceChildren();}
function modalFrame(title,description){
  const backdrop=div('modal-backdrop');backdrop.addEventListener('click',e=>{if(e.target===backdrop)closeModal();});
  const box=div('modal',make('h2',{text:title}),description?make('p',{text:description}):null);
  backdrop.append(box);modalRoot.replaceChildren(backdrop);return box;
}
function showModal(title,description,fields=[],onSave=async()=>{},saveTitle='Salvar',extra=''){
  const box=modalFrame(title,description);const controls={};
  const form=make('form',{onSubmit:e=>{e.preventDefault();task(async()=>{
    const values={};for(const [key,ctl]of Object.entries(controls))values[key]=ctl.type==='checkbox'?ctl.checked:ctl.value;
    const confirm=form.querySelector('[type=submit]');confirm.disabled=true;
    try {await onSave(values);if(saveTitle!=='Copiar link')closeModal();}
    finally {confirm.disabled=false;}
  });}});
  for(const [i,f] of fields.entries()){
    let el;
    if(f.type==='textarea')el=make('textarea',{rows:3,value:f.value||'',required:!!f.required});
    else if(f.type==='select')el=make('select',{},...(f.options||[]).map(([value,txt])=>make('option',{value,selected:String(f.value)===value},txt)));
    else if(f.type==='checkbox')el=make('input',{type:'checkbox',checked:!!f.value});
    else el=make('input',{type:f.type||'text',value:f.value||'',placeholder:f.placeholder||'',maxlength:f.maxLength||'',readonly:!!f.readonly,required:!!f.required});
    if(f.autocapitalize!==undefined)el.autocapitalize=f.autocapitalize;
    controls[f.key||'field'+i]=el;
    form.append(label(f.label,el));
  }
  if(extra)form.append(make('p',{style:'white-space:pre-wrap',text:extra}));
  form.append(div('modal-actions',btn('Cancelar',closeModal,'btn ghost'),make('button',{type:'submit',class:'btn primary'},saveTitle)));
  box.append(form);
  box.querySelector('input:not([readonly]),textarea,select')?.focus();
}
function confirmModal(title,description,onConfirm,yes='Confirmar'){
  const box=modalFrame(title,description);box.append(div('modal-actions',btn('Cancelar',closeModal,'btn secondary'),btn(yes,()=>task(async()=>{await onConfirm();closeModal();}),'btn danger')));
}
function chooseModal(title,description,choices){
  const box=modalFrame(title,description);
  for(const choice of choices)box.append(make('button',{type:'button',class:'side-channel hover-outline',style:'padding:13px 10px',onClick:()=>task(async()=>{closeModal();await choice.onClick();})},choice.label));
  box.append(div('modal-actions',btn('Fechar',closeModal,'btn ghost')));
}
if('serviceWorker' in navigator && location.protocol.startsWith('http'))navigator.serviceWorker.register('/sw.js').catch(()=>{});
initialize();
