/**
 * Removes the few coarse location entries that the expanded address book
 * superseded, so the suggestion list does not offer the same place twice.
 * Only untouched entries (use_count = 0) are removed.
 */
import { q, closeDb } from '../src/db';

const SUPERSEDED = [
  'Vashi, Navi Mumbai',              // now "Vashi"
  'Navi Mumbai',                     // too vague; the suburbs are listed individually
  'Dadar, Mumbai',                   // now "Dadar (West)" / "Dadar (East)"
  'Lokmanya Tilak Terminus, Mumbai', // now "Lokmanya Tilak Terminus (LTT), Kurla"
];

let removed = 0;
for (const label of SUPERSEDED) {
  const r = q.run('DELETE FROM locations WHERE label = @l AND use_count = 0', { l: label });
  if (r.changes) {
    removed += r.changes;
    console.log(`  removed: ${label}`);
  }
}

const total = q.get<{ c: number }>('SELECT COUNT(*) c FROM locations')!.c;
console.log(`\n${removed} duplicate(s) removed. ${total} addresses available for suggestions.`);
closeDb();
