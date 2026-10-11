import { Request } from 'express';
import { q } from '../db';

export type AuditAction =
  | 'LOGIN' | 'LOGIN_FAILED' | 'LOGOUT' | 'PASSWORD_CHANGED' | 'PASSWORD_RESET_REQUESTED'
  | 'BOOKING_CREATED' | 'BOOKING_UPDATED' | 'BOOKING_DELETED' | 'BOOKING_DUPLICATED'
  | 'BOOKING_IMPORTED' | 'BOOKING_PARSED'
  | 'VENDOR_CREATED' | 'VENDOR_UPDATED' | 'VENDOR_DELETED'
  | 'INVOICE_GENERATED' | 'INVOICE_REGENERATED' | 'INVOICE_CANCELLED' | 'INVOICE_DOWNLOADED'
  | 'PAYMENT_ADDED' | 'PAYMENT_DELETED'
  | 'TEMPLATE_UPLOADED' | 'TEMPLATE_UPDATED' | 'TEMPLATE_DELETED'
  | 'USER_CREATED' | 'USER_UPDATED' | 'USER_DELETED'
  | 'RATE_CREATED' | 'RATE_UPDATED' | 'RATE_DELETED' | 'RATE_COPIED' | 'RATE_IMPORTED'
  | 'OUTSTATION_FARE_UPDATED'
  | 'SETTINGS_CHANGED' | 'BACKUP_CREATED'
  // The customer journey: enquiries, allotment, the trip itself, and the
  // emails that go out along the way.
  | 'TRIP_CREATED' | 'TRIP_UPDATED' | 'TRIP_ASSIGNED' | 'TRIP_STATUS_CHANGED'
  | 'TRIP_FARE_SET' | 'TRIP_DETAILS_SENT' | 'TRIP_LINKED'
  | 'INVOICE_SENT' | 'INVOICE_SEND_FAILED'
  | 'EMAIL_TEST' | 'EMAIL_RESENT'
  | 'DRIVER_ADDED' | 'DRIVER_UPDATED'
  | 'FEEDBACK_REQUESTED' | 'FEEDBACK_REOPENED'
  | 'CHATBOT_UPDATED'
  // Masters, fleet and the trip workflow
  | 'MASTER_CREATED' | 'MASTER_UPDATED' | 'MASTER_DELETED'
  | 'VEHICLE_ADDED' | 'VEHICLE_UPDATED' | 'VEHICLE_DELETED' | 'DRIVER_DELETED'
  | 'TRIP_OWNER_SET' | 'TRIP_QUOTE_SENT' | 'TRIP_QUOTE_ANSWERED' | 'TRIP_CANCELLED'
  | 'TRIP_ASSIGN_OVERRIDE' | 'TRIP_COST_SET'
  | 'TRIP_COMPLETED' | 'BILLING_CONFIRMED' | 'BILLING_UNCONFIRMED'
  // Money
  | 'BILLING_BATCH_CREATED' | 'BILLING_BATCH_UPDATED' | 'BILLING_BATCH_SUBMITTED'
  | 'BILLING_BATCH_APPROVED' | 'BILLING_BATCH_BILLED' | 'BILLING_BATCH_CANCELLED'
  | 'BILLING_ADJUSTED'
  | 'PAYMENT_REVERSED' | 'SUPPLIER_PAYMENT_ADDED' | 'SUPPLIER_PAYMENT_REVERSED'
  // Payments & Ledger
  | 'RECEIPT_RECORDED' | 'RECEIPT_ALLOCATED' | 'RECEIPT_UNALLOCATED' | 'RECEIPT_REVERSED'
  | 'LEDGER_OPENING_SET' | 'LEDGER_ADJUSTMENT_ADDED' | 'LEDGER_ADJUSTMENT_REVERSED' | 'STATEMENT_RECONCILED'
  | 'INVOICE_BULK_DOWNLOADED' | 'DATA_EXPORTED'
  // Access
  | 'ROLE_PERMISSIONS_CHANGED'
  // OnSheet
  | 'SHEET_CREATED' | 'SHEET_RENAMED' | 'SHEET_DUPLICATED' | 'SHEET_DELETED' | 'SHEET_IMPORTED'
  | 'SHEET_SHARED' | 'SHEET_UNSHARED' | 'SHEET_SAVED'
  // Events
  | 'EVENT_CREATED' | 'EVENT_UPDATED' | 'EVENT_CANCELLED'
  | 'EVENT_REQUIREMENTS_ADDED' | 'EVENT_REQUIREMENT_UPDATED' | 'EVENT_REQUIREMENT_DELETED'
  | 'EVENT_TRIPS_GENERATED';

export function clientIp(req: Request): string {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd) return fwd.split(',')[0].trim();
  return (req.ip || req.socket?.remoteAddress || '').replace('::ffff:', '');
}

export function audit(
  req: Request,
  action: AuditAction,
  opts: { entityType?: string; entityId?: number; description?: string; meta?: any } = {}
): void {
  try {
    q.run(
      `INSERT INTO audit_logs (user_id, user_email, action, entity_type, entity_id,
                               description, ip_address, user_agent, meta_json)
       VALUES (@user_id, @user_email, @action, @entity_type, @entity_id,
               @description, @ip, @ua, @meta)`,
      {
        user_id: req.user?.id ?? null,
        user_email: req.user?.email ?? (req.body?.email ?? null),
        action,
        entity_type: opts.entityType ?? null,
        entity_id: opts.entityId ?? null,
        description: opts.description ?? null,
        ip: clientIp(req),
        ua: String(req.headers['user-agent'] ?? '').slice(0, 300),
        meta: opts.meta ? JSON.stringify(opts.meta) : null,
      }
    );
  } catch {
    // Audit logging must never break the request it is recording.
  }
}
