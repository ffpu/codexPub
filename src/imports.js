import { parse } from 'csv-parse/sync';
import { transaction } from './db.js';
import { event, HttpError, nextTicket, openStates, string, validateFields } from './requests.js';

export function parseFile(format, content) {
  if (typeof content !== 'string' || !content.trim()) throw new HttpError(400, 'Selecciona un archivo con datos.');
  let rows;
  try {
    if (format === 'json') rows = JSON.parse(content.replace(/^\uFEFF/, ''));
    else if (format === 'csv') rows = parse(content, {
      bom: true, skip_empty_lines: true,
      columns(headers) {
        const names = headers.map(header => header.trim());
        if (names.some(name => !name) || new Set(names).size !== names.length) throw new Error('Encabezados inválidos.');
        return names;
      }
    });
  } catch {
    throw new HttpError(400, 'El archivo no tiene el formato seleccionado.');
  }
  if (!Array.isArray(rows) || !rows.length || rows.length > 5000 || rows.some(row => !row || typeof row !== 'object' || Array.isArray(row))) {
    throw new HttpError(400, 'El archivo debe contener entre 1 y 5.000 registros.');
  }
  return rows;
}

export function readReceived(value) {
  const raw = string(value);
  const match = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(?::(\d{2})(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})?$/.exec(raw);
  if (!match) return null;
  const [, day, minutes, seconds = '00', fractional = '', zone = '-05:00'] = match;
  const iso = day + 'T' + minutes + ':' + seconds;
  const local = new Date(iso + 'Z');
  const valueWithZone = new Date(iso + fractional + zone);
  if (!Number.isFinite(+local) || !Number.isFinite(+valueWithZone) || !local.toISOString().startsWith(iso)) return null;
  return valueWithZone;
}

const rowReport = (index, status, message, ref, ticket) => ({ row: index + 1, status, message, ref, ticket });

export async function importData(pool, kind, body, user, clock) {
  if (!['clientes', 'pendientes'].includes(kind)) throw new HttpError(404, 'Importación desconocida.');
  if (typeof body?.confirm !== 'boolean') throw new HttpError(400, 'Indica si es un ensayo o una carga confirmada.');
  const input = parseFile(body.format, body.content);
  if (kind === 'pendientes' && body.format !== 'csv') throw new HttpError(400, 'Usa CSV para los pendientes.');
  return transaction(pool, async db => {
    if (body.confirm) await db.query('SELECT pg_advisory_xact_lock(18644)');
    const counts = new Map();
    const key = kind === 'clientes' ? 'nit' : 'source_ref';
    for (const value of input) {
      const ref = string(value[key]);
      counts.set(ref, (counts.get(ref) || 0) + 1);
    }
    const ids = [...counts.keys()];
    const now = clock();
    const customers = new Set();
    const agents = new Set();
    const imported = new Map();
    if (kind === 'pendientes') {
      for (const row of (await db.query('SELECT nit FROM customers WHERE nit=ANY($1)', [input.map(row => string(row.nit))])).rows) customers.add(row.nit);
      for (const row of (await db.query("SELECT id FROM users WHERE role='agente'")).rows) agents.add(row.id);
      for (const row of (await db.query('SELECT source_ref,ticket FROM requests WHERE source_ref=ANY($1)', [ids])).rows) imported.set(row.source_ref, row.ticket);
    }
    const ready = [];
    const report = input.map((value, index) => {
      const ref = string(value[key]);
      if (!ref || ref.length > (kind === 'clientes' ? 40 : 150)) return rowReport(index, 'excepcion', 'Referencia obligatoria o demasiado larga.', ref);
      if (imported.has(ref)) return rowReport(index, 'duplicado', 'Solicitud ya importada.', ref, imported.get(ref));
      if (counts.get(ref) > 1) return rowReport(index, 'duplicado', 'Referencia repetida en este archivo. Revisa todas sus filas.', ref);
      if (kind === 'clientes') {
        const name = string(value.name);
        if (!name || name.length > 200) return rowReport(index, 'excepcion', 'Razón social obligatoria (máximo 200 caracteres).', ref);
        ready.push({ index, nit: ref, name });
      } else {
        const { record, fields } = validateFields(value);
        const received = readReceived(value.received_at);
        const agent = string(value.agent_id);
        const state = string(value.state);
        const errors = Object.values(fields);
        if (!customers.has(record.nit)) errors.push('Cliente fuera del directorio.');
        if (!agents.has(agent)) errors.push('Responsable no identificado.');
        if (!openStates.includes(state)) errors.push('Se requiere un estado abierto.');
        if (!received || +received > +now) errors.push('Fecha de recepción inválida o futura.');
        if (errors.length) return rowReport(index, 'excepcion', errors.join(' '), ref);
        ready.push({ index, ref, record, received, agent, state });
      }
      return rowReport(index, 'listo', 'Registro apto.', ref);
    });
    const unresolved = report.some(row => row.status === 'excepcion' || (row.status === 'duplicado' && !row.ticket));
    if (body.confirm && !unresolved) {
      for (const item of ready) {
        if (kind === 'clientes') {
          await db.query('INSERT INTO customers VALUES ($1,$2) ON CONFLICT (nit) DO UPDATE SET name=EXCLUDED.name', [item.nit, item.name]);
          report[item.index] = rowReport(item.index, 'cargado', 'Cliente guardado.', item.nit);
        } else {
          const ticket = await nextTicket(db, now);
          const record = item.record;
          await db.query(`INSERT INTO requests(ticket,nit,channel,category,description,order_ref,agent_id,state,received_at,issued_at,source_ref,imported_at)
            VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$10)`,
          [ticket, record.nit, record.channel, record.category, record.description, record.order_ref, item.agent, item.state, item.received, now, item.ref]);
          await event(db, ticket, user.id, now, 'migracion', null, { state: item.state, agent_id: item.agent, source_ref: item.ref });
          report[item.index] = rowReport(item.index, 'cargado', 'Solicitud importada.', item.ref, ticket);
        }
      }
    }
    const totals = { total: report.length, listo: 0, duplicado: 0, excepcion: 0, cargado: 0 };
    for (const row of report) totals[row.status]++;
    return { rows: report, totals, confirmed: body.confirm && !unresolved, canConfirm: !unresolved };
  });
}

export async function exportData(pool) {
  return transaction(pool, async db => {
    await db.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const customers = await db.query('SELECT * FROM customers ORDER BY nit');
    const requests = await db.query('SELECT * FROM requests ORDER BY ticket');
    const actors = await db.query('SELECT id,name,role FROM users ORDER BY id');
    const events = await db.query('SELECT * FROM events ORDER BY occurred_at,id');
    return { version: 1, exported_at: new Date(), customers: customers.rows, requests: requests.rows, actors: actors.rows, events: events.rows };
  });
}
