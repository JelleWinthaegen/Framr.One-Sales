/*
  Jarvis factuurverwerking - centrale adapterkeuze voor alle CLI's.

  Tot 2026-07-06 koos elke CLI zelf tussen de mock- en de pg-adapter, met een stille terugval
  naar mock bij elke onbekende PIPELINE_DB-waarde. Een typefout (PIPELINE_DB=Pg) leek dan een
  geslaagde run, maar raakte geen database. Deze module is nu de enige plek waar die keuze
  wordt gemaakt, en een onbekende waarde faalt hard.

  Gebruik:
    const { adapter, kind, closeable } = selectAdapter({ env: process.env });
    ...
    if (closeable) await adapter.close();

  De inhoudelijke guards blijven in de adapters zelf: de pg-adapter eist JARVIS_ENV=test plus
  een aparte JARVIS_TEST_DB_URL en weigert de live database.

  Stijl: blokcommentaar, geen lange streepjes en geen emoji, conform de projectafspraken.
*/

import { createMockAdapter } from './mock-db-adapter.mjs?v=5dd6073';
import { createPgAdapter, createPgLiveAdapter, createPgLiveReadAdapter } from './pg-db-adapter.mjs?v=5dd6073';
import { assertKnownEnvValues } from '../config-guard.mjs?v=5dd6073';

/*
  pg-live (de live-schrijfroute, zie supabase/docs/live-write-route.md) is alleen bereikbaar
  voor gereedschap dat de live-bevestiging expliciet doorgeeft via de confirm-parameter
  (de aangesloten CLI's: project, learn, tasks, opruim, dossier, routeer, en sinds het
  een-database-model ook de staging-CLI's mail/run-mail en mail/document-batch-cli, de
  SnelStart-sync in snelstart/snelstart-acties.mjs en de factuurronde zelf: approve, reject en
  billing). Een CLI die confirm niet doorgeeft, weigert pg-live hard, nog voor de grendels van
  de live-adapter.
*/
export function selectAdapter({ env = process.env, confirm } = {}) {
  assertKnownEnvValues(env);
  const kind = env.PIPELINE_DB || 'mock';
  if (kind === 'pg') {
    return { adapter: createPgAdapter({ env }), kind: 'pg', closeable: true };
  }
  /* pg-live-read leest de live database zonder schrijfpad: geen confirm en geen
     JARVIS_LIVE_WRITE nodig, want de adapter weigert elke schrijfmethode. Bedoeld voor
     rapporten en overzichten, die onder het een-database-model het echte brein moeten
     lezen in plaats van een testdatabase. */
  if (kind === 'pg-live-read') {
    return { adapter: createPgLiveReadAdapter({ env }), kind: 'pg-live-read', closeable: true };
  }
  if (kind === 'pg-live') {
    if (confirm === undefined) {
      throw new Error(
        'PIPELINE_DB=pg-live wordt alleen ondersteund door gereedschap dat de live-bevestiging ' +
        'doorgeeft (--confirm NAAR-LIVE op een aangesloten CLI).',
      );
    }
    return { adapter: createPgLiveAdapter({ env, confirm }), kind: 'pg-live', closeable: true };
  }
  /* assertKnownEnvValues garandeert dat alleen mock overblijft. */
  return { adapter: createMockAdapter(), kind: 'mock', closeable: false };
}
