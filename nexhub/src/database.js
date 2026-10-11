import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export function openDatabase(path = process.env.DB_PATH || './data/nexo.sqlite') {
  if (path !== ':memory:') mkdirSync(dirname(resolve(path)), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      email TEXT NOT NULL UNIQUE COLLATE NOCASE, password_hash TEXT NOT NULL,
      display_name TEXT NOT NULL, bio TEXT NOT NULL DEFAULT '',
      color TEXT NOT NULL DEFAULT '#8b82ff', status TEXT NOT NULL DEFAULT 'online',
      theme TEXT NOT NULL DEFAULT 'dark', allow_dm INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
    CREATE TABLE IF NOT EXISTS servers (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
      owner_id TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS memberships (
      server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL DEFAULT 'member', joined_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY(server_id,user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_members_user ON memberships(user_id);
    CREATE TABLE IF NOT EXISTS bans (
      server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      actor_id TEXT NOT NULL, reason TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY(server_id,user_id)
    );
    CREATE TABLE IF NOT EXISTS channels (
      id TEXT PRIMARY KEY, server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
      name TEXT NOT NULL, topic TEXT NOT NULL DEFAULT '',
      slowmode INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(server_id,name)
    );
    CREATE INDEX IF NOT EXISTS idx_channel_server ON channels(server_id);
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY, channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id), content TEXT NOT NULL DEFAULT '',
      reply_to TEXT REFERENCES messages(id) ON DELETE SET NULL,
      pinned INTEGER NOT NULL DEFAULT 0,
      poll_question TEXT, poll_options TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_msg_channel_date ON messages(channel_id,created_at DESC,id DESC);
    CREATE TABLE IF NOT EXISTS reactions (
      message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      emoji TEXT NOT NULL, PRIMARY KEY(message_id,user_id,emoji)
    );
    CREATE TABLE IF NOT EXISTS poll_votes (
      message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      option_index INTEGER NOT NULL, PRIMARY KEY(message_id,user_id)
    );
    CREATE TABLE IF NOT EXISTS invites (
      code TEXT PRIMARY KEY, server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
      creator_id TEXT NOT NULL REFERENCES users(id), uses INTEGER NOT NULL DEFAULT 0,
      max_uses INTEGER, expires_at INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS audit (
      id TEXT PRIMARY KEY, server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
      actor_id TEXT NOT NULL, target_id TEXT, action TEXT NOT NULL,
      detail TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_audit_server ON audit(server_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS friends (
      id TEXT PRIMARY KEY, from_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      to_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      state TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(from_id,to_id)
    );
    CREATE TABLE IF NOT EXISTS dms (
      id TEXT PRIMARY KEY, from_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      to_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      content TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_dm_pair ON dms(from_id,to_id,created_at);
    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      text TEXT NOT NULL, href TEXT NOT NULL DEFAULT '', read INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_note_user ON notifications(user_id,read,created_at DESC);
  `);
  // Migração não destrutiva: continua compatível com os bancos criados na v1.0.
  const columns = db.prepare('PRAGMA table_info(users)').all().map(c => c.name);
  for (const col of ['avatar_url', 'banner_url', 'banner_type']) {
    if (!columns.includes(col)) db.exec(`ALTER TABLE users ADD COLUMN ${col} TEXT NOT NULL DEFAULT ''`);
  }
  if (!columns.includes('profile_effect')) db.exec("ALTER TABLE users ADD COLUMN profile_effect TEXT NOT NULL DEFAULT 'none'");
  // Versão 5: migrações aditivas (não apagam contas, perfis nem mensagens).
  function column(table, name, ddl) {
    if (!db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${ddl}`);
  }
  column('users','banned_at','TEXT');
  column('users','ban_reason',"TEXT NOT NULL DEFAULT ''");
  // Versão 6: segurança de conta e recuperação.
  column('users','twofa_enabled','INTEGER NOT NULL DEFAULT 0');
  column('users','twofa_secret',"TEXT NOT NULL DEFAULT ''");
  column('users','recovery_codes',"TEXT NOT NULL DEFAULT '[]'");
  column('users','email_verified','INTEGER NOT NULL DEFAULT 0');
  // v27: assinatura VIP/NexHub Plus. Campos aditivos para não quebrar bancos antigos.
  column('users','vip_since','TEXT');
  column('users','vip_until','TEXT');
  column('users','vip_plan',"TEXT NOT NULL DEFAULT ''");
  column('users','vip_note',"TEXT NOT NULL DEFAULT ''");
  column('users','vip_name_style',"TEXT NOT NULL DEFAULT ''");
  column('users','vip_profile_animation_url',"TEXT NOT NULL DEFAULT ''");
  column('servers','icon_url',"TEXT NOT NULL DEFAULT ''");
  column('servers','automod_enabled','INTEGER NOT NULL DEFAULT 0');
  column('servers','block_links','INTEGER NOT NULL DEFAULT 0');
  column('servers','blocked_words',"TEXT NOT NULL DEFAULT '[]'");
  column('servers','text_locked','INTEGER NOT NULL DEFAULT 0');
  column('servers','voice_locked','INTEGER NOT NULL DEFAULT 0');
  column('servers','welcome_enabled','INTEGER NOT NULL DEFAULT 0');
  column('memberships','custom_role_id','TEXT');
  column('channels','type',"TEXT NOT NULL DEFAULT 'text'");
  column('channels','locked','INTEGER NOT NULL DEFAULT 0');
  column('sessions','created_at',"TEXT NOT NULL DEFAULT (datetime('now'))");
  column('sessions','ip',"TEXT NOT NULL DEFAULT ''");
  column('sessions','user_agent',"TEXT NOT NULL DEFAULT ''");
  column('users','last_login_at','TEXT');
  column('users','security_score','INTEGER NOT NULL DEFAULT 100');
  column('users','last_security_notice',"TEXT NOT NULL DEFAULT ''");
  // v34: Painel admin por nome, suspensão temporária e selos/títulos oficiais.
  column('users','suspended_until','TEXT');
  column('users','suspension_reason',"TEXT NOT NULL DEFAULT ''");
  column('users','suspended_by',"TEXT NOT NULL DEFAULT ''");
  // v35: ideias completas sem sistema de XP/nível.
  column('users','premium_bio',"TEXT NOT NULL DEFAULT ''");
  column('users','activity_text',"TEXT NOT NULL DEFAULT ''");
  column('users','activity_kind',"TEXT NOT NULL DEFAULT 'online'");
  column('users','favorite_server_id',"TEXT NOT NULL DEFAULT ''");
  column('servers','category',"TEXT NOT NULL DEFAULT 'comunidade'");
  column('servers','verified_badge',"TEXT NOT NULL DEFAULT ''");
  column('servers','featured','INTEGER NOT NULL DEFAULT 0');
  column('servers','safe_community','INTEGER NOT NULL DEFAULT 0');
  db.exec(`
    CREATE TABLE IF NOT EXISTS custom_roles (
      id TEXT PRIMARY KEY, server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
      name TEXT NOT NULL, color TEXT NOT NULL DEFAULT '#8b82ff',
      permissions TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(server_id,name)
    );
    CREATE INDEX IF NOT EXISTS idx_custom_roles_server ON custom_roles(server_id);
    CREATE TABLE IF NOT EXISTS reports (
      id TEXT PRIMARY KEY,
      reporter_id TEXT NOT NULL REFERENCES users(id), target_user_id TEXT NOT NULL REFERENCES users(id),
      message_id TEXT, server_id TEXT,
      reason TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
      reviewer_id TEXT, resolution TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')), reviewed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status,created_at DESC);
    CREATE TABLE IF NOT EXISTS user_blocks (
      blocker_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      blocked_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),PRIMARY KEY(blocker_id,blocked_id)
    );
    CREATE TABLE IF NOT EXISTS platform_admins (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      added_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS platform_audit (
      id TEXT PRIMARY KEY, admin_id TEXT NOT NULL, action TEXT NOT NULL,
      target_id TEXT NOT NULL, reason TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS user_titles (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title_id TEXT NOT NULL,
      assigned_by TEXT NOT NULL,
      reason TEXT NOT NULL DEFAULT '',
      expires_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY(user_id,title_id)
    );
    CREATE INDEX IF NOT EXISTS idx_user_titles_user ON user_titles(user_id,created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_user_titles_title ON user_titles(title_id,created_at DESC);

    CREATE TABLE IF NOT EXISTS daily_rewards (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      reward_date TEXT NOT NULL, streak INTEGER NOT NULL DEFAULT 1,
      reward TEXT NOT NULL DEFAULT '', claimed_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY(user_id,reward_date)
    );

    CREATE TABLE IF NOT EXISTS app_roadmap_items (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, category TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'planned', priority INTEGER NOT NULL DEFAULT 5,
      note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      endpoint TEXT NOT NULL UNIQUE, p256dh TEXT NOT NULL DEFAULT '', auth TEXT NOT NULL DEFAULT '',
      user_agent TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_push_user ON push_subscriptions(user_id);

    CREATE TABLE IF NOT EXISTS bot_catalog (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL,
      permissions TEXT NOT NULL DEFAULT '[]', enabled INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS server_bots (
      server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
      bot_id TEXT NOT NULL REFERENCES bot_catalog(id) ON DELETE CASCADE,
      config TEXT NOT NULL DEFAULT '{}', added_by TEXT NOT NULL,
      added_at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY(server_id,bot_id)
    );

    CREATE TABLE IF NOT EXISTS vip_payments (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      amount_cents INTEGER NOT NULL DEFAULT 500,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','paid','expired','cancelled')),
      provider TEXT NOT NULL DEFAULT 'pix',
      reference TEXT NOT NULL UNIQUE,
      pix_key TEXT NOT NULL DEFAULT '',
      pix_payload TEXT NOT NULL DEFAULT '',
      transaction_id TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at INTEGER NOT NULL,
      paid_at TEXT,
      raw_event TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_vip_payments_user ON vip_payments(user_id,created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_vip_payments_status ON vip_payments(status,expires_at);

    CREATE TABLE IF NOT EXISTS server_boosts (
      id TEXT PRIMARY KEY,
      server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at TEXT,
      UNIQUE(server_id,user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_server_boosts_server ON server_boosts(server_id,created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_server_boosts_user ON server_boosts(user_id,created_at DESC);

    CREATE TABLE IF NOT EXISTS security_events (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      kind TEXT NOT NULL,
      detail TEXT NOT NULL DEFAULT '',
      ip TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_security_events_kind ON security_events(kind,created_at DESC);


    CREATE TABLE IF NOT EXISTS upload_audit (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      url TEXT NOT NULL DEFAULT '',
      ext TEXT NOT NULL DEFAULT '',
      bytes INTEGER NOT NULL DEFAULT 0,
      sha256 TEXT NOT NULL DEFAULT '',
      verdict TEXT NOT NULL DEFAULT 'accepted',
      ip TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_upload_audit_user ON upload_audit(user_id,created_at DESC);

    CREATE TABLE IF NOT EXISTS bot_action_logs (
      id TEXT PRIMARY KEY,
      server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
      bot_id TEXT NOT NULL,
      actor_id TEXT NOT NULL,
      action TEXT NOT NULL,
      detail TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_bot_action_logs_server ON bot_action_logs(server_id,created_at DESC);

    CREATE TABLE IF NOT EXISTS production_checks (
      id TEXT PRIMARY KEY,
      admin_id TEXT NOT NULL,
      item TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_production_checks_status ON production_checks(status,created_at DESC);

    CREATE TABLE IF NOT EXISTS app_shop_items (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '', price_kind TEXT NOT NULL DEFAULT 'free',
      vip_only INTEGER NOT NULL DEFAULT 0, effect_key TEXT NOT NULL DEFAULT '',
      enabled INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_shop_items_category ON app_shop_items(category,enabled);

    CREATE TABLE IF NOT EXISTS user_effect_inventory (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      item_id TEXT NOT NULL REFERENCES app_shop_items(id) ON DELETE CASCADE,
      active INTEGER NOT NULL DEFAULT 0, acquired_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY(user_id,item_id)
    );
    CREATE INDEX IF NOT EXISTS idx_effect_inventory_user ON user_effect_inventory(user_id,active);

    CREATE TABLE IF NOT EXISTS weekly_events (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT 'hikari', reward TEXT NOT NULL DEFAULT '',
      starts_at TEXT NOT NULL DEFAULT (datetime('now')), ends_at TEXT, active INTEGER NOT NULL DEFAULT 1
    );
    CREATE INDEX IF NOT EXISTS idx_weekly_events_active ON weekly_events(active,starts_at DESC);

    CREATE TABLE IF NOT EXISTS mission_catalog (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
      target INTEGER NOT NULL DEFAULT 1, reward TEXT NOT NULL DEFAULT '', active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS mission_progress (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      mission_id TEXT NOT NULL REFERENCES mission_catalog(id) ON DELETE CASCADE,
      progress INTEGER NOT NULL DEFAULT 0, completed_at TEXT, updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY(user_id,mission_id)
    );
    CREATE INDEX IF NOT EXISTS idx_mission_progress_user ON mission_progress(user_id,updated_at DESC);

    CREATE TABLE IF NOT EXISTS friend_settings (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      friend_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      favorite INTEGER NOT NULL DEFAULT 0, nickname TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY(user_id,friend_id)
    );
    CREATE INDEX IF NOT EXISTS idx_friend_settings_user ON friend_settings(user_id,favorite);

    CREATE TABLE IF NOT EXISTS server_verifications (
      server_id TEXT PRIMARY KEY REFERENCES servers(id) ON DELETE CASCADE,
      badge TEXT NOT NULL DEFAULT 'verified', assigned_by TEXT NOT NULL, reason TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS nexbot_actions (
      id TEXT PRIMARY KEY, server_id TEXT REFERENCES servers(id) ON DELETE SET NULL,
      actor_id TEXT NOT NULL, action TEXT NOT NULL, message TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_nexbot_actions_server ON nexbot_actions(server_id,created_at DESC);

    CREATE TABLE IF NOT EXISTS app_announcements (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, message TEXT NOT NULL, audience TEXT NOT NULL DEFAULT 'all',
      created_by TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_announcements_date ON app_announcements(created_at DESC);

    CREATE TABLE IF NOT EXISTS server_assets (
      id TEXT PRIMARY KEY, server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
      type TEXT NOT NULL CHECK(type IN ('emoji','sticker','gif','sound')),
      name TEXT NOT NULL, url TEXT NOT NULL, created_by TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(server_id,type,name)
    );
    CREATE INDEX IF NOT EXISTS idx_assets_server ON server_assets(server_id,type);

    CREATE TABLE IF NOT EXISTS server_events (
      id TEXT PRIMARY KEY, server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
      creator_id TEXT NOT NULL REFERENCES users(id) ON DELETE SET NULL, title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '', starts_at INTEGER NOT NULL,
      location TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_events_server ON server_events(server_id,starts_at);
    CREATE TABLE IF NOT EXISTS event_rsvps (
      event_id TEXT NOT NULL REFERENCES server_events(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status TEXT NOT NULL CHECK(status IN ('going','maybe','declined')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY(event_id,user_id)
    );

    CREATE TABLE IF NOT EXISTS ban_appeals (
      id TEXT PRIMARY KEY, user_login TEXT NOT NULL, user_id TEXT, reason TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending', reviewer_id TEXT, resolution TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')), reviewed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_appeals_status ON ban_appeals(status,created_at DESC);
    CREATE TABLE IF NOT EXISTS account_recovery_requests (
      id TEXT PRIMARY KEY, user_login TEXT NOT NULL, user_id TEXT, reason TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending', reviewer_id TEXT, resolution TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')), reviewed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_recovery_status ON account_recovery_requests(status,created_at DESC);

    CREATE TABLE IF NOT EXISTS email_verification_codes (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      email TEXT NOT NULL, code TEXT NOT NULL, expires_at INTEGER NOT NULL,
      used_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_email_codes_user ON email_verification_codes(user_id,expires_at DESC);

    CREATE TABLE IF NOT EXISTS password_reset_codes (
      id TEXT PRIMARY KEY, user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      user_login TEXT NOT NULL, code TEXT NOT NULL, expires_at INTEGER NOT NULL,
      used_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_password_reset_login ON password_reset_codes(user_login,expires_at DESC);

    CREATE TABLE IF NOT EXISTS channel_reads (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
      last_read_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY(user_id,channel_id)
    );
    CREATE INDEX IF NOT EXISTS idx_channel_reads_user ON channel_reads(user_id,channel_id);

    CREATE TABLE IF NOT EXISTS dm_reads (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      peer_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      last_read_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY(user_id,peer_id)
    );
    CREATE INDEX IF NOT EXISTS idx_dm_reads_user ON dm_reads(user_id,peer_id);
  `);

  // Bots oficiais da loja interna. O INSERT OR IGNORE preserva alterações futuras.
  const seedBots = [
    ['guardian','Guardião','Filtro de links, palavras proibidas, boas-vindas e proteção básica.',['manage_bots','manage_messages']],
    ['welcome','Boas-vindas','Mensagens automáticas de entrada e regras rápidas.',['manage_bots']],
    ['tickets','Tickets de suporte','Base para atendimento por tickets dentro do servidor.',['manage_bots','manage_channels']],
    ['events','Eventos','Ajuda a divulgar eventos e lembrar participantes.',['manage_bots','create_invites']]
  ];
  for (const [bid,name,description,permissions] of seedBots) {
    db.prepare('INSERT OR IGNORE INTO bot_catalog(id,name,description,permissions) VALUES(?,?,?,?)').run(bid,name,description,JSON.stringify(permissions));
  }
  const roadmap = [
    ['admin-panel','Painel Admin/Criador completo','admin',1,'VIP por nome, banimento/suspensão por nome, IP/aparelho e logs.'],
    ['official-badges','Títulos e selos oficiais','identity',1,'Badges reais sem emoji: Dono, Verificado, VIP, Parceiro, Influenciador e Booster.'],
    ['hikari','Mascote Hikari dentro do app','brand',2,'Hikari aparece em VIP, eventos, avisos, erro e onboarding.'],
    ['explore','Página Explorar servidores','community',3,'Categorias de jogos, anime, música, amizade e criadores.'],
    ['effects-shop','Loja de efeitos','economy',4,'Molduras, temas, banners, efeitos de perfil e selos especiais.'],
    ['daily-rewards','Recompensa diária e eventos','retention',5,'Recompensas sem sistema de XP/nível.']
  ];
  for (const item of roadmap) db.prepare('INSERT OR IGNORE INTO app_roadmap_items(id,title,category,priority,note) VALUES(?,?,?,?,?)').run(...item);

  const shopItems = [
    ['avatar-purple-frame','Moldura Roxa NexHub','avatar','Moldura premium para foto de perfil.','free',0,'frame_purple'],
    ['name-neon-line','Nome Neon','name','Efeito de brilho no nome, sem emotes.','vip',1,'name_neon'],
    ['profile-galaxy-card','Cartão Galáxia','profile','Visual especial para perfil premium.','vip',1,'profile_galaxy'],
    ['chat-soft-dark','Tema Chat Dark+','theme','Tema escuro mais premium para chat.','free',0,'theme_dark_plus'],
    ['hikari-special-seal','Selo Hikari','badge','Selo visual especial da Hikari para eventos.','event',0,'seal_hikari']
  ];
  for (const item of shopItems) db.prepare('INSERT OR IGNORE INTO app_shop_items(id,name,category,description,price_kind,vip_only,effect_key) VALUES(?,?,?,?,?,?,?)').run(...item);

  const missions = [
    ['complete-profile','Completar perfil','Coloque bio, avatar ou status personalizado.',1,'Moldura temporária'],
    ['send-first-message','Enviar mensagens','Participe de um chat do servidor.',5,'Selo temporário'],
    ['join-call','Entrar em call','Entre em uma chamada ou sala de voz.',1,'Tema simples'],
    ['invite-friend','Convidar amigo','Use convite ou adicione um amigo.',1,'Efeito simples'],
    ['boost-server','Impulsionar servidor','Dê boost em uma comunidade.',1,'Destaque de apoiador']
  ];
  for (const item of missions) db.prepare('INSERT OR IGNORE INTO mission_catalog(id,title,description,target,reward) VALUES(?,?,?,?,?)').run(...item);

  const events = [
    ['hikari-week','Semana da Hikari','Evento semanal com selo Hikari e destaque para comunidades legais.','hikari','Selo Hikari temporário'],
    ['boost-week','Semana do Boost','Comunidades impulsionadas aparecem melhor na aba Explorar.','boost','Destaque de servidor'],
    ['vip-showcase','Vitrine VIP','Perfis VIP e parceiros podem ganhar destaque visual.','vip','Efeito de perfil']
  ];
  for (const item of events) db.prepare('INSERT OR IGNORE INTO weekly_events(id,title,description,category,reward) VALUES(?,?,?,?,?)').run(...item);
  return db;
}
