const $ = selector => document.querySelector(selector);
const all = selector => [...document.querySelectorAll(selector)];
const formData = form => Object.fromEntries(new FormData(form));
const openStates = ['nuevo', 'proceso', 'logistica', 'ventas'];
const dateTime = new Intl.DateTimeFormat('es-CO', { timeZone: 'America/Bogota', dateStyle: 'short', timeStyle: 'short' });
const dateOnly = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit' });
const percentage = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 1 });
const duration = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 2 });
const title = { inbox: 'Solicitudes', metrics: 'Indicadores', agents: 'Disponibilidad', data: 'Importar y exportar' };
const actionLabel = { radicacion: 'Radicación', migracion: 'Importación', reasignacion: 'Reasignación', estado: 'Cambio de estado' };
const rowStatus = { listo: 'Listo', duplicado: 'Duplicado', excepcion: 'Excepción', cargado: 'Cargado' };
const deadlineMs = 48 * 3600000;

let config;
let user;
let agents = [];
let view = 'inbox';
let page = 1;
let inboxGeneration = 0;
let customerGeneration = 0;
let currentDetail;
let createKey;
let lastImport;
let noticeTimeout;

async function api(route, options = {}) {
  const { method = 'GET', data, headers } = options;
  const response = await fetch('/api' + route, {
    method,
    headers: { ...(data === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
    body: data === undefined ? undefined : JSON.stringify(data)
  });
  const result = await response.json();
  if (response.ok) return result;
  const error = new Error(result.error || 'No se pudo completar la operación.');
  error.status = response.status;
  error.fields = result.fields;
  if (response.status === 401 && user) showLogin();
  throw error;
}

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function options(select, values, placeholder, keepValue = false) {
  const value = keepValue ? select.value : '';
  select.replaceChildren(new Option(placeholder, ''), ...values.map(([key, label]) => new Option(label, key)));
  if ([...select.options].some(option => option.value === value)) select.value = value;
}

function notice(message, error = false) {
  const box = $('#notice');
  clearTimeout(noticeTimeout);
  box.textContent = message;
  box.classList.toggle('fail', error);
  box.hidden = !message;
  if (message && !error) noticeTimeout = setTimeout(() => { box.hidden = true; }, 4500);
}

function showLogin() {
  user = null;
  inboxGeneration++;
  customerGeneration++;
  currentDetail = null;
  lastImport = null;
  all('dialog[open]').forEach(dialog => dialog.close());
  $('#create-form').reset();
  $('#import-form').reset();
  $('#import-report').hidden = true;
  $('#import-rows').replaceChildren();
  $('#requests').replaceChildren();
  $('#login-form').reset();
  $('#login-error').textContent = '';
  $('#shell').hidden = true;
  $('#login').hidden = false;
  $('#demo-access').hidden = config?.mode !== 'demo';
}

async function showApp(account) {
  user = account;
  $('#login').hidden = true;
  $('#shell').hidden = false;
  $('#environment').hidden = config.mode !== 'demo';
  $('#coord-nav').hidden = user.role !== 'coordinador';
  $('#user-name').textContent = user.name;
  $('#user-role').textContent = user.role;
  $('#initials').textContent = user.name.split(/\s+/).slice(0, 2).map(part => part[0]).join('');
  options($('#filters select[name=state]'), Object.entries(config.states), 'Todos los estados');
  options($('#create-form select[name=channel]'), Object.entries(config.channels), 'Selecciona el canal');
  options($('#create-form select[name=category]'), Object.entries(config.categories), 'Selecciona el tipo');
  $('#filters').reset();
  const today = dateOnly.format(new Date());
  $('#metrics-form input[name=from]').value = today.slice(0, 8) + '01';
  $('#metrics-form input[name=through]').value = today;
  page = 1;
  await selectView('inbox');
}

async function login(data) {
  const button = $('#login-form button[type=submit]');
  button.disabled = true;
  $('#login-error').textContent = '';
  try {
    await showApp(await api('/login', { method: 'POST', data }));
  } catch (error) {
    $('#login-error').textContent = error.message;
  } finally {
    button.disabled = false;
  }
}

async function fetchAgents() {
  agents = await api('/agents');
  options($('#filters select[name=agent]'), agents.map(agent => [agent.id, agent.name]), 'Todos los agentes', true);
}

async function selectView(next) {
  view = next;
  $('#breadcrumb').textContent = title[next];
  Object.keys(title).forEach(key => { $('#view-' + key).hidden = key !== next; });
  all('[data-view]').forEach(button => {
    button.classList.toggle('active', button.dataset.view === next);
    if (button.dataset.view === next) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  notice('');
  if (next === 'inbox') {
    await fetchAgents();
    await loadInbox();
  }
  if (next === 'metrics') await loadMetrics();
  if (next === 'agents') {
    await fetchAgents();
    renderAgents();
  }
}

function deadlineText(row, now) {
  if (row.resolved_at) {
    return { label: row.compliant ? 'Cumplió' : 'Fuera de plazo', className: row.compliant ? '' : 'late', detail: duration.format(Number(row.elapsed_ms) / 3600000) + ' h de atención' };
  }
  const remaining = +new Date(row.received_at) + deadlineMs - now;
  const minutes = Math.max(1, Math.ceil(Math.abs(remaining) / 60000));
  const amount = minutes >= 60 ? Math.floor(minutes / 60) + ' h ' + (minutes % 60) + ' min' : minutes + ' min';
  if (remaining < 0) return { label: 'Vencida · ' + amount, className: 'late' };
  return { label: remaining === 0 ? 'En el límite' : 'Quedan ' + amount, className: remaining <= 12 * 3600000 ? 'soon' : '' };
}

function cell(row, main, secondary) {
  const td = document.createElement('td');
  td.append(main instanceof Node ? main : element('span', main, 'cell-title'));
  if (secondary) td.append(element('span', secondary, 'cell-muted'));
  row.append(td);
}

async function loadInbox() {
  const generation = ++inboxGeneration;
  const filters = new URLSearchParams({ ...formData($('#filters')), page });
  const result = await api('/requests?' + filters);
  if (generation !== inboxGeneration || !user) return;
  for (const [key, value] of Object.entries(result.summary)) $('#count-' + key).textContent = value;
  $('#result-count').textContent = result.total + (result.total === 1 ? ' solicitud encontrada' : ' solicitudes encontradas');
  const tbody = $('#requests');
  const rows = result.requests.map(request => {
    const row = document.createElement('tr');
    const button = element('button', request.ticket, 'ticket-link');
    button.type = 'button';
    button.addEventListener('click', () => run(() => openDetail(request.ticket)));
    cell(row, button, config.categories[request.category]);
    cell(row, request.customer, 'NIT ' + request.nit);
    cell(row, element('span', config.states[request.state], 'badge ' + request.state));
    cell(row, request.agent);
    cell(row, dateTime.format(new Date(request.received_at)));
    const deadline = deadlineText(request, +new Date(result.now));
    cell(row, element('span', deadline.label, 'deadline ' + (deadline.className || '')), deadline.detail);
    const arrow = element('button', '›', 'open-detail');
    arrow.type = 'button';
    arrow.setAttribute('aria-label', 'Ver detalle de ' + request.ticket);
    arrow.addEventListener('click', () => run(() => openDetail(request.ticket)));
    cell(row, arrow);
    return row;
  });
  if (!rows.length) {
    const row = document.createElement('tr');
    const empty = element('td', 'No hay solicitudes para estos filtros.', 'empty');
    empty.colSpan = 7;
    row.append(empty);
    rows.push(row);
  }
  tbody.replaceChildren(...rows);
  const pages = Math.max(1, Math.ceil(result.total / result.size));
  $('#page-label').textContent = 'Página ' + result.page + ' de ' + pages;
  $('#prev').disabled = result.page <= 1;
  $('#next').disabled = result.page >= pages;
}

async function loadCustomers() {
  const generation = ++customerGeneration;
  const customers = await api('/customers?' + new URLSearchParams({ q: $('#client-search').value }));
  if (generation !== customerGeneration || !user) return;
  const select = $('#create-form select[name=nit]');
  const previous = select.selectedOptions[0];
  const list = customers.map(person => [person.nit, person.name + ' · ' + person.nit]);
  if (previous?.value && !list.some(([nit]) => nit === previous.value)) list.unshift([previous.value, previous.textContent]);
  options(select, list, 'Selecciona un cliente', true);
}

function updateResponseField() {
  const needed = $('#state-form select').value === 'resuelto';
  $('#response-field').hidden = !needed;
  $('#response-field textarea').required = needed;
}

function detailProperties(request, now) {
  const time = deadlineText(request, now);
  return [
    ['Estado', config.states[request.state]], ['Responsable', request.agent],
    ['Recepción', dateTime.format(new Date(request.received_at))], ['Canal', config.channels[request.channel]],
    ['Tipo', config.categories[request.category]], ['Pedido', request.order_ref || '—'],
    ['Plazo de 48 h', [time.label, time.detail].filter(Boolean).join(' · ')],
    ['Resolución', request.resolved_at ? dateTime.format(new Date(request.resolved_at)) : '—']
  ];
}

function eventSummary(entry) {
  const prior = entry.before_values || {};
  const after = entry.after_values || {};
  const agentName = id => agents.find(agent => agent.id === id)?.name || id;
  const values = [];
  if (after.state) values.push([config.states[prior.state], config.states[after.state]].filter(Boolean).join(' → '));
  if (after.agent_id) values.push([prior.agent_id, after.agent_id].filter(Boolean).map(agentName).join(' → '));
  if (after.source_ref) values.push('Origen ' + after.source_ref);
  if (entry.note) values.push(entry.note);
  return values.join(' · ');
}

function renderDetail(data, keepDraft = false) {
  const request = data.request;
  currentDetail = request;
  const priorState = keepDraft ? $('#state-form select').value : '';
  const priorAgent = keepDraft ? $('#reassign-form select').value : '';
  if (!keepDraft) {
    $('#state-form').reset();
    $('#reassign-form').reset();
  }
  $('#detail-error').textContent = '';
  $('#reload-detail').hidden = true;
  $('#detail-ticket').textContent = request.ticket;
  $('#detail-customer').textContent = request.customer + ' · NIT ' + request.nit;
  $('#detail-description').textContent = request.description;
  $('#detail-meta').replaceChildren(...detailProperties(request, +new Date(data.now)).map(([name, value]) => {
    const div = document.createElement('div');
    div.append(element('dt', name), element('dd', value));
    return div;
  }));
  const canEdit = user.role === 'coordinador' || user.id === request.agent_id;
  const targets = openStates.includes(request.state) ? [...openStates, 'resuelto'].filter(state => state !== request.state)
    : request.state === 'resuelto' ? ['cerrado'] : [];
  $('#state-form').hidden = !canEdit || !targets.length;
  options($('#state-form select'), targets.map(state => [state, config.states[state]]), 'Selecciona un estado');
  if (targets.includes(priorState)) $('#state-form select').value = priorState;
  updateResponseField();
  const available = agents.filter(agent => agent.available && agent.id !== request.agent_id);
  $('#reassign-form').hidden = user.role !== 'coordinador' || !openStates.includes(request.state);
  options($('#reassign-form select'), available.map(agent => [agent.id, agent.name]), 'Selecciona un agente');
  if (available.some(agent => agent.id === priorAgent)) $('#reassign-form select').value = priorAgent;
  $('#events').replaceChildren(...data.events.map(entry => {
    const li = document.createElement('li');
    li.append(element('strong', actionLabel[entry.action] + ' · ' + entry.actor),
      element('span', dateTime.format(new Date(entry.occurred_at)) + ' · ' + eventSummary(entry), 'cell-muted'));
    return li;
  }));
}

async function openDetail(ticket, keepDraft = false) {
  await fetchAgents();
  renderDetail(await api('/requests/' + encodeURIComponent(ticket)), keepDraft);
  if (!$('#detail-dialog').open) $('#detail-dialog').showModal();
}

async function saveDetail(action, form) {
  const button = form.querySelector('button[type=submit], button:not([type])');
  button.disabled = true;
  try {
    const data = { ...formData(form), action, version: currentDetail.version };
    const result = await api('/requests/' + encodeURIComponent(currentDetail.ticket), { method: 'PATCH', data });
    renderDetail(result);
    notice('Solicitud actualizada.');
    await loadInbox();
  } catch (error) {
    $('#detail-error').textContent = error.message;
    $('#reload-detail').hidden = error.status !== 409;
  } finally {
    button.disabled = false;
  }
}

function renderAgents() {
  $('#agent-list').replaceChildren(...agents.map(agent => {
    const item = document.createElement('li');
    const label = element('label', agent.available ? 'Disponible' : 'No disponible');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = agent.available;
    checkbox.setAttribute('aria-label', 'Disponibilidad de ' + agent.name);
    checkbox.addEventListener('change', async () => {
      checkbox.disabled = true;
      try {
        await api('/agents/' + encodeURIComponent(agent.id), { method: 'PATCH', data: { available: checkbox.checked } });
        await fetchAgents();
        renderAgents();
      } catch (error) {
        checkbox.checked = agent.available;
        notice(error.message, true);
      } finally {
        checkbox.disabled = false;
      }
    });
    label.prepend(checkbox);
    item.append(element('strong', agent.name), label);
    return item;
  }));
}

async function loadMetrics() {
  const values = formData($('#metrics-form'));
  const result = await api('/metrics?' + new URLSearchParams(values));
  const metric = $('#metric-result');
  metric.replaceChildren();
  if (!result.resolved) metric.textContent = 'Sin resoluciones en el periodo seleccionado.';
  else metric.append(element('strong', percentage.format(result.percent) + ' %'),
    element('span', result.compliant + ' de ' + result.resolved + ' resueltas dentro de 48 horas.'));
}

function importHint() {
  const customers = $('#import-form select').value === 'clientes';
  $('#import-form input[type=file]').accept = customers ? '.csv,.json' : '.csv';
  $('#import-hint').textContent = customers
    ? 'Usa las columnas nit y name. En JSON, guarda el NIT como texto.'
    : 'Columnas CSV: source_ref, nit, channel, category, description, order_ref, agent_id, state, received_at. Usa una referencia estable y fechas ISO.';
  $('#import-report').hidden = true;
  lastImport = null;
}

async function submitImport(confirm) {
  const form = $('#import-form');
  if (!confirm) {
    const file = form.elements.file.files[0];
    if (!file || file.size > 3 * 1024 * 1024) throw new Error('Selecciona un archivo de máximo 3 MB.');
    lastImport = { kind: form.elements.kind.value, format: file.name.split('.').pop().toLowerCase(), content: await file.text() };
  }
  if (!lastImport) return;
  const pending = lastImport;
  const result = await api('/import/' + pending.kind, { method: 'POST', data: { ...pending, confirm } });
  if (lastImport !== pending) return;
  const totals = result.totals;
  $('#import-report').hidden = false;
  $('#import-confirm').hidden = result.confirmed || !result.canConfirm || !totals.listo;
  $('#import-totals').textContent = totals.total + ' filas · ' + totals.listo + ' listas · ' + totals.duplicado + ' duplicadas · ' + totals.excepcion + ' excepciones · ' + totals.cargado + ' cargadas';
  $('#import-rows').replaceChildren(...result.rows.map(entry => {
    const row = document.createElement('tr');
    for (const text of [entry.row, entry.ref || '—', rowStatus[entry.status], [entry.message, entry.ticket].filter(Boolean).join(' ')]) row.append(element('td', text));
    return row;
  }));
}

const run = fn => Promise.resolve().then(fn).catch(error => notice(error.message, true));
const bind = (selector, event, callback) => $(selector).addEventListener(event, callback);
function debounce(fn) {
  let timer;
  return () => {
    clearTimeout(timer);
    timer = setTimeout(() => run(fn), 230);
  };
}

bind('#login-form', 'submit', event => { event.preventDefault(); login(formData(event.target)); });
bind('#demo-coordinator', 'click', () => login({ id: 'coord', password: 'Aurora-Demo-2026' }));
bind('#demo-agent', 'click', () => login({ id: 'agente1', password: 'Aurora-Demo-2026' }));
bind('#logout', 'click', () => run(async () => { await api('/logout', { method: 'POST', data: {} }); showLogin(); }));
all('[data-view]').forEach(button => button.addEventListener('click', () => run(() => selectView(button.dataset.view))));
all('.close-dialog').forEach(button => button.addEventListener('click', () => button.closest('dialog').close()));
const createDialog = () => {
  createKey ||= crypto.randomUUID();
  $('#create-dialog').showModal();
  run(loadCustomers);
};
bind('#new-request', 'click', createDialog);
bind('#nav-create', 'click', createDialog);
bind('#client-search', 'input', debounce(loadCustomers));
bind('#create-form', 'submit', async event => {
  event.preventDefault();
  const form = event.target;
  const button = form.querySelector('button:not([type])');
  button.disabled = true;
  $('#create-error').textContent = '';
  all('.field-error').forEach(field => { field.textContent = ''; });
  try {
    const detail = await api('/requests', { method: 'POST', data: formData(form), headers: { 'Idempotency-Key': createKey } });
    form.reset();
    createKey = null;
    $('#create-dialog').close();
    await selectView('inbox');
    notice('Solicitud radicada: ' + detail.request.ticket);
  } catch (error) {
    $('#create-error').textContent = error.message;
    for (const field of all('.field-error')) field.textContent = error.fields?.[field.dataset.field] || '';
  } finally {
    button.disabled = false;
  }
});
bind('#filters', 'submit', event => { event.preventDefault(); page = 1; run(loadInbox); });
bind('#filters input', 'input', debounce(() => { page = 1; return loadInbox(); }));
all('#filters select').forEach(select => select.addEventListener('change', () => { page = 1; run(loadInbox); }));
bind('#refresh', 'click', () => run(loadInbox));
bind('#prev', 'click', () => { page--; run(loadInbox); });
bind('#next', 'click', () => { page++; run(loadInbox); });
bind('#state-form select', 'change', updateResponseField);
bind('#reload-detail', 'click', () => run(() => openDetail(currentDetail.ticket, true)));
bind('#state-form', 'submit', event => { event.preventDefault(); saveDetail('estado', event.target); });
bind('#reassign-form', 'submit', event => { event.preventDefault(); saveDetail('reasignar', event.target); });
bind('#metrics-form', 'submit', event => { event.preventDefault(); run(loadMetrics); });
bind('#import-form select', 'change', importHint);
bind('#import-form input[type=file]', 'change', importHint);
bind('#import-form', 'submit', event => { event.preventDefault(); run(() => submitImport(false)); });
bind('#import-confirm', 'click', event => {
  const button = event.currentTarget;
  button.disabled = true;
  run(async () => {
    try { await submitImport(true); } finally { button.disabled = false; }
  });
});
setInterval(() => {
  if (user && view === 'inbox' && !document.hidden) run(loadInbox);
}, 10000);

try {
  config = await api('/config');
  importHint();
  try { await showApp(await api('/me')); }
  catch (error) { if (error.status !== 401) throw error; showLogin(); }
} catch (error) {
  showLogin();
  $('#login-error').textContent = error.message;
}
