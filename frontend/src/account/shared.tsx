/**
 * Small pieces shared by the account pages: the trip status badge, the route
 * line, and the invoice download/view actions with their error toasts.
 */
import { useState } from 'react';
import { dmy, hm12 } from '../lib/format';
import { downloadInvoiceById, viewInvoiceById, STAGE_TONE, type ServerInvoice, type ServerTrip } from '../site/accountApi';
import { useToast } from '../components/Toast';
import { errorMessage } from '../lib/api';

export function TripStatus({ t }: { t: Pick<ServerTrip, 'status' | 'statusLabel'> }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-2xs font-bold uppercase tracking-[0.06em] ${STAGE_TONE[t.status] ?? 'bg-ink-100 text-ink-600'}`}>
      {t.statusLabel}
    </span>
  );
}

export function TripWhen({ t }: { t: ServerTrip }) {
  return (
    <span className="whitespace-nowrap">
      {dmy(t.travelDate)}
      {t.travelDateTo && t.travelDateTo !== t.travelDate && <> – {dmy(t.travelDateTo)}</>}
      {t.journeyTime && <span className="cell-meta block">{hm12(t.journeyTime)}</span>}
    </span>
  );
}

export function TripRoute({ t, className = 'max-w-[18rem]' }: { t: ServerTrip; className?: string }) {
  return (
    <div className={className} data-no-i18n>
      <p className="truncate text-sm text-ink-800" title={t.pickup ?? ''}>{t.pickup || '—'}</p>
      {t.drop && <p className="cell-meta truncate" title={t.drop}>→ {t.drop}</p>}
    </div>
  );
}

/** Download / view an invoice, with a busy state and a toast on failure. */
export function useInvoiceActions() {
  const toast = useToast();
  const [busy, setBusy] = useState<number | null>(null);

  const run = async (inv: Pick<ServerInvoice, 'id' | 'number'>, view: boolean) => {
    if (busy) return;
    setBusy(inv.id);
    try {
      if (view) await viewInvoiceById(inv.id);
      else {
        await downloadInvoiceById(inv);
        toast.success('Invoice downloaded', inv.number);
      }
    } catch (err: any) {
      let msg = errorMessage(err, 'Please try again, or call the office and we will email it to you.');
      try { if (err?.response?.data instanceof Blob) msg = JSON.parse(await err.response.data.text()).error ?? msg; } catch { /* keep msg */ }
      toast.error('The invoice could not be opened', msg);
    } finally {
      setBusy(null);
    }
  };

  return {
    busy,
    download: (inv: Pick<ServerInvoice, 'id' | 'number'>) => run(inv, false),
    view: (inv: Pick<ServerInvoice, 'id' | 'number'>) => run(inv, true),
  };
}
