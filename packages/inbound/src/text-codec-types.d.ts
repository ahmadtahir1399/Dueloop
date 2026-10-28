// Type-only shim: postal-mime's declarations use TextEncoder/TextDecoder as DOM interface types. Node has the
// same classes (node:util, and as globals) but @types/node exposes them globally only as values. Declaring
// the interfaces here avoids adding the whole DOM lib (which would let DOM globals into server code) and
// keeps skipLibCheck off.
import type { TextDecoder as NodeTextDecoder, TextEncoder as NodeTextEncoder } from 'node:util';

declare global {
  // Declaration merging is the point of this file: give the existing global values their interface types.
  /* eslint-disable @typescript-eslint/no-empty-object-type */
  interface TextEncoder extends NodeTextEncoder {}
  interface TextDecoder extends NodeTextDecoder {}
  /* eslint-enable @typescript-eslint/no-empty-object-type */
}
export {};
