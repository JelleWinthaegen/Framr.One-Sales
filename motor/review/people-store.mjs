/*
  Jarvis - people-store (personen-laag, migration 0035).

  De schrijf-laag voor de tabel people (die sinds 0001 bestond maar leeg bleef) plus de koppel-tabel
  person_company_roles. Een persoon is het menselijke anker van het relatieweb: hij bestaat per
  bedrijf (company_id) en kan een of meer rollen hebben (medewerker, klant, contact). Zo worden de
  dode koppelingen tasks.assignee en business_processes.owner levend.

  Review-first en idempotent: een persoon wordt niet gedupliceerd (natuurlijke sleutel is company
  plus genormaliseerde naam), en een rol wordt niet gedupliceerd (person plus company plus role).
  Geen echte namen in git of in tests.

  Stijl: blokcommentaar, geen lange streepjes en geen emoji, conform de projectafspraken.
*/

function norm(s) {
  return String(s == null ? '' : s).trim().toLowerCase();
}

/* De geldige rollen; gelijk aan de CHECK op person_company_roles.role (migration 0035). */
export const ROLES = ['owner', 'employee', 'client', 'contact', 'supplier_contact', 'other'];

/*
  Zet (upsert) een persoon. Natuurlijke sleutel: (company_id, naam genormaliseerd). Een tweede
  aanroep met dezelfde naam werkt rol en notitie bij in plaats van te dupliceren.

  reviewStatus (migration 0042) draagt de zekerheid: 'confirmed' (default, honderd procent) of
  'provisional' (afgeleid of nog in twijfel). Bij een bestaande persoon wordt de zekerheid alleen
  aangeraakt als hij expliciet is meegegeven, en nooit stil verlaagd van confirmed naar provisional.
*/
export async function recordPerson(adapter, {
  companyId, name, role = null, notes = null, reviewStatus,
} = {}) {
  if (!companyId) throw new Error('recordPerson vereist companyId.');
  if (!name || !String(name).trim()) throw new Error('recordPerson vereist een naam.');
  if (reviewStatus !== undefined && !['provisional', 'confirmed'].includes(reviewStatus)) {
    throw new Error("reviewStatus moet 'provisional' of 'confirmed' zijn.");
  }
  const existing = await adapter.findPersonByName(companyId, norm(name));
  if (existing) {
    const patch = {};
    if (role != null) patch.role = role;
    if (notes != null) patch.notes = notes;
    if (reviewStatus === 'confirmed' && existing.review_status !== 'confirmed') {
      patch.review_status = 'confirmed';
    }
    if (Object.keys(patch).length) await adapter.updatePerson(existing.id, patch);
    return { id: existing.id, created: false };
  }
  const r = await adapter.insertPerson({
    company_id: companyId, name: String(name).trim(), role, notes,
    review_status: reviewStatus || 'confirmed',
  });
  return { id: r.id, created: true };
}

/*
  Zet (upsert) een rol van een persoon bij een bedrijf. Idempotent op (person, company, role): een
  tweede aanroep met dezelfde rol maakt geen duplicaat. Weigert een onbekende rol.
*/
export async function setPersonRole(adapter, {
  personId, companyId, role, isPrimary = false, notes = null, source = null, reviewStatus,
} = {}) {
  if (!personId) throw new Error('setPersonRole vereist personId.');
  if (!companyId) throw new Error('setPersonRole vereist companyId.');
  if (!ROLES.includes(role)) throw new Error(`setPersonRole vereist een geldige rol (${ROLES.join(', ')}).`);
  const existing = await adapter.findPersonCompanyRole(personId, companyId, role);
  if (existing) return { id: existing.id, created: false };
  const r = await adapter.insertPersonCompanyRole({
    person_id: personId, company_id: companyId, role, is_primary: isPrimary, notes, source,
    review_status: reviewStatus || 'confirmed',
  });
  return { id: r.id, created: true };
}

/*
  Zoekt een persoon op naam binnen een bedrijf. Retourneert de persoon of null; gokt niet, zodat de
  aanroeper (bijvoorbeeld de taken-CLI bij --assignee) een onbekende naam kan melden.
*/
export async function resolvePersonByName(adapter, { companyId, name } = {}) {
  const raw = name == null ? '' : String(name).trim();
  if (!companyId || !raw) return null;
  return adapter.findPersonByName(companyId, norm(raw));
}

/*
  Legt een relatie tussen twee personen vast (person_relations, migration 0038). Leesrichting:
  "from is <relation> van to" (A is vader van B). Idempotent op (from, to, genormaliseerde
  relatie). Een relatie met zichzelf wordt geweigerd (net als de CHECK in het schema). De relatie
  is bewust vrije tekst: collega, vader, zoon, familielid, compagnon, noem maar op.

  inverseRelation legt in dezelfde aanroep de tegenrelatie vast (B is zoon van A), als eigen rij.
*/
export async function recordPersonRelation(adapter, {
  fromPersonId, toPersonId, relation, inverseRelation = null,
  companyId = null, notes = null, source = null, reviewStatus,
} = {}) {
  if (!fromPersonId || !toPersonId) throw new Error('recordPersonRelation vereist fromPersonId en toPersonId.');
  if (fromPersonId === toPersonId) throw new Error('een persoon kan geen relatie met zichzelf hebben.');
  if (!relation || !String(relation).trim()) throw new Error('recordPersonRelation vereist een relatie.');

  async function upsert(fromId, toId, rel) {
    const normalized = norm(rel);
    const existing = await adapter.findPersonRelation(fromId, toId, normalized);
    if (existing) return { id: existing.id, created: false };
    const r = await adapter.insertPersonRelation({
      company_id: companyId, from_person_id: fromId, to_person_id: toId,
      relation: String(rel).trim(), normalized_relation: normalized, notes, source,
      review_status: reviewStatus || 'confirmed',
    });
    return { id: r.id, created: true };
  }

  const heen = await upsert(fromPersonId, toPersonId, relation);
  const terug = inverseRelation && String(inverseRelation).trim()
    ? await upsert(toPersonId, fromPersonId, inverseRelation)
    : null;
  return { heen, terug };
}

/*
  De relaties van een persoon, beide kanten op, als leesbare regels. Pure functie: de aanroeper
  levert de personen en relaties (uit fetchPeople en fetchPersonRelations). Uitgaand leest als
  "is <relatie> van <naam>", inkomend als "<naam> is <relatie> van deze persoon".
*/
export function buildRelationOverview({ personId, people = [], relations = [] } = {}) {
  if (!personId) throw new Error('buildRelationOverview vereist een personId.');
  const nameById = new Map(people.map((p) => [p.id, p.name]));
  const uitgaand = relations.filter((r) => r.from_person_id === personId)
    .map((r) => `is ${r.relation} van ${nameById.get(r.to_person_id) || r.to_person_id}`);
  const inkomend = relations.filter((r) => r.to_person_id === personId)
    .map((r) => `${nameById.get(r.from_person_id) || r.from_person_id} is ${r.relation} van deze persoon`);
  return { uitgaand, inkomend };
}

/*
  Koppelt een medewerker (workers, de loonlaag) aan een persoon (people, het meesterrecord),
  migration 0036. De worker wordt op genormaliseerde naam en daarna op alias gezocht; een onbekende
  naam wordt gemeld (linked false, reason), nooit gegokt. Idempotent: opnieuw koppelen aan dezelfde
  persoon is geen fout, en een worker die al aan een ANDERE persoon hangt wordt niet stil
  overschreven (tenzij force).
*/
export async function linkWorkerToPerson(adapter, {
  personId, companyId, workerName, force = false,
} = {}) {
  if (!personId) throw new Error('linkWorkerToPerson vereist personId.');
  if (!companyId) throw new Error('linkWorkerToPerson vereist companyId.');
  const raw = workerName == null ? '' : String(workerName).trim();
  if (!raw) return { linked: false, reason: 'lege workernaam' };

  let worker = await adapter.findWorkerByNormalizedName(companyId, norm(raw));
  if (!worker && adapter.findWorkerByAlias) {
    worker = await adapter.findWorkerByAlias(companyId, norm(raw));
  }
  if (!worker) return { linked: false, reason: `medewerker '${raw}' niet gevonden` };
  if (worker.person_id && worker.person_id !== personId && !force) {
    return { linked: false, reason: 'medewerker hangt al aan een andere persoon (gebruik force om te overschrijven)', workerId: worker.id };
  }
  await adapter.updateWorker(worker.id, { person_id: personId });
  return { linked: true, workerId: worker.id, workerName: worker.name };
}

/*
  Bevestigt een persoon uit de twijfel-emmer (review_status provisional -> confirmed, migration
  0042), inclusief al zijn voorlopige rollen en relaties in een keer. Zet confirmed_at en
  confirmed_by, net als bij projecten. Idempotent: een al bevestigde persoon opnieuw bevestigen
  is geen fout.
*/
export async function confirmPerson(adapter, {
  personId, confirmedBy = null, now = new Date().toISOString(),
} = {}) {
  if (!personId) throw new Error('confirmPerson vereist een personId.');
  const stamp = { review_status: 'confirmed', confirmed_at: now, confirmed_by: confirmedBy };
  await adapter.updatePerson(personId, stamp);

  let rollen = 0;
  if (adapter.fetchPersonCompanyRoles && adapter.updatePersonCompanyRole) {
    for (const r of await adapter.fetchPersonCompanyRoles()) {
      if (r.person_id === personId && r.review_status === 'provisional') {
        await adapter.updatePersonCompanyRole(r.id, stamp);
        rollen += 1;
      }
    }
  }
  let relaties = 0;
  if (adapter.fetchPersonRelations && adapter.updatePersonRelation) {
    for (const r of await adapter.fetchPersonRelations()) {
      if ((r.from_person_id === personId || r.to_person_id === personId) && r.review_status === 'provisional') {
        await adapter.updatePersonRelation(r.id, stamp);
        relaties += 1;
      }
    }
  }
  return { confirmed: true, rollen, relaties };
}

/*
  De twijfel-emmer: alles op de web-laag dat nog bevestiging nodig heeft. Pure functie over de
  meegegeven lijsten, zodat hij deterministisch testbaar is; de CLI levert de data.
*/
export function buildTwijfelOverview({ people = [], roles = [], relations = [] } = {}) {
  const nameById = new Map(people.map((p) => [p.id, p.name]));
  return {
    personen: people.filter((p) => p.review_status === 'provisional')
      .map((p) => `${p.name}${p.notes ? ` (${p.notes})` : ''}`),
    rollen: roles.filter((r) => r.review_status === 'provisional')
      .map((r) => `${nameById.get(r.person_id) || r.person_id}: ${r.role}`),
    relaties: relations.filter((r) => r.review_status === 'provisional')
      .map((r) => `${nameById.get(r.from_person_id) || r.from_person_id} is ${r.relation} van ${nameById.get(r.to_person_id) || r.to_person_id}`),
  };
}

/*
  Correctie-acties (2026-07-16, "direct verwerken, gaandeweg corrigeren"): fouten in het geheugen
  moeten net zo makkelijk weg als erin. Elke functie is gericht (geen bulk) en meldt wat er
  gebeurde in plaats van stil te falen.
*/

/* Verwijdert een gerichte relatie (from is <relation> van to). Een tegenrelatie is een eigen rij
   en wordt apart verwijderd (de CLI kan beide in een aanroep doen). */
export async function removePersonRelation(adapter, { fromPersonId, toPersonId, relation } = {}) {
  if (!fromPersonId || !toPersonId) throw new Error('removePersonRelation vereist fromPersonId en toPersonId.');
  if (!relation || !String(relation).trim()) throw new Error('removePersonRelation vereist de relatie-tekst.');
  if (!adapter.deletePersonRelation) throw new Error('deze adapter ondersteunt deletePersonRelation niet.');
  const r = await adapter.deletePersonRelation(fromPersonId, toPersonId, norm(relation));
  return { deleted: r.deleted };
}

/* Verwijdert een rol van een persoon bij een bedrijf. */
export async function removePersonRole(adapter, { personId, companyId, role } = {}) {
  if (!personId || !companyId) throw new Error('removePersonRole vereist personId en companyId.');
  if (!ROLES.includes(role)) throw new Error(`rol moet een van ${ROLES.join(', ')} zijn.`);
  if (!adapter.deletePersonCompanyRole) throw new Error('deze adapter ondersteunt deletePersonCompanyRole niet.');
  const r = await adapter.deletePersonCompanyRole(personId, companyId, role);
  return { deleted: r.deleted };
}

/*
  Voegt twee kaarten van dezelfde persoon samen.

  Dat komt voor doordat een naam op twee manieren geschreven wordt en beide keren een kaart
  opleverde. Bij WBW waren dat "Marc van de Wallen" en "Marc van de Walle": een persoon, twee
  kaarten, en aan de ene hingen drie projecten en aan de andere drie taken (Jelle bevestigde het
  op 26-08-2026). Niemand ziet zoiets, want elk van de twee ziet er op zichzelf gezond uit.

  WELKE KAART BLIJFT is een keuze en geen automatisme; de aanroeper geeft hem op. Vuistregel: de
  kaart waar het meeste aan hangt, want elke verhuisde draad is een kans op een fout.

  DE NOTITIES GAAN ALLEBEI MEE. Ze verschillen meestal, en dat is juist de reden dat er twee
  kaarten waren: de een kende het regietarief, de ander de zes panden. De tekst van de verdwijnende
  kaart wordt eronder gezet met de naam erbij, zodat later te zien is waar hij vandaan kwam. De
  naam zelf gaat daarmee ook niet verloren, en dat is belangrijk want people kent geen aliassen:
  wie in een oude mail "van de Wallen" tegenkomt moet hem nog kunnen terugvinden.
*/
export async function mergePeople(adapter, {
  companyId, keepName, dropName,
} = {}) {
  if (!companyId) throw new Error('mergePeople vereist companyId.');
  if (!adapter.mergeReferences) throw new Error('deze adapter ondersteunt mergeReferences niet.');

  const blijft = await resolvePersonByName(adapter, { companyId, name: keepName });
  if (!blijft) return { merged: false, reason: `persoon niet gevonden: '${keepName}'` };
  const gaatWeg = await resolvePersonByName(adapter, { companyId, name: dropName });
  if (!gaatWeg) return { merged: false, reason: `persoon niet gevonden: '${dropName}'` };
  if (blijft.id === gaatWeg.id) return { merged: false, reason: 'dit is een en dezelfde kaart' };

  const oud = String(blijft.notes || '').trim();
  const mee = String(gaatWeg.notes || '').trim();
  const samen = mee && mee !== oud
    ? `${oud}${oud ? '\n\n' : ''}Samengevoegd met de kaart "${gaatWeg.name}": ${mee}`
    : oud;
  if (samen !== oud) await adapter.updatePerson(blijft.id, { notes: samen });

  const uit = await adapter.mergeReferences('people', blijft.id, gaatWeg.id);
  return {
    merged: true,
    blijft: { id: blijft.id, naam: blijft.name },
    weg: { id: gaatWeg.id, naam: gaatWeg.name },
    ...uit,
  };
}

/*
  Hernoemt een persoon. Weigert als de nieuwe naam al bestaat binnen het bedrijf: dat is een
  samenvoeg-vraag (merge), en samenvoegen hangt alle draden om en is bewust een aparte, latere
  actie. De relaties en koppelingen blijven kloppen omdat ze op id verwijzen.
*/
export async function renamePerson(adapter, { companyId, personId, newName } = {}) {
  if (!companyId || !personId) throw new Error('renamePerson vereist companyId en personId.');
  const raw = newName == null ? '' : String(newName).trim();
  if (!raw) throw new Error('renamePerson vereist een nieuwe naam.');
  if (!adapter.updatePerson) throw new Error('deze adapter ondersteunt updatePerson niet.');
  const bestaand = await adapter.findPersonByName(companyId, norm(raw));
  if (bestaand && bestaand.id !== personId) {
    return { renamed: false, reason: `er bestaat al een persoon met de naam '${raw}'; samenvoegen is een aparte actie` };
  }
  await adapter.updatePerson(personId, { name: raw });
  return { renamed: true, newName: raw };
}

/*
  Zet of ontkoppelt de persoon op een factuur (invoices.contact_person_id, migration 0040): de
  klant bij verkoop, de contactpersoon van de leverancier bij inkoop. personId null ontkoppelt
  bewust. Weigert een onbestaande factuur; de naam-resolutie doet de aanroeper (CLI).
*/
export async function setInvoiceContactPerson(adapter, { invoiceId, personId = null } = {}) {
  if (!invoiceId) throw new Error('setInvoiceContactPerson vereist een invoiceId.');
  const invoices = adapter.fetchInvoices ? await adapter.fetchInvoices() : [];
  const existing = invoices.find((i) => i.id === invoiceId);
  if (!existing) return { updated: false, reason: 'factuur niet gevonden' };
  await adapter.updateInvoice(invoiceId, { contact_person_id: personId });
  return { updated: true, contactPersonId: personId };
}

/*
  Zet of ontkoppelt de persoon op een document (documents.person_id, migration 0041): van wie of
  over wie het document of de foto is. personId null ontkoppelt bewust. Weigert een onbestaand
  document; de naam-resolutie doet de aanroeper (CLI).
*/
export async function setDocumentPerson(adapter, { documentId, personId = null } = {}) {
  if (!documentId) throw new Error('setDocumentPerson vereist een documentId.');
  if (!adapter.getDocumentById || !adapter.updateDocument) {
    throw new Error('deze adapter ondersteunt getDocumentById/updateDocument niet.');
  }
  const existing = await adapter.getDocumentById(documentId);
  if (!existing) return { updated: false, reason: 'document niet gevonden' };
  await adapter.updateDocument(documentId, { person_id: personId });
  return { updated: true, personId };
}

/*
  Het leesbare overzicht: personen met hun rollen (uit person_company_roles), op naam gesorteerd.
  Pure functie, deterministisch testbaar.
*/
export function buildPeopleOverview({ people = [], roles = [] } = {}) {
  const rolesByPerson = new Map();
  for (const r of roles) {
    if (!rolesByPerson.has(r.person_id)) rolesByPerson.set(r.person_id, []);
    rolesByPerson.get(r.person_id).push(r.role);
  }
  return people
    .map((p) => ({
      id: p.id,
      name: p.name,
      hoofdrol: p.role || null,
      rollen: rolesByPerson.get(p.id) || [],
    }))
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
}
