/**
 * Driver information.
 *
 * Shown once a chauffeur has been assigned, and honest about the gap before
 * that: an unassigned trip gets the "not yet" state rather than a placeholder
 * face and a decorative rating.
 *
 * There are no driver photographs on this site. We hold none, and a stock
 * portrait beside a real name is worse than an initial — so the avatar is the
 * chauffeur's initials on the brand gradient.
 */
import { COMPANY, whatsappLink } from './siteData';
import { Stars } from './kit';
import type { Driver } from './tripStore';
import { IconCheck, IconPhone, IconShield, IconSteering } from '../components/icons';
import { IconWhatsApp } from './SiteIcons';

export function DriverCard({
  driver, vehicleNumber, vehicleName, sample = false,
}: {
  driver?: Driver;
  vehicleNumber?: string;
  vehicleName?: string;
  sample?: boolean;
}) {
  if (!driver) {
    return (
      <div className="tile p-5">
        <h2 className="font-display text-md font-bold text-ink-900">Chauffeur</h2>
        <div className="mt-4 flex items-start gap-3.5">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-ink-100 text-ink-400">
            <IconSteering className="h-5 w-5" />
          </span>
          <div>
            <p className="text-sm font-semibold text-ink-800">Not assigned yet</p>
            <p className="mt-1 text-xs leading-relaxed text-ink-500">
              The chauffeur's name, mobile and the vehicle registration are sent to you before the reporting time — so
              nobody is standing outside wondering which car is theirs.
            </p>
          </div>
        </div>
      </div>
    );
  }

  /** The sample trip carries no real mobile, so the buttons go to the office. */
  const callNumber = driver.mobile || COMPANY.mobile;

  return (
    <div className="tile p-5">
      <h2 className="font-display text-md font-bold text-ink-900">Your chauffeur</h2>

      <div className="mt-4 flex items-center gap-3.5">
        <span className="grad-brand grid h-14 w-14 shrink-0 place-items-center rounded-full font-display text-md font-bold text-white">
          {driver.initials}
        </span>
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-bold text-ink-900">{driver.name}</span>
            {driver.verified && (
              <span className="inline-flex items-center gap-1 rounded-full bg-ok-50 px-2 py-0.5 text-2xs font-bold text-ok-700">
                <IconCheck className="h-3 w-3" /> Verified
              </span>
            )}
          </p>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-500">
            <Stars value={driver.rating} />
            <span>{driver.experience} driving</span>
          </p>
        </div>
      </div>

      <dl className="mt-4 space-y-2.5 border-t border-ink-100 pt-4 text-sm">
        <div className="flex items-baseline justify-between gap-4">
          <dt className="text-ink-500">Languages</dt>
          <dd className="text-right font-semibold text-ink-900">{driver.languages.join(', ')}</dd>
        </div>
        {vehicleName && (
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-ink-500">Vehicle</dt>
            <dd className="text-right font-semibold text-ink-900">{vehicleName}</dd>
          </div>
        )}
        {vehicleNumber && (
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-ink-500">Registration</dt>
            <dd className="text-right font-mono font-semibold text-ink-900">{vehicleNumber}</dd>
          </div>
        )}
      </dl>

      <p className="mt-4 flex gap-2 rounded-2xl bg-ink-50/70 p-3 text-xs leading-relaxed text-ink-500">
        <IconShield className="mt-0.5 h-4 w-4 shrink-0 text-brand-500" />
        Licence and address on file, uniformed, and no tobacco, pan or gutkha on duty — a standing rule, not a request.
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        <a href={`tel:+91${callNumber}`} className="btn h-10 flex-1 rounded-full bg-ink-900 px-5 text-sm text-white hover:bg-ink-800">
          <IconPhone className="h-3.5 w-3.5" /> Call
        </a>
        <a
          href={whatsappLink('Hello, this is about my booked trip.')}
          target="_blank" rel="noreferrer"
          className="btn h-10 flex-1 rounded-full bg-[#25D366] px-5 text-sm font-semibold text-white hover:bg-[#1FB855]"
        >
          <IconWhatsApp className="h-3.5 w-3.5" /> WhatsApp
        </a>
      </div>

      {sample && (
        <p className="mt-3 text-2xs leading-relaxed text-warn-700">
          This is the example trip, so the buttons above reach the office rather than a chauffeur.
        </p>
      )}
    </div>
  );
}
