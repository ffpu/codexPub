import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
const derive = promisify(scrypt);
export const sha256 = value => createHash('sha256').update(value).digest('hex');

export async function hashPassword(password) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 128) {
    throw new Error('La contraseña debe tener entre 12 y 128 caracteres.');
  }
  const salt = randomBytes(16).toString('hex');
  return salt + ':' + (await derive(password, salt, 64)).toString('hex');
}

export async function verifyPassword(password, stored) {
  if (typeof password !== 'string' || password.length > 128) return false;
  const [salt, hash] = (stored || '0'.repeat(32) + ':' + '0'.repeat(128)).split(':');
  const result = await derive(password, salt, 64);
  return timingSafeEqual(result, Buffer.from(hash, 'hex')) && Boolean(stored);
}

export async function createSession(db, id) {
  const token = randomBytes(32).toString('hex');
  await db.query("INSERT INTO sessions VALUES ($1,$2,now()+interval '12 hours')", [sha256(token), id]);
  return token;
}

export function sessionToken(req) {
  return req.headers.cookie?.match(/(?:^|;\s*)aurora_session=([a-f0-9]{64})(?:;|$)/)?.[1];
}

export async function sessionUser(db, token) {
  if (!token) return null;
  const { rows: [user] } = await db.query(`SELECT u.id,u.name,u.role FROM users u
    JOIN sessions s ON s.user_id=u.id WHERE s.token_hash=$1 AND s.expires_at>now()`, [sha256(token)]);
  return user;
}
