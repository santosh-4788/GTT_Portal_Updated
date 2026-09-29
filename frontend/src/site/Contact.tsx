import { useState } from 'react';
import { Link } from 'react-router-dom';
import PageHero from './PageHero';
import { COMPANY, SERVICES } from './siteData';
import { IconWhatsApp } from './SiteIcons';
import { WhatsAppButton } from './EnquirySheet';
import { IconClock, IconMail, IconPhone, IconPin } from '../components/icons';
import { api, errorMessage } from '../lib/api';
import { Field, Spinner } from '../components/ui';
import { useToast } from '../components/Toast';
import { todayIso } from '../lib/format';
import { DateField } from '../components/DateTimeField';
import { useSeo } from './Seo';

const EMPTY = {
  name: '', mobile: '', email: '', service: '',
  pickup: '', dropOff: '', travelDate: '', message: '',
};

export default function Contact() {
  useSeo({
    title: 'Contact Us - Cab Booking in Mumbai',
    path: '/contact',
    description: 'Contact Gupta Tours & Travels in Goregaon (W), Mumbai to book a cab or ask for a quote. Send an enquiry or message us on WhatsApp - we answer 24x7.',
  });
  const [form, setForm] = useState(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const toast = useToast();

  const set = (k: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    setForm((f) => ({ ...f, [k]: e.target.value }));
    setErrors((p) => ({ ...p, [k]: '' }));
  };

  /** The pickers hand back a plain string rather than a change event. */
  const setVal = (k: keyof typeof EMPTY) => (v: string) => {
    setForm((f) => ({ ...f, [k]: v }));
    setErrors((p) => ({ ...p, [k]: '' }));
  };

  const validate = () => {
    const e: Record<string, string> = {};
    if (form.name.trim().length < 2) e.name = 'Please enter your name.';
    const mob = form.mobile.replace(/\D/g, '').replace(/^91/, '');
    if (!/^[6-9]\d{9}$/.test(mob)) e.mobile = 'Enter a valid 10-digit mobile number.';
    if (form.email && !/^\S+@\S+\.\S+$/.test(form.email)) e.email = 'Enter a valid email address.';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!validate()) return;
    setBusy(true);
    try {
      const { data } = await api.post('/public/enquiry', form);
      setDone(data.message);
      setForm(EMPTY);
      toast.success('Enquiry sent', data.message);
    } catch (err) {
      toast.error('Could not send your enquiry', errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHero
        eyebrow="Contact us"
        title="Tell us the trip — we will call you back"
        sub={`Call ${COMPANY.owner} directly with the Call button, or leave your details below and we will get in touch.`}
        crumbs={[{ label: 'Contact' }]}
        compact
      />

      <section className="py-16 sm:py-20">
        <div className="mx-auto grid max-w-7xl gap-10 px-6 lg:grid-cols-[1.2fr,1fr] lg:px-10">
          {/* form */}
          <div className="tile p-7">
            {done ? (
              <div className="py-10 text-center">
                <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-ok-50 text-3xl">✓</div>
                <h2 className="mt-5 text-xl font-bold text-ink-900">Enquiry received</h2>
                <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-ink-600">{done}</p>
                <button onClick={() => setDone(null)} className="btn mt-6 h-11 rounded-full bg-ink-50 px-6 text-md text-ink-700 hover:bg-ink-100">Send another enquiry</button>
              </div>
            ) : (
              <>
                <h2 className="text-xl font-bold text-ink-900">Send an enquiry</h2>
                <p className="mt-1.5 text-sm text-ink-600">
                  Fields marked <span className="text-danger-600">*</span> are required. Everything else helps us quote
                  accurately the first time.
                </p>

                <form onSubmit={submit} className="mt-6 grid gap-4 sm:grid-cols-2" noValidate>
                  <Field label="Your name" required error={errors.name}>
                    <input
                      className={`input ${errors.name ? 'input-error' : ''}`}
                      value={form.name} onChange={set('name')} placeholder="e.g. Rajesh Menon" autoComplete="name"
                    />
                  </Field>

                  <Field label="Mobile number" required error={errors.mobile}>
                    <input
                      className={`input ${errors.mobile ? 'input-error' : ''}`}
                      value={form.mobile} onChange={set('mobile')} placeholder="10-digit mobile"
                      inputMode="numeric" autoComplete="tel"
                    />
                  </Field>

                  <Field label="Email" error={errors.email} className="sm:col-span-2">
                    <input
                      className={`input ${errors.email ? 'input-error' : ''}`}
                      value={form.email} onChange={set('email')} placeholder="name@company.com"
                      type="email" autoComplete="email"
                    />
                  </Field>

                  <Field label="Service needed">
                    <select className="input" value={form.service} onChange={set('service')}>
                      <option value="">Select a service…</option>
                      {SERVICES.map((s) => <option key={s.slug} value={s.name}>{s.name}</option>)}
                    </select>
                  </Field>

                  <Field label="Travel date">
                    <DateField min={todayIso()} value={form.travelDate} onChange={setVal('travelDate')} />
                  </Field>

                  <Field label="Pickup location">
                    <input className="input" value={form.pickup} onChange={set('pickup')} placeholder="e.g. Andheri East" />
                  </Field>

                  <Field label="Drop location">
                    <input className="input" value={form.dropOff} onChange={set('dropOff')} placeholder="e.g. Pune" />
                  </Field>

                  <Field label="Anything else we should know?" className="sm:col-span-2">
                    <textarea
                      className="input min-h-[110px] resize-y" value={form.message} onChange={set('message')}
                      placeholder="Number of passengers, luggage, flight number, timings…"
                    />
                  </Field>

                  <div className="sm:col-span-2">
                    <button type="submit" className="grad-brand btn h-12 w-full rounded-full text-md font-semibold text-white hover:brightness-[1.06]" disabled={busy}>
                      {busy && <Spinner className="h-4 w-4" />}
                      {busy ? 'Sending…' : 'Send enquiry'}
                    </button>
                    <p className="mt-3 text-center text-xs text-ink-500">
                      In a hurry? Use the Call button — we answer {COMPANY.serviceHours.toLowerCase()}.
                    </p>
                  </div>
                </form>
              </>
            )}
          </div>

          {/* contact details */}
          <aside className="space-y-5">
            <div className="tile p-6">
              <h2 className="text-lg font-bold text-ink-900">Contact details</h2>
              <ul className="mt-5 space-y-5 text-sm">
                <li className="flex gap-3.5">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-600"><IconPhone className="h-5 w-5" /></span>
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-wide text-ink-500">Phone</p>
                    <a href={`tel:+91${COMPANY.mobile}`} aria-label="Call the office" className="block font-semibold text-ink-900 hover:text-brand-600">
                      Call the office
                    </a>
                    <p className="text-xs text-ink-500">{COMPANY.serviceHours} — ask for {COMPANY.owner}</p>
                    <WhatsAppButton
                      className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-[#25D366] px-3 py-1.5 text-xs font-semibold text-white transition-[filter] hover:brightness-105"
                    >
                      <IconWhatsApp className="h-3.5 w-3.5" /> Message on WhatsApp
                    </WhatsAppButton>
                  </div>
                </li>
                <li className="flex gap-3.5">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-600"><IconMail className="h-5 w-5" /></span>
                  <div className="min-w-0">
                    <p className="text-[11px] font-bold uppercase tracking-wide text-ink-500">Email</p>
                    <a href={`mailto:${COMPANY.email}`} className="break-all font-semibold text-ink-900 hover:text-brand-600">
                      {COMPANY.email}
                    </a>
                  </div>
                </li>
                <li className="flex gap-3.5">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-600"><IconPin className="h-5 w-5" /></span>
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-wide text-ink-500">Address</p>
                    <p className="text-ink-800">{COMPANY.address}</p>
                  </div>
                </li>
                <li className="flex gap-3.5">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-600"><IconClock className="h-5 w-5" /></span>
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-wide text-ink-500">Availability</p>
                    <p className="font-semibold text-ink-900">{COMPANY.serviceHours}</p>
                  </div>
                </li>
              </ul>
            </div>

            <div className="grad-soft overflow-hidden rounded-[1.75rem] p-6 text-center">
              <img src="/assets/art-car-line-bold.svg" alt="" className="mx-auto h-auto w-56" />
              <p className="mt-4 font-display font-bold text-ink-900">{COMPANY.name}</p>
              <p className="mt-1 text-xs font-semibold text-brand-700">{COMPANY.tagline}</p>
              <a href={`tel:+91${COMPANY.mobile}`} className="btn mt-5 h-11 w-full rounded-full bg-ink-900 text-md text-white hover:bg-ink-800">
                <IconPhone className="h-4 w-4" /> Call now
              </a>
              <Link to="/support" className="btn mt-2 h-10 w-full rounded-full bg-white text-sm text-ink-700 shadow-card hover:shadow-raised">
                Support centre
              </Link>
            </div>
          </aside>
        </div>
      </section>
    </>
  );
}
