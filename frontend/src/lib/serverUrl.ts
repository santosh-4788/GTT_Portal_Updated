/**
 * Where the API lives.
 *
 * On the website this is simply `/api` — the portal serves its own front end,
 * so a relative path always reaches the right server.
 *
 * Inside the Android app there is no such luck. The WebView's own origin is
 * `https://localhost`, which is the app itself and has no API on it, so every
 * request has to name an absolute address. That address cannot be baked in and
 * forgotten either: the office reaches the portal over a tunnel whose URL
 * changes each time it restarts on the free tier. So the app ships with a
 * default, stores an override, and offers a screen to change it — repointing
 * the app must never require rebuilding the APK.
 */

/** True only in the Android build. Set once by the mobile entry point. */
let mobileApp = false;

export function enableMobileApp(): void {
  mobileApp = true;
}

export function isMobileApp(): boolean {
  return mobileApp;
}

/** Compiled in from VITE_SERVER_URL at build time. Empty on the web build. */
const BUILT_IN = (import.meta.env.VITE_SERVER_URL as string | undefined)?.trim() ?? '';

const KEY = 'gtt_server_url';

/**
 * Tidy up what somebody typed.
 *
 * Trailing slashes and a stray `/api` are the two things people paste by
 * mistake, so both are trimmed.
 *
 * The scheme needs more care than "assume https". An address on the office
 * network is a bare IP and a port — `172.23.38.226:4100` — and that server
 * speaks plain http, so assuming https there produces an address that can
 * never connect, with nothing on screen explaining why. A tunnel address is a
 * hostname with no port and is always https. Guessing from the shape gets both
 * right; typing the scheme in full always wins over the guess.
 */
export function normalizeServerUrl(raw: string): string {
  let s = raw.trim();
  if (!s) return '';

  if (!/^https?:\/\//i.test(s)) {
    s = `${looksLocal(s) ? 'http' : 'https'}://${s}`;
  }

  s = s.replace(/\/+$/, '');
  s = s.replace(/\/api$/i, '');
  return s;
}

/** An IP address, a `host:port`, or localhost — i.e. something on the LAN. */
function looksLocal(hostPart: string): boolean {
  const host = hostPart.split('/')[0];
  if (/^localhost(:\d+)?$/i.test(host)) return true;
  if (/^\d{1,3}(\.\d{1,3}){3}(:\d+)?$/.test(host)) return true;
  // Any explicit port other than 443 is a local-style address; public tunnels
  // hand out a plain hostname on the default port.
  const port = host.match(/:(\d+)$/)?.[1];
  return !!port && port !== '443';
}

export function getServerUrl(): string {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved && saved.trim()) return saved.trim();
  } catch {
    /* private mode or storage disabled — fall through to the built-in default */
  }
  return BUILT_IN;
}

export function setServerUrl(raw: string): string {
  const url = normalizeServerUrl(raw);
  try {
    if (url) localStorage.setItem(KEY, url);
    else localStorage.removeItem(KEY);
  } catch {
    /* nothing we can do; the value still applies for this session */
  }
  return url;
}

export function hasServerUrl(): boolean {
  return !isMobileApp() || !!getServerUrl();
}

/** The absolute origin to prefix non-API URLs with, such as images. */
export function serverOrigin(): string {
  return isMobileApp() ? getServerUrl() : '';
}

/** What axios should use as its baseURL for the current request. */
export function resolveApiBase(): string {
  if (!isMobileApp()) return '/api';
  const server = getServerUrl();
  return server ? `${server}/api` : '/api';
}

/**
 * Sent on every request to the portal.
 *
 * A free ngrok tunnel puts an interstitial warning page in front of anything
 * whose User-Agent looks like a browser, which the Android WebView's does.
 * The portal is never reached at all: the reply is ngrok's own HTML with a
 * 200 on it, so the app sees a successful request whose body will not parse
 * and reports "cannot reach that address" for an address that is correct.
 * Chrome gets past the page because somebody clicks the button on it; the app
 * has no such chance, so it opts out by header instead. Harmless on a LAN
 * address, which no proxy inspects.
 */
export const NGROK_HEADERS = { 'ngrok-skip-browser-warning': 'true' } as const;

/**
 * Is the address reachable and actually this portal?
 *
 * Used by the server screen so a typo is caught there, with the URL still on
 * screen to correct, rather than surfacing later as a failed sign-in.
 */
export async function testServerUrl(raw: string): Promise<{ ok: boolean; message: string }> {
  const url = normalizeServerUrl(raw);
  if (!url) return { ok: false, message: 'Enter the portal address first.' };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    const res = await fetch(`${url}/api/health`, {
      signal: controller.signal,
      headers: NGROK_HEADERS,
    });
    if (!res.ok) return { ok: false, message: `The server answered with ${res.status}. Check the address.` };
    const body = await res.json();
    if (!body?.ok) return { ok: false, message: 'That address answered, but it is not the portal.' };
    const db = body.database === 'connected' ? '' : ' (warning: its database is missing)';
    return { ok: true, message: `Connected to ${body.service}${db}.` };
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      return { ok: false, message: 'The server did not answer within 12 seconds.' };
    }
    /**
     * The commonest cause by far is an address that is not a server at all —
     * an app name, a Wi-Fi name, a machine name. Saying only "cannot reach it"
     * sends people looking at their signal bars instead of at what they typed.
     */
    const host = url.replace(/^https?:\/\//i, '').split('/')[0];
    let hint = '';
    if (/^(com|org|net|io|in|co)\.[a-z0-9.]+$/i.test(host)) {
      // e.g. com.guptatours.portal - the app's own identifier, which is the
      // first thing to hand when somebody is looking for something to type.
      hint = ' That looks like the app\'s name rather than a web address.';
    } else if (!host.includes('.')) {
      hint = ' That does not look like a web address.';
    } else if (/^https:/i.test(url) && /:\d+$/.test(host)) {
      hint = ' If the portal is on the office network, try http:// instead of https://.';
    }
    return {
      ok: false,
      message: `Cannot reach that address.${hint} Check the address, and that the portal PC is switched on.`,
    };
  } finally {
    clearTimeout(timer);
  }
}
