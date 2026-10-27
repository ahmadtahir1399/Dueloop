import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

// Proves the lint rules that guard core purity actually fire.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const eslint = new ESLint({ cwd: repoRoot });

async function ruleIds(code: string, file: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath: path.join(repoRoot, file) });
  return (result?.messages ?? []).map((m) => m.ruleId ?? 'fatal');
}

const coreFile = 'packages/core/src/domain/__fixture__.ts';

describe('core lint rules', () => {
  it('allows luxon and relative imports inside core', async () => {
    const ids = await ruleIds("import { DateTime } from 'luxon';\nimport { x } from '../money.ts';\nexport const y = [DateTime, x];\n", coreFile);
    expect(ids).toEqual([]);
  });

  it.each([
    ["import fs from 'node:fs';\nexport const a = fs;\n", 'no-restricted-imports'],
    ["import { z } from 'zod';\nexport const a = z;\n", 'no-restricted-imports'],
    ["import { a } from '@dueloop/sim';\nexport const b = a;\n", 'no-restricted-imports'],
    ["import { a } from '../../../sim/src/prng.ts';\nexport const b = a;\n", 'dueloop/no-import-outside-core'],
    ['export const a = new Date();\n', 'no-restricted-syntax'],
    ['export const a = Date();\n', 'no-restricted-syntax'],
    ['export const a = Date.now();\n', 'no-restricted-properties'],
    ['export const a = Math.random();\n', 'no-restricted-properties'],
    ["import { DateTime } from 'luxon';\nexport const a = DateTime.now();\n", 'no-restricted-properties'],
    ['export const a = process.env;\n', 'no-restricted-globals'],
  ])('rejects %j', async (code, rule) => {
    expect(await ruleIds(code, coreFile)).toContain(rule);
  });

  it('allows new Date(value) with an explicit argument', async () => {
    expect(await ruleIds("export const a = new Date('2026-01-01T00:00:00Z');\n", coreFile)).toEqual([]);
  });

  it('bans the clock and Math.random in sim logic too', async () => {
    const ids = await ruleIds('export const a = Date.now() + Math.random();\n', 'packages/sim/src/__fixture__.ts');
    expect(ids.filter((id) => id === 'no-restricted-properties')).toHaveLength(2);
  });
});
