import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { performance } from 'node:perf_hooks';
import { createApp } from '../src/app.js';
import { hashPassword } from '../src/auth.js';
import { connect, migrate } from '../src/db.js';

export const testPassword = 'Aurora-Test-2026';
export const sample = { nit: '001234', channel: 'correo', category: 'pedido', description: 'Verificar el estado del pedido de prueba.' };
export const accountIds = ['agente1', 'agente2', 'agente3', 'agente4', 'coord'];

export async function seedVolume(db) {
  await db.query(`INSERT INTO customers SELECT '990'||g, 'Cliente '||g FROM generate_series(1,299) g;
    INSERT INTO requests(ticket,nit,channel,category,description,agent_id,state,received_at,issued_at)
      SELECT 'AUR-202611-'||lpad(g::text,4,'0'), '990'||((g-1)%299+1), 'correo','pedido','Medición con datos ficticios.',
      'agente'||((g-1)%4+1), 'nuevo', '2026-11-19 10:00:00+00','2026-11-19 10:00:00+00' FROM generate_series(1,1200) g`);
  await db.query("INSERT INTO counters VALUES ('202611',1200)");
}

export async function fixture(t, { mode = 'demo', now = new Date('2026-11-19T15:00:00.000Z') } = {}) {
  if (!process.env.TEST_DATABASE_URL) throw new Error('Configura TEST_DATABASE_URL con una base PostgreSQL de pruebas.');
  const base = new URL(process.env.TEST_DATABASE_URL);
  const admin = connect(base.href);
  const schema = 'aurora_test_' + randomBytes(8).toString('hex');
  await admin.query('CREATE SCHEMA ' + schema);
  base.searchParams.set('options', '-c search_path=' + schema);
  const db = connect(base.href);
  t.after(async () => {
    await db.end();
    try { await admin.query('DROP SCHEMA ' + schema + ' CASCADE'); } finally { await admin.end(); }
  });
  await migrate(db, mode);
  await migrate(db, mode);
  const hash = await hashPassword(testPassword);
  for (const id of accountIds) {
    const agent = id.startsWith('agente');
    await db.query('INSERT INTO users VALUES ($1,$2,$3,$4,$5)', [id, agent ? 'Agente ' + id.at(-1) : 'Coordinación', agent ? 'agente' : 'coordinador', hash, agent]);
  }
  await db.query("INSERT INTO customers VALUES ('001234','Colegio de Prueba')");
  const app = createApp(db, { mode, secure: mode === 'pilot', trustProxy: mode === 'pilot' ? 1 : undefined, clock: () => now });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = 'http://127.0.0.1:' + server.address().port;

  async function send(route, { method = 'GET', data, cookie, key, proxyProtocol } = {}) {
    const start = performance.now();
    const response = await fetch(url + '/api' + route, {
      method,
      headers: {
        ...(data === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(cookie ? { cookie } : {}), ...(key ? { 'Idempotency-Key': key } : {}),
        ...(proxyProtocol ? { 'X-Forwarded-Proto': proxyProtocol } : {})
      },
      body: data === undefined ? undefined : JSON.stringify(data)
    });
    const responseBody = response.headers.get('content-type')?.includes('application/json') ? await response.json() : await response.text();
    return { status: response.status, body: responseBody, headers: response.headers, elapsed: performance.now() - start };
  }

  async function login(id, options) {
    const result = await send('/login', { method: 'POST', data: { id, password: testPassword }, ...options });
    return { ...result, cookie: result.headers.get('set-cookie')?.split(';')[0] };
  }

  const file = (content, confirm = false, format = 'csv') => ({ content, confirm, format });
  const radicate = (cookie, data = sample, key = randomUUID()) => send('/requests', { method: 'POST', data, cookie, key });
  return { url, db, send, login, file, radicate, setNow: value => { now = new Date(value); } };
}
