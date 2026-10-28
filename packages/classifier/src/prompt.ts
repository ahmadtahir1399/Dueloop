// Versioned prompts live in packages/classifier/prompts as data files (not inline strings). A new wording is a
// new file and a new version, so recorded outputs and eval baselines stay tied to the prompt that made them.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ClassifierInput } from './input.ts';

export const CURRENT_PROMPT_VERSION = 'reply-v1';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../prompts');

export function loadPrompt(version: string): string {
  if (!/^[a-z0-9-]{1,40}$/.test(version)) throw new Error('bad prompt version');
  return readFileSync(path.join(dir, `${version}.md`), 'utf8');
}

/**
 * Fills the template. The message goes in LAST and its delimiter markers are neutralised, so customer text
 * cannot close the data block and pose as instructions.
 */
export function renderPrompt(template: string, input: ClassifierInput): string {
  const message = input.text.replace(/<<<|>>>/g, '« »');
  return template
    .replaceAll('{{reference_date}}', input.referenceDate)
    .replaceAll('{{weekday}}', input.weekday)
    .replaceAll('{{timezone}}', input.timezone)
    .replaceAll('{{currency}}', input.currency)
    .replaceAll('{{locale_hint}}', input.localeHint)
    .replace('{{message}}', () => message);
}
