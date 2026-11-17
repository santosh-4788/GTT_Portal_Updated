import { useEffect, useMemo, useRef, useState } from 'react';
import { api, errorMessage } from '../lib/api';
import { dmy } from '../lib/format';
import { ConfirmDialog, EmptyState, Field, Loading, Modal, StatCard, Tabs } from '../components/ui';
import { IconEdit, IconEye, IconPlus, IconTrash, IconUpload, IconWarning } from '../components/icons';
import { useToast } from '../components/Toast';
import { DateField } from '../components/DateTimeField';
import { AD_THEMES, FestivalAdCard, adImage, type FestivalAd } from '../site/FestivalAds';

/* ==========================================================================
   Festival ads.

   What the website's home page says for a festival or an event: a title, the
   office's own words, up to six photos, and the dates to show it. An ad goes
   up on its first day and comes down after its last by itself; switch it off
   or delete it at any moment.

   The year's festivals are already here (7 days before each festival until
   the day). Add photos and your own words to them, change the dates, or
   remove the ones you don't want.
   ========================================================================== */

type Status = 'LIVE' | 'UPCOMING' | 'ENDED' | 'HIDDEN';
interface Ad extends FestivalAd {
  active: boolean;
  notes: string | null;
  builtIn: boolean;
  status: Status;
  updatedAt: string;
}

type Tab = 'CURRENT' | Status | 'ALL';

const STATUS_STYLE: Record<Status, { label: string; cls: string }> = {
  LIVE: { label: 'Live now', cls: 'bg-ok-50 text-ok-700 ring-ok-100' },
  UPCOMING: { label: 'Coming up', cls: 'bg-brand-50 text-brand-700 ring-brand-100' },
  ENDED: { label: 'Ended', cls: 'bg-ink-100 text-ink-600 ring-ink-200' },
  HIDDEN: { label: 'Hidden', cls: 'bg-warn-50 text-warn-700 ring-warn-100' },
};

const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

interface Form {
  kind: 'FESTIVAL' | 'EVENT' | 'OFFER';
  title: string; titleLocal: string; headline: string; message: string;
  ctaLabel: string; ctaLink: string; theme: string;
  festivalDate: string; festivalEnd: string; showFrom: string; showUntil: string;
  active: boolean; notes: string;
}
const BLANK: Form = {
  kind: 'FESTIVAL', title: '', titleLocal: '', headline: '', message: '', ctaLabel: '', ctaLink: '',
  theme: 'saffron', festivalDate: '', festivalEnd: '', showFrom: '', showUntil: '', active: true, notes: '',
};
const toForm = (a: Ad): Form => ({
  kind: a.kind, title: a.title, titleLocal: a.titleLocal ?? '', headline: a.headline ?? '', message: a.message ?? '',
  ctaLabel: a.ctaLabel ?? '', ctaLink: a.ctaLink ?? '', theme: a.theme, festivalDate: a.festivalDate ?? '',
  festivalEnd: a.festivalEnd ?? '', showFrom: a.showFrom, showUntil: a.showUntil, active: a.active, notes: a.notes ?? '',
});

function Badge({ s }: { s: Status }) {
  const v = STATUS_STYLE[s];
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-2xs font-bold ring-1 ${v.cls}`}>{v.label}</span>;
}

function Switch({ on, onChange, label, busy }: { on: boolean; onChange: (v: boolean) => void; label: string; busy?: boolean }) {
  return (
    <button
      type="button" role="switch" aria-checked={on} aria-label={label} disabled={busy}
      onClick={() => onChange(!on)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${on ? 'bg-ok-500' : 'bg-ink-300'}`}
    >
      <span className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-[1.375rem]' : 'translate-x-0.5'}`} />
    </button>
  );
}

function Thumb({ ad }: { ad: FestivalAd }) {
  const t = AD_THEMES[ad.theme] ?? AD_THEMES.saffron;
  if (ad.images[0]) {
    return <img src={adImage(ad.images[0].url)} alt="" className="h-full w-full object-cover" loading="lazy" />;
  }
  return (
    <div className="grid h-full w-full place-items-center p-2 text-center" style={{ background: t.bg }}>
      <span className="font-display text-sm font-bold leading-tight" style={{ color: t.accent }}>{ad.titleLocal || ad.title}</span>
    </div>
  );
}

export default function Promotions() {
  const toast = useToast();
  const [rows, setRows] = useState<Ad[] | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [today, setToday] = useState('');
  const [tab, setTab] = useState<Tab>('CURRENT');
  const [editing, setEditing] = useState<Ad | 'new' | null>(null);
  const [removing, setRemoving] = useState<Ad | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [preview, setPreview] = useState<Ad | null>(null);

  const load = async () => {
    try {
      const { data } = await api.get('/promotions');
      setRows(data.data);
      setCounts(data.counts);
      setToday(data.today);
    } catch (err) {
      toast.error('Could not load the festival ads', errorMessage(err));
      setRows([]);
    }
  };
  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const shown = useMemo(() => {
    if (!rows) return [];
    if (tab === 'ALL') return rows;
    if (tab === 'CURRENT') return rows.filter((r) => r.status === 'LIVE' || r.status === 'UPCOMING');
    return rows.filter((r) => r.status === tab);
  }, [rows, tab]);

  const toggle = async (a: Ad, active: boolean) => {
    setBusy(a.id);
    try {
      await api.patch(`/promotions/${a.id}/active`, { active });
      toast.success(active ? 'Ad switched on' : 'Ad hidden from the website', a.title);
      await load();
    } catch (err) {
      toast.error('Could not change it', errorMessage(err));
    } finally { setBusy(null); }
  };

  const remove = async () => {
    if (!removing) return;
    setBusy(removing.id);
    try {
      await api.delete(`/promotions/${removing.id}`);
      toast.success('Ad deleted', removing.title);
      setRemoving(null);
      await load();
    } catch (err) {
      toast.error('Could not delete it', errorMessage(err));
    } finally { setBusy(null); }
  };

  if (!rows) return <Loading label="Loading festival ads…" />;

  return (
    <div className="page mx-auto max-w-7xl">
      <div className="page-head animate-fade-down">
        <div>
          <h1 className="page-title">Festival ads</h1>
          <p className="page-sub">
            Festival and event posts on the website's home page — photos and your own words. Each one shows on its dates
            and comes down by itself; switch it off or delete it whenever you want. The year's festivals are already added,
            from 7 days before each festival.
          </p>
        </div>
        <button className="btn-primary" onClick={() => setEditing('new')}><IconPlus className="h-4 w-4" /> New ad</button>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Live now" value={counts.LIVE ?? 0} sub="On the website today" tone={counts.LIVE ? 'success' : 'default'} onClick={() => setTab('LIVE')} />
        <StatCard label="Coming up" value={counts.UPCOMING ?? 0} sub="Will go up on their dates" tone="brand" onClick={() => setTab('UPCOMING')} />
        <StatCard label="Hidden" value={counts.HIDDEN ?? 0} sub="Switched off" tone={counts.HIDDEN ? 'warning' : 'default'} onClick={() => setTab('HIDDEN')} />
        <StatCard label="Ended" value={counts.ENDED ?? 0} sub="Dates are over" onClick={() => setTab('ENDED')} />
      </div>

      <Tabs<Tab>
        tabs={[
          { key: 'CURRENT', label: 'Live & coming up', count: (counts.LIVE ?? 0) + (counts.UPCOMING ?? 0) },
          { key: 'LIVE', label: 'Live now', count: counts.LIVE ?? 0 },
          { key: 'UPCOMING', label: 'Coming up', count: counts.UPCOMING ?? 0 },
          { key: 'HIDDEN', label: 'Hidden', count: counts.HIDDEN ?? 0 },
          { key: 'ENDED', label: 'Ended', count: counts.ENDED ?? 0 },
          { key: 'ALL', label: 'All', count: counts.ALL ?? 0 },
        ]}
        active={tab}
        onChange={setTab}
      />

      {shown.length === 0 ? (
        <section className="section">
          <EmptyState title="No ads here" body="Add one with “New ad”, or look in another tab." />
        </section>
      ) : (
        <div className="grid gap-3">
          {shown.map((a) => (
            <div key={a.id} className="section flex flex-col gap-4 p-4 sm:flex-row sm:items-center">
              <button type="button" onClick={() => setPreview(a)} title="Preview"
                className="relative h-24 w-full shrink-0 overflow-hidden rounded-xl ring-1 ring-ink-200 sm:w-40">
                <Thumb ad={a} />
                {a.images.length > 0 && (
                  <span className="absolute bottom-1.5 right-1.5 rounded-full bg-black/60 px-2 py-0.5 text-2xs font-semibold text-white">
                    {a.images.length} photo{a.images.length > 1 ? 's' : ''}
                  </span>
                )}
              </button>

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-md font-bold text-ink-900">{a.title}</h3>
                  {a.titleLocal && <span className="text-sm text-ink-500">{a.titleLocal}</span>}
                  <Badge s={a.status} />
                  {a.builtIn && <span className="rounded-full bg-ink-50 px-2 py-0.5 text-2xs font-semibold text-ink-500 ring-1 ring-ink-200">Festival calendar</span>}
                </div>
                <p className="mt-1 text-xs text-ink-600">
                  {a.festivalDate && <>Festival: <b>{dmy(a.festivalDate)}{a.festivalEnd && a.festivalEnd !== a.festivalDate ? ` – ${dmy(a.festivalEnd)}` : ''}</b> · </>}
                  On the website: <b>{dmy(a.showFrom)}</b> to <b>{dmy(a.showUntil)}</b>
                </p>
                {a.headline && <p className="mt-1 line-clamp-1 text-sm text-ink-700">{a.headline}</p>}
                {a.notes && (
                  <p className="mt-1.5 flex items-start gap-1.5 text-xs text-warn-700">
                    <IconWarning className="mt-px h-3.5 w-3.5 shrink-0" /> {a.notes}
                  </p>
                )}
              </div>

              <div className="flex shrink-0 items-center gap-2 sm:flex-col sm:items-end">
                <label className="flex items-center gap-2 text-xs font-semibold text-ink-600">
                  {a.active ? 'Showing' : 'Off'}
                  <Switch on={a.active} busy={busy === a.id} label={`Show ${a.title} on the website`} onChange={(v) => void toggle(a, v)} />
                </label>
                <div className="flex gap-1.5">
                  <button className="btn-outline btn-sm" onClick={() => setPreview(a)}><IconEye className="h-3.5 w-3.5" /> Preview</button>
                  <button className="btn-outline btn-sm" onClick={() => setEditing(a)}><IconEdit className="h-3.5 w-3.5" /> Edit</button>
                  <button className="btn-outline btn-sm text-danger-600" onClick={() => setRemoving(a)} aria-label={`Delete ${a.title}`}>
                    <IconTrash className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <Editor
          ad={editing === 'new' ? null : editing}
          today={today}
          onClose={() => setEditing(null)}
          onSaved={async (saved, close) => { await load(); if (close) setEditing(null); else setEditing(saved); }}
          onRefresh={load}
        />
      )}

      <Modal open={!!preview} onClose={() => setPreview(null)} title="How it looks on the website" size="xl"
        subtitle={preview ? `${preview.title} · ${dmy(preview.showFrom)} to ${dmy(preview.showUntil)}` : undefined}>
        {preview && <FestivalAdCard ad={preview} today={today} preview />}
      </Modal>

      <ConfirmDialog
        open={!!removing}
        onClose={() => setRemoving(null)}
        onConfirm={() => void remove()}
        title="Delete this ad?"
        body={<p>“{removing?.title}” and its photos will be removed for good. To take it off the website for now, switch it off instead.</p>}
        confirmLabel="Yes, delete"
        cancelLabel="No"
        danger
        busy={busy === removing?.id}
      />
    </div>
  );
}

/* ========================================================================== */

function Editor({ ad, today, onClose, onSaved, onRefresh }: {
  ad: Ad | null; today: string; onClose: () => void;
  onSaved: (saved: Ad, close: boolean) => void | Promise<void>;
  /** Reload the list behind the editor without resetting what is being typed. */
  onRefresh: () => void | Promise<void>;
}) {
  const toast = useToast();
  const [f, setF] = useState<Form>(ad ? toForm(ad) : BLANK);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [current, setCurrent] = useState<Ad | null>(ad);
  const file = useRef<HTMLInputElement>(null);

  useEffect(() => { setCurrent(ad); setF(ad ? toForm(ad) : BLANK); }, [ad]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((p) => ({ ...p, [k]: v }));

  // Picking the festival day fills the website dates: 7 days before, to the last day.
  const setFestival = (k: 'festivalDate' | 'festivalEnd', v: string) => {
    setF((p) => {
      const next = { ...p, [k]: v };
      const start = k === 'festivalDate' ? v : p.festivalDate;
      const end = (k === 'festivalEnd' ? v : p.festivalEnd) || start;
      if (start && (!p.showFrom || k === 'festivalDate')) next.showFrom = addDays(start, -7);
      if (end) next.showUntil = end;
      return next;
    });
  };

  const save = async (close: boolean) => {
    const e: Record<string, string> = {};
    if (f.title.trim().length < 2) e.title = 'Give the ad a title.';
    if (!f.showFrom) e.showFrom = 'Pick the first day to show it.';
    if (!f.showUntil) e.showUntil = 'Pick the last day to show it.';
    if (f.showFrom && f.showUntil && f.showUntil < f.showFrom) e.showUntil = 'This is before the first day.';
    setErrors(e);
    if (Object.keys(e).length) return;
    setSaving(true);
    try {
      const body = { ...f };
      const { data } = current ? await api.put(`/promotions/${current.id}`, body) : await api.post('/promotions', body);
      toast.success(current ? 'Ad saved' : 'Ad created', close ? undefined : 'Now add photos below.');
      setCurrent(data);
      await onSaved(data, close);
    } catch (err) {
      toast.error('Could not save', errorMessage(err));
    } finally { setSaving(false); }
  };

  const addPhotos = async (files: FileList | null) => {
    if (!files?.length || !current) return;
    const fd = new FormData();
    Array.from(files).forEach((x) => fd.append('photos', x));
    setUploading(true);
    try {
      const { data } = await api.post(`/promotions/${current.id}/images`, fd);
      setCurrent(data);
      await onRefresh();
      toast.success(`${files.length} photo${files.length > 1 ? 's' : ''} added`);
    } catch (err) {
      toast.error('Could not add the photos', errorMessage(err));
    } finally {
      setUploading(false);
      if (file.current) file.current.value = '';
    }
  };

  const photoAction = async (imgId: number, kind: 'delete' | 'first' | 'caption', caption?: string) => {
    if (!current) return;
    try {
      const { data } = kind === 'delete'
        ? await api.delete(`/promotions/${current.id}/images/${imgId}`)
        : await api.put(`/promotions/${current.id}/images/${imgId}`, {
          caption: caption ?? current.images.find((i) => i.id === imgId)?.caption ?? '', first: kind === 'first',
        });
      setCurrent(data);
      await onRefresh();
    } catch (err) {
      toast.error('Could not change the photo', errorMessage(err));
    }
  };

  const previewAd: FestivalAd = {
    id: current?.id ?? 0, kind: f.kind, title: f.title || 'Your title', titleLocal: f.titleLocal || null,
    headline: f.headline || null, message: f.message || null, ctaLabel: f.ctaLabel || null, ctaLink: f.ctaLink || null,
    theme: f.theme, festivalDate: f.festivalDate || null, festivalEnd: f.festivalEnd || null,
    showFrom: f.showFrom || today, showUntil: f.showUntil || today, images: current?.images ?? [],
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="full"
      title={current ? `Edit ad — ${current.title}` : 'New festival / event ad'}
      subtitle="Everything you type shows in the preview as the website will show it."
      footer={(
        <>
          <button className="btn-outline" onClick={onClose} disabled={saving}>Close</button>
          {!current && <button className="btn-outline" onClick={() => void save(false)} disabled={saving}>Save and add photos</button>}
          <button className="btn-primary" onClick={() => void save(true)} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
        </>
      )}
    >
      <div className="grid gap-6 xl:grid-cols-[minmax(0,26rem),1fr]">
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Type">
              <select className="input" value={f.kind} onChange={(e) => set('kind', e.target.value as Form['kind'])}>
                <option value="FESTIVAL">Festival</option>
                <option value="EVENT">Event</option>
                <option value="OFFER">Special / announcement</option>
              </select>
            </Field>
            <Field label="Colour">
              <select className="input" value={f.theme} onChange={(e) => set('theme', e.target.value)}>
                {Object.entries(AD_THEMES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Title" required error={errors.title} hint="Name of the festival or event, e.g. Ganesh Chaturthi.">
            <input className="input" value={f.title} maxLength={80} onChange={(e) => set('title', e.target.value)} />
          </Field>
          <Field label="Name in Hindi / Marathi" hint="Shown large and faint behind the ad, e.g. गणपती बाप्पा मोरया.">
            <input className="input" value={f.titleLocal} maxLength={40} onChange={(e) => set('titleLocal', e.target.value)} />
          </Field>
          <Field label="Headline">
            <input className="input" value={f.headline} maxLength={140} onChange={(e) => set('headline', e.target.value)} />
          </Field>
          <Field label="Message / comments" hint="Your own words. New lines are kept.">
            <textarea className="input min-h-[7rem]" value={f.message} maxLength={1200} onChange={(e) => set('message', e.target.value)} />
          </Field>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Festival / event day">
              <DateField value={f.festivalDate} onChange={(v) => setFestival('festivalDate', v)} placeholder="Pick the day" />
            </Field>
            <Field label="Last day (if several days)">
              <DateField value={f.festivalEnd} min={f.festivalDate || undefined} onChange={(v) => setFestival('festivalEnd', v)} placeholder="Same day" />
            </Field>
            <Field label="Show on website from" required error={errors.showFrom} hint="Filled as 7 days before the festival.">
              <DateField value={f.showFrom} onChange={(v) => set('showFrom', v)} placeholder="First day" />
            </Field>
            <Field label="Show until" required error={errors.showUntil}>
              <DateField value={f.showUntil} min={f.showFrom || undefined} onChange={(v) => set('showUntil', v)} placeholder="Last day" />
            </Field>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Button text" hint="Empty = “Book on WhatsApp”.">
              <input className="input" value={f.ctaLabel} maxLength={40} onChange={(e) => set('ctaLabel', e.target.value)} />
            </Field>
            <Field label="Button link" hint="Empty = WhatsApp the office. Or /book, https://…">
              <input className="input" value={f.ctaLink} maxLength={300} onChange={(e) => set('ctaLink', e.target.value)} placeholder="WhatsApp" />
            </Field>
          </div>

          <Field label="Office note (not shown on the website)">
            <input className="input" value={f.notes} maxLength={500} onChange={(e) => set('notes', e.target.value)} />
          </Field>

          <label className="flex items-center gap-3 rounded-xl bg-ink-50 px-3 py-2.5 text-sm font-semibold text-ink-700">
            <Switch on={f.active} onChange={(v) => set('active', v)} label="Show on the website" />
            Show on the website during these dates
          </label>

          {/* ------------------------------ photos ------------------------------ */}
          <div className="rounded-2xl border border-dashed border-ink-300 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm font-bold text-ink-900">Photos</p>
                <p className="text-xs text-ink-500">Up to 6 · JPG, PNG or WEBP · 4 MB each. More than one becomes a slideshow.</p>
              </div>
              <button className="btn-outline btn-sm" disabled={!current || uploading || (current?.images.length ?? 0) >= 6}
                onClick={() => file.current?.click()}>
                <IconUpload className="h-3.5 w-3.5" /> {uploading ? 'Uploading…' : 'Add photos'}
              </button>
              <input ref={file} type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple hidden
                onChange={(e) => void addPhotos(e.target.files)} />
            </div>
            {!current && <p className="mt-3 text-xs text-warn-700">Save the ad first (“Save and add photos”), then add photos here.</p>}
            {current && current.images.length > 0 && (
              <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
                {current.images.map((im, i) => (
                  <li key={im.id} className="overflow-hidden rounded-xl ring-1 ring-ink-200">
                    <div className="relative aspect-[4/3] bg-ink-100">
                      <img src={adImage(im.url)} alt="" className="h-full w-full object-cover" />
                      {i === 0 && <span className="absolute left-1.5 top-1.5 rounded-full bg-black/60 px-2 py-0.5 text-2xs font-semibold text-white">First</span>}
                    </div>
                    <div className="space-y-1.5 p-2">
                      <input className="input h-8 text-xs" placeholder="Caption (optional)" defaultValue={im.caption ?? ''}
                        onBlur={(e) => { if (e.target.value !== (im.caption ?? '')) void photoAction(im.id, 'caption', e.target.value); }} />
                      <div className="flex justify-between gap-1">
                        {i > 0
                          ? <button className="text-2xs font-semibold text-brand-700 hover:underline" onClick={() => void photoAction(im.id, 'first')}>Make first</button>
                          : <span />}
                        <button className="text-2xs font-semibold text-danger-600 hover:underline" onClick={() => void photoAction(im.id, 'delete')}>Remove</button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="min-w-0">
          <p className="mb-2 text-2xs font-bold uppercase tracking-[0.14em] text-ink-500">Preview</p>
          <FestivalAdCard ad={previewAd} today={today} preview />
        </div>
      </div>
    </Modal>
  );
}
