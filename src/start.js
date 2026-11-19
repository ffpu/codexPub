import { createApp } from './app.js';
import { connect, migrate } from './db.js';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:https';

const mode = process.env.APP_MODE || 'demo';
const origin = process.env.PUBLIC_ORIGIN;
const trustProxy = process.env.TRUST_PROXY === '1' ? 1 : undefined;
const { TLS_CERT, TLS_KEY } = process.env;
if (Boolean(TLS_CERT) !== Boolean(TLS_KEY)) throw new Error('Configura TLS_CERT y TLS_KEY juntos.');
const directTLS = Boolean(TLS_CERT);
if (mode === 'pilot' && (!origin?.startsWith('https://') || (!trustProxy && !directTLS))) {
  throw new Error('Para el piloto configura PUBLIC_ORIGIN HTTPS y TLS directo o un proxy TLS de confianza.');
}
const db = connect();
try {
  await migrate(db, mode);
  const app = createApp(db, { mode, origin, trustProxy, secure: directTLS || mode === 'pilot' || origin?.startsWith('https://') });
  const listener = directTLS
    ? createServer({ cert: await readFile(TLS_CERT), key: await readFile(TLS_KEY), minVersion: 'TLSv1.3' }, app)
    : app;
  const server = listener.listen(Number(process.env.PORT || 3000), process.env.HOST || '127.0.0.1', () => {
    console.log('Aurora disponible en el puerto ' + server.address().port + ' (' + mode + ').');
  });
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => server.close(() => db.end()));
} catch (error) {
  await db.end();
  throw error;
}
