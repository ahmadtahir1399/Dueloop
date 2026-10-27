/** Uploaded files are untrusted (CLAUDE.md rule 14). Checked before any heavy work. */
export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_ROWS = 10_000;
export const MAX_CELL_CHARS = 1_000;
/** How many reference-code candidates each new invoice carries into the commit step. */
export const REFERENCE_CANDIDATES = 5;
