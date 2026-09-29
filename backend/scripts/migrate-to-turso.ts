/**
 * Copy the portal's data from this PC's database into Turso, for the Vercel
 * deployment.
 *
 *   1. Put the Turso address and token in backend/.env.turso:
 *        TURSO_DATABASE_URL=libsql://<your-db>.turso.io
 *        TURSO_AUTH_TOKEN=<token>
 *   2. cd backend && npx tsx scripts/migrate-to-turso.ts
 *
 * Every table is copied row for row (the Turso copy of each table is emptied
 * first, so running it again gives a fresh, identical copy), then every
 * generated invoice and uploaded template file goes into stored_files. The
 * local database is only ever READ.
 *
 * Nothing is sent anywhere but the Turso database named in .env.turso.
 */
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '..', '.env.turso'), override: true, quiet: true });

async function main() {
  if (!process.env.TURSO_DATABASE_URL) {
    console.error('TURSO_DATABASE_URL is not set. Put it and TURSO_AUTH_TOKEN in backend/.env.turso.');
    process.exit(1);
  }
  // Imported after the environment is set, so getDb() opens Turso.
  const { config } = await import('../src/config');
  const { getDb, applySchema } = await import('../src/db');
  const BetterSqlite3 = (await import('better-sqlite3')).default;

  const localFile = process.env.LOCAL_DB_FILE || config.paths.dbFile;
  if (!fs.existsSync(localFile)) throw new Error(`Local database not found: ${localFile}`);
  console.log(`From : ${localFile}`);
  console.log(`To   : ${process.env.TURSO_DATABASE_URL}`);

  const local = new BetterSqlite3(localFile, { readonly: true, fileMustExist: true });
  const remote = getDb();

  console.log('Creating tables on Turso ...');
  applySchema();
  remote.exec('PRAGMA foreign_keys = OFF');

  const tables = local
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`)
    .all() as { name: string }[];

  let total = 0;
  for (const { name } of tables) {
    const remoteCols = new Set((remote.prepare(`PRAGMA table_info("${name}")`).all() as { name: string }[]).map((c) => c.name));
    if (!remoteCols.size) { console.log(`  skip ${name} (not in schema)`); continue; }
    const cols = (local.prepare(`PRAGMA table_info("${name}")`).all() as { name: string }[])
      .map((c) => c.name).filter((c) => remoteCols.has(c));
    const rows = local.prepare(`SELECT ${cols.map((c) => `"${c}"`).join(', ')} FROM "${name}"`).raw().all() as unknown[][];
    // Paths saved on Windows use backslashes, which Linux reads as part of a
    // file name. Forward slashes work on both, so the copy carries those.
    const pathCols = cols.map((c, i) => (/^(file_path|attachment)$/.test(c) ? i : -1)).filter((i) => i >= 0);
    for (const row of rows) for (const i of pathCols) if (typeof row[i] === 'string') row[i] = (row[i] as string).split('\\').join('/');

    remote.exec(`DELETE FROM "${name}"`);
    // Many rows per statement: every statement is a network round trip.
    const perStatement = Math.max(1, Math.min(100, Math.floor(900 / Math.max(1, cols.length))));
    for (let i = 0; i < rows.length; i += perStatement) {
      const chunk = rows.slice(i, i + perStatement);
      const placeholders = chunk.map(() => `(${cols.map(() => '?').join(', ')})`).join(', ');
      remote.prepare(`INSERT INTO "${name}" (${cols.map((c) => `"${c}"`).join(', ')}) VALUES ${placeholders}`)
        .run(...chunk.flat());
    }
    const n = (remote.prepare(`SELECT COUNT(*) AS n FROM "${name}"`).get() as { n: number }).n;
    if (n !== rows.length) throw new Error(`${name}: copied ${n} of ${rows.length} rows`);
    if (rows.length) console.log(`  ${name.padEnd(30)} ${rows.length}`);
    total += rows.length;
  }
  remote.exec('PRAGMA foreign_keys = ON');
  console.log(`Rows copied: ${total}`);

  // Invoices and templates, into stored_files.
  const { storeKey } = await import('../src/services/fileStore');
  let files = 0;
  let bytes = 0;
  const walk = (dir: string) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      const key = storeKey(full);
      if (!key) continue;
      const data = fs.readFileSync(full);
      remote.prepare(
        `INSERT INTO stored_files (path, data, size, updated_at) VALUES (?, ?, ?, datetime('now'))
         ON CONFLICT(path) DO UPDATE SET data = excluded.data, size = excluded.size, updated_at = excluded.updated_at`
      ).run(key, data, data.length);
      files++;
      bytes += data.length;
    }
  };
  walk(config.paths.invoices);
  walk(config.paths.templates);
  console.log(`Files copied: ${files} (${(bytes / 1024 / 1024).toFixed(1)} MB)`);
  local.close();
  console.log('Done.');
}

main().catch((err) => {
  console.error('Migration failed:', err?.message ?? err);
  process.exit(1);
});
