/**
 * Run every test file, in every shell.
 *
 * `node --test tests/*.test.ts` looks fine in package.json and is not:
 * whether that glob is expanded depends on which shell npm happens to launch,
 * and on Windows the answer differs between cmd, PowerShell and Git Bash. The
 * symptom is quiet and nasty — one file runs, the suite reports "all passing",
 * and the tests that would have caught the bug never executed.
 *
 * So the files are found here, by name, and handed to node explicitly.
 */
import { readdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const testsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'tests');

const files = readdirSync(testsDir)
  .filter((f) => f.endsWith('.test.ts'))
  .sort()
  .map((f) => path.join(testsDir, f));

if (files.length === 0) {
  console.error(`No *.test.ts files found in ${testsDir}`);
  process.exit(1);
}

console.log(`Running ${files.length} test file(s): ${files.map((f) => path.basename(f)).join(', ')}\n`);

const child = spawn(
  process.execPath,
  ['--test', '--import', 'tsx', ...files],
  { stdio: 'inherit', cwd: path.dirname(testsDir) }
);

child.on('exit', (code) => process.exit(code ?? 1));
