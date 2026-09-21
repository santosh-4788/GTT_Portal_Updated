/**
 * Rate limiters, with one thing added.
 *
 * Every public entry point is rate limited per address, and that is a defence
 * against the internet rather than against the test suite: the suite drives the
 * whole journey through a single loopback address, so an enquiry cap of ten an
 * hour meant the eleventh test that raised an enquiry got a 429 and the person
 * who wrote it went looking for a bug in their feature. Worse, it fails in a
 * way that looks like a real failure.
 *
 * So the limiters step aside under NODE_ENV=test and behave exactly as before
 * everywhere else. Nothing else about them changes, and the limits themselves
 * are still the numbers each route asks for.
 */
import rateLimit, { type Options } from 'express-rate-limit';
import { config } from '../config';

export function limiter(options: Partial<Options>) {
  return rateLimit({
    standardHeaders: true,
    legacyHeaders: false,
    skip: () => config.nodeEnv === 'test',
    ...options,
  });
}
