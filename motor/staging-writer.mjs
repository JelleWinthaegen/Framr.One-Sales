/*
  Jarvis doc-intake dry-run - staging writer.

  Zet de uitkomsten van de analyse (uit fake data) om naar staging-records en schrijft die
  via een database-adapter naar processing_runs en doc_intake. Uitsluitend in modus
  staging_write en uitsluitend in test-mode.

  Harde grenzen, hier afgedwongen:
    - alleen met JARVIS_ENV=test (assertStagingAllowed);
    - status is uitsluitend 'staging' of 'needs_confirmation', nooit 'approved';
    - approved_at en approved_by blijven altijd leeg;
    - processed_until wordt niet bijgewerkt (before en after blijven leeg);
    - er worden geen learning mappings geschreven.

  Stijl: blokcommentaar, geen lange streepjes en geen emoji, conform de projectafspraken.
*/

import { extractDocumentNumber, extractAmount } from './dedup.mjs?v=5dd6073';
import { createDocumentWriter, categoryForDocumentType } from './storage/document-writer.mjs?v=5dd6073';

/* Vaste fake company-id voor de mock. Voor een echte testdatabase via JARVIS_TEST_COMPANY_ID. */
export const DEFAULT_TEST_COMPANY_ID = '00000000-0000-0000-0000-000000000001';

/*
  Test-modus (default): JARVIS_ENV=test verplicht, ongewijzigd gedrag. Live-modus (de
  vergrendelde staging-route naar live, een-database-model): alleen met JARVIS_LIVE_WRITE=1
  bewust in de shell; de overige grendels (--confirm NAAR-LIVE en --company <slug>) worden
  door de CLI en de live-schrijfadapter afgedwongen voordat deze writer bestaat.
*/
export function assertStagingAllowed(env, { live = false } = {}) {
  if (live) {
    if (env.JARVIS_LIVE_WRITE !== '1') {
      throw new Error(
        'staging_write naar live vereist JARVIS_LIVE_WRITE=1, bewust in de shell gezet ' +
        '(nooit in npm-scripts).',
      );
    }
    return;
  }
  if (env.JARVIS_ENV !== 'test') {
    throw new Error(
      'staging_write vereist JARVIS_ENV=test. Weigert te schrijven buiten test-mode. Er ' +
      'wordt nooit standaard naar de live database geschreven.',
    );
  }
}

/*
  Company-keuze voor de staging writers. In live-modus is een expliciet opgeloste companyId
  verplicht (de CLI zoekt de company echt op slug op); de vaste test-company-id en
  JARVIS_TEST_COMPANY_ID zijn op live betekenisloos en worden daar nooit gebruikt.
*/
export function resolveStagingCompanyId({ companyId, env = process.env, live = false } = {}) {
  if (live) {
    if (!companyId) {
      throw new Error(
        'staging_write naar live vereist een expliciet opgeloste company (via --company <slug>); ' +
        'de vaste test-company-id wordt op live nooit gebruikt.',
      );
    }
    return companyId;
  }
  return companyId || env.JARVIS_TEST_COMPANY_ID || DEFAULT_TEST_COMPANY_ID;
}

function firstAttachmentType(message) {
  const a = (message.attachments || [])[0];
  return a ? a.type : null;
}

function firstAttachmentWithBytes(message) {
  return (message.attachments || []).find((a) => a && a.bytes != null) || null;
}

function buildDedupKey(message) {
  const text = `${message.subject || ''} ${message.snippet || ''}`;
  const parts = [
    extractDocumentNumber(text),
    (message.from || '').toLowerCase() || null,
    extractAmount(text),
  ].filter(Boolean);
  return parts.length ? parts.join('|') : null;
}

/* Bouwt een doc_intake-rij uit een geclassificeerd item. Nooit approved, nooit een echte datum verzonnen. */
function docRowFor(item, { companyId, sourceKey }) {
  const m = item.message;
  const c = item.classification;
  const text = `${m.subject || ''} ${m.snippet || ''}`;
  const status = c.needsConfirmation ? 'needs_confirmation' : 'staging';

  return {
    company_id: companyId,
    run_id: null, /* wordt later met de run-id gevuld */
    source_key: sourceKey,
    source_message_ref: m.sourceMessageRef || null,
    document_type: c.documentType || 'other',
    direction: 'unknown',
    status,
    reviewed_at: null,
    reviewed_by: null,
    review_notes: null,
    approved_at: null,
    approved_by: null,
    counterparty_name_raw: m.from || null,
    document_number_raw: extractDocumentNumber(text),
    document_date: null,
    due_date: null,
    amount_ex_vat: null,
    vat_amount: null,
    amount_inc_vat: extractAmount(text),
    currency: 'EUR',
    legal_entity_id: null,
    project_ref: item.projectRef || null,
    week_number: null,
    bouwonderdeel_code: null,
    kostensoort_code: null,
    attachment_type: firstAttachmentType(m),
    confidence: c.confidence,
    reason: {
      classification: {
        documentType: c.documentType,
        confidence: c.confidence,
        classification: c.classification,
        reasons: c.reasons,
      },
      dedup: item.dedup,
      projectRef: item.projectRef || null,
    },
    dedup_key: buildDedupKey(m),
    notes: null,
  };
}

/*
  Maakt een staging writer. Dwingt test-mode af bij constructie. De adapter levert de
  daadwerkelijke schrijfactie (mock in-memory of pg-testdatabase).
*/
export function createStagingWriter({ adapter, env = process.env, companyId, storageAdapter = null, live = false } = {}) {
  assertStagingAllowed(env, { live });
  if (!adapter) {
    throw new Error('staging_write vereist een database-adapter (mock of pg-test).');
  }
  const cid = resolveStagingCompanyId({ companyId, env, live });
  /* Documentopslag is optioneel: alleen als er een storage-adapter is, worden originelen bewaard. */
  const documentWriter = storageAdapter ? createDocumentWriter({ adapter, storageAdapter, env, live }) : null;

  return {
    async write({ analysis }) {
      const candidates = analysis.items.filter((i) => i.classification.isCandidate);
      const docRows = candidates.map((item) =>
        docRowFor(item, { companyId: cid, sourceKey: analysis.sourceKey }));

      const stagingCount = docRows.filter((r) => r.status === 'staging').length;
      const needsReviewCount = docRows.filter((r) => r.status === 'needs_confirmation').length;

      const runRow = {
        company_id: cid,
        source_key: analysis.sourceKey,
        mode: 'staging_write',
        window_from: analysis.window.from,
        window_until: analysis.window.until,
        processed_until_before: null,
        processed_until_after: null, /* staging_write werkt processed_until niet bij */
        messages_seen: analysis.runSummary.messages_seen,
        candidates_found: analysis.runSummary.candidates_found,
        staging_count: stagingCount,
        needs_review_count: needsReviewCount,
        approved_count: 0,
        rejected_count: 0,
        duplicate_count: analysis.runSummary.duplicate_count,
        ignored_count: analysis.runSummary.ignored_count,
        status: 'completed',
        error_message: null,
        notes: 'staging_write met fake data (testdatabase)',
      };

      const { id: runId } = await adapter.insertProcessingRun(runRow);

      /* Per document de run-id koppelen en, als er bijlage-bytes zijn en opslag is geconfigureerd,
         het origineel bewaren en document_id zetten. Sequentieel voor de pg-Client. candidates en
         docRows delen dezelfde volgorde. */
      const rowsWithRun = [];
      let documentsStored = 0;
      for (let i = 0; i < docRows.length; i += 1) {
        const row = { ...docRows[i], run_id: runId };
        const att = firstAttachmentWithBytes(candidates[i].message);
        if (documentWriter && att) {
          const res = await documentWriter.writeDocument({
            companyId: cid,
            category: categoryForDocumentType(row.document_type),
            filename: att.filename || 'bijlage',
            bytes: att.bytes,
            contentType: att.mimeType || att.type || null,
            sourceSystem: `intake:${analysis.sourceKey}`,
          });
          row.document_id = res.documentId;
          if (!res.deduped) documentsStored += 1;
        }
        rowsWithRun.push(row);
      }
      const inserted = await adapter.insertDocIntake(rowsWithRun);

      return {
        runId,
        docCount: inserted,
        documentsStored,
        statuses: { staging: stagingCount, needs_confirmation: needsReviewCount },
        processedUntilUpdated: false,
        learned: false,
      };
    },
  };
}
