// The pause banner on S07 must name the real cause. Live test, 2026-11-06: every imported invoice parked with
// `account_missing` (no sender address yet) and the banner showed only the generic fallback sentence, so the owner
// could not tell what to fix. These are every reason the worker parks with (packages/messaging/src/router.ts
// NoRouteReason minus SKIP_REASONS, packages/worker/src/process.ts park(), packages/worker/src/context.ts).
import { describe, expect, it } from 'vitest';
import { SKIP_REASONS } from '@dueloop/messaging';
import { NOT_RESUMABLE, parkedFixHref, parkedFixPermission, parkedText } from '../lib/parked.ts';

const FALLBACK = parkedText('__no_such_reason__');

const ROUTER_PARKS = ['budget_exhausted', 'template_missing', 'template_unapproved', 'account_missing'] as const;
const WORKER_PARKS = ['public_link_unavailable', 'payment_link_unavailable', 'template_render_failed', 'channel_unsupported', 'message_unknown', 'send_ambiguous', 'awaiting_approval'] as const;
const CONTEXT_PARKS = ['policy_missing', 'policy_invalid', 'settings_invalid', 'invoice_invalid'] as const;

describe('parkedText', () => {
  it('the router reasons listed here are exactly the ones it parks with (not skips)', () => {
    for (const r of ROUTER_PARKS) expect(SKIP_REASONS as readonly string[]).not.toContain(r);
  });

  for (const r of [...ROUTER_PARKS, ...WORKER_PARKS, ...CONTEXT_PARKS]) {
    it(`${r}: has its own sentence, not the fallback`, () => expect(parkedText(r)).not.toBe(FALLBACK));
  }

  it('account_missing says where to fix it: the sender address in Settings, Integrations', () => {
    expect(parkedText('account_missing')).toMatch(/sender/i);
    expect(parkedFixHref('account_missing')).toBe('/settings/integrations');
  });

  it('points each tenant-side cause at the settings page that fixes it', () => {
    expect(parkedFixHref('template_missing')).toBe('/settings/templates');
    expect(parkedFixHref('template_unapproved')).toBe('/settings/templates');
    expect(parkedFixHref('template_render_failed')).toBe('/settings/templates');
    expect(parkedFixHref('budget_exhausted')).toBe('/settings');
    expect(parkedFixHref('policy_missing')).toBe('/settings/policies');
    expect(parkedFixHref('policy_invalid')).toBe('/settings/policies');
  });

  it('reasons owned by another screen get no settings link', () => {
    for (const r of NOT_RESUMABLE) expect(parkedFixHref(r)).toBeNull();
  });

  it('an unknown reason keeps the neutral fallback and no link', () => {
    expect(FALLBACK).toBe('Reminders for this invoice are on hold.');
    expect(parkedFixHref('__no_such_reason__')).toBeNull();
  });

  it('a reason named like an Object prototype key is still unknown', () => {
    expect(parkedText('constructor')).toBe(FALLBACK);
    expect(parkedFixHref('toString')).toBeNull();
  });

  it('the link is shown only to roles that may open that settings page', () => {
    expect(parkedFixPermission('/settings/integrations')).toBe('integrations.view');
    expect(parkedFixPermission('/settings/templates')).toBe('settings.view');
  });
});
