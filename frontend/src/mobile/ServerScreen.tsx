import { useState } from 'react';
import { getServerUrl, setServerUrl, testServerUrl, normalizeServerUrl } from '../lib/serverUrl';
import { Spinner } from '../components/ui';
import { IconCheck, IconWarning } from '../components/icons';

/**
 * The portal address.
 *
 * Reachable before sign-in as well as from the More menu, because the single
 * most likely reason sign-in fails is that this is wrong or the tunnel has
 * restarted on a new URL — and at that point the user is looking at a login
 * screen with no way to fix it.
 *
 * Saving always tests first. A wrong address that is saved silently shows up
 * later as "could not sign in", which sends people hunting for a password
 * problem that does not exist.
 */
export function ServerForm({ onSaved, submitLabel = 'Save address' }: {
  onSaved?: (url: string) => void;
  submitLabel?: string;
}) {
  const [value, setValue] = useState(getServerUrl());
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const check = async (thenSave: boolean) => {
    setBusy(true);
    setResult(null);
    const r = await testServerUrl(value);
    setResult(r);
    if (r.ok && thenSave) {
      const saved = setServerUrl(value);
      setValue(saved);
      onSaved?.(saved);
    }
    setBusy(false);
  };

  return (
    <div className="space-y-4">
      <div>
        <label className="label" htmlFor="server-url">Portal address</label>
        <input
          id="server-url"
          className="input"
          value={value}
          onChange={(e) => { setValue(e.target.value); setResult(null); }}
          placeholder="https://your-portal.ngrok-free.app"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          inputMode="url"
          type="url"
        />
        <div className="mt-2 rounded-lg bg-ink-50 p-3 text-xs text-ink-600">
          <p className="mb-1.5 font-semibold text-ink-700">This is a web address, not an app name.</p>
          <p>On the office Wi-Fi, the PC running the portal &mdash; shaped like:</p>
          <p className="mt-0.5 font-mono text-[11px] text-ink-500">http://&lt;the PC&rsquo;s IP&gt;:4100</p>
          <p className="mt-2">From anywhere, if the office has published it &mdash; shaped like:</p>
          <p className="mt-0.5 font-mono text-[11px] text-ink-500">https://&lt;name&gt;.ngrok-free.dev</p>
          <p className="mt-2 font-semibold text-ink-700">
            These are examples. Type the office&rsquo;s real address, not these.
          </p>
          <p className="mt-2 text-ink-500">
            It is the same address the portal opens on in a browser. Ask the office if you do
            not know it.
          </p>
        </div>
      </div>

      {result && (
        <div className={`flex items-start gap-2 rounded-lg border p-3 text-sm ${
          result.ok
            ? 'border-ok-200 bg-ok-50 text-ok-700'
            : 'border-danger-200 bg-danger-50 text-danger-700'
        }`}>
          {result.ok
            ? <IconCheck className="mt-0.5 h-4 w-4 shrink-0" />
            : <IconWarning className="mt-0.5 h-4 w-4 shrink-0" />}
          <span>{result.message}</span>
        </div>
      )}

      <div className="flex gap-2">
        <button
          className="btn btn-outline flex-1"
          onClick={() => check(false)}
          disabled={busy || !value.trim()}
          type="button"
        >
          {busy ? <Spinner /> : null} Test
        </button>
        <button
          className="btn btn-primary flex-1"
          onClick={() => check(true)}
          disabled={busy || !value.trim()}
          type="button"
        >
          {busy ? <Spinner /> : null} {submitLabel}
        </button>
      </div>

      {value.trim() && normalizeServerUrl(value) !== value.trim() && (
        <p className="text-xs text-ink-500">
          Will be saved as <span className="font-mono text-ink-700">{normalizeServerUrl(value)}</span>
        </p>
      )}
    </div>
  );
}

export default function ServerScreen() {
  const [saved, setSaved] = useState(false);

  return (
    <div className="mx-auto max-w-md space-y-4">
      <div className="card card-pad">
        <h1 className="card-title mb-1">Portal address</h1>
        <p className="card-sub mb-4">
          Where this app connects. Change it if the office portal moves to a new address.
        </p>
        <ServerForm onSaved={() => setSaved(true)} />
        {saved && (
          <p className="mt-4 rounded-lg bg-ok-50 p-3 text-sm text-ok-700">
            Saved. The app will use this address from now on.
          </p>
        )}
      </div>
    </div>
  );
}
