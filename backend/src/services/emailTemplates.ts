/**
 * The emails the portal sends.
 *
 * Written as inline-styled tables rather than anything modern, because that is
 * what Gmail, Outlook and the iOS mail app all render the same way. No external
 * CSS, no web fonts, no tracking pixels, no images that have to be hosted
 * somewhere — a customer on a phone with images blocked still reads the whole
 * thing.
 *
 * Every template takes plain data and returns { subject, html }. Nothing here
 * touches the database or the transport; that is the mailer's job.
 */
import { q } from '../db';

const BRAND = '#0E82B8';
const BRAND_SOFT = '#EAF4FB';
const INK = '#101C2B';
const MUTED = '#5B6E84';
const LINE = '#E3E8EF';

export interface CompanyBlock {
  name: string;
  legalName: string;
  owner: string;
  mobile: string;
  email: string;
  address: string;
  gstin: string;
  website: string;
}

export function companyBlock(): CompanyBlock {
  const s = Object.fromEntries(
    q.all<{ key: string; value: string }>('SELECT key, value FROM settings').map((r) => [r.key, r.value ?? ''])
  );
  return {
    name: s['company.name'] || 'Gupta Tours & Travels',
    legalName: s['company.legalName'] || s['company.name'] || 'Gupta Tours & Travels',
    owner: s['company.owner'] || 'Vinay Gupta',
    mobile: s['company.mobile'] || '9967381555',
    email: s['email.fromAddress'] || s['company.email'] || 'vinaykumar87674@gmail.com',
    address: s['company.address.letterhead'] || '',
    gstin: s['company.gstin'] || '',
    website: s['website.publicUrl'] || '',
  };
}

const esc = (v: unknown): string =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

export const money = (v: any) =>
  '₹' + Number(v ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const dmy = (iso?: string | null): string => {
  if (!iso) return '—';
  const d = new Date(String(iso).length === 10 ? `${iso}T00:00:00` : String(iso));
  return isNaN(d.getTime())
    ? String(iso)
    : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
};

/** "07:00" -> "7:00 AM". Times are typed as HH:MM everywhere in the portal. */
export const hhmm = (t?: string | null): string => {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(t ?? '').trim());
  if (!m) return String(t ?? '') || '—';
  const h = Number(m[1]);
  const suffix = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m[2]} ${suffix}`;
};

/* ==========================================================================
   Shared chrome
   ========================================================================== */

export interface Row {
  label: string;
  value: string | number | null | undefined;
  /** Render the value in the brand colour and bold — used for the Trip ID. */
  strong?: boolean;
}

/** A label/value table. Two columns on a desktop, still readable on a phone. */
export function detailTable(rows: Row[]): string {
  const body = rows
    .filter((r) => r.value !== null && r.value !== undefined && String(r.value).trim() !== '')
    .map(
      (r) => `
      <tr>
        <td style="padding:9px 14px 9px 0;font-size:13px;color:${MUTED};white-space:nowrap;vertical-align:top;border-bottom:1px solid ${LINE};">${esc(r.label)}</td>
        <td style="padding:9px 0;font-size:14px;color:${r.strong ? BRAND : INK};font-weight:${r.strong ? 700 : 500};vertical-align:top;border-bottom:1px solid ${LINE};">${esc(r.value)}</td>
      </tr>`
    )
    .join('');
  return `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;margin:4px 0 0;">${body}</table>`;
}

export function sectionTitle(text: string): string {
  return `<p style="margin:26px 0 6px;font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:${MUTED};">${esc(text)}</p>`;
}

export function tripIdBadge(tripId: string): string {
  return `
  <table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:separate;margin:18px 0 4px;">
    <tr>
      <td style="background:${BRAND_SOFT};border:1px solid #C7E4F5;border-radius:10px;padding:12px 18px;">
        <span style="display:block;font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:${MUTED};">Your Trip ID</span>
        <span style="display:block;margin-top:3px;font-family:Consolas,'Courier New',monospace;font-size:19px;font-weight:700;color:${BRAND};letter-spacing:.02em;">${esc(tripId)}</span>
      </td>
    </tr>
  </table>`;
}

export function button(label: string, href: string): string {
  if (!href) return '';
  return `
  <table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px 0 6px;">
    <tr><td style="background:${BRAND};border-radius:999px;">
      <a href="${esc(href)}" style="display:inline-block;padding:12px 26px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;">${esc(label)}</a>
    </td></tr>
  </table>`;
}

export function note(text: string): string {
  return `<p style="margin:18px 0 0;padding:12px 14px;background:#F5F7FA;border-left:3px solid ${BRAND};border-radius:0 8px 8px 0;font-size:13px;line-height:1.6;color:${MUTED};">${text}</p>`;
}

/**
 * Wrap body HTML in the branded shell.
 *
 * `preheader` is the grey line the inbox shows next to the subject. Without one
 * the client picks the first words of the header, which reads as noise.
 */
export function layout(args: {
  title: string;
  preheader: string;
  body: string;
  company?: CompanyBlock;
}): string {
  const c = args.company ?? companyBlock();
  /*
   * The footer dials; it does not print.
   *
   * A phone number sitting in plain text at the bottom of every message is
   * what gets scraped and resold, and an enquiry acknowledgement went out
   * carrying the office's alternate line beside the GSTIN and the address.
   * "Call us" is a `tel:` link — the recipient's phone opens its dialler with
   * the number already in it, and nothing anywhere displays the digits.
   */
  const callLink = c.mobile
    ? `<a href="tel:+91${esc(c.mobile)}" style="color:${BRAND};text-decoration:none;font-weight:600;">Call us</a>`
    : '';

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(args.title)}</title></head>
<body style="margin:0;padding:0;background:#F5F7FA;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(args.preheader)}</div>
<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#F5F7FA;padding:24px 12px;">
  <tr><td align="center">
    <table role="presentation" cellpadding="0" cellspacing="0" width="600" style="max-width:600px;width:100%;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(16,28,43,.08);font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">

      <tr><td style="background:${BRAND_SOFT};border-bottom:3px solid ${BRAND};padding:24px 32px;">
        <p style="margin:0;font-size:18px;font-weight:700;color:${INK};letter-spacing:-.01em;">${esc(c.name)}</p>
        <p style="margin:3px 0 0;font-size:12px;color:${MUTED};">Corporate Transport · Car Rental · Outstation</p>
      </td></tr>

      <tr><td style="padding:30px 32px 34px;">
        <h1 style="margin:0 0 10px;font-size:21px;font-weight:700;color:${INK};letter-spacing:-.02em;line-height:1.3;">${esc(args.title)}</h1>
        ${args.body}
      </td></tr>

      <tr><td style="padding:20px 32px 26px;background:#FAFBFC;border-top:1px solid ${LINE};">
        <p style="margin:0 0 4px;font-size:13px;font-weight:600;color:${INK};">${esc(c.legalName)}</p>
        ${c.address ? `<p style="margin:0 0 6px;font-size:12px;line-height:1.6;color:${MUTED};">${esc(c.address)}</p>` : ''}
        <p style="margin:0;font-size:12px;color:${MUTED};">
          ${callLink ? callLink + ' &nbsp;·&nbsp; ' : ''}<a href="mailto:${esc(c.email)}" style="color:${BRAND};text-decoration:none;">${esc(c.email)}</a>
        </p>
        ${c.gstin ? `<p style="margin:6px 0 0;font-size:11px;color:#9DAAB9;">GSTIN ${esc(c.gstin)}</p>` : ''}
      </td></tr>

    </table>
  </td></tr>
</table>
</body></html>`;
}

/* ==========================================================================
   The trip block — reused by three different emails
   ========================================================================== */

export interface TripLike {
  trip_id?: string | null;
  travel_date?: string | null;
  reporting_time?: string | null;
  trip_type?: string | null;
  pickup_location?: string | null;
  pickup_address?: string | null;
  drop_location?: string | null;
  drop_address?: string | null;
  vehicle_type?: string | null;
  vehicle_number?: string | null;
  driver_name?: string | null;
  driver_mobile?: string | null;
  passenger_name?: string | null;
  passenger_mobile?: string | null;
  customer_name?: string | null;
  customer_mobile?: string | null;
  customer_email?: string | null;
  pax_count?: number | null;
  inquiry_message?: string | null;
  special_instructions?: string | null;
  remarks?: string | null;
}

export function journeyRows(t: TripLike): Row[] {
  return [
    { label: 'Journey date', value: dmy(t.travel_date) },
    { label: 'Pickup time', value: t.reporting_time ? hhmm(t.reporting_time) : '' },
    { label: 'Pickup', value: t.pickup_address || t.pickup_location },
    { label: 'Drop', value: t.drop_address || t.drop_location },
    { label: 'Vehicle type', value: t.vehicle_type },
    { label: 'Passengers', value: t.pax_count ? String(t.pax_count) : '' },
  ];
}

/* ==========================================================================
   1. Enquiry received — to the customer
   ========================================================================== */

export function inquiryCustomerEmail(args: {
  trip: TripLike;
  tripId: string;
  customerName: string;
  source: 'EMAIL' | 'WHATSAPP' | 'PORTAL' | 'WALKIN' | 'VENDOR';
  portalUrl?: string;
}): { subject: string; html: string } {
  const c = companyBlock();
  const via =
    args.source === 'WHATSAPP' ? 'through WhatsApp'
      : args.source === 'PORTAL' ? 'on the website'
        : args.source === 'WALKIN' ? 'over the phone'
          : 'on the website';

  const body = `
    <p style="margin:0 0 4px;font-size:15px;line-height:1.65;color:${INK};">
      Dear ${esc(args.customerName || 'Customer')},
    </p>
    <p style="margin:10px 0 0;font-size:14px;line-height:1.7;color:${MUTED};">
      Thank you for your enquiry ${esc(via)}. We have it, and ${esc(c.owner)}'s desk will call you shortly
      with the rate and to confirm the vehicle. Please quote the Trip ID below in any message or call.
    </p>
    ${tripIdBadge(args.tripId)}
    ${sectionTitle('Your journey')}
    ${detailTable(journeyRows(args.trip))}
    ${args.trip.inquiry_message ? sectionTitle('What you told us') + `<p style="margin:6px 0 0;font-size:14px;line-height:1.7;color:${INK};white-space:pre-wrap;">${esc(args.trip.inquiry_message)}</p>` : ''}
    ${args.portalUrl ? button('Track this trip', `${args.portalUrl}/trips/${encodeURIComponent(args.tripId)}`) : ''}
    ${note(
      `Nothing is charged yet. This is an enquiry — the fare is confirmed by our desk before the vehicle is allotted. ` +
      `To change anything, reply to this email or call <strong style="color:${INK};">+91 ${esc(c.mobile)}</strong>.`
    )}`;

  return {
    subject: `Enquiry received — ${args.tripId} | ${c.name}`,
    html: layout({
      title: 'We have your enquiry',
      preheader: `Trip ID ${args.tripId}. Our desk will call you shortly with the rate.`,
      body,
      company: c,
    }),
  };
}

/* ==========================================================================
   2. Enquiry received — to the office
   ========================================================================== */

export function inquiryAdminEmail(args: {
  trip: TripLike;
  tripId: string;
  sourceLabel: string;
  adminUrl?: string;
}): { subject: string; html: string } {
  const t = args.trip;
  const contactRows: Row[] = [
    { label: 'Trip ID', value: args.tripId, strong: true },
    { label: 'Source', value: args.sourceLabel },
    { label: 'Name', value: t.customer_name || t.passenger_name },
    { label: 'Mobile', value: t.customer_mobile || t.passenger_mobile },
    { label: 'Email', value: t.customer_email },
  ];

  const body = `
    <p style="margin:0;font-size:14px;line-height:1.7;color:${MUTED};">
      A new enquiry has come in and is already saved in the portal against the Trip ID below.
    </p>
    ${sectionTitle('Customer')}
    ${detailTable(contactRows)}
    ${sectionTitle('Journey')}
    ${detailTable(journeyRows(t))}
    ${t.inquiry_message ? sectionTitle('Message') + `<p style="margin:6px 0 0;font-size:14px;line-height:1.7;color:${INK};white-space:pre-wrap;">${esc(t.inquiry_message)}</p>` : ''}
    ${args.adminUrl ? button('Open in the portal', `${args.adminUrl}/admin/trips?search=${encodeURIComponent(args.tripId)}`) : ''}`;

  return {
    subject: `New ${args.sourceLabel.toLowerCase()} — ${args.tripId} — ${t.customer_name || t.passenger_name || 'Customer'}`,
    html: layout({
      title: `New ${args.sourceLabel.toLowerCase()}`,
      preheader: `${args.tripId} · ${t.customer_name || t.passenger_name || ''} · ${dmy(t.travel_date)}`,
      body,
    }),
  };
}

/* ==========================================================================
   3. Vehicle and driver assigned — to the customer
   ========================================================================== */

export function tripDetailsEmail(args: {
  trip: TripLike;
  tripId: string;
  customerName: string;
  fareTotal?: number | null;
  portalUrl?: string;
  message?: string;
}): { subject: string; html: string } {
  const c = companyBlock();
  const t = args.trip;

  const carRows: Row[] = [
    { label: 'Vehicle', value: [t.vehicle_type, t.vehicle_number].filter(Boolean).join(' · ') },
    { label: 'Driver', value: t.driver_name },
    { label: 'Driver mobile', value: t.driver_mobile ? `+91 ${t.driver_mobile}` : '' },
  ];

  const body = `
    <p style="margin:0 0 4px;font-size:15px;line-height:1.65;color:${INK};">
      Dear ${esc(args.customerName || 'Customer')},
    </p>
    <p style="margin:10px 0 0;font-size:14px;line-height:1.7;color:${MUTED};">
      Your trip is confirmed. The vehicle and chauffeur below have been allotted — the driver will
      call you before pickup.
    </p>
    ${tripIdBadge(args.tripId)}
    ${sectionTitle('Vehicle and chauffeur')}
    ${detailTable(carRows)}
    ${sectionTitle('Your journey')}
    ${detailTable(journeyRows(t))}
    ${typeof args.fareTotal === 'number' && args.fareTotal > 0
      ? sectionTitle('Agreed fare') + detailTable([{ label: 'Total', value: money(args.fareTotal), strong: true }])
      : ''}
    ${t.special_instructions ? sectionTitle('Notes') + `<p style="margin:6px 0 0;font-size:14px;line-height:1.7;color:${INK};white-space:pre-wrap;">${esc(t.special_instructions)}</p>` : ''}
    ${args.message ? note(esc(args.message)) : ''}
    ${args.portalUrl ? button('View trip', `${args.portalUrl}/trips/${encodeURIComponent(args.tripId)}`) : ''}
    ${note(
      `Please have the Trip ID handy. For any change call <strong style="color:${INK};">+91 ${esc(c.mobile)}</strong> — ` +
      `we answer round the clock.`
    )}`;

  return {
    subject: `Vehicle allotted — ${args.tripId} | ${dmy(t.travel_date)}`,
    html: layout({
      title: 'Your vehicle and chauffeur',
      preheader: `${t.vehicle_type ?? 'Vehicle'} ${t.vehicle_number ?? ''} · ${t.driver_name ?? ''} · ${dmy(t.travel_date)}`,
      body,
      company: c,
    }),
  };
}

/* ==========================================================================
   4. Invoice — to the customer
   ========================================================================== */

export function invoiceEmail(args: {
  trip: TripLike | null;
  tripId?: string | null;
  customerName: string;
  invoiceNumber: string;
  invoiceDate: string;
  total: number;
  taxMode: string;
  taxRate: number;
  taxAmount: number;
  attached: boolean;
  portalUrl?: string;
  message?: string;
}): { subject: string; html: string } {
  const c = companyBlock();
  const gst = args.taxMode === 'NONE' || !args.taxAmount
    ? 'This is a non-GST invoice.'
    : `Includes ${args.taxMode === 'CGST_SGST' ? 'CGST + SGST' : 'IGST'} at ${args.taxRate}% (${money(args.taxAmount)}).`;

  const rows: Row[] = [
    { label: 'Invoice number', value: args.invoiceNumber, strong: true },
    { label: 'Invoice date', value: dmy(args.invoiceDate) },
    { label: 'Trip ID', value: args.tripId ?? '' },
    { label: 'Journey date', value: args.trip ? dmy(args.trip.travel_date) : '' },
    { label: 'Route', value: args.trip ? [args.trip.pickup_location, args.trip.drop_location].filter(Boolean).join('  →  ') : '' },
    { label: 'Amount payable', value: money(args.total), strong: true },
  ];

  const body = `
    <p style="margin:0 0 4px;font-size:15px;line-height:1.65;color:${INK};">
      Dear ${esc(args.customerName || 'Customer')},
    </p>
    <p style="margin:10px 0 0;font-size:14px;line-height:1.7;color:${MUTED};">
      Thank you for travelling with ${esc(c.name)}. Your invoice for the completed trip is below${
        args.attached ? ', and the PDF is attached to this email' : ''
      }.
    </p>
    ${sectionTitle('Invoice')}
    ${detailTable(rows)}
    <p style="margin:14px 0 0;font-size:12px;color:${MUTED};">${esc(gst)}</p>
    ${args.message ? note(esc(args.message)) : ''}
    ${args.portalUrl ? button('View and download invoice', `${args.portalUrl}/trips/${encodeURIComponent(args.tripId ?? '')}`) : ''}
    ${note(
      `The invoice also sits in your account on our website, under the same Trip ID, and can be downloaded ` +
      `at any time. For anything that looks wrong, reply to this email and we will correct it.`
    )}`;

  return {
    subject: `Invoice ${args.invoiceNumber}${args.tripId ? ` — ${args.tripId}` : ''} | ${c.name}`,
    html: layout({
      title: `Invoice ${args.invoiceNumber}`,
      preheader: `${money(args.total)} for trip ${args.tripId ?? ''}. PDF attached.`,
      body,
      company: c,
    }),
  };
}

/* ==========================================================================
   5. Account created
   ========================================================================== */

/**
 * "Somebody cannot get in."
 *
 * There is no self-service reset in this portal, by choice: a handful of staff
 * accounts with one owner does not need a token flow, and a reset link in an
 * inbox is a way in for anybody who reaches that inbox. So the request is an
 * email to the owner, who resets the password himself and tells the person.
 *
 * It carries everything needed to decide whether the request is genuine —
 * which account, which role, when, and from which address — and no link that
 * would do anything on its own.
 */
export function passwordResetRequestEmail(args: {
  loginId: string;
  fullName: string;
  roleName: string;
  requestedAt: string;
  ip: string;
  portalUrl?: string;
}): { subject: string; html: string } {
  const c = companyBlock();
  const rows: Row[] = [
    { label: 'Login ID', value: args.loginId, strong: true },
    { label: 'Name', value: args.fullName },
    { label: 'Role', value: args.roleName },
    { label: 'Asked at', value: args.requestedAt },
    { label: 'From', value: args.ip },
  ];

  const body = `
    <p style="margin:0;font-size:15px;line-height:1.65;color:${INK};">
      <strong>${esc(args.fullName || args.loginId)}</strong> cannot sign in to the portal and has
      asked for the password to be reset.
    </p>
    ${sectionTitle('The request')}
    ${detailTable(rows)}
    ${sectionTitle('What to do')}
    <p style="margin:8px 0 0;font-size:14px;line-height:1.7;color:${MUTED};">
      Open <strong style="color:${INK};">Settings &rarr; Users</strong> in the portal, set a new
      password on this account, and tell the person what it is. They will be asked to change it the
      first time they sign in, so the one you set is temporary.
    </p>
    ${args.portalUrl ? button('Open Settings &rarr; Users', `${args.portalUrl}/admin/settings/users`) : ''}
    ${note('Nothing has been changed by this email. If you were not expecting the request, ignore it — the account is untouched and no reset link exists.')}`;

  return {
    subject: `Password reset requested — ${args.loginId}`,
    html: layout({
      title: 'Password reset requested',
      preheader: `${args.fullName || args.loginId} cannot sign in to the portal.`,
      body,
      company: c,
    }),
  };
}

export function welcomeEmail(args: {
  customerName: string;
  email: string;
  portalUrl?: string;
  viaGoogle?: boolean;
}): { subject: string; html: string } {
  const c = companyBlock();
  const body = `
    <p style="margin:0 0 4px;font-size:15px;line-height:1.65;color:${INK};">
      Dear ${esc(args.customerName || 'Customer')},
    </p>
    <p style="margin:10px 0 0;font-size:14px;line-height:1.7;color:${MUTED};">
      Your ${esc(c.name)} account is ready. Sign in with
      <strong style="color:${INK};">${esc(args.email)}</strong>${args.viaGoogle ? ' using Google' : ''} to see every
      trip you have booked with us — status, allotted vehicle and driver, and invoices to download.
    </p>
    ${sectionTitle('What you will find there')}
    <ul style="margin:8px 0 0;padding-left:20px;font-size:14px;line-height:1.9;color:${MUTED};">
      <li>Every enquiry and booking under its own Trip ID</li>
      <li>Live status, from enquiry through to completion</li>
      <li>Vehicle and chauffeur details once allotted</li>
      <li>GST and non-GST invoices, ready to download or print</li>
    </ul>
    ${args.portalUrl ? button('Open my trips', `${args.portalUrl}/trips`) : ''}
    ${note(`If you did not create this account, ignore this email or tell us on +91 ${esc(c.mobile)}.`)}`;

  return {
    subject: `Your ${c.name} account is ready`,
    html: layout({
      title: 'Welcome aboard',
      preheader: 'Track your trips, vehicles, drivers and invoices in one place.',
      body,
      company: c,
    }),
  };
}
