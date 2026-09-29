import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import path from 'path';
import fs from 'fs';
import { config, ensureDirectories } from './config';
import { getDb, applySchema, usingTurso } from './db';

import authRoutes from './routes/auth';
import dashboardRoutes from './routes/dashboard';
import vendorRoutes from './routes/vendors';
import rateCardRoutes from './routes/rateCards';
import outstationFareRoutes from './routes/outstationFares';
import chatRoutes from './routes/chats';
import { ensureOutstationFares } from './services/outstationFares';
import bookingRoutes from './routes/bookings';
import billingRoutes from './routes/billing';
import invoiceRoutes from './routes/invoices';
import paymentRoutes from './routes/payments';
import reportRoutes from './routes/reports';
import settingsRoutes from './routes/settings';
import templateRoutes from './routes/templates';
import userRoutes from './routes/users';
import auditRoutes from './routes/audit';
import publicRoutes from './routes/public';
import geoRoutes from './routes/geo';
import tripRoutes from './routes/trips';
import customerRoutes from './routes/customer';
import seoRoutes from './routes/seo';
import feedbackRoutes from './routes/feedback';
import chatbotRoutes from './routes/chatbot';
import { ensureChatbotKnowledge } from './services/chatbotKnowledge';

const app = express();

/*
 * On Vercel there is no start(): each cold start of the function imports this
 * file and hands requests straight to `app`. The database is made ready on
 * the first request instead - once per instance - so a Turso connection is
 * only opened when there is something to answer.
 */
if (process.env.VERCEL) {
  app.use((_req, _res, next) => {
    try { initDatabase(); next(); } catch (err) { next(err); }
  });
}

app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use(
  helmet({
    // The SPA is served from the same origin in production; relax CSP for the dev proxy.
    contentSecurityPolicy: config.nodeEnv === 'production' ? undefined : false,
    crossOriginResourcePolicy: { policy: 'same-site' },
  })
);
/**
 * CORS.
 *
 * Two rules matter here:
 *
 * 1. The portal serves its own website, so the browser's Origin is this very
 *    server (http://localhost:4100, or a LAN address). That must always be
 *    allowed, or the page's own scripts and API calls are blocked. Comparing
 *    against the request's Host covers every address the server is reached on
 *    without having to list them.
 *
 * 2. A disallowed origin must NOT throw. Throwing turns into a 500 for a
 *    request that should simply come back without CORS headers.
 */
const ownOrigins = new Set([
  `http://localhost:${config.port}`,
  `http://127.0.0.1:${config.port}`,
]);

app.use(
  cors((req, done) => {
    const origin = req.headers.origin;

    // Non-browser callers (curl, the .bat scripts, server-to-server) send no Origin.
    if (!origin) return done(null, { origin: true, credentials: true });

    const host = req.headers.host;
    const isSameOrigin = !!host && (origin === `http://${host}` || origin === `https://${host}`);

    if (isSameOrigin || ownOrigins.has(origin) || config.corsOrigins.includes(origin)) {
      return done(null, { origin: true, credentials: true });
    }

    if (config.nodeEnv !== 'test') {
      console.warn(`[cors] blocked origin: ${origin} (add it to CORS_ORIGINS in backend\\.env to allow)`);
    }
    done(null, { origin: false });
  })
);
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(cookieParser());

// Photographs that are swapped by hand under the same filenames: the fleet, and
// the service cards. A long cache leaves visitors looking at last month's cars
// for a week — which is exactly what happened the first time these were
// replaced. Revalidate instead: an unchanged photo costs one 304 and a few
// bytes, and a new one shows up on the next refresh, which is what the README
// in each of those folders promises.
for (const bucket of ['fleet', 'needs']) {
  app.use(
    `/assets/${bucket}`,
    express.static(path.join(config.paths.assets, bucket), {
      maxAge: 0,
      etag: true,
      lastModified: true,
    })
  );
}

// Brand assets (logo, letterhead) for both the website and generated PDFs.
// These genuinely never change under the same name, so they keep the long cache.
app.use('/assets', express.static(config.paths.assets, { maxAge: '7d' }));

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'Gupta Tours & Travels Portal API',
    version: '1.0.0',
    database: usingTurso() ? 'turso' : fs.existsSync(config.paths.dbFile) ? 'connected' : 'missing',
    time: new Date().toISOString(),
  });
});

app.use('/api/public', publicRoutes);
app.use('/api/geo', geoRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/vendors', vendorRoutes);
app.use('/api/rates', rateCardRoutes);
app.use('/api/outstation-fares', outstationFareRoutes);
app.use('/api/chats', chatRoutes);
app.use('/api/bookings', bookingRoutes);
app.use('/api/trips', tripRoutes);
app.use('/api/feedback', feedbackRoutes);
app.use('/api/chatbot', chatbotRoutes);
app.use('/api/customer', customerRoutes);
app.use('/api/billing', billingRoutes);
app.use('/api/invoices', invoiceRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/templates', templateRoutes);
app.use('/api/users', userRoutes);
app.use('/api/audit', auditRoutes);

// --- serve the built SPA in production ------------------------------------
// Resolved at request time, not at import time, so building the frontend while
// the server is already running starts working without a restart.
const spaDir = path.join(config.paths.root, 'frontend', 'dist');
const spaIndex = path.join(spaDir, 'index.html');

// robots.txt (with an absolute Sitemap line) and sitemap.xml, ahead of the
// static copy of robots.txt in dist and of the SPA catch-all below.
app.use(seoRoutes);

app.use(express.static(spaDir, { fallthrough: true }));

// A missing file under /assets is a missing file, not a route. Without this the
// SPA catch-all below answers image requests with index.html, so the browser
// reports a decode error rather than a plain 404 and every missing fleet photo
// costs a full page download.
app.use('/assets', (_req, res) => res.status(404).type('txt').send('Not found'));

app.get(/^(?!\/api).*/, (_req, res) => {
  if (fs.existsSync(spaIndex)) return res.sendFile(spaIndex);

  // Without this the visitor gets Express's bare "Cannot GET /", which says
  // nothing about the actual problem.
  res.status(503).type('html').send(`<!doctype html>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Website not built yet</title>
<style>
  body{font:16px/1.6 "Segoe UI",system-ui,sans-serif;background:#0D161E;color:#E9EFF3;
       margin:0;display:grid;place-items:center;min-height:100vh;padding:24px}
  .card{max-width:34rem;background:#14212C;border:1px solid #24384A;border-radius:8px;padding:32px}
  h1{margin:0 0 12px;font-size:1.35rem;color:#52BCE8}
  p{margin:0 0 14px;color:#A9BECC}
  code{background:#0A1219;border:1px solid #24384A;border-radius:4px;padding:2px 6px;
       font-family:Consolas,monospace;font-size:.9em;color:#E3C662}
  pre{background:#0A1219;border:1px solid #24384A;border-radius:6px;padding:14px;
      overflow-x:auto;font-family:Consolas,monospace;font-size:.85rem;color:#E9EFF3;margin:0 0 14px}
  .ok{color:#6FCFA1}
</style>
<div class="card">
  <h1>The website has not been built yet</h1>
  <p>The API is running correctly &mdash; <span class="ok">it answered this request</span> &mdash;
     but the public website files are missing from <code>frontend\\dist</code>.</p>
  <p>Build them once, then reload this page:</p>
  <pre>cd ${config.paths.root}\\frontend
npm install
npm run build</pre>
  <p>No restart is needed. Reload this page after the build finishes.</p>
</div>`);
});

/**
 * Nothing matched under /api.
 *
 * Nine times out of ten during development this is not a wrong URL — it is a
 * server running an older build than the website calling it. When that is the
 * case, say so: the message goes straight to the customer-facing form, and
 * "that endpoint does not exist" sent somebody looking through route files that
 * were already correct.
 */
app.use('/api', (req, res) => {
  const stale = buildProblem || runningOlderThanBuild();
  res.status(404).json({
    error: stale
      ? `The API has no "${req.method} ${req.originalUrl}" on the build it is running. ${stale}`
      : 'That API endpoint does not exist.',
    ...(stale ? { code: 'STALE_BUILD' } : {}),
  });
});

// --- error handler: friendly messages, never a stack trace ----------------
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const status = err.status ?? err.statusCode ?? 500;

  if (err?.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({
      error: `That file is too large. The maximum upload size is ${Math.round(config.upload.maxBytes / 1024 / 1024)} MB.`,
    });
  }
  if (err?.code === 'SQLITE_CONSTRAINT_UNIQUE') {
    return res.status(409).json({ error: 'That record already exists. Check for a duplicate entry.' });
  }
  if (err?.code === 'SQLITE_CONSTRAINT_FOREIGNKEY') {
    return res.status(409).json({ error: 'This record is linked to other data and cannot be changed that way.' });
  }

  if (status >= 500) {
    console.error('[error]', err?.message, '\n', err?.stack);
    return res.status(500).json({
      error: 'Something went wrong on the server. The problem has been logged — please try again.',
    });
  }
  res.status(status).json({ error: err.message ?? 'Request could not be completed.' });
});

// --- start -----------------------------------------------------------------
/**
 * The listening socket.
 *
 * Exported so the test suite can close it. Without this the only way to end a
 * test process was `process.exit()`, which races the test reporter: whichever
 * file exits while the runner is still reading its output loses its results,
 * and the suite then reports a smaller number of passing tests than it ran.
 */
export let httpServer: ReturnType<typeof app.listen> | null = null;

/**
 * Is the running build older than the source it was compiled from?
 *
 * `npm start` runs `dist/src/server.js`, and Node reads that file once at
 * startup. So a server left running while somebody edits and recompiles the API
 * keeps serving the OLD code indefinitely — recompiling changes the files on
 * disk and nothing else. The symptom is baffling from the outside: the website
 * asks for an endpoint that plainly exists in the source, and gets back "That
 * API endpoint does not exist".
 *
 * Checked once, at startup, and reused by the 404 handler so the error the
 * browser sees names the real cause instead of sending somebody hunting through
 * route files that are already correct.
 *
 * Returns '' when everything is in step.
 */
function detectStaleBuild(): string {
  const here = __filename;
  if (!here.includes(`${path.sep}dist${path.sep}`)) return '';   // running from source

  const srcDir = path.join(config.paths.root, 'backend', 'src');
  if (!fs.existsSync(srcDir)) return '';                          // source not shipped

  let newest = 0;
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.ts')) {
        newest = Math.max(newest, fs.statSync(full).mtimeMs);
      }
    }
  };

  try {
    walk(srcDir);
    const built = fs.statSync(here).mtimeMs;
    if (newest <= built + 1000) return '';
    const days = Math.floor((newest - built) / 86_400_000);
    return (
      `This server is running a build from ${new Date(built).toLocaleString('en-IN')}, ` +
      `but backend\\src was last changed ${new Date(newest).toLocaleString('en-IN')}` +
      `${days >= 1 ? ` — ${days} day${days === 1 ? '' : 's'} newer` : ''}. ` +
      `Run "cd backend && npm run build" and RESTART this server.`
    );
  } catch {
    return '';   // never worth failing a start over
  }
}

/**
 * Also true when the process simply started before the current build — the
 * files on disk are fine, but this process read the previous ones.
 */
function runningOlderThanBuild(): string {
  const here = __filename;
  if (!here.includes(`${path.sep}dist${path.sep}`)) return '';
  try {
    const built = fs.statSync(here).mtimeMs;
    const startedAt = Date.now() - process.uptime() * 1000;
    if (startedAt >= built) return '';
    return (
      `This server started at ${new Date(startedAt).toLocaleString('en-IN')}, before the current ` +
      `build was compiled at ${new Date(built).toLocaleString('en-IN')}. It is still running the ` +
      `older code that was loaded into memory at startup — RESTART it to pick the new build up.`
    );
  } catch {
    return '';
  }
}

/** Worked out once at boot; the 404 handler reads it rather than re-checking. */
let buildProblem = '';

let databaseReady = false;

/** Schema, additive migrations and the seeded masters. Idempotent; once per process. */
function initDatabase() {
  if (databaseReady) return;
  if (!usingTurso() && !fs.existsSync(config.paths.dbFile)) {
    console.log('No database found — creating it from database/schema.sql ...');
    applySchema();
    ensureOutstationFares();
    ensureChatbotKnowledge();
    console.log('Database created. Run "npm run seed" to load the admin user and settings.');
  } else {
    getDb();          // opens + sets pragmas
    applySchema();    // idempotent; picks up any new tables
    ensureOutstationFares();
    ensureChatbotKnowledge();
  }
  databaseReady = true;
}

function start() {
  ensureDirectories();

  buildProblem = detectStaleBuild() || runningOlderThanBuild();
  if (buildProblem) {
    console.warn('');
    console.warn('  ! ' + buildProblem);
    console.warn('');
  }

  initDatabase();

  const server = app.listen(config.port, () => {
    httpServer = server;
    const spaBuilt = fs.existsSync(path.join(spaDir, 'index.html'));
    console.log('');
    // Plain ASCII only: the Windows console renders an em dash as mojibake.
    console.log('  Gupta Tours & Travels - Portal');
    console.log('  ------------------------------------------------------------');
    console.log(`  Open       : http://localhost:${config.port}`);
    console.log(`  API health : http://localhost:${config.port}/api/health`);
    console.log(`  Database   : ${config.paths.dbFile}`);
    console.log(`  Invoices   : ${config.paths.invoices}`);
    console.log(`  Templates  : ${config.paths.templates}`);
    if (!spaBuilt) {
      console.log('');
      console.log('  ! The website is not built yet - only the API will respond.');
      console.log('    Run:  cd ..\\frontend  &&  npm run build');
    }
    console.log('');
  });

  // A port clash is the single most likely startup failure on a machine that
  // already runs other local apps, so name the problem instead of dumping a stack.
  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.error('');
      console.error(`  Port ${config.port} is already being used by another application.`);
      console.error('');
      console.error('  Pick a different port by adding this line to backend\\.env :');
      console.error(`      PORT=${config.port + 1}`);
      console.error('');
      console.error('  To see what is holding the port, run in PowerShell:');
      console.error(`      Get-NetTCPConnection -LocalPort ${config.port} -State Listen`);
      console.error('');
      process.exit(1);
    }
    if (err.code === 'EACCES') {
      console.error(`\n  Permission denied binding to port ${config.port}. Choose a port above 1024.\n`);
      process.exit(1);
    }
    throw err;
  });
}

// A serverless host calls `app` itself; everywhere else the portal listens.
if (!process.env.VERCEL) start();

export default app;
