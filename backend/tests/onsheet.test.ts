/**
 * OnSheet: files, sharing, version conflicts, and Excel/CSV round trips.
 *
 * Own port and scratch database, like the other suites.
 *
 * Run:  npm test
 */
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import ExcelJS from 'exceljs';

const TEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gtt-onsheet-'));
process.env.DB_FILE = path.join(TEST_DIR, 'onsheet.db');
process.env.PORT = '4133';
process.env.JWT_SECRET = 'onsheet-test-secret';
process.env.NODE_ENV = 'test';
process.env.MAIL_APP_PASSWORD = '';

const BASE = 'http://127.0.0.1:4133/api';

let adminToken = '';
let opsToken = '';
let opsId = 0;
let thirdToken = '';
let thirdId = 0;

async function req(method: string, url: string, body?: any, auth?: string) {
  const res = await fetch(BASE + url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${auth}` } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text }; }
  return { status: res.status, body: json, headers: res.headers };
}
const admin = (m: string, u: string, b?: any) => req(m, u, b, adminToken);
const ops = (m: string, u: string, b?: any) => req(m, u, b, opsToken);
const third = (m: string, u: string, b?: any) => req(m, u, b, thirdToken);

async function upload(url: string, filename: string, data: Buffer, auth: string) {
  const fd = new FormData();
  fd.append('file', new Blob([data]), filename);
  const res = await fetch(BASE + url, { method: 'POST', headers: { Authorization: `Bearer ${auth}` }, body: fd });
  return { status: res.status, body: await res.json().catch(() => null) };
}
async function download(url: string, auth: string) {
  const res = await fetch(BASE + url, { headers: { Authorization: `Bearer ${auth}` } });
  return { status: res.status, buf: Buffer.from(await res.arrayBuffer()), headers: res.headers };
}

async function waitForServer(timeoutMs = 15_000) {
  const started = Date.now();
  for (;;) {
    try {
      const r = await fetch(`${BASE}/health`);
      if (r.ok) return;
    } catch { /* not yet */ }
    if (Date.now() - started > timeoutMs) throw new Error(`The test server never came up on ${BASE}.`);
    await new Promise((r) => setTimeout(r, 150));
  }
}

async function makeUser(email: string, fullName: string): Promise<{ id: number; token: string }> {
  const created = await admin('POST', '/users', { email, fullName, roleCode: 'OPERATIONS', password: 'Start@2026' });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const login = await req('POST', '/auth/login', { email, password: 'Start@2026' });
  assert.equal(login.status, 200);
  const change = await req('POST', '/auth/change-password', {
    currentPassword: 'Start@2026', newPassword: 'Changed@2027', confirmPassword: 'Changed@2027',
  }, login.body.token);
  assert.equal(change.status, 200, JSON.stringify(change.body));
  return { id: created.body.id, token: login.body.token };
}

before(async () => {
  const { applySchema, getDb } = await import('../src/db');
  applySchema();
  getDb();
  await import('../src/db/seed');
  await import('../src/server');
  await waitForServer();

  const login = await req('POST', '/auth/login', { email: 'Admin@gmail.com', password: 'Pass@123' });
  adminToken = login.body.token;
  await admin('POST', '/auth/change-password', {
    currentPassword: 'Pass@123', newPassword: 'OnSheetTest1', confirmPassword: 'OnSheetTest1',
  });

  const a = await makeUser('ops.sheet@test.local', 'Ops Sheet User');
  opsId = a.id; opsToken = a.token;
  const b = await makeUser('third.sheet@test.local', 'Third Sheet User');
  thirdId = b.id; thirdToken = b.token;
});

after(async () => {
  const { httpServer } = await import('../src/server');
  await new Promise<void>((resolve) => (httpServer ? httpServer.close(() => resolve()) : resolve()));
  const { closeDb } = await import('../src/db');
  closeDb();
  try { fs.rmSync(TEST_DIR, { recursive: true, force: true }); } catch { /* temp */ }
});

const state = { uid: '', version: 1, copyUid: '', data: null as any };

/* ========================================================================== */

describe('Files', () => {
  test('creates a blank spreadsheet', async () => {
    const r = await admin('POST', '/onsheet/files', { name: '  Fleet costs  ' });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.name, 'Fleet costs');
    assert.ok(r.body.uid);
    state.uid = r.body.uid;
  });

  test('refuses an empty or over-long name', async () => {
    assert.equal((await admin('POST', '/onsheet/files', { name: '   ' })).status, 400);
    assert.equal((await admin('POST', '/onsheet/files', { name: 'x'.repeat(121) })).status, 400);
  });

  test('opens it with a valid blank workbook and owner access', async () => {
    const r = await admin('GET', `/onsheet/files/${state.uid}`);
    assert.equal(r.status, 200);
    assert.equal(r.body.access, 'OWNER');
    assert.equal(r.body.version, 1);
    const d = r.body.data;
    assert.equal(d.id, state.uid);
    assert.equal(d.sheetOrder.length, 1);
    const sheet = d.sheets[d.sheetOrder[0]];
    assert.equal(sheet.rowCount, 1000);
    assert.equal(sheet.columnCount, 26);
    assert.deepEqual(d.styles, {});
    state.data = d;
  });

  test('lists it under mine, all and recent', async () => {
    for (const scope of ['mine', 'all', 'recent']) {
      const r = await admin('GET', `/onsheet/files?scope=${scope}`);
      assert.equal(r.status, 200);
      const f = r.body.files.find((x: any) => x.uid === state.uid);
      assert.ok(f, `missing from ${scope}`);
      assert.equal(f.access, 'OWNER');
      assert.equal(f.ownerName.length > 0, true);
      assert.equal(f.data_json, undefined);
    }
    const s = await admin('GET', '/onsheet/files?scope=mine&search=fleet&sort=name_asc');
    assert.equal(s.body.files.length, 1);
    const none = await admin('GET', '/onsheet/files?scope=mine&search=nothing-like-this');
    assert.equal(none.body.files.length, 0);
  });

  test('saves content and bumps the version', async () => {
    const d = state.data;
    const sid = d.sheetOrder[0];
    d.sheets[sid].cellData = { 0: { 0: { v: 10, t: 2 }, 1: { f: '=A1*2', v: 20, t: 2 } } };
    const r = await admin('PUT', `/onsheet/files/${state.uid}`, { data: d, baseVersion: 1 });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.version, 2);
    state.version = 2;
    const back = await admin('GET', `/onsheet/files/${state.uid}`);
    assert.equal(back.body.data.sheets[sid].cellData['0']['1'].f, '=A1*2');
  });

  test('rejects a malformed snapshot', async () => {
    const r = await admin('PUT', `/onsheet/files/${state.uid}`, { data: { foo: 1 }, baseVersion: state.version });
    assert.equal(r.status, 400);
  });

  test('a stale baseVersion gets 409 VERSION_CONFLICT; force overwrites', async () => {
    const stale = await admin('PUT', `/onsheet/files/${state.uid}`, { data: state.data, baseVersion: 1 });
    assert.equal(stale.status, 409);
    assert.equal(stale.body.code, 'VERSION_CONFLICT');
    assert.equal(stale.body.currentVersion, 2);
    assert.ok(stale.body.updatedBy);

    const forced = await admin('PUT', `/onsheet/files/${state.uid}`, { data: state.data, baseVersion: 1, force: true });
    assert.equal(forced.status, 200);
    assert.equal(forced.body.version, 3);
    state.version = 3;
  });

  test('renames', async () => {
    const r = await admin('PATCH', `/onsheet/files/${state.uid}`, { name: 'Fleet costs 2026' });
    assert.equal(r.status, 200);
    const back = await admin('GET', `/onsheet/files/${state.uid}`);
    assert.equal(back.body.name, 'Fleet costs 2026');
    assert.equal(back.body.data.name, 'Fleet costs 2026');
  });

  test('duplicates into a new file owned by me', async () => {
    const r = await admin('POST', `/onsheet/files/${state.uid}/duplicate`, {});
    assert.equal(r.status, 201);
    assert.equal(r.body.name, 'Copy of Fleet costs 2026');
    assert.notEqual(r.body.uid, state.uid);
    state.copyUid = r.body.uid;
    const back = await admin('GET', `/onsheet/files/${r.body.uid}`);
    assert.equal(back.body.data.id, r.body.uid);
    assert.equal(back.body.version, 1);
    const sid = back.body.data.sheetOrder[0];
    assert.equal(back.body.data.sheets[sid].cellData['0']['0'].v, 10);
  });

  test('deletes (soft) — gone from the list and from open', async () => {
    const r = await admin('DELETE', `/onsheet/files/${state.copyUid}`);
    assert.equal(r.status, 200);
    assert.equal((await admin('GET', `/onsheet/files/${state.copyUid}`)).status, 404);
    const list = await admin('GET', '/onsheet/files?scope=all');
    assert.equal(list.body.files.some((f: any) => f.uid === state.copyUid), false);
  });
});

describe('Sharing and access', () => {
  test('a user it is not shared with cannot open, save or list it', async () => {
    const open = await ops('GET', `/onsheet/files/${state.uid}`);
    assert.ok(open.status === 404 || open.status === 403);
    const save = await ops('PUT', `/onsheet/files/${state.uid}`, { data: state.data, baseVersion: state.version });
    assert.ok(save.status === 404 || save.status === 403);
    const exp = await download(`/onsheet/files/${state.uid}/export?format=xlsx`, opsToken);
    assert.ok(exp.status === 404 || exp.status === 403);
    const list = await ops('GET', '/onsheet/files?scope=all');
    assert.equal(list.body.files.some((f: any) => f.uid === state.uid), false);
  });

  test('the share picker lists active users', async () => {
    const r = await admin('GET', '/onsheet/users?search=sheet');
    assert.equal(r.status, 200);
    assert.ok(r.body.users.some((u: any) => u.id === opsId));
  });

  test('cannot share with the owner', async () => {
    const me = await admin('GET', `/onsheet/files/${state.uid}`);
    const r = await admin('PUT', `/onsheet/files/${state.uid}/shares`, { userId: me.body.ownerId, permission: 'VIEW' });
    assert.equal(r.status, 400);
  });

  test('a VIEW share opens and downloads but cannot change anything', async () => {
    const s = await admin('PUT', `/onsheet/files/${state.uid}/shares`, { userId: opsId, permission: 'VIEW' });
    assert.equal(s.status, 200, JSON.stringify(s.body));
    assert.equal(s.body.shares[0].permission, 'VIEW');

    const open = await ops('GET', `/onsheet/files/${state.uid}`);
    assert.equal(open.status, 200);
    assert.equal(open.body.access, 'VIEW');
    const shared = await ops('GET', '/onsheet/files?scope=shared');
    assert.ok(shared.body.files.some((f: any) => f.uid === state.uid && f.access === 'VIEW'));

    const exp = await download(`/onsheet/files/${state.uid}/export?format=xlsx`, opsToken);
    assert.equal(exp.status, 200);

    assert.equal((await ops('PUT', `/onsheet/files/${state.uid}`, { data: open.body.data, baseVersion: open.body.version })).status, 403);
    assert.equal((await ops('PATCH', `/onsheet/files/${state.uid}`, { name: 'Hacked' })).status, 403);
    assert.equal((await ops('DELETE', `/onsheet/files/${state.uid}`)).status, 403);
    assert.equal((await ops('PUT', `/onsheet/files/${state.uid}/shares`, { userId: thirdId, permission: 'VIEW' })).status, 403);
    assert.equal((await ops('GET', `/onsheet/files/${state.uid}/shares`)).status, 403);
  });

  test('an EDIT share can save and rename but not delete or share', async () => {
    const s = await admin('PUT', `/onsheet/files/${state.uid}/shares`, { userId: opsId, permission: 'EDIT' });
    assert.equal(s.status, 200);
    const open = await ops('GET', `/onsheet/files/${state.uid}`);
    assert.equal(open.body.access, 'EDIT');
    const d = open.body.data;
    d.sheets[d.sheetOrder[0]].cellData['1'] = { 0: { v: 'edited by ops', t: 1 } };
    const save = await ops('PUT', `/onsheet/files/${state.uid}`, { data: d, baseVersion: open.body.version });
    assert.equal(save.status, 200, JSON.stringify(save.body));
    state.version = save.body.version;

    // The owner's copy is now out of date.
    const conflict = await admin('PUT', `/onsheet/files/${state.uid}`, { data: state.data, baseVersion: state.version - 1 });
    assert.equal(conflict.status, 409);
    assert.equal(conflict.body.updatedBy, 'Ops Sheet User');

    assert.equal((await ops('PATCH', `/onsheet/files/${state.uid}`, { name: 'Fleet costs (ops)' })).status, 200);
    assert.equal((await ops('DELETE', `/onsheet/files/${state.uid}`)).status, 403);
    assert.equal((await ops('PUT', `/onsheet/files/${state.uid}/shares`, { userId: thirdId, permission: 'VIEW' })).status, 403);
  });

  test('MANAGE can share View/Edit but not hand out Manage', async () => {
    const s = await admin('PUT', `/onsheet/files/${state.uid}/shares`, { userId: opsId, permission: 'MANAGE' });
    assert.equal(s.status, 200);
    const list = await ops('GET', `/onsheet/files/${state.uid}/shares`);
    assert.equal(list.status, 200);
    assert.equal(list.body.canGrantManage, false);

    assert.equal((await ops('PUT', `/onsheet/files/${state.uid}/shares`, { userId: thirdId, permission: 'MANAGE' })).status, 403);
    const ok = await ops('PUT', `/onsheet/files/${state.uid}/shares`, { userId: thirdId, permission: 'EDIT' });
    assert.equal(ok.status, 200);
    assert.equal((await third('GET', `/onsheet/files/${state.uid}`)).body.access, 'EDIT');

    const rm = await ops('DELETE', `/onsheet/files/${state.uid}/shares/${thirdId}`);
    assert.equal(rm.status, 200);
    assert.ok([403, 404].includes((await third('GET', `/onsheet/files/${state.uid}`)).status));
    assert.equal((await ops('DELETE', `/onsheet/files/${state.uid}`)).status, 403, 'MANAGE cannot delete');
  });

  test('the owner can remove a share', async () => {
    const r = await admin('DELETE', `/onsheet/files/${state.uid}/shares/${opsId}`);
    assert.equal(r.status, 200);
    assert.ok([403, 404].includes((await ops('GET', `/onsheet/files/${state.uid}`)).status));
  });

  test('presence reports who else has the file open', async () => {
    await admin('PUT', `/onsheet/files/${state.uid}/shares`, { userId: opsId, permission: 'VIEW' });
    await ops('POST', `/onsheet/files/${state.uid}/presence`, {});
    const r = await admin('POST', `/onsheet/files/${state.uid}/presence`, {});
    assert.equal(r.status, 200);
    assert.ok(r.body.others.some((o: any) => o.name === 'Ops Sheet User'));
  });
});

describe('Import and export', () => {
  let xlsxUid = '';

  async function sampleWorkbook(): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    const a = wb.addWorksheet('Costs');
    a.getCell('A1').value = 10;
    a.getCell('A2').value = 20;
    a.getCell('A3').value = 30;
    a.getCell('A4').value = { formula: 'SUM(A1:A3)', result: 60 } as any;
    a.getCell('B1').value = 'Bold heading';
    a.getCell('B1').font = { bold: true, color: { argb: 'FFFF0000' } };
    a.getCell('C1').value = 'Merged';
    a.mergeCells('C1:D2');
    a.getColumn(2).width = 30;
    a.views = [{ state: 'frozen', xSplit: 0, ySplit: 1 }];
    a.getCell('E1').note = 'A comment';
    const b = wb.addWorksheet('Summary');
    b.getCell('A1').value = { formula: 'Costs!A4*2', result: 120 } as any;
    b.getCell('A2').value = new Date(Date.UTC(2026, 0, 15));
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  test('imports an xlsx with formulas, styles, merges and two sheets', async () => {
    const r = await upload('/onsheet/import', 'Trip costs.xlsx', await sampleWorkbook(), adminToken);
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.name, 'Trip costs');
    assert.ok(Array.isArray(r.body.warnings));
    assert.ok(r.body.warnings.some((w: string) => /comment/i.test(w) && w.includes('Costs')), 'the dropped comment is reported');
    xlsxUid = r.body.uid;

    const open = await admin('GET', `/onsheet/files/${xlsxUid}`);
    const d = open.body.data;
    assert.deepEqual(d.sheetOrder.map((id: string) => d.sheets[id].name), ['Costs', 'Summary']);
    const costs = d.sheets[d.sheetOrder[0]];
    assert.equal(costs.cellData['3']['0'].f, '=SUM(A1:A3)');
    assert.equal(costs.cellData['3']['0'].v, 60);
    const bold = costs.cellData['0']['1'];
    const style = typeof bold.s === 'string' ? d.styles[bold.s] : bold.s;
    assert.equal(style.bl, 1);
    assert.equal(style.cl.rgb, '#FF0000');
    assert.deepEqual(costs.mergeData[0], { startRow: 0, endRow: 1, startColumn: 2, endColumn: 3 });
    assert.equal(costs.freeze.ySplit, 1);
    assert.ok(costs.columnData['1'].w > 150);
    const summary = d.sheets[d.sheetOrder[1]];
    assert.equal(summary.cellData['0']['0'].f, '=Costs!A4*2');
    const dateCell = summary.cellData['1']['0'];
    assert.equal(Math.round(dateCell.v), 46037);
    const ds = typeof dateCell.s === 'string' ? d.styles[dateCell.s] : dateCell.s;
    assert.ok(ds.n.pattern);
  });

  test('exports xlsx that Excel tooling reads back with formulas, values, merges and sheet names', async () => {
    const r = await download(`/onsheet/files/${xlsxUid}/export?format=xlsx`, adminToken);
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type') ?? '', /spreadsheetml/);
    assert.match(r.headers.get('content-disposition') ?? '', /Trip costs\.xlsx/);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(r.buf as any);
    assert.deepEqual(wb.worksheets.map((w) => w.name), ['Costs', 'Summary']);
    const costs = wb.getWorksheet('Costs')!;
    assert.equal(costs.getCell('A1').value, 10);
    assert.equal(costs.getCell('A4').formula, 'SUM(A1:A3)');
    assert.equal((costs.getCell('A4').value as any).result, 60);
    assert.equal(costs.getCell('B1').value, 'Bold heading');
    assert.equal(costs.getCell('B1').font?.bold, true);
    assert.equal(costs.getCell('D2').isMerged, true);
    assert.equal(costs.getCell('D2').master.address, 'C1');
    assert.equal(costs.getCell('C1').value, 'Merged');
    assert.equal((costs.views[0] as any).state, 'frozen');
    const summary = wb.getWorksheet('Summary')!;
    assert.equal(summary.getCell('A1').formula, 'Costs!A4*2');
  });

  test('expands shared (filled-down) formulas on export', async () => {
    const open = await admin('GET', `/onsheet/files/${xlsxUid}`);
    const d = open.body.data;
    const costs = d.sheets[d.sheetOrder[0]];
    costs.cellData['0']['5'] = { f: '=A1*$A$1', si: 'abc', v: 100, t: 2 };
    costs.cellData['1'] = { ...(costs.cellData['1'] ?? {}), 5: { si: 'abc', v: 200, t: 2 } };
    const save = await admin('PUT', `/onsheet/files/${xlsxUid}`, { data: d, baseVersion: open.body.version });
    assert.equal(save.status, 200);
    const r = await download(`/onsheet/files/${xlsxUid}/export?format=xlsx`, adminToken);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(r.buf as any);
    assert.equal(wb.getWorksheet('Costs')!.getCell('F2').formula, 'A2*$A$1');
  });

  test('csv export of one sheet, quoted, with a BOM', async () => {
    const open = await admin('GET', `/onsheet/files/${xlsxUid}`);
    const sid = open.body.data.sheetOrder[1];
    const r = await download(`/onsheet/files/${xlsxUid}/export?format=csv&sheetId=${sid}`, adminToken);
    assert.equal(r.status, 200);
    const text = r.buf.toString('utf8');
    assert.equal(text.charCodeAt(0), 0xfeff);
    const lines = text.slice(1).trim().split(/\r\n/);
    assert.equal(lines[0], '120');
    assert.equal(lines[1], '2026-01-15');
    assert.equal((await download(`/onsheet/files/${xlsxUid}/export?format=csv&sheetId=nope`, adminToken)).status, 404);
  });

  test('imports CSV and exports it back', async () => {
    const csv = 'Name,Amount,Phone\r\n"Sharma, R",1500.5,09820012345\r\n"He said ""hi""",-20,\r\n';
    const r = await upload('/onsheet/import', 'payments.csv', Buffer.from(csv, 'utf8'), adminToken);
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const open = await admin('GET', `/onsheet/files/${r.body.uid}`);
    const sheet = open.body.data.sheets[open.body.data.sheetOrder[0]];
    assert.equal(sheet.cellData['1']['0'].v, 'Sharma, R');
    assert.equal(sheet.cellData['1']['1'].v, 1500.5);
    assert.equal(sheet.cellData['1']['2'].v, '09820012345', 'leading zeros are kept');
    assert.equal(sheet.cellData['2']['0'].v, 'He said "hi"');

    const out = await download(`/onsheet/files/${r.body.uid}/export?format=csv`, adminToken);
    const lines = out.buf.toString('utf8').slice(1).trim().split(/\r\n/);
    assert.equal(lines[0], 'Name,Amount,Phone');
    assert.equal(lines[1], '"Sharma, R",1500.5,09820012345');
    assert.equal(lines[2], '"He said ""hi""",-20,');
  });

  test('rejects a fake xlsx, a binary csv and other extensions', async () => {
    const fake = await upload('/onsheet/import', 'fake.xlsx', Buffer.from('not a zip at all'), adminToken);
    assert.equal(fake.status, 400);
    const bin = await upload('/onsheet/import', 'bin.csv', Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 1, 2]), adminToken);
    assert.equal(bin.status, 400);
    const exe = await upload('/onsheet/import', 'tool.exe', Buffer.from('MZ'), adminToken);
    assert.equal(exe.status, 400);
    const zipNotXlsx = await upload('/onsheet/import', 'broken.xlsx', Buffer.from([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4, 5]), adminToken);
    assert.equal(zipNotXlsx.status, 400);
  });

  test('an import is owned by the person who imported it', async () => {
    const r = await upload('/onsheet/import', 'mine.csv', Buffer.from('a,b\r\n1,2\r\n'), opsToken);
    assert.equal(r.status, 201);
    const mine = await ops('GET', '/onsheet/files?scope=mine');
    assert.ok(mine.body.files.some((f: any) => f.uid === r.body.uid && f.access === 'OWNER'));
  });

  test('bodies over the global 2 MB limit are accepted on OnSheet', async () => {
    const open = await admin('GET', `/onsheet/files/${xlsxUid}`);
    const d = open.body.data;
    const sheet = d.sheets[d.sheetOrder[0]];
    for (let r = 10; r < 50010; r++) sheet.cellData[r] = { 0: { v: 'row number ' + r + ' with some padding text', t: 1 } };
    sheet.rowCount = 51000;
    const body = JSON.stringify({ data: d, baseVersion: open.body.version });
    assert.ok(body.length > 2 * 1024 * 1024, 'payload is over 2 MB');
    const save = await admin('PUT', `/onsheet/files/${xlsxUid}`, { data: d, baseVersion: open.body.version });
    assert.equal(save.status, 200, JSON.stringify(save.body));
  });
});
