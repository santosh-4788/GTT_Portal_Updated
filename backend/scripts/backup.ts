/**
 * Local backup / restore for the SQLite database and generated invoices.
 *
 *   npm run backup                 -> create a backup
 *   npx tsx scripts/backup.ts list -> list existing backups
 *   npx tsx scripts/backup.ts restore <name>
 *
 * SQLite is backed up with the online backup API, so it is safe to run while the
 * server is up — no torn WAL, no locked file.
 */
import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { config, ensureDirectories } from '../src/config';

const stamp = () =>
  new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);

function copyDir(src: string, dest: string) {
  if (!fs.existsSync(src)) return 0;
  fs.mkdirSync(dest, { recursive: true });
  let count = 0;
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) count += copyDir(s, d);
    else { fs.copyFileSync(s, d); count++; }
  }
  return count;
}

async function create() {
  ensureDirectories();
  const name = `backup_${stamp()}`;
  const dir = path.join(config.paths.backups, name);
  fs.mkdirSync(dir, { recursive: true });

  // 1. database — online backup, safe while the server is running
  if (fs.existsSync(config.paths.dbFile)) {
    const db = new Database(config.paths.dbFile, { readonly: true });
    await db.backup(path.join(dir, 'gtt.db'));
    db.close();
    console.log('  database  : gtt.db');
  } else {
    console.log('  database  : (none found — nothing to back up)');
  }

  // 2. templates (working copies of the vendor invoice formats)
  const t = copyDir(config.paths.templates, path.join(dir, 'templates'));
  console.log(`  templates : ${t} file(s)`);

  // 3. generated invoices
  const i = copyDir(config.paths.invoices, path.join(dir, 'invoices'));
  console.log(`  invoices  : ${i} file(s)`);

  // 4. brand assets
  const a = copyDir(config.paths.assets, path.join(dir, 'assets'));
  console.log(`  assets    : ${a} file(s)`);

  fs.writeFileSync(
    path.join(dir, 'manifest.json'),
    JSON.stringify({
      createdAt: new Date().toISOString(),
      projectRoot: config.paths.root,
      dbFile: config.paths.dbFile,
      counts: { templates: t, invoices: i, assets: a },
    }, null, 2)
  );

  console.log(`\nBackup complete: ${dir}`);
}

function list() {
  ensureDirectories();
  const entries = fs.existsSync(config.paths.backups)
    ? fs.readdirSync(config.paths.backups).filter((d) =>
        fs.statSync(path.join(config.paths.backups, d)).isDirectory())
    : [];
  if (!entries.length) { console.log('No backups found in ' + config.paths.backups); return; }

  console.log(`Backups in ${config.paths.backups}:\n`);
  for (const e of entries.sort().reverse()) {
    const manifestPath = path.join(config.paths.backups, e, 'manifest.json');
    let info = '';
    if (fs.existsSync(manifestPath)) {
      const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      info = `  (${m.counts.invoices} invoices, ${m.counts.templates} templates)`;
    }
    console.log(`  ${e}${info}`);
  }
}

function restore(name: string) {
  const dir = path.join(config.paths.backups, name);
  if (!fs.existsSync(dir)) {
    console.error(`Backup "${name}" not found in ${config.paths.backups}`);
    process.exit(1);
  }

  // Never overwrite the live data without first parking a copy of it.
  if (fs.existsSync(config.paths.dbFile)) {
    const safety = `${config.paths.dbFile}.before-restore-${stamp()}`;
    fs.copyFileSync(config.paths.dbFile, safety);
    console.log(`Current database parked at:\n  ${safety}`);
  }

  const src = path.join(dir, 'gtt.db');
  if (fs.existsSync(src)) {
    // Remove stale WAL/SHM so SQLite does not replay them over the restored file.
    for (const suffix of ['-wal', '-shm']) {
      const f = config.paths.dbFile + suffix;
      if (fs.existsSync(f)) fs.unlinkSync(f);
    }
    fs.copyFileSync(src, config.paths.dbFile);
    console.log('  database restored');
  }

  const t = copyDir(path.join(dir, 'templates'), config.paths.templates);
  const i = copyDir(path.join(dir, 'invoices'), config.paths.invoices);
  console.log(`  templates restored: ${t} file(s)`);
  console.log(`  invoices restored : ${i} file(s)`);
  console.log('\nRestore complete. Restart the server.');
}

const [cmd, arg] = process.argv.slice(2);
if (cmd === 'list') list();
else if (cmd === 'restore') {
  if (!arg) { console.error('Usage: npx tsx scripts/backup.ts restore <backup-name>'); process.exit(1); }
  restore(arg);
} else {
  create().catch((e) => { console.error('Backup failed:', e.message); process.exit(1); });
}
