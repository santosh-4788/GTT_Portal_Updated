/**
 * Share trip.
 *
 * Four ways out — WhatsApp, copy, SMS, email — and nothing else. The share
 * sheet on most travel apps is a wall of icons for services nobody in this
 * market uses; these four are what a family or an office actually uses.
 *
 * The link shared is the public trip page for the reference. It resolves for
 * whoever opens it only if they have the trip on their own device, so the text
 * of the message carries the trip details as well — a shared link that opens to
 * "not found" is worse than no link.
 */
import { useState } from 'react';
import { BottomSheet } from './kit';
import { COMPANY } from './siteData';
import { KIND_LABEL, type Trip } from './tripStore';
import { IconCheck, IconMail, IconExternal } from '../components/icons';
import { IconWhatsApp } from './SiteIcons';

export function tripText(t: Trip): string {
  return [
    `${t.route || KIND_LABEL[t.kind]}`,
    t.date ? `Date: ${t.date}${t.time ? ` at ${t.time}` : ''}` : '',
    t.returnDate ? `Return: ${t.returnDate}` : '',
    t.passengers ? `Passengers: ${t.passengers}` : '',
    t.vehicleName ? `Vehicle: ${t.vehicleCount > 1 ? `${t.vehicleCount} × ` : ''}${t.vehicleName}` : '',
    t.driver?.name ? `Chauffeur: ${t.driver.name}` : '',
    t.vehicleNumber ? `Vehicle number: ${t.vehicleNumber}` : '',
    `Reference: ${t.ref}`,
    COMPANY.name,
  ].filter(Boolean).join('\n');
}

export function ShareSheet({
  open, onClose, trip,
}: {
  open: boolean; onClose: () => void; trip: Trip;
}) {
  const [copied, setCopied] = useState(false);

  const url = `${window.location.origin}/trips/${trip.ref}`;
  const body = `${tripText(trip)}\n${url}`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(body);
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    } catch {
      setCopied(false);
    }
  };

  const options = [
    {
      key: 'whatsapp',
      label: 'WhatsApp',
      sub: 'The one most people will actually read',
      href: `https://wa.me/?text=${encodeURIComponent(body)}`,
      tone: 'bg-[#25D366] text-white',
      icon: <IconWhatsApp className="h-5 w-5" />,
    },
    {
      key: 'sms',
      label: 'SMS',
      sub: 'Works without an internet connection',
      href: `sms:?&body=${encodeURIComponent(body)}`,
      tone: 'bg-brand-50 text-brand-700',
      icon: <IconExternal className="h-5 w-5" />,
    },
    {
      key: 'email',
      label: 'Email',
      sub: 'For the person paying for the trip',
      href: `mailto:?subject=${encodeURIComponent(`Trip ${trip.ref} — ${trip.route}`)}&body=${encodeURIComponent(body)}`,
      tone: 'bg-ink-100 text-ink-700',
      icon: <IconMail className="h-5 w-5" />,
    },
  ];

  return (
    <BottomSheet open={open} onClose={onClose} title="Share this trip">
      <p className="text-sm leading-relaxed text-ink-500">
        Share your journey with family, friends or colleagues. The message carries the route, the date and the
        reference, so it reads properly even if they never open the link.
      </p>

      <div className="mt-5 space-y-2.5">
        {options.map((o) => (
          <a
            key={o.key}
            href={o.href}
            target={o.key === 'whatsapp' ? '_blank' : undefined}
            rel="noreferrer"
            className="flex items-center gap-3.5 rounded-2xl bg-white p-3.5 shadow-card transition-shadow hover:shadow-raised"
          >
            <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-2xl ${o.tone}`}>{o.icon}</span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-bold text-ink-900">{o.label}</span>
              <span className="block text-xs text-ink-500">{o.sub}</span>
            </span>
          </a>
        ))}

        <button
          onClick={copy}
          className="flex w-full items-center gap-3.5 rounded-2xl bg-white p-3.5 text-left shadow-card transition-shadow hover:shadow-raised"
        >
          <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-2xl ${copied ? 'bg-ok-50 text-ok-600' : 'bg-ink-100 text-ink-700'}`}>
            {copied ? <IconCheck className="h-5 w-5" /> : <IconExternal className="h-5 w-5" />}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-bold text-ink-900">{copied ? 'Copied' : 'Copy link and details'}</span>
            <span className="block text-xs text-ink-500">{copied ? 'Paste it anywhere' : 'For anywhere else'}</span>
          </span>
        </button>
      </div>

      <pre className="mt-5 whitespace-pre-wrap rounded-2xl bg-ink-50/70 p-4 text-xs leading-relaxed text-ink-600">
        {body}
      </pre>
    </BottomSheet>
  );
}
