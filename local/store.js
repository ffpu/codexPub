const hour = 3600000;
const dateInColombia = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit' });
const defaultActors = [
  { id: 'agente1', name: 'Laura Méndez', role: 'agente', available: true },
  { id: 'agente2', name: 'Mateo Rojas', role: 'agente', available: true },
  { id: 'agente3', name: 'Valentina Cruz', role: 'agente', available: true },
  { id: 'agente4', name: 'Diego Silva', role: 'agente', available: true },
  { id: 'coord', name: 'Ana Torres', role: 'coordinador', available: false }
];

function emptyData() {
  return { version: 1, format: 'aurora-archivo', customers: [], actors: defaultActors.map(actor => ({ ...actor })),
    requests: [], events: [], last_agent: null };
}

class LocalError extends Error {
  constructor(status, message, fields) {
    super(message);
    this.status = status;
    this.fields = fields;
  }
}

function validDate(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function receivedDate(value) {
  const raw = string(value);
  const parts = /^(\d{4}-\d\d-\d\d)[T ](\d\d:\d\d)(?::(\d\d)(\.\d{1,3})?)?(Z|[+-]\d\d:\d\d)?$/.exec(raw);
  if (!parts) return null;
  const [, day, time, second = '00', fraction = '', zone = '-05:00'] = parts;
  const bare = day + 'T' + time + ':' + second;
  const utc = new Date(bare + 'Z');
  const date = new Date(bare + fraction + zone);
  if (!Number.isFinite(+utc) || !Number.isFinite(+date) || !utc.toISOString().startsWith(bare)) return null;
  return date.toISOString();
}

function nextTicket(data, now, counters = new Map()) {
  const month = dateInColombia.format(new Date(now)).slice(0, 7).replace('-', '');
  if (!counters.has(month)) {
    const latest = data.requests.reduce((max, row) => row.ticket.startsWith('AUR-' + month + '-')
      ? Math.max(max, Number(row.ticket.slice(-4))) : max, 0);
    counters.set(month, latest);
  }
  const number = counters.get(month) + 1;
  if (number > 9999) throw new LocalError(409, 'Se agotaron los consecutivos del mes.');
  counters.set(month, number);
  return 'AUR-' + month + '-' + String(number).padStart(4, '0');
}

function appendEvent(data, request, actor, now, action, before, after, note = null) {
  data.events.push({ ticket: request.ticket, actor_id: actor, occurred_at: now,
    action, before_values: before, after_values: after, note });
}

function makeRequest(record, ticket, agent, now, info = {}) {
  return { ...record, ticket, agent_id: agent, state: 'nuevo', version: 1, received_at: now, issued_at: now,
    resolved_at: null, response: null, elapsed_ms: null, compliant: null, source_ref: null, imported_at: null, ...info };
}

function demoData() {
  const sample = emptyData();
  sample.customers.push({ nit: '900123456', name: 'Colegio Los Cedros' }, { nit: '001240', name: 'Papelería Norte' },
    { nit: '900210008', name: 'Estudio Cerezo' });
  const now = Date.now();
  const examples = [
    ['900123456', 'pedido', 'Confirmar la fecha de entrega de los cuadernos.', 3, 'nuevo'],
    ['001240', 'envio', 'Faltan tres cajas de marcadores en el envío recibido.', 54, 'logistica'],
    ['900210008', 'facturacion', 'Revisar la factura del pedido de papelería.', 26, 'ventas'],
    ['900123456', 'stock', 'Se consultó la disponibilidad de cartulina.', 56, 'resuelto']
  ];
  examples.forEach(([nit, category, description, age, state], index) => {
    const received = new Date(now - age * hour).toISOString();
    const agent = 'agente' + (index + 1);
    const request = makeRequest({ nit, category, description, channel: 'correo', order_ref: null },
      nextTicket(sample, now), agent, received);
    sample.requests.push(request);
    appendEvent(sample, request, 'coord', received, 'radicacion', null, { agent_id: agent, state: 'nuevo' });
    if (state === 'resuelto') {
      const response = 'Se confirmó el inventario al cliente.';
      const resolved = new Date(Date.parse(received) + 25 * hour).toISOString();
      Object.assign(request, { state, resolved_at: resolved, response, elapsed_ms: 25 * hour, compliant: true });
      appendEvent(sample, request, agent, resolved, 'estado', { state: 'nuevo' }, { state }, response);
    } else if (state !== 'nuevo') {
      request.state = state;
      appendEvent(sample, request, agent, new Date(Date.parse(received) + hour).toISOString(), 'estado', { state: 'nuevo' }, { state });
    }
  });
  sample.last_agent = 'agente4';
  return sample;
}

function fromFile(raw) {
  function check(condition, message) {
    if (!condition) throw new LocalError(400, message);
  }
  check(raw?.version === 1 && ['customers','actors','requests','events'].every(key => Array.isArray(raw[key])),
    'El archivo debe ser una exportación JSON de Comercial Aurora.');
  const customers = raw.customers.map(row => {
    check(row && typeof row.nit === 'string' && row.nit.trim() && string(row.name), 'El archivo contiene un cliente sin NIT o razón social.');
    return { nit: row.nit.trim(), name: row.name.trim() };
  });
  const actors = raw.actors.map(row => {
    check(row && string(row.id) && string(row.name) && ['agente','coordinador'].includes(row.role), 'El archivo contiene un perfil inválido.');
    return { id: row.id.trim(), name: row.name.trim(), role: row.role, available: row.role === 'agente' && row.available !== false };
  });
  const ids = new Set(actors.map(row => row.id));
  const agents = new Set(actors.filter(row => row.role === 'agente').map(row => row.id));
  const nits = new Set(customers.map(row => row.nit));
  check(ids.size === actors.length && nits.size === customers.length && agents.size && actors.some(row => row.role === 'coordinador'),
    'Revisa los NIT y perfiles duplicados. La base requiere al menos un agente y un coordinador.');
  const sources = new Set();
  const requests = raw.requests.map(row => {
    const { record, fields } = validateFields(row);
    check(row && /^AUR-\d{6}-\d{4}$/.test(row.ticket) && nits.has(record.nit) && agents.has(row.agent_id)
      && Object.hasOwn(states, row.state) && validDate(row.received_at) && !Object.keys(fields).length,
    'Hay solicitudes con datos no válidos o referencias a clientes o agentes inexistentes.');
    const closed = !openStates.includes(row.state);
    check(closed === validDate(row.resolved_at) && (!closed || Date.parse(row.resolved_at) >= Date.parse(row.received_at)),
      'Hay solicitudes con fechas de resolución incoherentes.');
    const elapsed = closed ? Date.parse(row.resolved_at) - Date.parse(row.received_at) : null;
    const ref = string(row.source_ref) || null;
    check(!ref || !sources.has(ref), 'El archivo contiene referencias de importación duplicadas.');
    if (ref) sources.add(ref);
    return makeRequest(record, row.ticket, row.agent_id, new Date(row.received_at).toISOString(), {
      state: row.state, version: Number.isSafeInteger(row.version) && row.version > 0 ? row.version : 1,
      issued_at: validDate(row.issued_at) ? new Date(row.issued_at).toISOString() : new Date(row.received_at).toISOString(),
      response: string(row.response) || null, resolved_at: closed ? new Date(row.resolved_at).toISOString() : null,
      elapsed_ms: elapsed, compliant: closed ? elapsed <= limitMs : null, source_ref: ref,
      imported_at: validDate(row.imported_at) ? new Date(row.imported_at).toISOString() : null
    });
  });
  const tickets = new Set(requests.map(row => row.ticket));
  check(tickets.size === requests.length, 'El archivo contiene radicados duplicados.');
  const events = [];
  for (const row of raw.events) {
    check(row && tickets.has(row.ticket) && ids.has(row.actor_id) && validDate(row.occurred_at)
      && ['radicacion', 'migracion', 'reasignacion', 'estado'].includes(row.action), 'El archivo contiene eventos de historial que no se pueden relacionar.');
    const values = value => value && typeof value === 'object' ? {
      state: string(value.state), agent_id: string(value.agent_id), source_ref: string(value.source_ref)
    } : null;
    appendEvent({ events }, { ticket: row.ticket }, row.actor_id, new Date(row.occurred_at).toISOString(),
      row.action, values(row.before_values), values(row.after_values), string(row.note) || null);
  }
  return { version: 1, format: 'aurora-archivo', customers, actors, requests, events,
    last_agent: agents.has(raw.last_agent) ? raw.last_agent : null };
}
