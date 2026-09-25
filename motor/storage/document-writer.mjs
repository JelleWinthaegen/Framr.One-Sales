/*
  Jarvis documentopslag - document-writer.

  Bewaart een origineel (bijlage-bytes) en legt het vast als documents-rij, zodat een latere
  factuur traceerbaar is tot dat origineel. Stappen:
    1. bereken de sha256 van de bytes;
    2. dedup-check tegen documents op (company_id, content_sha256): bestaat hij al, geef dan het
       bestaande document_id terug en bewaar de bytes niet opnieuw;
    3. anders bewaar de bytes via de storage-adapter op een content-geadresseerd pad;
    4. insert een documents-rij met checksum, herkomst en originele bestandsnaam;
    5. geef het document_id terug zodat de doc_intake-rij ernaar kan verwijzen.

  Default test-mode (assertStorageTestEnv); op de vergrendelde staging-route naar live alleen
  met live=true plus JARVIS_LIVE_WRITE=1. Schrijft nooit naar een live bucket.

  Stijl: blokcommentaar, geen lange streepjes en geen emoji, conform de projectafspraken.
*/

import { extname } from 'node:path';
import { sha256Hex } from './hash.mjs?v=5dd6073';
import { assertStorageTestEnv } from './storage-adapter-interface.mjs?v=5dd6073';

/* Financiele documenttypes gaan naar de categorie invoices; de rest naar documents. */
const FINANCIAL_TYPES = new Set([
  'invoice', 'receipt', 'credit_note', 'reminder', 'proforma', 'payment_request',
]);

export function categoryForDocumentType(documentType) {
  return FINANCIAL_TYPES.has(documentType) ? 'invoices' : 'documents';
}

export function createDocumentWriter({ adapter, storageAdapter, env = process.env, live = false } = {}) {
  assertStorageTestEnv(env, { live });
  if (!adapter) throw new Error('document-writer vereist een database-adapter.');
  if (!storageAdapter) throw new Error('document-writer vereist een storage-adapter.');

  return {
    async writeDocument({
      companyId,
      category = 'documents',
      filename = 'bijlage',
      bytes,
      contentType = null,
      sourceSystem = null,
    }) {
      if (bytes == null) throw new Error('document-writer vereist bytes om te bewaren.');
      const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
      const sha = sha256Hex(buf);

      /* Dedup op inhoud binnen het bedrijf: bestaande bytes niet opnieuw bewaren. */
      if (adapter.getDocumentBySha256) {
        const existing = await adapter.getDocumentBySha256(companyId, sha);
        if (existing) {
          return { documentId: existing.id, sha256: sha, storagePath: existing.storage_path, deduped: true };
        }
      }

      const storedName = `${sha}${extname(filename) || ''}`;
      const { storagePath } = await storageAdapter.putObject({
        companyId, category, filename: storedName, bytes: buf, contentType,
      });

      const row = {
        company_id: companyId,
        title: filename,
        storage_path: storagePath,
        mime_type: contentType,
        size_bytes: buf.length,
        source: null,
        source_system: sourceSystem,
        content_sha256: sha,
        original_filename: filename,
        category,
      };
      const { id } = await adapter.insertDocument(row);
      return { documentId: id, sha256: sha, storagePath, deduped: false };
    },
  };
}
