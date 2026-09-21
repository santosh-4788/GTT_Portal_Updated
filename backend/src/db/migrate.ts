import { applySchema, getDb, closeDb } from './index';
import { config, ensureDirectories } from '../config';

function main() {
  ensureDirectories();
  console.log('Database file :', config.paths.dbFile);
  applySchema();

  const db = getDb();
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all() as { name: string }[];

  console.log(`Schema applied. ${tables.length} tables present:`);
  console.log('  ' + tables.map((t) => t.name).join(', '));
  closeDb();
}

main();
