/**
 * Invoices and invoice templates that outlive the server.
 *
 * On this PC they are files under data/invoices and templates/, and that is
 * all this module is: every function here is a no-op beyond the disk.
 *
 * On a serverless host (Vercel, with the database on Turso) the disk is
 * /tmp, emptied between runs. So every document the portal writes is also
 * copied into the database (stored_files), and before one is read - a
 * download, an email attachment, a template to fill - it is brought back from
 * there if this run has not got it on disk. Kept in the database rather than a
 * public file bucket on purpose: an invoice carries a customer's name,
 * address and GSTIN, and a database row can only be reached through the API's
 * own sign-in checks.
 */
import fs from 'fs';
import path from 'path';
import { config } from '../config';
import { q, usingTurso } from '../db';

/** Worth doing only where the disk does not last. */
export const fileStoreEnabled = () => usingTurso() || process.env.FILE_STORE === 'db';

/** The key a file is stored under: which folder it belongs to, and where in it. */
export function storeKey(abs: string): string | null {
  const full = path.resolve(abs);
  for (const [name, dir] of [['invoices', config.paths.invoices], ['templates', config.paths.templates]] as const) {
    const root = path.resolve(dir);
    if (full === root || !full.startsWith(root + path.sep)) continue;
    // Always forward slashes, whichever system wrote the path (a Windows
    // backslash is an ordinary character in a Linux file name).
    return `${name}/${path.relative(root, full).split(path.sep).join('/').split('\\').join('/')}`;
  }
  return null;
}

/** Copy a file that has just been written into the database. */
export function persistFile(abs: string): void {
  if (!fileStoreEnabled()) return;
  const key = storeKey(abs);
  if (!key || !fs.existsSync(abs)) return;
  const data = fs.readFileSync(abs);
  q.run(
    `INSERT INTO stored_files (path, data, size, updated_at) VALUES (@key, @data, @size, datetime('now'))
     ON CONFLICT(path) DO UPDATE SET data = excluded.data, size = excluded.size, updated_at = excluded.updated_at`,
    { key, data, size: data.length }
  );
}

/**
 * Make sure a file is on this run's disk, bringing it back from the database
 * if need be. True when it is there to read.
 */
export function ensureLocalFile(abs: string): boolean {
  if (fs.existsSync(abs)) return true;
  if (!fileStoreEnabled()) return false;
  const key = storeKey(abs);
  if (!key) return false;
  const row = q.get<{ data: Buffer | Uint8Array | ArrayBuffer }>('SELECT data FROM stored_files WHERE path = @key', { key });
  if (!row?.data) return false;
  const buf = Buffer.isBuffer(row.data) ? row.data : Buffer.from(row.data as ArrayBuffer);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, buf);
  return true;
}

/** Is the file anywhere - on disk or in the database - without fetching it? */
export function fileExistsAnywhere(abs: string): boolean {
  if (fs.existsSync(abs)) return true;
  if (!fileStoreEnabled()) return false;
  const key = storeKey(abs);
  return !!key && !!q.get('SELECT 1 FROM stored_files WHERE path = @key', { key });
}

export function removeStoredFile(abs: string): void {
  if (!fileStoreEnabled()) return;
  const key = storeKey(abs);
  if (key) q.run('DELETE FROM stored_files WHERE path = @key', { key });
}
