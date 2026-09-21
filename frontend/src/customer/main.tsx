/* Fonts are bundled, as everywhere else, so the app looks the same with the
   phone offline and makes no request to a font host. */
import '@fontsource-variable/inter';
import '@fontsource-variable/sora';
import '@fontsource-variable/jetbrains-mono';

import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import { enableMobileApp } from '../lib/serverUrl';
import { CustomerAuthProvider } from '../lib/customerAuth';
import { ToastProvider } from '../components/Toast';
import CustomerApp from './CustomerApp';
import '../index.css';
import '../mobile/mobile.css';

/**
 * Must run before anything makes a request, because it is what tells the API
 * client to use an absolute address instead of `/api`. Inside the WebView
 * `/api` resolves against the app itself, where no server exists.
 */
enableMobileApp();

/**
 * Only the CUSTOMER session provider is mounted here.
 *
 * The staff provider is not, and that is the point: this app cannot hold a
 * staff session, cannot send a staff token, and has no route to a portal
 * screen. A customer's phone carries nothing that belongs to the office.
 *
 * HashRouter for the same reason as the staff app: the WebView loads
 * index.html from the packaged assets, so a deep path like /trips/GTT-... has
 * no file behind it and a reload would land on a blank screen. Hash routes
 * always resolve to index.html, and the route paths themselves are unchanged.
 */
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <HashRouter>
      <ToastProvider>
        <CustomerAuthProvider>
          <CustomerApp />
        </CustomerAuthProvider>
      </ToastProvider>
    </HashRouter>
  </React.StrictMode>
);
