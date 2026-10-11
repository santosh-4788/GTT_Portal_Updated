/**
 * OnSheet API calls and shared types. Every access rule is enforced by the
 * server; the `access` values here only decide which buttons to show.
 */
import { api, downloadFile } from '../../lib/api';

export type Access = 'OWNER' | 'MANAGE' | 'EDIT' | 'VIEW';
export type SharePermission = 'VIEW' | 'EDIT' | 'MANAGE';
export type Scope = 'recent' | 'mine' | 'shared' | 'all';
export type SortKey = 'updated_desc' | 'updated_asc' | 'name_asc' | 'name_desc';

export interface SheetFile {
  uid: string;
  name: string;
  ownerId: number;
  ownerName: string;
  access: Access;
  createdAt: string;
  updatedAt: string;
  updatedByName: string | null;
  version: number;
  sizeBytes: number;
  sheetCount: number;
  shareCount: number;
  openedAt: string | null;
}

export interface OpenedFile extends Omit<SheetFile, 'shareCount' | 'openedAt'> {
  /** Univer IWorkbookData snapshot. */
  data: any;
}

export interface ShareRow {
  userId: number;
  fullName: string;
  email: string;
  isActive: boolean;
  permission: SharePermission;
  grantedByName: string | null;
}
export interface SharesInfo {
  owner: { userId: number; fullName: string; email: string } | null;
  myAccess: Access;
  canGrantManage: boolean;
  shares: ShareRow[];
}
export interface PortalUser { id: number; fullName: string; email: string }
export interface PresenceInfo {
  others: { userId: number; name: string; editing: boolean; lastSeen: string }[];
  version: number;
  updatedAt?: string;
  updatedBy?: string | null;
}

export const NAME_MAX = 120;

/** Client-side check matching the server's rule. Returns an error or ''. */
export function nameError(raw: string): string {
  const n = raw.replace(/\s+/g, ' ').trim();
  if (!n) return 'Give the spreadsheet a name.';
  if (n.length > NAME_MAX) return `The name can be at most ${NAME_MAX} characters.`;
  return '';
}

export const canEdit = (a?: Access | null) => a === 'OWNER' || a === 'MANAGE' || a === 'EDIT';
export const canShare = (a?: Access | null) => a === 'OWNER' || a === 'MANAGE';
export const isOwner = (a?: Access | null) => a === 'OWNER';

export const ACCESS_LABEL: Record<Access, string> = { OWNER: 'Owner', MANAGE: 'Can manage', EDIT: 'Can edit', VIEW: 'View only' };
export const ACCESS_BADGE: Record<Access, string> = { OWNER: 'badge-brand', MANAGE: 'badge-ok', EDIT: 'badge-warn', VIEW: 'badge-neutral' };

export function formatBytes(n: number): string {
  if (!n) return '0 KB';
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

const enc = encodeURIComponent;

export const onsheetApi = {
  list: (scope: Scope, search: string, sort: SortKey | '') =>
    api.get<{ files: SheetFile[] }>('/onsheet/files', { params: { scope, search: search || undefined, sort: sort || undefined } })
      .then((r) => r.data.files),
  create: (name: string, data?: unknown) =>
    api.post<{ uid: string; name: string; version: number }>('/onsheet/files', { name, ...(data ? { data } : {}) }, { timeout: 120_000 })
      .then((r) => r.data),
  open: (uid: string) => api.get<OpenedFile>(`/onsheet/files/${enc(uid)}`, { timeout: 120_000 }).then((r) => r.data),
  save: (uid: string, data: unknown, baseVersion: number, force = false) =>
    api.put<{ ok: true; version: number; updatedAt: string; sizeBytes: number; sheetCount: number }>(
      `/onsheet/files/${enc(uid)}`, { data, baseVersion, ...(force ? { force: true } : {}) }, { timeout: 120_000 },
    ).then((r) => r.data),
  rename: (uid: string, name: string) =>
    api.patch<{ ok: true; name: string }>(`/onsheet/files/${enc(uid)}`, { name }).then((r) => r.data),
  duplicate: (uid: string, name?: string) =>
    api.post<{ uid: string; name: string }>(`/onsheet/files/${enc(uid)}/duplicate`, name ? { name } : {}).then((r) => r.data),
  remove: (uid: string) => api.delete(`/onsheet/files/${enc(uid)}`).then((r) => r.data),
  shares: (uid: string) => api.get<SharesInfo>(`/onsheet/files/${enc(uid)}/shares`).then((r) => r.data),
  setShare: (uid: string, userId: number, permission: SharePermission) =>
    api.put<{ ok: true; shares: ShareRow[] }>(`/onsheet/files/${enc(uid)}/shares`, { userId, permission }).then((r) => r.data),
  removeShare: (uid: string, userId: number) =>
    api.delete<{ ok: true; shares: ShareRow[] }>(`/onsheet/files/${enc(uid)}/shares/${userId}`).then((r) => r.data),
  users: (search: string) =>
    api.get<{ users: PortalUser[] }>('/onsheet/users', { params: { search: search || undefined } }).then((r) => r.data.users),
  importFile: (file: File, name?: string) => {
    const fd = new FormData();
    fd.append('file', file);
    return api.post<{ uid: string; name: string; warnings: string[] }>('/onsheet/import', fd, {
      params: name ? { name } : undefined, timeout: 180_000,
    }).then((r) => r.data);
  },
  download: (uid: string, format: 'xlsx' | 'csv', sheetId?: string) =>
    downloadFile(`/onsheet/files/${enc(uid)}/export?format=${format}${sheetId ? `&sheetId=${enc(sheetId)}` : ''}`),
  presence: (uid: string, leaving = false) =>
    api.post<PresenceInfo>(`/onsheet/files/${enc(uid)}/presence`, leaving ? { leaving: true } : {}).then((r) => r.data),
};

/** Import file checks done before uploading (the server checks again). */
export const IMPORT_MAX_BYTES = 15 * 1024 * 1024;
export function importFileError(f: File): string {
  const ext = f.name.toLowerCase().slice(f.name.lastIndexOf('.'));
  if (ext === '.xls') return 'Old .xls files cannot be imported. Open it in Excel and save it as .xlsx first.';
  if (ext !== '.xlsx' && ext !== '.csv') return 'Choose an Excel (.xlsx) or CSV (.csv) file.';
  if (f.size > IMPORT_MAX_BYTES) return 'That file is larger than 15 MB.';
  if (!f.size) return 'That file is empty.';
  return '';
}
