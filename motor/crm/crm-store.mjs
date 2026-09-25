/*
  Jarvis - crm-store (het CRM-fundament, migration 0060).

  De schrijf- en leeslaag voor het Client OS: leads, contactpersonen, interacties,
  discovery-antwoorden, vragen, bezwaren, kansen en fasen. Volgt docs/crm-ontwerp.md:

    - Een bedrijf bestaat exact een keer per context. De ontdubbeling zoekt in vaste
      volgorde (KvK, btw, genormaliseerd domein, genormaliseerde naam plus plaats) en
      werkt idempotent bij in plaats van te dupliceren.
    - De normalisatie (naam en domein) leeft hier, in de applicatielaag; de harde
      grendels (unique indexes) staan in de database.
    - Vaste waardelijsten leven in sales_veldopties (config per bedrijf, via seeds).
      De optie-guard weigert waarden buiten de lijst; een veld zonder opties is vrij.
      Onbekende waarden worden gemeld, niet geraden.
    - door_person_id (wie van ons) is bij een gesprek (call) verplicht: zonder dat
      veld zijn reacties later niet per beller te vergelijken.
    - Een kans met projectdatum maakt automatisch een beltaak twee dagen ervoor; een
      contactmoment met opvolgdatum maakt een opvolgtaak. Beide via de bestaande
      taken-laag (een takenlijst, geen tweede administratie).

  Stijl: blokcommentaar, geen lange streepjes en geen emoji, conform de projectafspraken.
*/

import { recordTask } from '../review/task-store.mjs?v=5dd6073';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/*
  Naamnormalisatie voor de ontdubbeling: kleine letters, leestekens en spaties eruit,
  rechtsvormaanduidingen eraf (bv, vof, holding en varianten). "Jansen Vloeren B.V." en
  "jansenvloeren" worden zo hetzelfde bedrijf.
*/
export function normalizeLeadName(s) {
  if (!s) return '';
  let t = String(s).toLowerCase();
  t = t.replace(/[^a-z0-9\s]/g, ' ');
  t = t.replace(/\b(b\s*v|v\s*o\s*f|c\s*v|n\s*v|holding|beheer|groep|group)\b/g, ' ');
  return t.replace(/\s+/g, '');
}

/* Domeinnormalisatie: protocol, www, pad en slash eraf, kleine letters. */
export function normalizeDomein(s) {
  if (!s) return null;
  let t = String(s).trim().toLowerCase();
  t = t.replace(/^[a-z]+:\/\//, '');
  t = t.replace(/^www\./, '');
  t = t.split(/[/?#]/)[0];
  return t || null;
}

/*
  De optie-guard: bestaat er voor dit veld een actieve waardelijst in sales_veldopties,
  dan moet de waarde erin staan. Een veld zonder opties is vrij (de guard is config, geen
  code). De foutmelding noemt de toegestane waarden, zodat de beller niet hoeft te raden.
*/
export async function assertOptieToegestaan(adapter, { companyId, veld, waarde } = {}) {
  if (waarde == null || waarde === '') return;
  const opties = (await adapter.fetchVeldopties())
    .filter((o) => o.company_id === companyId && o.veld === veld && o.actief !== false);
  if (!opties.length) return;
  if (!opties.some((o) => o.waarde === waarde)) {
    const lijst = opties.map((o) => o.waarde).sort().join(', ');
    throw new Error(`'${waarde}' is geen toegestane waarde voor ${veld}. Toegestaan: ${lijst}.`);
  }
}

/*
  Ontdubbel-lookup in vaste volgorde: KvK, btw, genormaliseerd domein, genormaliseerde
  naam plus plaats. Retourneert { lead, matchedOn } of { lead: null }.
*/
export async function findExistingLead(adapter, {
  companyId, kvkNummer, btwNummer, domein, genormaliseerdeNaam, plaats,
} = {}) {
  if (kvkNummer) {
    const lead = await adapter.findLeadByKvk(companyId, kvkNummer);
    if (lead) return { lead, matchedOn: 'kvk' };
  }
  if (btwNummer) {
    const lead = await adapter.findLeadByBtw(companyId, btwNummer);
    if (lead) return { lead, matchedOn: 'btw' };
  }
  if (domein) {
    const lead = await adapter.findLeadByDomein(companyId, domein);
    if (lead) return { lead, matchedOn: 'domein' };
  }
  if (genormaliseerdeNaam) {
    const lead = await adapter.findLeadByNaamPlaats(companyId, genormaliseerdeNaam, plaats || '');
    if (lead) return { lead, matchedOn: 'naam+plaats' };

    /*
      Tweede poging op de naam alleen, maar alleen bij leads waarvan de plaats nog LEEG is.

      Zonder deze stap kun je een plaats nooit toevoegen aan een bestaande lead: de sleutel is
      naam plus plaats, dus "Daphne" met plaats Kerkrade matcht niet op "Daphne" zonder plaats en
      er ontstaat een tweede rij. Dat gebeurde op 26-08-2026 drie keer op een middag, met Wendy,
      Domivest en Daphne, precies terwijl Jelle de lijst zat aan te vullen.

      Bewust alleen naar lege plaatsen kijken. Twee leads met dezelfde naam in VERSCHILLENDE
      plaatsen zijn twee verschillende mensen, en die mogen niet op elkaar geplakt worden; dat is
      juist waarom de plaats in de sleutel zit. Meerdere kandidaten zonder plaats betekent dat het
      raden wordt, en dan gebeurt er niets.
    */
    if (plaats && adapter.fetchLeads) {
      const zonderPlaats = (await adapter.fetchLeads()).filter(
        (l) => l.company_id === companyId
          && l.genormaliseerde_naam === genormaliseerdeNaam
          && !String(l.plaats || '').trim(),
      );
      if (zonderPlaats.length === 1) return { lead: zonderPlaats[0], matchedOn: 'naam (plaats was nog leeg)' };
    }
  }
  return { lead: null, matchedOn: null };
}

const LEAD_GUARDED_VELDEN = { specialisme: 'specialisme', bron: 'bron' };

/*
  Lead toevoegen of bijwerken (idempotent): bestaat het bedrijf al op een van de
  ontdubbel-sleutels, dan worden alleen de meegegeven velden bijgewerkt. Waarden met een
  database-check (bedrijfsgrootte, tier, leadscore, klantklasse) valideert de store
  vooraf met een leesbare melding; specialisme en bron lopen langs de optie-guard.
*/
export async function recordLead(adapter, { companyId, naam, ...velden } = {}) {
  if (!companyId) throw new Error('recordLead vereist companyId.');
  if (!naam || !String(naam).trim()) throw new Error('recordLead vereist een bedrijfsnaam (--naam).');

  const checks = {
    bedrijfsgrootte: ['zzp', '2-5', '6-10', '11-25', '25plus'],
    leadscore: ['A', 'B', 'C'],
    klantklasse: ['A', 'B', 'C'],
  };
  for (const [veld, lijst] of Object.entries(checks)) {
    const w = velden[veld];
    if (w != null && !lijst.includes(w)) {
      throw new Error(`'${w}' is geen toegestane waarde voor ${veld}. Toegestaan: ${lijst.join(', ')}.`);
    }
  }
  if (velden.tier != null) {
    const t = Number(velden.tier);
    if (!Number.isInteger(t) || t < 1 || t > 4) throw new Error('tier moet 1 tot en met 4 zijn.');
    velden.tier = t;
  }
  for (const [veld, optieVeld] of Object.entries(LEAD_GUARDED_VELDEN)) {
    if (velden[veld] != null) {
      await assertOptieToegestaan(adapter, { companyId, veld: optieVeld, waarde: velden[veld] });
    }
  }

  const genormaliseerdeNaam = normalizeLeadName(naam);
  const domein = velden.domein != null || velden.website != null
    ? normalizeDomein(velden.domein || velden.website)
    : undefined;

  const { lead, matchedOn } = await findExistingLead(adapter, {
    companyId,
    kvkNummer: velden.kvk_nummer,
    btwNummer: velden.btw_nummer,
    domein: domein ?? undefined,
    genormaliseerdeNaam,
    plaats: velden.plaats,
  });

  const row = { naam: String(naam).trim(), genormaliseerde_naam: genormaliseerdeNaam };
  for (const [k, v] of Object.entries(velden)) {
    if (v !== undefined) row[k] = v;
  }
  if (domein !== undefined) row.domein = domein;

  if (lead) {
    await adapter.updateLead(lead.id, row);
    return { id: lead.id, created: false, matchedOn };
  }
  const r = await adapter.insertLead({ company_id: companyId, ...row });
  return { id: r.id, created: true, matchedOn: null };
}

/*
  Lead opzoeken op referentie: een id, een KvK-nummer of een (genormaliseerde) naam.
  Meerdere naamtreffers in verschillende plaatsen worden gemeld, niet gegokt; met
  plaats erbij wordt het eenduidig.
*/
export async function resolveLeadByRef(adapter, { companyId, ref, plaats } = {}) {
  if (!ref || !String(ref).trim()) throw new Error('een lead-referentie (--lead) is verplicht.');
  const wanted = String(ref).trim();
  if (UUID_RE.test(wanted)) {
    const lead = await adapter.getLeadById(wanted);
    if (lead && lead.company_id === companyId) return lead;
    throw new Error(`geen lead met id ${wanted} binnen dit bedrijf.`);
  }
  if (/^\d{8}$/.test(wanted)) {
    const lead = await adapter.findLeadByKvk(companyId, wanted);
    if (lead) return lead;
  }
  const genormaliseerd = normalizeLeadName(wanted);
  const kandidaten = (await adapter.fetchLeads())
    .filter((l) => l.company_id === companyId && l.genormaliseerde_naam === genormaliseerd)
    .filter((l) => !plaats || String(l.plaats || '').toLowerCase() === String(plaats).toLowerCase());
  if (kandidaten.length === 1) return kandidaten[0];
  if (kandidaten.length > 1) {
    const plaatsen = kandidaten.map((l) => l.plaats || 'zonder plaats').join(', ');
    throw new Error(`'${ref}' bestaat in meerdere plaatsen (${plaatsen}); geef --plaats mee.`);
  }
  throw new Error(`geen lead gevonden voor '${ref}'. Voeg hem eerst toe met lead-add.`);
}

/* Contactpersoon aan een lead koppelen (idempotent op lead plus persoon). */
export async function recordLeadPerson(adapter, {
  companyId, leadId, personId, rol, isPrimair, voorkeurskanaal, notities,
} = {}) {
  if (!companyId || !leadId || !personId) throw new Error('recordLeadPerson vereist companyId, leadId en personId.');
  if (voorkeurskanaal != null && !['telefoon', 'whatsapp', 'email'].includes(voorkeurskanaal)) {
    throw new Error("voorkeurskanaal moet telefoon, whatsapp of email zijn.");
  }
  const patch = {};
  if (rol !== undefined) patch.rol = rol;
  if (isPrimair !== undefined) patch.is_primair = isPrimair;
  if (voorkeurskanaal !== undefined) patch.voorkeurskanaal = voorkeurskanaal;
  if (notities !== undefined) patch.notities = notities;
  const existing = await adapter.findLeadPerson(leadId, personId);
  if (existing) {
    if (Object.keys(patch).length) await adapter.updateLeadPerson(existing.id, patch);
    return { id: existing.id, created: false };
  }
  const r = await adapter.insertLeadPerson({
    company_id: companyId, lead_id: leadId, person_id: personId, ...patch,
  });
  return { id: r.id, created: true };
}

const INTERACTION_TYPES = ['call', 'whatsapp', 'email', 'meeting', 'demo', 'note'];

/*
  Contactmoment vastleggen. Bij type call is doorPersonId (wie van ons belde) verplicht;
  de uitkomst loopt langs de optie-guard (veld uitkomst). Een opvolgdatum maakt direct
  de opvolgtaak aan op de gedeelde takenlijst, met de lead en de reden eraan.
*/
export async function recordInteraction(adapter, {
  companyId, leadId, type, doorPersonId, personId, richting, startedAt, duurSeconden,
  samenvatting, uitkomst, volgendeStap, opvolgDatum, opportunityId, opnameRef, transcriptRef,
} = {}) {
  if (!companyId || !leadId) throw new Error('recordInteraction vereist companyId en leadId.');
  if (!INTERACTION_TYPES.includes(type)) {
    throw new Error(`type moet een van ${INTERACTION_TYPES.join(', ')} zijn.`);
  }
  if (type === 'call' && !doorPersonId) {
    throw new Error('bij een gesprek is --door (wie van ons belde) verplicht; anders zijn reacties later niet per beller te vergelijken.');
  }
  if (richting != null && !['uitgaand', 'inkomend'].includes(richting)) {
    throw new Error('richting moet uitgaand of inkomend zijn.');
  }
  await assertOptieToegestaan(adapter, { companyId, veld: 'uitkomst', waarde: uitkomst });

  const row = {
    company_id: companyId,
    lead_id: leadId,
    type,
    started_at: startedAt || new Date().toISOString(),
  };
  if (doorPersonId !== undefined) row.door_person_id = doorPersonId;
  if (personId !== undefined) row.person_id = personId;
  if (richting !== undefined) row.richting = richting;
  if (duurSeconden !== undefined) row.duur_seconden = duurSeconden;
  if (samenvatting !== undefined) row.samenvatting = samenvatting;
  if (uitkomst !== undefined) row.uitkomst = uitkomst;
  if (volgendeStap !== undefined) row.volgende_stap = volgendeStap;
  if (opportunityId !== undefined) row.opportunity_id = opportunityId;
  if (opnameRef !== undefined) row.opname_ref = opnameRef;
  if (transcriptRef !== undefined) row.transcript_ref = transcriptRef;

  const r = await adapter.insertInteraction(row);

  let taak = null;
  if (opvolgDatum) {
    const lead = await adapter.getLeadById(leadId);
    const t = await recordTask(adapter, {
      companyId,
      title: `Opvolgen: ${lead ? lead.naam : leadId}`,
      dueDate: opvolgDatum,
      description: volgendeStap || samenvatting || null,
    });
    await adapter.updateTask(t.id, {
      lead_id: leadId,
      task_type: type === 'call' ? 'call' : null,
      reden: `afgesproken bij het contactmoment van ${String(row.started_at).slice(0, 10)}`,
      linked_interaction_id: r.id,
    });
    taak = { id: t.id, created: t.created, dueDate: opvolgDatum };
  }
  return { id: r.id, taak };
}

/*
  Discovery-antwoord vastleggen, idempotent op (interactie, veld). De veldnaam loopt
  langs de lijst discovery_veld (config); de waarde langs de eventuele waardelijst van
  het veld zelf. Zo blijft de data telbaar zonder dat elke waarde een lijst nodig heeft.
*/
export async function recordDiscoveryAnswer(adapter, {
  companyId, leadId, interactionId, veld, waarde, zekerheid, herkomst,
} = {}) {
  if (!companyId || !leadId || !interactionId) {
    throw new Error('recordDiscoveryAnswer vereist companyId, leadId en interactionId.');
  }
  if (!veld || !waarde) throw new Error('recordDiscoveryAnswer vereist --veld en --waarde.');
  if (zekerheid != null && !['bevestigd', 'waarschijnlijk', 'onbekend'].includes(zekerheid)) {
    throw new Error('zekerheid moet bevestigd, waarschijnlijk of onbekend zijn.');
  }
  if (herkomst != null && !['letterlijk', 'afgeleid', 'beller'].includes(herkomst)) {
    throw new Error('herkomst moet letterlijk, afgeleid of beller zijn.');
  }
  await assertOptieToegestaan(adapter, { companyId, veld: 'discovery_veld', waarde: veld });
  await assertOptieToegestaan(adapter, { companyId, veld, waarde });

  const patch = { waarde };
  if (zekerheid !== undefined) patch.zekerheid = zekerheid;
  if (herkomst !== undefined) patch.herkomst = herkomst;
  const existing = await adapter.findDiscoveryAnswer(interactionId, veld);
  if (existing) {
    await adapter.updateDiscoveryAnswer(existing.id, patch);
    return { id: existing.id, created: false };
  }
  const r = await adapter.insertDiscoveryAnswer({
    company_id: companyId, lead_id: leadId, interaction_id: interactionId, veld, ...patch,
  });
  return { id: r.id, created: true };
}

/* Klantvraag als datapunt; de categorie loopt langs de optie-guard (vraag_categorie). */
export async function recordQuestion(adapter, {
  companyId, leadId, interactionId, vraag, antwoord, categorie, beantwoordDoor,
} = {}) {
  if (!companyId || !leadId) throw new Error('recordQuestion vereist companyId en leadId.');
  if (!vraag || !String(vraag).trim()) throw new Error('recordQuestion vereist --vraag.');
  await assertOptieToegestaan(adapter, { companyId, veld: 'vraag_categorie', waarde: categorie });
  const row = { company_id: companyId, lead_id: leadId, vraag: String(vraag).trim() };
  if (interactionId !== undefined) row.interaction_id = interactionId;
  if (antwoord !== undefined) row.antwoord = antwoord;
  if (categorie !== undefined) row.categorie = categorie;
  if (beantwoordDoor !== undefined) row.beantwoord_door = beantwoordDoor;
  const r = await adapter.insertQuestion(row);
  return { id: r.id };
}

/* Bezwaar als datapunt; de categorie loopt langs de optie-guard (bezwaar_categorie). */
export async function recordObjection(adapter, {
  companyId, leadId, interactionId, bezwaar, categorie, gegevenReactie, reactieWerkte,
} = {}) {
  if (!companyId || !leadId) throw new Error('recordObjection vereist companyId en leadId.');
  if (!bezwaar || !String(bezwaar).trim()) throw new Error('recordObjection vereist --bezwaar.');
  await assertOptieToegestaan(adapter, { companyId, veld: 'bezwaar_categorie', waarde: categorie });
  const row = { company_id: companyId, lead_id: leadId, bezwaar: String(bezwaar).trim() };
  if (interactionId !== undefined) row.interaction_id = interactionId;
  if (categorie !== undefined) row.categorie = categorie;
  if (gegevenReactie !== undefined) row.gegeven_reactie = gegevenReactie;
  if (reactieWerkte !== undefined) row.reactie_werkte = reactieWerkte;
  const r = await adapter.insertObjection(row);
  return { id: r.id };
}

const OPPORTUNITY_STAGES = ['aanstaand', 'inmeten', 'offerte', 'gewonnen', 'verloren', 'besteld'];

/* Datumhulp: JJJJ-MM-DD min een aantal dagen, zonder tijdzoneverrassingen. */
export function dateMinusDays(isoDate, days) {
  const [y, m, d] = String(isoDate).slice(0, 10).split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - days);
  return dt.toISOString().slice(0, 10);
}

/*
  Projectkans vastleggen of bijwerken (idempotent op lead plus naam). Een kans met een
  projectdatum maakt automatisch de beltaak twee dagen ervoor aan, met de reden erbij:
  de beste follow-up is niet "ik bel volgende week" maar het projectmoment zelf.
*/
export async function recordOpportunity(adapter, {
  companyId, leadId, naam, personId, geschatM2, geschatteMateriaalwaarde,
  projectdatum, stage, verlorenReden, volgendeActieOp,
} = {}) {
  if (!companyId || !leadId) throw new Error('recordOpportunity vereist companyId en leadId.');
  if (!naam || !String(naam).trim()) throw new Error('recordOpportunity vereist een naam voor de kans.');
  if (stage != null && !OPPORTUNITY_STAGES.includes(stage)) {
    throw new Error(`stage moet een van ${OPPORTUNITY_STAGES.join(', ')} zijn.`);
  }
  const patch = {};
  if (personId !== undefined) patch.person_id = personId;
  if (geschatM2 !== undefined) patch.geschat_m2 = geschatM2;
  if (geschatteMateriaalwaarde !== undefined) patch.geschatte_materiaalwaarde = geschatteMateriaalwaarde;
  if (projectdatum !== undefined) patch.projectdatum = projectdatum;
  if (stage !== undefined) patch.stage = stage;
  if (verlorenReden !== undefined) patch.verloren_reden = verlorenReden;
  if (volgendeActieOp !== undefined) patch.volgende_actie_op = volgendeActieOp;

  const existing = await adapter.findOpportunityByNaam(companyId, leadId, naam);
  let id;
  let created;
  if (existing) {
    if (Object.keys(patch).length) await adapter.updateOpportunity(existing.id, patch);
    id = existing.id;
    created = false;
  } else {
    const r = await adapter.insertOpportunity({
      company_id: companyId, lead_id: leadId, naam: String(naam).trim(), ...patch,
    });
    id = r.id;
    created = true;
  }

  let taak = null;
  if (projectdatum) {
    const lead = await adapter.getLeadById(leadId);
    const belDatum = dateMinusDays(projectdatum, 2);
    const t = await recordTask(adapter, {
      companyId,
      title: `Bellen voor project ${String(naam).trim()} (${lead ? lead.naam : leadId})`,
      dueDate: belDatum,
      description: `Project start ${String(projectdatum).slice(0, 10)}; twee dagen vooraf bellen.`,
    });
    await adapter.updateTask(t.id, {
      lead_id: leadId,
      task_type: 'call',
      reden: `project ${String(naam).trim()} start ${String(projectdatum).slice(0, 10)}`,
    });
    taak = { id: t.id, created: t.created, dueDate: belDatum };
  }
  return { id, created, taak };
}

/*
  Herberekent genormaliseerde_naam voor de leads van een bedrijf.

  Nodig omdat er twee normalisatievormen in de tabel zitten. De oudere schreef alleen kleine
  letters ("karl hensgens", "bodhi (marktplaats)"), de huidige haalt ook leestekens, spaties en
  rechtsvormen weg ("karlhensgens", "bodhimarktplaats"). Ontdekt op 26-08-2026: van de twintig
  WBW-leads stonden er vijftien in de oude vorm, en die waren daardoor met geen enkele actie
  terug te vinden. Erger: lead-add ontdubbelt op dit veld, dus "Frank Schings" nog een keer
  toevoegen had er stilzwijgend een tweede van gemaakt.

  BOTSINGEN WORDEN GEMELD EN NIET OPGELOST. Twee rijen die na het herberekenen dezelfde sleutel
  krijgen zijn echte duplicaten, en welke van de twee blijft is een oordeel: bij Oaklyn gaat het
  om paren als "Frankes Stofferingen" en "Frankes Stofferingen B.V.", waar de een klantgegevens
  kan dragen die de ander mist. Samenvoegen doe je daarna met mergeLeads, per stuk.
*/
export async function hernormaliseerLeads(adapter, { companyId, toepassen = false } = {}) {
  if (!companyId) throw new Error('hernormaliseerLeads vereist companyId.');
  const leads = (await adapter.fetchLeads()).filter((l) => l.company_id === companyId);

  const nieuwPer = new Map();
  for (const l of leads) {
    const sleutel = `${normalizeLeadName(l.naam)}|${String(l.plaats || '').toLowerCase()}`;
    if (!nieuwPer.has(sleutel)) nieuwPer.set(sleutel, []);
    nieuwPer.get(sleutel).push(l);
  }

  const botsingen = [...nieuwPer.values()]
    .filter((groep) => groep.length > 1)
    .map((groep) => groep.map((l) => ({ id: l.id, naam: l.naam })));

  const teDoen = leads.filter((l) => normalizeLeadName(l.naam) !== l.genormaliseerde_naam);
  if (botsingen.length || !toepassen) {
    return { toegepast: false, aantal: teDoen.length, botsingen };
  }

  for (const l of teDoen) {
    await adapter.updateLead(l.id, { genormaliseerde_naam: normalizeLeadName(l.naam) });
  }
  return { toegepast: true, aantal: teDoen.length, botsingen: [] };
}

/*
  Voegt twee leads samen die hetzelfde werk blijken te zijn.

  Dat gebeurt doordat dezelfde aanvraag twee keer binnenkomt onder een andere noemer: een keer op
  de naam van de klant en een keer op het adres. Bij WBW waren dat "Ellen (verbouwlijst)" en
  "Kerkveldweg 3 Itteren" (Jelle 26-08-2026: "ellen is van kerkveldweg dus die kunnen samen").
  Op het tabblad staan ze dan twee keer in dezelfde fase, en dan lijkt de pijplijn voller dan hij is.

  Alles wat aan de verdwijnende lead hangt gaat mee: contactmomenten, personen, kansen, vragen,
  bezwaren en taken. Dat gebeurt in de adapter, die uit de catalogus leest welke kolommen naar
  sales_leads wijzen; een lijst in de code zou bij de eerstvolgende migratie stil incompleet worden.

  De notities van beide gaan mee, met de verdwenen naam erbij. Die naam is vaak juist de reden dat
  er twee waren: wie in oude mail "Ellen" zoekt moet de lead nog kunnen vinden.
*/
export async function mergeLeads(adapter, { companyId, keepRef, dropRef } = {}) {
  if (!companyId) throw new Error('mergeLeads vereist companyId.');
  if (!adapter.mergeReferences) throw new Error('deze adapter ondersteunt mergeReferences niet.');

  const blijft = await resolveLeadByRef(adapter, { companyId, ref: keepRef });
  const gaatWeg = await resolveLeadByRef(adapter, { companyId, ref: dropRef });
  if (!blijft) return { merged: false, reason: `lead niet gevonden: '${keepRef}'` };
  if (!gaatWeg) return { merged: false, reason: `lead niet gevonden: '${dropRef}'` };
  if (blijft.id === gaatWeg.id) return { merged: false, reason: 'dit is een en dezelfde lead' };

  const oud = String(blijft.notities || '').trim();
  const mee = String(gaatWeg.notities || '').trim();
  const samen = `${oud}${oud ? '\n\n' : ''}Samengevoegd met de lead "${gaatWeg.naam}"${mee ? `: ${mee}` : '.'}`;
  await adapter.updateLead(blijft.id, { notities: samen });

  const uit = await adapter.mergeReferences('sales_leads', blijft.id, gaatWeg.id);
  return {
    merged: true,
    blijft: { id: blijft.id, naam: blijft.naam },
    weg: { id: gaatWeg.id, naam: gaatWeg.naam },
    ...uit,
  };
}

/*
  Faseovergang: de fase wordt op naam binnen een pipeline opgezocht; onbekend wordt
  gemeld met de beschikbare fasen, niet geraden.
*/
export async function setLeadFase(adapter, { companyId, leadId, faseNaam, pipeline = 'acquisitie' } = {}) {
  if (!companyId || !leadId) throw new Error('setLeadFase vereist companyId en leadId.');
  if (!faseNaam) throw new Error('setLeadFase vereist --naar (de fasenaam).');
  const fase = await adapter.findPipelineFase(companyId, pipeline, faseNaam);
  if (!fase) {
    const alle = (await adapter.fetchPipelineFases())
      .filter((f) => f.company_id === companyId && f.pipeline === pipeline)
      .map((f) => f.naam);
    const hint = alle.length ? `Beschikbaar in ${pipeline}: ${alle.join(', ')}.` : `Er zijn nog geen fasen voor ${pipeline}; draai eerst de seed.`;
    throw new Error(`fase '${faseNaam}' bestaat niet in pipeline ${pipeline}. ${hint}`);
  }
  await adapter.updateLead(leadId, { pipeline_fase_id: fase.id });
  return { faseId: fase.id, naam: fase.naam, pipeline: fase.pipeline, isEindfase: fase.is_eindfase === true };
}

/*
  Het actuele discovery-beeld per lead: de laatste waarde per veld, waarbij een
  bevestigde waarde boven een waarschijnlijke of onbekende gaat (de view uit het
  ontwerp, hier als functie zodat mock en pg hetzelfde antwoord geven).
*/
export function latestDiscoveryPerVeld(answers = []) {
  const rang = { bevestigd: 2, waarschijnlijk: 1, onbekend: 0 };
  const beeld = new Map();
  const sorted = [...answers].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  for (const a of sorted) {
    const huidig = beeld.get(a.veld);
    if (!huidig || (rang[a.zekerheid] ?? 0) >= (rang[huidig.zekerheid] ?? 0)) beeld.set(a.veld, a);
  }
  return beeld;
}

/*
  Het bedrijfsscherm (fase 1, CLI-uitvoer): alles wat je in een oogopslag wilt weten.
  Leest alleen; het renderen doet de CLI.
*/
export async function buildLeadScreen(adapter, { companyId, leadId, limitTijdlijn = 10 } = {}) {
  const lead = await adapter.getLeadById(leadId);
  if (!lead || lead.company_id !== companyId) throw new Error('lead niet gevonden binnen dit bedrijf.');

  const fasen = await adapter.fetchPipelineFases();
  const fase = lead.pipeline_fase_id ? fasen.find((f) => f.id === lead.pipeline_fase_id) : null;

  const people = await adapter.fetchPeople();
  const contacten = (await adapter.fetchLeadPeople())
    .filter((p) => p.lead_id === leadId)
    .map((p) => ({ ...p, persoon: people.find((x) => x.id === p.person_id) || null }));

  const interacties = (await adapter.fetchInteractions()).filter((i) => i.lead_id === leadId);
  const antwoorden = (await adapter.fetchDiscoveryAnswers()).filter((a) => a.lead_id === leadId);
  const vragen = (await adapter.fetchQuestions()).filter((q) => q.lead_id === leadId);
  const bezwaren = (await adapter.fetchObjections()).filter((o) => o.lead_id === leadId);
  const kansen = (await adapter.fetchOpportunities()).filter((o) => o.lead_id === leadId);
  const taken = (await adapter.fetchTasks())
    .filter((t) => t.lead_id === leadId && t.status !== 'done')
    .sort((a, b) => String(a.due_date || a.due_at || '9999').localeCompare(String(b.due_date || b.due_at || '9999')));

  return {
    lead,
    fase: fase ? { naam: fase.naam, pipeline: fase.pipeline } : null,
    contacten,
    discovery: latestDiscoveryPerVeld(antwoorden),
    vragen,
    bezwaren,
    kansen: kansen.sort((a, b) => String(a.projectdatum || '9999').localeCompare(String(b.projectdatum || '9999'))),
    openTaken: taken,
    tijdlijn: interacties.slice(0, limitTijdlijn),
  };
}

/* De leadlijst per bedrijf, met fasenaam en laatste contactmoment erbij. */
export async function buildLeadList(adapter, { companyId } = {}) {
  const leads = (await adapter.fetchLeads()).filter((l) => l.company_id === companyId);
  const fasen = await adapter.fetchPipelineFases();
  const interacties = await adapter.fetchInteractions();
  return leads.map((l) => {
    const fase = l.pipeline_fase_id ? fasen.find((f) => f.id === l.pipeline_fase_id) : null;
    const laatste = interacties.find((i) => i.lead_id === l.id) || null;
    return {
      ...l,
      fase_naam: fase ? fase.naam : null,
      laatste_contact: laatste ? laatste.started_at : null,
    };
  }).sort((a, b) => String(a.naam).localeCompare(String(b.naam)));
}
