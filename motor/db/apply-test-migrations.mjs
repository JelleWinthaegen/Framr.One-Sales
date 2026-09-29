#!/usr/bin/env node
/*
  Jarvis doc-intake dry-run - migrations toepassen op een TESTDATABASE.

  Past alle migrations uit de MIGRATIONS-lijst in volgorde toe op een Postgres-testdatabase,
  zodat de hele factuurroute (staging, review, approve, definitieve tabellen) tegen een echt
  schema getest kan worden. Bevat dezelfde harde guards als de pg-adapter: JARVIS_ENV=test en
  een aparte JARVIS_TEST_DB_URL, nooit de live database. Alle migrations gaan in een transactie:
  alles slaagt, of er wordt teruggedraaid.

  Dit script verandert niets aan productie en wordt niet automatisch gedraaid. Het is bedoeld
  voor een lokale of wegwerp-testdatabase.

  Alternatief via de Supabase CLI (aanrader als beschikbaar):
    supabase start         # lokale Postgres in Docker
    supabase db reset      # draait alle migrations uit supabase/migrations opnieuw

  Gebruik van dit script (zonder Supabase CLI):
    JARVIS_ENV=test JARVIS_TEST_DB_URL=postgres://... node db/apply-test-migrations.mjs

  De guards (assertTestEnv) en de migratielijst (MIGRATIONS) zijn exporteerbaar zodat tests ze
  kunnen controleren zonder een database. main() draait alleen wanneer dit bestand direct wordt
  uitgevoerd, niet wanneer het wordt geimporteerd.

  Stijl: blokcommentaar, geen lange streepjes en geen emoji, conform de projectafspraken.
*/

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const MIGRATIONS_DIR = join(HERE, '..', '..', '..', 'supabase', 'migrations');

/* De migrations in afhankelijkheidsvolgorde. 0006 voegt de definitieve factuurtabellen toe,
   0008 voegt documentbewijs (checksum, herkomst) en de doc_intake -> documents koppeling toe,
   0009 voegt de routing- en categorievelden aan invoices toe, 0010 voegt de
   materiaalverrijkingskolommen aan invoice_lines toe. */
export const MIGRATIONS = [
  '0001_init_mvp_schema.sql',
  '0002_add_inventory_items.sql',
  '0003_add_processing_state.sql',
  '0004_add_processing_runs.sql',
  '0005_add_doc_intake.sql',
  '0006_add_billing_tables.sql',
  '0007_add_learning_mappings.sql',
  '0008_add_document_evidence.sql',
  '0009_add_billing_routing_fields.sql',
  '0010_add_line_enrichment.sql',
  '0011_add_line_project.sql',
  '0012_add_projects.sql',
  '0013_add_billing_status.sql',
  '0014_add_workers_and_hours.sql',
  '0015_add_holidays.sql',
  '0016_add_materials_catalog.sql',
  '0017_add_worker_annual_cost.sql',
  '0018_add_worker_dossier.sql',
  '0019_add_payroll_layer.sql',
  '0020_add_worker_dossier_extras.sql',
  '0021_add_project_hub_foundation.sql',
  '0022_add_worker_leave_and_pay_history.sql',
  '0023_enable_rls_baseline.sql',
  '0024_add_bank_transactions.sql',
  '0025_add_mustad_prices.sql',
  '0026_add_legal_entity_registration.sql',
  '0027_add_scab_sync_index.sql',
  '0028_add_data_class.sql',
  '0029_add_project_review_status.sql',
  '0030_add_vault.sql',
  '0031_simplify_vault.sql',
  '0032_add_snelstart_boekingen.sql',
  '0033_add_planning_and_worker_skills.sql',
  '0034_add_task_project_link.sql',
  '0035_add_person_company_roles.sql',
  '0036_add_worker_person_link.sql',
  '0037_add_project_client_link.sql',
  '0038_add_person_relations.sql',
  '0039_add_task_parent_link.sql',
  '0040_add_billing_contact_person.sql',
  '0041_add_document_person.sql',
  '0042_add_web_review_status.sql',
  '0043_add_task_playbooks.sql',
  '0044_add_ideas.sql',
  '0045_add_task_person.sql',
  '0046_extend_bank_source.sql',
  '0047_extend_processing_state_for_rondegrenzen.sql',
  '0048_add_zaakdossiers.sql',
  '0049_add_nova_price_data.sql',
  '0050_add_partner_portal.sql',
  '0051_add_portal_projects.sql',
  '0052_add_room_floor_name.sql',
  '0053_add_partner_logo.sql',
  '0054_add_portal_price_data.sql',
  '0055_add_portal_billing_docs.sql',
  '0056_add_portal_archive_and_delivery.sql',
  '0057_fix_price_floor_key.sql',
  '0058_grant_portal_reader.sql',
  '0059_add_room_skirting_deduction.sql',
  '0060_add_crm_foundation.sql',
  '0061_add_company_research.sql',
  '0062_add_portal_partial_billing.sql',
  '0063_add_task_categorie.sql',
  '0064_add_project_kind_and_lifecycle.sql',
  '0065_finish_project_kind.sql',
  '0066_add_task_soort_and_aan_zet.sql',
  '0067_add_work_preparation.sql',
  '0068_add_project_drive_folder.sql',
  '0069_add_work_specification.sql',
  '0070_add_task_reminder_delivery.sql',
  '0071_add_project_groep.sql',
  '0072_add_project_volgorde.sql',
  '0073_add_lead_werk.sql',
  '0074_add_project_kladblok.sql',
  '0075_add_task_kopje.sql',
  '0076_add_partner_auth_identity.sql',
  '0077_add_measurement_frames.sql',
  /* LET OP: 0078 tot en met 0085 staan bewust nog niet in deze lijst. Ze zijn op
     30-08-2026 achteraf in git gezet terwijl hun tabellen al op live draaiden, en ze
     zijn nooit in volgorde op een verse database beproefd. Zie het migratielogboek. */
  '0086_add_watermark_ids.sql',
  '0087_add_routine_switches.sql',
  '0088_add_task_routines.sql',
  '0089_add_task_reminder_id.sql',
  '0099_add_portal_price_baseline.sql',
  '0100_add_floor_shopify_link.sql',
  '0101_add_tool_prices.sql',
  '0102_add_partner_release.sql',
  '0103_add_partner_customer_origin.sql',
  '0104_add_interaction_recording_consent.sql',
  '0105_add_demo_evaluations.sql',
  '0106_add_interaction_ai_analysis.sql',
  '0107_add_sales_workflow_fields.sql',
  '0108_add_sales_afspraken_and_opvolgreeksen.sql',
  '0109_add_contactreden_and_service_tasks.sql',
  '0110_add_service_leveringen.sql',
  '0111_add_sales_gebruikers.sql',
  '0112_add_sales_werkwijzen.sql',
  '0113_add_verbeterbesluiten_and_werkgebied.sql',
  '0114_add_room_skirting_manual.sql',
  '0115_add_gesprek_afhaak_en_onboarding.sql',
];

/*
  Harde guards. Retourneert de test-URL. Weigert buiten test-mode, zonder testdatabase, of als
  de testdatabase gelijk is aan de live database.
*/
export function assertTestEnv(env) {
  if (env.JARVIS_ENV !== 'test') {
    throw new Error('Vereist JARVIS_ENV=test. Dit script raakt nooit een niet-test omgeving.');
  }
  const url = env.JARVIS_TEST_DB_URL;
  if (!url) {
    throw new Error('Zet JARVIS_TEST_DB_URL naar een wegwerp- of testdatabase.');
  }
  if (env.JARVIS_DB_URL && url === env.JARVIS_DB_URL) {
    throw new Error('JARVIS_TEST_DB_URL mag niet gelijk zijn aan de live JARVIS_DB_URL.');
  }
  return url;
}

/*
  Geeft de absolute paden van de migrations in volgorde. Faalt als een bestand ontbreekt, zodat
  een onvolledige set niet half wordt toegepast.
*/
export function migrationPaths(dir = MIGRATIONS_DIR) {
  return MIGRATIONS.map((name) => {
    const path = join(dir, name);
    if (!existsSync(path)) {
      throw new Error(`Migration ontbreekt: ${name}. Verwacht in ${dir}.`);
    }
    return { name, path };
  });
}

/*
  Past alle migrations toe op de testdatabase in een transactie (alles of niets). Exporteerbaar
  zodat setup-test-db het kan hergebruiken zonder een apart proces te starten. log is een
  optionele callback (default stil), zodat het CLI-pad wel meldt en het hergebruik-pad niet hoeft.
  Retourneert de toegepaste migration-namen.
*/
export async function applyMigrations({ env = process.env, log = () => {} } = {}) {
  const url = assertTestEnv(env);
  const paths = migrationPaths();

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
    await client.query('begin');
    for (const { name, path } of paths) {
      const sql = readFileSync(path, 'utf8');
      log(`Toepassen: ${name}`);
      await client.query(sql);
    }
    await client.query('commit');
    return { applied: paths.map((p) => p.name) };
  } catch (err) {
    try { await client.query('rollback'); } catch { /* verbinding al weg */ }
    throw err;
  } finally {
    await client.end();
  }
}

async function main() {
  const { applied } = await applyMigrations({ env: process.env, log: (m) => process.stdout.write(`${m}\n`) });
  process.stdout.write(`Alle ${applied.length} migrations uit de lijst toegepast op de testdatabase.\n`);
}

/* main() draait alleen bij directe uitvoering, niet bij import (zodat tests veilig importeren). */
const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  main().catch((err) => {
    process.stderr.write(`Fout: ${err.message}\n`);
    process.exitCode = 1;
  });
}
