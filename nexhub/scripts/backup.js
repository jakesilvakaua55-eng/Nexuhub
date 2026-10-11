// Snapshot consistente do SQLite e cópia dos avatares/banners usando VACUUM INTO.
import { existsSync, mkdirSync, cpSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { openDatabase } from '../src/database.js';
const dbPath=resolve(process.env.DB_PATH||'./data/nexo.sqlite');
const mediaPath=resolve(process.env.MEDIA_PATH||'./data/media');
if(!existsSync(dbPath)){console.error('Banco ainda não criado: '+dbPath);process.exit(1);}
const destRoot=resolve(process.env.BACKUP_PATH||'./backups');
const tag=new Date().toISOString().replace(/[:.]/g,'-');
const out=join(destRoot,tag);mkdirSync(out,{recursive:true});
const db=openDatabase(dbPath);
const destination=join(out,'nexo.sqlite');
db.exec("VACUUM INTO '"+destination.replaceAll("'","''")+"'");db.close();
if(existsSync(mediaPath))cpSync(mediaPath,join(out,'media'),{recursive:true});
console.log(`Backup criado em ${out}; banco: ${statSync(destination).size} bytes`);
