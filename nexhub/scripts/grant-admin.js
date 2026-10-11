// Execute no servidor privado, com acesso ao disco. Não execute em rotas públicas.
import { openDatabase } from '../src/database.js';
const [username, confirm] = process.argv.slice(2);
if(!/^[a-z0-9_]{3,24}$/.test(username||'') || confirm!=='--confirm'){
 console.error('Uso: npm run grant-admin -- <usuario> --confirm');process.exit(1);
}
const db=openDatabase();
const u=db.prepare('SELECT id,username FROM users WHERE username=?').get(username);
if(!u){console.error('Conta inexistente. Cadastre-a primeiro e repita.');db.close();process.exit(1);}
db.prepare('INSERT OR IGNORE INTO platform_admins(user_id) VALUES(?)').run(u.id);
console.log('Administrador da plataforma habilitado para @'+u.username+'. Proteja a conta com senha forte.');db.close();
