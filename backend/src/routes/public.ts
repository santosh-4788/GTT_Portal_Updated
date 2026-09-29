/** Unauthenticated endpoints used by the public marketing website. */
import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { config } from '../config';
import { z } from 'zod';
import { q } from '../db';
import { validateBody, optionalMobile, requiredMobile } from '../utils/validate';
import { limiter } from '../utils/limiter';
import { createInquiryTrip, portalUrl, publicTrip, tripEvents, tripRow } from '../services/tripFlow';
import { SOURCE_LABEL, type InquirySource } from '../services/tripId';
import { sendMail, mailConfig } from '../services/mailer';
import { inquiryAdminEmail, inquiryCustomerEmail } from '../services/emailTemplates';
import { fareFor, groupedRoutes } from '../services/outstationFares';
import { appendChat, linkChatToBooking, validSessionId } from '../services/chatLog';
import { feedbackByToken, publicFeedback, submitFeedback } from '../services/feedback';
import { airportDirectionField, DIRECTION_LABEL } from '../services/airport';
import { publicKnowledge } from '../services/chatbotKnowledge';

const router = Router();

/** Company details shown in the website header/footer — driven by Settings. */
router.get('/company', (_req, res) => {
  const rows = q.all<{ key: string; value: string }>(
    `SELECT key, value FROM settings WHERE category IN ('company','website')`
  );
  const s = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  res.json({
    name: s['company.name'],
    tagline: s['company.tagline'],
    owner: s['company.owner'],
    mobile: s['company.mobile'],
    // The alternate mobile is deliberately not published. It is still in
    // Settings for the letterhead and invoices, but the website shows one
    // number so callers always reach the same place.
    email: s['company.email'],
    address: s['company.address.letterhead'],
    city: s['company.city'],
    state: s['company.state'],
    gstin: s['company.gstin'],
    serviceHours: s['company.serviceHours'],
    heroTitle: s['website.heroTitle'],
    heroSubtitle: s['website.heroSubtitle'],
    whatsapp: s['website.whatsapp'],
  });
});

/**
 * Address suggestions for the public booking bar.
 *
 * Served from the portal's own `locations` table — the pickup and drop points
 * the business already uses, ranked by how often they have been booked. No
 * external geocoding service, so nothing to pay for and nothing to break when
 * the machine is offline.
 */
const lookupLimiter = limiter({
  windowMs: 60 * 1000,
  limit: 120,
  message: { error: 'Too many lookups. Please slow down.' },
});

router.get('/locations', lookupLimiter, (req, res) => {
  const search = String(req.query.search ?? '').trim().slice(0, 60);

  // Match every word the visitor typed, in any order. A single LIKE over the
  // whole phrase missed obvious things — "mumbai airport" never matched
  // "Terminal 2, Chhatrapati Shivaji International Airport, Mumbai".
  const tokens = search.split(/\s+/).filter(Boolean).slice(0, 5);

  const params: Record<string, string> = { prefix: search };
  const clauses = tokens.map((t, i) => {
    params[`t${i}`] = t;
    return `(label LIKE '%'||@t${i}||'%' OR city LIKE '%'||@t${i}||'%')`;
  });
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

  const rows = q.all<{ label: string; city: string; kind: string }>(
    `SELECT label, city, kind FROM locations
     ${where}
      ORDER BY
        CASE WHEN label LIKE @prefix||'%' THEN 0 ELSE 1 END,
        use_count DESC,
        CASE kind WHEN 'AIRPORT' THEN 0 WHEN 'STATION' THEN 1 ELSE 2 END,
        label
      LIMIT 10`,
    params
  );

  res.json({ data: rows });
});

const enquiryLimiter = limiter({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  message: { error: 'Too many enquiries from this device. Please call us on 9967381555 instead.' },
});

/**
 * The retail price list.
 *
 * Only the reserved DIRECT vendor's rows, and only the active ones. Vendor
 * contract rates are deliberately unreachable from here: there is no vendor
 * parameter to pass, so no request can ask for anyone else's numbers.
 */
router.get('/fare-options', lookupLimiter, (_req, res) => {
  const direct = q.get<{ id: number; tax_rate: number | null }>("SELECT id, tax_rate FROM vendors WHERE code = 'DIRECT'");
  if (!direct) return res.json({ data: [], taxRate: 0, taxMode: 'NONE', gstRate: 5 });

  const rows = q.all<any>(
    `SELECT vehicle_category, plan_type, plan_label, included_hours, included_km,
            base_fare, extra_hour_rate, extra_km_rate, per_km_rate, min_km_per_day,
            driver_allowance, notes
       FROM rate_cards
      WHERE vendor_id = @id AND is_active = 1
      ORDER BY display_order, vehicle_category, plan_label`,
    { id: direct.id }
  );

  // The website quotes the rate card as it stands — the office's package
  // prices, with no tax added on top. Invoices still apply their own tax
  // settings; this only decides what a visitor is shown.
  // gstRate is what the office bills walk-in customers (Vendors > Direct
  // Customer), so the calculator's "Add GST" option shows the real rate.
  res.json({ data: rows, taxMode: 'NONE', taxRate: 0, gstRate: Number(direct.tax_rate ?? 5) });
});

/**
 * Which photographs are on disk, so the site shows what exists instead of
 * guessing filenames (lonavala-2.jpg, -3.jpg...) and logging a 404 for every
 * guess that misses. Read live, so dropping a file in still needs no rebuild.
 */
const PHOTO_BUCKETS = ['places', 'needs', 'fleet', 'promo'];
router.get('/photos', lookupLimiter, (_req, res) => {
  const files: string[] = [];
  for (const bucket of PHOTO_BUCKETS) {
    try {
      for (const f of fs.readdirSync(path.join(config.paths.assets, bucket))) {
        if (/\.(jpe?g|png|webp|avif)$/i.test(f)) files.push(`/assets/${bucket}/${f}`);
      }
    } catch { /* bucket missing - nothing in it */ }
  }
  res.set('Cache-Control', 'no-cache').json({ files });
});

/**
 * The website assistant's conversation, saved as it happens so the office can
 * later see exactly what was asked and answered. Append-only (services/chatLog).
 */
const chatLimiter = limiter({
  windowMs: 60 * 1000,
  limit: 60,
  message: { error: 'Too many messages. Please slow down a moment.' },
});
const chatSchema = z.object({
  messages: z.array(z.object({
    seq: z.number().int().min(0).max(99999),
    at: z.string().max(40),
    sender: z.enum(['customer', 'assistant', 'system']),
    text: z.string().max(4000),
    data: z.unknown().optional(),
  })).max(50),
  meta: z.object({
    page: z.string().max(300).optional(),
    name: z.string().max(120).optional(),
    mobile: z.string().max(20).optional(),
    email: z.string().max(160).optional(),
    summary: z.unknown().optional(),
  }).optional().default({}),
});
router.post('/chat/:id', chatLimiter, validateBody(chatSchema), (req, res) => {
  const id = String(req.params.id);
  if (!validSessionId(id)) return res.status(400).json({ error: 'Bad conversation id.' });
  const b = req.body as z.infer<typeof chatSchema>;
  const added = appendChat(id, b.messages as any, {
    ...b.meta,
    userAgent: String(req.headers['user-agent'] ?? '').slice(0, 300),
    ip: (req.ip ?? '').replace('::ffff:', ''),
  });
  res.json({ ok: true, added });
});

/**
 * What the website assistant understands - intents, example questions and
 * synonyms the office maintains under Admin > Chatbot Knowledge. Meanings
 * only: no fare, policy or customer data is in it.
 */
router.get('/chatbot/knowledge', lookupLimiter, (_req, res) => {
  res.set('Cache-Control', 'public, max-age=300').json({ data: publicKnowledge() });
});

/**
 * The outstation fixed-fare routes, for the route and cab selection screens.
 * A null fare is not priced yet and is shown as Fare on request.
 */
router.get('/outstation-fares', lookupLimiter, (_req, res) => {
  const routes = groupedRoutes(true).map((r) => ({
    key: r.key,
    origin: r.origin,
    destination: r.destination,
    fares: r.fares.map(({ category, vehicles, oneWay, return: ret, tollIncluded }) => ({
      category, vehicles, oneWay, return: ret, tollIncluded,
    })),
  }));
  res.json({ data: routes });
});

const enquirySchema = z.object({
  name: z.string().trim().min(2, 'Please enter your name.').max(120),
  mobile: requiredMobile('Please enter a valid 10-digit mobile number.'),
  email: z.union([z.string().email('Enter a valid email address.'), z.literal('')]).optional().default(''),
  service: z.string().trim().max(60).optional().default(''),
  pickup: z.string().trim().max(200).optional().default(''),
  dropOff: z.string().trim().max(200).optional().default(''),
  travelDate: z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.literal('')]).optional().default(''),
  travelTime: z.string().trim().regex(/^([01]?\d|2[0-3]):[0-5]\d$|^$/, 'Time must be HH:MM.').optional().default(''),
  vehicleType: z.string().trim().max(80).optional().default(''),
  passengers: z.coerce.number().int().min(0).max(60).optional().default(0),
  message: z.string().trim().max(1000).optional().default(''),
  /** EMAIL for the website forms, PORTAL when a signed-in customer books. */
  source: z.enum(['EMAIL', 'PORTAL']).optional().default('EMAIL'),
});

/**
 * Turn an enquiry into a trip, then tell both sides about it.
 *
 * The Trip ID is allocated and returned synchronously — that is the one thing
 * the customer sees on screen, so it cannot depend on a mailbox being reachable.
 * The two emails are sent after the response is prepared and their outcome is
 * reported back, but a failure there never fails the enquiry.
 */
async function raiseInquiry(args: {
  source: InquirySource;
  name: string;
  mobile: string;
  email: string;
  pickup: string;
  drop: string;
  travelDate: string;
  travelTime: string;
  vehicleType: string;
  passengers: number;
  message: string;
  serviceLabel: string;
  whatsappMobile?: string;
  customerId?: number | null;
  /** The day a return trip comes back. */
  travelDateTo?: string;
  /** LOCAL | AIRPORT | OUTSTATION | ... so the office's list buckets it right. */
  tripType?: string;
  /** AIRPORT only: TO or FROM the airport. */
  airportDirection?: string;
}) {
  // A journey with no date given is taken as "today" so the office sees it at
  // the top of the sheet rather than filed under a blank date.
  const travelDate = args.travelDate || new Date().toISOString().slice(0, 10);

  const { bookingId, tripId } = createInquiryTrip({
    source: args.source,
    customerName: args.name,
    customerMobile: args.mobile,
    customerEmail: args.email,
    whatsappMobile: args.whatsappMobile,
    pickup: args.pickup || 'To be confirmed',
    drop: args.drop,
    travelDate,
    journeyTime: args.travelTime,
    travelDateTo: args.travelDateTo,
    tripType: args.tripType,
    airportDirection: args.airportDirection,
    vehicleType: args.vehicleType,
    paxCount: args.passengers || 1,
    message: args.message,
    serviceLabel: args.serviceLabel,
    customerId: args.customerId ?? null,
  });

  // The original enquiry list is still written, so nothing that reads it breaks.
  q.run(
    `INSERT INTO enquiries (name, mobile, email, service, pickup, drop_off, travel_date, message)
     VALUES (@name, @mobile, @email, @service, @pickup, @drop, @date, @message)`,
    {
      name: args.name, mobile: args.mobile, email: args.email,
      service: args.serviceLabel, pickup: args.pickup, drop: args.drop,
      date: travelDate || null,
      message: [`Trip ID: ${tripId}`, args.message].filter(Boolean).join('\n'),
    }
  );

  const trip = tripRow('id', bookingId)!;
  const cfg = mailConfig();
  const url = portalUrl();

  // To the office first — that is the one that must not be missed.
  const adminMail = inquiryAdminEmail({
    trip, tripId, sourceLabel: SOURCE_LABEL[args.source], adminUrl: url,
  });
  const toOffice = await sendMail({
    kind: 'INQUIRY_ADMIN',
    to: cfg.adminInbox,
    subject: adminMail.subject,
    html: adminMail.html,
    bookingId,
    tripId,
  });

  let toCustomer: Awaited<ReturnType<typeof sendMail>> | null = null;
  if (args.email) {
    const mail = inquiryCustomerEmail({
      trip, tripId, customerName: args.name, source: args.source, portalUrl: url,
    });
    toCustomer = await sendMail({
      kind: 'INQUIRY_CUSTOMER',
      to: args.email,
      subject: mail.subject,
      html: mail.html,
      bookingId,
      tripId,
    });
  }

  return { bookingId, tripId, trip, toOffice, toCustomer, from: cfg.fromAddress };
}

router.post('/enquiry', enquiryLimiter, validateBody(enquirySchema), async (req, res) => {
  const b = req.body as z.infer<typeof enquirySchema>;

  const out = await raiseInquiry({
    source: b.source as InquirySource,
    name: b.name,
    mobile: b.mobile,
    email: b.email,
    pickup: b.pickup,
    drop: b.dropOff,
    travelDate: b.travelDate,
    travelTime: b.travelTime,
    vehicleType: b.vehicleType,
    passengers: b.passengers,
    message: b.message,
    serviceLabel: b.service,
  });

  res.status(201).json({
    ok: true,
    tripId: out.tripId,
    emailSent: out.toCustomer?.ok ?? false,
    sentFrom: out.from,
    message:
      `Thank you ${b.name}. Your Trip ID is ${out.tripId} — we have your request and will call you on ` +
      `${b.mobile} shortly.` +
      (out.toCustomer?.ok ? ` A confirmation has been emailed to ${b.email}.` : ''),
  });
});

/* --------------------------------------------------------------------------
   WhatsApp enquiry.

   The button still goes straight to WhatsApp — that is what people actually
   use, and wa.me costs nothing. This endpoint runs first so the enquiry is
   recorded and given a Trip ID before the customer leaves the site, and it
   hands back the message text for the chat with that Trip ID already in it.
   Nothing here calls a WhatsApp API; there is no paid service in this path.
   -------------------------------------------------------------------------- */
const whatsappSchema = z.object({
  name: z.string().trim().min(2, 'Please enter your name.').max(120),
  mobile: requiredMobile('Please enter a valid 10-digit contact number.'),
  whatsappMobile: optionalMobile.default(''),
  sameAsContact: z.coerce.boolean().optional().default(true),
  email: z.union([z.string().email('Enter a valid email address.'), z.literal('')]).optional().default(''),
  pickup: z.string().trim().min(2, 'Please enter the pickup address.').max(200),
  dropOff: z.string().trim().max(200).optional().default(''),
  travelDate: z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.literal('')]).optional().default(''),
  travelTime: z.string().trim().regex(/^([01]?\d|2[0-3]):[0-5]\d$|^$/, 'Time must be HH:MM.').optional().default(''),
  vehicleType: z.string().trim().max(80).optional().default(''),
  passengers: z.coerce.number().int().min(0).max(60).optional().default(0),
  message: z.string().trim().max(3000).optional().default(''),
  /**
   * What the customer picked on "What do you need today?" — "Airport transfer",
   * "Wedding", and so on. It becomes the requirement line on the trip, so the
   * office sees the kind of job before reading a word of the message.
   */
  category: z.string().trim().max(60).optional().default(''),
  tripType: z.enum(['LOCAL', 'TRANSFER', 'AIRPORT', 'OUTSTATION', 'ROUND_TRIP', 'PACKAGE'])
    .optional().default('LOCAL'),
  /** AIRPORT only: which way the transfer goes. Asked before the addresses. */
  airportDirection: airportDirectionField,
  /**
   * Which button was pressed.
   *
   * This one endpoint serves both "Send enquiry" and "Send and open WhatsApp",
   * because they save exactly the same thing and only differ in where the
   * customer goes next. Without this every enquiry was filed as a WhatsApp one
   * and the admin's source filter — the whole point of which is telling the
   * channels apart — quietly lied.
   */
  source: z.enum(['EMAIL', 'WHATSAPP']).optional().default('WHATSAPP'),
  /**
   * An outstation booking at a fixed route fare. Only which route, category
   * and leg are taken from the browser; the amount is looked up here, so the
   * office never sees a price the customer's browser made up.
   */
  outstation: z.object({
    routeKey: z.string().trim().min(1).max(60),
    category: z.enum(['STANDARD', 'SUV_MUV', 'PREMIUM_SEDAN', 'PREMIUM_MUV']),
    leg: z.enum(['ONE_WAY', 'RETURN']),
  }).optional(),
  /** The assistant conversation this booking came from, if any. */
  chatSessionId: z.string().trim().max(64).optional().default(''),
  returnDate: z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.literal('')]).optional().default(''),
  returnTime: z.string().trim().regex(/^([01]?\d|2[0-3]):[0-5]\d$|^$/, 'Time must be HH:MM.').optional().default(''),
}).refine((d) => d.sameAsContact || !!d.whatsappMobile, {
  message: 'Enter your WhatsApp number, or tick that it is the same as your contact number.',
  path: ['whatsappMobile'],
})
  /*
   * An email enquiry with no email address has nowhere to go.
   *
   * The address stays optional for a WhatsApp enquiry - the whole point of
   * that button is that the chat is the reply channel, and demanding an
   * address there loses people at the last field. But "Send my enquiry"
   * promises an answer, a Trip ID and later an invoice by email, and it cannot
   * keep that promise without one. Enforced here as well as in the browser:
   * the browser's copy is a courtesy, this is the rule.
   */
  .refine((d) => d.source !== 'EMAIL' || !!d.email, {
    message: 'Please enter your email address - that is where an email enquiry is answered.',
    path: ['email'],
  });

router.post('/whatsapp-enquiry', enquiryLimiter, validateBody(whatsappSchema), async (req, res) => {
  const b = req.body as z.infer<typeof whatsappSchema>;
  const whatsapp = b.sameAsContact ? b.mobile : (b.whatsappMobile || b.mobile);

  // A fixed-fare outstation booking: price it from the master, and refuse it if
  // the fare was changed or withdrawn while the customer had the page open.
  let fareLine = '';
  let vehicleType = b.vehicleType;
  if (b.outstation) {
    const hit = fareFor(b.outstation.routeKey, b.outstation.category, b.outstation.leg);
    if (!hit) {
      return res.status(409).json({
        error: 'That fare has just changed. Please go back and choose the vehicle again.',
      });
    }
    const leg = b.outstation.leg === 'RETURN' ? 'Return trip' : 'One way';
    fareLine = `Fixed fare: Rs ${hit.amount.toLocaleString('en-IN')}${hit.tollIncluded ? ' (toll included)' : ''}`
      + ` - ${hit.row.origin} to ${hit.row.destination}, ${leg}, ${hit.row.vehicles}`;
    vehicleType = vehicleType || hit.row.vehicles;
  }
  const returnLine = b.returnDate
    ? `Return: ${b.returnDate}${b.returnTime ? ` at ${b.returnTime}` : ''}`
    : '';
  const chatLine = b.chatSessionId && validSessionId(b.chatSessionId)
    ? `Website chat ${b.chatSessionId.slice(0, 8)} - the full conversation is in Admin > Chat history.`
    : '';
  const message = [fareLine, returnLine, b.message, chatLine].filter(Boolean).join('\n');

  const out = await raiseInquiry({
    source: b.source,
    name: b.name,
    mobile: b.mobile,
    email: b.email,
    pickup: b.pickup,
    drop: b.dropOff,
    travelDate: b.travelDate,
    travelTime: b.travelTime,
    vehicleType,
    passengers: b.passengers,
    message,
    serviceLabel: b.category || 'WhatsApp enquiry',
    tripType: b.tripType,
    airportDirection: b.airportDirection,
    whatsappMobile: whatsapp,
    travelDateTo: b.returnDate,
  });
  if (b.chatSessionId) linkChatToBooking(b.chatSessionId, out.bookingId, out.tripId);

  // The text the chat opens with. Built here rather than in the browser so the
  // office always receives the same layout whichever screen sent it.
  const L: string[] = [
    `Hello ${q.get<any>("SELECT value FROM settings WHERE key='company.name'")?.value ?? 'Gupta Tours & Travels'},`,
    '',
    `I would like to book a vehicle. My Trip ID is ${out.tripId}.`,
    '',
    `Name: ${b.name}`,
    `Contact: ${b.mobile}`,
  ];
  if (whatsapp && whatsapp !== b.mobile) L.push(`WhatsApp: ${whatsapp}`);
  if (b.email) L.push(`Email: ${b.email}`);
  L.push(`Pickup: ${b.pickup}`);
  if (b.dropOff) L.push(`Drop: ${b.dropOff}`);
  if (b.travelDate) L.push(`Journey date: ${b.travelDate}`);
  if (b.travelTime) L.push(`Journey time: ${b.travelTime}`);
  if (vehicleType) L.push(`Vehicle: ${vehicleType}`);
  if (b.passengers) L.push(`Passengers: ${b.passengers}`);
  if (b.category) L.splice(5, 0, `Requirement: ${b.category}`);
  if (b.tripType === 'AIRPORT' && (b.airportDirection === 'TO' || b.airportDirection === 'FROM')) {
    L.splice(b.category ? 6 : 5, 0, `Airport transfer: ${DIRECTION_LABEL[b.airportDirection]}`);
  }
  if (message) L.push('', `Message: ${message}`);

  res.status(201).json({
    ok: true,
    tripId: out.tripId,
    whatsappText: L.join('\n'),
    emailSent: out.toCustomer?.ok ?? false,
    sentFrom: out.from,
    message: `Your Trip ID is ${out.tripId}. Opening WhatsApp with your details…`,
  });
});

/* --------------------------------------------------------------------------
   Track a trip without signing in.

   Trip IDs run in sequence, so the ID alone is not a secret. The last four
   digits of the mobile on the booking are asked for as well — enough to stop
   somebody walking the numbering, and something the real customer always has.
   -------------------------------------------------------------------------- */
const trackLimiter = limiter({
  windowMs: 10 * 60 * 1000,
  limit: 30,
  message: { error: 'Too many lookups. Please wait a few minutes and try again.' },
});

router.get('/track/:tripId', trackLimiter, (req, res) => {
  const tripId = String(req.params.tripId ?? '').trim().toUpperCase();
  const digits = String(req.query.verify ?? '').replace(/\D/g, '').slice(-4);

  const b = tripRow('trip_id', tripId);
  const onFile = String(b?.customer_mobile || b?.passenger_mobile || '').replace(/\D/g, '').slice(-4);

  // One message whether the trip is missing or the digits are wrong, so this
  // cannot be used to discover which Trip IDs exist.
  if (!b || !digits || digits !== onFile) {
    return res.status(404).json({
      error: 'We could not find that Trip ID with those last four digits. Check both, or call us and we will look it up.',
    });
  }

  res.json({ data: publicTrip(b), timeline: tripEvents(b.id, true) });
});

/* --------------------------------------------------------------------------
   Feedback on a completed trip.

   The link in the feedback email carries a random token, and that token is the
   only key: Trip IDs run in sequence, so they could be walked. One response
   per trip - the form closes on submit unless the office re-opens it.
   -------------------------------------------------------------------------- */
const feedbackLimiter = limiter({
  windowMs: 10 * 60 * 1000,
  limit: 40,
  message: { error: 'Too many attempts. Please wait a few minutes and try again.' },
});

const NOT_FOUND_FEEDBACK = 'This feedback link is not valid. Please use the link from your email, or call us.';

router.get('/feedback/:token', feedbackLimiter, (req, res) => {
  const hit = feedbackByToken(String(req.params.token ?? ''));
  if (!hit) return res.status(404).json({ error: NOT_FOUND_FEEDBACK });
  res.json({ data: publicFeedback(hit.f, hit.b) });
});

const star = (label: string) =>
  z.coerce.number({ invalid_type_error: `Please rate the ${label}.` })
    .int(`Please rate the ${label}.`)
    .min(1, `Please rate the ${label}.`)
    .max(5, `Please rate the ${label} from 1 to 5 stars.`);

const feedbackSchema = z.object({
  driverRating: star('driver'),
  serviceRating: star('service'),
  vehicleRating: star('cab'),
  overallRating: star('overall experience'),
  comments: z.string().trim().max(2000, 'Please keep the comments under 2000 characters.').optional().default(''),
});

router.post('/feedback/:token', feedbackLimiter, validateBody(feedbackSchema), (req, res) => {
  const hit = feedbackByToken(String(req.params.token ?? ''));
  if (!hit) return res.status(404).json({ error: NOT_FOUND_FEEDBACK });

  const err = submitFeedback(hit.f, hit.b, req.body as z.infer<typeof feedbackSchema>);
  if (err) return res.status(409).json({ error: err });

  const again = feedbackByToken(String(req.params.token));
  res.status(201).json({
    ok: true,
    data: again ? publicFeedback(again.f, again.b) : null,
    message: 'Thank You for Your Feedback! Your feedback has been successfully submitted and will help us improve our services.',
  });
});

export default router;
