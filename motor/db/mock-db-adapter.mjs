/*
  Jarvis doc-intake dry-run - mock database-adapter (in-memory).

  Implementeert hetzelfde contract als de echte pg-adapter, maar bewaart rijen in het
  geheugen. Hiermee kan staging_write en de review/approve-laag end-to-end getest worden
  zonder een echte database. Schrijft dus nooit naar Supabase.

  Contract (gedeeld met de pg-adapter):
    Staging (bestaand):
      insertProcessingRun(row)        -> { id }
      insertDocIntake(rows)           -> number (aantal ingevoegd)
    Review en approved_write (nieuw):
      fetchProcessingRuns()           -> rows[]
      fetchDocIntake()                -> rows[]
      getDocIntakeById(id)            -> row | null
      updateDocIntake(id, patch)      -> row | null
    Documentopslag (nieuw):
      insertDocument(row)             -> { id }
      getDocumentBySha256(cid, sha)   -> row | null
      getDocumentById(id)             -> row | null
      fetchDocuments()                -> rows[]
      insertInvoice(row)              -> { id }
      insertInvoiceLines(rows)        -> number
      insertInvoiceTaxLines(rows)     -> number
      fetchInvoices()                 -> rows[]
      fetchInvoiceLines()             -> rows[]
      fetchInvoiceTaxLines()          -> rows[]
    Learning en processed_until (nieuw):
      recordLearningMapping(row)      -> { id, created, evidenceCount } (upsert + evidence bump)
      fetchLearningMappings()         -> rows[]
      findLearningMappings(q)         -> rows[]
      getProcessingState(cid, key)    -> row | null
      upsertProcessedUntil(args)      -> row
      fetchProcessingState()          -> rows[]
    close()                           -> void

  Stijl: blokcommentaar, geen lange streepjes en geen emoji, conform de projectafspraken.
*/

import { randomUUID } from 'node:crypto';

/* Diepe kloon zodat lezers de interne opslag niet per ongeluk muteren. */
function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

/* De jsonb-kolommen komen bij Postgres als array terug en gaan er als tekst in. De mock krijgt
   allebei te zien, dus lees het hier af in plaats van het te veronderstellen. */
function lijstUitJson(waarde) {
  if (Array.isArray(waarde)) return waarde;
  if (typeof waarde !== 'string' || !waarde.trim()) return [];
  try {
    const uit = JSON.parse(waarde);
    return Array.isArray(uit) ? uit : [];
  } catch {
    return [];
  }
}

export function createMockAdapter() {
  /* De opslag is publiek zodat tests de geschreven rijen kunnen controleren. */
  const store = {
    processing_runs: [],
    doc_intake: [],
    routine_switches: [],
    documents: [],
    invoices: [],
    invoice_lines: [],
    invoice_tax_lines: [],
    learning_mappings: [],
    processing_state: [],
    projects: [],
    project_aliases: [],
    workers: [],
    worker_aliases: [],
    day_entries: [],
    work_allocations: [],
    holidays: [],
    materials: [],
    worker_annual_cost: [],
    departments: [],
    worker_personalia: [],
    worker_employment: [],
    worker_remuneration: [],
    payroll_runs: [],
    payroll_payments: [],
    payroll_tax_filings: [],
    worker_vehicles: [],
    worker_certificates: [],
    worker_documents: [],
    worker_issued_items: [],
    worker_leave_balances: [],
    worker_absences: [],
    worker_annual_statements: [],
    worker_period_pay: [],
    companies: [],
    people: [],
    person_company_roles: [],
    person_relations: [],
    task_playbooks: [],
    ideas: [],
    dossiers: [],
    dossier_items: [],
    dossier_betrokkenen: [],
    tasks: [],
    bank_transactions: [],
    snelstart_boekingen: [],
    planning_entries: [],
    worker_skills: [],
    pipeline_fases: [],
    sales_veldopties: [],
    sales_leads: [],
    lead_people: [],
    interactions: [],
    discovery_answers: [],
    questions: [],
    objections: [],
    opportunities: [],
    /* Belronde (crm/belronde-store.mjs): de research-tabellen uit 0061, de werkvoorraad,
       weetjes, suggesties en de portaaltabellen die het dashboard leest. */
    lead_research: [],
    lead_classifications: [],
    lead_facts: [],
    lead_sources: [],
    sales_queue: [],
    crm_weetjes: [],
    sales_suggestions: [],
    portal_partners: [],
    portal_orders: [],
    portal_projects: [],
    portal_measurements: [],
    portal_quotes: [],
    portal_invoices: [],
    portal_customers: [],
    portal_calculations: [],
    demo_evaluaties: [],
    sales_afspraken: [],
    sales_opvolgreeksen: [],
    sales_gebruikers: [],
    sales_werkwijzen: [],
    sales_werkwijze_gezien: [],
    sales_verbeterbesluiten: [],
  };

  /*
    Transactie op de in-memory store: snapshot vooraf, en bij een fout wordt de store in
    place hersteld (dezelfde object-identiteit, want tests houden een referentie naar store).
    Zo gedraagt de mock zich als de pg-adapter: een fout halverwege laat niets achter.
  */
  let inTransaction = false;

  async function withTransaction(fn) {
    if (inTransaction) {
      throw new Error('geneste transactie wordt niet ondersteund; er loopt al een transactie op deze adapter');
    }
    inTransaction = true;
    const snapshot = clone(store);
    try {
      return await fn();
    } catch (err) {
      for (const key of Object.keys(store)) {
        store[key] = snapshot[key] ?? [];
      }
      throw err;
    } finally {
      inTransaction = false;
    }
  }

  return {
    name: 'mock',
    store,

    withTransaction,

    async insertProcessingRun(row) {
      const id = randomUUID();
      store.processing_runs.push({ id, ...row });
      return { id };
    },
    async insertDocIntake(rows) {
      for (const row of rows) {
        store.doc_intake.push({ id: randomUUID(), ...row });
      }
      return rows.length;
    },

    async fetchProcessingRuns() {
      return store.processing_runs.map(clone);
    },
    async fetchDocIntake() {
      return store.doc_intake.map(clone);
    },
    async getDocIntakeById(id) {
      const row = store.doc_intake.find((d) => d.id === id);
      return row ? clone(row) : null;
    },
    /* Spiegel van de pg-adapter: alleen rijen met status duplicate gaan weg. */
    async deleteDocIntakeByIds(ids = []) {
      const teGaan = new Set(ids);
      const verwijderd = [];
      const behouden = store.doc_intake.filter((d) => {
        if (teGaan.has(d.id) && d.status === 'duplicate') { verwijderd.push(d.id); return false; }
        return true;
      });
      /* De array zelf blijft dezelfde; elders wordt hij bij naam vastgehouden. */
      store.doc_intake.length = 0;
      store.doc_intake.push(...behouden);
      return { verwijderd: verwijderd.length, ids: verwijderd };
    },
    async updateDocIntake(id, patch) {
      const row = store.doc_intake.find((d) => d.id === id);
      if (!row) return null;
      Object.assign(row, patch, { updated_at: new Date().toISOString() });
      return clone(row);
    },

    /* Documentopslag: insert met dedup-lookup op content_sha256 binnen een bedrijf. */
    async insertDocument(row) {
      const id = randomUUID();
      const nowIso = new Date().toISOString();
      store.documents.push({ id, created_at: nowIso, updated_at: nowIso, ...row });
      return { id };
    },
    async getDocumentBySha256(companyId, sha) {
      if (sha == null) return null;
      const row = store.documents.find((d) => d.company_id === companyId && d.content_sha256 === sha);
      return row ? clone(row) : null;
    },
    async getDocumentById(id) {
      const row = store.documents.find((d) => d.id === id);
      return row ? clone(row) : null;
    },
    async fetchDocuments() {
      return store.documents.map(clone);
    },
    async updateDocument(id, patch) {
      const row = store.documents.find((d) => d.id === id);
      if (!row) return null;
      Object.assign(row, patch, { updated_at: new Date().toISOString() });
      return clone(row);
    },

    async insertInvoice(row) {
      const id = randomUUID();
      store.invoices.push({ id, ...row });
      return { id };
    },
    async updateInvoice(id, patch) {
      const row = store.invoices.find((i) => i.id === id);
      if (!row) return null;
      Object.assign(row, patch, { updated_at: new Date().toISOString() });
      return clone(row);
    },
    async insertInvoiceLines(rows) {
      for (const row of rows) {
        store.invoice_lines.push({ id: randomUUID(), ...row });
      }
      return rows.length;
    },
    async updateInvoiceLine(id, patch) {
      const row = store.invoice_lines.find((l) => l.id === id);
      if (!row) return null;
      Object.assign(row, patch, { updated_at: new Date().toISOString() });
      return clone(row);
    },
    async insertInvoiceTaxLines(rows) {
      for (const row of rows) {
        store.invoice_tax_lines.push({ id: randomUUID(), ...row });
      }
      return rows.length;
    },
    async fetchInvoices() {
      return store.invoices.map(clone);
    },
    async fetchInvoiceLines() {
      return store.invoice_lines.map(clone);
    },
    async fetchInvoiceTaxLines() {
      return store.invoice_tax_lines.map(clone);
    },

    /* Learning: upsert op de logische sleutel; herhaling hoogt evidence_count op (geen duplicaat). */
    async recordLearningMapping(row) {
      const keyOf = (r) => [r.company_id, r.mapping_type, r.normalized_input_value, r.corrected_value].join('|');
      const nowIso = new Date().toISOString();
      const existing = store.learning_mappings.find((m) => keyOf(m) === keyOf(row));
      if (existing) {
        existing.evidence_count += 1;
        existing.last_seen_at = row.last_seen_at || nowIso;
        existing.updated_at = nowIso;
        return { id: existing.id, created: false, evidenceCount: existing.evidence_count };
      }
      const id = randomUUID();
      const inserted = {
        id,
        ...row,
        evidence_count: row.evidence_count || 1,
        last_seen_at: row.last_seen_at || nowIso,
        created_at: nowIso,
        updated_at: nowIso,
      };
      store.learning_mappings.push(inserted);
      return { id, created: true, evidenceCount: inserted.evidence_count };
    },
    async fetchLearningMappings() {
      return store.learning_mappings.map(clone);
    },
    async findLearningMappings({ companyId, mappingType, normalizedInputValue } = {}) {
      return store.learning_mappings
        .filter((m) => m.company_id === companyId && m.status === 'active'
          && (mappingType == null || m.mapping_type === mappingType)
          && (normalizedInputValue == null || m.normalized_input_value === normalizedInputValue))
        .map(clone);
    },

    /* processed_until via processing_state (uniek per company_id + source_key). */
    /* Spiegel van de pg-adapter: de rondegrens hoort bij (company, ronde, bron), niet bij
       (company, bron). Zie de toelichting daar; de mock hield tot 31-08-2026 maar een rij per
       bron en verborg daarmee dat het op live misging. */
    async getProcessingState(companyId, sourceKey, processKey = 'factuurronde') {
      const row = store.processing_state.find((s) => s.company_id === companyId
        && s.source_key === sourceKey && (s.process_key || 'factuurronde') === processKey);
      return row ? clone(row) : null;
    },
    async upsertProcessedUntil({
      companyId, sourceKey, sourceType = 'other', processKey = 'factuurronde',
      processedUntil, ref = null, ids = null, lastChecked,
    } = {}) {
      const nowIso = new Date().toISOString();
      let row = store.processing_state.find((s) => s.company_id === companyId
        && s.source_key === sourceKey && (s.process_key || 'factuurronde') === processKey);
      if (row) {
        row.processed_until_datetime = processedUntil;
        row.processed_until_ref = ref;
        row.processed_until_ids = ids;
        row.last_checked_datetime = lastChecked || nowIso;
        row.updated_at = nowIso;
        return clone(row);
      }
      row = {
        id: randomUUID(), company_id: companyId, source_key: sourceKey, source_type: sourceType,
        process_key: processKey,
        source_label: null, processed_until_datetime: processedUntil, processed_until_ref: ref,
        processed_until_ids: ids,
        last_checked_datetime: lastChecked || nowIso, status: 'active', confidence: 'estimate',
        sensitivity: 'low', notes: null, created_at: nowIso, updated_at: nowIso,
      };
      store.processing_state.push(row);
      return clone(row);
    },
    /* Spiegel van de pg-adapter voor de uitknop van de routines. */
    async getRoutineSwitch(naam) {
      const row = store.routine_switches.find((r) => r.name === naam);
      return row ? clone(row) : null;
    },
    async fetchRoutineSwitches() {
      return store.routine_switches.map(clone);
    },
    async upsertRoutineSwitch({ naam, aan, reden = null, door = null } = {}) {
      const nowIso = new Date().toISOString();
      let row = store.routine_switches.find((r) => r.name === naam);
      if (row) {
        row.enabled = aan;
        row.reason = reden;
        row.updated_by = door;
        row.updated_at = nowIso;
        return clone(row);
      }
      row = {
        id: randomUUID(), name: naam, enabled: aan, reason: reden, updated_by: door,
        created_at: nowIso, updated_at: nowIso,
      };
      store.routine_switches.push(row);
      return clone(row);
    },
    async fetchProcessingState() {
      return store.processing_state.map(clone);
    },

    /* Projecten en aliassen (Fase B). Identiteit op canonical_key, aliassen op normalized_alias. */
    async insertProject(row) {
      const id = randomUUID();
      const nowIso = new Date().toISOString();
      store.projects.push({ id, created_at: nowIso, updated_at: nowIso, ...row });
      return { id };
    },
    async fetchProjects() {
      return store.projects.map(clone);
    },
    async getProjectById(id) {
      const row = store.projects.find((p) => p.id === id);
      return row ? clone(row) : null;
    },
    /* Spiegel van de pg-adapter: hangt alle verwijzingen van het ene project naar het andere. */
    async reassignProjectReferences(fromId, toId, tables) {
      const verplaatst = {};
      for (const table of tables) {
        const rows = store[table] || [];
        let n = 0;
        for (const row of rows) {
          if (row.project_id === fromId) { row.project_id = toId; n += 1; }
        }
        verplaatst[table] = n;
      }
      return verplaatst;
    },
    async updateProject(id, patch) {
      const row = store.projects.find((p) => p.id === id);
      if (!row) return null;
      Object.assign(row, patch, { updated_at: new Date().toISOString() });
      return clone(row);
    },
    async findProjectByCanonicalKey(companyId, key) {
      if (key == null || key === '') return null;
      const row = store.projects.find((p) => p.company_id === companyId && p.canonical_key === key);
      return row ? clone(row) : null;
    },
    async insertProjectAlias(row) {
      const id = randomUUID();
      store.project_aliases.push({ id, created_at: new Date().toISOString(), ...row });
      return { id };
    },
    async findProjectByAlias(companyId, normalizedAlias) {
      if (!normalizedAlias) return null;
      const alias = store.project_aliases.find((a) => a.company_id === companyId && a.normalized_alias === normalizedAlias);
      if (!alias) return null;
      const row = store.projects.find((p) => p.id === alias.project_id);
      return row ? clone(row) : null;
    },
    async deleteProjectAlias(companyId, normalizedAlias) {
      const i = store.project_aliases.findIndex((a) => a.company_id === companyId && a.normalized_alias === normalizedAlias);
      if (i === -1) return { deleted: 0 };
      store.project_aliases.splice(i, 1);
      return { deleted: 1 };
    },
    async fetchProjectAliases() {
      return store.project_aliases.map(clone);
    },

    /* Uren en personeel (Fase D). */
    async insertWorker(row) {
      const id = randomUUID();
      const nowIso = new Date().toISOString();
      store.workers.push({ id, created_at: nowIso, updated_at: nowIso, active: true, ...row });
      return { id };
    },
    async fetchWorkers() {
      return store.workers.map(clone);
    },
    async getWorkerById(id) {
      const row = store.workers.find((w) => w.id === id);
      return row ? clone(row) : null;
    },
    async updateWorker(id, patch) {
      const row = store.workers.find((w) => w.id === id);
      if (!row) return null;
      Object.assign(row, patch, { updated_at: new Date().toISOString() });
      return clone(row);
    },
    async findWorkerByNormalizedName(companyId, normalizedName) {
      if (!normalizedName) return null;
      const row = store.workers.find((w) => w.company_id === companyId && w.normalized_name === normalizedName);
      return row ? clone(row) : null;
    },
    async insertWorkerAlias(row) {
      const id = randomUUID();
      store.worker_aliases.push({ id, created_at: new Date().toISOString(), ...row });
      return { id };
    },
    async findWorkerByAlias(companyId, normalizedAlias) {
      if (!normalizedAlias) return null;
      const alias = store.worker_aliases.find((a) => a.company_id === companyId && a.normalized_alias === normalizedAlias);
      if (!alias) return null;
      const row = store.workers.find((w) => w.id === alias.worker_id);
      return row ? clone(row) : null;
    },
    async fetchWorkerAliases() {
      return store.worker_aliases.map(clone);
    },
    async insertDayEntry(row) {
      const id = randomUUID();
      const nowIso = new Date().toISOString();
      store.day_entries.push({ id, created_at: nowIso, updated_at: nowIso, ...row });
      return { id };
    },
    async findDayEntry(companyId, workerId, entryDate) {
      const row = store.day_entries.find(
        (d) => d.company_id === companyId && d.worker_id === workerId && d.entry_date === entryDate,
      );
      return row ? clone(row) : null;
    },
    async updateDayEntry(id, patch) {
      const row = store.day_entries.find((d) => d.id === id);
      if (!row) return null;
      Object.assign(row, patch, { updated_at: new Date().toISOString() });
      return clone(row);
    },
    async fetchDayEntries() {
      return store.day_entries.map(clone);
    },
    async insertWorkAllocation(row) {
      const id = randomUUID();
      const nowIso = new Date().toISOString();
      store.work_allocations.push({ id, created_at: nowIso, updated_at: nowIso, ...row });
      return { id };
    },
    async fetchWorkAllocations() {
      return store.work_allocations.map(clone);
    },
    async insertHoliday(row) {
      const id = randomUUID();
      store.holidays.push({ id, created_at: new Date().toISOString(), ...row });
      return { id };
    },
    async fetchHolidays() {
      return store.holidays.map(clone);
    },
    async findHoliday(companyId, holidayDate) {
      const row = store.holidays.find((h) => h.company_id === companyId && h.holiday_date === holidayDate);
      return row ? clone(row) : null;
    },

    /* Planninglaag en vaardigheden (migration 0033). */
    async insertPlanningEntry(row) {
      const id = randomUUID();
      const nowIso = new Date().toISOString();
      store.planning_entries.push({ id, created_at: nowIso, updated_at: nowIso, ...row });
      return { id };
    },
    async findPlanningEntryByKey(companyId, workerId, planDate, slot) {
      const row = store.planning_entries.find(
        (p) => p.company_id === companyId && p.worker_id === workerId
          && p.plan_date === planDate && p.slot === slot,
      );
      return row ? clone(row) : null;
    },
    async fetchPlanningEntriesForDay(companyId, workerId, planDate) {
      return store.planning_entries
        .filter((p) => p.company_id === companyId && p.worker_id === workerId && p.plan_date === planDate)
        .map(clone);
    },
    async updatePlanningEntry(id, patch) {
      const row = store.planning_entries.find((p) => p.id === id);
      if (!row) return null;
      Object.assign(row, patch, { updated_at: new Date().toISOString() });
      return clone(row);
    },
    async fetchPlanningEntries() {
      return store.planning_entries.map(clone);
    },
    async insertWorkerSkill(row) {
      const id = randomUUID();
      const nowIso = new Date().toISOString();
      store.worker_skills.push({ id, created_at: nowIso, updated_at: nowIso, ...row });
      return { id };
    },
    async findWorkerSkillByKey(companyId, workerId, normalizedSkill) {
      const row = store.worker_skills.find(
        (s) => s.company_id === companyId && s.worker_id === workerId && s.normalized_skill === normalizedSkill,
      );
      return row ? clone(row) : null;
    },
    async updateWorkerSkill(id, patch) {
      const row = store.worker_skills.find((s) => s.id === id);
      if (!row) return null;
      Object.assign(row, patch, { updated_at: new Date().toISOString() });
      return clone(row);
    },
    async fetchWorkerSkills() {
      return store.worker_skills.map(clone);
    },

    /* Producten- en materialencatalogus (Fase F). */
    async insertMaterial(row) {
      const id = randomUUID();
      const nowIso = new Date().toISOString();
      store.materials.push({ id, created_at: nowIso, updated_at: nowIso, ...row });
      return { id };
    },
    async fetchMaterials() {
      return store.materials.map(clone);
    },
    async getMaterialById(id) {
      const row = store.materials.find((m) => m.id === id);
      return row ? clone(row) : null;
    },
    async findMaterialByMatchKey(companyId, matchKey) {
      if (!matchKey) return null;
      const row = store.materials.find((m) => m.company_id === companyId && m.match_key === matchKey);
      return row ? clone(row) : null;
    },
    async updateMaterial(id, patch) {
      const row = store.materials.find((m) => m.id === id);
      if (!row) return null;
      Object.assign(row, patch, { updated_at: new Date().toISOString() });
      return clone(row);
    },

    /* Jaarlijkse loonkosten per medewerker (uurtarief-blok, M5.2). */
    async insertWorkerAnnualCost(row) {
      const id = randomUUID();
      const nowIso = new Date().toISOString();
      store.worker_annual_cost.push({ id, created_at: nowIso, updated_at: nowIso, ...row });
      return { id };
    },
    async fetchWorkerAnnualCosts() {
      return store.worker_annual_cost.map(clone);
    },
    async findWorkerAnnualCost(companyId, workerId, year) {
      const row = store.worker_annual_cost.find(
        (c) => c.company_id === companyId && c.worker_id === workerId && Number(c.year) === Number(year),
      );
      return row ? clone(row) : null;
    },
    async updateWorkerAnnualCost(id, patch) {
      const row = store.worker_annual_cost.find((c) => c.id === id);
      if (!row) return null;
      Object.assign(row, patch, { updated_at: new Date().toISOString() });
      return clone(row);
    },

    /* Personeelsdossier (SCAB HRM): afdelingen en de drie 1:1-satelliettabellen. */
    async insertDepartment(row) {
      const id = randomUUID();
      const nowIso = new Date().toISOString();
      store.departments.push({ id, created_at: nowIso, updated_at: nowIso, ...row });
      return { id };
    },
    async fetchDepartments() {
      return store.departments.map(clone);
    },
    async findDepartmentByName(companyId, name) {
      if (!name) return null;
      const row = store.departments.find((d) => d.company_id === companyId && d.name === name);
      return row ? clone(row) : null;
    },
    async updateDepartment(id, patch) {
      const row = store.departments.find((d) => d.id === id);
      if (!row) return null;
      Object.assign(row, patch, { updated_at: new Date().toISOString() });
      return clone(row);
    },

    async insertWorkerPersonalia(row) {
      const id = randomUUID();
      const nowIso = new Date().toISOString();
      store.worker_personalia.push({ id, created_at: nowIso, updated_at: nowIso, ...row });
      return { id };
    },
    async fetchWorkerPersonalias() {
      return store.worker_personalia.map(clone);
    },
    async findWorkerPersonaliaByWorker(companyId, workerId) {
      const row = store.worker_personalia.find((p) => p.company_id === companyId && p.worker_id === workerId);
      return row ? clone(row) : null;
    },
    async updateWorkerPersonalia(id, patch) {
      const row = store.worker_personalia.find((p) => p.id === id);
      if (!row) return null;
      Object.assign(row, patch, { updated_at: new Date().toISOString() });
      return clone(row);
    },

    async insertWorkerEmployment(row) {
      const id = randomUUID();
      const nowIso = new Date().toISOString();
      store.worker_employment.push({ id, created_at: nowIso, updated_at: nowIso, ...row });
      return { id };
    },
    async fetchWorkerEmployments() {
      return store.worker_employment.map(clone);
    },
    async findWorkerEmploymentByWorker(companyId, workerId) {
      const row = store.worker_employment.find((e) => e.company_id === companyId && e.worker_id === workerId);
      return row ? clone(row) : null;
    },
    async updateWorkerEmployment(id, patch) {
      const row = store.worker_employment.find((e) => e.id === id);
      if (!row) return null;
      Object.assign(row, patch, { updated_at: new Date().toISOString() });
      return clone(row);
    },

    async insertWorkerRemuneration(row) {
      const id = randomUUID();
      const nowIso = new Date().toISOString();
      store.worker_remuneration.push({ id, created_at: nowIso, updated_at: nowIso, ...row });
      return { id };
    },
    async fetchWorkerRemunerations() {
      return store.worker_remuneration.map(clone);
    },
    async findWorkerRemunerationByWorker(companyId, workerId) {
      const row = store.worker_remuneration.find((r) => r.company_id === companyId && r.worker_id === workerId);
      return row ? clone(row) : null;
    },
    async updateWorkerRemuneration(id, patch) {
      const row = store.worker_remuneration.find((r) => r.id === id);
      if (!row) return null;
      Object.assign(row, patch, { updated_at: new Date().toISOString() });
      return clone(row);
    },

    /* Periodieke loonlaag (SCAB Loonverwerking, Overgemaakte bedragen, Loonaangifte). */
    async insertPayrollRun(row) {
      const id = randomUUID();
      const nowIso = new Date().toISOString();
      store.payroll_runs.push({ id, created_at: nowIso, updated_at: nowIso, ...row });
      return { id };
    },
    async fetchPayrollRuns() {
      return store.payroll_runs.map(clone);
    },
    async findPayrollRunByPeriod(companyId, year, maand) {
      const row = store.payroll_runs.find(
        (r) => r.company_id === companyId && Number(r.year) === Number(year) && Number(r.period_maand) === Number(maand),
      );
      return row ? clone(row) : null;
    },
    async updatePayrollRun(id, patch) {
      const row = store.payroll_runs.find((r) => r.id === id);
      if (!row) return null;
      Object.assign(row, patch, { updated_at: new Date().toISOString() });
      return clone(row);
    },

    async insertPayrollPayment(row) {
      const id = randomUUID();
      const nowIso = new Date().toISOString();
      store.payroll_payments.push({ id, created_at: nowIso, updated_at: nowIso, ...row });
      return { id };
    },
    async fetchPayrollPayments() {
      return store.payroll_payments.map(clone);
    },
    async findPayrollPaymentBySourceRef(companyId, sourceRef) {
      if (sourceRef == null) return null;
      const row = store.payroll_payments.find((p) => p.company_id === companyId && p.source_ref === sourceRef);
      return row ? clone(row) : null;
    },
    async updatePayrollPayment(id, patch) {
      const row = store.payroll_payments.find((p) => p.id === id);
      if (!row) return null;
      Object.assign(row, patch, { updated_at: new Date().toISOString() });
      return clone(row);
    },

    async insertPayrollTaxFiling(row) {
      const id = randomUUID();
      const nowIso = new Date().toISOString();
      store.payroll_tax_filings.push({ id, created_at: nowIso, updated_at: nowIso, ...row });
      return { id };
    },
    async fetchPayrollTaxFilings() {
      return store.payroll_tax_filings.map(clone);
    },
    async findPayrollTaxFilingByPeriod(companyId, year, maand, volgnummer) {
      const row = store.payroll_tax_filings.find(
        (f) => f.company_id === companyId && Number(f.year) === Number(year)
          && Number(f.period_maand) === Number(maand) && Number(f.volgnummer) === Number(volgnummer),
      );
      return row ? clone(row) : null;
    },
    async updatePayrollTaxFiling(id, patch) {
      const row = store.payroll_tax_filings.find((f) => f.id === id);
      if (!row) return null;
      Object.assign(row, patch, { updated_at: new Date().toISOString() });
      return clone(row);
    },

    /* Personeelsdossier 1:N-satellieten (SCAB HRM): autos, certificaten, documenten, uitgereikte
       middelen. null-veilige sleutelvergelijking (null gelijk aan null), gelijk aan het pg is-not-distinct. */
    async insertWorkerVehicle(row) {
      const id = randomUUID();
      const nowIso = new Date().toISOString();
      store.worker_vehicles.push({ id, created_at: nowIso, updated_at: nowIso, ...row });
      return { id };
    },
    async fetchWorkerVehiclesByWorker(companyId, workerId) {
      return store.worker_vehicles.filter((v) => v.company_id === companyId && v.worker_id === workerId).map(clone);
    },
    async fetchWorkerVehicles() {
      return store.worker_vehicles.map(clone);
    },
    async findWorkerVehicleByKey(companyId, workerId, kenteken, ingangsdatum) {
      const row = store.worker_vehicles.find((v) => v.company_id === companyId && v.worker_id === workerId
        && (v.kenteken ?? null) === (kenteken ?? null) && (v.ingangsdatum ?? null) === (ingangsdatum ?? null));
      return row ? clone(row) : null;
    },
    async updateWorkerVehicle(id, patch) {
      const row = store.worker_vehicles.find((v) => v.id === id);
      if (!row) return null;
      Object.assign(row, patch, { updated_at: new Date().toISOString() });
      return clone(row);
    },

    async insertWorkerCertificate(row) {
      const id = randomUUID();
      const nowIso = new Date().toISOString();
      store.worker_certificates.push({ id, created_at: nowIso, updated_at: nowIso, ...row });
      return { id };
    },
    async fetchWorkerCertificatesByWorker(companyId, workerId) {
      return store.worker_certificates.filter((c) => c.company_id === companyId && c.worker_id === workerId).map(clone);
    },
    async findWorkerCertificateByKey(companyId, workerId, certType, naam, geldigTot) {
      const row = store.worker_certificates.find((c) => c.company_id === companyId && c.worker_id === workerId
        && (c.cert_type ?? null) === (certType ?? null) && (c.naam ?? null) === (naam ?? null)
        && (c.geldig_tot ?? null) === (geldigTot ?? null));
      return row ? clone(row) : null;
    },
    async updateWorkerCertificate(id, patch) {
      const row = store.worker_certificates.find((c) => c.id === id);
      if (!row) return null;
      Object.assign(row, patch, { updated_at: new Date().toISOString() });
      return clone(row);
    },

    async insertWorkerDocument(row) {
      const id = randomUUID();
      const nowIso = new Date().toISOString();
      store.worker_documents.push({ id, created_at: nowIso, updated_at: nowIso, ...row });
      return { id };
    },
    async fetchWorkerDocumentsByWorker(companyId, workerId) {
      return store.worker_documents.filter((d) => d.company_id === companyId && d.worker_id === workerId).map(clone);
    },
    async findWorkerDocumentByKey(companyId, workerId, soortDocument, onderwerp) {
      const row = store.worker_documents.find((d) => d.company_id === companyId && d.worker_id === workerId
        && (d.soort_document ?? null) === (soortDocument ?? null) && (d.onderwerp ?? null) === (onderwerp ?? null));
      return row ? clone(row) : null;
    },
    async updateWorkerDocument(id, patch) {
      const row = store.worker_documents.find((d) => d.id === id);
      if (!row) return null;
      Object.assign(row, patch, { updated_at: new Date().toISOString() });
      return clone(row);
    },

    async insertWorkerIssuedItem(row) {
      const id = randomUUID();
      const nowIso = new Date().toISOString();
      store.worker_issued_items.push({ id, created_at: nowIso, updated_at: nowIso, ...row });
      return { id };
    },
    async fetchWorkerIssuedItemsByWorker(companyId, workerId) {
      return store.worker_issued_items.filter((i) => i.company_id === companyId && i.worker_id === workerId).map(clone);
    },
    async findWorkerIssuedItemByKey(companyId, workerId, item, uitgereiktOp) {
      const row = store.worker_issued_items.find((i) => i.company_id === companyId && i.worker_id === workerId
        && (i.item ?? null) === (item ?? null) && (i.uitgereikt_op ?? null) === (uitgereiktOp ?? null));
      return row ? clone(row) : null;
    },
    async updateWorkerIssuedItem(id, patch) {
      const row = store.worker_issued_items.find((i) => i.id === id);
      if (!row) return null;
      Object.assign(row, patch, { updated_at: new Date().toISOString() });
      return clone(row);
    },

    /* Verlof, verzuim, jaaropgaven en loonstrook-detail (loonmotor compleet, migration 0022).
       null-veilige sleutelvergelijking, gelijk aan het pg is-not-distinct. */
    async insertWorkerLeaveBalance(row) {
      const id = randomUUID();
      const nowIso = new Date().toISOString();
      store.worker_leave_balances.push({ id, created_at: nowIso, updated_at: nowIso, ...row });
      return { id };
    },
    async fetchWorkerLeaveBalancesByWorker(companyId, workerId) {
      return store.worker_leave_balances.filter((b) => b.company_id === companyId && b.worker_id === workerId).map(clone);
    },
    async findWorkerLeaveBalanceByKey(companyId, workerId, year, balanceType) {
      const row = store.worker_leave_balances.find((b) => b.company_id === companyId && b.worker_id === workerId
        && Number(b.year) === Number(year) && (b.balance_type ?? null) === (balanceType ?? null));
      return row ? clone(row) : null;
    },
    async updateWorkerLeaveBalance(id, patch) {
      const row = store.worker_leave_balances.find((b) => b.id === id);
      if (!row) return null;
      Object.assign(row, patch, { updated_at: new Date().toISOString() });
      return clone(row);
    },

    async insertWorkerAbsence(row) {
      const id = randomUUID();
      const nowIso = new Date().toISOString();
      store.worker_absences.push({ id, created_at: nowIso, updated_at: nowIso, ...row });
      return { id };
    },
    async fetchWorkerAbsencesByWorker(companyId, workerId) {
      return store.worker_absences.filter((a) => a.company_id === companyId && a.worker_id === workerId).map(clone);
    },
    async findWorkerAbsenceByKey(companyId, workerId, ziekmeldingsdatum) {
      const row = store.worker_absences.find((a) => a.company_id === companyId && a.worker_id === workerId
        && (a.ziekmeldingsdatum ?? null) === (ziekmeldingsdatum ?? null));
      return row ? clone(row) : null;
    },
    async updateWorkerAbsence(id, patch) {
      const row = store.worker_absences.find((a) => a.id === id);
      if (!row) return null;
      Object.assign(row, patch, { updated_at: new Date().toISOString() });
      return clone(row);
    },

    async insertWorkerAnnualStatement(row) {
      const id = randomUUID();
      const nowIso = new Date().toISOString();
      store.worker_annual_statements.push({ id, created_at: nowIso, updated_at: nowIso, ...row });
      return { id };
    },
    async fetchWorkerAnnualStatementsByWorker(companyId, workerId) {
      return store.worker_annual_statements.filter((s) => s.company_id === companyId && s.worker_id === workerId).map(clone);
    },
    async findWorkerAnnualStatementByKey(companyId, workerId, year) {
      const row = store.worker_annual_statements.find((s) => s.company_id === companyId && s.worker_id === workerId
        && Number(s.year) === Number(year));
      return row ? clone(row) : null;
    },
    async updateWorkerAnnualStatement(id, patch) {
      const row = store.worker_annual_statements.find((s) => s.id === id);
      if (!row) return null;
      Object.assign(row, patch, { updated_at: new Date().toISOString() });
      return clone(row);
    },

    async insertWorkerPeriodPay(row) {
      const id = randomUUID();
      const nowIso = new Date().toISOString();
      store.worker_period_pay.push({ id, created_at: nowIso, updated_at: nowIso, ...row });
      return { id };
    },
    async fetchWorkerPeriodPayByWorker(companyId, workerId) {
      return store.worker_period_pay.filter((p) => p.company_id === companyId && p.worker_id === workerId).map(clone);
    },
    async findWorkerPeriodPayByKey(companyId, workerId, year, maand) {
      const row = store.worker_period_pay.find((p) => p.company_id === companyId && p.worker_id === workerId
        && Number(p.year) === Number(year) && Number(p.period_maand) === Number(maand));
      return row ? clone(row) : null;
    },
    async updateWorkerPeriodPay(id, patch) {
      const row = store.worker_period_pay.find((p) => p.id === id);
      if (!row) return null;
      Object.assign(row, patch, { updated_at: new Date().toISOString() });
      return clone(row);
    },

    /* Mapping-lifecycle (blok 8): geleerde mappings kunnen verouderen (supersede/retire). */
    async findLearningMappingById(id) {
      const row = store.learning_mappings.find((m) => m.id === id);
      return row ? clone(row) : null;
    },
    async updateLearningMapping(id, patch) {
      const row = store.learning_mappings.find((m) => m.id === id);
      if (!row) return null;
      Object.assign(row, patch, { updated_at: new Date().toISOString() });
      return clone(row);
    },

    /* Kennislaag (blok 8): beslissingen, memory en sessieverslagen uit het MVP-schema. */
    async insertDecision(row) {
      const id = randomUUID();
      const nowIso = new Date().toISOString();
      store.decisions = store.decisions || [];
      store.decisions.push({ id, created_at: nowIso, updated_at: nowIso, ...row });
      return { id };
    },
    async findDecisionByTitle(companyId, normalizedTitle) {
      const row = (store.decisions || []).find((d) => d.company_id === companyId
        && String(d.title || '').trim().toLowerCase() === normalizedTitle);
      return row ? clone(row) : null;
    },
    async fetchDecisions() {
      return (store.decisions || []).map(clone);
    },
    async updateDecision(id, patch) {
      const row = (store.decisions || []).find((d) => d.id === id);
      if (!row) return null;
      Object.assign(row, patch, { updated_at: new Date().toISOString() });
      return clone(row);
    },
    async insertMemoryItem(row) {
      const id = randomUUID();
      const nowIso = new Date().toISOString();
      store.memory_items = store.memory_items || [];
      store.memory_items.push({ id, created_at: nowIso, updated_at: nowIso, ...row });
      return { id };
    },
    async insertWikiPage(row) {
      const id = randomUUID();
      const nowIso = new Date().toISOString();
      store.wiki_pages = store.wiki_pages || [];
      store.wiki_pages.push({ id, created_at: nowIso, updated_at: nowIso, ...row });
      return { id };
    },
    async findWikiPageBySlug(companyId, slug) {
      const row = (store.wiki_pages || []).find((w) => w.company_id === companyId
        && String(w.slug) === String(slug));
      return row ? clone(row) : null;
    },
    async fetchWikiPages() {
      return (store.wiki_pages || []).map(clone);
    },
    async updateWikiPage(id, patch) {
      const row = (store.wiki_pages || []).find((w) => w.id === id);
      if (!row) return null;
      Object.assign(row, patch, { updated_at: new Date().toISOString() });
      return clone(row);
    },
    async fetchWikiPagesByCompany(companyId) {
      return (store.wiki_pages || []).filter((w) => w.company_id === companyId).map(clone);
    },
    async fetchMemoryItemsByCompany(companyId) {
      return (store.memory_items || []).filter((m) => m.company_id === companyId).map(clone);
    },
    async updateMemoryItem(id, patch) {
      const row = (store.memory_items || []).find((m) => m.id === id);
      if (!row) return null;
      Object.assign(row, patch, { updated_at: new Date().toISOString() });
      return clone(row);
    },
    async updateCompany(id, patch) {
      const row = store.companies.find((c) => c.id === id);
      if (!row) return null;
      Object.assign(row, patch, { updated_at: new Date().toISOString() });
      return clone(row);
    },
    async insertOperatingManual(row) {
      const id = randomUUID();
      const nowIso = new Date().toISOString();
      store.company_operating_manuals = store.company_operating_manuals || [];
      store.company_operating_manuals.push({ id, created_at: nowIso, updated_at: nowIso, ...row });
      return { id };
    },
    async findActiveOperatingManual(companyId) {
      const row = (store.company_operating_manuals || []).find((m) => m.company_id === companyId
        && m.is_active === true);
      return row ? clone(row) : null;
    },
    async fetchOperatingManuals(companyId = null) {
      const rows = store.company_operating_manuals || [];
      return rows.filter((m) => companyId == null || m.company_id === companyId).map(clone);
    },
    async updateOperatingManual(id, patch) {
      const row = (store.company_operating_manuals || []).find((m) => m.id === id);
      if (!row) return null;
      Object.assign(row, patch, { updated_at: new Date().toISOString() });
      return clone(row);
    },
    async findMemoryItemByContent(companyId, normalizedContent) {
      const row = (store.memory_items || []).find((m) => m.company_id === companyId
        && String(m.content || '').trim().toLowerCase() === normalizedContent);
      return row ? clone(row) : null;
    },
    async fetchMemoryItems() {
      return (store.memory_items || []).map(clone);
    },
    async insertSessionSummary(row) {
      const id = randomUUID();
      const nowIso = new Date().toISOString();
      store.session_summaries = store.session_summaries || [];
      store.session_summaries.push({ id, created_at: nowIso, updated_at: nowIso, ...row });
      return { id };
    },
    async findSessionSummaryByDate(companyId, sessionDate) {
      const row = (store.session_summaries || []).find((s) => s.company_id === companyId
        && String(s.session_date) === String(sessionDate));
      return row ? clone(row) : null;
    },
    async fetchSessionSummaries() {
      return (store.session_summaries || []).map(clone);
    },
    async updateSessionSummary(id, patch) {
      const row = (store.session_summaries || []).find((s) => s.id === id);
      if (!row) return null;
      Object.assign(row, patch, { updated_at: new Date().toISOString() });
      return clone(row);
    },
    /* Aanvullen in plaats van vervangen; zie de uitleg bij de pg-adapter. Hier is het een
       gewone bewerking, want de mock kent maar een schrijver tegelijk. Geen rij gevonden
       betekent ook hier: er was er nog geen. */
    async appendSessionSummary(companyId, sessionDate, {
      summaryDeel, nextStepsDeel = null, scheiding = '\n\n',
      decisionsMade = [], tasksTouched = [],
    } = {}) {
      const row = (store.session_summaries || []).find((s) => s.company_id === companyId
        && s.session_date === sessionDate);
      if (!row) return null;
      row.summary = `${row.summary}${scheiding}${summaryDeel}`;
      if (nextStepsDeel != null) {
        row.next_steps = row.next_steps && String(row.next_steps).trim()
          ? `${row.next_steps}${scheiding}${nextStepsDeel}`
          : nextStepsDeel;
      }
      row.decisions_made = JSON.stringify([
        ...lijstUitJson(row.decisions_made), ...(decisionsMade || []),
      ]);
      row.tasks_touched = JSON.stringify([
        ...lijstUitJson(row.tasks_touched), ...(tasksTouched || []),
      ]);
      row.updated_at = new Date().toISOString();
      return clone(row);
    },

    /* Companies en taken (taken-laag, blok 7). De context van een taak is het bedrijf. */
    async insertCompany(row) {
      const id = row.id || randomUUID();
      const nowIso = new Date().toISOString();
      store.companies.push({ id, created_at: nowIso, updated_at: nowIso, ...row, id });
      return { id };
    },
    async findCompanyBySlug(slug) {
      const row = store.companies.find((c) => c.slug === slug);
      return row ? clone(row) : null;
    },
    async insertTask(row) {
      const id = randomUUID();
      const nowIso = new Date().toISOString();
      store.tasks.push({ id, created_at: nowIso, updated_at: nowIso, ...row });
      return { id };
    },
    async findTaskByTitle(companyId, normalizedTitle) {
      const row = store.tasks.find((t) => t.company_id === companyId
        && String(t.title || '').trim().toLowerCase() === normalizedTitle);
      return row ? clone(row) : null;
    },
    async fetchTasks() {
      return store.tasks.map(clone);
    },
    async deleteTask(id) {
      const i = store.tasks.findIndex((t) => t.id === id);
      if (i === -1) return { deleted: 0 };
      store.tasks.splice(i, 1);
      return { deleted: 1 };
    },
    async updateTask(id, patch) {
      const row = store.tasks.find((t) => t.id === id);
      if (!row) return null;
      Object.assign(row, patch, { updated_at: new Date().toISOString() });
      return clone(row);
    },

    /* Personen-laag (0035): people als anker plus person_company_roles (rol per bedrijf). */
    async insertPerson(row) {
      const id = randomUUID();
      const nowIso = new Date().toISOString();
      store.people.push({ id, created_at: nowIso, updated_at: nowIso, ...row });
      return { id };
    },
    async findPersonByName(companyId, normalizedName) {
      const row = store.people.find((p) => p.company_id === companyId
        && String(p.name || '').trim().toLowerCase() === normalizedName);
      return row ? clone(row) : null;
    },
    async fetchPeople() {
      return store.people.map(clone);
    },
    async updatePerson(id, patch) {
      const row = store.people.find((p) => p.id === id);
      if (!row) return null;
      Object.assign(row, patch, { updated_at: new Date().toISOString() });
      return clone(row);
    },
    async insertPersonCompanyRole(row) {
      const id = randomUUID();
      const nowIso = new Date().toISOString();
      store.person_company_roles.push({ id, is_primary: false, created_at: nowIso, updated_at: nowIso, ...row });
      return { id };
    },
    async findPersonCompanyRole(personId, companyId, role) {
      const row = store.person_company_roles.find((r) => r.person_id === personId
        && r.company_id === companyId && r.role === role);
      return row ? clone(row) : null;
    },
    async fetchPersonCompanyRoles() {
      return store.person_company_roles.map(clone);
    },
    async updatePersonCompanyRole(id, patch) {
      const row = store.person_company_roles.find((r) => r.id === id);
      if (!row) return null;
      Object.assign(row, patch, { updated_at: new Date().toISOString() });
      return clone(row);
    },
    async deletePersonCompanyRole(personId, companyId, role) {
      const i = store.person_company_roles.findIndex((r) => r.person_id === personId
        && r.company_id === companyId && r.role === role);
      if (i === -1) return { deleted: 0 };
      store.person_company_roles.splice(i, 1);
      return { deleted: 1 };
    },
    async insertPersonRelation(row) {
      const id = randomUUID();
      const nowIso = new Date().toISOString();
      store.person_relations.push({ id, created_at: nowIso, updated_at: nowIso, ...row });
      return { id };
    },
    async findPersonRelation(fromPersonId, toPersonId, normalizedRelation) {
      const row = store.person_relations.find((r) => r.from_person_id === fromPersonId
        && r.to_person_id === toPersonId && r.normalized_relation === normalizedRelation);
      return row ? clone(row) : null;
    },
    async fetchPersonRelations() {
      return store.person_relations.map(clone);
    },
    async updatePersonRelation(id, patch) {
      const row = store.person_relations.find((r) => r.id === id);
      if (!row) return null;
      Object.assign(row, patch, { updated_at: new Date().toISOString() });
      return clone(row);
    },
    async deletePersonRelation(fromPersonId, toPersonId, normalizedRelation) {
      const i = store.person_relations.findIndex((r) => r.from_person_id === fromPersonId
        && r.to_person_id === toPersonId && r.normalized_relation === normalizedRelation);
      if (i === -1) return { deleted: 0 };
      store.person_relations.splice(i, 1);
      return { deleted: 1 };
    },

    /* Ideeën (migration 0044): idempotent per bedrijf op de genormaliseerde titel. */
    async insertIdea(row) {
      const id = randomUUID();
      const nowIso = new Date().toISOString();
      store.ideas.push({ id, status: 'nieuw', created_at: nowIso, updated_at: nowIso, ...row });
      return { id };
    },
    async findIdeaByTitle(companyId, normalizedTitle) {
      const row = store.ideas.find((i) => i.company_id === companyId
        && String(i.title || '').trim().toLowerCase() === normalizedTitle);
      return row ? clone(row) : null;
    },
    async fetchIdeas() {
      return store.ideas.map(clone);
    },
    async updateIdea(id, patch) {
      const row = store.ideas.find((i) => i.id === id);
      if (!row) return null;
      Object.assign(row, patch, { updated_at: new Date().toISOString() });
      return clone(row);
    },
    async deleteIdea(id) {
      const i = store.ideas.findIndex((r) => r.id === id);
      if (i === -1) return { deleted: 0 };
      store.ideas.splice(i, 1);
      return { deleted: 1 };
    },

    /* Zaakdossiers (migration 0048): idempotent per bedrijf op de genormaliseerde titel;
       items uniek op (dossier, item_type, item_ref), betrokkenen op (dossier, persoon). */
    async insertDossier(row) {
      const id = randomUUID();
      const nowIso = new Date().toISOString();
      store.dossiers.push({
        id, status: 'open', review_status: 'confirmed',
        created_at: nowIso, updated_at: nowIso, ...row,
      });
      return { id };
    },
    async findDossierByTitle(companyId, normalizedTitle) {
      const row = store.dossiers.find((d) => d.company_id === companyId
        && String(d.title || '').trim().toLowerCase() === normalizedTitle);
      return row ? clone(row) : null;
    },
    async fetchDossiers() {
      return store.dossiers.map(clone);
    },
    async updateDossier(id, patch) {
      const row = store.dossiers.find((d) => d.id === id);
      if (!row) return null;
      Object.assign(row, patch, { updated_at: new Date().toISOString() });
      return clone(row);
    },
    async deleteDossier(id) {
      const i = store.dossiers.findIndex((d) => d.id === id);
      if (i === -1) return { deleted: 0 };
      store.dossiers.splice(i, 1);
      return { deleted: 1 };
    },
    async insertDossierItem(row) {
      const id = randomUUID();
      const nowIso = new Date().toISOString();
      store.dossier_items.push({ id, created_at: nowIso, updated_at: nowIso, ...row });
      return { id };
    },
    async findDossierItemByRef(dossierId, itemType, itemRef) {
      const row = store.dossier_items.find((i) => i.dossier_id === dossierId
        && i.item_type === itemType && i.item_ref === itemRef);
      return row ? clone(row) : null;
    },
    async fetchDossierItems() {
      return store.dossier_items.map(clone);
    },
    async insertDossierBetrokkene(row) {
      const id = randomUUID();
      const nowIso = new Date().toISOString();
      store.dossier_betrokkenen.push({ id, created_at: nowIso, updated_at: nowIso, ...row });
      return { id };
    },
    async findDossierBetrokkene(dossierId, personId) {
      const row = store.dossier_betrokkenen.find((b) => b.dossier_id === dossierId
        && b.person_id === personId);
      return row ? clone(row) : null;
    },
    async fetchDossierBetrokkenen() {
      return store.dossier_betrokkenen.map(clone);
    },
    async updateDossierBetrokkene(id, patch) {
      const row = store.dossier_betrokkenen.find((b) => b.id === id);
      if (!row) return null;
      Object.assign(row, patch, { updated_at: new Date().toISOString() });
      return clone(row);
    },

    /* Taak-draaiboeken (migration 0043): uniek op (company, kind_key). */
    async insertTaskPlaybook(row) {
      const id = randomUUID();
      const nowIso = new Date().toISOString();
      store.task_playbooks.push({
        id, evidence_count: 1, status: 'active', review_status: 'confirmed',
        steps: [], keywords: [], last_seen_at: nowIso,
        created_at: nowIso, updated_at: nowIso, ...row,
      });
      return { id };
    },
    async findTaskPlaybookByKind(companyId, kindKey) {
      const row = store.task_playbooks.find((p) => p.company_id === companyId && p.kind_key === kindKey);
      return row ? clone(row) : null;
    },
    async fetchTaskPlaybooks() {
      return store.task_playbooks.map(clone);
    },
    async updateTaskPlaybook(id, patch) {
      const row = store.task_playbooks.find((p) => p.id === id);
      if (!row) return null;
      Object.assign(row, patch, { updated_at: new Date().toISOString() });
      return clone(row);
    },

    /* Bankafschriften (M3): idempotent op (company, rekening, transactieref). */
    async insertBankTransaction(row) {
      const id = randomUUID();
      const nowIso = new Date().toISOString();
      store.bank_transactions.push({
        id, match_status: 'unmatched', created_at: nowIso, updated_at: nowIso, ...row,
      });
      return { id };
    },
    async findBankTransactionByRef(companyId, accountIban, transactionRef) {
      const row = store.bank_transactions.find((t) => t.company_id === companyId
        && t.account_iban === accountIban && t.transaction_ref === transactionRef);
      return row ? clone(row) : null;
    },
    async findBankTransactionById(id) {
      const row = store.bank_transactions.find((t) => t.id === id);
      return row ? clone(row) : null;
    },
    async fetchBankTransactions() {
      return store.bank_transactions.map(clone);
    },
    async updateBankTransaction(id, patch) {
      const row = store.bank_transactions.find((t) => t.id === id);
      if (!row) return null;
      Object.assign(row, patch, { updated_at: new Date().toISOString() });
      return clone(row);
    },

    /* SnelStart-synclaag (M5.10): idempotent op (company, administratie, soort, snelstart_id). */
    async insertSnelstartBoeking(row) {
      const id = randomUUID();
      const nowIso = new Date().toISOString();
      store.snelstart_boekingen.push({ id, created_at: nowIso, updated_at: nowIso, ...row });
      return { id };
    },
    async findSnelstartBoekingByBron(companyId, administratie, soort, snelstartId) {
      const row = store.snelstart_boekingen.find((b) => b.company_id === companyId
        && b.administratie === administratie && b.soort === soort && b.snelstart_id === snelstartId);
      return row ? clone(row) : null;
    },
    async fetchSnelstartBoekingen() {
      return store.snelstart_boekingen.map(clone);
    },
    async updateSnelstartBoeking(id, patch) {
      const row = store.snelstart_boekingen.find((b) => b.id === id);
      if (!row) return null;
      Object.assign(row, patch, { updated_at: new Date().toISOString() });
      return clone(row);
    },

    /* CRM-fundament (migration 0060): een bedrijf bestaat exact een keer per context;
       config (fasen, waardelijsten) is data per company, geen code. De mock spiegelt de
       database-defaults zodat de store zich in tests gedraagt als op de echte database. */
    async insertPipelineFase(row) {
      const id = randomUUID();
      store.pipeline_fases.push({
        id, pipeline: 'acquisitie', is_eindfase: false,
        created_at: new Date().toISOString(), ...row,
      });
      return { id };
    },
    async findPipelineFase(companyId, pipeline, naam) {
      const row = store.pipeline_fases.find((f) => f.company_id === companyId
        && f.pipeline === pipeline && f.naam === naam);
      return row ? clone(row) : null;
    },
    async fetchPipelineFases() {
      return store.pipeline_fases
        .map(clone)
        .sort((a, b) => (a.pipeline === b.pipeline
          ? a.volgorde - b.volgorde
          : String(a.pipeline).localeCompare(String(b.pipeline))));
    },
    async insertVeldoptie(row) {
      const id = randomUUID();
      store.sales_veldopties.push({ id, actief: true, created_at: new Date().toISOString(), ...row });
      return { id };
    },
    async findVeldoptie(companyId, veld, waarde) {
      const row = store.sales_veldopties.find((o) => o.company_id === companyId
        && o.veld === veld && o.waarde === waarde);
      return row ? clone(row) : null;
    },
    async fetchVeldopties() {
      return store.sales_veldopties.map(clone);
    },
    async insertLead(row) {
      const id = randomUUID();
      const nowIso = new Date().toISOString();
      store.sales_leads.push({
        id, land: 'NL', review_status: 'confirmed',
        created_at: nowIso, updated_at: nowIso, ...row,
      });
      return { id };
    },
    async getLeadById(id) {
      const row = store.sales_leads.find((l) => l.id === id);
      return row ? clone(row) : null;
    },
    async findLeadByKvk(companyId, kvkNummer) {
      const row = store.sales_leads.find((l) => l.company_id === companyId
        && l.kvk_nummer === kvkNummer);
      return row ? clone(row) : null;
    },
    async findLeadByBtw(companyId, btwNummer) {
      const row = store.sales_leads.find((l) => l.company_id === companyId
        && l.btw_nummer === btwNummer);
      return row ? clone(row) : null;
    },
    async findLeadByDomein(companyId, domein) {
      const row = store.sales_leads.find((l) => l.company_id === companyId
        && l.domein === domein);
      return row ? clone(row) : null;
    },
    async findLeadByNaamPlaats(companyId, genormaliseerdeNaam, plaats) {
      const row = store.sales_leads.find((l) => l.company_id === companyId
        && l.genormaliseerde_naam === genormaliseerdeNaam
        && String(l.plaats || '') === String(plaats || ''));
      return row ? clone(row) : null;
    },
    async fetchLeads() {
      return store.sales_leads.map(clone);
    },
    async updateLead(id, patch) {
      const row = store.sales_leads.find((l) => l.id === id);
      if (!row) return null;
      Object.assign(row, patch, { updated_at: new Date().toISOString() });
      return clone(row);
    },
    async insertLeadPerson(row) {
      const id = randomUUID();
      store.lead_people.push({ id, is_primair: false, created_at: new Date().toISOString(), ...row });
      return { id };
    },
    async findLeadPerson(leadId, personId) {
      const row = store.lead_people.find((p) => p.lead_id === leadId && p.person_id === personId);
      return row ? clone(row) : null;
    },
    async fetchLeadPeople() {
      return store.lead_people.map(clone);
    },
    async updateLeadPerson(id, patch) {
      const row = store.lead_people.find((p) => p.id === id);
      if (!row) return null;
      Object.assign(row, patch);
      return clone(row);
    },
    async insertInteraction(row) {
      const id = randomUUID();
      store.interactions.push({
        id, richting: 'uitgaand', review_status: 'confirmed',
        created_at: new Date().toISOString(), ...row,
      });
      return { id };
    },
    async fetchInteractions() {
      return store.interactions
        .map(clone)
        .sort((a, b) => String(b.started_at).localeCompare(String(a.started_at)));
    },
    async insertDiscoveryAnswer(row) {
      const id = randomUUID();
      store.discovery_answers.push({
        id, zekerheid: 'bevestigd', herkomst: 'beller',
        created_at: new Date().toISOString(), ...row,
      });
      return { id };
    },
    async findDiscoveryAnswer(interactionId, veld) {
      const row = store.discovery_answers.find((a) => a.interaction_id === interactionId
        && a.veld === veld);
      return row ? clone(row) : null;
    },
    async updateDiscoveryAnswer(id, patch) {
      const row = store.discovery_answers.find((a) => a.id === id);
      if (!row) return null;
      Object.assign(row, patch);
      return clone(row);
    },
    async fetchDiscoveryAnswers() {
      return store.discovery_answers.map(clone);
    },
    async insertQuestion(row) {
      const id = randomUUID();
      store.questions.push({ id, created_at: new Date().toISOString(), ...row });
      return { id };
    },
    async fetchQuestions() {
      return store.questions.map(clone);
    },
    async insertObjection(row) {
      const id = randomUUID();
      store.objections.push({ id, created_at: new Date().toISOString(), ...row });
      return { id };
    },
    async fetchObjections() {
      return store.objections.map(clone);
    },
    async insertOpportunity(row) {
      const id = randomUUID();
      const nowIso = new Date().toISOString();
      store.opportunities.push({
        id, stage: 'aanstaand', created_at: nowIso, updated_at: nowIso, ...row,
      });
      return { id };
    },
    async findOpportunityByNaam(companyId, leadId, naam) {
      const wanted = String(naam || '').trim().toLowerCase();
      const row = store.opportunities.find((o) => o.company_id === companyId
        && o.lead_id === leadId && String(o.naam || '').trim().toLowerCase() === wanted);
      return row ? clone(row) : null;
    },
    async fetchOpportunities() {
      return store.opportunities.map(clone);
    },
    async updateOpportunity(id, patch) {
      const row = store.opportunities.find((o) => o.id === id);
      if (!row) return null;
      Object.assign(row, patch, { updated_at: new Date().toISOString() });
      return clone(row);
    },

    /* Belronde (crm/belronde-store.mjs) en gespreksverwerking: de leeslaag over de
       research-tabellen (0061), de werkvoorraad sales_queue, weetjes, suggesties en het
       portaal. Dezelfde vormen als de pg-adapter, zodat mock en pg hetzelfde antwoorden. */
    async fetchLeadResearch() {
      return store.lead_research.map(clone);
    },
    async insertLeadResearch(row) {
      const id = randomUUID();
      store.lead_research.push({ id, versie: 1, gemaakt_op: new Date().toISOString(), ...row });
      return { id };
    },
    async fetchLeadClassifications() {
      return store.lead_classifications.map(clone);
    },
    async insertLeadClassification(row) {
      const id = randomUUID();
      store.lead_classifications.push({ id, door: 'mens', geldig_tot: null, created_at: new Date().toISOString(), ...row });
      return { id };
    },
    async fetchLeadFacts() {
      return store.lead_facts.map(clone);
    },
    async insertLeadFact(row) {
      const id = randomUUID();
      store.lead_facts.push({ id, geldig_tot: null, created_at: new Date().toISOString(), ...row });
      return { id };
    },
    async fetchLeadSources() {
      return store.lead_sources.map(clone);
    },
    async insertLeadSource(row) {
      const id = randomUUID();
      store.lead_sources.push({ id, created_at: new Date().toISOString(), ...row });
      return { id };
    },
    async insertSalesQueue(row) {
      const id = randomUUID();
      store.sales_queue.push({
        id, kanaal_voorstel: 'call', prioriteit: 50, status: 'wachtrij',
        berekend_op: new Date().toISOString(), ...row,
      });
      return { id };
    },
    async fetchSalesQueue() {
      return store.sales_queue.map(clone);
    },
    async updateSalesQueue(id, patch) {
      const row = store.sales_queue.find((q) => q.id === id);
      if (!row) return null;
      Object.assign(row, patch);
      return clone(row);
    },
    async updateInteraction(id, patch) {
      const row = store.interactions.find((i) => i.id === id);
      if (!row) return null;
      Object.assign(row, patch);
      return clone(row);
    },
    async insertCrmWeetje(row) {
      const id = randomUUID();
      store.crm_weetjes.push({ id, review_status: 'provisional', created_at: new Date().toISOString(), ...row });
      return { id };
    },
    async fetchCrmWeetjes() {
      return store.crm_weetjes.map(clone);
    },
    async insertSalesSuggestion(row) {
      const id = randomUUID();
      const nowIso = new Date().toISOString();
      store.sales_suggestions.push({ id, status: 'voorgesteld', created_at: nowIso, updated_at: nowIso, ...row });
      return { id };
    },
    async fetchSalesSuggestions() {
      return store.sales_suggestions.map(clone);
    },
    async fetchPortalPartners() {
      return store.portal_partners.map(clone);
    },
    async fetchPortalOrders() {
      return store.portal_orders.map(clone);
    },
    async updatePortalOrder(id, patch) {
      const row = store.portal_orders.find((o) => o.id === id);
      if (!row) return null;
      Object.assign(row, patch);
      return clone(row);
    },
    /* Het dashboard van de belronde leest de portaaltabellen voor de partneractivatie en
       schrijft de demo-evaluatie (0105) en de stand van een suggestie of bezwaar. */
    async fetchPortalProjects() {
      return store.portal_projects.map(clone);
    },
    async fetchPortalMeasurements() {
      return store.portal_measurements.map(clone);
    },
    async fetchPortalQuotes() {
      return store.portal_quotes.map(clone);
    },
    async fetchPortalInvoices() {
      return store.portal_invoices.map(clone);
    },
    async fetchPortalCustomers() {
      return store.portal_customers.map(clone);
    },
    async fetchPortalCalculations() {
      return store.portal_calculations.map(clone);
    },
    async updateSalesSuggestion(id, patch) {
      const row = store.sales_suggestions.find((x) => x.id === id);
      if (!row) return null;
      Object.assign(row, patch, { updated_at: new Date().toISOString() });
      return clone(row);
    },
    async updateObjection(id, patch) {
      const row = store.objections.find((x) => x.id === id);
      if (!row) return null;
      Object.assign(row, patch);
      return clone(row);
    },
    async insertDemoEvaluatie(row) {
      const id = randomUUID();
      store.demo_evaluaties.push({ id, created_at: new Date().toISOString(), ...row });
      return { id };
    },
    async fetchDemoEvaluaties() {
      return store.demo_evaluaties.map(clone);
    },
    /* De agenda en de opvolgreeksen van Framr.One Sales (0108). */
    async insertSalesAfspraak(row) {
      const id = randomUUID();
      const nowIso = new Date().toISOString();
      store.sales_afspraken.push({ id, soort: 'demo', status: 'gepland', created_at: nowIso, updated_at: nowIso, ...row });
      return { id };
    },
    async fetchSalesAfspraken() {
      return store.sales_afspraken.map(clone);
    },
    async updateSalesAfspraak(id, patch) {
      const row = store.sales_afspraken.find((a) => a.id === id);
      if (!row) return null;
      Object.assign(row, patch, { updated_at: new Date().toISOString() });
      return clone(row);
    },
    async insertOpvolgreeks(row) {
      const id = randomUUID();
      const nowIso = new Date().toISOString();
      store.sales_opvolgreeksen.push({ id, actief: true, versie: 1, created_at: nowIso, updated_at: nowIso, ...row });
      return { id };
    },
    async fetchOpvolgreeksen() {
      return store.sales_opvolgreeksen.map(clone);
    },
    async findOpvolgreeks(companyId, aanleiding) {
      const row = store.sales_opvolgreeksen.find((r) => r.company_id === companyId && r.aanleiding === aanleiding);
      return row ? clone(row) : null;
    },
    async updateOpvolgreeks(id, patch) {
      const row = store.sales_opvolgreeksen.find((r) => r.id === id);
      if (!row) return null;
      Object.assign(row, patch, { updated_at: new Date().toISOString() });
      return clone(row);
    },
    /* De accounts van Framr.One Sales (0111). */
    async insertSalesGebruiker(row) {
      const id = randomUUID();
      const nowIso = new Date().toISOString();
      if (store.sales_gebruikers.some((g) => g.company_id === row.company_id && String(g.email).toLowerCase() === String(row.email).toLowerCase())) throw new Error(`er bestaat al een account met ${row.email}`);
      store.sales_gebruikers.push({ id, rol: 'sales', werkgebieden: [], rechten: [], voorkeuren: {}, actief: true, created_at: nowIso, updated_at: nowIso, ...row });
      return { id };
    },
    async fetchSalesGebruikers() {
      return store.sales_gebruikers.map(clone);
    },
    async findSalesGebruikerByEmail(companyId, email) {
      const row = store.sales_gebruikers.find((g) => g.company_id === companyId && String(g.email).toLowerCase() === String(email || '').toLowerCase());
      return row ? clone(row) : null;
    },
    async updateSalesGebruiker(id, patch) {
      const row = store.sales_gebruikers.find((g) => g.id === id);
      if (!row) return null;
      Object.assign(row, patch, { updated_at: new Date().toISOString() });
      return clone(row);
    },
    /* De werkwijzen met versies en wie ze gezien heeft (0112). */
    async insertSalesWerkwijze(row) {
      const id = randomUUID();
      store.sales_werkwijzen.push({ id, versie: 1, inhoud: {}, voor_stappen: [], soort_wijziging: 'inhoudelijk', actief: true, created_at: new Date().toISOString(), ...row });
      return { id };
    },
    async fetchSalesWerkwijzen() {
      return store.sales_werkwijzen.map(clone);
    },
    async insertSalesWerkwijzeGezien(row) {
      const bestaand = store.sales_werkwijze_gezien.find((g) => g.werkwijze_id === row.werkwijze_id && g.gebruiker_id === row.gebruiker_id);
      if (bestaand) return { id: bestaand.id };
      const id = randomUUID();
      store.sales_werkwijze_gezien.push({ id, gezien_op: new Date().toISOString(), ...row });
      return { id };
    },
    async fetchSalesWerkwijzeGezien() {
      return store.sales_werkwijze_gezien.map(clone);
    },
    /* De verbeterbesluiten uit de weekreview (0113). */
    async insertVerbeterbesluit(row) {
      const id = randomUUID();
      const nowIso = new Date().toISOString();
      store.sales_verbeterbesluiten.push({ id, status: 'voorstel', herkomst: 'mens', gegevens: {}, created_at: nowIso, updated_at: nowIso, ...row });
      return { id };
    },
    async fetchVerbeterbesluiten() {
      return store.sales_verbeterbesluiten.map(clone);
    },
    async updateVerbeterbesluit(id, patch) {
      const row = store.sales_verbeterbesluiten.find((b) => b.id === id);
      if (!row) return null;
      Object.assign(row, patch, { updated_at: new Date().toISOString() });
      return clone(row);
    },
    /* De claim op een lead (0107), voorwaardelijk: alleen als niemand anders hem vasthoudt of
       de oude claim verlopen is. Geeft de rij terug bij succes, anders null. */
    async claimLead(id, { door, sinds, verlopenVoor } = {}) {
      const row = store.sales_leads.find((l) => l.id === id);
      if (!row) return null;
      const vrij = !row.in_behandeling_door || row.in_behandeling_door === door
        || (verlopenVoor && row.in_behandeling_sinds && String(row.in_behandeling_sinds) < String(verlopenVoor));
      if (!vrij) return null;
      Object.assign(row, { in_behandeling_door: door, in_behandeling_sinds: sinds, updated_at: new Date().toISOString() });
      return clone(row);
    },
    /* De klok van de database; de mock heeft er geen en geeft de lokale klok. */
    async fetchNow() {
      return new Date().toISOString();
    },

    async close() {
      /* Niets te sluiten voor de mock. */
    },
  };
}
