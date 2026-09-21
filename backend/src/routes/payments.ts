import { Router } from 'express';
import { z } from 'zod';
import { q, getDb } from '../db';
import { requireAuth, requirePermission } from '../middleware/auth';
import { audit } from '../middleware/audit';
import { validateBody, isoDate } from '../utils/validate';
import { round2 } from '../services/billing';

const router = Router();
router.use(requireAuth);

const paymentSchema = z.object({
  invoiceId: z.coerce.number().int().positive('Choose an invoice.'),
  paymentDate: isoDate,
  amount: z.coerce.number().positive('Payment amount must be more than zero.'),
  mode: z.enum(['CASH', 'BANK_TRANSFER', 'UPI', 'NEFT', 'RTGS', 'CHEQUE', 'OTHER']).default('BANK_TRANSFER'),
  referenceNo: z.string().trim().optional().default(''),
  bank: z.string().trim().optional().default(''),
  notes: z.string().trim().optional().default(''),
});

/** Recompute paid/outstanding/status from the payment rows — single source of truth. */
function resyncInvoice(invoiceId: number) {
  const inv = q.get<any>('SELECT * FROM invoices WHERE id = @id', { id: invoiceId })!;
  const paid = round2(
    (q.get<any>('SELECT COALESCE(SUM(amount),0) s FROM payments WHERE invoice_id = @id', { id: invoiceId })!).s
  );
  const outstanding = round2(Number(inv.total_amount) - paid);

  let status = inv.status;
  if (status !== 'CANCELLED') {
    if (paid <= 0) status = inv.status === 'SENT' ? 'SENT' : 'GENERATED';
    else if (outstanding > 0.009) status = 'PARTIALLY_PAID';
    else status = 'PAID';
  }

  q.run(
    `UPDATE invoices SET paid_amount = @paid, outstanding_amount = @out, status = @status,
            updated_at = datetime('now') WHERE id = @id`,
    { paid, out: Math.max(0, outstanding), status, id: invoiceId }
  );
  return { paid, outstanding: Math.max(0, outstanding), status };
}

router.get('/', requirePermission('payments.view'), (req, res) => {
  const p = req.query as Record<string, string>;
  const params = {
    vendorId: p.vendorId ? Number(p.vendorId) : 0,
    invoiceId: p.invoiceId ? Number(p.invoiceId) : 0,
    from: p.from ?? '', to: p.to ?? '', mode: p.mode ?? '', search: p.search ?? '',
    limit: Math.min(Number(p.limit ?? 100), 500), offset: Number(p.offset ?? 0),
  };
  const where = `
    WHERE (@vendorId = 0 OR p.vendor_id = @vendorId)
      AND (@invoiceId = 0 OR p.invoice_id = @invoiceId)
      AND (@from = '' OR p.payment_date >= @from)
      AND (@to = '' OR p.payment_date <= @to)
      AND (@mode = '' OR p.mode = @mode)
      AND (@search = '' OR i.invoice_number LIKE '%'||@search||'%'
                        OR p.reference_no LIKE '%'||@search||'%'
                        OR v.vendor_name LIKE '%'||@search||'%')`;

  const data = q.all<any>(
    `SELECT p.*, i.invoice_number, i.total_amount AS invoice_total, i.outstanding_amount,
            v.vendor_name, v.code AS vendor_code, u.full_name AS created_by_name
       FROM payments p
       JOIN invoices i ON i.id = p.invoice_id
       JOIN vendors v ON v.id = p.vendor_id
       LEFT JOIN users u ON u.id = p.created_by
       ${where}
      ORDER BY p.payment_date DESC, p.id DESC LIMIT @limit OFFSET @offset`,
    params
  );
  const agg = q.get<any>(
    `SELECT COUNT(*) total, COALESCE(SUM(p.amount),0) amount
       FROM payments p JOIN invoices i ON i.id = p.invoice_id JOIN vendors v ON v.id = p.vendor_id ${where}`,
    params
  );
  res.json({ data, ...agg });
});

router.post('/', requirePermission('payments.create'), validateBody(paymentSchema), (req, res) => {
  const b = req.body as z.infer<typeof paymentSchema>;
  const invoice = q.get<any>('SELECT * FROM invoices WHERE id = @id', { id: b.invoiceId });
  if (!invoice) return res.status(404).json({ error: 'Invoice not found.' });
  if (invoice.status === 'CANCELLED') {
    return res.status(409).json({ error: `${invoice.invoice_number} is cancelled — payments cannot be recorded against it.` });
  }

  const outstanding = round2(Number(invoice.outstanding_amount));
  if (b.amount > outstanding + 0.009) {
    return res.status(400).json({
      error: `Payment of ₹${b.amount.toFixed(2)} is more than the ₹${outstanding.toFixed(2)} outstanding on ${invoice.invoice_number}.`,
    });
  }

  const result = getDb().transaction(() => {
    const info = q.run(
      `INSERT INTO payments (invoice_id, vendor_id, payment_date, amount, mode, reference_no, bank, notes, created_by)
       VALUES (@invoiceId, @vendorId, @date, @amount, @mode, @ref, @bank, @notes, @uid)`,
      {
        invoiceId: b.invoiceId, vendorId: invoice.vendor_id, date: b.paymentDate,
        amount: round2(b.amount), mode: b.mode, ref: b.referenceNo, bank: b.bank,
        notes: b.notes, uid: req.user!.id,
      }
    );
    const state = resyncInvoice(b.invoiceId);
    return { id: Number(info.lastInsertRowid), state };
  })();

  audit(req, 'PAYMENT_ADDED', {
    entityType: 'payment', entityId: result.id,
    description: `₹${b.amount} received against ${invoice.invoice_number} via ${b.mode}`,
  });

  res.status(201).json({
    ok: true,
    data: q.get('SELECT * FROM payments WHERE id = @id', { id: result.id }),
    invoice: result.state,
    message: result.state.outstanding <= 0
      ? `Payment recorded. ${invoice.invoice_number} is now fully paid.`
      : `Payment recorded. ₹${result.state.outstanding.toFixed(2)} still outstanding on ${invoice.invoice_number}.`,
  });
});

router.delete('/:id', requirePermission('payments.delete'), (req, res) => {
  const payment = q.get<any>('SELECT * FROM payments WHERE id = @id', { id: req.params.id });
  if (!payment) return res.status(404).json({ error: 'Payment not found.' });

  getDb().transaction(() => {
    q.run('DELETE FROM payments WHERE id = @id', { id: req.params.id });
    resyncInvoice(payment.invoice_id);
  })();

  audit(req, 'PAYMENT_DELETED', {
    entityType: 'payment', entityId: Number(req.params.id),
    description: `₹${payment.amount} payment reversed`,
  });
  res.json({ ok: true });
});

/** Bulk mark-paid used by the invoice list's "Mark Paid" action. */
router.post('/bulk-settle', requirePermission('payments.create'), (req, res) => {
  const ids = (req.body?.invoiceIds ?? []) as number[];
  const paymentDate = String(req.body?.paymentDate ?? new Date().toISOString().slice(0, 10));
  const mode = String(req.body?.mode ?? 'BANK_TRANSFER');
  if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: 'Select at least one invoice.' });

  const settled: string[] = [];
  const skipped: string[] = [];

  getDb().transaction(() => {
    for (const id of ids) {
      const inv = q.get<any>('SELECT * FROM invoices WHERE id = @id', { id });
      if (!inv || inv.status === 'CANCELLED' || Number(inv.outstanding_amount) <= 0) {
        if (inv) skipped.push(inv.invoice_number);
        continue;
      }
      q.run(
        `INSERT INTO payments (invoice_id, vendor_id, payment_date, amount, mode, notes, created_by)
         VALUES (@i, @v, @d, @a, @m, 'Bulk settlement', @u)`,
        { i: id, v: inv.vendor_id, d: paymentDate, a: round2(inv.outstanding_amount), m: mode, u: req.user!.id }
      );
      resyncInvoice(id);
      settled.push(inv.invoice_number);
    }
  })();

  audit(req, 'PAYMENT_ADDED', { description: `Bulk settled ${settled.length} invoice(s)`, meta: { settled, skipped } });
  res.json({
    ok: true, settled, skipped,
    message: `${settled.length} invoice(s) marked paid${skipped.length ? `, ${skipped.length} skipped` : ''}.`,
  });
});

export default router;
