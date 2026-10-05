/*
  Jarvis - task-store (taken-laag, blok 7 van het totaalbuild-plan).

  De schrijf-laag voor de bestaande tasks-tabel uit het MVP-schema (0001): toevoegen, afvinken,
  status en prioriteit zetten, idempotent op (company, titel). Plus de parser voor het bestaande
  to-do-lijstformaat (jarvis-todo.md, prive en buiten de repo) en het leesbare overzicht
  (vandaag, deze week, later, per context).

  De context van een taak IS het bedrijf: wbw, mrhoof, nova, systeem en persoonlijk zijn slugs
  van companies in Supabase. resolveContextCompany zoekt de company op de slug; zonder
  slug-ondersteuning (mock) valt alles terug op het meegegeven bedrijf.

  Review-first: de import is dry-run tenzij expliciet apply; de echte lijst gaat pas naar de
  live database na de go-live (prive-data). Geen echte lijstinhoud in git of in tests.

  Stijl: blokcommentaar, geen lange streepjes en geen emoji, conform de projectafspraken.
*/

/*
  Normaliseert een taaktitel naar de natuurlijke sleutel (company, titel). Ook voor aanroepers
  die eerst willen weten of een taak al bestaat (adapter.findTaskByTitle verwacht deze vorm).
*/
export function normalizeTaskTitle(s) {
  return String(s == null ? '' : s).trim().toLowerCase();
}

const norm = normalizeTaskTitle;

/* De vaste contexten en hun company-slug in Supabase. */
export const CONTEXT_SLUGS = {
  wbw: 'wbw-projecten',
  mrhoof: 'mrhoof',
  framr: 'framr-one',
  nova: 'framr-one',
  systeem: 'jarvis-system',
  persoonlijk: 'jelle',
};

const PRIORITY_MAP = { hoog: 'high', midden: 'medium', laag: 'low' };

/*
  Zoekt het bedrijf bij een context-slug. Zonder findCompanyBySlug (mock) of onbekende slug valt
  hij terug op fallbackCompanyId, met resolved: false zodat de aanroeper dat kan melden.
*/
export async function resolveContextCompany(adapter, { context, fallbackCompanyId } = {}) {
  const slug = CONTEXT_SLUGS[norm(context)] || null;
  if (slug && adapter.findCompanyBySlug) {
    const company = await adapter.findCompanyBySlug(slug);
    if (company) return { companyId: company.id, slug, resolved: true };
  }
  return { companyId: fallbackCompanyId, slug, resolved: false };
}

/*
  Zet (upsert) een taak. Natuurlijke sleutel: (company_id, titel, genormaliseerd). Een tweede
  aanroep met dezelfde titel werkt status, prioriteit en deadline bij in plaats van te dupliceren,
  zodat de import idempotent is.

  projectId koppelt de taak optioneel aan een project (migration 0034). assigneeId koppelt de taak
  optioneel aan een persoon die hem uitvoert (people, de personen-laag). personId koppelt de taak
  aan de persoon om wie hij draait, zoals aan wie iets is toegezegd (migration 0045); bewust een
  eigen draad naast de uitvoerder. parentTaskId maakt de taak onderdeel van
  een grote taak (migration 0039); een taak kan nooit zijn eigen parent zijn. playbookId koppelt
  de taak aan zijn taaksoort (het draaiboek, migration 0043). Alle vijf worden alleen aangeraakt
  als ze expliciet zijn meegegeven: laat je ze weg, dan blijft een bestaande koppeling ongemoeid
  (een gewone status- of prioriteit-bijwerking wist niets). Geef null om te ontkoppelen.
*/
export async function recordTask(adapter, {
  companyId, title, description = null, status = 'todo', priority = 'medium', dueDate = null, projectId, assigneeId, personId, parentTaskId, playbookId,
} = {}) {
  if (!companyId) throw new Error('recordTask vereist companyId.');
  if (!title || !String(title).trim()) throw new Error('recordTask vereist een titel.');
  const fields = { description, status, priority, due_date: dueDate };
  if (projectId !== undefined) fields.project_id = projectId;
  if (assigneeId !== undefined) fields.assignee = assigneeId;
  if (personId !== undefined) fields.person_id = personId;
  if (parentTaskId !== undefined) fields.parent_task_id = parentTaskId;
  if (playbookId !== undefined) fields.playbook_id = playbookId;
  const existing = await adapter.findTaskByTitle(companyId, norm(title));
  if (existing) {
    if (parentTaskId !== undefined && parentTaskId === existing.id) {
      throw new Error('een taak kan niet zijn eigen grote taak zijn.');
    }
    await adapter.updateTask(existing.id, fields);
    return { id: existing.id, created: false };
  }
  const r = await adapter.insertTask({ company_id: companyId, title: String(title).trim(), ...fields });
  return { id: r.id, created: true };
}

/*
  Verwijdert een taak op titel (correctie-actie): een per ongeluk aangemaakte taak moet echt weg
  kunnen, niet alleen op done. Retourneert null als de taak niet bestaat.
*/
export async function removeTask(adapter, { companyId, title } = {}) {
  if (!companyId) throw new Error('removeTask vereist companyId.');
  const existing = await adapter.findTaskByTitle(companyId, norm(title));
  if (!existing) return null;
  if (!adapter.deleteTask) throw new Error('deze adapter ondersteunt deleteTask niet.');
  await adapter.deleteTask(existing.id);
  return { id: existing.id, deleted: true };
}

/* Vinkt een taak af (status done) op titel. Retourneert null als de taak niet bestaat. */
export async function completeTask(adapter, { companyId, title } = {}) {
  if (!companyId) throw new Error('completeTask vereist companyId.');
  const existing = await adapter.findTaskByTitle(companyId, norm(title));
  if (!existing) return null;
  await adapter.updateTask(existing.id, { status: 'done' });
  return { id: existing.id };
}

/*
  Parser voor het bestaande lijstformaat (jarvis-todo.md):
    - taakregels beginnen met "- [ ]" (open) of "- [x]" (afgerond);
    - een deadline staat als "JJJJ-MM-DD:" vooraan of "(JJJJ-MM-DD)" in de regel;
    - "Prioriteit hoog." en "Context wbw." staan als zinnetjes in de regel;
    - een kop kan een standaardcontext dragen: "(context: wbw)".
  Retourneert [{ title, done, priority, context, dueDate, section }]. Best effort en review-first:
  wat de parser niet herkent blijft gewoon in de titel staan, er valt niets stil weg.
*/
export function parseTodoMarkdown(text) {
  const items = [];
  let sectionContext = null;
  let section = null;
  for (const rawLine of String(text || '').split('\n')) {
    const line = rawLine.trim();
    const heading = line.match(/^#{1,3}\s+(.*)$/);
    if (heading) {
      section = heading[1].trim();
      const ctx = section.match(/\(context:\s*([a-z]+)\)/i);
      sectionContext = ctx ? norm(ctx[1]) : sectionContext;
      continue;
    }
    const task = line.match(/^-\s*\[( |x|X)\]\s*(.+)$/);
    if (!task) continue;
    const done = task[1].toLowerCase() === 'x';
    let body = task[2].trim();

    const dateMatch = body.match(/(\d{4}-\d{2}-\d{2})/);
    const dueDate = dateMatch ? dateMatch[1] : null;

    let priority = null;
    const prioMatch = body.match(/\bprioriteit\s+(hoog|midden|laag)\b\.?/i);
    if (prioMatch) {
      priority = PRIORITY_MAP[norm(prioMatch[1])];
      body = body.replace(prioMatch[0], '').trim();
    }

    let context = sectionContext;
    const ctxMatch = body.match(/\bcontext\s+(wbw|mrhoof|nova|systeem|persoonlijk)\b\.?/i);
    if (ctxMatch) {
      context = norm(ctxMatch[1]);
      body = body.replace(ctxMatch[0], '').trim();
    }

    const title = body.replace(/\s{2,}/g, ' ').replace(/\s+([.,;])/g, '$1').trim();
    items.push({ title, done, priority: priority || 'medium', context, dueDate, section });
  }
  return items;
}

/*
  Importeert een geparste lijst. Dry-run default (apply false): telt en rapporteert alleen.
  Open taken worden idempotent geupsert; afgeronde taken worden overgeslagen (die horen niet
  opnieuw open gezet te worden). Context bepaalt het bedrijf via resolveContextCompany.
*/
export async function importTodoList(adapter, {
  text, fallbackCompanyId, apply = false,
} = {}) {
  if (!fallbackCompanyId) throw new Error('importTodoList vereist fallbackCompanyId.');
  const items = parseTodoMarkdown(text);
  const report = {
    apply, gezien: items.length, toegevoegd: [], bijgewerkt: [], overgeslagenAfgerond: 0,
    contextNietHerleid: [], voorgenomen: [],
  };
  for (const item of items) {
    if (item.done) {
      report.overgeslagenAfgerond += 1;
      continue;
    }
    const resolved = await resolveContextCompany(adapter, { context: item.context, fallbackCompanyId });
    if (item.context && !resolved.resolved) {
      report.contextNietHerleid.push(`${item.title} (context ${item.context})`);
    }
    if (!apply) {
      report.voorgenomen.push(`${item.title}${item.dueDate ? ` | ${item.dueDate}` : ''}${item.context ? ` | ${item.context}` : ''}`);
      continue;
    }
    const r = await recordTask(adapter, {
      companyId: resolved.companyId,
      title: item.title,
      description: item.section ? `import: ${item.section}` : 'import: jarvis-todo.md',
      status: 'todo',
      priority: item.priority,
      dueDate: item.dueDate,
    });
    (r.created ? report.toegevoegd : report.bijgewerkt).push(item.title);
  }
  return report;
}

/* Datum als JJJJ-MM-DD; de pg-driver geeft date-kolommen als Date-object terug. */
function fmtDate(d) {
  if (d == null) return null;
  if (d instanceof Date) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  return String(d).slice(0, 10);
}

function addDays(dateStr, days) {
  const [y, m, d] = String(dateStr).split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  return fmtDate(dt);
}

/*
  Het leesbare overzicht: vandaag (deadline vandaag of over datum), deze week (binnen 7 dagen),
  later (met deadline), zonder deadline, en het aantal afgerond. Open = todo, doing of blocked.
  Pure functie met een peildatum, dus deterministisch testbaar.

  Deadline-overerving (migration 0039): een to-do zonder eigen deadline maar met een grote taak
  (parent_task_id) telt mee op de deadline van zijn grote taak, gemarkeerd met geerfd true. Een
  eigen deadline wint altijd van de geerfde.
*/
export function buildTaskOverview({ tasks = [], today } = {}) {
  if (!today) throw new Error('buildTaskOverview vereist een peildatum (today).');
  const dueById = new Map(tasks.map((t) => [t.id, t.due_date]));
  const effectief = (t) => {
    if (t.due_date != null) return { due: t.due_date, geerfd: false };
    const parentDue = t.parent_task_id != null ? dueById.get(t.parent_task_id) : null;
    return parentDue != null ? { due: parentDue, geerfd: true } : { due: null, geerfd: false };
  };
  const open = tasks
    .filter((t) => ['todo', 'doing', 'blocked'].includes(t.status))
    .map((t) => ({ ...t, ...(() => { const e = effectief(t); return { effective_due: e.due, geerfd: e.geerfd }; })() }));
  const withDue = open.filter((t) => t.effective_due != null)
    .map((t) => ({ ...t, due: fmtDate(t.effective_due) }))
    .sort((a, b) => a.due.localeCompare(b.due));
  const weekEnd = addDays(today, 7);
  const prioRank = { high: 0, medium: 1, low: 2 };
  const byPrio = (a, b) => (prioRank[a.priority] ?? 1) - (prioRank[b.priority] ?? 1);
  return {
    vandaag: withDue.filter((t) => t.due <= today),
    dezeWeek: withDue.filter((t) => t.due > today && t.due <= weekEnd),
    later: withDue.filter((t) => t.due > weekEnd),
    zonderDeadline: open.filter((t) => t.effective_due == null).sort(byPrio),
    afgerond: tasks.filter((t) => t.status === 'done').length,
  };
}
