// Proof files live in the PRIVATE bucket `payment-proofs` at <tenant id>/<proof id> (migration 0012 policies:
// reads tenant-folder scoped, no client writes). Only trusted server code uploads, with the service-role client
// (never shipped to a browser, never logged, rule 12). Viewing is by time-limited signed URL (Supabase Storage
// docs, "Serving downloads": createSignedUrl).
import { createClient } from '@supabase/supabase-js';

export const PROOF_BUCKET = 'payment-proofs';

export interface ProofStore {
  /** Idempotent for the same path and bytes (the proof id is derived from message + attachment). */
  put(path: string, bytes: Buffer, mime: string): Promise<void>;
  signedUrl(path: string, expiresInSeconds: number): Promise<string>;
  /** Prompt 7 (retention, erasure): deletes stored files. Missing files are not an error. */
  remove?(paths: readonly string[]): Promise<void>;
}

export function supabaseProofStore(url: string, serviceRoleKey: string): ProofStore {
  const client = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const bucket = client.storage.from(PROOF_BUCKET);
  return {
    async put(path, bytes, mime) {
      const { error } = await bucket.upload(path, bytes, { contentType: mime, upsert: true });
      if (error) throw new Error('proof_upload_failed'); // never the storage message (it can carry the path/URL)
    },
    async signedUrl(path, expiresInSeconds) {
      const { data, error } = await bucket.createSignedUrl(path, expiresInSeconds);
      if (error || !data?.signedUrl) throw new Error('proof_sign_failed');
      return data.signedUrl;
    },
    async remove(paths) {
      for (let i = 0; i < paths.length; i += 100) {
        const { error } = await bucket.remove([...paths.slice(i, i + 100)]);
        if (error) throw new Error('proof_remove_failed');
      }
    },
  };
}

/** Tests and the demo without Storage: bytes kept in memory. */
export class MemoryProofStore implements ProofStore {
  readonly files = new Map<string, { bytes: Buffer; mime: string }>();
  async put(path: string, bytes: Buffer, mime: string): Promise<void> {
    this.files.set(path, { bytes, mime });
  }
  async signedUrl(path: string, expiresInSeconds: number): Promise<string> {
    if (!this.files.has(path)) throw new Error('proof_sign_failed');
    return `https://storage.invalid/${path}?expires=${expiresInSeconds}`;
  }
  async remove(paths: readonly string[]): Promise<void> {
    for (const p of paths) this.files.delete(p);
  }
}
