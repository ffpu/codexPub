import { sha256 } from './auth.js';
import { transaction } from './db.js';

import { channels, categories, states, openStates, limitMs, string, validateFields } from './catalogs.js';

export { channels, categories, states, openStates, limitMs, string, validateFields };

const monthFormat = new Intl.DateTimeFormat('en', { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit' });

export class HttpError extends Error {
  constructor(status, message, fields) {
    super(message);
    this.status = status;
    this.fields = fields;
  }
}

export async function nextTicket(db, date) {
  const parts = monthFormat.formatToParts(date);
  const month = parts.find(part => part.type === 'year').value + parts.find(part => part.type === 'month').value;
  const { rows: [counter] } = await db.query(`INSERT INTO counters VALUES ($1,1)
    ON CONFLICT (month) DO UPDATE SET last_number=counters.last_number+1
    WHERE counters.last_number<9999 RETURNING last_number`, [month]);
  if (!counter) throw new HttpError(409, 'Se agotaron los consecutivos del mes.');
  return 'AUR-' + month + '-' + String(counter.last_number).padStart(4, '0');
}

export async function event(db, ticket, actor, at, action, before, after, note = null) {
  await db.query('INSERT INTO events(ticket,actor_id,occurred_at,action,before_values,after_values,note) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [ticket, actor, at, action, before, after, note]);
}

export async function createRequest(pool, user, data, key, clock) {
  if (!/^[\w-]{16,100}$/.test(key || '')) throw new HttpError(400, 'Falta una clave de radicación válida.');
  const { record, fields } = validateFields(data);
  if (Object.keys(fields).length) throw new HttpError(400, 'Revisa los datos de la solicitud.', fields);
  const hash = sha256(JSON.stringify(record));
  return transaction(pool, async db => {
    const { rows: [cursor] } = await db.query('SELECT last_agent FROM assignment WHERE id=1 FOR UPDATE');
    const { rows: [previous] } = await db.query('SELECT payload_hash,ticket FROM idempotency WHERE actor_id=$1 AND key=$2', [user.id, key]);
    if (previous) {
      if (previous.payload_hash !== hash) throw new HttpError(409, 'La clave corresponde a una radicación diferente.');
      return { ticket: previous.ticket, repeated: true };
    }
    const client = await db.query('SELECT nit FROM customers WHERE nit=$1', [record.nit]);
    if (!client.rowCount) throw new HttpError(400, 'Revisa los datos de la solicitud.', { nit: 'El cliente no existe en el directorio.' });
    const { rows: [agent] } = await db.query(`SELECT id FROM users WHERE role='agente' AND available
      ORDER BY (id<=COALESCE($1,'')),id LIMIT 1`, [cursor.last_agent]);
    if (!agent) throw new HttpError(409, 'No hay agentes disponibles. Pide al coordinador que habilite un agente y vuelve a intentar.');
    const now = clock();
    const ticket = await nextTicket(db, now);
    await db.query(`INSERT INTO requests(ticket,nit,channel,category,description,order_ref,agent_id,state,received_at,issued_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,'nuevo',$8,$8)`,
    [ticket, record.nit, record.channel, record.category, record.description, record.order_ref, agent.id, now]);
    await db.query('UPDATE assignment SET last_agent=$1 WHERE id=1', [agent.id]);
    await db.query('INSERT INTO idempotency VALUES ($1,$2,$3,$4)', [user.id, key, hash, ticket]);
    await event(db, ticket, user.id, now, 'radicacion', null, { state: 'nuevo', agent_id: agent.id });
    return { ticket, repeated: false };
  });
}

const requestSelect = `SELECT r.*,c.name AS customer,u.name AS agent FROM requests r
  JOIN customers c ON c.nit=r.nit JOIN users u ON u.id=r.agent_id`;

export async function requestDetail(db, ticket, now) {
  const { rows: [request] } = await db.query(requestSelect + ' WHERE r.ticket=$1', [ticket]);
  if (!request) throw new HttpError(404, 'No encontramos la solicitud.');
  const { rows: events } = await db.query(`SELECT e.*,u.name AS actor FROM events e JOIN users u ON u.id=e.actor_id
    WHERE ticket=$1 ORDER BY occurred_at,id`, [ticket]);
  return { request, events, now };
}

export async function listRequests(db, filters, now) {
  const params = [new Date(+now - limitMs)];
  const clauses = [];
  const active = "r.state NOT IN ('resuelto','cerrado')";
  const expired = "(" + active + " AND r.received_at<$1)";
  const add = (value, clause) => {
    params.push(value);
    clauses.push(clause(params.length));
  };
  const search = string(filters.q).slice(0, 120);
  if (search) add(search, n => `(strpos(lower(r.ticket),lower($${n}))>0 OR strpos(lower(r.nit),lower($${n}))>0 OR strpos(lower(c.name),lower($${n}))>0)`);
  if (Object.hasOwn(states, filters.state)) add(filters.state, n => `r.state=$${n}`);
  if (string(filters.agent)) add(filters.agent, n => `r.agent_id=$${n}`);
  if (filters.deadline === 'vencidas') clauses.push(expired);
  if (filters.deadline === 'a-tiempo') clauses.push(active + ' AND r.received_at >= $1');
  const page = Math.max(1, Math.min(100000, Number.parseInt(filters.page, 10) || 1));
  const size = 20;
  const where = clauses.length ? ' WHERE ' + clauses.join(' AND ') : '';
  const rows = await db.query(requestSelect + ', LATERAL (SELECT ' + expired + ' AS overdue) d' + where
    + ` ORDER BY r.received_at DESC,r.ticket DESC LIMIT ${size} OFFSET ${(page - 1) * size}`, params);
  const summaries = await db.query(`SELECT count(*)::int AS total,
    count(*) FILTER (WHERE ${active})::int AS open,
    count(*) FILTER (WHERE ${expired})::int AS overdue,
    count(*) FILTER (WHERE r.state IN ('resuelto','cerrado'))::int AS finished
    FROM requests r`, [params[0]]);
  const { rows: [match] } = await db.query(`SELECT count(*)::int AS total FROM (${requestSelect}, LATERAL (SELECT $1::timestamptz) d${where}) entries`, params);
  return { requests: rows.rows, summary: summaries.rows[0], total: match.total, page, size, now };
}

export async function updateRequest(pool, user, ticket, data, clock) {
  return transaction(pool, async db => {
    if (data.action === 'reasignar') {
      if (user.role !== 'coordinador') throw new HttpError(403, 'Solo el coordinador puede reasignar.');
      await db.query('SELECT id FROM assignment WHERE id=1 FOR UPDATE');
    }
    const { rows: [request] } = await db.query('SELECT * FROM requests WHERE ticket=$1 FOR UPDATE', [ticket]);
    if (!request) throw new HttpError(404, 'No encontramos la solicitud.');
    if (user.role !== 'coordinador' && request.agent_id !== user.id) throw new HttpError(403, 'Solo puedes actualizar tus solicitudes asignadas.');
    if (request.version !== data.version) throw new HttpError(409, 'El caso cambió en otra sesión. Revisa la versión vigente antes de guardar.');
    const now = clock();
    if (data.action === 'reasignar') {
      if (!openStates.includes(request.state)) throw new HttpError(400, 'Solo se pueden reasignar solicitudes abiertas.');
      const reason = string(data.reason);
      const target = string(data.agent_id);
      const agent = await db.query("SELECT id FROM users WHERE id=$1 AND available AND role='agente'", [target]);
      if (!reason || reason.length > 1000 || !agent.rowCount || target === request.agent_id) {
        throw new HttpError(400, 'Selecciona otro agente disponible y escribe el motivo (máximo 1000 caracteres).');
      }
      await db.query('UPDATE requests SET agent_id=$2,version=version+1 WHERE ticket=$1', [ticket, target]);
      await event(db, ticket, user.id, now, 'reasignacion', { agent_id: request.agent_id }, { agent_id: target }, reason);
    } else if (data.action === 'estado') {
      const next = data.state;
      const allowed = openStates.includes(request.state) ? [...openStates, 'resuelto'] : request.state === 'resuelto' ? ['cerrado'] : [];
      if (!allowed.includes(next) || next === request.state) throw new HttpError(400, 'El cambio de estado no es válido.');
      const response = string(data.response);
      if (next === 'resuelto' && (!response || response.length > 5000)) throw new HttpError(400, 'Escribe la respuesta de fondo (máximo 5000 caracteres).');
      if (next === 'resuelto') {
        const elapsed = +now - +request.received_at;
        await db.query('UPDATE requests SET state=$2,resolved_at=$3,response=$4,elapsed_ms=$5,compliant=$6,version=version+1 WHERE ticket=$1',
          [ticket, next, now, response, elapsed, elapsed <= limitMs]);
      } else {
        await db.query('UPDATE requests SET state=$2,version=version+1 WHERE ticket=$1', [ticket, next]);
      }
      await event(db, ticket, user.id, now, 'estado', { state: request.state }, { state: next }, next === 'resuelto' ? response : null);
    } else {
      throw new HttpError(400, 'Acción desconocida.');
    }
    return requestDetail(db, ticket, now);
  });
}
