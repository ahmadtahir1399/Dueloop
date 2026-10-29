import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { claimFindings, piiFindings, reservedDomain, reservedPhone, scriptFindings } from '../src/checks.ts';
import { scanText } from '../src/secrets.ts';

const j = (...p: string[]) => p.join('_');

describe('secret patterns', () => {
  it.each([
    ['stripe-secret-key', j('sk', 'live', 'abcdefghijklmnopqrstuvwx')],
    ['stripe-secret-key', j('rk', 'test', 'abcdefghijklmnopqrstuvwx')],
    ['stripe-webhook-secret', j('whsec', 'abcdefghijklmnopqrstu')],
    ['anthropic-api-key', `sk-ant-${'a'.repeat(24)}`],
    ['openai-api-key', `sk-proj-${'a'.repeat(24)}`],
    ['openai-api-key', `sk-${'a'.repeat(20)}${'T3Blbk'}FJ${'b'.repeat(20)}`],
    ['aws-access-key-id', `AKIA${'Q'.repeat(16)}`],
    ['github-token', `ghp_${'a'.repeat(36)}`],
    ['slack-token', `xoxb-${'1'.repeat(12)}-abc`],
    ['supabase-secret-key', j('sb', 'secret', 'AbCdEfGhIjKlMnOpQrStUv')],
    ['private-key-block', `-----BEGIN ${'RSA PRIVATE'} KEY-----`],
    ['url-with-password', `postgresql://app:${'s3cr3tpass'}@db.example.com:5432/app`],
    ['dueloop-api-key', `dl_abcd1234_${'Z'.repeat(40)}`],
  ])('%s fires', (rule, value) => {
    expect(scanText(`const x = "${value}";`, 'f').map((f) => f.rule)).toContain(rule);
  });

  it('never reports the value, only a fingerprint', () => {
    const v = j('sk', 'live', 'abcdefghijklmnopqrstuvwx');
    const [f] = scanText(v, 'f.ts');
    expect(JSON.stringify(f)).not.toContain(v);
    expect(f?.where).toBe('f.ts:1');
  });

  it('local URLs, env references and placeholders are not secrets', () => {
    for (const s of ['postgresql://postgres:postgres@127.0.0.1:54322/postgres', 'postgres://u:p@localhost/x', 'STRIPE_SECRET_KEY=${STRIPE_SECRET_KEY}', 'sk_live_…'])
      expect(scanText(s, 'f')).toEqual([]);
  });
});

describe('fixture PII', () => {
  it('only reserved domains and fictional phone ranges pass', () => {
    expect(['acme.example', 'x.test', 'a.invalid', 'example.com', 'mail.example.org'].every(reservedDomain)).toBe(true);
    expect(['example.de', 'x.com', 'gmail.com', 'example.co.uk'].some(reservedDomain)).toBe(false);
    expect(['+447700900123', '+442079460958', '+12125550183'].every(reservedPhone)).toBe(true);
    expect([`+1415555${'2671'}`, `+447911${'123456'}`].some(reservedPhone)).toBe(false);
  });
  it('versions and IPs are not email addresses', () => {
    expect(piiFindings('"packageManager": "pnpm@12.15.0", postgres@127.0.0.1, a@b.c', 'f')).toEqual([]);
    expect(piiFindings(`contact real.person@${'gmail'}.com or +44 7911 ${'123456'}`, 'f')).toHaveLength(2);
  });
});

describe('claims audit', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'claims-'));
  writeFileSync(path.join(dir, 'out.txt'), 'measured');
  it('flags guarantees, compliance claims and unsourced numbers; markers and code fences are respected', () => {
    const doc = [
      'Enterprise-grade security.',
      'We are GDPR compliant.',
      'Reminders cut late payment by 40%.',
      'Pages render in under 200 ms. <!-- measured: out.txt -->',
      'Pages render in under 200 ms. <!-- measured: missing.txt -->',
      '<!-- claims-ok: disclaimer -->',
      'This software does not make you GDPR compliant.',
      'Replays are kept for 24 hours.',
      '```',
      'echo 100%',
      '```',
    ].join('\n');
    const f = claimFindings(doc, 'README.md', dir);
    expect(f.map((x) => x.where)).toEqual(['README.md:1', 'README.md:2', 'README.md:3', 'README.md:5']);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('script portability', () => {
  it('flags bash-only constructs and accepts node/pnpm chains', () => {
    expect(scriptFindings('package.json', { ok: 'supabase db reset && node x.ts --a', bad1: 'FOO=1 node x', bad2: 'rm -rf .demo', bad3: "eslint 'src/**'" }).map((f) => f.where)).toEqual([
      'package.json#bad1',
      'package.json#bad2',
      'package.json#bad3',
    ]);
  });
});
