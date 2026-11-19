import { readFile } from 'node:fs/promises';
import { hashPassword } from '../src/auth.js';
import { connect, migrate, transaction } from '../src/db.js';

const mode = process.env.APP_MODE || 'demo';
const [command, id, role, name] = process.argv.slice(2);
const db = connect();
try {
  await migrate(db, mode);
  if (command === 'user') {
    if (!/^[a-z0-9][a-z0-9_-]{1,49}$/.test(id || '') || !['agente', 'coordinador'].includes(role) || !name?.trim() || name.length > 100) {
      throw new Error('Uso: npm run user -- identificador agente|coordinador "Nombre completo" < archivo-clave');
    }
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    const password = Buffer.concat(chunks).toString('utf8').replace(/\r?\n$/, '');
    const hash = await hashPassword(password);
    await transaction(db, async client => {
      await client.query(`INSERT INTO users VALUES ($1,$2,$3,$4,$3='agente')
        ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, password_hash=EXCLUDED.password_hash
        WHERE users.role=EXCLUDED.role
        RETURNING id`, [id, name.trim(), role, hash]).then(result => {
        if (!result.rowCount) throw new Error('El identificador ya tiene un rol diferente.');
      });
      await client.query('DELETE FROM sessions WHERE user_id=$1', [id]);
    });
    console.log('Cuenta preparada: ' + id);
  } else if (command === 'demo') {
    if (mode !== 'demo') throw new Error('La carga de demostración requiere APP_MODE=demo.');
    const roles = [
      ['agente1', 'Laura Méndez', 'agente'], ['agente2', 'Mateo Rojas', 'agente'],
      ['agente3', 'Valentina Cruz', 'agente'], ['agente4', 'Diego Silva', 'agente'],
      ['coord', 'Ana Torres', 'coordinador']
    ];
    const users = await Promise.all(roles.map(async entry => [...entry, await hashPassword('Aurora-Demo-2026')]));
    const sql = await readFile(new URL('./demo.sql', import.meta.url), 'utf8');
    await transaction(db, async client => {
      for (const user of users) {
        await client.query('INSERT INTO users VALUES ($1,$2,$3,$4,$3=\'agente\') ON CONFLICT DO NOTHING', user);
      }
      await client.query(sql);
    });
    console.log('Datos ficticios listos. Usuarios agente1 a agente4 y coord. Clave: Aurora-Demo-2026');
  } else if (command !== 'migrate') throw new Error('Operación desconocida.');
} finally {
  await db.end();
}
