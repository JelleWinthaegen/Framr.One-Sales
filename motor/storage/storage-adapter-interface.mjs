/*
  Jarvis documentopslag - gedeeld storage-adapter contract.

  Alle storage-adapters (lokaal of Supabase) delen hetzelfde contract, zodat de pijplijn niet
  weet waar de bytes echt staan (zelfde patroon als de db-adapters):

    putObject({ companyId, category, filename, bytes, contentType }) -> { storagePath }
    getObject(storagePath)                                           -> Buffer | null
    exists(storagePath)                                              -> boolean
    close()                                                          -> void

  Padconventie uit supabase/docs/storage-plan.md: <bedrijf>/<categorie>/<bestand>. In de
  testpijplijn is het bestand content-geadresseerd (<sha256><extensie>), zodat dezelfde inhoud
  altijd hetzelfde pad krijgt.

  Stijl: blokcommentaar, geen lange streepjes en geen emoji, conform de projectafspraken.
*/

/* Bouwt het bucket-interne pad. Strip leidende of sluitende slashes per segment. */
export function buildObjectPath({ companyId, category, filename }) {
  const parts = [companyId, category, filename]
    .map((p) => String(p == null ? '' : p).replace(/^\/+|\/+$/g, ''))
    .filter((p) => p.length);
  return parts.join('/');
}

/*
  Harde guard: opslag mag alleen in test-mode. Geldt voor zowel de lokale als de Supabase
  adapter. De Supabase-adapter heeft daarbovenop nog eigen test-only checks (aparte test-URL,
  test service-role key, nooit gelijk aan een live var).

  Uitzondering (een-database-model): op de vergrendelde staging-route naar live mag de lokale
  opslag gebruikt worden zonder JARVIS_ENV=test, maar uitsluitend wanneer de aanroeper live=true
  doorgeeft EN JARVIS_LIVE_WRITE=1 bewust in de shell staat. De CLI heeft dan al de volledige
  drie grendels (vlag, --confirm NAAR-LIVE, --company) afgedwongen.
*/
export function assertStorageTestEnv(env, { live = false } = {}) {
  if (live) {
    if (env.JARVIS_LIVE_WRITE !== '1') {
      throw new Error(
        'De storage-adapter op de live staging-route vereist JARVIS_LIVE_WRITE=1, bewust in ' +
        'de shell gezet (nooit in npm-scripts).',
      );
    }
    return;
  }
  if (env.JARVIS_ENV !== 'test') {
    throw new Error(
      'De storage-adapter vereist JARVIS_ENV=test. Er wordt nooit buiten test-mode opgeslagen.',
    );
  }
}
