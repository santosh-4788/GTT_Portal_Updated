import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';

/**
 * Load backend/.env before anything reads process.env.
 *
 * Without this the .env file was documented but never actually read, so every
 * setting silently fell back to its built-in default — including the shipped
 * JWT secret. `override: false` keeps real environment variables (and the ones
 * the test suite sets before importing this module) ahead of the file.
 */
for (const candidate of [
  path.resolve(__dirname, '..', '.env'),        // running from backend/src (tsx)
  path.resolve(__dirname, '..', '..', '.env'),  // running from backend/dist/src (compiled)
  path.resolve(process.cwd(), '.env'),          // whatever directory the command was run in
]) {
  if (fs.existsSync(candidate)) {
    dotenv.config({ path: candidate, override: false, quiet: true });
    break;
  }
}

/**
 * Project root = E:\Portal\GuptaToursAndTravels.
 *
 * This must resolve identically whether we are running from `backend/src` (tsx)
 * or `backend/dist/src` (compiled), so walk up until we find the folder that
 * actually holds `database/schema.sql` rather than counting directory levels.
 */
function findProjectRoot(): string {
  const hasSchemaFile = (dir: string) => {
    const p = path.join(dir, 'database', 'schema.sql');
    // Must be a FILE — an empty directory of the same name would otherwise pass.
    try { return fs.statSync(p).isFile(); } catch { return false; }
  };

  let dir = __dirname;
  for (let i = 0; i < 6; i++) {
    if (hasSchemaFile(dir)) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // Fall back to the layout we ship with: <root>/backend/src or <root>/backend/dist/src
  return path.resolve(__dirname, __dirname.includes(`${path.sep}dist${path.sep}`) ? '../../..' : '../..');
}

export const PROJECT_ROOT = findProjectRoot();

const env = (k: string, fallback: string) => process.env[k] ?? fallback;

export const config = {
  // 4000, 4200 and 5173 are already used by other applications on this machine,
  // so the portal defaults to 4100. Override with PORT in .env if needed.
  port: Number(env('PORT', '4100')),
  nodeEnv: env('NODE_ENV', 'development'),

  jwtSecret: env('JWT_SECRET', 'gtt-dev-secret-change-me-in-production'),
  jwtExpiresIn: env('JWT_EXPIRES_IN', '8h'),
  /** Idle session timeout in minutes */
  sessionTimeoutMinutes: Number(env('SESSION_TIMEOUT_MINUTES', '60')),

  corsOrigins: env('CORS_ORIGINS', 'http://localhost:5273,http://127.0.0.1:5273')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  paths: {
    root: PROJECT_ROOT,
    database: path.join(PROJECT_ROOT, 'database'),
    dbFile: env('DB_FILE', path.join(PROJECT_ROOT, 'database', 'gtt.db')),
    schema: path.join(PROJECT_ROOT, 'database', 'schema.sql'),
    templates: path.join(PROJECT_ROOT, 'templates'),
    uploads: path.join(PROJECT_ROOT, 'uploads'),
    invoices: path.join(PROJECT_ROOT, 'data', 'invoices'),
    backups: path.join(PROJECT_ROOT, 'data', 'backups'),
    assets: path.join(PROJECT_ROOT, 'assets'),
    logs: path.join(PROJECT_ROOT, 'data', 'logs'),
  },

  /** Read-only reference folder. NEVER written to. */
  invoiceFormatSource: env('INVOICE_FORMAT_SOURCE', 'E:\\Portal\\InvoiceFormat'),

  upload: {
    maxBytes: Number(env('MAX_UPLOAD_BYTES', String(15 * 1024 * 1024))),
    allowedExtensions: ['.xlsx', '.xls', '.xlsm', '.docx', '.doc', '.pdf', '.csv'],
  },

  seedAdmin: {
    email: env('SEED_ADMIN_EMAIL', 'Admin@gmail.com'),
    password: env('SEED_ADMIN_PASSWORD', 'Pass@123'),
    fullName: env('SEED_ADMIN_NAME', 'Vinay Gupta'),
  },
};

/**
 * Create every runtime directory up front so nothing fails mid-request.
 * Only genuine directories are listed here — `dbFile` and `schema` are file
 * paths and must never be passed to mkdir.
 */
export function ensureDirectories(): void {
  const dirs = [
    config.paths.database,
    config.paths.templates,
    config.paths.uploads,
    config.paths.invoices,
    config.paths.backups,
    config.paths.assets,
    config.paths.logs,
    path.dirname(config.paths.dbFile),
  ];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }
}
