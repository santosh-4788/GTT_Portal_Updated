import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.guptatours.portal',
  appName: 'GTT Portal',
  webDir: 'dist-mobile',

  android: {
    /**
     * The office may reach the portal over a plain http LAN address as well as
     * over the https tunnel. The WebView's own origin is https, so without this
     * an http server would be blocked as mixed content and every request would
     * fail with nothing in the UI to explain why.
     *
     * The traffic this permits is the office's own portal on its own network.
     * Anything over the public internet should use the https address, which is
     * what the app ships pointing at.
     */
    allowMixedContent: true,

    /** Debug builds only — lets Chrome's device inspector attach to the app. */
    webContentsDebuggingEnabled: true,
  },

  server: {
    /**
     * The WebView serves the app's own files from http://localhost, and that
     * origin is what the API sees in the `Origin` header — so it has to be
     * listed in CORS_ORIGINS in backend/.env or every request is refused.
     *
     * `http` rather than Capacitor's default `https` on purpose. The portal on
     * the office network has no TLS, so its address is a plain http one. From
     * an https page that is "mixed content", which Android blocks by default
     * and may block regardless of the override below — the app would sit there
     * unable to reach a server that is plainly running. Serving the app over
     * http makes a LAN call same-scheme and a call to the https tunnel an
     * upgrade, and browsers allow both without argument.
     *
     * Nothing is lost by it: localhost is a trusted origin whatever the scheme,
     * so this is still a secure context.
     */
    androidScheme: 'http',
  },
};

export default config;
