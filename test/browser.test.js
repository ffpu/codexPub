import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { accountIds, fixture, seedVolume, testPassword } from './fixture.js';

async function signIn(page, url, id, initial = '0 solicitudes encontradas') {
  await page.goto(url);
  await page.getByLabel('Usuario').fill(id);
  await page.getByLabel('Contraseña').fill(testPassword);
  await page.getByRole('button', { name: 'Entrar a la bandeja' }).click();
  await page.getByText(initial, { exact: true }).waitFor();
}

test('dos sesiones de navegador comparten radicación, conflicto, reasignación y resolución', async t => {
  const { url } = await fixture(t);
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
    args: ['--disable-dev-shm-usage']
  });
  t.after(() => browser.close());
  const agentContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const coordContext = await browser.newContext({ viewport: { width: 1440, height: 920 } });
  const agent = await agentContext.newPage();
  const coord = await coordContext.newPage();
  const errors = [];
  for (const page of [coord, agent]) page.on('pageerror', error => errors.push(error.message));
  await Promise.all([signIn(agent, url, 'agente1'), signIn(coord, url, 'coord')]);
  assert.equal(await agent.getByRole('button', { name: 'Importar y exportar' }).count(), 0);
  await agent.getByRole('button', { name: 'Nueva solicitud' }).last().click();
  const form = agent.locator('#create-form');
  await form.locator('select[name=nit]').selectOption('001234');
  await form.locator('select[name=channel]').selectOption('correo');
  await form.locator('select[name=category]').selectOption('pedido');
  await form.getByLabel('Descripción').fill('Solicitud registrada en el navegador del agente.');
  await form.getByRole('button', { name: 'Guardar radicación' }).click();
  await agent.getByText('Solicitud radicada: AUR-202611-0001').waitFor();
  await coord.getByRole('button', { name: /Actualizar/ }).click();
  await Promise.all([agent, coord].map(page => page.getByRole('button', { name: 'AUR-202611-0001', exact: true }).click()));
  await agent.locator('#state-form select').selectOption('resuelto');
  await agent.getByLabel('Respuesta de fondo').fill('Borrador conservado al actualizar la versión.');
  await coord.locator('#state-form select').selectOption('proceso');
  await coord.getByRole('button', { name: 'Guardar estado' }).click();
  await coord.locator('#events').getByText('Cambio de estado').waitFor();
  await agent.getByRole('button', { name: 'Guardar estado' }).click();
  await agent.getByText('El caso cambió en otra sesión.', { exact: false }).waitFor();
  await agent.getByRole('button', { name: 'Ver versión vigente' }).click();
  await agent.locator('#detail-meta').getByText('En proceso', { exact: true }).waitFor();
  assert.equal(await agent.getByLabel('Respuesta de fondo').inputValue(), 'Borrador conservado al actualizar la versión.');
  await coord.locator('#reassign-form select').selectOption('agente2');
  await coord.getByLabel('Motivo').fill('Cambio de turno');
  await coord.getByRole('button', { name: 'Reasignar solicitud' }).click();
  await coord.locator('#events').getByText(/Cambio de turno/).waitFor();
  await coord.locator('#state-form select').selectOption('resuelto');
  await coord.getByLabel('Respuesta de fondo').fill('Se informó al cliente de la entrega.');
  await coord.getByRole('button', { name: 'Guardar estado' }).click();
  await coord.locator('#events').getByText(/Se informó al cliente/).waitFor();
  await coord.getByRole('button', { name: 'Cerrar', exact: true }).click();
  await coord.getByRole('button', { name: 'Indicadores' }).click();
  await coord.getByLabel('Desde').fill('2026-11-19');
  await coord.getByLabel('Hasta').fill('2026-11-19');
  await coord.getByRole('button', { name: 'Consultar' }).click();
  await coord.getByText('1 de 1 resueltas dentro de 48 horas.').waitFor();
  assert.deepEqual(errors, []);
});

test('cinco sesiones de navegador consultan y buscan en paralelo', async t => {
  const { db, url } = await fixture(t);
  await seedVolume(db);
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
    args: ['--disable-dev-shm-usage']
  });
  t.after(() => browser.close());
  const pages = await Promise.all(accountIds.map(() => browser.newPage()));
  await Promise.all(pages.map((page, index) => signIn(page, url, accountIds[index], '1200 solicitudes encontradas')));
  const measured = await Promise.all(pages.map(async page => {
    const from = performance.now();
    await Promise.all([
      page.waitForResponse(response => response.url().includes('/api/requests?') && response.ok()),
      page.getByRole('button', { name: /Actualizar/ }).click()
    ]);
    await page.locator('#requests tr').last().waitFor();
    const loadMs = performance.now() - from;
    const searchStart = performance.now();
    await page.getByRole('searchbox', { name: 'Buscar solicitudes' }).fill('AUR-202611-1200');
    await page.getByText('1 solicitud encontrada', { exact: true }).waitFor();
    assert.equal(await page.locator('#requests tr').count(), 1);
    return { loadMs, searchMs: performance.now() - searchStart };
  }));
  const worstLoad = Math.round(Math.max(...measured.map(result => result.loadMs)));
  const worstSearch = Math.round(Math.max(...measured.map(result => result.searchMs)));
  t.diagnostic(`Cinco sesiones en Chromium. Carga máxima ${worstLoad} ms, búsqueda máxima ${worstSearch} ms`);
  assert.ok(worstLoad < 1500 && worstSearch < 1500);
});

test('el coordinador ensaya y confirma una importación y descarga el JSON', async t => {
  const { url } = await fixture(t);
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
    args: ['--disable-dev-shm-usage']
  });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await signIn(page, url, 'coord');
  await page.getByRole('button', { name: 'Importar y exportar' }).click();
  await page.locator('input[type=file]').setInputFiles({
    name: 'clientes.csv', mimeType: 'text/csv', buffer: Buffer.from('nit,name\n00242,Colegio Nuevo')
  });
  await page.getByRole('button', { name: 'Ensayar importación' }).click();
  await page.getByText(/1 listas/).waitFor();
  await page.getByRole('button', { name: 'Confirmar carga' }).click();
  await page.getByText(/1 cargadas/).waitFor();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Exportar JSON' }).click();
  const download = await downloadPromise;
  assert.equal(download.suggestedFilename(), 'aurora-datos.json');
});
