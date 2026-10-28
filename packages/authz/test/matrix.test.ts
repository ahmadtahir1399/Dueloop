import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { can, matrixMarkdown, PERMISSIONS, ROLES } from '../src/index.ts';

const adr = readFileSync(new URL('../../../docs/decisions/0042-role-matrix-web.md', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

describe('role matrix as data', () => {
  it('ADR 0042 contains exactly the matrix the code uses', () => {
    expect(adr).toContain(matrixMarkdown());
  });

  it('every permission id is unique and every role list is a subset of ROLES', () => {
    const ids = PERMISSIONS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of PERMISSIONS) for (const r of p.roles) expect(ROLES).toContain(r);
  });

  it('denies unknown roles and unknown permissions', () => {
    expect(can(null, 'invoices.view')).toBe(false);
    expect(can('admin' as never, 'invoices.view')).toBe(false);
    expect(can('owner', 'nope' as never)).toBe(false);
  });

  it('agrees with the earlier ADRs on the cells they already fixed', () => {
    // ADR 0012: approve/reject/edit owner + accountant; tenant kill switch owner only.
    expect(ROLES.filter((r) => can(r, 'approvals.decide'))).toEqual(['owner', 'accountant']);
    expect(ROLES.filter((r) => can(r, 'killswitch.toggle'))).toEqual(['owner']);
    // ADR 0022: tasks for every member; promise cancel owner + accountant.
    expect(ROLES.filter((r) => can(r, 'tasks.resolve'))).toEqual(['owner', 'accountant', 'collector']);
    expect(ROLES.filter((r) => can(r, 'promises.cancel'))).toEqual(['owner', 'accountant']);
    // ADR 0032: confirming money owner + accountant.
    expect(ROLES.filter((r) => can(r, 'payments.record'))).toEqual(['owner', 'accountant']);
    expect(ROLES.filter((r) => can(r, 'proofs.decide'))).toEqual(['owner', 'accountant']);
    // ADR 0008: import owner + accountant (commit_import_batch denied to collector).
    expect(ROLES.filter((r) => can(r, 'import.run'))).toEqual(['owner', 'accountant']);
  });
});
