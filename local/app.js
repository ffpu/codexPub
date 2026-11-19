let dataset = demoData();
let activeActor = null;
let fileName = 'Datos de demostración';
let dirty = false;
let keySequence = 0;
const recentSaves = new Map();

function refreshFileStatus(message = '') {
  const status = document.querySelector('#local-status');
  status.textContent = [fileName, dirty ? 'Cambios sin guardar' : '', message].filter(Boolean).join(' · ');
  status.classList.toggle('unsaved', dirty);
}

function replaceData(data, name) {
  dataset = data;
  activeActor = null;
  fileName = name;
  dirty = false;
  recentSaves.clear();
  refreshFileStatus();
  const profiles = document.querySelector('#local-profile');
  profiles.replaceChildren(new Option('Selecciona un perfil', ''),
    ...data.actors.map(actor => new Option(actor.name + ' · ' + actor.role, actor.id)));
  window.dispatchEvent(new Event('aurora-local-reset'));
}

function saveFile() {
  const content = JSON.stringify({ ...dataset, exported_at: new Date().toISOString() }, null, 2) + '\n';
  const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
  const link = document.createElement('a');
  const suggested = 'aurora-' + dateInColombia.format(new Date()) + '.json';
  link.href = url;
  link.download = suggested;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  dirty = false;
  fileName = suggested;
  refreshFileStatus('Descarga solicitada al navegador');
}

const mayReplace = () => !dirty || window.confirm('Hay cambios sin guardar. ¿Deseas descartarlos y abrir otra base?');
const lookupActor = id => dataset.actors.find(actor => actor.id === id);
const userView = ({ id, name, role }) => ({ id, name, role });
const agents = () => dataset.actors.filter(actor => actor.role === 'agente').sort((a, b) => a.id.localeCompare(b.id));

function decorate(row, clients, actors) {
  return { ...row, customer: clients.get(row.nit)?.name, agent: actors.get(row.agent_id)?.name };
}

function detail(ticket, now) {
  const row = dataset.requests.find(item => item.ticket === ticket);
  if (!row) throw new LocalError(404, 'No encontramos la solicitud.');
  const actorMap = new Map(dataset.actors.map(actor => [actor.id, actor]));
  const events = dataset.events.filter(event => event.ticket === ticket)
    .sort((a, b) => a.occurred_at.localeCompare(b.occurred_at))
    .map(event => ({ ...event, actor: actorMap.get(event.actor_id)?.name || event.actor_id }));
  return { request: decorate(row, new Map(dataset.customers.map(client => [client.nit, client])), actorMap), events, now };
}

function list(query, now) {
  const clients = new Map(dataset.customers.map(client => [client.nit, client]));
  const actors = new Map(dataset.actors.map(actor => [actor.id, actor]));
  const all = dataset.requests.map(row => decorate(row, clients, actors));
  const keyword = string(query.get('q')).toLocaleLowerCase('es-CO');
  const state = query.get('state');
  const agent = query.get('agent');
  const deadline = query.get('deadline');
  const open = row => openStates.includes(row.state);
  const overdue = row => open(row) && Date.parse(now) - Date.parse(row.received_at) > limitMs;
  const selected = all.filter(row => (!keyword || [row.ticket, row.nit, row.customer].some(value => value?.toLocaleLowerCase('es-CO').includes(keyword)))
    && (!state || row.state === state) && (!agent || row.agent_id === agent)
    && (deadline === 'vencidas' ? overdue(row) : deadline === 'a-tiempo' ? open(row) && !overdue(row) : true));
  selected.sort((a, b) => b.received_at.localeCompare(a.received_at) || b.ticket.localeCompare(a.ticket));
  const size = 20;
  const page = Math.max(1, Math.min(Math.ceil(selected.length / size) || 1, Number.parseInt(query.get('page'), 10) || 1));
  const opened = all.filter(open).length;
  return { requests: selected.slice((page - 1) * size, page * size), page, size, total: selected.length, now,
    summary: { total: all.length, open: opened, overdue: all.filter(overdue).length, finished: all.length - opened } };
}

function markDirty() {
  dirty = true;
  refreshFileStatus();
}

function createRecord(actor, body, key, now) {
  const { record, fields } = validateFields(body);
  if (!dataset.customers.some(client => client.nit === record.nit)) fields.nit = 'Selecciona un cliente del directorio.';
  if (Object.keys(fields).length) throw new LocalError(400, 'Revisa los datos de la solicitud.', fields);
  const saveKey = actor.id + ':' + key;
  const payload = JSON.stringify(record);
  const previous = key && recentSaves.get(saveKey);
  if (previous) {
    if (previous.payload !== payload) throw new LocalError(409, 'La clave corresponde a una radicación diferente.');
    return detail(previous.ticket, now);
  }
  const available = agents().filter(agent => agent.available);
  if (!available.length) throw new LocalError(409, 'No hay agentes disponibles. Habilita un agente desde el perfil de coordinación.');
  const next = available.find(agent => agent.id.localeCompare(dataset.last_agent || '') > 0) || available[0];
  const ticket = nextTicket(dataset, now);
  const row = makeRequest(record, ticket, next.id, now);
  dataset.requests.push(row);
  dataset.last_agent = next.id;
  appendEvent(dataset, row, actor.id, now, 'radicacion', null, { state: 'nuevo', agent_id: next.id });
  if (key) recentSaves.set(saveKey, { ticket, payload });
  markDirty();
  return detail(ticket, now);
}

function requireCoordinator(actor) {
  if (actor.role !== 'coordinador') throw new LocalError(403, 'Esta operación está reservada al perfil de coordinación.');
}

function editRecord(ticket, actor, body, now) {
  const row = dataset.requests.find(item => item.ticket === ticket);
  if (!row) throw new LocalError(404, 'No encontramos la solicitud.');
  if (actor.role !== 'coordinador' && actor.id !== row.agent_id) throw new LocalError(403, 'Solo puedes actualizar tus solicitudes asignadas.');
  if (row.version !== body.version) throw new LocalError(409, 'El caso cambió. Revisa la versión vigente antes de guardar.');
  if (body.action === 'reasignar') {
    requireCoordinator(actor);
    const agent = lookupActor(body.agent_id);
    const reason = string(body.reason);
    if (!openStates.includes(row.state) || !agent?.available || agent.role !== 'agente' || agent.id === row.agent_id || !reason || reason.length > 1000) {
      throw new LocalError(400, 'Selecciona otro agente disponible e indica el motivo, de máximo 1000 caracteres.');
    }
    const before = row.agent_id;
    row.agent_id = agent.id;
    appendEvent(dataset, row, actor.id, now, 'reasignacion', { agent_id: before }, { agent_id: agent.id }, reason);
  } else if (body.action === 'estado') {
    const next = body.state;
    const allowed = openStates.includes(row.state) ? [...openStates, 'resuelto'] : row.state === 'resuelto' ? ['cerrado'] : [];
    if (!allowed.includes(next) || next === row.state) throw new LocalError(400, 'El cambio de estado no es válido.');
    const before = row.state;
    const response = string(body.response);
    if (next === 'resuelto') {
      if (!response || response.length > 5000) throw new LocalError(400, 'Escribe una respuesta de fondo de máximo 5000 caracteres.');
      const elapsed = Date.parse(now) - Date.parse(row.received_at);
      if (elapsed < 0) throw new LocalError(400, 'La hora de resolución es anterior a la recepción. Revisa el reloj del equipo.');
      Object.assign(row, { resolved_at: now, response, elapsed_ms: elapsed, compliant: elapsed <= limitMs });
    }
    row.state = next;
    appendEvent(dataset, row, actor.id, now, 'estado', { state: before }, { state: next }, next === 'resuelto' ? response : null);
  } else throw new LocalError(400, 'Acción desconocida.');
  row.version++;
  markDirty();
  return detail(ticket, now);
}

function metrics(query) {
  const from = receivedDate((query.get('from') || '') + 'T00:00');
  const through = receivedDate((query.get('through') || '') + 'T00:00');
  if (!from || !through || from > through) throw new LocalError(400, 'Selecciona un periodo válido.');
  const until = Date.parse(through) + 24 * hour;
  const results = dataset.requests.filter(row => row.resolved_at >= from && Date.parse(row.resolved_at) < until);
  const compliant = results.filter(row => row.compliant).length;
  return { resolved: results.length, compliant, percent: results.length ? compliant / results.length * 100 : null };
}

function dispatch(route, { method, headers, body: input }) {
  const { pathname, searchParams } = new URL(route, 'http://aurora.local');
  const [, , resource, id] = pathname.split('/').map(decodeURIComponent);
  const now = new Date().toISOString();
  const body = input ? JSON.parse(input) : {};
  if (resource === 'config') return { mode: 'local', channels, categories, states };
  if (resource === 'login' && method === 'POST') {
    const actor = lookupActor(body.id);
    if (!actor) throw new LocalError(400, 'Selecciona un perfil de trabajo.');
    activeActor = actor.id;
    return userView(actor);
  }
  const actor = lookupActor(activeActor);
  if (!actor) throw new LocalError(401, 'Selecciona un perfil para continuar.');
  if (resource === 'logout') {
    activeActor = null;
    return { ok: true };
  }
  if (resource === 'me') return userView(actor);
  if (resource === 'customers') {
    const q = string(searchParams.get('q')).toLocaleLowerCase('es-CO');
    return dataset.customers.filter(row => row.nit.includes(q) || row.name.toLocaleLowerCase('es-CO').includes(q))
      .sort((a, b) => Number(b.nit === q) - Number(a.nit === q) || a.name.localeCompare(b.name, 'es-CO')).slice(0, 25);
  }
  if (resource === 'agents') {
    if (method === 'GET') return agents();
    requireCoordinator(actor);
    const agent = lookupActor(id);
    if (!agent || agent.role !== 'agente') throw new LocalError(404, 'No encontramos el agente.');
    if (typeof body.available !== 'boolean') throw new LocalError(400, 'Indica la disponibilidad.');
    agent.available = body.available;
    markDirty();
    return agent;
  }
  if (resource === 'requests') {
    if (method === 'POST') return createRecord(actor, body, headers['Idempotency-Key'], now);
    if (method === 'PATCH') return editRecord(id, actor, body, now);
    return id ? detail(id, now) : list(searchParams, now);
  }
  if (resource === 'metrics') {
    requireCoordinator(actor);
    return metrics(searchParams);
  }
  if (resource === 'import') {
    requireCoordinator(actor);
    const before = body.confirm === true ? structuredClone(dataset) : dataset;
    const result = importRecords(before, id, body, actor, now);
    if (result.totals.cargado) {
      dataset = before;
      markDirty();
    }
    return result;
  }
  throw new LocalError(404, 'Operación desconocida.');
}

globalThis.auroraLocal = {
  newKey: () => Date.now() + '-' + (++keySequence),
  async request(route, options) {
    try {
      const result = dispatch(route, options);
      return { ok: true, json: async () => result };
    } catch (error) {
      return { ok: false, status: error.status || 500, json: async () => ({ error: error.message, fields: error.fields }) };
    }
  }
};

const picker = document.querySelector('#local-open-input');
document.querySelector('#local-open').addEventListener('click', () => picker.click());
picker.addEventListener('change', async () => {
  const [file] = picker.files;
  picker.value = '';
  if (!file) return;
  try {
    if (file.size > 50 * 1024 * 1024) throw new LocalError(400, 'El archivo supera 50 MB.');
    const data = fromFile(JSON.parse((await file.text()).replace(/^\uFEFF/, '')));
    if (mayReplace()) replaceData(data, file.name);
  } catch (error) {
    refreshFileStatus(error instanceof SyntaxError ? 'El archivo no contiene JSON válido.' : error.message);
  }
});
document.querySelector('#local-new').addEventListener('click', () => {
  if (mayReplace()) replaceData(emptyData(), 'Archivo nuevo');
});
document.querySelectorAll('[data-save-local]').forEach(button => button.addEventListener('click', saveFile));
window.addEventListener('beforeunload', event => {
  if (dirty) {
    event.preventDefault();
    event.returnValue = '';
  }
});
replaceData(dataset, fileName);
