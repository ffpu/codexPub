import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { accountIds, fixture, sample, seedVolume } from './fixture.js';
import { migrate } from '../src/db.js';

test('sesiones, roles y separación entre demostración y piloto', async t => {
  const { db, send, login } = await fixture(t);
  assert.equal((await send('/requests')).status, 401);
  assert.equal((await send('/login', { method: 'POST', data: { id: 'coord', password: 'incorrecta' } })).status, 401);
  const agent = await login('agente1');
  assert.match(agent.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/);
  for (const route of ['/export', '/metrics?from=2026-11-01&through=2026-11-30']) {
    assert.equal((await send(route, { cookie: agent.cookie })).status, 403);
  }
  assert.equal((await send('/agents/agente2', { method: 'PATCH', data: { available: false }, cookie: agent.cookie })).status, 403);
  assert.equal((await send('/logout', { method: 'POST', data: {}, cookie: agent.cookie })).status, 200);
  assert.equal((await send('/me', { cookie: agent.cookie })).status, 401);
  await assert.rejects(migrate(db, 'pilot'), /otro entorno/);
  const pilot = await fixture(t, { mode: 'pilot' });
  assert.equal((await pilot.send('/config')).status, 400);
  assert.equal((await pilot.send('/config', { proxyProtocol: 'https' })).body.mode, 'pilot');
  assert.match((await pilot.login('coord', { proxyProtocol: 'https' })).headers.get('set-cookie'), /HttpOnly; Secure; SameSite=Strict/);
});

test('cinco sesiones, reparto concurrente, idempotencia y ediciones en conflicto', async t => {
  const { db, send, login, radicate } = await fixture(t);
  const accounts = await Promise.all(accountIds.map(loginId => login(loginId)));
  assert.ok(accounts.every(account => account.status === 200));
  const [a1, a2, , , coord] = accounts.map(account => account.cookie);
  const available = (id, value) => send('/agents/' + id, { method: 'PATCH', cookie: coord, data: { available: value } });
  assert.equal((await available('agente2', false)).status, 200);
  const invalid = await radicate(a1, { ...sample, channel: '' });
  assert.equal(invalid.status, 400);
  assert.ok(invalid.body.fields.channel);
  assert.equal((await db.query('SELECT * FROM events')).rowCount, 0);
  const start = await radicate(a1);
  assert.equal(start.status, 201);
  assert.equal(start.body.request.agent_id, 'agente1');
  const duplicates = randomUUID();
  const batch = await Promise.all([radicate(coord, sample, duplicates), radicate(coord, sample, duplicates), radicate(a1), radicate(a2)]);
  assert.deepEqual(batch.map(result => result.status).sort(), [200, 201, 201, 201]);
  const stored = (await send('/requests', { cookie: a2 })).body.requests.sort((a, b) => a.ticket.localeCompare(b.ticket));
  assert.deepEqual(stored.map(row => row.ticket), ['0001', '0002', '0003', '0004'].map(suffix => 'AUR-202611-' + suffix));
  assert.deepEqual(stored.map(row => row.agent_id), ['agente1', 'agente3', 'agente4', 'agente1']);
  const path = '/requests/' + stored[0].ticket;
  const edit = (cookie, data) => send(path, { method: 'PATCH', cookie, data });
  assert.equal((await edit(a2, { action: 'estado', version: 1, state: 'proceso' })).status, 403);
  const result = await Promise.all([
    edit(a1, { action: 'estado', version: 1, state: 'proceso' }),
    edit(coord, { action: 'estado', version: 1, state: 'ventas' })
  ]);
  assert.deepEqual(result.map(entry => entry.status).sort(), [200, 409]);
  const reassigned = await edit(coord, { action: 'reasignar', version: 2, agent_id: 'agente4', reason: 'Ausencia durante el turno' });
  assert.equal(reassigned.body.request.agent_id, 'agente4');
  assert.equal(reassigned.body.events[2].note, 'Ausencia durante el turno');
  await assert.rejects(db.query("UPDATE events SET note='edición'"), /solo lectura/);
  for (const id of ['agente1', 'agente3', 'agente4']) await available(id, false);
  assert.match((await radicate(a1)).body.error, /No hay agentes disponibles/);
  assert.equal((await db.query('SELECT count(*)::int AS count FROM requests')).rows[0].count, 4);
});

test('ensayo sin escrituras, duplicados, fechas originales, límite de horas y exportación', async t => {
  const { db, send, login, file, setNow } = await fixture(t);
  const { cookie } = await login('coord');
  const load = (kind, content, confirm, format) => send('/import/' + kind, { method: 'POST', cookie, data: file(content, confirm, format) });
  const conflict = await load('clientes', 'nit,name\n0022,Empresa Uno\n0022,Empresa Dos', true);
  assert.equal(conflict.body.canConfirm, false);
  assert.equal(conflict.body.totals.duplicado, 2);
  assert.equal((await db.query("SELECT nit FROM customers WHERE nit='0022'")).rowCount, 0);
  assert.equal((await load('clientes', 'nit,name\n0012,"Proveedor, S.A."', true)).body.totals.cargado, 1);
  assert.equal((await load('clientes', '[{"nit":"007","name":"Colegio Siete"}]', true, 'json')).body.totals.cargado, 1);
  assert.equal((await send('/customers?q=0012', { cookie })).body[0].name, 'Proveedor, S.A.');
  const headings = 'source_ref,nit,channel,category,description,order_ref,agent_id,state,received_at\n';
  const row = (id, date, agent = 'agente1') => [id, '001234', 'correo', 'pedido', 'Solicitud de prueba para importar', 'A01', agent, 'logistica', date].join(',');
  const fileText = headings + [row('hoja-01', '2026-11-17 10:01'), row('hoja-02', '2026-11-17 08:00')].join('\n');
  const invalid = await load('pendientes', headings + row('hoja-x', '2026-02-31T10:00:00-05:00', 'desconocido'), false);
  assert.equal(invalid.body.totals.excepcion, 1);
  assert.match(invalid.body.rows[0].message, /Responsable no identificado.*Fecha/);
  const preview = await load('pendientes', fileText, false);
  assert.equal(preview.body.totals.listo, 2);
  assert.equal((await db.query('SELECT * FROM requests')).rowCount, 0);
  const confirmed = await load('pendientes', fileText, true);
  assert.equal(confirmed.body.totals.cargado, 2);
  const [limit, late] = confirmed.body.rows.map(entry => entry.ticket);
  const repeated = await load('pendientes', fileText, true);
  assert.equal(repeated.body.totals.duplicado, 2);
  assert.equal(repeated.body.rows[0].ticket, limit);
  const filtered = await send('/requests?deadline=vencidas', { cookie });
  assert.equal(filtered.body.total, 1);
  assert.equal(filtered.body.requests[0].ticket, late);
  const detail = await send('/requests/' + limit, { cookie });
  assert.equal(detail.body.request.received_at, '2026-11-17T15:01:00.000Z');
  assert.equal(detail.body.events[0].action, 'migracion');
  const patch = (ticket, state, version) => send('/requests/' + ticket, {
    method: 'PATCH', cookie, data: { state, version, action: 'estado', response: 'Se informó al cliente.' }
  });
  setNow('2026-11-19T15:01:00.000Z');
  assert.equal((await send('/requests?deadline=vencidas', { cookie })).body.total, 1);
  assert.equal((await patch(limit, 'resuelto', 1)).body.request.compliant, true);
  assert.equal((await patch(limit, 'cerrado', 2)).body.request.resolved_at, '2026-11-19T15:01:00.000Z');
  setNow('2026-11-19T13:00:01.000Z');
  assert.equal((await patch(late, 'resuelto', 1)).body.request.compliant, false);
  assert.deepEqual((await send('/metrics?from=2026-11-19&through=2026-11-19', { cookie })).body, { resolved: 2, compliant: 1, percent: 50 });
  assert.deepEqual((await send('/metrics?from=2025-11-19&through=2025-11-19', { cookie })).body, { resolved: 0, compliant: 0, percent: null });
  const exported = await send('/export', { cookie });
  assert.match(exported.headers.get('content-disposition'), /aurora-datos\.json/);
  assert.equal(exported.body.version, 1);
  assert.equal(exported.body.requests.length, 2);
  assert.equal(exported.body.events.length, 5);
  assert.doesNotMatch(JSON.stringify(exported.body), /password|token_hash/);
});

test('búsqueda paginada con 300 clientes, 1.200 solicitudes y cinco sesiones', async t => {
  const { db, send, login } = await fixture(t);
  await seedVolume(db);
  const accounts = await Promise.all(accountIds.map(id => login(id)));
  const requests = await Promise.all(accounts.map(({ cookie }) => send('/requests', { cookie })));
  assert.ok(requests.every(result => result.status === 200 && result.body.total === 1200 && result.body.requests.length === 20));
  const search = await send('/requests?q=AUR-202611-1200', { cookie: accounts[0].cookie });
  assert.equal(search.body.total, 1);
  const next = await send('/requests?page=2', { cookie: accounts[0].cookie });
  assert.notEqual(next.body.requests[0].ticket, requests[0].body.requests[0].ticket);
  const worst = Math.max(...requests.map(result => result.elapsed), search.elapsed);
  t.diagnostic('Máximo API con datos ficticios: ' + worst.toFixed(0) + ' ms');
  assert.ok(worst < 1500);
});
