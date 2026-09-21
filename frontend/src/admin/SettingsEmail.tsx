/**
 * Settings → Email.
 *
 * Two things the plain key/value editor cannot do: say whether sending actually
 * works, and prove it. Gmail's SMTP either accepts the App Password or it does
 * not, and finding that out by waiting for a customer to complain is not a plan.
 *
 * The log underneath is the safety net. Every message the portal tries to send
 * is written there first, so a spell of downtime is a list of things to resend
 * rather than a set of enquiries nobody knew about.
 */
import { useCallback, useEffect, useState } from 'react';
import { api, errorMessage } from '../lib/api';
import { dmyTime, humanise } from '../lib/format';
import { Field, Spinner } from '../components/ui';
import { useToast } from '../components/Toast';
import { useAuth } from '../lib/auth';
import { IconCheck, IconMail, IconRefresh, IconWarning } from '../components/icons';

interface Status {
  enabled: boolean;
  reason: string;
  from: string;
  fromName: string;
  host: string;
  port: number;
  user: string;
  adminInbox: string;
  passwordSet: boolean;
  passwordFromEnv: boolean;
  counts: { sent: number; failed: number; queued: number };
}

const KINDS: Record<string, string> = {
  INQUIRY_ADMIN: 'Enquiry to the office',
  INQUIRY_CUSTOMER: 'Enquiry acknowledgement',
  TRIP_DETAILS: 'Trip details',
  INVOICE: 'Invoice',
  ACCOUNT: 'Account',
};

export function EmailPanel({ refreshKey }: { refreshKey: number }) {
  const toast = useToast();
  const { can } = useAuth();

  const [status, setStatus] = useState<Status | null>(null);
  const [log, setLog] = useState<any[]>([]);
  const [filter, setFilter] = useState('');
  const [busy, setBusy] = useState('');
  const [testTo, setTestTo] = useState('');

  const load = useCallback(async () => {
    try {
      const [s, l] = await Promise.all([
        api.get('/settings/email/status'),
        api.get('/settings/email/log', { params: { status: filter, limit: 15 } }),
      ]);
      setStatus(s.data);
      setLog(l.data.data ?? []);
      if (!testTo) setTestTo(s.data.adminInbox ?? '');
    } catch {
      /* the rest of Settings still works without this panel */
    }
  }, [filter, refreshKey]);

  useEffect(() => { load(); }, [load]);

  async function verify() {
    setBusy('verify');
    try {
      const { data } = await api.post('/settings/email/verify', {});
      toast.success('Mailbox reached', data.message);
      load();
    } catch (err) {
      toast.error('Could not reach the mailbox', errorMessage(err));
    } finally {
      setBusy('');
    }
  }

  async function sendTest() {
    setBusy('test');
    try {
      const { data } = await api.post('/settings/email/test', { to: testTo });
      toast.success('Test message sent', data.message);
      load();
    } catch (err) {
      toast.error('The test did not go out', errorMessage(err));
    } finally {
      setBusy('');
    }
  }

  async function resend(id: number) {
    setBusy(`resend-${id}`);
    try {
      const { data } = await api.post(`/settings/email/log/${id}/resend`, {});
      toast.success('Sent', data.message);
      load();
    } catch (err) {
      toast.error('Still could not send it', errorMessage(err));
    } finally {
      setBusy('');
    }
  }

  if (!status) return null;

  return (
    <section className="section p-5">
      <div className="mb-4 border-b border-ink-200 pb-3">
        <h2 className="font-semibold text-ink-900">Email delivery</h2>
        <p className="mt-0.5 text-xs text-ink-500">
          Enquiry acknowledgements, trip details and invoices all go out from the address below.
        </p>
      </div>

      {/* ------------------------------ the state ------------------------------ */}
      <div
        className={`animate-fade-up rounded-lg border p-4 ${
          status.enabled ? 'border-ok-200 bg-ok-50' : 'border-warn-200 bg-warn-50'
        }`}
      >
        <p className={`flex items-center gap-2 text-sm font-semibold ${status.enabled ? 'text-ok-700' : 'text-warn-700'}`}>
          {status.enabled ? <IconCheck className="h-4 w-4" /> : <IconWarning className="h-4 w-4" />}
          {status.enabled ? 'Email is configured and ready' : 'Email is not sending yet'}
        </p>

        {!status.enabled && (
          <p className="mt-1.5 text-sm leading-relaxed text-warn-700">{status.reason}</p>
        )}

        <dl className="mt-3 grid gap-x-6 gap-y-1.5 text-xs sm:grid-cols-2">
          <Line label="Sends from" value={`${status.fromName} <${status.from}>`} />
          <Line label="Enquiries delivered to" value={status.adminInbox} />
          <Line label="SMTP" value={`${status.host}:${status.port}`} />
          <Line
            label="App Password"
            value={status.passwordSet
              ? (status.passwordFromEnv ? 'Set in backend\\.env' : 'Set in Settings')
              : 'Not set'}
          />
        </dl>

        <p className="mt-3 text-xs text-ink-600">
          {status.counts.sent} sent · {status.counts.failed} failed · {status.counts.queued} waiting
        </p>

        {!status.passwordSet && (
          <div className="mt-3 rounded-md bg-white/70 p-3 text-xs leading-relaxed text-ink-600">
            <p className="font-semibold text-ink-800">To switch it on (free, about two minutes):</p>
            <ol className="mt-1.5 list-decimal space-y-0.5 pl-4">
              <li>Turn on 2-Step Verification for {status.user}.</li>
              <li>Google Account → Security → App passwords → create one for "Mail".</li>
              <li>
                Put the 16 characters in <span className="font-mono">backend\.env</span> as{' '}
                <span className="font-mono">MAIL_APP_PASSWORD</span>, or in the Gmail App Password field above.
              </li>
            </ol>
            <p className="mt-1.5">
              Nothing is lost in the meantime — every message is held in the log below and can be resent.
            </p>
          </div>
        )}
      </div>

      {/* ------------------------------ prove it ------------------------------- */}
      {can('settings.update') && (
        <div className="mt-4 flex flex-wrap items-end gap-2.5 rounded-lg bg-ink-50 p-4">
          <Field label="Send a test message to" className="min-w-[16rem] flex-1">
            <input
              className="input" type="email" value={testTo}
              onChange={(e) => setTestTo(e.target.value)} placeholder="you@example.com"
            />
          </Field>
          <button onClick={sendTest} disabled={!!busy || !testTo} className="btn-primary btn-sm">
            {busy === 'test' ? <Spinner /> : <IconMail className="h-3.5 w-3.5" />} Send test
          </button>
          <button onClick={verify} disabled={!!busy} className="btn-outline btn-sm">
            {busy === 'verify' ? <Spinner /> : <IconRefresh className="h-3.5 w-3.5" />} Check connection
          </button>
        </div>
      )}

      {/* -------------------------------- the log ------------------------------ */}
      <div className="mt-5">
        <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-xs font-bold uppercase tracking-wider text-ink-500">Recent messages</h3>
          <div className="flex gap-1.5">
            {[['', 'All'], ['SENT', 'Sent'], ['FAILED', 'Failed'], ['QUEUED', 'Waiting']].map(([v, l]) => (
              <button
                key={v || 'all'}
                onClick={() => setFilter(v)}
                className={`rounded-full px-2.5 py-1 text-2xs font-semibold transition-colors ${
                  filter === v ? 'bg-ink-900 text-white' : 'bg-ink-100 text-ink-600 hover:bg-ink-200'
                }`}
              >
                {l}
              </button>
            ))}
          </div>
        </div>

        {log.length === 0 ? (
          <p className="rounded-lg bg-ink-50 px-4 py-6 text-center text-sm text-ink-500">
            Nothing has been sent yet.
          </p>
        ) : (
          <div className="table-wrap">
            <table className="tbl">
              <thead>
                <tr><th>When</th><th>Kind</th><th>To</th><th>Subject</th><th>Status</th><th /></tr>
              </thead>
              <tbody>
                {log.map((e) => (
                  <tr key={e.id}>
                    <td className="whitespace-nowrap text-xs text-ink-500">{dmyTime(e.sent_at ?? e.created_at)}</td>
                    <td className="text-xs text-ink-700">{KINDS[e.kind] ?? humanise(e.kind)}</td>
                    <td className="max-w-[12rem] truncate text-xs text-ink-600">{e.to_address}</td>
                    <td className="max-w-[18rem] truncate text-xs text-ink-700">
                      {e.subject}
                      {e.error && <span className="block truncate text-2xs text-danger-600">{e.error}</span>}
                    </td>
                    <td>
                      <span className={`badge-${e.status === 'SENT' ? 'ok' : e.status === 'FAILED' ? 'danger' : 'warn'}`}>
                        {humanise(e.status)}
                      </span>
                    </td>
                    <td className="text-right">
                      {e.status !== 'SENT' && can('settings.update') && (
                        <button
                          onClick={() => resend(e.id)}
                          disabled={!!busy}
                          className="btn-outline btn-sm"
                        >
                          {busy === `resend-${e.id}` ? <Spinner /> : null} Resend
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <dt className="shrink-0 text-ink-500">{label}</dt>
      <dd className="min-w-0 truncate font-medium text-ink-800">{value}</dd>
    </div>
  );
}
