/*
  Jarvis doc-intake dry-run - echte database-adapter (Postgres).

  Twee publieke factories delen dezelfde schrijflaag:

  createPgAdapter (test, de default overal): schrijft naar en leest uit een
  Postgres-testdatabase. Harde guards zodat dit nooit per ongeluk naar de live database
  schrijft:
    - JARVIS_ENV moet 'test' zijn;
    - JARVIS_TEST_DB_URL moet gezet zijn (een aparte, wegwerp-/testdatabase);
    - JARVIS_TEST_DB_URL mag niet gelijk zijn aan JARVIS_DB_URL (de live verbinding).

  createPgLiveAdapter (go-live stap 2): dezelfde schrijflaag, maar naar de LIVE database,
  uitsluitend met een dubbele vergrendeling (envvlag plus bevestiging per aanroep). Zie de
  guards bij de factory zelf en supabase/docs/live-write-route.md.

  Naast staging_write (insertProcessingRun, insertDocIntake) ondersteunt deze adapter ook de
  review- en approved_write-laag: doc_intake lezen en bijwerken, en invoices, invoice_lines en
  invoice_tax_lines schrijven. Alles binnen dezelfde testdatabase-guards.

  De pg-driver wordt lazy geimporteerd, zodat de tests (die de mock-adapter gebruiken) geen pg
  nodig hebben. Connectiestrings worden nooit geprint.

  Stijl: blokcommentaar, geen lange streepjes en geen emoji, conform de projectafspraken.
*/

/* Welke kolommen jsonb zijn en dus als string moeten worden doorgegeven, per tabel. */
const JSONB_COLUMNS = {
  doc_intake: ['reason'],
  invoices: ['extracted_json'],
  invoice_lines: ['raw_json'],
  invoice_tax_lines: ['raw_json'],
  task_playbooks: ['steps', 'keywords'],
  sales_queue: ['redenen'],
  lead_research: ['scores'],
  interactions: ['bijlage_refs', 'ai_analyse'],
  sales_opvolgreeksen: ['stappen'],
  sales_gebruikers: ['voorkeuren'],
  sales_werkwijzen: ['inhoud'],
  sales_verbeterbesluiten: ['gegevens'],
};

function prepareRow(table, row) {
  const jsonbCols = JSONB_COLUMNS[table] || [];
  const out = { ...row };
  for (const col of jsonbCols) {
    if (col in out) out[col] = JSON.stringify(out[col] ?? {});
  }
  return out;
}

export function createPgAdapter({ env = process.env } = {}) {
  if (env.JARVIS_ENV !== 'test') {
    throw new Error(
      'De pg test-adapter vereist JARVIS_ENV=test. Er wordt nooit standaard naar een ' +
      'niet-test omgeving geschreven.',
    );
  }
  const url = env.JARVIS_TEST_DB_URL;
  if (!url) {
    throw new Error(
      'Geen testdatabase geconfigureerd. Zet JARVIS_TEST_DB_URL naar een wegwerp- of ' +
      'testdatabase. staging_write schrijft nooit naar de live database (JARVIS_DB_URL).',
    );
  }
  if (env.JARVIS_DB_URL && url === env.JARVIS_DB_URL) {
    throw new Error(
      'JARVIS_TEST_DB_URL mag niet gelijk zijn aan JARVIS_DB_URL. Gebruik een aparte ' +
      'testdatabase, nooit de live database.',
    );
  }
  return buildPgAdapter({ url, name: 'pg-test', testHelpers: true });
}

/*
  Live-schrijfadapter (go-live stap 2): dezelfde schrijflaag als de test-adapter, maar naar de
  LIVE database. Vier grendels, allemaal verplicht, anders weigert de factory en wordt er niets
  verbonden of geschreven:
    1. confirm moet exact 'NAAR-LIVE' zijn (komt per aanroep uit --confirm op de CLI);
    2. JARVIS_LIVE_WRITE=1 moet bewust in de shell gezet zijn (staat nooit in npm-scripts);
    3. JARVIS_DB_URL (de live database) moet gezet zijn;
    4. JARVIS_DB_URL mag niet gelijk zijn aan JARVIS_TEST_DB_URL (spiegel van assertLiveEnv in
       live-apply: nooit een testdatabase als live behandelen).
  De live-adapter krijgt bewust geen ensureTestCompany: fictieve testbedrijven horen nooit op
  de live database.
*/
export function createPgLiveAdapter({ env = process.env, confirm = null } = {}) {
  if (confirm !== 'NAAR-LIVE') {
    throw new Error(
      'De live-schrijfadapter vereist een expliciete bevestiging per aanroep: --confirm NAAR-LIVE.',
    );
  }
  if (env.JARVIS_LIVE_WRITE !== '1') {
    throw new Error(
      'De live-schrijfadapter vereist JARVIS_LIVE_WRITE=1, bewust in de shell gezet ' +
      '(nooit in npm-scripts).',
    );
  }
  const url = env.JARVIS_DB_URL;
  if (!url) {
    throw new Error('JARVIS_DB_URL (de live database) is niet gezet.');
  }
  if (env.JARVIS_TEST_DB_URL && url === env.JARVIS_TEST_DB_URL) {
    throw new Error(
      'JARVIS_DB_URL is gelijk aan JARVIS_TEST_DB_URL. De live-schrijfadapter weigert een ' +
      'testdatabase als live te behandelen.',
    );
  }
  return buildPgAdapter({ url, name: 'pg-live', testHelpers: false });
}

/*
  De read-only live-route (pg-live-read, 2026-08-24, besluit een-database-model).

  Rapporten en overzichten moeten het echte brein lezen, niet een testdatabase. Dat was een
  praktijkprobleem: een leesronde met PIPELINE_DB=pg toonde de testdatabase en dus een compleet
  andere, verkeerde lijst, die er wel echt uitzag. Onder het een-database-model is LIVE de ene
  database, ook om te lezen.

  Deze adapter leest live zonder dat er een schrijfpad opengaat. Geen --confirm en geen
  JARVIS_LIVE_WRITE, want er wordt niets geschreven. De read-only garantie is een harde grendel op
  de methodenaam: alleen lezende namen komen door, al de rest gooit. Dat is bewust een whitelist en
  geen zwarte lijst, zodat een nieuwe schrijfmethode nooit stilzwijgend doorglipt.
*/
const LEZENDE_PREFIXEN = ['fetch', 'find', 'get', 'count', 'load', 'list', 'query'];

export function createPgLiveReadAdapter({ env = process.env } = {}) {
  const url = env.JARVIS_DB_URL;
  if (!url) {
    throw new Error('JARVIS_DB_URL (de live database) is niet gezet.');
  }
  if (env.JARVIS_TEST_DB_URL && url === env.JARVIS_TEST_DB_URL) {
    throw new Error(
      'JARVIS_DB_URL is gelijk aan JARVIS_TEST_DB_URL. De live-leesadapter weigert een '
      + 'testdatabase als live te behandelen.',
    );
  }
  const echt = buildPgAdapter({ url, name: 'pg-live-read', testHelpers: false });
  return new Proxy(echt, {
    get(target, prop) {
      if (typeof prop !== 'string') return target[prop];
      const waarde = target[prop];
      if (typeof waarde !== 'function') return waarde;
      if (prop === 'close' || LEZENDE_PREFIXEN.some((v) => prop.startsWith(v))) return waarde;
      return () => {
        throw new Error(
          `pg-live-read is read-only: '${prop}' schrijft en wordt geweigerd. Gebruik de `
          + 'vergrendelde schrijfroute (pg-live met JARVIS_LIVE_WRITE=1 en --confirm NAAR-LIVE).',
        );
      };
    },
  });
}

function buildPgAdapter({ url, name, testHelpers }) {
  let client = null;

  async function connect() {
    if (client) return client;
    let pg;
    try {
      pg = (await import('pg')).default;
    } catch {
      throw new Error(
        "De 'pg' driver is niet geinstalleerd. Voer 'npm install' uit in " +
        'scripts/doc-intake-dry-run voor de echte testdatabase-adapter, of gebruik ' +
        'PIPELINE_DB=mock voor een DB-loze proef.',
      );
    }
    const isLocal = /(@|\/\/)(localhost|127\.0\.0\.1)/.test(url);
    /* keepAlive en timeouts: een stilgevallen pooler-verbinding mag een lange run niet
       eeuwig laten hangen (les van de eerste SnelStart-sync, 2026-07-09). */
    client = new pg.Client({
      connectionString: url, ssl: isLocal ? false : { rejectUnauthorized: false },
      keepAlive: true, connectionTimeoutMillis: 30000, query_timeout: 120000,
    });
    await client.connect();
    return client;
  }

  function insertSql(table, row) {
    const cols = Object.keys(row);
    const placeholders = cols.map((_, i) => `$${i + 1}`);
    const values = cols.map((k) => row[k]);
    return { text: `insert into ${table} (${cols.join(', ')}) values (${placeholders.join(', ')})`, values, cols };
  }

  async function insertRow(table, row) {
    const c = await connect();
    const { text, values } = insertSql(table, prepareRow(table, row));
    const res = await c.query(`${text} returning id`, values);
    return { id: res.rows[0].id };
  }

  async function insertRows(table, rows) {
    if (!rows.length) return 0;
    const c = await connect();
    for (const row of rows) {
      const { text, values } = insertSql(table, prepareRow(table, row));
      await c.query(text, values);
    }
    return rows.length;
  }

  /* Generieke update op id. table komt alleen uit vaste interne aanroepen, nooit uit invoer. */
  async function updateById(table, id, patch) {
    const c = await connect();
    const prepared = prepareRow(table, patch);
    const cols = Object.keys(prepared);
    if (!cols.length) {
      const res = await c.query(`select * from ${table} where id = $1`, [id]);
      return res.rows[0] || null;
    }
    const sets = cols.map((col, i) => `${col} = $${i + 1}`);
    const values = cols.map((col) => prepared[col]);
    values.push(id);
    const res = await c.query(
      `update ${table} set ${sets.join(', ')} where id = $${cols.length + 1} returning *`,
      values,
    );
    return res.rows[0] || null;
  }

  /*
    Alle queries van deze adapter lopen over dezelfde verbinding, dus een begin/commit om een
    blok aanroepen maakt dat blok atomair. Nesten wordt geweigerd: de aanroepende laag hoort
    een transactie te openen, niet twee door elkaar.
  */
  let inTransaction = false;

  async function withTransaction(fn) {
    if (inTransaction) {
      throw new Error('geneste transactie wordt niet ondersteund; er loopt al een transactie op deze adapter');
    }
    const c = await connect();
    inTransaction = true;
    await c.query('begin');
    try {
      const result = await fn();
      await c.query('commit');
      return result;
    } catch (err) {
      /* De rollback-fout mag de oorspronkelijke fout nooit maskeren. */
      try { await c.query('rollback'); } catch { /* verbinding kan al weg zijn */ }
      throw err;
    } finally {
      inTransaction = false;
    }
  }

  const adapter = {
    name,

    withTransaction,

    /*
      Zorgt dat er een fictieve test-company met de gegeven id bestaat, zodat de company_id
      foreign keys kloppen op een verse wegwerp-testdatabase. Alleen fictieve data. Doet niets
      als de rij al bestaat. Uitsluitend bedoeld voor de testdatabase-smoke, nooit productie.
    */
    async ensureTestCompany(companyId) {
      const c = await connect();
      const slug = `test-${String(companyId).slice(0, 8)}`;
      await c.query(
        `insert into companies (id, slug, name, kind, status)
         values ($1, $2, $3, 'company', 'active')
         on conflict (id) do nothing`,
        [companyId, slug, 'Testbedrijf (fictief)'],
      );
    },

    async insertProcessingRun(row) {
      return insertRow('processing_runs', row);
    },
    async insertDocIntake(rows) {
      return insertRows('doc_intake', rows);
    },

    async fetchProcessingRuns() {
      const c = await connect();
      const res = await c.query('select * from processing_runs');
      return res.rows;
    },
    async fetchDocIntake() {
      const c = await connect();
      const res = await c.query('select * from doc_intake');
      return res.rows;
    },
    async getDocIntakeById(id) {
      const c = await connect();
      const res = await c.query('select * from doc_intake where id = $1', [id]);
      return res.rows[0] || null;
    },
    /*
      Verwijdert dubbele intake-rijen op id, in blokken. De aanroeper heeft de vijf
      voorwaarden al getoetst in review/intake-opruim.mjs; het tweede slot zit hier in de
      query zelf: er gaat nooit een rij weg die geen status duplicate draagt, ook niet als er
      per ongeluk een verkeerd id wordt meegegeven. Retourneert de werkelijk verwijderde ids.
    */
    async deleteDocIntakeByIds(ids = []) {
      if (!ids.length) return { verwijderd: 0, ids: [] };
      const c = await connect();
      const verwijderd = [];
      for (let i = 0; i < ids.length; i += 1000) {
        const blok = ids.slice(i, i + 1000);
        const res = await c.query(
          "delete from doc_intake where id = any($1::uuid[]) and status = 'duplicate' returning id",
          [blok],
        );
        for (const r of res.rows) verwijderd.push(r.id);
      }
      return { verwijderd: verwijderd.length, ids: verwijderd };
    },
    async updateDocIntake(id, patch) {
      const c = await connect();
      const prepared = prepareRow('doc_intake', patch);
      const cols = Object.keys(prepared);
      if (!cols.length) return this.getDocIntakeById(id);
      const sets = cols.map((col, i) => `${col} = $${i + 1}`);
      const values = cols.map((col) => prepared[col]);
      values.push(id);
      const res = await c.query(
        `update doc_intake set ${sets.join(', ')} where id = $${cols.length + 1} returning *`,
        values,
      );
      return res.rows[0] || null;
    },

    /* Documentopslag: metadata in documents, bytes in Storage (via de storage-adapter). */
    async insertDocument(row) {
      return insertRow('documents', row);
    },
    async getDocumentBySha256(companyId, sha) {
      if (sha == null) return null;
      const c = await connect();
      const res = await c.query(
        'select * from documents where company_id = $1 and content_sha256 = $2 limit 1',
        [companyId, sha],
      );
      return res.rows[0] || null;
    },
    async getDocumentById(id) {
      const c = await connect();
      const res = await c.query('select * from documents where id = $1', [id]);
      return res.rows[0] || null;
    },
    async fetchDocuments() {
      const c = await connect();
      const res = await c.query('select * from documents');
      return res.rows;
    },
    async updateDocument(id, patch) {
      return updateById('documents', id, patch);
    },

    async insertInvoice(row) {
      return insertRow('invoices', row);
    },
    async updateInvoice(id, patch) {
      const c = await connect();
      const prepared = prepareRow('invoices', patch);
      const cols = Object.keys(prepared);
      if (!cols.length) {
        const res = await c.query('select * from invoices where id = $1', [id]);
        return res.rows[0] || null;
      }
      const sets = cols.map((col, i) => `${col} = $${i + 1}`);
      const values = cols.map((col) => prepared[col]);
      values.push(id);
      const res = await c.query(
        `update invoices set ${sets.join(', ')} where id = $${cols.length + 1} returning *`,
        values,
      );
      return res.rows[0] || null;
    },
    async insertInvoiceLines(rows) {
      return insertRows('invoice_lines', rows);
    },
    async updateInvoiceLine(id, patch) {
      const c = await connect();
      const prepared = prepareRow('invoice_lines', patch);
      const cols = Object.keys(prepared);
      if (!cols.length) {
        const res = await c.query('select * from invoice_lines where id = $1', [id]);
        return res.rows[0] || null;
      }
      const sets = cols.map((col, i) => `${col} = $${i + 1}`);
      const values = cols.map((col) => prepared[col]);
      values.push(id);
      const res = await c.query(
        `update invoice_lines set ${sets.join(', ')} where id = $${cols.length + 1} returning *`,
        values,
      );
      return res.rows[0] || null;
    },
    async insertInvoiceTaxLines(rows) {
      return insertRows('invoice_tax_lines', rows);
    },
    async fetchInvoices() {
      const c = await connect();
      const res = await c.query('select * from invoices');
      return res.rows;
    },
    async fetchInvoiceLines() {
      const c = await connect();
      const res = await c.query('select * from invoice_lines');
      return res.rows;
    },
    async fetchInvoiceTaxLines() {
      const c = await connect();
      const res = await c.query('select * from invoice_tax_lines');
      return res.rows;
    },

    /*
      Learning: insert-or-bump op de unieke sleutel. Bij een conflict hoogt evidence_count op en
      wordt last_seen_at bijgewerkt; geen duplicaat. (xmax = 0) geeft aan of het een insert was.
    */
    async recordLearningMapping(row) {
      const c = await connect();
      const cols = [
        'company_id', 'source_system', 'mapping_type', 'input_value', 'normalized_input_value',
        'corrected_value', 'confidence', 'status', 'evidence_count', 'last_seen_at',
        'created_from_doc_intake_id', 'created_from_invoice_id', 'created_by',
      ];
      const values = cols.map((k) => row[k] ?? null);
      const placeholders = cols.map((_, i) => `$${i + 1}`);
      const sql = `insert into learning_mappings (${cols.join(', ')}) values (${placeholders.join(', ')})
        on conflict (company_id, mapping_type, normalized_input_value, corrected_value)
        do update set evidence_count = learning_mappings.evidence_count + 1,
          last_seen_at = excluded.last_seen_at, updated_at = now()
        returning id, evidence_count, (xmax = 0) as inserted`;
      const res = await c.query(sql, values);
      const r = res.rows[0];
      return { id: r.id, created: r.inserted, evidenceCount: r.evidence_count };
    },
    async fetchLearningMappings() {
      const c = await connect();
      const res = await c.query('select * from learning_mappings');
      return res.rows;
    },
    async findLearningMappings({ companyId, mappingType, normalizedInputValue } = {}) {
      const c = await connect();
      const res = await c.query(
        `select * from learning_mappings
         where company_id = $1 and status = 'active'
           and ($2::text is null or mapping_type = $2)
           and ($3::text is null or normalized_input_value = $3)`,
        [companyId, mappingType ?? null, normalizedInputValue ?? null],
      );
      return res.rows;
    },

    /*
      De rondegrens hoort bij een ronde. Migration 0047 verbreedde de unieke sleutel naar
      (company_id, process_key, source_key), want dezelfde bron kan in meer dan een ronde
      voorkomen; op live staat mail-administratie er bijvoorbeeld twee keer in, een keer voor
      de factuurronde en een keer voor de leesronde. De adapter ging daar tot 31-08-2026 niet
      in mee: lezen pakte zomaar een van de twee rijen, en schrijven verwees met on conflict
      naar een unieke sleutel die niet bestaat, waardoor elke schrijfpoging op live faalde.
      Beide kanten dragen nu de process_key; de default is de waarde uit 0047.
    */
    async getProcessingState(companyId, sourceKey, processKey = 'factuurronde') {
      const c = await connect();
      const res = await c.query(
        'select * from processing_state where company_id = $1 and source_key = $2 and process_key = $3',
        [companyId, sourceKey, processKey],
      );
      return res.rows[0] || null;
    },
    async upsertProcessedUntil({
      companyId, sourceKey, sourceType = 'other', processKey = 'factuurronde',
      processedUntil, ref = null, ids = null, lastChecked,
    } = {}) {
      const c = await connect();
      /* ids zijn de items die exact op de grens liggen (migration 0086). Zonder die lijst
         verdwijnt een tweede item met hetzelfde tijdstip bij de volgende ronde stil onder
         de cutoff. */
      const sql = `insert into processing_state
          (company_id, source_key, source_type, process_key, processed_until_datetime,
           processed_until_ref, processed_until_ids, last_checked_datetime)
        values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
        on conflict (company_id, process_key, source_key)
        do update set processed_until_datetime = excluded.processed_until_datetime,
          processed_until_ref = excluded.processed_until_ref,
          processed_until_ids = excluded.processed_until_ids,
          last_checked_datetime = excluded.last_checked_datetime, updated_at = now()
        returning *`;
      const res = await c.query(sql, [
        companyId, sourceKey, sourceType, processKey, processedUntil, ref,
        ids == null ? null : JSON.stringify(ids),
        lastChecked || new Date().toISOString(),
      ]);
      return res.rows[0];
    },
    /* De uitknop van de routines (migration 0087). Lezen mag altijd; de leesadapter laat
       getRoutineSwitch en fetchRoutineSwitches door en weigert upsertRoutineSwitch, want die
       naam begint niet met een lezend voorvoegsel. */
    async getRoutineSwitch(naam) {
      const c = await connect();
      const res = await c.query('select * from routine_switches where name = $1', [naam]);
      return res.rows[0] || null;
    },
    async fetchRoutineSwitches() {
      const c = await connect();
      const res = await c.query('select * from routine_switches order by name');
      return res.rows;
    },
    async upsertRoutineSwitch({ naam, aan, reden = null, door = null } = {}) {
      const c = await connect();
      const res = await c.query(
        `insert into routine_switches (name, enabled, reason, updated_by)
         values ($1, $2, $3, $4)
         on conflict (name)
         do update set enabled = excluded.enabled, reason = excluded.reason,
           updated_by = excluded.updated_by, updated_at = now()
         returning *`,
        [naam, aan, reden, door],
      );
      return res.rows[0];
    },
    async fetchProcessingState() {
      const c = await connect();
      const res = await c.query('select * from processing_state');
      return res.rows;
    },

    /* Projecten en aliassen (Fase B). Identiteit op canonical_key, aliassen op normalized_alias. */
    async insertProject(row) {
      return insertRow('projects', row);
    },
    async fetchProjects() {
      const c = await connect();
      const res = await c.query('select * from projects');
      return res.rows;
    },
    async getProjectById(id) {
      const c = await connect();
      const res = await c.query('select * from projects where id = $1', [id]);
      return res.rows[0] || null;
    },
    /*
      Hangt alles wat aan een project hangt om naar een ander project (samenvoegen van een
      dubbeling). De tabellen staan expliciet in PROJECT_REFERENCE_TABLES zodat een nieuwe tabel
      met project_id bewust wordt toegevoegd en niet stilzwijgend wordt vergeten. Retourneert per
      tabel hoeveel rijen zijn omgehangen.
    */
    async reassignProjectReferences(fromId, toId, tables) {
      const c = await connect();
      const verplaatst = {};
      for (const table of tables) {
        const res = await c.query(
          `update ${table} set project_id = $1 where project_id = $2`,
          [toId, fromId],
        );
        verplaatst[table] = res.rowCount || 0;
      }
      return verplaatst;
    },
    async updateProject(id, patch) {
      const c = await connect();
      const cols = Object.keys(patch);
      if (!cols.length) {
        const res = await c.query('select * from projects where id = $1', [id]);
        return res.rows[0] || null;
      }
      const sets = cols.map((col, i) => `${col} = $${i + 1}`);
      const values = cols.map((col) => patch[col]);
      values.push(id);
      const res = await c.query(
        `update projects set ${sets.join(', ')} where id = $${cols.length + 1} returning *`,
        values,
      );
      return res.rows[0] || null;
    },
    async findProjectByCanonicalKey(companyId, key) {
      if (key == null || key === '') return null;
      const c = await connect();
      const res = await c.query(
        'select * from projects where company_id = $1 and canonical_key = $2 limit 1',
        [companyId, key],
      );
      return res.rows[0] || null;
    },
    async insertProjectAlias(row) {
      return insertRow('project_aliases', row);
    },
    async findProjectByAlias(companyId, normalizedAlias) {
      if (!normalizedAlias) return null;
      const c = await connect();
      const res = await c.query(
        `select p.* from projects p
         join project_aliases a on a.project_id = p.id
         where a.company_id = $1 and a.normalized_alias = $2 limit 1`,
        [companyId, normalizedAlias],
      );
      return res.rows[0] || null;
    },
    async fetchProjectAliases() {
      const c = await connect();
      const res = await c.query('select * from project_aliases');
      return res.rows;
    },
    async deleteProjectAlias(companyId, normalizedAlias) {
      const c = await connect();
      const res = await c.query(
        'delete from project_aliases where company_id = $1 and normalized_alias = $2',
        [companyId, normalizedAlias],
      );
      return { deleted: res.rowCount };
    },

    /* Uren en personeel (Fase D). */
    async insertWorker(row) {
      return insertRow('workers', row);
    },
    async fetchWorkers() {
      const c = await connect();
      const res = await c.query('select * from workers');
      return res.rows;
    },
    async getWorkerById(id) {
      const c = await connect();
      const res = await c.query('select * from workers where id = $1', [id]);
      return res.rows[0] || null;
    },
    async updateWorker(id, patch) {
      return updateById('workers', id, patch);
    },
    async findWorkerByNormalizedName(companyId, normalizedName) {
      if (!normalizedName) return null;
      const c = await connect();
      const res = await c.query(
        'select * from workers where company_id = $1 and normalized_name = $2 limit 1',
        [companyId, normalizedName],
      );
      return res.rows[0] || null;
    },
    async insertWorkerAlias(row) {
      return insertRow('worker_aliases', row);
    },
    async findWorkerByAlias(companyId, normalizedAlias) {
      if (!normalizedAlias) return null;
      const c = await connect();
      const res = await c.query(
        `select w.* from workers w
         join worker_aliases a on a.worker_id = w.id
         where a.company_id = $1 and a.normalized_alias = $2 limit 1`,
        [companyId, normalizedAlias],
      );
      return res.rows[0] || null;
    },
    async fetchWorkerAliases() {
      const c = await connect();
      const res = await c.query('select * from worker_aliases');
      return res.rows;
    },
    async insertDayEntry(row) {
      return insertRow('day_entries', row);
    },
    async findDayEntry(companyId, workerId, entryDate) {
      const c = await connect();
      const res = await c.query(
        'select * from day_entries where company_id = $1 and worker_id = $2 and entry_date = $3 limit 1',
        [companyId, workerId, entryDate],
      );
      return res.rows[0] || null;
    },
    async updateDayEntry(id, patch) {
      return updateById('day_entries', id, patch);
    },
    async fetchDayEntries() {
      const c = await connect();
      const res = await c.query('select * from day_entries');
      return res.rows;
    },
    async insertWorkAllocation(row) {
      return insertRow('work_allocations', row);
    },
    async fetchWorkAllocations() {
      const c = await connect();
      const res = await c.query('select * from work_allocations');
      return res.rows;
    },
    async insertHoliday(row) {
      return insertRow('holidays', row);
    },
    async fetchHolidays() {
      const c = await connect();
      const res = await c.query('select * from holidays');
      return res.rows;
    },
    async findHoliday(companyId, holidayDate) {
      const c = await connect();
      const res = await c.query(
        'select * from holidays where company_id = $1 and holiday_date = $2 limit 1',
        [companyId, holidayDate],
      );
      return res.rows[0] || null;
    },

    /* Planninglaag en vaardigheden (migration 0033). */
    async insertPlanningEntry(row) {
      return insertRow('planning_entries', row);
    },
    async findPlanningEntryByKey(companyId, workerId, planDate, slot) {
      const c = await connect();
      const res = await c.query(
        'select * from planning_entries where company_id = $1 and worker_id = $2 and plan_date = $3 and slot = $4 limit 1',
        [companyId, workerId, planDate, slot],
      );
      return res.rows[0] || null;
    },
    async fetchPlanningEntriesForDay(companyId, workerId, planDate) {
      const c = await connect();
      const res = await c.query(
        'select * from planning_entries where company_id = $1 and worker_id = $2 and plan_date = $3',
        [companyId, workerId, planDate],
      );
      return res.rows;
    },
    async updatePlanningEntry(id, patch) {
      return updateById('planning_entries', id, patch);
    },
    async fetchPlanningEntries() {
      const c = await connect();
      const res = await c.query('select * from planning_entries');
      return res.rows;
    },
    async insertWorkerSkill(row) {
      return insertRow('worker_skills', row);
    },
    async findWorkerSkillByKey(companyId, workerId, normalizedSkill) {
      const c = await connect();
      const res = await c.query(
        'select * from worker_skills where company_id = $1 and worker_id = $2 and normalized_skill = $3 limit 1',
        [companyId, workerId, normalizedSkill],
      );
      return res.rows[0] || null;
    },
    async updateWorkerSkill(id, patch) {
      return updateById('worker_skills', id, patch);
    },
    async fetchWorkerSkills() {
      const c = await connect();
      const res = await c.query('select * from worker_skills');
      return res.rows;
    },

    /* Producten- en materialencatalogus (Fase F). */
    async insertMaterial(row) {
      return insertRow('materials', row);
    },
    async fetchMaterials() {
      const c = await connect();
      const res = await c.query('select * from materials');
      return res.rows;
    },
    async getMaterialById(id) {
      const c = await connect();
      const res = await c.query('select * from materials where id = $1', [id]);
      return res.rows[0] || null;
    },
    async findMaterialByMatchKey(companyId, matchKey) {
      if (!matchKey) return null;
      const c = await connect();
      const res = await c.query(
        'select * from materials where company_id = $1 and match_key = $2 limit 1',
        [companyId, matchKey],
      );
      return res.rows[0] || null;
    },
    async updateMaterial(id, patch) {
      return updateById('materials', id, patch);
    },

    /* Jaarlijkse loonkosten per medewerker (uurtarief-blok, M5.2). */
    async insertWorkerAnnualCost(row) {
      return insertRow('worker_annual_cost', row);
    },
    async fetchWorkerAnnualCosts() {
      const c = await connect();
      const res = await c.query('select * from worker_annual_cost');
      return res.rows;
    },
    async findWorkerAnnualCost(companyId, workerId, year) {
      const c = await connect();
      const res = await c.query(
        'select * from worker_annual_cost where company_id = $1 and worker_id = $2 and year = $3 limit 1',
        [companyId, workerId, Number(year)],
      );
      return res.rows[0] || null;
    },
    async updateWorkerAnnualCost(id, patch) {
      return updateById('worker_annual_cost', id, patch);
    },

    /* Personeelsdossier (SCAB HRM): afdelingen en de drie 1:1-satelliettabellen. */
    async insertDepartment(row) {
      return insertRow('departments', row);
    },
    async fetchDepartments() {
      const c = await connect();
      const res = await c.query('select * from departments');
      return res.rows;
    },
    async findDepartmentByName(companyId, name) {
      if (!name) return null;
      const c = await connect();
      const res = await c.query(
        'select * from departments where company_id = $1 and name = $2 limit 1',
        [companyId, name],
      );
      return res.rows[0] || null;
    },
    async updateDepartment(id, patch) {
      return updateById('departments', id, patch);
    },

    async insertWorkerPersonalia(row) {
      return insertRow('worker_personalia', row);
    },
    async fetchWorkerPersonalias() {
      const c = await connect();
      const res = await c.query('select * from worker_personalia');
      return res.rows;
    },
    async findWorkerPersonaliaByWorker(companyId, workerId) {
      const c = await connect();
      const res = await c.query(
        'select * from worker_personalia where company_id = $1 and worker_id = $2 limit 1',
        [companyId, workerId],
      );
      return res.rows[0] || null;
    },
    async updateWorkerPersonalia(id, patch) {
      return updateById('worker_personalia', id, patch);
    },

    async insertWorkerEmployment(row) {
      return insertRow('worker_employment', row);
    },
    async fetchWorkerEmployments() {
      const c = await connect();
      const res = await c.query('select * from worker_employment');
      return res.rows;
    },
    async findWorkerEmploymentByWorker(companyId, workerId) {
      const c = await connect();
      const res = await c.query(
        'select * from worker_employment where company_id = $1 and worker_id = $2 limit 1',
        [companyId, workerId],
      );
      return res.rows[0] || null;
    },
    async updateWorkerEmployment(id, patch) {
      return updateById('worker_employment', id, patch);
    },

    async insertWorkerRemuneration(row) {
      return insertRow('worker_remuneration', row);
    },
    async fetchWorkerRemunerations() {
      const c = await connect();
      const res = await c.query('select * from worker_remuneration');
      return res.rows;
    },
    async findWorkerRemunerationByWorker(companyId, workerId) {
      const c = await connect();
      const res = await c.query(
        'select * from worker_remuneration where company_id = $1 and worker_id = $2 limit 1',
        [companyId, workerId],
      );
      return res.rows[0] || null;
    },
    async updateWorkerRemuneration(id, patch) {
      return updateById('worker_remuneration', id, patch);
    },

    /* Periodieke loonlaag (SCAB Loonverwerking, Overgemaakte bedragen, Loonaangifte). */
    async insertPayrollRun(row) {
      return insertRow('payroll_runs', row);
    },
    async fetchPayrollRuns() {
      const c = await connect();
      const res = await c.query('select * from payroll_runs');
      return res.rows;
    },
    async findPayrollRunByPeriod(companyId, year, maand) {
      const c = await connect();
      const res = await c.query(
        'select * from payroll_runs where company_id = $1 and year = $2 and period_maand = $3 limit 1',
        [companyId, Number(year), Number(maand)],
      );
      return res.rows[0] || null;
    },
    async updatePayrollRun(id, patch) {
      return updateById('payroll_runs', id, patch);
    },
    async insertPayrollPayment(row) {
      return insertRow('payroll_payments', row);
    },
    async fetchPayrollPayments() {
      const c = await connect();
      const res = await c.query('select * from payroll_payments');
      return res.rows;
    },
    async findPayrollPaymentBySourceRef(companyId, sourceRef) {
      if (sourceRef == null) return null;
      const c = await connect();
      const res = await c.query(
        'select * from payroll_payments where company_id = $1 and source_ref = $2 limit 1',
        [companyId, sourceRef],
      );
      return res.rows[0] || null;
    },
    async updatePayrollPayment(id, patch) {
      return updateById('payroll_payments', id, patch);
    },
    async insertPayrollTaxFiling(row) {
      return insertRow('payroll_tax_filings', row);
    },
    async fetchPayrollTaxFilings() {
      const c = await connect();
      const res = await c.query('select * from payroll_tax_filings');
      return res.rows;
    },
    async findPayrollTaxFilingByPeriod(companyId, year, maand, volgnummer) {
      const c = await connect();
      const res = await c.query(
        'select * from payroll_tax_filings where company_id = $1 and year = $2 and period_maand = $3 and volgnummer is not distinct from $4 limit 1',
        [companyId, Number(year), Number(maand), volgnummer == null ? null : Number(volgnummer)],
      );
      return res.rows[0] || null;
    },
    async updatePayrollTaxFiling(id, patch) {
      return updateById('payroll_tax_filings', id, patch);
    },

    /* Personeelsdossier 1:N-satellieten (SCAB HRM): autos, certificaten, documenten, uitgereikte
       middelen. De sleutelvergelijking gebruikt is not distinct from zodat null aan null gelijk is. */
    async insertWorkerVehicle(row) {
      return insertRow('worker_vehicles', row);
    },
    async fetchWorkerVehiclesByWorker(companyId, workerId) {
      const c = await connect();
      const res = await c.query(
        'select * from worker_vehicles where company_id = $1 and worker_id = $2 order by ingangsdatum nulls last, created_at',
        [companyId, workerId],
      );
      return res.rows;
    },
    async findWorkerVehicleByKey(companyId, workerId, kenteken, ingangsdatum) {
      const c = await connect();
      const res = await c.query(
        'select * from worker_vehicles where company_id = $1 and worker_id = $2 and kenteken is not distinct from $3 and ingangsdatum is not distinct from $4 limit 1',
        [companyId, workerId, kenteken ?? null, ingangsdatum ?? null],
      );
      return res.rows[0] || null;
    },
    async updateWorkerVehicle(id, patch) {
      return updateById('worker_vehicles', id, patch);
    },

    async insertWorkerCertificate(row) {
      return insertRow('worker_certificates', row);
    },
    async fetchWorkerCertificatesByWorker(companyId, workerId) {
      const c = await connect();
      const res = await c.query(
        'select * from worker_certificates where company_id = $1 and worker_id = $2 order by geldig_tot nulls last, created_at',
        [companyId, workerId],
      );
      return res.rows;
    },
    async findWorkerCertificateByKey(companyId, workerId, certType, naam, geldigTot) {
      const c = await connect();
      const res = await c.query(
        'select * from worker_certificates where company_id = $1 and worker_id = $2 and cert_type is not distinct from $3 and naam is not distinct from $4 and geldig_tot is not distinct from $5 limit 1',
        [companyId, workerId, certType ?? null, naam ?? null, geldigTot ?? null],
      );
      return res.rows[0] || null;
    },
    async updateWorkerCertificate(id, patch) {
      return updateById('worker_certificates', id, patch);
    },

    async insertWorkerDocument(row) {
      return insertRow('worker_documents', row);
    },
    async fetchWorkerDocumentsByWorker(companyId, workerId) {
      const c = await connect();
      const res = await c.query(
        'select * from worker_documents where company_id = $1 and worker_id = $2 order by geldig_tot nulls last, created_at',
        [companyId, workerId],
      );
      return res.rows;
    },
    async findWorkerDocumentByKey(companyId, workerId, soortDocument, onderwerp) {
      const c = await connect();
      const res = await c.query(
        'select * from worker_documents where company_id = $1 and worker_id = $2 and soort_document is not distinct from $3 and onderwerp is not distinct from $4 limit 1',
        [companyId, workerId, soortDocument ?? null, onderwerp ?? null],
      );
      return res.rows[0] || null;
    },
    async updateWorkerDocument(id, patch) {
      return updateById('worker_documents', id, patch);
    },

    async insertWorkerIssuedItem(row) {
      return insertRow('worker_issued_items', row);
    },
    async fetchWorkerIssuedItemsByWorker(companyId, workerId) {
      const c = await connect();
      const res = await c.query(
        'select * from worker_issued_items where company_id = $1 and worker_id = $2 order by uitgereikt_op nulls last, created_at',
        [companyId, workerId],
      );
      return res.rows;
    },
    async findWorkerIssuedItemByKey(companyId, workerId, item, uitgereiktOp) {
      const c = await connect();
      const res = await c.query(
        'select * from worker_issued_items where company_id = $1 and worker_id = $2 and item is not distinct from $3 and uitgereikt_op is not distinct from $4 limit 1',
        [companyId, workerId, item ?? null, uitgereiktOp ?? null],
      );
      return res.rows[0] || null;
    },
    async updateWorkerIssuedItem(id, patch) {
      return updateById('worker_issued_items', id, patch);
    },

    /* Verlof, verzuim, jaaropgaven en loonstrook-detail (loonmotor compleet, migration 0022).
       Zelfde patroon: insert, fetch per medewerker, find op de natuurlijke sleutel, update. */
    async insertWorkerLeaveBalance(row) {
      return insertRow('worker_leave_balances', row);
    },
    async fetchWorkerLeaveBalancesByWorker(companyId, workerId) {
      const c = await connect();
      const res = await c.query(
        'select * from worker_leave_balances where company_id = $1 and worker_id = $2 order by year, balance_type',
        [companyId, workerId],
      );
      return res.rows;
    },
    async findWorkerLeaveBalanceByKey(companyId, workerId, year, balanceType) {
      const c = await connect();
      const res = await c.query(
        'select * from worker_leave_balances where company_id = $1 and worker_id = $2 and year = $3 and balance_type = $4 limit 1',
        [companyId, workerId, Number(year), balanceType],
      );
      return res.rows[0] || null;
    },
    async updateWorkerLeaveBalance(id, patch) {
      return updateById('worker_leave_balances', id, patch);
    },

    async insertWorkerAbsence(row) {
      return insertRow('worker_absences', row);
    },
    async fetchWorkerAbsencesByWorker(companyId, workerId) {
      const c = await connect();
      const res = await c.query(
        'select * from worker_absences where company_id = $1 and worker_id = $2 order by ziekmeldingsdatum',
        [companyId, workerId],
      );
      return res.rows;
    },
    async findWorkerAbsenceByKey(companyId, workerId, ziekmeldingsdatum) {
      const c = await connect();
      const res = await c.query(
        'select * from worker_absences where company_id = $1 and worker_id = $2 and ziekmeldingsdatum = $3 limit 1',
        [companyId, workerId, ziekmeldingsdatum],
      );
      return res.rows[0] || null;
    },
    async updateWorkerAbsence(id, patch) {
      return updateById('worker_absences', id, patch);
    },

    async insertWorkerAnnualStatement(row) {
      return insertRow('worker_annual_statements', row);
    },
    async fetchWorkerAnnualStatementsByWorker(companyId, workerId) {
      const c = await connect();
      const res = await c.query(
        'select * from worker_annual_statements where company_id = $1 and worker_id = $2 order by year',
        [companyId, workerId],
      );
      return res.rows;
    },
    async findWorkerAnnualStatementByKey(companyId, workerId, year) {
      const c = await connect();
      const res = await c.query(
        'select * from worker_annual_statements where company_id = $1 and worker_id = $2 and year = $3 limit 1',
        [companyId, workerId, Number(year)],
      );
      return res.rows[0] || null;
    },
    async updateWorkerAnnualStatement(id, patch) {
      return updateById('worker_annual_statements', id, patch);
    },

    async insertWorkerPeriodPay(row) {
      return insertRow('worker_period_pay', row);
    },
    async fetchWorkerPeriodPayByWorker(companyId, workerId) {
      const c = await connect();
      const res = await c.query(
        'select * from worker_period_pay where company_id = $1 and worker_id = $2 order by year, period_maand',
        [companyId, workerId],
      );
      return res.rows;
    },
    async findWorkerPeriodPayByKey(companyId, workerId, year, maand) {
      const c = await connect();
      const res = await c.query(
        'select * from worker_period_pay where company_id = $1 and worker_id = $2 and year = $3 and period_maand = $4 limit 1',
        [companyId, workerId, Number(year), Number(maand)],
      );
      return res.rows[0] || null;
    },
    async updateWorkerPeriodPay(id, patch) {
      return updateById('worker_period_pay', id, patch);
    },

    /* Mapping-lifecycle (blok 8): geleerde mappings kunnen verouderen (supersede/retire). */
    async findLearningMappingById(id) {
      const c = await connect();
      const res = await c.query('select * from learning_mappings where id = $1 limit 1', [id]);
      return res.rows[0] || null;
    },
    async updateLearningMapping(id, patch) {
      return updateById('learning_mappings', id, patch);
    },

    /* Kennislaag (blok 8): beslissingen, memory en sessieverslagen uit het MVP-schema. */
    async insertDecision(row) {
      return insertRow('decisions', row);
    },
    async findDecisionByTitle(companyId, normalizedTitle) {
      const c = await connect();
      const res = await c.query(
        'select * from decisions where company_id = $1 and lower(trim(title)) = $2 limit 1',
        [companyId, normalizedTitle],
      );
      return res.rows[0] || null;
    },
    async fetchDecisions() {
      const c = await connect();
      return (await c.query('select * from decisions')).rows;
    },
    async updateDecision(id, patch) {
      return updateById('decisions', id, patch);
    },
    async insertMemoryItem(row) {
      return insertRow('memory_items', row);
    },
    async findMemoryItemByContent(companyId, normalizedContent) {
      const c = await connect();
      const res = await c.query(
        'select * from memory_items where company_id = $1 and lower(trim(content)) = $2 limit 1',
        [companyId, normalizedContent],
      );
      return res.rows[0] || null;
    },
    async fetchMemoryItems() {
      const c = await connect();
      return (await c.query('select * from memory_items')).rows;
    },
    async insertWikiPage(row) {
      return insertRow('wiki_pages', row);
    },
    async findWikiPageBySlug(companyId, slug) {
      const c = await connect();
      const res = await c.query(
        'select * from wiki_pages where company_id = $1 and slug = $2 limit 1',
        [companyId, slug],
      );
      return res.rows[0] || null;
    },
    async fetchWikiPages() {
      const c = await connect();
      return (await c.query('select * from wiki_pages')).rows;
    },
    async updateWikiPage(id, patch) {
      return updateById('wiki_pages', id, patch);
    },
    async fetchWikiPagesByCompany(companyId) {
      const c = await connect();
      return (await c.query(
        'select * from wiki_pages where company_id = $1 order by slug',
        [companyId],
      )).rows;
    },
    async fetchMemoryItemsByCompany(companyId) {
      const c = await connect();
      return (await c.query(
        'select * from memory_items where company_id = $1 order by created_at',
        [companyId],
      )).rows;
    },
    async updateMemoryItem(id, patch) {
      return updateById('memory_items', id, patch);
    },
    async updateCompany(id, patch) {
      return updateById('companies', id, patch);
    },
    async insertOperatingManual(row) {
      return insertRow('company_operating_manuals', row);
    },
    async findActiveOperatingManual(companyId) {
      const c = await connect();
      const res = await c.query(
        'select * from company_operating_manuals where company_id = $1 and is_active limit 1',
        [companyId],
      );
      return res.rows[0] || null;
    },
    async fetchOperatingManuals(companyId = null) {
      const c = await connect();
      if (companyId != null) {
        return (await c.query(
          'select * from company_operating_manuals where company_id = $1',
          [companyId],
        )).rows;
      }
      return (await c.query('select * from company_operating_manuals')).rows;
    },
    async updateOperatingManual(id, patch) {
      return updateById('company_operating_manuals', id, patch);
    },
    async insertSessionSummary(row) {
      return insertRow('session_summaries', row);
    },
    async findSessionSummaryByDate(companyId, sessionDate) {
      const c = await connect();
      const res = await c.query(
        'select * from session_summaries where company_id = $1 and session_date = $2 limit 1',
        [companyId, sessionDate],
      );
      return res.rows[0] || null;
    },
    async fetchSessionSummaries() {
      const c = await connect();
      return (await c.query('select * from session_summaries')).rows;
    },
    async updateSessionSummary(id, patch) {
      return updateById('session_summaries', id, patch);
    },
    /*
      Het verslag van een dag AANVULLEN, in een enkele UPDATE aan de kant van Postgres.

      Waarom niet lezen, samenvoegen en terugschrijven: tussen dat lezen en dat schrijven kan een
      andere sessie schrijven, en dan wint de laatste en is het andere verslag weg. Dat is geen
      theorie; het gebeurde op 14-09-2026 (ochtend en middag) en op 17-09-2026 (het verslag van
      een tweede sessie op mrhoof, onherstelbaar want er is geen audittabel). Vooraf controleren
      of er al een rij staat helpt daar niet tegen, want het gat zit tussen de controle en de
      write. Hier kan er niets tussen vallen.

      Geen geraakte rij betekent: er was er nog geen. De aanroeper maakt hem dan aan.
    */
    async appendSessionSummary(companyId, sessionDate, {
      summaryDeel, nextStepsDeel = null, scheiding = '\n\n',
      decisionsMade = [], tasksTouched = [],
    } = {}) {
      const c = await connect();
      const res = await c.query(
        `update session_summaries
            set summary = summary || $3 || $4,
                next_steps = case
                  when $5::text is null then next_steps
                  when next_steps is null or btrim(next_steps) = '' then $5
                  else next_steps || $3 || $5
                end,
                decisions_made = coalesce(decisions_made, '[]'::jsonb) || $6::jsonb,
                tasks_touched = coalesce(tasks_touched, '[]'::jsonb) || $7::jsonb,
                updated_at = now()
          where company_id = $1 and session_date = $2
        returning *`,
        [
          companyId, sessionDate, scheiding, summaryDeel, nextStepsDeel,
          JSON.stringify(decisionsMade || []), JSON.stringify(tasksTouched || []),
        ],
      );
      return res.rows[0] || null;
    },

    /* Companies en taken (taken-laag, blok 7). De context van een taak is het bedrijf. */
    async findCompanyBySlug(slug) {
      const c = await connect();
      const res = await c.query('select * from companies where slug = $1 limit 1', [slug]);
      return res.rows[0] || null;
    },
    async insertTask(row) {
      return insertRow('tasks', row);
    },
    async findTaskByTitle(companyId, normalizedTitle) {
      const c = await connect();
      const res = await c.query(
        'select * from tasks where company_id = $1 and lower(trim(title)) = $2 limit 1',
        [companyId, normalizedTitle],
      );
      return res.rows[0] || null;
    },
    async fetchTasks() {
      const c = await connect();
      const res = await c.query('select * from tasks');
      return res.rows;
    },
    async deleteTask(id) {
      const c = await connect();
      const res = await c.query('delete from tasks where id = $1', [id]);
      return { deleted: res.rowCount };
    },
    async updateTask(id, patch) {
      return updateById('tasks', id, patch);
    },

    /* Personen-laag (0035): people als anker plus person_company_roles (rol per bedrijf). */
    async insertPerson(row) {
      return insertRow('people', row);
    },
    async findPersonByName(companyId, normalizedName) {
      const c = await connect();
      const res = await c.query(
        'select * from people where company_id = $1 and lower(trim(name)) = $2 limit 1',
        [companyId, normalizedName],
      );
      return res.rows[0] || null;
    },
    async fetchPeople() {
      const c = await connect();
      const res = await c.query('select * from people');
      return res.rows;
    },
    async updatePerson(id, patch) {
      return updateById('people', id, patch);
    },
    async insertPersonCompanyRole(row) {
      return insertRow('person_company_roles', row);
    },
    async findPersonCompanyRole(personId, companyId, role) {
      const c = await connect();
      const res = await c.query(
        'select * from person_company_roles where person_id = $1 and company_id = $2 and role = $3 limit 1',
        [personId, companyId, role],
      );
      return res.rows[0] || null;
    },
    async fetchPersonCompanyRoles() {
      const c = await connect();
      const res = await c.query('select * from person_company_roles');
      return res.rows;
    },
    async updatePersonCompanyRole(id, patch) {
      return updateById('person_company_roles', id, patch);
    },
    async deletePersonCompanyRole(personId, companyId, role) {
      const c = await connect();
      const res = await c.query(
        'delete from person_company_roles where person_id = $1 and company_id = $2 and role = $3',
        [personId, companyId, role],
      );
      return { deleted: res.rowCount };
    },
    async insertPersonRelation(row) {
      return insertRow('person_relations', row);
    },
    async findPersonRelation(fromPersonId, toPersonId, normalizedRelation) {
      const c = await connect();
      const res = await c.query(
        'select * from person_relations where from_person_id = $1 and to_person_id = $2 and normalized_relation = $3 limit 1',
        [fromPersonId, toPersonId, normalizedRelation],
      );
      return res.rows[0] || null;
    },
    async fetchPersonRelations() {
      const c = await connect();
      const res = await c.query('select * from person_relations');
      return res.rows;
    },
    async updatePersonRelation(id, patch) {
      return updateById('person_relations', id, patch);
    },
    async deletePersonRelation(fromPersonId, toPersonId, normalizedRelation) {
      const c = await connect();
      const res = await c.query(
        'delete from person_relations where from_person_id = $1 and to_person_id = $2 and normalized_relation = $3',
        [fromPersonId, toPersonId, normalizedRelation],
      );
      return { deleted: res.rowCount };
    },

    /*
      Twee rijen die hetzelfde ding blijken te zijn samenvoegen: alles wat naar dropId wijst gaat
      naar keepId, daarna verdwijnt de losgeraakte rij.

      Bedoeld voor dubbelingen die ontstaan doordat iets op twee manieren is opgeschreven. Dat gold
      voor people (Marc van de Wallen naast Marc van de Walle) en net zo goed voor sales_leads
      (Ellen naast Kerkveldweg 3, hetzelfde werk). Vandaar de tabelnaam als argument in plaats van
      twee bijna gelijke functies.

      De kolommen komen UIT DE CATALOGUS en niet uit een lijst in de code. Een lijst zou bij de
      eerstvolgende migratie stil incompleet worden, en dan blijft er een draad aan een verwijderde
      rij hangen; bij people waren dat er al eenentwintig kolommen over eenentwintig tabellen. Wat
      de database weet is hier betrouwbaarder dan wat wij onthouden.

      Unieke sleutels zijn het addertje. person_company_roles is uniek op (person_id, company_id,
      role) en beide Marcs hadden de rol client; een botte update zou dan afketsen op de constraint.
      Daarom gaan per unieke sleutel eerst de rijen weg die na de verhuizing een duplicaat zouden
      zijn: die informatie bestaat immers al aan de andere kant.

      Een relatie die na de verhuizing naar zichzelf wijst gaat er ook uit. Dat gebeurt als beide
      kaarten aan elkaar geknoopt zaten, en "X is vader van X" is geen feit maar een restant. Dat
      geldt alleen voor person_relations; andere tabellen kennen zo'n paar niet.

      Alles in een transactie. Halverwege stoppen zou een persoon achterlaten waarvan de helft van
      de draden verhangen is, en dat is erger dan niet beginnen.
    */
    async mergeReferences(doel, keepId, dropId) {
      const c = await connect();
      const q = (naam) => `"${String(naam).replace(/"/g, '""')}"`;

      await c.query('begin');
      try {
        const { rows: kolommen } = await c.query(`
          select tc.table_name, kcu.column_name
            from information_schema.table_constraints tc
            join information_schema.key_column_usage kcu
              on kcu.constraint_name = tc.constraint_name
            join information_schema.constraint_column_usage ccu
              on ccu.constraint_name = tc.constraint_name
           where tc.constraint_type = 'FOREIGN KEY'
             and ccu.table_name = $1 and ccu.column_name = 'id'
           order by tc.table_name, kcu.column_name`, [doel]);

        const verplaatst = [];
        const opgeruimd = [];

        for (const k of kolommen) {
          const tabel = q(k.table_name);
          const kolom = q(k.column_name);

          /* Rijen die na de verhuizing een unieke sleutel zouden dubbelen: die kant bestaat al. */
          const { rows: sleutels } = await c.query(
            `select conname, pg_get_constraintdef(oid) as def
               from pg_constraint
              where conrelid = $1::regclass and contype in ('u', 'p')`,
            [k.table_name],
          );
          for (const sleutel of sleutels) {
            const binnen = /\(([^)]*)\)/.exec(sleutel.def);
            if (!binnen) continue;
            const velden = binnen[1].split(',').map((v) => v.trim().replace(/^"|"$/g, ''));
            if (!velden.includes(k.column_name)) continue;
            const anderen = velden.filter((v) => v !== k.column_name);
            if (!anderen.length) continue;
            const koppel = anderen.map((v) => `bestaand.${q(v)} is not distinct from weg.${q(v)}`).join(' and ');
            const res = await c.query(
              `delete from ${tabel} weg
                where weg.${kolom} = $2
                  and exists (select 1 from ${tabel} bestaand
                               where bestaand.${kolom} = $1 and ${koppel})`,
              [keepId, dropId],
            );
            if (res.rowCount) opgeruimd.push({ tabel: k.table_name, kolom: k.column_name, aantal: res.rowCount });
          }

          const res = await c.query(
            `update ${tabel} set ${kolom} = $1 where ${kolom} = $2`, [keepId, dropId],
          );
          if (res.rowCount) verplaatst.push({ tabel: k.table_name, kolom: k.column_name, aantal: res.rowCount });
        }

        if (doel === 'people') {
          const zelf = await c.query(
            'delete from person_relations where from_person_id = to_person_id and from_person_id = $1', [keepId],
          );
          if (zelf.rowCount) opgeruimd.push({ tabel: 'person_relations', kolom: 'zelfverwijzing', aantal: zelf.rowCount });
        }

        const weg = await c.query(`delete from ${q(doel)} where id = $1`, [dropId]);
        await c.query('commit');
        return { verplaatst, opgeruimd, verwijderd: weg.rowCount };
      } catch (err) {
        await c.query('rollback');
        throw err;
      }
    },

    /* Ideeën (migration 0044): idempotent per bedrijf op de genormaliseerde titel. */
    async insertIdea(row) {
      return insertRow('ideas', row);
    },
    async findIdeaByTitle(companyId, normalizedTitle) {
      const c = await connect();
      const res = await c.query(
        'select * from ideas where company_id = $1 and lower(trim(title)) = $2 limit 1',
        [companyId, normalizedTitle],
      );
      return res.rows[0] || null;
    },
    async fetchIdeas() {
      const c = await connect();
      const res = await c.query('select * from ideas');
      return res.rows;
    },
    async updateIdea(id, patch) {
      return updateById('ideas', id, patch);
    },
    async deleteIdea(id) {
      const c = await connect();
      const res = await c.query('delete from ideas where id = $1', [id]);
      return { deleted: res.rowCount };
    },

    /* Zaakdossiers (migration 0048): idempotent per bedrijf op de genormaliseerde titel;
       items uniek op (dossier, item_type, item_ref), betrokkenen op (dossier, persoon). */
    async insertDossier(row) {
      return insertRow('dossiers', row);
    },
    async findDossierByTitle(companyId, normalizedTitle) {
      const c = await connect();
      const res = await c.query(
        'select * from dossiers where company_id = $1 and lower(trim(title)) = $2 limit 1',
        [companyId, normalizedTitle],
      );
      return res.rows[0] || null;
    },
    async fetchDossiers() {
      const c = await connect();
      const res = await c.query('select * from dossiers');
      return res.rows;
    },
    async updateDossier(id, patch) {
      return updateById('dossiers', id, patch);
    },
    async deleteDossier(id) {
      const c = await connect();
      const res = await c.query('delete from dossiers where id = $1', [id]);
      return { deleted: res.rowCount };
    },
    async insertDossierItem(row) {
      return insertRow('dossier_items', row);
    },
    async findDossierItemByRef(dossierId, itemType, itemRef) {
      const c = await connect();
      const res = await c.query(
        'select * from dossier_items where dossier_id = $1 and item_type = $2 and item_ref = $3 limit 1',
        [dossierId, itemType, itemRef],
      );
      return res.rows[0] || null;
    },
    async fetchDossierItems() {
      const c = await connect();
      const res = await c.query('select * from dossier_items');
      return res.rows;
    },
    async insertDossierBetrokkene(row) {
      return insertRow('dossier_betrokkenen', row);
    },
    async findDossierBetrokkene(dossierId, personId) {
      const c = await connect();
      const res = await c.query(
        'select * from dossier_betrokkenen where dossier_id = $1 and person_id = $2 limit 1',
        [dossierId, personId],
      );
      return res.rows[0] || null;
    },
    async fetchDossierBetrokkenen() {
      const c = await connect();
      const res = await c.query('select * from dossier_betrokkenen');
      return res.rows;
    },
    async updateDossierBetrokkene(id, patch) {
      return updateById('dossier_betrokkenen', id, patch);
    },

    /* Taak-draaiboeken (migration 0043): uniek op (company, kind_key). */
    async insertTaskPlaybook(row) {
      return insertRow('task_playbooks', row);
    },
    async findTaskPlaybookByKind(companyId, kindKey) {
      const c = await connect();
      const res = await c.query(
        'select * from task_playbooks where company_id = $1 and kind_key = $2 limit 1',
        [companyId, kindKey],
      );
      return res.rows[0] || null;
    },
    async fetchTaskPlaybooks() {
      const c = await connect();
      const res = await c.query('select * from task_playbooks');
      return res.rows;
    },
    async updateTaskPlaybook(id, patch) {
      return updateById('task_playbooks', id, patch);
    },

    /* Bankafschriften (M3): idempotent op (company, rekening, transactieref). */
    async insertBankTransaction(row) {
      return insertRow('bank_transactions', row);
    },
    async findBankTransactionByRef(companyId, accountIban, transactionRef) {
      const c = await connect();
      const res = await c.query(
        'select * from bank_transactions where company_id = $1 and account_iban = $2 and transaction_ref = $3 limit 1',
        [companyId, accountIban, transactionRef],
      );
      return res.rows[0] || null;
    },
    async findBankTransactionById(id) {
      const c = await connect();
      const res = await c.query('select * from bank_transactions where id = $1 limit 1', [id]);
      return res.rows[0] || null;
    },
    async fetchBankTransactions() {
      const c = await connect();
      return (await c.query('select * from bank_transactions')).rows;
    },
    async updateBankTransaction(id, patch) {
      return updateById('bank_transactions', id, patch);
    },

    /* SnelStart-synclaag (M5.10): idempotent op (company, administratie, soort, snelstart_id). */
    async insertSnelstartBoeking(row) {
      return insertRow('snelstart_boekingen', row);
    },
    async findSnelstartBoekingByBron(companyId, administratie, soort, snelstartId) {
      const c = await connect();
      const res = await c.query(
        'select * from snelstart_boekingen where company_id = $1 and administratie = $2 and soort = $3 and snelstart_id = $4 limit 1',
        [companyId, administratie, soort, snelstartId],
      );
      return res.rows[0] || null;
    },
    async fetchSnelstartBoekingen() {
      const c = await connect();
      return (await c.query('select * from snelstart_boekingen')).rows;
    },
    async updateSnelstartBoeking(id, patch) {
      return updateById('snelstart_boekingen', id, patch);
    },

    /* CRM-fundament (migration 0060): een bedrijf bestaat exact een keer per context;
       config (fasen, waardelijsten) is data per company, geen code. */
    async insertPipelineFase(row) {
      return insertRow('pipeline_fases', row);
    },
    async findPipelineFase(companyId, pipeline, naam) {
      const c = await connect();
      const res = await c.query(
        'select * from pipeline_fases where company_id = $1 and pipeline = $2 and naam = $3 limit 1',
        [companyId, pipeline, naam],
      );
      return res.rows[0] || null;
    },
    async fetchPipelineFases() {
      const c = await connect();
      return (await c.query('select * from pipeline_fases order by pipeline, volgorde')).rows;
    },
    async insertVeldoptie(row) {
      return insertRow('sales_veldopties', row);
    },
    async findVeldoptie(companyId, veld, waarde) {
      const c = await connect();
      const res = await c.query(
        'select * from sales_veldopties where company_id = $1 and veld = $2 and waarde = $3 limit 1',
        [companyId, veld, waarde],
      );
      return res.rows[0] || null;
    },
    async fetchVeldopties() {
      const c = await connect();
      return (await c.query('select * from sales_veldopties')).rows;
    },
    async insertLead(row) {
      return insertRow('sales_leads', row);
    },
    async getLeadById(id) {
      const c = await connect();
      const res = await c.query('select * from sales_leads where id = $1 limit 1', [id]);
      return res.rows[0] || null;
    },
    async findLeadByKvk(companyId, kvkNummer) {
      const c = await connect();
      const res = await c.query(
        'select * from sales_leads where company_id = $1 and kvk_nummer = $2 limit 1',
        [companyId, kvkNummer],
      );
      return res.rows[0] || null;
    },
    async findLeadByBtw(companyId, btwNummer) {
      const c = await connect();
      const res = await c.query(
        'select * from sales_leads where company_id = $1 and btw_nummer = $2 limit 1',
        [companyId, btwNummer],
      );
      return res.rows[0] || null;
    },
    async findLeadByDomein(companyId, domein) {
      const c = await connect();
      const res = await c.query(
        'select * from sales_leads where company_id = $1 and domein = $2 limit 1',
        [companyId, domein],
      );
      return res.rows[0] || null;
    },
    async findLeadByNaamPlaats(companyId, genormaliseerdeNaam, plaats) {
      const c = await connect();
      const res = await c.query(
        "select * from sales_leads where company_id = $1 and genormaliseerde_naam = $2 and coalesce(plaats, '') = $3 limit 1",
        [companyId, genormaliseerdeNaam, plaats || ''],
      );
      return res.rows[0] || null;
    },
    async fetchLeads() {
      const c = await connect();
      return (await c.query('select * from sales_leads')).rows;
    },
    async updateLead(id, patch) {
      return updateById('sales_leads', id, patch);
    },
    async insertLeadPerson(row) {
      return insertRow('lead_people', row);
    },
    async findLeadPerson(leadId, personId) {
      const c = await connect();
      const res = await c.query(
        'select * from lead_people where lead_id = $1 and person_id = $2 limit 1',
        [leadId, personId],
      );
      return res.rows[0] || null;
    },
    async fetchLeadPeople() {
      const c = await connect();
      return (await c.query('select * from lead_people')).rows;
    },
    async updateLeadPerson(id, patch) {
      return updateById('lead_people', id, patch);
    },
    async insertInteraction(row) {
      return insertRow('interactions', row);
    },
    async fetchInteractions() {
      const c = await connect();
      return (await c.query('select * from interactions order by started_at desc')).rows;
    },
    async insertDiscoveryAnswer(row) {
      return insertRow('discovery_answers', row);
    },
    async findDiscoveryAnswer(interactionId, veld) {
      const c = await connect();
      const res = await c.query(
        'select * from discovery_answers where interaction_id = $1 and veld = $2 limit 1',
        [interactionId, veld],
      );
      return res.rows[0] || null;
    },
    async updateDiscoveryAnswer(id, patch) {
      return updateById('discovery_answers', id, patch);
    },
    async fetchDiscoveryAnswers() {
      const c = await connect();
      return (await c.query('select * from discovery_answers')).rows;
    },
    async insertQuestion(row) {
      return insertRow('questions', row);
    },
    async fetchQuestions() {
      const c = await connect();
      return (await c.query('select * from questions')).rows;
    },
    async insertObjection(row) {
      return insertRow('objections', row);
    },
    async fetchObjections() {
      const c = await connect();
      return (await c.query('select * from objections')).rows;
    },
    async insertOpportunity(row) {
      return insertRow('opportunities', row);
    },
    async findOpportunityByNaam(companyId, leadId, naam) {
      const c = await connect();
      const res = await c.query(
        'select * from opportunities where company_id = $1 and lead_id = $2 and lower(trim(naam)) = $3 limit 1',
        [companyId, leadId, String(naam || '').trim().toLowerCase()],
      );
      return res.rows[0] || null;
    },
    async fetchOpportunities() {
      const c = await connect();
      return (await c.query('select * from opportunities')).rows;
    },
    async updateOpportunity(id, patch) {
      return updateById('opportunities', id, patch);
    },

    /* Belronde (crm/belronde-store.mjs) en gespreksverwerking: de leeslaag over de
       research-tabellen (0061), de werkvoorraad sales_queue, weetjes, suggesties en het
       portaal. Alleen fetch-, insert- en update-vormen; de live-leesadapter laat hiervan
       uitsluitend de fetch-methoden door. */
    async fetchLeadResearch() {
      const c = await connect();
      return (await c.query('select * from lead_research order by lead_id, versie')).rows;
    },
    async insertLeadResearch(row) {
      return insertRow('lead_research', row);
    },
    async fetchLeadClassifications() {
      const c = await connect();
      return (await c.query('select * from lead_classifications')).rows;
    },
    async insertLeadClassification(row) {
      return insertRow('lead_classifications', row);
    },
    async fetchLeadFacts() {
      const c = await connect();
      return (await c.query('select * from lead_facts')).rows;
    },
    async insertLeadFact(row) {
      return insertRow('lead_facts', row);
    },
    async fetchLeadSources() {
      const c = await connect();
      return (await c.query('select * from lead_sources')).rows;
    },
    async insertLeadSource(row) {
      return insertRow('lead_sources', row);
    },
    async insertSalesQueue(row) {
      return insertRow('sales_queue', row);
    },
    async fetchSalesQueue() {
      const c = await connect();
      return (await c.query('select * from sales_queue order by berekend_op desc')).rows;
    },
    async updateSalesQueue(id, patch) {
      return updateById('sales_queue', id, patch);
    },
    async updateInteraction(id, patch) {
      return updateById('interactions', id, patch);
    },
    async insertCrmWeetje(row) {
      return insertRow('crm_weetjes', row);
    },
    async fetchCrmWeetjes() {
      const c = await connect();
      return (await c.query('select * from crm_weetjes')).rows;
    },
    async insertSalesSuggestion(row) {
      return insertRow('sales_suggestions', row);
    },
    async fetchSalesSuggestions() {
      const c = await connect();
      return (await c.query('select * from sales_suggestions')).rows;
    },
    async fetchPortalPartners() {
      const c = await connect();
      return (await c.query('select * from portal_partners')).rows;
    },
    async fetchPortalOrders() {
      const c = await connect();
      return (await c.query('select * from portal_orders')).rows;
    },
    async updatePortalOrder(id, patch) {
      return updateById('portal_orders', id, patch);
    },
    /* Het dashboard van de belronde: de portaaltabellen voor de partneractivatie (alleen lezen),
       de demo-evaluatie (0105) en de stand van een suggestie of bezwaar. */
    async fetchPortalProjects() {
      const c = await connect();
      return (await c.query('select id, company_id, partner_id, customer_id, naam, status, created_at, updated_at from portal_projects')).rows;
    },
    async fetchPortalMeasurements() {
      const c = await connect();
      return (await c.query('select id, company_id, partner_id, project_id, customer_id, gemeten_op, totaal_m2, created_at, updated_at from portal_measurements')).rows;
    },
    async fetchPortalQuotes() {
      const c = await connect();
      return (await c.query('select id, company_id, partner_id, customer_id, project_id, nummer, status, totaal, materiaal_verkoop, verstuurd_op, beslist_op, created_at, updated_at from portal_quotes')).rows;
    },
    async fetchPortalInvoices() {
      const c = await connect();
      return (await c.query('select id, company_id, partner_id, project_id, quote_id, customer_id, soort, nummer, status, factuurdatum, totaal, betaald_op, verstuurd_op, created_at, updated_at from portal_invoices')).rows;
    },
    async fetchPortalCustomers() {
      const c = await connect();
      return (await c.query('select id, partner_id, naam, plaats, created_at, updated_at from portal_customers')).rows;
    },
    async fetchPortalCalculations() {
      const c = await connect();
      return (await c.query('select id, company_id, partner_id, project_id, measurement_id, naam, oppervlak_m2, totaal_verkoop, created_at, updated_at from portal_calculations')).rows;
    },
    async updateSalesSuggestion(id, patch) {
      return updateById('sales_suggestions', id, patch);
    },
    async updateObjection(id, patch) {
      return updateById('objections', id, patch);
    },
    async insertDemoEvaluatie(row) {
      return insertRow('demo_evaluaties', row);
    },
    async fetchDemoEvaluaties() {
      const c = await connect();
      return (await c.query('select * from demo_evaluaties')).rows;
    },
    /* De agenda en de opvolgreeksen van Framr.One Sales (0108). */
    async insertSalesAfspraak(row) {
      return insertRow('sales_afspraken', row);
    },
    async fetchSalesAfspraken() {
      const c = await connect();
      return (await c.query('select * from sales_afspraken')).rows;
    },
    async updateSalesAfspraak(id, patch) {
      return updateById('sales_afspraken', id, patch);
    },
    async insertOpvolgreeks(row) {
      return insertRow('sales_opvolgreeksen', row);
    },
    async fetchOpvolgreeksen() {
      const c = await connect();
      return (await c.query('select * from sales_opvolgreeksen')).rows;
    },
    async findOpvolgreeks(companyId, aanleiding) {
      const c = await connect();
      const res = await c.query('select * from sales_opvolgreeksen where company_id = $1 and aanleiding = $2 limit 1', [companyId, aanleiding]);
      return res.rows[0] || null;
    },
    async updateOpvolgreeks(id, patch) {
      return updateById('sales_opvolgreeksen', id, patch);
    },
    /* De accounts van Framr.One Sales (0111). */
    async insertSalesGebruiker(row) {
      return insertRow('sales_gebruikers', row);
    },
    async fetchSalesGebruikers() {
      const c = await connect();
      return (await c.query('select * from sales_gebruikers')).rows;
    },
    async findSalesGebruikerByEmail(companyId, email) {
      const c = await connect();
      const res = await c.query('select * from sales_gebruikers where company_id = $1 and lower(email) = lower($2) limit 1', [companyId, email]);
      return res.rows[0] || null;
    },
    async updateSalesGebruiker(id, patch) {
      return updateById('sales_gebruikers', id, patch);
    },
    /* De werkwijzen met versies en wie ze gezien heeft (0112). */
    async insertSalesWerkwijze(row) {
      return insertRow('sales_werkwijzen', row);
    },
    async fetchSalesWerkwijzen() {
      const c = await connect();
      return (await c.query('select * from sales_werkwijzen')).rows;
    },
    async insertSalesWerkwijzeGezien(row) {
      const c = await connect();
      const res = await c.query(
        'insert into sales_werkwijze_gezien (werkwijze_id, gebruiker_id, person_id) values ($1, $2, $3) on conflict (werkwijze_id, gebruiker_id) do update set gezien_op = now() returning id',
        [row.werkwijze_id, row.gebruiker_id || null, row.person_id || null],
      );
      return res.rows[0];
    },
    async fetchSalesWerkwijzeGezien() {
      const c = await connect();
      return (await c.query('select * from sales_werkwijze_gezien')).rows;
    },
    /* De verbeterbesluiten uit de weekreview (0113). */
    async insertVerbeterbesluit(row) {
      return insertRow('sales_verbeterbesluiten', row);
    },
    async fetchVerbeterbesluiten() {
      const c = await connect();
      return (await c.query('select * from sales_verbeterbesluiten')).rows;
    },
    async updateVerbeterbesluit(id, patch) {
      return updateById('sales_verbeterbesluiten', id, patch);
    },
    /* De claim op een lead (0107), in een voorwaardelijke update zodat twee bellers die
       tegelijk de volgende lead vragen nooit dezelfde krijgen. */
    async claimLead(id, { door, sinds, verlopenVoor } = {}) {
      const c = await connect();
      const res = await c.query(
        `update sales_leads set in_behandeling_door = $2, in_behandeling_sinds = $3, updated_at = now()
         where id = $1 and (in_behandeling_door is null or in_behandeling_door = $2 or ($4::timestamptz is not null and in_behandeling_sinds < $4))
         returning *`,
        [id, door, sinds, verlopenVoor || null],
      );
      return res.rows[0] || null;
    },
    /* De klok van de database, want de klok van de Mac liep al eens vier dagen achter. */
    async fetchNow() {
      const c = await connect();
      return (await c.query('select now() as nu')).rows[0].nu;
    },

    async close() {
      if (client) await client.end();
      client = null;
    },
  };
  /* Fictieve testbedrijven horen nooit op live; alleen de test-adapter krijgt deze helper. */
  if (!testHelpers) delete adapter.ensureTestCompany;
  return adapter;
}
