import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { chromium } from 'playwright-core';

const fileUrl = new URL('../index.html', import.meta.url).href;

async function applicationLoader(context, t) {
  const probe = await context.newPage();
  try {
    await probe.goto(fileUrl);
    return page => page.goto(fileUrl);
  } catch (error) {
    if (!error.message.includes('ERR_BLOCKED_BY_ADMINISTRATOR')) throw error;
    t.diagnostic('La política de Chromium bloqueó file://. Se probó el contenido HTML completo en una pestaña sin red.');
    const html = await readFile(new URL(fileUrl), 'utf8');
    return page => page.setContent(html, { waitUntil: 'load' });
  } finally {
    await probe.close();
  }
}

async function profile(page, id) {
  await page.getByLabel('Perfil de trabajo').selectOption(id);
  await page.getByRole('button', { name: 'Entrar a la bandeja' }).click();
  await page.getByRole('heading', { name: 'Bandeja de solicitudes' }).waitFor();
}

async function importFile(page, name, content) {
  await page.locator('#import-form input[type=file]').setInputFiles({
    name, mimeType: 'text/csv', buffer: Buffer.from(content)
  });
  await page.getByRole('button', { name: 'Ensayar importación' }).click();
}

async function openDataFile(page, name, data) {
  await page.locator('#local-open-input').setInputFiles({
    name, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data))
  });
}

test('HTML independiente sin red, con importación, radicación, resolución y recuperación de JSON', { timeout: 45_000 }, async t => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium' });
  t.after(() => browser.close());
  const context = await browser.newContext({ offline: true });
  const openApplication = await applicationLoader(context, t);
  const page = await context.newPage();
  const errors = [];
  const network = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (/^https?:/.test(request.url())) network.push(request.url()); });
  await openApplication(page);
  await profile(page, 'coord');
  await page.getByText('4 solicitudes encontradas', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Nueva base' }).click();
  await profile(page, 'coord');
  await page.getByText('0 solicitudes encontradas', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Importar y exportar' }).click();
  await importFile(page, 'clientes.csv', 'nit;name\r\n00123;"Colegio ""El Cedro"""\r\n');
  await page.getByText('1 listas', { exact: false }).waitFor();
  await page.getByRole('button', { name: 'Confirmar carga' }).click();
  await page.getByText('1 cargadas', { exact: false }).waitFor();

  await page.getByRole('button', { name: 'Nueva solicitud' }).click();
  const form = page.locator('#create-form');
  await form.locator('select[name=nit]').selectOption('00123');
  await form.locator('select[name=channel]').selectOption('correo');
  await form.locator('select[name=category]').selectOption('pedido');
  await form.getByLabel('Descripción').fill('Esta solicitud se guarda desde un HTML local.');
  await form.getByRole('button', { name: 'Guardar radicación' }).click();
  await page.getByText(/Solicitud radicada:/).waitFor();
  const ticket = (await page.locator('#notice').textContent()).split(': ')[1];
  await page.getByRole('button', { name: ticket, exact: true }).click();
  await page.locator('#reassign-form select').selectOption('agente2');
  await page.getByLabel('Motivo').fill('Distribuir el turno.');
  await page.getByRole('button', { name: 'Reasignar solicitud' }).click();
  await page.locator('#events').getByText(/Distribuir el turno/).waitFor();
  await page.locator('#state-form select').selectOption('resuelto');
  await page.getByLabel('Respuesta de fondo').fill('Se confirmó la fecha al cliente.');
  await page.getByRole('button', { name: 'Guardar estado' }).click();
  await page.locator('#events').getByText(/Se confirmó la fecha/).waitFor();
  await page.getByRole('button', { name: 'Cerrar', exact: true }).click();

  await page.getByRole('button', { name: 'Importar y exportar' }).click();
  await page.getByLabel('Datos a importar').selectOption('pendientes');
  const headings = 'source_ref,nit,channel,category,description,order_ref,agent_id,state,received_at\n';
  await importFile(page, 'pendientes.csv', headings + 'ORIG-1,00123,llamada,pedido,Revisar pedido de la hoja,ERP-23,agente3,logistica,2025-02-13T10:00:00-05:00');
  await page.getByRole('button', { name: 'Confirmar carga' }).click();
  await page.getByText('1 cargadas', { exact: false }).waitFor();

  const downloadPromise = page.waitForEvent('download');
  await page.locator('.local-files [data-save-local]').click();
  const download = await downloadPromise;
  const saved = JSON.parse(await readFile(await download.path(), 'utf8'));
  assert.equal(saved.requests.length, 2);
  assert.equal(saved.events.length, 4);
  assert.equal(saved.requests.find(row => row.ticket === ticket).state, 'resuelto');
  assert.equal(saved.requests.find(row => row.source_ref === 'ORIG-1').received_at, '2025-02-13T15:00:00.000Z');
  assert.equal(saved.customers[0].nit, '00123');
  assert.equal(saved.customers[0].name, 'Colegio "El Cedro"');

  await page.close();
  const reopened = await context.newPage();
  reopened.on('pageerror', error => errors.push(error.message));
  await openApplication(reopened);
  await openDataFile(reopened, 'reabierto.json', saved);
  await reopened.getByText('reabierto.json', { exact: true }).waitFor();
  await profile(reopened, 'agente2');
  await reopened.getByRole('button', { name: ticket, exact: true }).click();
  await reopened.locator('#events').getByText(/Se confirmó la fecha/).waitFor();
  assert.equal(await reopened.getByRole('button', { name: 'Indicadores', exact: true }).count(), 0);
  await reopened.getByRole('button', { name: 'Cerrar', exact: true }).click();
  await reopened.locator('#filters select[name=deadline]').selectOption('vencidas');
  await reopened.getByText('1 solicitud encontrada', { exact: true }).waitFor();
  await reopened.getByText(/Vencida ·/).waitFor();
  await openDataFile(reopened, 'invalido.json', { version: 99 });
  await reopened.getByText(/El archivo debe ser una exportación/).waitFor();
  await reopened.getByRole('heading', { name: 'Bandeja de solicitudes' }).waitFor();
  await reopened.getByText('1 solicitud encontrada', { exact: true }).waitFor();

  // La exportación de la edición de servidor omitía los atributos propios de archivos locales.
  delete saved.format;
  delete saved.last_agent;
  saved.actors.forEach(actor => { delete actor.available; });
  await openDataFile(reopened, 'archivo-version-anterior.json', saved);
  await reopened.getByText('archivo-version-anterior.json', { exact: true }).waitFor();
  await profile(reopened, 'coord');
  await reopened.getByText('2 solicitudes encontradas', { exact: true }).waitFor();
  assert.deepEqual(errors, []);
  assert.deepEqual(network, []);
});
