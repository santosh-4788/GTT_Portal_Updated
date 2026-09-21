/**
 * Seed script.
 *
 * Creates: roles, permissions, the default administrator, real company settings
 * (recovered from the business's own letterhead and Wagon invoice), the current
 * financial year, the Wagon XLSX invoice template with its cell mapping, and a
 * clearly-marked set of demo vendors/bookings.
 *
 * Safe to re-run: everything is INSERT OR IGNORE / upsert.
 */
import bcrypt from 'bcryptjs';
import fs from 'fs';
import path from 'path';
import { getDb, applySchema, closeDb } from './index';
import { config, ensureDirectories } from '../config';
import { ensureDirectVendor } from '../services/directCustomer';
import { computeCharges } from '../services/billing';

const db = () => getDb();

// ---------------------------------------------------------------------------
// Roles & permissions
// ---------------------------------------------------------------------------
const MODULES = [
  'dashboard', 'bookings', 'vendors', 'billing',
  'invoices', 'payments', 'reports', 'settings', 'users', 'audit',
] as const;

const ACTIONS = ['view', 'create', 'update', 'delete'] as const;

const ROLES: { code: string; name: string; description: string; perms: string[] | '*' }[] = [
  { code: 'SUPER_ADMIN', name: 'Super Admin', description: 'Full access to everything', perms: '*' },
  {
    code: 'ADMIN', name: 'Admin', description: 'All operational modules, no user management',
    perms: ['dashboard', 'bookings', 'vendors', 'billing', 'invoices', 'payments', 'reports', 'settings']
      .flatMap((m) => ACTIONS.map((a) => `${m}.${a}`)).concat(['audit.view', 'users.view']),
  },
  {
    code: 'BILLING', name: 'Billing User', description: 'Billing, invoices and payments',
    perms: ['dashboard.view', 'bookings.view', 'bookings.update', 'vendors.view']
      .concat(['billing', 'invoices', 'payments'].flatMap((m) => ACTIONS.map((a) => `${m}.${a}`)))
      .concat(['reports.view']),
  },
  {
    code: 'OPERATIONS', name: 'Operations User', description: 'Booking entry and vendor lookup',
    perms: ['dashboard.view', 'vendors.view', 'reports.view', 'billing.view']
      .concat(ACTIONS.map((a) => `bookings.${a}`)),
  },
  {
    code: 'VIEWER', name: 'View Only', description: 'Read-only across the portal',
    perms: MODULES.filter((m) => m !== 'users' && m !== 'settings').map((m) => `${m}.view`),
  },
];

function seedRolesAndPermissions() {
  const d = db();
  const insPerm = d.prepare(
    'INSERT OR IGNORE INTO permissions (code, module, description) VALUES (?, ?, ?)'
  );
  for (const m of MODULES) {
    for (const a of ACTIONS) {
      // dashboard/audit are view-only concepts
      if ((m === 'dashboard' || m === 'audit') && a !== 'view') continue;
      insPerm.run(`${m}.${a}`, m, `${a} ${m}`);
    }
  }

  const insRole = d.prepare(
    'INSERT OR IGNORE INTO roles (code, name, description) VALUES (?, ?, ?)'
  );
  const allPerms = d.prepare('SELECT id, code FROM permissions').all() as { id: number; code: string }[];
  const permByCode = new Map(allPerms.map((p) => [p.code, p.id]));

  const link = d.prepare(
    'INSERT OR IGNORE INTO role_permissions (role_id, permission_id) VALUES (?, ?)'
  );

  for (const r of ROLES) {
    insRole.run(r.code, r.name, r.description);
    const roleId = (d.prepare('SELECT id FROM roles WHERE code = ?').get(r.code) as any).id as number;
    const codes = r.perms === '*' ? allPerms.map((p) => p.code) : r.perms;
    for (const c of codes) {
      const pid = permByCode.get(c);
      if (pid) link.run(roleId, pid);
    }
  }
  console.log(`  roles: ${ROLES.length}, permissions: ${allPerms.length}`);
}

// ---------------------------------------------------------------------------
// Default administrator
// ---------------------------------------------------------------------------
function seedAdminUser() {
  const d = db();
  const existing = d.prepare('SELECT id FROM users WHERE lower(email) = lower(?)')
    .get(config.seedAdmin.email) as { id: number } | undefined;
  if (existing) {
    console.log('  admin user already exists — left untouched');
    return;
  }
  const roleId = (d.prepare("SELECT id FROM roles WHERE code = 'SUPER_ADMIN'").get() as any).id;
  const hash = bcrypt.hashSync(config.seedAdmin.password, 12);
  d.prepare(
    `INSERT INTO users (email, full_name, password_hash, role_id, mobile, is_active, must_change_password)
     VALUES (?, ?, ?, ?, ?, 1, 1)`
  ).run(config.seedAdmin.email, config.seedAdmin.fullName, hash, roleId, '9967381555');
  console.log(`  admin created: ${config.seedAdmin.email} (password change forced on first login)`);
}

// ---------------------------------------------------------------------------
// Company settings — REAL data recovered from Letter_Head.jpg and the Wagon invoice.
// Nothing here is invented.
// ---------------------------------------------------------------------------
const SETTINGS: [string, string, string, string, string][] = [
  // key, value, category, type, label
  ['company.name', 'Gupta Tours & Travels', 'company', 'string', 'Company Name'],
  ['company.legalName', 'GUPTA TOURS AND TRAVELS', 'company', 'string', 'Legal Name (as on invoice)'],
  ['company.tagline', 'Corporate Transport Car Rental and Outstation', 'company', 'string', 'Tagline'],
  ['company.owner', 'Vinay Gupta', 'company', 'string', 'Owner / Authorised Signatory'],
  ['company.mobile', '9967381555', 'company', 'string', 'Primary Mobile'],
  ['company.altMobile2', '8591134747', 'company', 'string', 'Alternate Mobile 2'],

  // Addresses and road distance. The limit is ours, not the provider's — at
  // this number the portal stops calling out for the rest of the month.
  ['maps.enabled', 'true', 'maps', 'boolean', 'Look up addresses and distance'],
  ['maps.monthlyLimit', '2000', 'maps', 'number', 'Address/distance lookups allowed per month'],
  ['company.email', 'vinaykumar87674@gmail.com', 'company', 'string', 'Email'],
  ['company.address.letterhead',
    'P-8, Building, New Aman CHS Ltd., Ajit Glass Garden Road, Goregaon (W), Mumbai - 400 104',
    'company', 'string', 'Address (letterhead form, used on the website)'],
  ['company.address.invoice',
    '706 P-8, New Aman Society, Ajit Glass Garden Road, Somani Gram, Ram Mandir, Goregaon (West).',
    'company', 'string', 'Address line 1 (invoice form)'],
  ['company.address.invoice2', 'Mumbai - 400104. Maharashtra.', 'company', 'string', 'Address line 2 (invoice form)'],
  ['company.city', 'Mumbai', 'company', 'string', 'City'],
  ['company.state', 'Maharashtra', 'company', 'string', 'State'],
  ['company.stateCode', '27', 'company', 'string', 'GST State Code'],
  ['company.pincode', '400104', 'company', 'string', 'Pincode'],
  ['company.gstin', '27ALRPG8019M1ZH', 'company', 'string', 'GSTIN'],
  ['company.pan', 'ALRPG8019M', 'company', 'string', 'PAN'],
  ['company.serviceHours', '24x7 Service', 'company', 'string', 'Service Hours'],

  ['bank.name', 'SBI (Goregaon West)', 'bank', 'string', 'Bank Name'],
  ['bank.accountNumber', '30266344366', 'bank', 'string', 'Account Number'],
  ['bank.ifsc', 'SBIN0001266', 'bank', 'string', 'IFSC Code'],
  ['bank.upi', '', 'bank', 'string', 'UPI ID'],

  ['invoice.defaultPrefix', 'GTT', 'invoice', 'string', 'Default Invoice Prefix'],
  ['invoice.numberFormat', '{PREFIX}/{FY}/{SEQ:5}', 'invoice', 'string', 'Invoice Number Format'],
  ['invoice.defaultTitle', 'Tax Invoice', 'invoice', 'string', 'Default Document Title'],
  ['invoice.defaultTaxMode', 'IGST', 'invoice', 'string', 'Default Tax Mode'],
  ['invoice.defaultTaxRate', '5', 'invoice', 'number', 'Default Tax Rate %'],
  ['invoice.currency', 'INR', 'invoice', 'string', 'Currency'],
  ['invoice.currencySymbol', '₹', 'invoice', 'string', 'Currency Symbol'],
  ['invoice.tollParkingTaxable', 'false', 'invoice', 'boolean', 'Toll & Parking included in taxable value'],

  ['website.heroTitle', 'Your Trusted Travel Partner', 'website', 'string', 'Hero Title'],
  ['website.heroSubtitle', 'Comfortable Journeys. Reliable Service. Transparent Billing.', 'website', 'string', 'Hero Subtitle'],
  ['website.whatsapp', '9967381555', 'website', 'string', 'WhatsApp Number'],
  // Used to build the "Track this trip" links inside emails. Leave blank while
  // the portal only runs on this machine; set it to the public address (or the
  // ngrok URL) when customers reach the site from outside.
  ['website.publicUrl', '', 'website', 'string', 'Public website address (for links in emails)'],

  // --- Email -----------------------------------------------------------------
  // Everything the portal sends goes out from this mailbox: enquiry
  // acknowledgements, trip details and invoices. Gmail's own SMTP is used, which
  // is free — the only setup is a Google App Password, which belongs in
  // backend\.env as MAIL_APP_PASSWORD rather than in this table.
  ['email.enabled', 'true', 'email', 'boolean', 'Send emails from the portal'],
  ['email.fromAddress', 'vinaykumar87674@gmail.com', 'email', 'string', 'Send all email from'],
  ['email.fromName', 'Gupta Tours & Travels', 'email', 'string', 'Sender name shown to customers'],
  ['email.replyTo', 'vinaykumar87674@gmail.com', 'email', 'string', 'Reply-to address'],
  ['email.adminInbox', 'vinaykumar87674@gmail.com', 'email', 'string', 'Where customer enquiries are delivered'],
  ['email.host', 'smtp.gmail.com', 'email', 'string', 'SMTP host'],
  ['email.port', '465', 'email', 'number', 'SMTP port'],
  ['email.secure', 'true', 'email', 'boolean', 'Use SSL (port 465)'],
  ['email.user', 'vinaykumar87674@gmail.com', 'email', 'string', 'SMTP login (the Gmail address)'],
  ['email.appPassword', '', 'email', 'string', 'Gmail App Password (16 characters, no spaces)'],

  // --- Customer sign-in --------------------------------------------------------
  // Blank hides the Google button entirely; the email + password sign-in always
  // works. A Google OAuth client ID is free to create in Google Cloud Console.
  ['auth.googleClientId', '', 'auth', 'string', 'Google Sign-In client ID (leave blank to hide the button)'],
];

function seedSettings() {
  const d = db();
  const stmt = d.prepare(
    `INSERT INTO settings (key, value, category, data_type, label) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET category = excluded.category,
                                    data_type = excluded.data_type,
                                    label = excluded.label`
  );
  for (const s of SETTINGS) stmt.run(...s);
  console.log(`  settings: ${SETTINGS.length}`);
}

// ---------------------------------------------------------------------------
// Financial year (Indian FY: 1 Apr – 31 Mar)
// ---------------------------------------------------------------------------
function seedFinancialYears() {
  const d = db();
  const now = new Date();
  const startYear = now.getMonth() + 1 >= 4 ? now.getFullYear() : now.getFullYear() - 1;
  const mk = (y: number) => ({
    code: `${y}-${String((y + 1) % 100).padStart(2, '0')}`,
    start: `${y}-04-01`,
    end: `${y + 1}-03-31`,
  });
  const stmt = d.prepare(
    `INSERT OR IGNORE INTO financial_years (code, start_date, end_date, is_active) VALUES (?, ?, ?, ?)`
  );
  for (const y of [startYear - 1, startYear, startYear + 1]) {
    const fy = mk(y);
    stmt.run(fy.code, fy.start, fy.end, y === startYear ? 1 : 0);
  }
  d.prepare('UPDATE financial_years SET is_active = 0').run();
  d.prepare('UPDATE financial_years SET is_active = 1 WHERE code = ?').run(mk(startYear).code);
  console.log(`  financial years seeded, active = ${mk(startYear).code}`);
}

// ---------------------------------------------------------------------------
// Invoice template — the real Wagon LOCAL workbook.
// The original in E:\Portal\InvoiceFormat is COPIED, never moved or modified.
// ---------------------------------------------------------------------------
const WAGON_MAPPING = {
  sheet: 'LOCAL',
  documentTitle: 'Credit Note',
  mode: 'single',
  taxMode: 'IGST',
  taxRate: 5,
  tollParkingTaxable: false,
  preserveFormulas: true,
  // Cells the workbook computes itself — the writer must NOT overwrite these.
  formulaCells: ['J18', 'J19', 'J23', 'J24', 'J25', 'J27'],
  cells: {
    I9: { field: 'invoice.invoiceNumber', type: 'string' },
    I11: { field: 'invoice.invoiceDate', type: 'date' },
    B10: { field: 'vendor.companyName', type: 'string' },
    B11: { field: 'vendor.billingAddress', type: 'string' },
    B14: { field: 'vendor.gstNumber', type: 'string' },
    H12: { field: 'booking.vehicleNumber', type: 'string' },
    I13: { field: 'booking.vehicleType', type: 'string' },
    I14: { field: 'booking.passengerName', type: 'string' },
    J17: { field: 'billing.baseFare', type: 'number' },
    H18: { field: 'billing.extraKm', type: 'number' },
    I18: { field: 'billing.extraKmRate', type: 'number' },
    H19: { field: 'billing.extraHours', type: 'number' },
    I19: { field: 'billing.extraHourRate', type: 'number' },
    J26: { field: 'billing.tollParking', type: 'number' },
    B28: { field: 'invoice.amountInWords', type: 'string' },
  },
};



/**
 * Put a template file in place, tolerating one that is already there.
 *
 * `copyFileSync` onto a path something else currently holds open fails with
 * EBUSY on Windows, and two things routinely do hold it: the running server
 * reading the template to build an invoice, and the test suite, which runs its
 * files in parallel and seeds them into this one shared folder. In both cases
 * the file that was wanted is already on disk and identical, so failing the
 * entire seed over the copy is the wrong trade.
 */
function copyTemplateInto(src: string, dest: string): void {
  try {
    // Already there and the same size? Nothing to do, and nothing to lock.
    if (fs.existsSync(dest) && fs.statSync(dest).size === fs.statSync(src).size) return;
    fs.copyFileSync(src, dest);
  } catch (err: any) {
    if (fs.existsSync(dest)) {
      console.log(`  ! ${path.basename(dest)} is in use; keeping the copy already on disk`);
      return;
    }
    throw err;
  }
}
function seedInvoiceTemplates() {
  const d = db();
  ensureDirectories();

  const candidates = [
    {
      name: 'Wagon — Local (Credit Note)',
      original: 'Gupta Tours and Wagon Local Invoice 1.xlsx',
      stored: 'wagon-local.xlsx',
      description:
        'Single-booking credit note. Toll & Parking added AFTER tax. IGST 5%. ' +
        'Formulas in J18/J19/J23/J24/J25/J27 are preserved and recalculated by Excel.',
      mapping: WAGON_MAPPING,
    },
  ];

  const ins = d.prepare(
    `INSERT INTO invoice_templates
       (name, description, file_name, original_name, source_path, file_type, sheet_name,
        document_title, mode, mapping_json, is_active)
     VALUES (@name, @description, @file_name, @original_name, @source_path, @file_type, @sheet_name,
             @document_title, @mode, @mapping_json, 1)`
  );

  let created = 0;
  for (const c of candidates) {
    const already = d.prepare('SELECT id FROM invoice_templates WHERE file_name = ?').get(c.stored);
    if (already) continue;

    const src = path.join(config.invoiceFormatSource, c.original);
    const dest = path.join(config.paths.templates, c.stored);
    if (fs.existsSync(src)) {
      copyTemplateInto(src, dest);          // copy only — the original stays put
    } else {
      console.log(`  ! template source not found, registering without file: ${src}`);
    }

    ins.run({
      name: c.name,
      description: c.description,
      file_name: c.stored,
      original_name: c.original,
      source_path: src,
      file_type: 'xlsx',
      sheet_name: c.mapping.sheet,
      document_title: c.mapping.documentTitle,
      mode: c.mapping.mode,
      mapping_json: JSON.stringify(c.mapping, null, 2),
    });
    created++;
  }
  console.log(`  invoice templates: ${created} created`);
}

// ---------------------------------------------------------------------------
// Reference data
// ---------------------------------------------------------------------------
/**
 * Address book for the booking form and the public suggestion box.
 *
 * Deliberately local: a decent list of Mumbai localities, transport hubs and
 * the outstation destinations this business actually runs. No geocoding
 * service is involved, so suggestions cost nothing, work offline and never
 * hit a quota. The list also self-improves — `use_count` climbs each time a
 * place is used on a real booking, which pushes it up the ranking.
 */
const MUMBAI: [string, string][] = [
  // South Mumbai
  ['Colaba', 'OTHER'], ['Fort', 'OFFICE'], ['Nariman Point', 'OFFICE'],
  ['Churchgate', 'OTHER'], ['Marine Lines', 'OTHER'], ['Cuffe Parade', 'OTHER'],
  ['Malabar Hill', 'OTHER'], ['Breach Candy', 'OTHER'], ['Tardeo', 'OTHER'],
  ['Grant Road', 'OTHER'], ['Byculla', 'OTHER'], ['Mahalaxmi', 'OTHER'],
  ['Worli', 'OFFICE'], ['Prabhadevi', 'OTHER'], ['Lower Parel', 'OFFICE'],
  ['Parel', 'OTHER'], ['Sewri', 'OTHER'], ['Wadala', 'OTHER'],
  // Western suburbs
  ['Dadar (West)', 'OTHER'], ['Dadar (East)', 'OTHER'], ['Matunga', 'OTHER'],
  ['Mahim', 'OTHER'], ['Bandra (West)', 'OTHER'], ['Bandra Kurla Complex', 'OFFICE'],
  ['Khar (West)', 'OTHER'], ['Santacruz (West)', 'OTHER'], ['Santacruz (East)', 'OTHER'],
  ['Vile Parle (West)', 'OTHER'], ['Vile Parle (East)', 'OTHER'],
  ['Juhu', 'OTHER'], ['Versova', 'OTHER'], ['Lokhandwala, Andheri', 'OTHER'],
  ['Oshiwara', 'OTHER'], ['Andheri (West)', 'OTHER'], ['Andheri (East)', 'OTHER'],
  ['MIDC, Andheri (East)', 'OFFICE'], ['SEEPZ, Andheri (East)', 'OFFICE'],
  ['Jogeshwari (West)', 'OTHER'], ['Jogeshwari (East)', 'OTHER'],
  ['Goregaon (West)', 'OTHER'], ['Goregaon (East)', 'OTHER'],
  ['Malad (West)', 'OTHER'], ['Malad (East)', 'OTHER'],
  ['Kandivali (West)', 'OTHER'], ['Kandivali (East)', 'OTHER'],
  ['Borivali (West)', 'OTHER'], ['Borivali (East)', 'OTHER'],
  ['Dahisar', 'OTHER'], ['Mira Road', 'OTHER'], ['Bhayandar', 'OTHER'],
  ['Vasai', 'OTHER'], ['Nalasopara', 'OTHER'], ['Virar', 'OTHER'],
  // Central and eastern suburbs
  ['Sion', 'OTHER'], ['Chembur', 'OTHER'], ['Govandi', 'OTHER'],
  ['Mankhurd', 'OTHER'], ['Kurla (West)', 'OTHER'], ['Kurla (East)', 'OTHER'],
  ['Ghatkopar (West)', 'OTHER'], ['Ghatkopar (East)', 'OTHER'],
  ['Vikhroli', 'OTHER'], ['Kanjurmarg', 'OTHER'], ['Bhandup', 'OTHER'],
  ['Mulund (West)', 'OTHER'], ['Mulund (East)', 'OTHER'],
  ['Powai', 'OFFICE'], ['Hiranandani Gardens, Powai', 'OFFICE'],
];

const HUBS: [string, string, string][] = [
  ['Terminal 1, Chhatrapati Shivaji International Airport, Mumbai', 'Mumbai', 'AIRPORT'],
  ['Terminal 2, Chhatrapati Shivaji International Airport, Mumbai', 'Mumbai', 'AIRPORT'],
  ['Navi Mumbai International Airport', 'Navi Mumbai', 'AIRPORT'],
  ['Chhatrapati Shivaji Maharaj Terminus (CSMT)', 'Mumbai', 'STATION'],
  ['Mumbai Central Railway Station', 'Mumbai', 'STATION'],
  ['Lokmanya Tilak Terminus (LTT), Kurla', 'Mumbai', 'STATION'],
  ['Bandra Terminus', 'Mumbai', 'STATION'],
  ['Dadar Railway Station', 'Mumbai', 'STATION'],
  ['Thane Railway Station', 'Thane', 'STATION'],
  ['Panvel Railway Station', 'Navi Mumbai', 'STATION'],
];

const NAVI_THANE: [string, string][] = [
  ['Vashi', 'Navi Mumbai'], ['Sanpada', 'Navi Mumbai'], ['Nerul', 'Navi Mumbai'],
  ['Seawoods', 'Navi Mumbai'], ['CBD Belapur', 'Navi Mumbai'], ['Kharghar', 'Navi Mumbai'],
  ['Panvel', 'Navi Mumbai'], ['Airoli', 'Navi Mumbai'], ['Ghansoli', 'Navi Mumbai'],
  ['Thane (West)', 'Thane'], ['Thane (East)', 'Thane'], ['Ghodbunder Road, Thane', 'Thane'],
  ['Dombivli', 'Thane'], ['Kalyan', 'Thane'], ['Ambernath', 'Thane'], ['Badlapur', 'Thane'],
];

const OUTSTATION: [string, string][] = [
  ['Pune', 'Pune'], ['Hinjewadi, Pune', 'Pune'], ['Pune Airport', 'Pune'],
  ['Lonavala', 'Lonavala'], ['Khandala', 'Khandala'], ['Matheran', 'Matheran'],
  ['Alibaug', 'Alibaug'], ['Kashid', 'Kashid'], ['Murud', 'Murud'],
  ['Nashik', 'Nashik'], ['Shirdi', 'Shirdi'], ['Trimbakeshwar', 'Nashik'],
  ['Igatpuri', 'Igatpuri'], ['Bhimashankar', 'Pune'],
  ['Mahabaleshwar', 'Mahabaleshwar'], ['Panchgani', 'Panchgani'],
  ['Satara', 'Satara'], ['Kolhapur', 'Kolhapur'], ['Solapur', 'Solapur'],
  ['Aurangabad', 'Aurangabad'], ['Ajanta Caves', 'Aurangabad'], ['Ellora Caves', 'Aurangabad'],
  ['Ratnagiri', 'Ratnagiri'], ['Ganpatipule', 'Ratnagiri'], ['Nagpur', 'Nagpur'],
  ['Surat', 'Surat'], ['Vadodara', 'Vadodara'], ['Ahmedabad', 'Ahmedabad'],
  ['Daman', 'Daman'], ['Silvassa', 'Silvassa'], ['Goa', 'Goa'], ['Shirdi Airport', 'Shirdi'],
];

function seedReferenceData() {
  const d = db();

  const locations: [string, string, string][] = [
    ...HUBS,
    ...MUMBAI.map(([name, kind]) => [`${name}, Mumbai`, 'Mumbai', kind] as [string, string, string]),
    ...NAVI_THANE.map(([name, city]) => [name, city, 'OTHER'] as [string, string, string]),
    ...OUTSTATION.map(([name, city]) => [name, city, 'OTHER'] as [string, string, string]),
  ];

  const li = d.prepare('INSERT OR IGNORE INTO locations (label, city, kind) VALUES (?, ?, ?)');
  for (const l of locations) li.run(...l);

  const vehicles: [string, string, string, number, string, string][] = [
    ['MH04LQ1748', 'Sedan', 'Maruti Dzire', 4, 'Ramesh Yadav', '9820011223'],
    ['MH02DK4521', 'Sedan', 'Toyota Etios', 4, 'Suresh Patil', '9820044556'],
    ['MH01CV7788', 'Ertiga', 'Maruti Ertiga', 6, 'Anil Sharma', '9820077889'],
    ['MH03EF2210', 'Innova Crysta', 'Toyota Innova Crysta', 6, 'Dinesh Kumar', '9820099001'],
    ['MH47AB3344', 'Tempo Traveller', 'Force Tempo Traveller', 12, 'Mahesh Jadhav', '9820033445'],
  ];
  const vi = d.prepare(
    `INSERT OR IGNORE INTO vehicles (vehicle_number, vehicle_type, model, seating, driver_name, driver_mobile)
     VALUES (?, ?, ?, ?, ?, ?)`
  );
  for (const v of vehicles) vi.run(...v);
  console.log(`  locations: ${locations.length}, vehicles: ${vehicles.length}`);
}

// ---------------------------------------------------------------------------
// DEMO DATA — clearly flagged with is_sample = 1 so it can be purged
// ---------------------------------------------------------------------------
function seedSampleData() {
  const d = db();
  if ((d.prepare('SELECT COUNT(*) c FROM vendors').get() as any).c > 0) {
    console.log('  sample data skipped (vendors already present)');
    return;
  }

  const wagonTemplate = d.prepare("SELECT id FROM invoice_templates WHERE file_name = 'wagon-local.xlsx'")
    .get() as { id: number } | undefined;

  const vendors = [
    {
      code: 'WAGON', vendor_name: 'Wagon Travels', company_name: 'Siemens LTD',
      contact_person: 'Accounts Desk', mobile: '9892616329', email: 'accounts@example-wagon.in',
      city: 'Mumbai', state: 'Maharashtra', gst_number: '27AAACS0764L1Z6',
      billing_address: 'Siemens LTD, Worli, Mumbai - 400018, Maharashtra',
      invoice_template_id: wagonTemplate?.id ?? null,
      invoice_prefix: 'GTT', document_title: 'Credit Note',
      tax_mode: 'IGST', tax_rate: 5, toll_parking_taxable: 0,
      consolidation_allowed: 0, billing_cycle: 'PER_TRIP', booking_message_format: 'AUTO',
    },
    {
      code: 'AURAFOX', vendor_name: 'AuraFox', company_name: 'AuraFox Mobility Pvt. Ltd.',
      contact_person: 'Ops Desk', mobile: '9892616329', email: 'ops@example-aurafox.in',
      city: 'Mumbai', state: 'Maharashtra', gst_number: '27AAECA1234F1Z5',
      billing_address: 'AuraFox Mobility Pvt. Ltd., Andheri (E), Mumbai - 400059',
      invoice_template_id: null,
      invoice_prefix: 'GTT', document_title: 'Tax Invoice',
      tax_mode: 'CGST_SGST', tax_rate: 5, toll_parking_taxable: 0,
      consolidation_allowed: 1, billing_cycle: 'FORTNIGHTLY', booking_message_format: 'BOOKING_HASH',
    },
    {
      code: 'FLEETOZ', vendor_name: 'FleetOZ', company_name: 'FleetOZ Technologies',
      contact_person: '24x7 Desk', mobile: '9056058033', email: 'support@example-fleetoz.in',
      city: 'Mumbai', state: 'Maharashtra', gst_number: '27AAFCF9876K1Z2',
      billing_address: 'FleetOZ Technologies, Powai, Mumbai - 400076',
      invoice_template_id: null,
      invoice_prefix: 'GTT', document_title: 'Tax Invoice',
      tax_mode: 'CGST_SGST', tax_rate: 5, toll_parking_taxable: 0,
      consolidation_allowed: 1, billing_cycle: 'MONTHLY', booking_message_format: 'TRIPID_HASH',
    },
  ];

  const vi = d.prepare(
    `INSERT INTO vendors (code, vendor_name, company_name, contact_person, mobile, email, city, state,
                          gst_number, billing_address, invoice_template_id, invoice_prefix, document_title,
                          tax_mode, tax_rate, toll_parking_taxable, consolidation_allowed, billing_cycle,
                          booking_message_format, status, is_sample)
     VALUES (@code, @vendor_name, @company_name, @contact_person, @mobile, @email, @city, @state,
             @gst_number, @billing_address, @invoice_template_id, @invoice_prefix, @document_title,
             @tax_mode, @tax_rate, @toll_parking_taxable, @consolidation_allowed, @billing_cycle,
             @booking_message_format, 'ACTIVE', 1)`
  );
  const vendorIds: number[] = [];
  for (const v of vendors) vendorIds.push(Number(vi.run(v).lastInsertRowid));

  // 10 sample bookings spread across the last ~5 weeks
  const today = new Date();
  const dstr = (offsetDays: number) => {
    const dt = new Date(today);
    dt.setDate(dt.getDate() - offsetDays);
    return dt.toISOString().slice(0, 10);
  };

  const samples = [
    { v: 0, ref: 'WGN-4471', pax: 'Mahesh Kale', mob: '9820112233', pick: 'Terminal 2, Chhatrapati Shivaji International Airport, Mumbai', drop: 'Lower Parel, Mumbai', vt: 'Sedan/Ertiga', vn: 'MH04LQ1748', trip: 'AIRPORT', duty: '4H40KMS', base: 1100, toll: 0, park: 0, ekm: 0, ehr: 0, off: 2 },
    { v: 0, ref: 'WGN-4472', pax: 'Priya Nair', mob: '9820223344', pick: 'Bandra Kurla Complex, Mumbai', drop: 'Terminal 2, Chhatrapati Shivaji International Airport, Mumbai', vt: 'Sedan', vn: 'MH02DK4521', trip: 'AIRPORT', duty: '4H40KMS', base: 1100, toll: 120, park: 60, ekm: 8, ehr: 0, off: 4 },
    { v: 0, ref: 'WGN-4488', pax: 'Rajesh Menon', mob: '9820334455', pick: 'Goregaon (West), Mumbai', drop: 'Thane', vt: 'Ertiga', vn: 'MH01CV7788', trip: 'LOCAL', duty: '8H80KMS', base: 2400, toll: 90, park: 0, ekm: 12, ehr: 1, off: 6 },
    { v: 1, ref: 'Booking #88245430-1', pax: 'T Sridhar', mob: '9663655300', pick: 'AI 2846 BLR BOM ETA 10:10HRS T2', drop: 'Mahalaxmi, Mumbai', vt: 'DZIRE/ETIOS/XCENT', vn: 'MH02DK4521', trip: 'TRANSFER', duty: '4H40KMS', base: 1250, toll: 0, park: 40, ekm: 0, ehr: 0, off: 9 },
    { v: 1, ref: 'Booking #88245431-1', pax: 'Anita Desai', mob: '9663655301', pick: 'Andheri (East), Mumbai', drop: 'Navi Mumbai', vt: 'Sedan', vn: 'MH04LQ1748', trip: 'LOCAL', duty: '8H80KMS', base: 2200, toll: 150, park: 0, ekm: 5, ehr: 0, off: 12 },
    { v: 1, ref: 'Booking #88245455-1', pax: 'Vikram Shah', mob: '9663655302', pick: 'Colaba, Mumbai', drop: 'Pune', vt: 'Innova Crysta', vn: 'MH03EF2210', trip: 'OUTSTATION', duty: 'Outstation One Way', base: 5500, toll: 640, park: 0, ekm: 0, ehr: 0, off: 15 },
    { v: 2, ref: 'TripId #674HPB-1', pax: 'Behari', mob: '+919870139050', pick: 'Terminal 1, Chhatrapati Shivaji International Airport, Mumbai', drop: 'Colaba, Mumbai', vt: 'Sedan', vn: 'MH02DK4521', trip: 'TRANSFER', duty: 'MMT Flat Rate', base: 1350, toll: 0, park: 0, ekm: 0, ehr: 0, off: 18 },
    { v: 2, ref: 'TripId #674HPC-1', pax: 'Sneha Kulkarni', mob: '+919870139051', pick: 'Lower Parel, Mumbai', drop: 'Terminal 1, Chhatrapati Shivaji International Airport, Mumbai', vt: 'Sedan', vn: 'MH04LQ1748', trip: 'AIRPORT', duty: 'MMT Flat Rate', base: 1350, toll: 0, park: 50, ekm: 0, ehr: 0, off: 21 },
    { v: 2, ref: 'TripId #674HPD-1', pax: 'Arun Prakash', mob: '+919870139052', pick: 'Mumbai Central Railway Station', drop: 'Lonavala', vt: 'Ertiga', vn: 'MH01CV7788', trip: 'OUTSTATION', duty: 'Outstation Round Trip', base: 4800, toll: 380, park: 0, ekm: 0, ehr: 2, off: 25 },
    { v: 2, ref: 'TripId #674HPE-1', pax: 'Group — Tech Offsite', mob: '+919870139053', pick: 'Bandra Kurla Complex, Mumbai', drop: 'Nashik', vt: 'Tempo Traveller', vn: 'MH47AB3344', trip: 'PACKAGE', duty: 'Full Day Package', base: 9500, toll: 720, park: 100, ekm: 0, ehr: 0, off: 30 },
  ];

  const insB = d.prepare(
    `INSERT INTO bookings (booking_code, vendor_id, vendor_booking_ref, booking_date, travel_date,
        reporting_time, trip_type, duty_type, city, pickup_location, pickup_address, drop_location,
        drop_address, passenger_name, passenger_mobile, pax_count, vehicle_type, vehicle_number,
        driver_name, driver_mobile, booking_status, billing_status, is_sample)
     VALUES (@booking_code, @vendor_id, @vendor_booking_ref, @booking_date, @travel_date,
        @reporting_time, @trip_type, @duty_type, 'Mumbai', @pickup, @pickup, @drop,
        @drop, @pax, @mob, 1, @vt, @vn, @driver, @driver_mobile, 'COMPLETED', @billing_status, 1)`
  );
  const insC = d.prepare(
    `INSERT INTO booking_charges (booking_id, base_fare, extra_km, extra_km_rate, extra_hours,
        extra_hour_rate, toll, parking, taxable_amount, tax_mode, tax_rate, cgst, sgst, igst,
        tax_amount, non_taxable_amount, total_amount, balance)
     VALUES (@booking_id, @base_fare, @extra_km, @extra_km_rate, @extra_hours, @extra_hour_rate,
        @toll, @parking, @taxable_amount, @tax_mode, @tax_rate, @cgst, @sgst, @igst,
        @tax_amount, @non_taxable_amount, @total_amount, @total_amount)`
  );
  const insP = d.prepare(
    `INSERT OR IGNORE INTO passengers (name, mobile, vendor_id, trip_count, last_trip_at)
     VALUES (?, ?, ?, 1, ?)`
  );

  samples.forEach((s, i) => {
    const vendorId = vendorIds[s.v];
    const vendor = d.prepare('SELECT * FROM vendors WHERE id = ?').get(vendorId) as any;
    const vehicle = d.prepare('SELECT * FROM vehicles WHERE vehicle_number = ?').get(s.vn) as any;
    const travelDate = dstr(s.off);

    const bookingId = Number(insB.run({
      booking_code: `GTT-B-${String(i + 1).padStart(6, '0')}`,
      vendor_id: vendorId,
      vendor_booking_ref: s.ref,
      booking_date: travelDate,
      travel_date: travelDate,
      reporting_time: ['09:30', '10:00', '14:15', '17:45', '06:00'][i % 5],
      trip_type: s.trip,
      duty_type: s.duty,
      pickup: s.pick,
      drop: s.drop,
      pax: s.pax,
      mob: s.mob,
      vt: s.vt,
      vn: s.vn,
      driver: vehicle?.driver_name ?? null,
      driver_mobile: vehicle?.driver_mobile ?? null,
      // first six are ready to bill, rest still pending — gives the dashboard something to show
      billing_status: i < 6 ? 'READY' : 'PENDING',
    }).lastInsertRowid);

    const c = computeCharges({
      baseFare: s.base,
      extraKm: s.ekm, extraKmRate: 14,
      extraHours: s.ehr, extraHourRate: 180,
      toll: s.toll, parking: s.park,
      taxMode: vendor.tax_mode, taxRate: vendor.tax_rate,
      tollParkingTaxable: !!vendor.toll_parking_taxable,
    });

    insC.run({
      booking_id: bookingId,
      base_fare: s.base,
      extra_km: s.ekm, extra_km_rate: 14,
      extra_hours: s.ehr, extra_hour_rate: 180,
      toll: s.toll, parking: s.park,
      taxable_amount: c.taxableAmount,
      tax_mode: c.taxMode, tax_rate: c.taxRate,
      cgst: c.cgst, sgst: c.sgst, igst: c.igst,
      tax_amount: c.taxAmount,
      non_taxable_amount: c.nonTaxableAmount,
      total_amount: c.totalAmount,
    });

    insP.run(s.pax, s.mob, vendorId, travelDate);
  });

  // --- rate cards -----------------------------------------------------------
  // A walk-in card so the website's calculator has something to quote, plus a
  // contract card for one vendor to show what "vendor-wise" means. Illustrative
  // numbers — the first job on a real install is to replace them.
  const directForRates = ensureDirectVendor() as { id: number } | undefined;

  const RETAIL: Array<[string, string, string, number, number, number, number, number, number, number, number]> = [
    // vehicle,               type,         label,        inclH, inclKm, base, extraHr, extraKm, perKm, minKm/day, driverAllow
    ['Dzire',                 'LOCAL',      '4H/40KM',        4,  40,  1400, 150, 13,  0,   0,   0],
    ['Dzire',                 'LOCAL',      '8H/80KM',        8,  80,  2400, 150, 13,  0,   0,   0],
    ['Dzire',                 'AIRPORT',    'Airport transfer', 0, 0,  1800,   0,  0,  0,   0,   0],
    ['Dzire',                 'OUTSTATION', 'Per km',         0,   0,     0,   0,  0, 15, 300, 400],
    // The second sedan cab prices the same as the first; a rate row named for
    // one model never matches the other, so the Aura needs its own rows.
    ['Hyundai Aura',          'LOCAL',      '4H/40KM',        4,  40,  1400, 150, 13,  0,   0,   0],
    ['Hyundai Aura',          'LOCAL',      '8H/80KM',        8,  80,  2400, 150, 13,  0,   0,   0],
    ['Hyundai Aura',          'AIRPORT',    'Airport transfer', 0, 0,  1800,   0,  0,  0,   0,   0],
    ['Hyundai Aura',          'OUTSTATION', 'Per km',         0,   0,     0,   0,  0, 15, 300, 400],
    ['Ertiga',                'LOCAL',      '8H/80KM',        8,  80,  2800, 180, 16,  0,   0,   0],
    ['Ertiga',                'AIRPORT',    'Airport transfer', 0, 0,  2200,   0,  0,  0,   0,   0],
    ['Ertiga',                'OUTSTATION', 'Per km',         0,   0,     0,   0,  0, 18, 300, 400],
    ['Toyota Innova Crysta',  'LOCAL',      '8H/80KM',        8,  80,  3600, 220, 20,  0,   0,   0],
    ['Toyota Innova Crysta',  'AIRPORT',    'Airport transfer', 0, 0,  3000,   0,  0,  0,   0,   0],
    ['Toyota Innova Crysta',  'OUTSTATION', 'Per km',         0,   0,     0,   0,  0, 22, 300, 500],
    ['Force Traveller 12',    'LOCAL',      '8H/80KM',        8,  80,  5500, 350, 32,  0,   0,   0],
    ['Force Traveller 12',    'OUTSTATION', 'Per km',         0,   0,     0,   0,  0, 30, 250, 600],
  ];

  const ri = d.prepare(
    `INSERT OR IGNORE INTO rate_cards (vendor_id, vehicle_category, plan_type, plan_label,
        included_hours, included_km, base_fare, extra_hour_rate, extra_km_rate,
        per_km_rate, min_km_per_day, driver_allowance, display_order)
     VALUES (@v, @cat, @type, @label, @ih, @ik, @base, @eh, @ek, @pk, @mk, @da, @ord)`
  );

  let rateRows = 0;
  if (directForRates) {
    RETAIL.forEach((r, i) => {
      ri.run({
        v: directForRates.id, cat: r[0], type: r[1], label: r[2],
        ih: r[3], ik: r[4], base: r[5], eh: r[6], ek: r[7],
        pk: r[8], mk: r[9], da: r[10], ord: i,
      });
      rateRows++;
    });
  }

  // The same vehicles at a contracted discount, to make the point that the
  // Master is per vendor and that these never reach the website.
  RETAIL.filter((r) => r[1] === 'LOCAL').forEach((r, i) => {
    ri.run({
      v: vendorIds[0], cat: r[0], type: r[1], label: r[2],
      ih: r[3], ik: r[4], base: Math.round(r[5] * 0.88), eh: r[6], ek: r[7],
      pk: r[8], mk: r[9], da: r[10], ord: i,
    });
    rateRows++;
  });

  console.log(`  sample vendors: ${vendors.length}, sample bookings: ${samples.length}, rate rows: ${rateRows}`);
}

// ---------------------------------------------------------------------------
function main() {
  ensureDirectories();
  applySchema();
  console.log('Seeding database:', config.paths.dbFile);
  getDb().transaction(() => {
    seedRolesAndPermissions();
    seedAdminUser();
    seedSettings();
    seedFinancialYears();
    seedInvoiceTemplates();
    seedReferenceData();
    seedSampleData();
  })();
  console.log('\nSeed complete.');
  console.log(`  Login : ${config.seedAdmin.email}`);
  console.log(`  Pass  : ${config.seedAdmin.password}  (must be changed at first login)`);
  closeDb();
}

main();
