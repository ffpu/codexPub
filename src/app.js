import express from 'express';
import { fileURLToPath } from 'node:url';
import { createSession, sessionToken, sessionUser, sha256, verifyPassword } from './auth.js';
import { transaction } from './db.js';
import { categories, channels, createRequest, HttpError, listRequests, requestDetail, states, string, updateRequest } from './requests.js';
import { exportData, importData } from './imports.js';

export function createApp(db, { mode, secure = true, origin, trustProxy, clock = () => new Date() }) {
  const app = express();
  const failedLogins = new Map();
  app.disable('x-powered-by');
  if (trustProxy) app.set('trust proxy', trustProxy);
  app.use((req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin',
      'Content-Security-Policy': "default-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"
    });
    if (mode === 'pilot' && !req.secure) return res.status(400).send('Se requiere HTTPS.');
    next();
  });
  app.get('/health', async (_req, res) => {
    await db.query('SELECT 1');
    res.json({ ready: true });
  });
  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (!['GET', 'HEAD'].includes(req.method)) {
      const expected = origin || req.protocol + '://' + req.get('host');
      if (req.get('Sec-Fetch-Site') === 'cross-site' || (req.get('Origin') && req.get('Origin') !== expected)) {
        return next(new HttpError(403, 'Origen de la solicitud no permitido.'));
      }
      if (!req.is('application/json')) return next(new HttpError(415, 'Usa el formato JSON.'));
    }
    next();
  }, express.json({ limit: '8mb' }));

  const cookie = { httpOnly: true, secure, sameSite: 'strict', path: '/' };
  app.get('/api/config', (_req, res) => res.json({ mode, channels, categories, states }));
  app.post('/api/login', async (req, res) => {
    const id = string(req.body?.id).toLowerCase();
    const now = Date.now();
    if (failedLogins.size > 5000) {
      for (const [key, value] of failedLogins) if (value.until <= now) failedLogins.delete(key);
    }
    const key = req.ip;
    const attempts = failedLogins.get(key);
    if (attempts?.until > now && attempts.count >= 20) throw new HttpError(429, 'Demasiados intentos. Vuelve a intentar en unos minutos.');
    const { rows: [user] } = await db.query('SELECT id,name,role,password_hash FROM users WHERE id=$1', [id]);
    if (!(await verifyPassword(req.body?.password, user?.password_hash))) {
      if (failedLogins.size < 10000 || failedLogins.has(key)) {
        failedLogins.set(key, attempts?.until > now ? { ...attempts, count: attempts.count + 1 } : { count: 1, until: now + 10 * 60 * 1000 });
      }
      throw new HttpError(401, 'Usuario o contraseña incorrectos.');
    }
    failedLogins.delete(key);
    const old = sessionToken(req);
    if (old) await db.query('DELETE FROM sessions WHERE token_hash=$1', [sha256(old)]);
    const token = await createSession(db, id);
    res.cookie('aurora_session', token, { ...cookie, maxAge: 12 * 60 * 60 * 1000 });
    res.json({ id: user.id, name: user.name, role: user.role });
  });
  app.use('/api', async (req, _res, next) => {
    req.user = await sessionUser(db, sessionToken(req));
    if (!req.user) throw new HttpError(401, 'Inicia sesión para continuar.');
    next();
  });
  app.post('/api/logout', async (req, res) => {
    await db.query('DELETE FROM sessions WHERE token_hash=$1', [sha256(sessionToken(req))]);
    res.clearCookie('aurora_session', cookie).json({ ok: true });
  });
  app.get('/api/me', (req, res) => res.json(req.user));
  const coordinator = (req, _res, next) => {
    if (req.user.role !== 'coordinador') return next(new HttpError(403, 'Esta función está reservada al coordinador.'));
    next();
  };
  app.get('/api/agents', async (_req, res) => {
    const { rows } = await db.query("SELECT id,name,available FROM users WHERE role='agente' ORDER BY id");
    res.json(rows);
  });
  app.patch('/api/agents/:id', coordinator, async (req, res) => {
    if (typeof req.body?.available !== 'boolean') throw new HttpError(400, 'Indica la disponibilidad.');
    const agent = await transaction(db, async client => {
      await client.query('SELECT id FROM assignment WHERE id=1 FOR UPDATE');
      const { rows: [row] } = await client.query("UPDATE users SET available=$2 WHERE id=$1 AND role='agente' RETURNING id,name,available", [req.params.id, req.body.available]);
      if (!row) throw new HttpError(404, 'No encontramos el agente.');
      return row;
    });
    res.json(agent);
  });
  app.get('/api/customers', async (req, res) => {
    const q = string(req.query.q).slice(0, 120);
    const { rows } = await db.query(`SELECT nit,name FROM customers
      WHERE $1='' OR strpos(lower(nit),lower($1))>0 OR strpos(lower(name),lower($1))>0
      ORDER BY (nit=$1) DESC,name,nit LIMIT 25`, [q]);
    res.json(rows);
  });
  app.get('/api/requests', async (req, res) => res.json(await listRequests(db, req.query, clock())));
  app.post('/api/requests', async (req, res) => {
    const result = await createRequest(db, req.user, req.body, req.get('Idempotency-Key'), clock);
    res.status(result.repeated ? 200 : 201).json(await requestDetail(db, result.ticket, clock()));
  });
  app.get('/api/requests/:ticket', async (req, res) => res.json(await requestDetail(db, req.params.ticket, clock())));
  app.patch('/api/requests/:ticket', async (req, res) => {
    if (!req.body || !Number.isInteger(req.body.version)) throw new HttpError(400, 'Falta la versión de la solicitud.');
    res.json(await updateRequest(db, req.user, req.params.ticket, req.body, clock));
  });
  app.get('/api/metrics', coordinator, async (req, res) => {
    const validDate = value => {
      if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
      const date = new Date(value + 'T00:00:00Z');
      return Number.isFinite(+date) && date.toISOString().startsWith(value);
    };
    const { from, through } = req.query;
    if (!validDate(from) || !validDate(through) || from > through) throw new HttpError(400, 'Selecciona un periodo válido.');
    const { rows: [metric] } = await db.query(`SELECT count(*)::int AS resolved,
      count(*) FILTER (WHERE compliant)::int AS compliant FROM requests
      WHERE resolved_at >= ($1::date::timestamp AT TIME ZONE 'America/Bogota')
        AND resolved_at < (($2::date+1)::timestamp AT TIME ZONE 'America/Bogota')`, [from, through]);
    res.json({ ...metric, percent: metric.resolved ? metric.compliant / metric.resolved * 100 : null });
  });
  app.post('/api/import/:kind', coordinator, async (req, res) => res.json(await importData(db, req.params.kind, req.body, req.user, clock)));
  app.get('/api/export', coordinator, async (_req, res) => {
    res.attachment('aurora-datos.json').json(await exportData(db));
  });
  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Ruta no encontrada.')));
  app.use(express.static(fileURLToPath(new URL('../public/', import.meta.url))));
  app.use((err, _req, res, _next) => {
    const status = err.status || 500;
    if (status >= 500) console.error('Error interno de Aurora:', err.code || err.name);
    const message = status >= 500 ? 'Ocurrió un error al procesar la solicitud.'
      : err.type === 'entity.parse.failed' ? 'El contenido JSON no es válido.'
      : err.type === 'entity.too.large' ? 'El archivo supera el tamaño permitido.' : err.message;
    res.status(status).json({ error: message, fields: err.fields });
  });
  return app;
}
