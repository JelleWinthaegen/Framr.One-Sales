/*
  Jarvis documentopslag - checksum.

  Berekent de sha256 (hex) van bytes. Wordt gebruikt voor documentdeduplicatie (gelijke inhoud,
  gelijke hash) en voor de trace-verificatie (herberekenen en vergelijken met de opgeslagen
  content_sha256). Dependency-vrij via node:crypto.

  Stijl: blokcommentaar, geen lange streepjes en geen emoji, conform de projectafspraken.
*/

import { createHash } from 'node:crypto';

export function sha256Hex(bytes) {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  return createHash('sha256').update(buf).digest('hex');
}
