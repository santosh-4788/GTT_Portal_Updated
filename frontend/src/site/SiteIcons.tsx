/**
 * Maps the public site's content to its icon, so the data files stay free of
 * presentation and the site stops mixing emoji with drawn icons.
 */
import {
  IconPlane, IconCity, IconRoad, IconVendors, IconMap, IconEvent,
  IconClock, IconInvoices, IconShield, IconSteering, IconPhone, IconBookings,
} from '../components/icons';

/** Seats. Drawn rather than borrowed: the admin set has no passenger glyph. */
export function IconSeat({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M6 4v9a3 3 0 0 0 3 3h6" />
      <path d="M6 16h11a3 3 0 0 1 3 3v1" />
      <path d="M4 20h3" />
    </svg>
  );
}

/** Luggage. */
export function IconLuggage({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <rect x="4" y="7" width="16" height="13" rx="2.5" />
      <path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
      <path d="M9.5 11.5v5M14.5 11.5v5" />
    </svg>
  );
}

/** WhatsApp mark. Lives with the site icons — the admin palette has no use for it. */
export function IconWhatsApp({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38a9.9 9.9 0 0 0 4.79 1.22h.01c5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0 0 12.04 2Zm0 18.15h-.01a8.2 8.2 0 0 1-4.19-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.19 8.19 0 0 1-1.26-4.38c0-4.54 3.7-8.23 8.25-8.23a8.2 8.2 0 0 1 8.24 8.24c0 4.54-3.7 8.23-8.24 8.23Zm4.52-6.16c-.25-.13-1.47-.72-1.69-.81-.23-.08-.39-.12-.56.13-.16.24-.64.8-.79.97-.14.16-.29.18-.54.06-.25-.13-1.05-.39-1.99-1.23-.74-.66-1.23-1.47-1.38-1.72-.14-.25-.01-.38.11-.5.11-.11.25-.29.37-.44.13-.14.17-.25.25-.41.09-.17.04-.31-.02-.44-.06-.12-.56-1.34-.76-1.84-.2-.48-.41-.42-.56-.43h-.48c-.16 0-.43.06-.65.31-.23.25-.86.84-.86 2.05s.88 2.38 1 2.54c.12.17 1.73 2.64 4.19 3.7.59.26 1.04.41 1.4.52.59.19 1.12.16 1.55.1.47-.07 1.47-.6 1.68-1.18.2-.58.2-1.08.14-1.18-.06-.11-.22-.17-.47-.29Z" />
    </svg>
  );
}

const SERVICE_ICONS: Record<string, (p: any) => JSX.Element> = {
  'airport-transfers': IconPlane,
  'local-travel': IconCity,
  'outstation-travel': IconRoad,
  'corporate-travel': IconVendors,
  'tour-packages': IconMap,
  'event-transport': IconEvent,
};

const BENEFIT_ICONS: Record<string, (p: any) => JSX.Element> = {
  '24×7 Availability': IconClock,
  'Transparent Billing': IconInvoices,
  'Well-Maintained Fleet': IconShield,
  'Professional Chauffeurs': IconSteering,
  'GST-Compliant Invoices': IconBookings,
  'One Point of Contact': IconPhone,
};

export function ServiceIcon({ slug, className = 'h-5 w-5' }: { slug: string; className?: string }) {
  const Cmp = SERVICE_ICONS[slug] ?? IconRoad;
  return <Cmp className={className} />;
}

export function BenefitIcon({ title, className = 'h-5 w-5' }: { title: string; className?: string }) {
  const Cmp = BENEFIT_ICONS[title] ?? IconShield;
  return <Cmp className={className} />;
}
