/* Fonts are bundled, exactly as on the website, so the app's typography does
   not depend on the phone having a network connection or a matching font. */
import '@fontsource-variable/inter';
import '@fontsource-variable/sora';
import '@fontsource-variable/jetbrains-mono';

import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import { enableMobileApp } from '../lib/serverUrl';
import { AuthProvider } from '../lib/auth';
import { ToastProvider } from '../components/Toast';
import MobileApp from './MobileApp';
import '../index.css';
import './mobile.css';

/**
 * Must run before anything imports the API client, because it is what tells
 * that client to send requests to an absolute address instead of `/api`.
 * Inside the WebView `/api` would resolve against the app itself, where no
 * server exists, and every request would fail before it left the phone.
 */
enableMobileApp();

/**
 * HashRouter, not BrowserRouter.
 *
 * The WebView loads index.html from the packaged assets. With path routing,
 * anything that makes it re-resolve a deep URL like /admin/invoices/12 — a
 * reload, a restore from the background — asks for a file that is not in the
 * bundle and lands on a blank screen. Hash routes always resolve to index.html,
 * so the app survives both. The route paths themselves are unchanged, so every
 * link inside the shared admin screens still works.
 */
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <HashRouter>
      <ToastProvider>
        <AuthProvider>
          <MobileApp />
        </AuthProvider>
      </ToastProvider>
    </HashRouter>
  </React.StrictMode>
);
