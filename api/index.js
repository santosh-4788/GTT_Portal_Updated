/**
 * Vercel serverless entry point.
 *
 * Vercel runs every /api request (and /sitemap.xml) through this one
 * function. It is the same Express app the office PC runs with `npm start` -
 * compiled by `npm run build` in backend/ - minus the listening socket: with
 * VERCEL set, backend/src/server.ts skips start() and readies the database
 * (Turso) on the first request instead. See vercel.json and docs/VERCEL.md.
 */
module.exports = require('../backend/dist/src/server.js').default;
