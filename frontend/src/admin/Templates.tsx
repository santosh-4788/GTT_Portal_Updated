import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, errorMessage, downloadFile } from '../lib/api';
import { dmyTime } from '../lib/format';
import { Loading, EmptyState, ErrorState, Modal, Spinner, Field, ConfirmDialog, StatusBadge } from '../components/ui';
import { IconDuplicate } from '../components/icons';
import { useToast } from '../components/Toast';
import { useAuth } from '../lib/auth';

export default function Templates() {
  const [rows, setRows] = useState<any[]>([]);
  const [libreOffice, setLibreOffice] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [uploadOpen, setUploadOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [inspect, setInspect] = useState<any>(null);
  const [toDelete, setToDelete] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [upload, setUpload] = useState({ name: '', description: '', documentTitle: 'Tax Invoice', sheetName: '', mode: 'single' });
  const toast = useToast();
  const { can } = useAuth();

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await api.get('/templates');
      setRows(data.data ?? []);
      setLibreOffice(!!data.libreOffice);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const doUpload = async () => {
    const file = fileRef.current?.files?.[0];
    if (!file) { toast.error('Choose a template file first.'); return; }
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      Object.entries(upload).forEach(([k, v]) => fd.append(k, v));
      await api.post('/templates', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      toast.success('Template uploaded', 'Now map its fields so the engine knows where to write values.');
      setUploadOpen(false);
      setUpload({ name: '', description: '', documentTitle: 'Tax Invoice', sheetName: '', mode: 'single' });
      load();
    } catch (err) {
      toast.error('Upload failed', errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const saveMapping = async () => {
    setBusy(true);
    try {
      JSON.parse(editing.mapping_json);   // validate before sending
      await api.put(`/templates/${editing.id}`, {
        name: editing.name,
        description: editing.description,
        documentTitle: editing.document_title,
        sheetName: editing.sheet_name,
        mode: editing.mode,
        isActive: !!editing.is_active,
        mapping: editing.mapping_json,
      });
      toast.success('Template saved');
      setEditing(null);
      load();
    } catch (err: any) {
      if (err instanceof SyntaxError) toast.error('The field mapping is not valid JSON', err.message);
      else toast.error('Could not save the template', errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const test = async (t: any) => {
    try {
      const { data } = await api.post(`/templates/${t.id}/test`);
      toast.success(data.message, data.warnings?.length ? data.warnings.join('\n') : 'Download it to check the layout.');
      await downloadFile(`/templates/${t.id}/test/download`);
    } catch (err) {
      toast.error('Sample generation failed', errorMessage(err));
    }
  };

  const doInspect = async (t: any) => {
    try {
      const { data } = await api.get(`/templates/${t.id}/inspect`);
      setInspect(data.data);
    } catch (err) {
      toast.error('Could not read the template', errorMessage(err));
    }
  };

  const duplicate = async (t: any) => {
    try {
      await api.post(`/templates/${t.id}/duplicate`);
      toast.success(`Copied "${t.name}"`);
      load();
    } catch (err) {
      toast.error('Could not duplicate', errorMessage(err));
    }
  };

  const remove = async () => {
    if (!toDelete) return;
    setBusy(true);
    try {
      const { data } = await api.delete(`/templates/${toDelete.id}`);
      toast.success(data.message ?? 'Template deleted');
      setToDelete(null);
      load();
    } catch (err) {
      toast.error('Could not delete', errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <div className="page-head animate-fade-down">
        <div>
          <Link to="/admin/settings" className="text-xs text-ink-500 hover:text-brand-600">← Back to settings</Link>
          <h1 className="mt-1 text-2xl font-bold text-ink-900">Invoice templates</h1>
          <p className="page-sub">
            Each vendor's own invoice file, with a JSON map telling the engine which cell holds which value.
            The originals in <span className="font-mono text-xs">E:\Portal\InvoiceFormat</span> are never modified.
          </p>
        </div>
        {can('settings.create') && (
          <button onClick={() => setUploadOpen(true)} className="btn-primary btn-sm">+ Upload template</button>
        )}
      </div>

      {!libreOffice && (
        <div className="rounded-xl border border-warn-100 bg-warn-50 p-4 text-sm text-warn-600">
          <strong>LibreOffice is not installed.</strong> Excel and Word invoices generate normally, but automatic
          conversion to PDF is unavailable. Install LibreOffice (free) if you want a PDF copy alongside each XLSX/DOCX.
        </div>
      )}

      {loading ? <Loading /> : error ? <ErrorState message={error} onRetry={load} /> : rows.length === 0 ? (
        <div className="card">
          <EmptyState title="No templates yet"
            body="Upload a vendor's invoice file (XLSX, DOCX or PDF). The engine fills it in and saves a new copy, keeping the original layout intact."
            action={can('settings.create') ? <button onClick={() => setUploadOpen(true)} className="btn-primary btn-sm">+ Upload template</button> : undefined} />
        </div>
      ) : (
        <div className="stagger grid gap-4 md:grid-cols-2">
          {rows.map((t) => {
            let cellCount = 0;
            try { cellCount = Object.keys(JSON.parse(t.mapping_json || '{}').cells ?? {}).length; } catch { /* shown as 0 */ }
            return (
              <div key={t.id} className="card p-5">
                <div className="flex items-start gap-3">
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-brand-50 text-xl">
                    {t.file_type === 'xlsx' ? '📊' : t.file_type === 'docx' ? '📝' : '📄'}
                  </span>
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate font-semibold text-ink-900">{t.name}</h3>
                    <p className="truncate text-xs text-ink-500">{t.original_name ?? t.file_name}</p>
                  </div>
                  <StatusBadge value={t.is_active ? 'ACTIVE' : 'INACTIVE'} />
                </div>

                {t.description && <p className="mt-3 text-xs leading-relaxed text-ink-600">{t.description}</p>}

                {!t.file_exists && (
                  <p className="mt-3 rounded-lg bg-danger-50 px-3 py-2 text-xs text-danger-600">
                    The file is missing from the templates folder — re-upload it before generating invoices.
                  </p>
                )}

                <dl className="mt-4 grid grid-cols-2 gap-2 text-xs">
                  <div><dt className="text-ink-500">Type</dt><dd className="font-medium text-ink-800">{t.file_type}</dd></div>
                  <div><dt className="text-ink-500">Mode</dt><dd className="font-medium text-ink-800">{t.mode}</dd></div>
                  <div><dt className="text-ink-500">Sheet</dt><dd className="font-medium text-ink-800">{t.sheet_name || '—'}</dd></div>
                  <div><dt className="text-ink-500">Title</dt><dd className="font-medium text-ink-800">{t.document_title}</dd></div>
                  <div><dt className="text-ink-500">Mapped cells</dt><dd className="font-medium text-ink-800">{cellCount}</dd></div>
                  <div><dt className="text-ink-500">Used by</dt><dd className="font-medium text-ink-800">{t.vendor_count} vendor(s)</dd></div>
                </dl>

                <div className="mt-4 flex flex-wrap gap-1.5 border-t border-ink-100 pt-4">
                  {can('settings.update') && (
                    <button onClick={() => setEditing({ ...t })} className="btn-outline btn-sm">Edit mapping</button>
                  )}
                  <button onClick={() => test(t)} className="btn-outline btn-sm" disabled={!t.file_exists}>Test</button>
                  {t.file_type === 'xlsx' && (
                    <button onClick={() => doInspect(t)} className="btn-ghost btn-sm" disabled={!t.file_exists}>Inspect cells</button>
                  )}
                  <button
                    onClick={() => downloadFile(`/templates/${t.id}/download`).catch((e) => toast.error('Download failed', errorMessage(e)))}
                    className="btn-ghost btn-sm" disabled={!t.file_exists}
                  >
                    ⬇
                  </button>
                  {can('settings.create') && (
                    <button onClick={() => duplicate(t)} className="btn-ghost btn-icon" title="Duplicate" aria-label="Duplicate"><IconDuplicate className="h-4 w-4" /></button>
                  )}
                  {can('settings.delete') && (
                    <button onClick={() => setToDelete(t)} className="btn-ghost btn-sm text-danger-600">🗑</button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* upload */}
      <Modal
        open={uploadOpen} onClose={() => setUploadOpen(false)} title="Upload an invoice template" size="md"
        subtitle="XLSX, XLS, DOCX, DOC, PDF or CSV. Maximum 15 MB."
        footer={
          <>
            <button className="btn-outline" onClick={() => setUploadOpen(false)} disabled={busy}>Cancel</button>
            <button className="btn-primary" onClick={doUpload} disabled={busy}>
              {busy && <Spinner className="h-4 w-4" />} Upload
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Template file" required>
            <input ref={fileRef} type="file" className="input py-2"
              accept=".xlsx,.xls,.xlsm,.docx,.doc,.pdf,.csv" />
          </Field>
          <Field label="Template name" required hint="e.g. “Wagon — Local (Credit Note)”">
            <input className="input" value={upload.name} onChange={(e) => setUpload((u) => ({ ...u, name: e.target.value }))} />
          </Field>
          <Field label="Description">
            <textarea className="input min-h-[64px] resize-y" value={upload.description}
              onChange={(e) => setUpload((u) => ({ ...u, description: e.target.value }))} />
          </Field>
          <div className="stagger grid gap-4 sm:grid-cols-3">
            <Field label="Sheet name" hint="Excel only">
              <input className="input" value={upload.sheetName} placeholder="LOCAL"
                onChange={(e) => setUpload((u) => ({ ...u, sheetName: e.target.value }))} />
            </Field>
            <Field label="Document title">
              <input className="input" value={upload.documentTitle}
                onChange={(e) => setUpload((u) => ({ ...u, documentTitle: e.target.value }))} />
            </Field>
            <Field label="Mode">
              <select className="input" value={upload.mode} onChange={(e) => setUpload((u) => ({ ...u, mode: e.target.value }))}>
                <option value="single">Single booking</option>
                <option value="consolidated">Consolidated</option>
              </select>
            </Field>
          </div>
          <p className="rounded-lg bg-ink-50 p-3.5 text-xs leading-relaxed text-ink-600">
            After uploading, use <strong>Inspect cells</strong> to see what is in each cell, then <strong>Edit mapping</strong>
            to point cells at fields such as <span className="font-mono">vendor.companyName</span> or{' '}
            <span className="font-mono">billing.baseFare</span>.
          </p>
        </div>
      </Modal>

      {/* mapping editor */}
      <Modal
        open={!!editing} onClose={() => setEditing(null)} title="Edit template" size="lg"
        subtitle={editing?.original_name}
        footer={
          <>
            <button className="btn-outline" onClick={() => setEditing(null)} disabled={busy}>Cancel</button>
            <button className="btn-primary" onClick={saveMapping} disabled={busy}>
              {busy && <Spinner className="h-4 w-4" />} Save template
            </button>
          </>
        }
      >
        {editing && (
          <div className="space-y-4">
            <div className="stagger grid gap-4 sm:grid-cols-2">
              <Field label="Name">
                <input className="input" value={editing.name} onChange={(e) => setEditing((t: any) => ({ ...t, name: e.target.value }))} />
              </Field>
              <Field label="Document title">
                <input className="input" value={editing.document_title ?? ''}
                  onChange={(e) => setEditing((t: any) => ({ ...t, document_title: e.target.value }))} />
              </Field>
              <Field label="Sheet name">
                <input className="input" value={editing.sheet_name ?? ''}
                  onChange={(e) => setEditing((t: any) => ({ ...t, sheet_name: e.target.value }))} />
              </Field>
              <Field label="Mode">
                <select className="input" value={editing.mode}
                  onChange={(e) => setEditing((t: any) => ({ ...t, mode: e.target.value }))}>
                  <option value="single">Single booking</option>
                  <option value="consolidated">Consolidated</option>
                </select>
              </Field>
            </div>

            <label className="flex cursor-pointer items-center gap-2.5 text-sm">
              <input type="checkbox" className="check" checked={!!editing.is_active}
                onChange={(e) => setEditing((t: any) => ({ ...t, is_active: e.target.checked ? 1 : 0 }))} />
              <span className="font-medium text-ink-800">Active — available for assignment to vendors</span>
            </label>

            <Field label="Field mapping (JSON)"
              hint="cells: { CELL: { field | static, type } } · formulaCells lists cells the writer must skip">
              <textarea
                className="input min-h-[300px] resize-y font-mono text-[11px] leading-relaxed"
                value={editing.mapping_json ?? '{}'}
                onChange={(e) => setEditing((t: any) => ({ ...t, mapping_json: e.target.value }))}
                spellCheck={false}
              />
            </Field>

            <details className="rounded-lg bg-ink-50 p-3.5">
              <summary className="cursor-pointer text-xs font-semibold text-ink-700">Available field names</summary>
              <div className="mt-3 grid gap-3 text-[11px] sm:grid-cols-2 lg:grid-cols-4">
                {[
                  ['company', ['name', 'legalName', 'owner', 'mobile', 'email', 'addressInvoice', 'addressInvoice2', 'gstin', 'pan', 'bankName', 'bankAccount', 'bankIfsc']],
                  ['vendor', ['vendorName', 'companyName', 'billingAddress', 'gstNumber', 'pan', 'contactPerson', 'mobile', 'email', 'city', 'state']],
                  ['invoice', ['invoiceNumber', 'invoiceDate', 'documentTitle', 'periodFrom', 'periodTo', 'amountInWords', 'notes']],
                  ['booking', ['bookingCode', 'vendorBookingRef', 'travelDate', 'reportingTime', 'passengerName', 'passengerMobile', 'pickupLocation', 'dropLocation', 'route', 'vehicleNumber', 'vehicleType', 'driverName', 'dutyType', 'particular']],
                  ['billing', ['baseFare', 'extraKm', 'extraKmRate', 'extraHours', 'extraHourRate', 'toll', 'parking', 'tollParking', 'taxableAmount', 'taxRate', 'cgst', 'sgst', 'igst', 'taxAmount', 'nonTaxableAmount', 'invoiceValue', 'totalAmount']],
                ].map(([group, fields]) => (
                  <div key={group as string}>
                    <p className="font-bold text-ink-700">{group as string}</p>
                    <ul className="mt-1 space-y-0.5 font-mono text-ink-500">
                      {(fields as string[]).map((f) => <li key={f}>{group as string}.{f}</li>)}
                    </ul>
                  </div>
                ))}
              </div>
            </details>
          </div>
        )}
      </Modal>

      {/* cell inspector */}
      <Modal
        open={!!inspect} onClose={() => setInspect(null)} title={`Cells in ${inspect?.name ?? ''}`} size="xl"
        subtitle="What is currently in each cell of the template workbook. Use this to build the mapping."
        footer={<button className="btn-outline" onClick={() => setInspect(null)}>Close</button>}
      >
        {inspect?.sheets.map((s: any) => (
          <div key={s.name} className="mb-6">
            <h3 className="mb-2 font-semibold text-ink-900">Sheet: {s.name}</h3>
            {s.merges?.length > 0 && (
              <p className="mb-2 text-[11px] text-ink-500">
                <strong>Merged:</strong> <span className="font-mono">{s.merges.join(', ')}</span>
              </p>
            )}
            <div className="table-wrap max-h-[50vh] overflow-y-auto">
              <table className="tbl">
                <thead><tr><th className="w-20">Cell</th><th>Content</th><th className="w-20">Type</th></tr></thead>
                <tbody>
                  {s.cells.map((c: any) => (
                    <tr key={c.address}>
                      <td className="font-mono text-xs font-semibold text-brand-600">{c.address}</td>
                      <td className="text-xs text-ink-800">{c.value}</td>
                      <td>
                        {c.isFormula
                          ? <span className="badge-warn">formula</span>
                          : <span className="badge-neutral">value</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </Modal>

      <ConfirmDialog
        open={!!toDelete} onClose={() => setToDelete(null)} onConfirm={remove} busy={busy} danger
        title="Delete this template?" confirmLabel="Delete template"
        body={
          <>
            <p><strong>{toDelete?.name}</strong> and its stored file will be removed.</p>
            <p className="mt-2 text-ink-500">
              Templates in use by a vendor cannot be deleted. Templates with generated invoices are deactivated instead.
              The original file in <span className="font-mono">E:\Portal\InvoiceFormat</span> is not touched.
            </p>
          </>
        }
      />
    </div>
  );
}
