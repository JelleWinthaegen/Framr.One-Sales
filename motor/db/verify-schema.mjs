#!/usr/bin/env node
/*
  Jarvis doc-intake dry-run - structurele schema-verificatie van de TESTDATABASE.

  Read-only controle dat de testdatabase alle verwachte tabellen, kernkolommen en de
  dedup-/trace-indexes uit de migrations 0001 tot en met 0008 bevat. Introspecteert
  information_schema en pg_indexes; doet geen writes. Dezelfde harde guards als de pg-adapter:
  JARVIS_ENV=test en een aparte JARVIS_TEST_DB_URL, nooit de live database.

  In mock-mode (PIPELINE_DB=mock of geen JARVIS_TEST_DB_URL) is er geen schema om te controleren;
  de verificatie wordt dan met een duidelijke melding overgeslagen.

  Gebruik:
    JARVIS_ENV=test JARVIS_TEST_DB_URL=postgres://... npm run verify:schema:test
    npm run verify:schema:mock   (overslaan, geen database)

  De verwachte structuur en verifySchema zijn exporteerbaar zodat tests ze kunnen gebruiken.

  Stijl: blokcommentaar, geen lange streepjes en geen emoji, conform de projectafspraken.
*/

import { pathToFileURL } from 'node:url';
import { assertTestEnv } from './apply-test-migrations.mjs?v=5dd6073';

/* Alle tabellen die de migrations 0001 tot en met 0008 aanmaken. */
export const EXPECTED_TABLES = [
  'companies', 'people', 'legal_entities', 'company_operating_manuals',
  'documents', 'document_summaries', 'wiki_pages', 'memory_items', 'decisions', 'tasks',
  'session_summaries', 'business_processes', 'inventory_items', 'processing_state',
  'processing_runs', 'doc_intake', 'invoices', 'invoice_lines', 'invoice_tax_lines',
  'learning_mappings', 'projects', 'project_aliases',
  'workers', 'worker_aliases', 'day_entries', 'work_allocations', 'holidays', 'materials',
  'worker_annual_cost',
  'worker_personalia', 'worker_employment', 'worker_remuneration', 'departments',
  'payroll_runs', 'payroll_payments', 'payroll_tax_filings',
  'worker_vehicles', 'worker_certificates', 'worker_documents', 'worker_issued_items',
  'worker_leave_balances', 'worker_absences', 'worker_annual_statements', 'worker_period_pay',
  'bank_transactions',
  'credentials',
  'snelstart_boekingen',
  'planning_entries', 'worker_skills',
  'person_company_roles', 'person_relations',
  'task_playbooks',
  'ideas',
  'dossiers', 'dossier_items', 'dossier_betrokkenen',
  'portal_partners', 'portal_work_templates', 'portal_customers',
  'portal_quotes', 'portal_quote_lines', 'portal_orders',
  'portal_projects', 'portal_measurements', 'portal_measurement_rooms', 'portal_calculations',
  'portal_price_sources', 'portal_price_tiers', 'portal_price_floors', 'portal_price_supplies',
  'portal_invoices', 'portal_invoice_lines', 'portal_documents',
  /* Het CRM-fundament (0060) en de Company Research-engine (0061). Zonder deze
     regels stond de verify groen terwijl het CRM ontbrak: hij telde alleen wat
     hij al kende (zelfde les als de portaalkolommen hierboven). */
  'pipeline_fases', 'sales_veldopties', 'sales_leads', 'lead_people',
  'interactions', 'discovery_answers', 'questions', 'objections',
  'opportunities', 'crm_weetjes', 'sales_suggestions', 'crm_triggers',
  'lead_sources', 'lead_facts', 'lead_research', 'lead_classifications',
  'supplier_locations', 'lead_relations', 'campaigns', 'sales_queue',
  /* De demo-evaluatie per onderdeel (0105). */
  'demo_evaluaties',
  /* De agenda en de opvolgreeksen van Framr.One Sales (0108). */
  'sales_afspraken', 'sales_opvolgreeksen', 'sales_gebruikers', 'sales_werkwijzen', 'sales_werkwijze_gezien', 'sales_verbeterbesluiten',
];

/* Kernkolommen die de factuurroute en het documentbewijs (0008) nodig hebben. */
export const EXPECTED_COLUMNS = {
  documents: ['content_sha256', 'source_system', 'original_filename', 'storage_path', 'mime_type', 'size_bytes',
    'project_id', 'document_type', 'person_id'],
  doc_intake: ['document_id', 'status', 'dedup_key'],
  legal_entities: ['kvk_number', 'vat_id', 'tax_number'],
  /* De portaalkolommen die pas met 0053 tot en met 0056 kwamen. Zonder ze hier stond de verify
     groen terwijl het portaal niet kon opslaan: hij telde alleen de tabellen die hij al kende. */
  portal_partners: ['logo_data', 'niveau_gecheckt_op', 'iban', 'factuur_prefix', 'levertijd'],
  portal_quotes: ['project_id', 'levertijd', 'verzendkosten'],
  invoices: ['source_doc_intake_id', 'source_run_id', 'approval_run_id', 'approval_status',
    'recipient', 'entity_status', 'entity_id', 'entity_name', 'bouwonderdeel_code', 'kostensoort_code',
    'spans_multiple_projects', 'project_id', 'payment_status', 'billing_disposition', 'billed_status',
    'contact_person_id'],
  invoice_lines: ['invoice_id', 'normalized_description', 'material_category', 'material_subcategory', 'enrichment_status',
    'needs_review', 'learned_from_mapping_id', 'project_ref', 'project_match_status', 'project_id', 'material_id'],
  invoice_tax_lines: ['invoice_id'],
  processing_state: ['processed_until_datetime', 'source_key'],
  learning_mappings: ['mapping_type', 'normalized_input_value', 'corrected_value'],
  credentials: ['label', 'category', 'secret'],
  projects: ['company_id', 'canonical_key', 'display_name', 'owner_name', 'status', 'review_status', 'created_from', 'project_type', 'regie_uurtarief', 'client_person_id'],
  project_aliases: ['company_id', 'project_id', 'alias', 'normalized_alias', 'alias_type'],
  workers: ['company_id', 'name', 'normalized_name', 'cost_per_hour', 'active', 'scab_employee_number',
    'department_id', 'worker_kind', 'works_saturday', 'inzet_via', 'inzet_note', 'person_id'],
  snelstart_boekingen: ['company_id', 'administratie', 'soort', 'snelstart_id', 'datum', 'bedrag_ontvangen', 'bedrag_uitgegeven'],
  planning_entries: ['company_id', 'worker_id', 'plan_date', 'slot', 'project_id', 'description', 'status'],
  worker_skills: ['company_id', 'worker_id', 'skill', 'normalized_skill', 'level'],
  person_company_roles: ['person_id', 'company_id', 'role', 'is_primary', 'review_status'],
  person_relations: ['from_person_id', 'to_person_id', 'relation', 'normalized_relation', 'review_status'],
  people: ['company_id', 'name', 'review_status'],
  tasks: ['company_id', 'title', 'status', 'priority', 'assignee', 'project_id', 'parent_task_id', 'playbook_id', 'person_id', 'due_date',
    'opvolg_reeks', 'opvolg_stap', 'resultaat', 'afgerond_op', 'vervangen_door', 'contactreden', 'order_id', 'aangemaakt_door', 'afgerond_door'],
  task_playbooks: ['company_id', 'kind_key', 'kind_label', 'steps', 'keywords', 'evidence_count', 'status', 'review_status'],
  ideas: ['company_id', 'title', 'status', 'uitwerking', 'project_id', 'person_id', 'source'],
  dossiers: ['company_id', 'title', 'status', 'samenvatting', 'volgende_stap', 'review_status', 'afgerond_op', 'source'],
  dossier_items: ['dossier_id', 'company_id', 'item_type', 'item_ref', 'label', 'reden', 'source'],
  dossier_betrokkenen: ['dossier_id', 'person_id', 'rol', 'notes', 'source'],
  worker_annual_cost: ['company_id', 'worker_id', 'year', 'jaarloonkosten', 'geschatte_productieve_uren', 'cost_per_hour'],
  worker_personalia: ['company_id', 'worker_id', 'bsn', 'bankrekening'],
  worker_employment: ['company_id', 'worker_id', 'datum_in_dienst', 'contractsoort'],
  worker_remuneration: ['company_id', 'worker_id', 'cao', 'totaal_brutoloon'],
  departments: ['company_id', 'name'],
  worker_aliases: ['company_id', 'worker_id', 'alias', 'normalized_alias'],
  day_entries: ['company_id', 'worker_id', 'entry_date', 'status', 'reason'],
  work_allocations: ['company_id', 'day_entry_id', 'project_id', 'hours', 'activity'],
  holidays: ['company_id', 'holiday_date', 'name'],
  materials: ['company_id', 'match_key', 'article_code', 'normalized_description', 'category', 'subcategory'],
  payroll_runs: ['company_id', 'year', 'period_maand', 'loonheffing', 'pensioen', 'tijdspaarfonds', 'totale_loonkosten'],
  payroll_payments: ['company_id', 'payment_type', 'payment_date', 'amount', 'source_ref'],
  payroll_tax_filings: ['company_id', 'year', 'period_maand', 'loonheffing_bedrag'],
  worker_vehicles: ['company_id', 'worker_id', 'kenteken', 'ingangsdatum', 'soort_bijtelling', 'cataloguswaarde'],
  worker_certificates: ['company_id', 'worker_id', 'cert_type', 'naam', 'geldig_tot'],
  worker_documents: ['company_id', 'worker_id', 'document_id', 'soort_document', 'onderwerp', 'geldig_tot'],
  worker_issued_items: ['company_id', 'worker_id', 'item', 'uitgereikt_op', 'status'],
  worker_leave_balances: ['company_id', 'worker_id', 'year', 'balance_type', 'eind_saldo'],
  worker_absences: ['company_id', 'worker_id', 'ziekmeldingsdatum', 'hersteldatum', 'verzuim_percentage'],
  worker_annual_statements: ['company_id', 'worker_id', 'year', 'loon_voor_loonheffing', 'ingehouden_loonheffing'],
  worker_period_pay: ['company_id', 'worker_id', 'year', 'period_maand', 'bruto_loon', 'netto_loon', 'totale_werkgeverskosten'],
  bank_transactions: ['company_id', 'account_iban', 'booking_date', 'amount', 'transaction_ref',
    'matched_invoice_id', 'match_status', 'disposition', 'billed_status'],
  sales_leads: ['company_id', 'naam', 'genormaliseerde_naam', 'kvk_nummer', 'rechtsvorm',
    'bel_opt_in', 'tier', 'ai_score', 'review_status', 'in_behandeling_door', 'in_behandeling_sinds', 'gepauzeerd_tot', 'geen_contact_via'],
  interactions: ['company_id', 'lead_id', 'type', 'started_at', 'uitkomst', 'volgende_stap',
    'uitvoerder_type', 'automatisch', 'bijlage_refs', 'volgend_contact_op', 'campaign_id',
    'opname_toestemming', 'opname_bewaren_tot', 'tags', 'ai_analyse', 'ai_verwerkt_op',
    'stap', 'script_ref', 'materiaal', 'link', 'template_ref', 'verzend_status', 'reactie_verwacht', 'reactie_termijn',
    'reactie_ontvangen_op', 'reactie_interaction_id', 'verzoek_id', 'contactreden',
    'afhaakmoment', 'aangeslagen_op', 'onboarding_gedaan', 'blokkade'],
  objections: ['company_id', 'lead_id', 'bezwaar', 'categorie', 'gegeven_reactie', 'reactie_werkte',
    'context', 'reactie_resultaat', 'afspraak', 'vervolgactie', 'soort'],
  sales_afspraken: ['company_id', 'lead_id', 'task_id', 'interaction_id', 'soort', 'start_at', 'duur_minuten', 'vorm', 'status', 'verantwoordelijke'],
  sales_opvolgreeksen: ['company_id', 'aanleiding', 'stappen', 'max_pogingen', 'actief', 'versie'],
  sales_gebruikers: ['company_id', 'person_id', 'email', 'wachtwoord_hash', 'wachtwoord_salt', 'rol', 'werkgebieden', 'rechten', 'voorkeuren', 'actief', 'laatste_inlog'],
  sales_werkwijzen: ['company_id', 'soort', 'ref', 'versie', 'inhoud', 'wat_veranderd', 'waarom', 'wat_anders', 'voor_stappen', 'soort_wijziging', 'geldig_vanaf', 'door', 'actief'],
  sales_werkwijze_gezien: ['werkwijze_id', 'gebruiker_id', 'person_id', 'gezien_op'],
  sales_verbeterbesluiten: ['company_id', 'probleem', 'gegevens', 'wijziging', 'verantwoordelijke', 'ingangsdatum', 'evaluatiedatum', 'werkwijze_id', 'status', 'herkomst', 'uitkomst', 'week_van'],
  lead_sources: ['company_id', 'lead_id', 'broncategorie', 'bron', 'zoekterm', 'url',
    'gevonden_op', 'scraper', 'importbatch', 'ruwe_data_ref'],
  lead_facts: ['company_id', 'lead_id', 'veld', 'waarde', 'waarde_genormaliseerd', 'source_id',
    'betrouwbaarheid', 'waargenomen_op', 'geldig_van', 'geldig_tot'],
  lead_research: ['company_id', 'lead_id', 'versie', 'samenvatting', 'verkoopkansen',
    'bezwaren', 'openingszin', 'scores', 'productmatch', 'model', 'gemaakt_op'],
  lead_classifications: ['company_id', 'lead_id', 'classificatie', 'door', 'reden',
    'waargenomen_op', 'geldig_van', 'geldig_tot'],
  supplier_locations: ['company_id', 'merk', 'soort', 'naam', 'plaats', 'provincie',
    'lat', 'lng', 'collecties', 'actief'],
  lead_relations: ['company_id', 'lead_id', 'relatie_type', 'naar_soort', 'naar_waarde',
    'naar_lead_id', 'naar_person_id', 'naar_location_id', 'source_id', 'geldig_van', 'geldig_tot'],
  campaigns: ['company_id', 'naam', 'doelgroep_filter', 'stappen', 'actief'],
  sales_queue: ['company_id', 'lead_id', 'kanaal_voorstel', 'prioriteit', 'redenen',
    'status', 'campaign_id', 'berekend_op'],
};

/* De dedup- en trace-indexes die migration 0008 toevoegt. */
export const EXPECTED_INDEXES = ['idx_documents_company_sha256', 'idx_doc_intake_document_id'];

export async function verifySchema({ env = process.env } = {}) {
  const url = assertTestEnv(env);

  let pg;
  try {
    pg = (await import('pg')).default;
  } catch {
    throw new Error("De 'pg' driver is niet geinstalleerd. Voer eerst 'npm install' uit in deze map.");
  }

  const isLocal = /(@|\/\/)(localhost|127\.0\.0\.1)/.test(url);
  const client = new pg.Client({ connectionString: url, ssl: isLocal ? false : { rejectUnauthorized: false } });
  await client.connect();
  try {
    const tablesRes = await client.query(
      "select table_name from information_schema.tables where table_schema = 'public'",
    );
    const tables = new Set(tablesRes.rows.map((r) => r.table_name));

    const colsRes = await client.query(
      "select table_name, column_name from information_schema.columns where table_schema = 'public'",
    );
    const colsByTable = new Map();
    for (const r of colsRes.rows) {
      const set = colsByTable.get(r.table_name) || new Set();
      set.add(r.column_name);
      colsByTable.set(r.table_name, set);
    }

    const idxRes = await client.query("select indexname from pg_indexes where schemaname = 'public'");
    const indexes = new Set(idxRes.rows.map((r) => r.indexname));

    const checks = [];

    const missingTables = EXPECTED_TABLES.filter((t) => !tables.has(t));
    checks.push({
      name: 'alle verwachte tabellen aanwezig',
      ok: missingTables.length === 0,
      detail: missingTables.length ? `ontbreekt: ${missingTables.join(', ')}` : `${EXPECTED_TABLES.length} tabellen`,
    });

    const missingColumns = [];
    for (const [table, cols] of Object.entries(EXPECTED_COLUMNS)) {
      const have = colsByTable.get(table) || new Set();
      for (const col of cols) if (!have.has(col)) missingColumns.push(`${table}.${col}`);
    }
    checks.push({
      name: 'kernkolommen aanwezig (inclusief 0008)',
      ok: missingColumns.length === 0,
      detail: missingColumns.length ? `ontbreekt: ${missingColumns.join(', ')}` : 'ok',
    });

    const missingIndexes = EXPECTED_INDEXES.filter((i) => !indexes.has(i));
    checks.push({
      name: 'dedup- en trace-indexes aanwezig (0008)',
      ok: missingIndexes.length === 0,
      detail: missingIndexes.length ? `ontbreekt: ${missingIndexes.join(', ')}` : 'ok',
    });

    const ok = checks.every((c) => c.ok);
    return { ok, checks, counts: { tables: tables.size, expected_tables: EXPECTED_TABLES.length } };
  } finally {
    await client.end();
  }
}

export function buildSchemaReport(result) {
  const out = ['Schema verification', '', `Result: ${result.ok ? 'OK' : 'FOUT'}`];
  for (const c of result.checks) out.push(`- ${c.ok ? 'OK  ' : 'FOUT'} ${c.name} (${c.detail})`);
  return out.join('\n');
}

async function main() {
  const dbKind = process.env.PIPELINE_DB || '';
  if (dbKind === 'mock' || !process.env.JARVIS_TEST_DB_URL) {
    process.stdout.write(
      'Schema verification overgeslagen: mock-mode of geen JARVIS_TEST_DB_URL gezet. ' +
      'De in-memory mock heeft geen database-schema om te controleren.\n',
    );
    return;
  }
  const result = await verifySchema({ env: process.env });
  process.stdout.write(`${buildSchemaReport(result)}\n`);
  if (!result.ok) process.exitCode = 1;
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  main().catch((err) => {
    process.stderr.write(`Fout: ${err.message}\n`);
    process.exitCode = 1;
  });
}
