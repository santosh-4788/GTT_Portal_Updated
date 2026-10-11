/**
 * Outgoing email.
 *
 * WHY IT LOOKS LIKE THIS
 * The business has one mailbox — vinaykumar87674@gmail.com — and no budget for
 * a transactional email service. Gmail's own SMTP is free, already owned, and
 * good for far more mail than this office will ever send, so that is what this
 * uses: nodemailer over smtp.gmail.com with an App Password.
 *
 * TWO RULES THAT SHAPE EVERYTHING BELOW
 *
 * 1. Sending must never break a request. A customer submitting an enquiry at
 *    11pm gets their Trip ID whether or not the mailbox is configured. Every
 *    message is written to `email_log` FIRST and only then handed to SMTP, so a
 *    failure is a row the office can see and retry — not a lost enquiry and not
 *    a 500 in the customer's face.
 *
 * 2. The From address is a setting, not a literal. It defaults to the business
 *    mailbox and every caller goes through here, so there is exactly one place
 *    that decides who mail comes from.
 *
 * SETTING IT UP (once, ~2 minutes, free)
 *   · Turn on 2-Step Verification on the Google account.
 *   · Create an App Password (Google Account -> Security -> App passwords).
 *   · Put it in backend\.env as MAIL_APP_PASSWORD, or in Settings -> Email.
 * Until that is done the portal runs normally and every message sits in the log
 * marked QUEUED, with the reason spelled out.
 */
import nodemailer, { type Transporter } from 'nodemailer';
import fs from 'fs';
import path from 'path';
import { q } from '../db';
import { config } from '../config';
import { ensureLocalFile } from './fileStore';

export const DEFAULT_FROM = 'vinaykumar87674@gmail.com';

export type MailKind =
  | 'INQUIRY_ADMIN'
  | 'INQUIRY_CUSTOMER'
  | 'TRIP_DETAILS'
  | 'INVOICE'
  | 'ACCOUNT'
  | 'FEEDBACK'
  | 'QUOTATION';

export interface MailConfig {
  enabled: boolean;
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  fromAddress: string;
  fromName: string;
  replyTo: string;
  /** Where customer enquiries are delivered. Same mailbox by default. */
  adminInbox: string;
}

function settingsMap(): Record<string, string> {
  try {
    return Object.fromEntries(
      q.all<{ key: string; value: string }>("SELECT key, value FROM settings WHERE category = 'email'")
        .map((r) => [r.key, r.value ?? ''])
    );
  } catch {
    // Called before the table exists (first boot) — fall back to env only.
    return {};
  }
}

/**
 * Resolve the live mail configuration.
 *
 * Environment always wins over the database: the App Password belongs in
 * backend\.env, which is git-ignored, rather than in a table an operator can
 * read on screen.
 */
export function mailConfig(): MailConfig {
  const s = settingsMap();
  const pick = (envKey: string, settingKey: string, fallback: string) =>
    (process.env[envKey] ?? '').trim() || (s[settingKey] ?? '').trim() || fallback;

  const host = pick('MAIL_HOST', 'email.host', 'smtp.gmail.com');

  /*
   * Google shows an App Password as four groups of four - "abcd efgh ijkl
   * mnop" - and that is exactly how people paste it. The spaces are
   * presentation only; sending them produces a 535 that reads identically to a
   * wrong password, and the operator has no way to tell the two apart. Only
   * stripped for Gmail, in case some other SMTP host has a password with a
   * space in it.
   */
  const raw = pick('MAIL_APP_PASSWORD', 'email.appPassword', '');
  const password = /gmail|googlemail/i.test(host) ? raw.replace(/\s+/g, '') : raw;

  const fromAddress = pick('MAIL_FROM', 'email.fromAddress', DEFAULT_FROM);
  const user = pick('MAIL_USER', 'email.user', fromAddress);
  const enabledSetting = (s['email.enabled'] ?? 'true').toLowerCase() !== 'false';

  return {
    enabled: enabledSetting && !!password && !!user,
    host,
    port: Number(pick('MAIL_PORT', 'email.port', '465')) || 465,
    secure: pick('MAIL_SECURE', 'email.secure', 'true').toLowerCase() !== 'false',
    user,
    password,
    fromAddress,
    fromName: pick('MAIL_FROM_NAME', 'email.fromName', 'Gupta Tours & Travels'),
    replyTo: pick('MAIL_REPLY_TO', 'email.replyTo', fromAddress),
    adminInbox: pick('MAIL_ADMIN_INBOX', 'email.adminInbox', fromAddress),
  };
}

/** Why sending is off, in words an operator can act on. Empty when it is on. */
export function mailDisabledReason(cfg = mailConfig()): string {
  if (!cfg.password) {
    return 'No Gmail App Password is configured, so nothing can be sent yet. ' +
      'Add MAIL_APP_PASSWORD to backend\\.env (or Settings -> Email) and messages will go out.';
  }
  if (!cfg.user) return 'No sending mailbox is configured under Settings -> Email.';
  if (!cfg.enabled) return 'Email sending is switched off under Settings -> Email.';
  return '';
}

/* --------------------------------------------------------------------------
   Transport — rebuilt whenever the settings that define it change, so saving a
   new App Password takes effect without restarting the server.
   -------------------------------------------------------------------------- */
let cached: { key: string; transporter: Transporter } | null = null;

function transportFor(cfg: MailConfig): Transporter {
  const key = `${cfg.host}|${cfg.port}|${cfg.secure}|${cfg.user}|${cfg.password}`;
  if (cached?.key === key) return cached.transporter;

  const transporter = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: { user: cfg.user, pass: cfg.password },
    // A hung mailbox must not hold an HTTP request open.
    connectionTimeout: 15_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
  cached = { key, transporter };
  return transporter;
}

/** Drop the cached transport — called when Settings -> Email is saved. */
export function resetMailTransport(): void {
  cached = null;
}

/* -------------------------------------------------------------------------- */

export interface SendMailInput {
  kind: MailKind;
  to: string;
  cc?: string;
  subject: string;
  html: string;
  text?: string;
  /** Path relative to data/invoices, attached as a PDF. */
  attachmentPath?: string;
  attachmentName?: string;
  bookingId?: number | null;
  invoiceId?: number | null;
  tripId?: string | null;
  userId?: number | null;
  /**
   * Reuse an existing email_log row rather than writing a new one.
   *
   * Only the resend path sets this. Without it a retry left the original row
   * sitting at QUEUED for ever beside a fresh SENT copy, so Settings -> Email
   * and the dashboard's "undelivered" figure went on reporting mail that had
   * in fact gone out - and the obvious response to that is to press Resend
   * again and send the customer a second copy.
   */
  logId?: number;
}

export interface SendMailResult {
  ok: boolean;
  logId: number;
  status: 'SENT' | 'QUEUED' | 'FAILED';
  /** Plain-language outcome, safe to show in a toast. */
  message: string;
  from: string;
}

/** Strip tags for the plain-text alternative when a caller does not supply one. */
function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|h1|h2|h3|li)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#8377;|&rupee;/g, '₹')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const validAddress = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(v ?? '').trim());

/** A Google App Password is always sixteen lowercase letters. */
const looksLikeAppPassword = (pw: string) => /^[a-z]{16}$/.test(pw);

/**
 * Turn an SMTP failure into something an operator can act on.
 *
 * Gmail's own wording - "Username and Password not accepted" - reads as "you
 * typed it wrong", and the usual cause is the opposite: the value is perfectly
 * correct, it is just the wrong KIND of secret. Gmail has not accepted account
 * passwords from other applications since May 2022. Saying so here, in both
 * the Verify button and the send path, is the difference between a two-minute
 * fix and an afternoon of retyping a password that was never going to work.
 */
function explainSmtpError(rawMessage: string, cfg: MailConfig): string {
  if (/invalid login|username and password not accepted|535/i.test(rawMessage)) {
    const shape = cfg.password && !looksLikeAppPassword(cfg.password)
      ? ` The value configured is ${cfg.password.length} character${cfg.password.length === 1 ? '' : 's'};` +
        ' an App Password is exactly sixteen lowercase letters, so this looks like the account password.'
      : '';
    return (
      `Gmail refused the sign-in for ${cfg.user}. Since May 2022 it does not accept the account ` +
      'password from other applications - it needs an App Password: switch on 2-Step Verification, ' +
      'then Google Account -> Security -> App passwords, and paste the sixteen characters it gives ' +
      'you here.' + shape
    );
  }
  if (/ETIMEDOUT|ECONNREFUSED|ENOTFOUND|EAI_AGAIN/i.test(rawMessage)) {
    return `Could not reach ${cfg.host}. Check this machine's internet connection and try again — ` +
      'nothing is lost, anything already written to the log can be resent.';
  }
  return rawMessage;
}

/**
 * Send one message.
 *
 * Never throws. The caller gets a result it can report; the row in `email_log`
 * is the durable record either way.
 */
export async function sendMail(input: SendMailInput): Promise<SendMailResult> {
  const cfg = mailConfig();
  const to = String(input.to ?? '').trim();
  const text = input.text ?? htmlToText(input.html);

  const reuse = input.logId
    ? q.get<{ id: number }>('SELECT id FROM email_log WHERE id = @id', { id: input.logId })
    : null;

  let logId: number;
  if (reuse) {
    // A retry of a message already in the log. Clear the previous complaint and
    // put the row back in the queue; `attempts` below records that this is not
    // the first go.
    q.run(
      `UPDATE email_log SET from_address = @from, status = 'QUEUED', error = NULL WHERE id = @id`,
      { from: cfg.fromAddress, id: reuse.id }
    );
    logId = reuse.id;
  } else {
    logId = Number(
      q.run(
        `INSERT INTO email_log (kind, to_address, cc_address, from_address, subject, body_html,
            body_text, attachment, booking_id, invoice_id, trip_id, status, created_by)
         VALUES (@kind, @to, @cc, @from, @subject, @html, @text, @att, @bookingId, @invoiceId,
            @tripId, 'QUEUED', @uid)`,
        {
          kind: input.kind,
          to,
          cc: input.cc || null,
          from: cfg.fromAddress,
          subject: input.subject,
          html: input.html,
          text,
          att: input.attachmentPath ?? null,
          bookingId: input.bookingId ?? null,
          invoiceId: input.invoiceId ?? null,
          tripId: input.tripId ?? null,
          uid: input.userId ?? null,
        }
      ).lastInsertRowid
    );
  }

  const fail = (message: string, status: 'QUEUED' | 'FAILED') => {
    q.run(
      `UPDATE email_log SET status = @s, error = @e, attempts = attempts + 1 WHERE id = @id`,
      { s: status, e: message, id: logId }
    );
    return { ok: false, logId, status, message, from: cfg.fromAddress } as SendMailResult;
  };

  if (!validAddress(to)) {
    return fail(`"${to || '(blank)'}" is not a valid email address, so nothing was sent.`, 'FAILED');
  }

  const off = mailDisabledReason(cfg);
  if (off) {
    return fail(off, 'QUEUED');
  }

  // Resolve the attachment before opening a connection, so a missing file is a
  // clear message rather than a half-sent email.
  const attachments: { filename: string; path: string }[] = [];
  if (input.attachmentPath) {
    const abs = path.join(config.paths.invoices, input.attachmentPath);
    if (!abs.startsWith(config.paths.invoices) || !ensureLocalFile(abs)) {
      return fail('The file to attach is missing from disk. Regenerate the invoice and try again.', 'FAILED');
    }
    attachments.push({ filename: input.attachmentName ?? path.basename(abs), path: abs });
  }

  try {
    await transportFor(cfg).sendMail({
      from: `"${cfg.fromName}" <${cfg.fromAddress}>`,
      sender: cfg.user,
      replyTo: cfg.replyTo || cfg.fromAddress,
      to,
      cc: input.cc || undefined,
      subject: input.subject,
      html: input.html,
      text,
      attachments,
    });

    q.run(
      `UPDATE email_log SET status = 'SENT', error = NULL, attempts = attempts + 1,
              sent_at = datetime('now') WHERE id = @id`,
      { id: logId }
    );
    return {
      ok: true,
      logId,
      status: 'SENT',
      message: `Email sent to ${to} from ${cfg.fromAddress}.`,
      from: cfg.fromAddress,
    };
  } catch (err: any) {
    const raw = String(err?.message ?? err);
    console.error('[mail] send failed:', raw);
    return fail(explainSmtpError(raw, cfg), 'FAILED');
  }
}

/** Resend a logged message. Used by the Email log screen's Retry action. */
export async function resendLogged(logId: number, userId?: number): Promise<SendMailResult> {
  const row = q.get<any>('SELECT * FROM email_log WHERE id = @id', { id: logId });
  if (!row) {
    return { ok: false, logId, status: 'FAILED', message: 'That message is no longer in the log.', from: '' };
  }
  return sendMail({
    logId: row.id,
    kind: row.kind,
    to: row.to_address,
    cc: row.cc_address ?? undefined,
    subject: row.subject,
    html: row.body_html ?? '',
    text: row.body_text ?? undefined,
    attachmentPath: row.attachment ?? undefined,
    bookingId: row.booking_id,
    invoiceId: row.invoice_id,
    tripId: row.trip_id,
    userId: userId ?? null,
  });
}

/** Prove the mailbox works, without sending anything to a customer. */
export async function verifyMailbox(): Promise<{ ok: boolean; message: string }> {
  const cfg = mailConfig();
  const off = mailDisabledReason(cfg);
  if (off) return { ok: false, message: off };
  try {
    await transportFor(cfg).verify();
    return { ok: true, message: `Connected to ${cfg.host} as ${cfg.user}. Mail will be sent from ${cfg.fromAddress}.` };
  } catch (err: any) {
    return { ok: false, message: explainSmtpError(String(err?.message ?? err), cfg) };
  }
}
