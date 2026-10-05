/*
  Jarvis factuurverwerking - config-guard: vang typefouten in omgevingsvariabelen vroeg af.

  De motor stuurt zijn gedrag met een handvol omgevingsvariabelen. Een typefout daarin mag
  nooit stil het verkeerde gedrag geven. Twee voorbeelden die dit voorkwam:
    - PIPELINE_DB=Pg viel stil terug op mock (de run leek te slagen maar raakte geen database);
    - JARVIS_VISION=true zette vision stil NIET aan (de code kent alleen '1').

  assertKnownEnvValues valideert alleen variabelen die GEZET zijn; het verplicht niets. De
  inhoudelijke guards (JARVIS_ENV=test voor writes, aparte testdatabase, API-sleutels) blijven
  waar ze horen: in de adapters en extractors zelf.

  Stijl: blokcommentaar, geen lange streepjes en geen emoji, conform de projectafspraken.
*/

const TOEGESTAAN = {
  PIPELINE_DB: ['mock', 'pg', 'pg-live', 'pg-live-read'],
  PIPELINE_MODE: ['dry_run', 'staging_write', 'approved_write'],
  MAIL_MODE: ['dry_run', 'staging_write'],
  MAIL_PROVIDER: ['mock', 'gmail', 'real'],
  JARVIS_LLM_EXTRACT: ['0', '1'],
  JARVIS_VISION: ['0', '1'],
};

export function assertKnownEnvValues(env = process.env) {
  const fouten = [];
  for (const [naam, waarden] of Object.entries(TOEGESTAAN)) {
    const waarde = env[naam];
    if (waarde == null || waarde === '') continue;
    if (!waarden.includes(waarde)) {
      fouten.push(`${naam}="${waarde}" is onbekend; toegestaan: ${waarden.join(', ')}`);
    }
  }
  if (fouten.length) {
    throw new Error(
      `Ongeldige omgevingsvariabele(n), de run stopt om stil verkeerd gedrag te voorkomen:\n  ${fouten.join('\n  ')}`,
    );
  }
  return true;
}

/*
  De vergrendelde staging-route naar live (een-database-model, besluit 2026-07-27).

  staging_write mag met PIPELINE_DB=pg-live naar de live database, uitsluitend wanneer alle
  drie de grendels tegelijk aanwezig zijn:
    1. JARVIS_LIVE_WRITE=1 bewust in de shell gezet (staat nooit in npm-scripts);
    2. --confirm NAAR-LIVE per aanroep op de CLI;
    3. --company <slug> opgegeven; de company wordt daarna echt op slug opgezocht
       (geen test-fallback, geen vaste test-company-id op live).
  Ontbreekt er een, dan stopt de run hard met een melding die alle ontbrekende grendels
  tegelijk noemt. De inhoudelijke adapter-grendels (JARVIS_DB_URL gezet en ongelijk aan
  JARVIS_TEST_DB_URL) blijven in de live-schrijfadapter zelf (db/pg-db-adapter.mjs).
*/
export function assertLiveStagingRoute({ env = process.env, confirm, company } = {}) {
  const ontbreekt = [];
  if (env.JARVIS_LIVE_WRITE !== '1') {
    ontbreekt.push('JARVIS_LIVE_WRITE=1 (bewust in de shell zetten, nooit in npm-scripts)');
  }
  if (confirm !== 'NAAR-LIVE') {
    ontbreekt.push('--confirm NAAR-LIVE (de expliciete bevestiging per aanroep)');
  }
  if (!company || typeof company !== 'string') {
    ontbreekt.push('--company <slug> (bijvoorbeeld wbw-projecten; wordt echt op slug opgezocht)');
  }
  if (ontbreekt.length) {
    throw new Error(
      'De staging-route naar live (PIPELINE_DB=pg-live) vereist alle drie de grendels; ' +
      `er ontbreekt:\n  ${ontbreekt.join('\n  ')}`,
    );
  }
  return true;
}
