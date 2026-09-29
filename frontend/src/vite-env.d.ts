/// <reference types="vite/client" />

/**
 * Build-time settings.
 *
 * VITE_SERVER_URL is the portal address the Android build ships with. The
 * website does not set it — it talks to whichever server served it — so it is
 * optional here.
 */
interface ImportMetaEnv {
  readonly VITE_SERVER_URL?: string;
  /** Public website address for canonical / og:url (e.g. https://example.com). Optional. */
  readonly VITE_SITE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
