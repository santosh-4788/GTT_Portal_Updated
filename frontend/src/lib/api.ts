import axios from 'axios';
import { isMobileApp, resolveApiBase, NGROK_HEADERS } from './serverUrl';

export const api = axios.create({
  baseURL: '/api',
  withCredentials: true,
  timeout: 60_000,
});

const TOKEN_KEY = 'gtt_token';

export const tokenStore = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (t: string) => localStorage.setItem(TOKEN_KEY, t),
  clear: () => localStorage.removeItem(TOKEN_KEY),
};

api.interceptors.request.use((cfg) => {
  /**
   * Resolved per request, not once at import time. In the Android app the
   * server address is a setting the user can change while the app is running,
   * and a baseURL fixed at startup would keep pointing at the old address
   * until the app was force-closed.
   */
  cfg.baseURL = resolveApiBase();
  // Opt out of the free-tunnel interstitial; see NGROK_HEADERS.
  Object.assign(cfg.headers, NGROK_HEADERS);
  const t = tokenStore.get();
  if (t) cfg.headers.Authorization = `Bearer ${t}`;
  return cfg;
});

/** Handlers registered by AuthProvider so a dead session bounces to /login. */
let onUnauthorized: (() => void) | null = null;
let onPasswordChangeRequired: (() => void) | null = null;
export const registerAuthHandlers = (h: { unauthorized: () => void; passwordChange: () => void }) => {
  onUnauthorized = h.unauthorized;
  onPasswordChangeRequired = h.passwordChange;
};

api.interceptors.response.use(
  (r) => r,
  (error) => {
    const status = error?.response?.status;
    const code = error?.response?.data?.code;

    if (status === 401 && !error.config?.url?.includes('/auth/login')) {
      onUnauthorized?.();
    }
    if (status === 428 && code === 'PASSWORD_CHANGE_REQUIRED') {
      onPasswordChangeRequired?.();
    }
    return Promise.reject(error);
  }
);

/** Pull the human-readable message the API always sends back. */
export function errorMessage(err: any, fallback = 'Something went wrong. Please try again.'): string {
  if (err?.response?.data?.error) return err.response.data.error;
  if (err?.response?.data?.issues?.length) {
    return err.response.data.issues.map((i: any) => `${i.field}: ${i.message}`).join('\n');
  }
  if (err?.code === 'ECONNABORTED') return 'The request timed out. Check that the server is running.';
  if (err?.message === 'Network Error') {
    return isMobileApp()
      ? 'Cannot reach the portal. Check your internet connection, and that the server address in Settings is correct.'
      : `Cannot reach the server. Is the backend running on ${resolveApiBase()}?`;
  }
  return err?.message ?? fallback;
}

/**
 * Save an authenticated file.
 *
 * Every one of these endpoints needs the bearer token, so the file is always
 * fetched through axios rather than handed to the browser as a plain link.
 *
 * The two platforms diverge after that. A browser gets an anchor with a
 * `download` attribute. An Android WebView ignores that attribute entirely —
 * the invoice would simply never appear — so the app writes the bytes to its
 * own cache directory and hands the file to Android's share sheet, which is
 * what lets the user open it in a PDF viewer, save it to Downloads, or send it
 * on to the vendor.
 */
export async function downloadFile(url: string, filename?: string) {
  const res = await api.get(url, { responseType: 'blob' });
  const disposition = res.headers['content-disposition'] as string | undefined;
  const match = disposition?.match(/filename="?([^"]+)"?/);
  const name = filename ?? match?.[1] ?? 'download';

  if (isMobileApp()) {
    const { saveAndOpen } = await import('./nativeFile');
    await saveAndOpen(res.data as Blob, name);
    return;
  }

  const blobUrl = URL.createObjectURL(res.data);
  const a = document.createElement('a');
  a.href = blobUrl;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(blobUrl);
}
