import type { CapacitorConfig } from '@capacitor/cli';

/**
 * The CUSTOMER app.
 *
 * A separate Capacitor project from the staff app, in its own folder, because
 * one Capacitor project builds one Android app and these are two different
 * apps with two different audiences. A different `appId` also means both can be
 * installed on the same phone at once — which the owner will want, and which a
 * shared id would have made impossible.
 *
 * It builds from ../dist-customer, the bundle that contains only the customer
 * screens. There is no path from this app to the admin portal.
 */
const config: CapacitorConfig = {
  appId: 'com.guptatours.customer',
  appName: 'Gupta Tours & Travels',
  webDir: '../dist-customer',

  android: {
    /**
     * The office portal may be reached over a plain http LAN address as well
     * as an https tunnel. Without this, an http server is blocked as mixed
     * content and the app reports nothing useful.
     */
    allowMixedContent: true,
    webContentsDebuggingEnabled: true,
  },

  server: {
    /**
     * http rather than Capacitor's default https, for the same reason as the
     * staff app: a LAN portal has no TLS, and from an https page that is mixed
     * content. Serving the app over http makes a LAN call same-scheme and a
     * tunnel call an upgrade, and browsers allow both. localhost is a trusted
     * origin whatever the scheme, so nothing is lost.
     *
     * The API sees `http://localhost` as the Origin, so it must stay listed in
     * CORS_ORIGINS in backend/.env.
     */
    androidScheme: 'http',
  },
};

export default config;
