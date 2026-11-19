function readCsv(source) {
  const first = source.split(/\r?\n/, 1)[0];
  const delimiter = first.includes(';') && !first.includes(',') ? ';' : ',';
  const table = [];
  let row = [];
  let field = '';
  let quoted = false;
  let endedQuote = false;
  const pushField = () => {
    row.push(field);
    field = '';
    endedQuote = false;
  };
  const pushRow = () => {
    pushField();
    if (row.length !== 1 || row[0] !== '') table.push(row);
    row = [];
  };
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (quoted) {
      if (char !== '"') field += char;
      else if (source[i + 1] === '"') { field += '"'; i++; }
      else { quoted = false; endedQuote = true; }
    } else if (char === delimiter) pushField();
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && source[i + 1] === '\n') i++;
      pushRow();
    } else if (char === '"' && field === '' && !endedQuote) quoted = true;
    else if (char === '"' || endedQuote) throw new Error('Comillas incorrectas.');
    else field += char;
  }
  if (quoted) throw new Error('Comillas sin cerrar.');
  if (row.length || field || endedQuote) pushRow();
  const headers = table.shift()?.map(value => value.trim()) || [];
  if (!headers.length || headers.some(value => !value) || new Set(headers).size !== headers.length) throw new Error('Encabezados no válidos.');
  return table.map(values => {
    if (values.length !== headers.length) throw new Error('Todas las filas deben tener las columnas del encabezado.');
    return Object.fromEntries(headers.map((key, i) => [key, values[i]]));
  });
}

function parseImport(kind, body) {
  const content = typeof body.content === 'string' ? body.content.replace(/^\uFEFF/, '') : '';
  if (!content.trim()) throw new LocalError(400, 'Selecciona un archivo con datos.');
  let rows;
  try {
    if (body.format === 'csv') rows = readCsv(content);
    else if (body.format === 'json' && kind === 'clientes') rows = JSON.parse(content);
    else throw new Error('Formato no admitido.');
  } catch (error) {
    throw new LocalError(400, 'El archivo no corresponde al formato seleccionado. ' + error.message);
  }
  if (!Array.isArray(rows) || !rows.length || rows.length > 5000 || rows.some(row => !row || typeof row !== 'object' || Array.isArray(row))) {
    throw new LocalError(400, 'El archivo debe contener de 1 a 5.000 registros con columnas.');
  }
  return rows;
}

function importRecords(data, kind, body, actor, now) {
  const isCustomer = kind === 'clientes';
  if (!isCustomer && kind !== 'pendientes') throw new LocalError(404, 'Importación desconocida.');
  const rows = parseImport(kind, body);
  const key = isCustomer ? 'nit' : 'source_ref';
  const clients = new Map(data.customers.map(row => [row.nit, row]));
  const agents = new Set(data.actors.filter(row => row.role === 'agente').map(row => row.id));
  const imported = new Map(data.requests.filter(row => row.source_ref).map(row => [row.source_ref, row.ticket]));
  const counts = new Map();
  for (const row of rows) {
    const ref = string(row[key]);
    counts.set(ref, (counts.get(ref) || 0) + 1);
  }
  const ready = [];
  const report = rows.map((row, index) => {
    const ref = string(row[key]);
    const result = (status, message, ticket) => ({ row: index + 1, ref, status, message, ticket });
    if (!ref || ref.length > (isCustomer ? 40 : 150)) return result('excepcion', 'Referencia obligatoria o demasiado larga.');
    if (imported.has(ref)) return result('duplicado', 'Solicitud ya importada.', imported.get(ref));
    if (counts.get(ref) > 1) return result('duplicado', 'Referencia repetida en el archivo.');
    if (isCustomer) {
      const name = string(row.name);
      if (!name || name.length > 200) return result('excepcion', 'Razón social obligatoria, de máximo 200 caracteres.');
      ready.push({ index, nit: ref, name });
    } else {
      const { record, fields } = validateFields(row);
      const received = receivedDate(row.received_at);
      const agent = string(row.agent_id);
      const state = string(row.state);
      const problems = Object.values(fields);
      if (!clients.has(record.nit)) problems.push('Cliente fuera del directorio.');
      if (!agents.has(agent)) problems.push('Responsable no identificado.');
      if (!openStates.includes(state)) problems.push('Se requiere un estado abierto.');
      if (!received || received > now) problems.push('Fecha de recepción inválida o futura.');
      if (problems.length) return result('excepcion', problems.join(' '));
      ready.push({ index, ref, record, received, agent, state });
    }
    return result('listo', 'Registro apto.');
  });

  const canConfirm = !report.some(row => row.status === 'excepcion' || (row.status === 'duplicado' && !row.ticket));
  const confirmed = body.confirm === true && canConfirm;
  if (confirmed) {
    const counters = new Map();
    for (const item of ready) {
      let ticket;
      if (isCustomer) clients.set(item.nit, { nit: item.nit, name: item.name });
      else {
        ticket = nextTicket(data, now, counters);
        const record = makeRequest(item.record, ticket, item.agent, now,
          { state: item.state, received_at: item.received, source_ref: item.ref, imported_at: now });
        data.requests.push(record);
        appendEvent(data, record, actor.id, now, 'migracion', null, { agent_id: item.agent, state: item.state, source_ref: item.ref });
      }
      Object.assign(report[item.index], { ticket, status: 'cargado', message: isCustomer ? 'Cliente guardado.' : 'Solicitud importada.' });
    }
    if (isCustomer && ready.length) data.customers = [...clients.values()];
  }
  const totals = { total: report.length, listo: 0, duplicado: 0, excepcion: 0, cargado: 0 };
  for (const row of report) totals[row.status]++;
  return { rows: report, totals, confirmed, canConfirm };
}
