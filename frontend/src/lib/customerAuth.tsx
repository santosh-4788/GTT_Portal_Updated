/**
 * The customer's session on the public website.
 *
 * Kept entirely separate from `lib/auth.tsx`, which is the staff session for the
 * admin portal. Two contexts, two tokens, two storage keys — a customer signing
 * in on the website must never touch a staff session that happens to be open in
 * the same browser, and vice versa.
 *
 * The token is stored in localStorage as well as in the httpOnly cookie the API
 * sets. The cookie is what actually protects the session; the copy in storage is
 * only so the axios interceptor can send a bearer header, which is what keeps
 * this working when the site is opened from a different origin to the API (the
 * dev server, or an ngrok tunnel).
 */
import {
  createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode,
} from 'react';
import axios from 'axios';
import { errorMessage } from './api';

export interface CustomerUser {
  id: number;
  email: string;
  fullName: string;
  mobile: string;
  company: string;
  gstin: string;
  address: string;
  pictureUrl: string;
  hasPassword: boolean;
}

const TOKEN_KEY = 'gtt_customer_token';

export const customerToken = {
  get: () => {
    try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
  },
  set: (t: string) => {
    try { localStorage.setItem(TOKEN_KEY, t); } catch { /* private browsing */ }
  },
  clear: () => {
    try { localStorage.removeItem(TOKEN_KEY); } catch { /* private browsing */ }
  },
};

/**
 * A second axios instance.
 *
 * The shared `api` client attaches the STAFF token to every request, which would
 * be sent alongside the customer's own and confuse the server about who is
 * asking. This one carries only the customer's.
 */
export const customerApi = axios.create({
  baseURL: '/api/customer',
  withCredentials: true,
  timeout: 30_000,
});

customerApi.interceptors.request.use((cfg) => {
  const t = customerToken.get();
  if (t) cfg.headers.Authorization = `Bearer ${t}`;
  return cfg;
});

interface Ctx {
  user: CustomerUser | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<CustomerUser>;
  signUp: (input: {
    fullName: string; email: string; mobile: string; password: string; confirmPassword: string;
  }) => Promise<{ user: CustomerUser; linkedTrips: number; message: string }>;
  signInWithGoogle: (credential: string) => Promise<CustomerUser>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
  updateProfile: (input: Partial<CustomerUser>) => Promise<void>;
}

const CustomerCtx = createContext<Ctx>({
  user: null,
  loading: true,
  signIn: async () => { throw new Error('not ready'); },
  signUp: async () => { throw new Error('not ready'); },
  signInWithGoogle: async () => { throw new Error('not ready'); },
  signOut: async () => {},
  refresh: async () => {},
  updateProfile: async () => {},
});

export const useCustomerAuth = () => useContext(CustomerCtx);

export function CustomerAuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<CustomerUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    // The cookie alone is enough when the site and API share an origin, so this
    // asks the server even with no token in storage — but only once, and a
    // failure simply means "not signed in".
    try {
      const { data } = await customerApi.get('/auth/session');
      if (!data.user) customerToken.clear();
      setUser(data.user ?? null);
    } catch {
      customerToken.clear();
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const value = useMemo<Ctx>(() => ({
    user,
    loading,

    async signIn(email, password) {
      try {
        const { data } = await customerApi.post('/auth/login', { email, password });
        if (data.token) customerToken.set(data.token);
        setUser(data.user);
        return data.user as CustomerUser;
      } catch (err) {
        throw new Error(errorMessage(err, 'We could not sign you in just now.'));
      }
    },

    async signUp(input) {
      try {
        const { data } = await customerApi.post('/auth/register', input);
        if (data.token) customerToken.set(data.token);
        setUser(data.user);
        return { user: data.user, linkedTrips: data.linkedTrips ?? 0, message: data.message ?? '' };
      } catch (err) {
        throw new Error(errorMessage(err, 'We could not create your account just now.'));
      }
    },

    async signInWithGoogle(credential) {
      try {
        const { data } = await customerApi.post('/auth/google', { credential });
        if (data.token) customerToken.set(data.token);
        setUser(data.user);
        return data.user as CustomerUser;
      } catch (err) {
        throw new Error(errorMessage(err, 'Google could not sign you in just now.'));
      }
    },

    async signOut() {
      try { await customerApi.post('/auth/logout'); } catch { /* the session may already be gone */ }
      customerToken.clear();
      setUser(null);
    },

    refresh,

    async updateProfile(input) {
      const { data } = await customerApi.put('/auth/me', {
        fullName: input.fullName ?? user?.fullName ?? '',
        mobile: input.mobile ?? user?.mobile ?? '',
        company: input.company ?? user?.company ?? '',
        gstin: input.gstin ?? user?.gstin ?? '',
        address: input.address ?? user?.address ?? '',
      });
      setUser(data.user);
    },
  }), [user, loading, refresh]);

  return <CustomerCtx.Provider value={value}>{children}</CustomerCtx.Provider>;
}

/* ==========================================================================
   Google Identity Services
   ==========================================================================
   Loaded from Google's own CDN, only when a client ID is configured, and only
   on the screens that show the button. It is free and needs no package.
   ========================================================================== */

declare global {
  interface Window { google?: any }
}

let scriptPromise: Promise<void> | null = null;

export function loadGoogleScript(): Promise<void> {
  if (window.google?.accounts?.id) return Promise.resolve();
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise<void>((resolve, reject) => {
    const el = document.createElement('script');
    el.src = 'https://accounts.google.com/gsi/client';
    el.async = true;
    el.defer = true;
    el.onload = () => resolve();
    el.onerror = () => {
      // Offline, or the script is blocked. The password form still works, so
      // this is a missing button rather than a broken page.
      scriptPromise = null;
      reject(new Error('Google Sign-In could not be loaded.'));
    };
    document.head.appendChild(el);
  });
  return scriptPromise;
}

/** Ask the API whether Google sign-in is switched on, and with which client ID. */
export async function googleConfig(): Promise<{ enabled: boolean; clientId: string }> {
  try {
    const { data } = await customerApi.get('/auth/google/config');
    return { enabled: !!data.enabled, clientId: data.clientId ?? '' };
  } catch {
    return { enabled: false, clientId: '' };
  }
}
