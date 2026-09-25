/*
  Jarvis - dashboard-data: de leeslaag achter het dashboard van Framr.One Sales.

  Pure functies over de datasets die de adapter oplevert; geen database, geen netwerk.
  Elk scherm van het dashboard heeft hier zijn bouwer: de dagstand (wat is er vandaag gedaan),
  de funnel in twee weergaven (huidige verdeling en conversie over tijd van een startgroep), het
  weekrapport met herleidbare cijfers, de leadlijst met filters, de opvolging, de agenda, de
  gesprekken en opnames, de bezwarenbibliotheek, de demo's, de partneractivatie, de feedback
  en de inventaris van alle data. De werklijst, de dagselectie en het dashboard-overzicht
  staan in belronde-store.mjs; dit bestand bouwt daarop verder.

  Elk cijfer in de rapporten draagt zijn definitie en de ids van de onderliggende records
  (herleiding), zodat het scherm kan doorklikken en niemand hoeft te raden wat er geteld is.

  Stijl: blokcommentaar, geen lange streepjes en geen emoji, conform de projectafspraken.
*/

import {
  dagVan, tijdVan, plusDagen, contactIndex, classificatieIndex, researchIndex, NIET_BEREIKT, FRAMR_PIPELINE, EINDFASEN,
  isInhoudelijk, splitsUitkomst, commercieleFase, trajectstatus, reactieStatus, volgendeActieVoor, laatsteContactVoor, claimIsActief, COMMERCIELE_FASEN,
  ONBOARDING_MIJLPALEN,
} from './belronde-store.mjs?v=5dd6073';
import { normalizeLeadName } from './crm-store.mjs?v=5dd6073';

/* ---------- partners: activatie per mijlpaal en gezondheid ---------- */

/* De mijlpalen van de partneractivatie (brainstorm onderdeel 18), in de volgorde waarin een
   partner ze normaal haalt. Waar geen datum is, is de mijlpaal niet gehaald. Dezelfde lijst
   draagt het onboardinggesprek (ONBOARDING_MIJLPALEN in belronde-store): een bron per soort
   feit, zodat het scherm en het gesprek niet uit elkaar kunnen lopen. */
export const PARTNER_MIJLPALEN = ONBOARDING_MIJLPALEN;

export const GEZONDHEID = ['nieuw', 'onboarding', 'actief', 'groeiend', 'aandacht_nodig', 'slapend', 'afgehaakt'];

function minDatum(rijen, veld = 'created_at') {
  let min = null;
  for (const r of rijen) {
    const d = dagVan(r[veld]);
    if (d && (!min || d < min)) min = d;
  }
  return min;
}

function maxDatum(rijen, velden = ['updated_at', 'created_at']) {
  let max = null;
  for (const r of rijen) {
    for (const v of velden) {
      const d = dagVan(r[v]);
      if (d && (!max || d > max)) max = d;
    }
  }
  return max;
}

function dagenTussen(a, b) {
  if (!a || !b) return null;
  const [j1, m1, d1] = String(a).split('-').map(Number);
  const [j2, m2, d2] = String(b).split('-').map(Number);
  return Math.round((new Date(j2, m2 - 1, d2) - new Date(j1, m1 - 1, d1)) / 86400000);
}

const GEWONNEN = new Set(['gewonnen', 'akkoord', 'geaccepteerd', 'getekend']);

export function bouwPartnerbeeld({
  partners = [], projects = [], measurements = [], quotes = [], invoices = [], customers = [],
  calculations = [], orders = [], vandaag, companyId,
} = {}) {
  if (!vandaag) throw new Error('bouwPartnerbeeld vereist vandaag.');
  const eigen = partners.filter((p) => !companyId || p.company_id === companyId);
  const van = (rijen, p) => rijen.filter((r) => r.partner_id === p.id);
  const lijst = eigen.map((p) => {
    const kl = van(customers, p);
    const pr = van(projects, p);
    const im = van(measurements, p);
    const ca = van(calculations, p);
    const of = van(quotes, p);
    const fa = van(invoices, p);
    const be = van(orders, p);
    const gewonnen = of.filter((q) => GEWONNEN.has(String(q.status || '').toLowerCase()));
    const datums = {
      account_aangemaakt: dagVan(p.created_at),
      vrijgegeven: dagVan(p.vrijgegeven_op),
      klant_in_de_winkel: p.shopify_customer_id ? (dagVan(p.niveau_gecheckt_op) || dagVan(p.created_at)) : null,
      niveau_gekozen: p.niveau ? (dagVan(p.niveau_gecheckt_op) || dagVan(p.created_at)) : null,
      bedrijfsprofiel_ingevuld: p.kvk && p.adres && p.email ? (dagVan(p.updated_at) || dagVan(p.created_at)) : null,
      logo_toegevoegd: p.logo_data || p.logo_pad ? (dagVan(p.updated_at) || dagVan(p.created_at)) : null,
      bankgegevens: p.iban ? (dagVan(p.updated_at) || dagVan(p.created_at)) : null,
      eerste_klant: minDatum(kl),
      eerste_klus: minDatum(pr),
      eerste_inmeting: minDatum(im, 'gemeten_op') || minDatum(im),
      eerste_calculatie: minDatum(ca),
      eerste_offerte: minDatum(of),
      eerste_offerte_verstuurd: minDatum(of.filter((q) => q.verstuurd_op), 'verstuurd_op'),
      eerste_akkoord: minDatum(gewonnen, 'beslist_op') || minDatum(gewonnen, 'updated_at'),
      eerste_factuur: minDatum(fa, 'factuurdatum') || minDatum(fa),
      eerste_bestelling: minDatum(be, 'besteld_op') || minDatum(be),
    };
    const mijlpalen = PARTNER_MIJLPALEN.map((naam) => ({ naam, datum: datums[naam] || null, gehaald: Boolean(datums[naam]) }));
    const laatsteGehaald = [...mijlpalen].reverse().find((m) => m.gehaald);
    const eersteOpen = mijlpalen.find((m) => !m.gehaald);
    const activiteit = maxDatum([...pr, ...im, ...ca, ...of, ...fa, ...be, ...kl]) || dagVan(p.updated_at) || dagVan(p.created_at);
    const dagenStil = dagenTussen(activiteit, vandaag);
    const dagenAccount = dagenTussen(dagVan(p.created_at), vandaag);
    const laatsteBestelling = maxDatum(be, ['besteld_op', 'created_at']);
    const bestellingen60 = be.filter((o) => dagenTussen(dagVan(o.besteld_op || o.created_at), vandaag) <= 60).length;

    let gezondheid = 'actief';
    if (!be.length && !of.length && !im.length && !pr.length && dagenAccount !== null && dagenAccount <= 7) gezondheid = 'nieuw';
    else if (dagenAccount !== null && dagenAccount <= 30 && !be.length) gezondheid = 'onboarding';
    else if (bestellingen60 >= 2) gezondheid = 'groeiend';
    else if (dagenStil !== null && dagenStil > 90) gezondheid = 'afgehaakt';
    else if (dagenStil !== null && dagenStil > 60) gezondheid = 'slapend';
    else if (dagenStil !== null && dagenStil > 30) gezondheid = 'aandacht_nodig';

    const omzet = fa.filter((f) => String(f.status || '') !== 'concept').reduce((s, f) => s + (Number(f.totaal) || 0), 0);
    return {
      id: p.id,
      bedrijfsnaam: p.bedrijfsnaam || 'zonder naam',
      plaats: p.plaats || null,
      niveau: p.niveau || null,
      klantBron: p.klant_bron || null,
      mijlpalen,
      gehaald: mijlpalen.filter((m) => m.gehaald).length,
      vastgelopenBij: eersteOpen ? eersteOpen.naam : null,
      laatsteMijlpaal: laatsteGehaald ? laatsteGehaald.naam : null,
      activiteit,
      dagenStil,
      gezondheid,
      cijfers: {
        klanten: kl.length, klussen: pr.length, inmetingen: im.length, calculaties: ca.length,
        offertes: of.length, offertesGewonnen: gewonnen.length, facturen: fa.length, omzet: Math.round(omzet * 100) / 100,
        bestellingen: be.length, bestelBedrag: Math.round(be.reduce((s, o) => s + (Number(o.bedrag_ex) || 0), 0) * 100) / 100,
        m2: Math.round(im.reduce((s, m) => s + (Number(m.totaal_m2) || 0), 0)),
        laatsteBestelling, dagenSindsBestelling: dagenTussen(laatsteBestelling, vandaag),
      },
    };
  }).sort((a, b) => GEZONDHEID.indexOf(a.gezondheid) - GEZONDHEID.indexOf(b.gezondheid) || String(a.bedrijfsnaam).localeCompare(String(b.bedrijfsnaam)));

  const perGezondheid = Object.fromEntries(GEZONDHEID.map((g) => [g, lijst.filter((p) => p.gezondheid === g).length]));
  const perMijlpaal = PARTNER_MIJLPALEN.map((naam) => ({ naam, aantal: lijst.filter((p) => p.mijlpalen.find((m) => m.naam === naam).gehaald).length }));
  return {
    partners: lijst,
    totaal: lijst.length,
    perGezondheid,
    perMijlpaal,
    omzet: Math.round(lijst.reduce((s, p) => s + p.cijfers.omzet, 0) * 100) / 100,
    bestellingen: lijst.reduce((s, p) => s + p.cijfers.bestellingen, 0),
    m2: lijst.reduce((s, p) => s + p.cijfers.m2, 0),
    risico: lijst.filter((p) => ['aandacht_nodig', 'slapend'].includes(p.gezondheid)).map((p) => p.bedrijfsnaam),
  };
}

/* De zes bewezen antwoorden uit het gesprekssysteem (Jelle 02-08-2026, hoofdstuk 7): de regel
   erachter is dat elk antwoord maar twee uitkomsten kent, het proefproject of een datum, en
   nooit een prijsdiscussie. Wat de gesprekken zelf opleveren komt hier bovenop. */
export const VASTE_ANTWOORDEN = [
  { categorie: 'huidige leverancier', bezwaar: 'Ik heb al een leverancier', antwoord: 'Eerst vragen wat hij juist prettig vindt aan die leverancier, hem laten praten, en dan: dat snap ik, we vragen ook niet om over te stappen. Probeer ons eens bij een project, dan vergelijk je zelf.' },
  { categorie: 'prijs', bezwaar: 'Ik krijg al goede prijzen', antwoord: 'Niet in discussie. Vragen hoe hij vergelijkt: alleen de vloerprijs of het hele project. Dan vertellen dat naast de vloer ook de calculator, de offerte en de materiaalberekening meekomen, en: vergelijk het gewoon eens bij een project.' },
  { categorie: 'geen tijd', bezwaar: 'Ik heb geen tijd', antwoord: 'Juist daarom bel ik: de meeste partners besparen tijd doordat projecten sneller doorgerekend zijn. Niet doordrukken; vragen wanneer het beter uitkomt.' },
  { categorie: 'overstappen', bezwaar: 'Ik wil niet overstappen', antwoord: 'Dat hoeft ook niet. Vergelijk ons gewoon eens bij een project.' },
  { categorie: 'levering', bezwaar: 'Ik wil eerst mijn voorraad opmaken', antwoord: 'Logisch. Wanneer verwacht je ongeveer weer nieuw materiaal nodig te hebben? Dat wordt het opvolgmoment.' },
  { categorie: 'anders', bezwaar: 'Stuur maar een mail', antwoord: 'Doe ik graag. Waar let jij vooral op als je zo een mail bekijkt? Dat zegt wat belangrijk is, en het geeft een vervolgmoment.' },
];


/* ---------- de bezwarenbibliotheek ---------- */

/*
  Per categorie: de aantallen, de letterlijke uitspraken met doorklik naar lead en gesprek,
  de reacties met hoe vaak ze werkten (ja, gedeeltelijk, nee, onbekend), het onderscheid
  tussen tijdelijk en definitief, en naast onze eigen beoordeling ook de daadwerkelijke
  voortgang: kwam de lead na dit bezwaar tot een demo of verder.
*/
export function bouwBezwarenbibliotheek({ bezwaren = [], leads = [], people = [], interacties = [], fasen = [], afspraken = [], companyId, zoek = '', categorie = '' } = {}) {
  const leadOpId = new Map(leads.map((l) => [l.id, l]));
  const faseOpId = new Map(fasen.map((f) => [f.id, f]));
  const interOpId = new Map(interacties.map((i) => [i.id, i]));
  const persoon = new Map(people.map((p) => [p.id, p.name]));
  const volgorde = new Map(fasen.map((f) => [f.naam, f.volgorde]));
  const demoOf = new Set(afspraken.map((a) => a.lead_id));
  const voortgangVan = (leadId) => {
    const l = leadOpId.get(leadId);
    const naam = l && l.pipeline_fase_id ? (faseOpId.get(l.pipeline_fase_id) || {}).naam : null;
    const v = volgorde.get(naam) || 0;
    if (v >= (volgorde.get('account_aangemaakt') || 12) && v <= 17) return 'account';
    if (v >= (volgorde.get('demo_gepland') || 9) || demoOf.has(leadId)) return 'demo';
    return null;
  };
  const resultaatVan = (b) => b.reactie_resultaat || (b.reactie_werkte === true ? 'ja' : (b.reactie_werkte === false ? 'nee' : 'onbekend'));
  const z = String(zoek || '').trim().toLowerCase();
  const eigen = bezwaren.filter((b) => (!companyId || b.company_id === companyId))
    .filter((b) => !categorie || (b.categorie || 'zonder categorie') === categorie)
    .filter((b) => !z || [b.bezwaar, b.gegeven_reactie, b.context, (leadOpId.get(b.lead_id) || {}).naam].some((v) => String(v || '').toLowerCase().includes(z)));
  const perCategorie = new Map();
  for (const b of eigen) {
    const k = b.categorie || 'zonder categorie';
    if (!perCategorie.has(k)) perCategorie.set(k, { categorie: k, aantal: 0, leads: new Set(), reacties: new Map(), voorbeelden: [], tijdelijk: 0, definitief: 0, voortgang: { demo: 0, account: 0 } });
    const c = perCategorie.get(k);
    c.aantal += 1;
    c.leads.add(b.lead_id);
    if (b.soort === 'tijdelijk') c.tijdelijk += 1;
    if (b.soort === 'definitief') c.definitief += 1;
    const vg = voortgangVan(b.lead_id);
    if (vg) c.voortgang[vg] += 1;
    const res = resultaatVan(b);
    if (b.gegeven_reactie) {
      if (!c.reacties.has(b.gegeven_reactie)) c.reacties.set(b.gegeven_reactie, { reactie: b.gegeven_reactie, ja: 0, gedeeltelijk: 0, nee: 0, onbekend: 0, bellers: new Set(), voortgang: 0 });
      const r = c.reacties.get(b.gegeven_reactie);
      r[res] += 1;
      if (vg) r.voortgang += 1;
      const wie = persoon.get((interOpId.get(b.interaction_id) || {}).door_person_id);
      if (wie) r.bellers.add(wie);
    }
    const i = interOpId.get(b.interaction_id);
    c.voorbeelden.push({
      id: b.id, bezwaar: b.bezwaar, context: b.context || null, reactie: b.gegeven_reactie || null, resultaat: res, soort: b.soort || null, afspraak: b.afspraak || null, vervolgactie: b.vervolgactie || null,
      lead: (leadOpId.get(b.lead_id) || {}).naam || null, leadId: b.lead_id, interactionId: b.interaction_id || null, stap: i ? i.stap || null : null, door: i ? persoon.get(i.door_person_id) || null : null,
      datum: dagVan(b.created_at), voortgang: vg,
    });
  }
  const categorieen = [...perCategorie.values()].map((c) => {
    const reacties = [...c.reacties.values()].map((r) => {
      const beoordeeld = r.ja + r.gedeeltelijk + r.nee;
      return { reactie: r.reactie, ja: r.ja, gedeeltelijk: r.gedeeltelijk, nee: r.nee, onbekend: r.onbekend, beoordeeld, voortgang: r.voortgang, bellers: [...r.bellers],
        werkte: r.ja, werkteNiet: r.nee, score: beoordeeld ? Math.round(((r.ja + r.gedeeltelijk * 0.5) / beoordeeld) * 100) : null,
        tekst: beoordeeld ? `werkte in ${r.ja} van ${beoordeeld} beoordeelde gesprekken${r.gedeeltelijk ? `, ${r.gedeeltelijk} keer deels` : ''}` : 'nog niet beoordeeld' };
    }).sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || (b.beoordeeld + b.onbekend) - (a.beoordeeld + a.onbekend));
    const ja = c.voorbeelden.filter((v) => v.resultaat === 'ja').length;
    const deels = c.voorbeelden.filter((v) => v.resultaat === 'gedeeltelijk').length;
    const beoordeeld = c.voorbeelden.filter((v) => ['ja', 'gedeeltelijk', 'nee'].includes(v.resultaat)).length;
    return {
      categorie: c.categorie, aantal: c.aantal, uniekeLeads: c.leads.size, tijdelijk: c.tijdelijk, definitief: c.definitief,
      opgevangen: ja, deels, beoordeeld, opgelostPct: beoordeeld ? Math.round((ja / beoordeeld) * 100) : null,
      voortgang: c.voortgang, besteReactie: reacties.find((r) => r.ja > 0) || null, reacties,
      voorbeelden: c.voorbeelden.sort((a, b) => String(b.datum).localeCompare(String(a.datum))),
      vastAntwoord: VASTE_ANTWOORDEN.find((v) => v.categorie === c.categorie) || null,
    };
  }).sort((a, b) => b.aantal - a.aantal);
  return {
    totaal: eigen.length,
    categorieen,
    alleCategorieen: [...new Set(bezwaren.filter((b) => !companyId || b.company_id === companyId).map((b) => b.categorie || 'zonder categorie'))].sort(),
    vasteAntwoorden: VASTE_ANTWOORDEN,
    regel: 'Elk antwoord kent twee uitkomsten: het proefproject of een datum. Nooit een prijsdiscussie. Een bezwaar is niet opgevangen als het gesprek eindigt zonder proef en zonder datum.',
    uitleg: 'Werkte is onze beoordeling na het gesprek (ja, gedeeltelijk, nee). Voortgang is wat er daarna echt gebeurde: een demo of een account.',
  };
}

/* De bezwaren van een lead, om te tonen bij een volgend contactmoment. */
export function bezwarenVanLead({ bezwaren = [], leadId, interacties = [] } = {}) {
  const interOpId = new Map(interacties.map((i) => [i.id, i]));
  return bezwaren.filter((b) => b.lead_id === leadId).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).map((b) => ({
    id: b.id, bezwaar: b.bezwaar, categorie: b.categorie || null, context: b.context || null, reactie: b.gegeven_reactie || null,
    resultaat: b.reactie_resultaat || (b.reactie_werkte === true ? 'ja' : (b.reactie_werkte === false ? 'nee' : 'onbekend')), soort: b.soort || null,
    afspraak: b.afspraak || null, vervolgactie: b.vervolgactie || null, datum: dagVan(b.created_at), stap: (interOpId.get(b.interaction_id) || {}).stap || null, interactionId: b.interaction_id || null,
  }));
}

/* ---------- de dagstand: wat er vandaag al gedaan is ---------- */

function inScope(scope, bellerId, wie, eigenaar) {
  if (scope === 'iedereen') return true;
  const doel = scope === 'mijn' ? bellerId : scope;
  if (!doel) return true;
  return wie ? wie === doel : eigenaar === doel;
}

/*
  Het dagoverzicht van wat er gedaan is: unieke leads behandeld naast contactmomenten,
  belpogingen, personen bereikt, inhoudelijke gesprekken, berichten per kanaal, reacties
  ontvangen, demo's gepland en uitgevoerd, vervolgafspraken gemaakt en taken afgerond. Elk
  cijfer met de ids erachter.
*/
export function bouwDagstand({ interacties = [], taken = [], afspraken = [], leads = [], people = [], bellerId, scope = 'mijn', vandaag, dagdoel = 10, companyId } = {}) {
  if (!vandaag) throw new Error('bouwDagstand vereist vandaag.');
  const leadOpId = new Map(leads.filter((l) => !companyId || !l.company_id || l.company_id === companyId).map((l) => [l.id, l]));
  const eigenaarVan = (leadId) => (leadOpId.get(leadId) || {}).toegewezen_aan || null;
  const vandaagInter = interacties.filter((i) => leadOpId.has(i.lead_id) && dagVan(i.started_at) === vandaag && inScope(scope, bellerId, i.door_person_id, eigenaarVan(i.lead_id)));
  const uitgaand = vandaagInter.filter((i) => i.richting !== 'inkomend' && i.type !== 'note');
  const calls = uitgaand.filter((i) => i.type === 'call');
  const bereikt = calls.filter((i) => i.uitkomst && !NIET_BEREIKT.has(i.uitkomst));
  const inhoudelijk = calls.filter((i) => isInhoudelijk(i.uitkomst));
  const whatsapp = uitgaand.filter((i) => i.type === 'whatsapp');
  const email = uitgaand.filter((i) => i.type === 'email');
  const reacties = vandaagInter.filter((i) => i.richting === 'inkomend');
  const demosGepland = afspraken.filter((a) => leadOpId.has(a.lead_id) && dagVan(a.created_at) === vandaag && inScope(scope, bellerId, a.verantwoordelijke, eigenaarVan(a.lead_id)));
  const demosUitgevoerd = afspraken.filter((a) => leadOpId.has(a.lead_id) && a.status === 'uitgevoerd' && dagVan(a.start_at) === vandaag && inScope(scope, bellerId, a.verantwoordelijke, eigenaarVan(a.lead_id)));
  const vervolg = taken.filter((t) => t.lead_id && leadOpId.has(t.lead_id) && dagVan(t.created_at) === vandaag && inScope(scope, bellerId, t.assignee, eigenaarVan(t.lead_id)));
  const afgerond = taken.filter((t) => t.lead_id && leadOpId.has(t.lead_id) && t.status === 'done' && dagVan(t.afgerond_op) === vandaag && inScope(scope, bellerId, t.assignee, eigenaarVan(t.lead_id)));
  const ids = (rijen) => rijen.map((r) => r.id);
  const uniek = new Set(uitgaand.map((i) => i.lead_id));
  return {
    vandaag, scope, dagdoel,
    uniekeLeads: { aantal: uniek.size, leadIds: [...uniek], definitie: 'bedrijven met minstens een uitgaand contactmoment vandaag' },
    contactmomenten: { aantal: uitgaand.length, ids: ids(uitgaand), definitie: 'uitgaande contactmomenten vandaag (gesprek, WhatsApp, mail, demo)' },
    belpogingen: { aantal: calls.length, ids: ids(calls), definitie: 'uitgaande gesprekken vandaag, ook zonder gehoor' },
    bereikt: { aantal: bereikt.length, ids: ids(bereikt), definitie: 'gesprekken waarin de juiste persoon aan de lijn was' },
    inhoudelijk: { aantal: inhoudelijk.length, ids: ids(inhoudelijk), definitie: 'bereikt en meer dan een terugbelverzoek, geen tijd of gestopt' },
    whatsapp: { aantal: whatsapp.length, ids: ids(whatsapp), definitie: 'WhatsApp-berichten als verstuurd bevestigd' },
    email: { aantal: email.length, ids: ids(email), definitie: 'mails als verstuurd bevestigd' },
    reacties: { aantal: reacties.length, ids: ids(reacties), definitie: 'inkomende reacties vastgelegd vandaag' },
    demosGepland: { aantal: demosGepland.length, ids: ids(demosGepland), definitie: 'afspraken die vandaag zijn gemaakt' },
    demosUitgevoerd: { aantal: demosUitgevoerd.length, ids: ids(demosUitgevoerd), definitie: 'afspraken van vandaag die als uitgevoerd staan' },
    vervolgafspraken: { aantal: vervolg.length, ids: ids(vervolg), definitie: 'taken die vandaag zijn aangemaakt' },
    afgerondeTaken: { aantal: afgerond.length, ids: ids(afgerond), definitie: 'taken die vandaag met een resultaat zijn gesloten' },
    dagdoelGehaald: dagdoel ? uniek.size >= dagdoel : null,
  };
}

/* ---------- de funnel: huidige verdeling en conversie over tijd ---------- */

/*
  Weergave een: waar de leads nu staan. Per commerciele fase (met de hoofdstatussen eronder en
  de ids om door te klikken), per trajectstatus, en de leads zonder status apart. Dit is een
  momentopname en meet geen conversie.
*/
export function bouwFunnelVerdeling({ leads = [], fasen = [], vandaag, companyId, pipeline = FRAMR_PIPELINE } = {}) {
  const eigen = leads.filter((l) => !companyId || l.company_id === companyId);
  const faseOpId = new Map(fasen.filter((f) => f.pipeline === pipeline).map((f) => [f.id, f]));
  const perCommercieel = new Map(COMMERCIELE_FASEN.map((c) => [c, { fase: c, aantal: 0, leadIds: [], hoofdstatussen: new Map() }]));
  perCommercieel.set('verloren', { fase: 'verloren', aantal: 0, leadIds: [], hoofdstatussen: new Map() });
  const traject = { actief: 0, gepauzeerd: 0, verloren: 0 };
  const zonder = [];
  for (const l of eigen) {
    const f = l.pipeline_fase_id ? faseOpId.get(l.pipeline_fase_id) : null;
    const naam = f ? f.naam : null;
    if (!naam) zonder.push(l.id);
    const c = commercieleFase(naam) || 'verloren';
    const e = perCommercieel.get(c);
    e.aantal += 1;
    e.leadIds.push(l.id);
    const h = naam || 'zonder status';
    e.hoofdstatussen.set(h, (e.hoofdstatussen.get(h) || 0) + 1);
    traject[trajectstatus({ faseNaam: naam, gepauzeerdTot: l.gepauzeerd_tot, vandaag }).status] += 1;
  }
  const pipelineFasen = fasen.filter((f) => f.pipeline === pipeline && (!companyId || f.company_id === companyId)).sort((a, b) => a.volgorde - b.volgorde);
  return {
    vandaag, totaal: eigen.length,
    commercieel: [...perCommercieel.values()].map((e) => ({ fase: e.fase, aantal: e.aantal, leadIds: e.leadIds, hoofdstatussen: [...e.hoofdstatussen.entries()].map(([naam, aantal]) => ({ naam, aantal })) })),
    hoofdstatussen: pipelineFasen.map((f) => ({ volgorde: f.volgorde, naam: f.naam, commercieel: commercieleFase(f.naam), aantal: eigen.filter((l) => l.pipeline_fase_id === f.id).length })),
    zonderStatus: { aantal: zonder.length, leadIds: zonder, uitleg: 'leads zonder hoofdstatus tellen als nieuw; zet ze met een klik op nieuwe_lead' },
    trajectstatus: traject,
    definitie: 'Momentopname van waar elke lead nu staat. Geen conversie: daarvoor de weergave over tijd.',
  };
}

function mediaan(a) {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round(((s[m - 1] + s[m]) / 2) * 10) / 10;
}
function dagenTussenDatums(a, b) {
  if (!a || !b) return null;
  const [j1, m1, d1] = String(a).split('-').map(Number);
  const [j2, m2, d2] = String(b).split('-').map(Number);
  return Math.round((new Date(j2, m2 - 1, d2) - new Date(j1, m1 - 1, d1)) / 86400000);
}

/* De koppeling tussen een lead en een partner in het portaal: op de verwijzing, anders op de
   genormaliseerde naam. Zo zijn het partnerbeeld en het dossier aantoonbaar hetzelfde bedrijf. */
export function partnerKoppeling({ leads = [], partners = [] } = {}) {
  const opRef = new Map(partners.map((p) => [String(p.id), p]));
  const opNaam = new Map(partners.map((p) => [normalizeLeadName(p.bedrijfsnaam || ''), p]));
  const uit = new Map();
  for (const l of leads) {
    if (l.portal_partner_ref && opRef.has(String(l.portal_partner_ref))) { uit.set(l.id, { partner: opRef.get(String(l.portal_partner_ref)), koppeling: 'verwijzing' }); continue; }
    const p = opNaam.get(normalizeLeadName(l.naam || ''));
    if (p) uit.set(l.id, { partner: p, koppeling: 'naam' });
  }
  return uit;
}

/*
  Weergave twee: conversie over tijd. Van een startgroep (leads die in de periode voor het
  eerst benaderd zijn) hoeveel er bereikt, inhoudelijk gesproken, gekwalificeerd, tot een demo,
  een account, een eerste project, een eerste bestelling en een actieve partner kwamen. Elke
  stap met teller, noemer, definitie en ids; unieke leads, geen contactmomenten. Een lead die
  zonder demo doorgaat telt gewoon mee bij account. Daarbij de tijd tussen stappen, de
  uitvalredenen, het aantal pogingen voor bereikt, en de uitsplitsing per beller, bron en
  scriptversie.
*/
export function bouwCohortConversie({ leads = [], fasen = [], interacties = [], afspraken = [], partners = [], projects = [], orders = [], people = [], van, tot, companyId, pipeline = FRAMR_PIPELINE } = {}) {
  if (!van || !tot) throw new Error('bouwCohortConversie vereist van en tot.');
  const eigen = leads.filter((l) => !companyId || l.company_id === companyId);
  const faseOpId = new Map(fasen.filter((f) => f.pipeline === pipeline).map((f) => [f.id, f]));
  const volgorde = new Map(fasen.filter((f) => f.pipeline === pipeline).map((f) => [f.naam, f.volgorde]));
  const naamVan = new Map(people.map((p) => [p.id, p.name]));
  const koppel = partnerKoppeling({ leads: eigen, partners });
  const perLead = new Map();
  for (const i of interacties) {
    if (!perLead.has(i.lead_id)) perLead.set(i.lead_id, []);
    perLead.get(i.lead_id).push(i);
  }
  for (const lijst of perLead.values()) lijst.sort((a, b) => String(new Date(a.started_at).toISOString()).localeCompare(String(new Date(b.started_at).toISOString())));
  const eersteUitgaand = (leadId) => (perLead.get(leadId) || []).find((i) => i.richting !== 'inkomend' && i.type !== 'note');
  const cohort = eigen.filter((l) => { const e = eersteUitgaand(l.id); return e && dagVan(e.started_at) >= van && dagVan(e.started_at) <= tot; });
  const faseVolgorde = (l) => volgorde.get((faseOpId.get(l.pipeline_fase_id) || {}).naam) || 0;
  const minstens = (l, naam) => { const v = faseVolgorde(l); return v >= (volgorde.get(naam) || 99) && v <= 17; };
  const calls = (l) => (perLead.get(l.id) || []).filter((i) => i.type === 'call' && i.richting !== 'inkomend');
  const eersteBereikt = (l) => calls(l).find((i) => i.uitkomst && !NIET_BEREIKT.has(i.uitkomst)) || null;
  const gekwalificeerdUit = new Set(['goede_interesse', 'demo_aangeboden', 'demo_ingepland', 'account_gewenst']);
  const stappen = [
    ['benaderd', 'in de periode voor het eerst benaderd (eerste uitgaande contactmoment)', () => true],
    ['bereikt', 'minstens een gesprek met de juiste persoon aan de lijn', (l) => Boolean(eersteBereikt(l))],
    ['inhoudelijk', 'minstens een inhoudelijk gesprek (meer dan terugbellen, geen tijd of gestopt)', (l) => calls(l).some((i) => isInhoudelijk(i.uitkomst))],
    ['gekwalificeerd', 'goede interesse, demo aangeboden of ingepland, of account gewenst; of de fase gekwalificeerd of verder', (l) => calls(l).some((i) => gekwalificeerdUit.has(i.uitkomst)) || minstens(l, 'gekwalificeerd')],
    ['demo_geboekt', 'een demo-afspraak gemaakt (welke status ook)', (l) => afspraken.some((a) => a.lead_id === l.id)],
    ['demo_uitgevoerd', 'een demo uitgevoerd (afspraak uitgevoerd of demo-contactmoment)', (l) => afspraken.some((a) => a.lead_id === l.id && a.status === 'uitgevoerd') || (perLead.get(l.id) || []).some((i) => i.type === 'demo')],
    ['account', 'fase account_aangemaakt of verder, of een partneraccount in het portaal', (l) => minstens(l, 'account_aangemaakt') || koppel.has(l.id)],
    ['eerste_project', 'fase eerste_project of verder, of een klus in het portaal', (l) => minstens(l, 'eerste_project') || (koppel.has(l.id) && projects.some((p) => p.partner_id === koppel.get(l.id).partner.id))],
    ['eerste_bestelling', 'fase eerste_bestelling of verder, of een bestelling in het portaal', (l) => minstens(l, 'eerste_bestelling') || (koppel.has(l.id) && orders.some((o) => o.partner_id === koppel.get(l.id).partner.id))],
    ['actieve_partner', 'fase actieve_partner', (l) => minstens(l, 'actieve_partner')],
  ];
  const noemer = cohort.length;
  const trap = stappen.map(([stap, definitie, test]) => {
    const ids = cohort.filter(test).map((l) => l.id);
    return { stap, definitie, teller: ids.length, noemer, pct: noemer ? Math.round((ids.length / noemer) * 100) : null, leadIds: ids };
  });
  const zonderDemo = cohort.filter((l) => (minstens(l, 'account_aangemaakt') || koppel.has(l.id)) && !afspraken.some((a) => a.lead_id === l.id)).length;
  /* Tijd tussen stappen, in dagen (mediaan). */
  const tijd = { eersteContactNaarBereikt: [], bereiktNaarDemoGeboekt: [], demoGeboektNaarUitgevoerd: [], demoNaarAccount: [] };
  const pogingenVoorBereikt = [];
  for (const l of cohort) {
    const e = eersteUitgaand(l.id);
    const b = eersteBereikt(l);
    const geboekt = afspraken.filter((a) => a.lead_id === l.id).sort((x, y) => String(x.created_at).localeCompare(String(y.created_at)))[0];
    const uitgevoerd = afspraken.find((a) => a.lead_id === l.id && a.status === 'uitgevoerd');
    if (b) { tijd.eersteContactNaarBereikt.push(dagenTussenDatums(dagVan(e.started_at), dagVan(b.started_at))); pogingenVoorBereikt.push(calls(l).findIndex((i) => i.id === b.id) + 1); }
    if (b && geboekt) tijd.bereiktNaarDemoGeboekt.push(dagenTussenDatums(dagVan(b.started_at), dagVan(geboekt.created_at)));
    if (geboekt && uitgevoerd) tijd.demoGeboektNaarUitgevoerd.push(dagenTussenDatums(dagVan(geboekt.created_at), dagVan(uitgevoerd.start_at)));
    if (uitgevoerd && koppel.has(l.id)) tijd.demoNaarAccount.push(dagenTussenDatums(dagVan(uitgevoerd.start_at), dagVan(koppel.get(l.id).partner.created_at)));
  }
  /* Uitvalredenen: de laatste uitkomst van de leads in een eindfase. */
  const uitval = new Map();
  for (const l of cohort.filter((x) => EINDFASEN.has((faseOpId.get(x.pipeline_fase_id) || {}).naam))) {
    const laatste = [...calls(l), ...(perLead.get(l.id) || []).filter((i) => i.type === 'demo')].filter((i) => i.uitkomst).pop();
    const k = laatste ? laatste.uitkomst : 'zonder uitkomst';
    uitval.set(k, (uitval.get(k) || 0) + 1);
  }
  const groepeer = (sleutel) => {
    const m = new Map();
    for (const l of cohort) {
      const k = sleutel(l) || 'onbekend';
      if (!m.has(k)) m.set(k, { naam: k, benaderd: 0, bereikt: 0, gekwalificeerd: 0, demo: 0, account: 0 });
      const e = m.get(k);
      e.benaderd += 1;
      if (eersteBereikt(l)) e.bereikt += 1;
      if (stappen[3][2](l)) e.gekwalificeerd += 1;
      if (stappen[4][2](l)) e.demo += 1;
      if (stappen[6][2](l)) e.account += 1;
    }
    return [...m.values()].sort((a, b) => b.benaderd - a.benaderd);
  };
  return {
    van, tot, cohort: noemer, definitie: 'Startgroep: leads waarvan het eerste uitgaande contactmoment in de periode valt. Elke stap telt unieke leads uit die groep, ongeacht wanneer de stap gehaald is.',
    trap, zonderDemo,
    tijd: Object.fromEntries(Object.entries(tijd).map(([k, v]) => [k, { mediaanDagen: mediaan(v), aantal: v.length }])),
    pogingenVoorBereikt: { gemiddeld: pogingenVoorBereikt.length ? Math.round((pogingenVoorBereikt.reduce((s, x) => s + x, 0) / pogingenVoorBereikt.length) * 10) / 10 : null, aantal: pogingenVoorBereikt.length },
    uitvalredenen: [...uitval.entries()].map(([uitkomst, aantal]) => ({ uitkomst, aantal })).sort((a, b) => b.aantal - a.aantal),
    perBeller: groepeer((l) => naamVan.get((eersteUitgaand(l.id) || {}).door_person_id)),
    perBron: groepeer((l) => l.bron),
    perScript: groepeer((l) => (calls(l)[0] || {}).script_ref),
  };
}

/* ---------- het weekrapport ---------- */

function inVenster(d, van, tot) {
  const dag = dagVan(d);
  return dag && dag >= van && dag <= tot;
}

/* Het venster: de kalenderweek (maandag tot en met zondag) waarin de dag valt, of de afgelopen
   zeven dagen tot en met vandaag. */
export function weekVenster(vandaag, venster = 'zeven_dagen', verschuiving = 0) {
  if (venster === 'kalenderweek') {
    const [j, m, d] = String(vandaag).split('-').map(Number);
    const dt = new Date(j, m - 1, d);
    const wd = (dt.getDay() + 6) % 7;
    const maandag = plusDagen(vandaag, -wd + verschuiving * 7);
    return { van: maandag, tot: plusDagen(maandag, 6), venster };
  }
  return { van: plusDagen(vandaag, -6 + verschuiving * 7), tot: plusDagen(vandaag, verschuiving * 7), venster: 'zeven_dagen' };
}

export function bouwWeekrapport({
  leads = [], fasen = [], classificaties = [], interacties = [], taken = [], afspraken = [], partners = [], orders = [], projects = [], invoices = [],
  bezwaren = [], suggesties = [], people = [], vandaag, companyId, pipeline = FRAMR_PIPELINE, partnerbeeld = null, venster = 'zeven_dagen', scope = 'iedereen', bellerId = null, dagdoel = 10,
} = {}) {
  if (!vandaag) throw new Error('bouwWeekrapport vereist vandaag.');
  const eigen = leads.filter((l) => !companyId || l.company_id === companyId);
  const eigenIds = new Set(eigen.map((l) => l.id));
  const leadOpId = new Map(eigen.map((l) => [l.id, l]));
  const clsIdx = classificatieIndex(classificaties);
  const naamVan = new Map(people.map((p) => [p.id, p.name]));
  const faseOpId = new Map(fasen.map((f) => [f.id, f]));
  const faseNaam = (l) => (l && l.pipeline_fase_id ? (faseOpId.get(l.pipeline_fase_id) || {}).naam : null);
  const eigenaarVan = (leadId) => (leadOpId.get(leadId) || {}).toegewezen_aan || null;
  const past = (leadId, wie) => inScope(scope, bellerId, wie, eigenaarVan(leadId));

  const deze = weekVenster(vandaag, venster, 0);
  const vorige = weekVenster(vandaag, venster, -1);
  const contact = interacties.filter((i) => eigenIds.has(i.lead_id) && past(i.lead_id, i.door_person_id));
  const ids = (rijen) => rijen.map((r) => r.id);
  const koppel = partnerKoppeling({ leads: eigen, partners });
  const partnerIds = new Set([...koppel.values()].map((k) => k.partner.id));

  const telWeek = (w) => {
    const uitgaand = contact.filter((i) => i.richting !== 'inkomend' && i.type !== 'note' && inVenster(i.started_at, w.van, w.tot));
    const calls = uitgaand.filter((i) => i.type === 'call');
    const bereikt = calls.filter((i) => i.uitkomst && !NIET_BEREIKT.has(i.uitkomst));
    const inhoudelijk = calls.filter((i) => isInhoudelijk(i.uitkomst));
    const whatsapp = uitgaand.filter((i) => i.type === 'whatsapp');
    const email = uitgaand.filter((i) => i.type === 'email');
    const reacties = contact.filter((i) => i.richting === 'inkomend' && inVenster(i.started_at, w.van, w.tot));
    const verlopen = contact.filter((i) => ['whatsapp', 'email'].includes(i.type) && i.richting !== 'inkomend' && i.reactie_verwacht && !i.reactie_ontvangen_op && i.reactie_termijn && inVenster(i.reactie_termijn, w.van, w.tot) && dagVan(i.reactie_termijn) < vandaag);
    const afsp = afspraken.filter((a) => eigenIds.has(a.lead_id) && past(a.lead_id, a.verantwoordelijke));
    const geboekt = afsp.filter((a) => inVenster(a.created_at, w.van, w.tot));
    const uitgevoerd = afsp.filter((a) => a.status === 'uitgevoerd' && inVenster(a.start_at, w.van, w.tot));
    const geannuleerd = afsp.filter((a) => a.status === 'geannuleerd' && inVenster(a.updated_at || a.start_at, w.van, w.tot));
    const nietVerschenen = afsp.filter((a) => a.status === 'niet_verschenen' && inVenster(a.start_at, w.van, w.tot));
    const hadMoeten = afsp.filter((a) => inVenster(a.start_at, w.van, w.tot) && dagVan(a.start_at) <= vandaag && ['uitgevoerd', 'niet_verschenen', 'gepland', 'verplaatst'].includes(a.status));
    const accounts = partners.filter((p) => (!companyId || p.company_id === companyId) && inVenster(p.created_at, w.van, w.tot));
    const eerstePerPartner = (rijen, veld) => { const m = new Map(); for (const r of [...rijen].sort((a, b) => String(a[veld] || a.created_at).localeCompare(String(b[veld] || b.created_at)))) if (!m.has(r.partner_id)) m.set(r.partner_id, r); return [...m.values()]; };
    const eersteProjecten = eerstePerPartner(projects.filter((p) => !companyId || !p.company_id || p.company_id === companyId), 'created_at').filter((p) => inVenster(p.created_at, w.van, w.tot));
    const eersteBestellingen = eerstePerPartner(orders.filter((o) => !companyId || !o.company_id || o.company_id === companyId), 'besteld_op').filter((o) => inVenster(o.besteld_op || o.created_at, w.van, w.tot));
    const bestellingen = orders.filter((o) => (!companyId || !o.company_id || o.company_id === companyId) && inVenster(o.besteld_op || o.created_at, w.van, w.tot));
    const omzetRijen = invoices.filter((f) => (!companyId || !f.company_id || f.company_id === companyId) && String(f.status || '') !== 'concept' && inVenster(f.factuurdatum || f.created_at, w.van, w.tot));
    const uniek = new Set(uitgaand.map((i) => i.lead_id));
    const c = (aantal, lijst, definitie) => ({ aantal, ids: ids(lijst), definitie });
    return {
      van: w.van, tot: w.tot,
      uniekeLeads: { aantal: uniek.size, ids: [...uniek], definitie: 'bedrijven met minstens een uitgaand contactmoment in het venster' },
      belpogingen: c(calls.length, calls, 'uitgaande gesprekken, ook zonder gehoor'),
      bereikt: c(bereikt.length, bereikt, 'gesprekken met de juiste persoon aan de lijn'),
      bereikPct: calls.length ? Math.round((bereikt.length / calls.length) * 100) : null,
      gesprekken: c(inhoudelijk.length, inhoudelijk, 'inhoudelijke gesprekken: bereikt en meer dan terugbellen, geen tijd of gestopt'),
      whatsapp: c(whatsapp.length, whatsapp, 'WhatsApp-berichten als verstuurd bevestigd'),
      email: c(email.length, email, 'mails als verstuurd bevestigd'),
      informatieVerstuurd: whatsapp.length + email.length,
      reacties: c(reacties.length, reacties, 'inkomende reacties'),
      verlopenTermijnen: c(verlopen.length, verlopen, 'berichten waarvan de reactietermijn in het venster verstreek zonder reactie'),
      demosGepland: c(geboekt.length, geboekt, 'afspraken die in het venster zijn gemaakt'),
      demosGedaan: c(uitgevoerd.length, uitgevoerd, 'afspraken in het venster met de status uitgevoerd'),
      annuleringen: c(geannuleerd.length, geannuleerd, 'afspraken die in het venster zijn geannuleerd'),
      nietVerschenen: c(nietVerschenen.length, nietVerschenen, 'afspraken in het venster waarbij de lead niet verscheen'),
      demoOpkomstPct: hadMoeten.length ? Math.round((hadMoeten.filter((a) => a.status === 'uitgevoerd').length / hadMoeten.length) * 100) : null,
      demoOpkomstDefinitie: 'uitgevoerd gedeeld door alle afspraken in het venster die al hadden moeten plaatsvinden',
      accounts: c(accounts.length, accounts, 'partneraccounts aangemaakt in het venster'),
      eersteProjecten: c(eersteProjecten.length, eersteProjecten, 'partners met hun eerste klus in het venster'),
      eersteBestellingen: c(eersteBestellingen.length, eersteBestellingen, 'partners met hun eerste bestelling in het venster'),
      bestellingen: c(bestellingen.length, bestellingen, 'bestellingen via het portaal in het venster'),
      bestelBedrag: Math.round(bestellingen.reduce((s, o) => s + (Number(o.bedrag_ex) || 0), 0) * 100) / 100,
      omzet: { bedrag: Math.round(omzetRijen.reduce((s, f) => s + (Number(f.totaal) || 0), 0) * 100) / 100, aantal: omzetRijen.length, definitie: 'facturen van partners in het portaal, niet concept; de Shopify-omzet volgt nog en ontbreekt hier' },
    };
  };

  const callsDeze = contact.filter((i) => i.type === 'call' && i.richting !== 'inkomend' && inVenster(i.started_at, deze.van, deze.tot));
  const groepeer = (sleutel) => {
    const m = new Map();
    for (const c of callsDeze) {
      const k = sleutel(c) || 'onbekend';
      if (!m.has(k)) m.set(k, { naam: k, gebeld: 0, bereikt: 0, gesprekken: 0 });
      const e = m.get(k);
      e.gebeld += 1;
      if (c.uitkomst && !NIET_BEREIKT.has(c.uitkomst)) e.bereikt += 1;
      if (isInhoudelijk(c.uitkomst)) e.gesprekken += 1;
    }
    return [...m.values()].sort((a, b) => b.gebeld - a.gebeld);
  };
  const perUitkomst = new Map();
  for (const c of callsDeze) perUitkomst.set(c.uitkomst || 'zonder uitkomst', (perUitkomst.get(c.uitkomst || 'zonder uitkomst') || 0) + 1);
  const bezwarenWeek = new Map();
  for (const b of bezwaren.filter((x) => eigenIds.has(x.lead_id) && inVenster(x.created_at, deze.van, deze.tot))) {
    bezwarenWeek.set(b.categorie || 'zonder categorie', (bezwarenWeek.get(b.categorie || 'zonder categorie') || 0) + 1);
  }
  const open = taken.filter((t) => t.status !== 'done' && t.lead_id && eigenIds.has(t.lead_id) && past(t.lead_id, t.assignee));
  const achterstallig = open.filter((t) => dagVan(t.due_date || t.due_at) && dagVan(t.due_date || t.due_at) < vandaag);
  const metOpenTaak = new Set(taken.filter((t) => t.status !== 'done' && t.lead_id).map((t) => t.lead_id));
  const openAfspraak = new Set(afspraken.filter((a) => ['gepland', 'verplaatst'].includes(a.status)).map((a) => a.lead_id));
  const warm = new Set(['gesproken', 'gekwalificeerd', 'informatie_verstuurd', 'follow_up_nodig', 'demo_afgerond', 'account_aangeboden']);
  const zonderActie = eigen.filter((l) => warm.has(faseNaam(l)) && !metOpenTaak.has(l.id) && !openAfspraak.has(l.id) && past(l.id, null));
  const demoZonderOpvolging = contact
    .filter((i) => i.type === 'demo' && inVenster(i.started_at, plusDagen(vandaag, -14), vandaag) && !metOpenTaak.has(i.lead_id))
    .map((i) => ({ leadId: i.lead_id, naam: (leadOpId.get(i.lead_id) || {}).naam || i.lead_id }));
  const teBeoordelen = open.filter((t) => t.task_type === 'check_in').map((t) => ({ leadId: t.lead_id, naam: (leadOpId.get(t.lead_id) || {}).naam, reden: t.reden }));
  const leerpunten = suggesties.filter((s) => (!companyId || s.company_id === companyId) && inVenster(s.created_at, deze.van, deze.tot)).map((s) => ({ id: s.id, categorie: s.categorie, voorstel: s.voorstel, status: s.status }));
  const dagen = [];
  for (let d = deze.van; d <= deze.tot; d = plusDagen(d, 1)) {
    const calls = contact.filter((c) => c.type === 'call' && c.richting !== 'inkomend' && dagVan(c.started_at) === d);
    dagen.push({ dag: d, gebeld: calls.length, bereikt: calls.filter((c) => c.uitkomst && !NIET_BEREIKT.has(c.uitkomst)).length, uniek: new Set(calls.map((c) => c.lead_id)).size, doel: dagdoel });
  }
  return {
    vandaag, venster: deze.venster, scope,
    dezeWeek: telWeek(deze),
    vorigeWeek: telWeek(vorige),
    perDag: dagen,
    perBeller: groepeer((c) => naamVan.get(c.door_person_id)),
    perRegio: groepeer((c) => (leadOpId.get(c.lead_id) || {}).regio).slice(0, 12),
    perBron: groepeer((c) => (leadOpId.get(c.lead_id) || {}).bron).slice(0, 8),
    perClassificatie: groepeer((c) => clsIdx.get(c.lead_id)),
    perScript: groepeer((c) => c.script_ref),
    perUitkomst: [...perUitkomst.entries()].sort((a, b) => b[1] - a[1]),
    bezwaren: [...bezwarenWeek.entries()].sort((a, b) => b[1] - a[1]),
    achterstallig: { aantal: achterstallig.length, ids: ids(achterstallig), definitie: 'open taken met een datum voor vandaag (stand van nu, niet per venster)' },
    zonderActie: zonderActie.map((l) => ({ leadId: l.id, naam: l.naam })),
    demoZonderOpvolging,
    teBeoordelen,
    leerpunten,
    aandachtspunten: [
      ...zonderActie.slice(0, 5).map((l) => `${l.naam} is warm maar heeft geen volgende actie`),
      ...demoZonderOpvolging.slice(0, 5).map((d) => `${d.naam}: demo gedaan, geen opvolging gepland`),
      ...teBeoordelen.slice(0, 5).map((t) => `${t.naam}: reeks afgelopen, beoordelen of we pauzeren of stoppen`),
      ...(partnerbeeld ? partnerbeeld.risico.slice(0, 5).map((p) => `${p} dreigt af te haken`) : []),
    ],
    partnersRisico: partnerbeeld ? partnerbeeld.risico : [],
    partnerKoppelingen: partnerIds.size,
    dagdoel,
  };
}

/* ---------- de leadlijst met filters ---------- */

/* Het traject van een rij: actief, gepauzeerd of verloren, uit de trajectstatus (die bij
   gepauzeerd de datum erachter draagt). Zonder status telt een rij als actief: die is nog
   niet weggezet. */
export function trajectVan(r) {
  const t = String(r.trajectstatus || '').toLowerCase();
  if (t.startsWith('verloren')) return 'verloren';
  if (t.startsWith('gepauzeerd')) return 'gepauzeerd';
  return 'actief';
}

/* De volgorde van de leadlijst. 'actie' (de standaard van het scherm sinds 25-09-2026): de
   eerstvolgende actie eerst, dus wat te laat is bovenaan; leads zonder actie erna, verloren
   onderaan. 'naam' op bedrijfsnaam, 'contact' op laatste contact (nieuwste eerst, nooit
   gesproken onderaan). Alles anders laat de volgorde van de bron staan (regio, naam). */
function sorteerLeadRijen(rijen, sorteer) {
  const naam = (r) => String(r.bedrijfsnaam || '').toLowerCase();
  if (sorteer === 'naam') return [...rijen].sort((a, b) => naam(a).localeCompare(naam(b)));
  if (sorteer === 'contact') return [...rijen].sort((a, b) => String(b.laatste_contact || '').localeCompare(String(a.laatste_contact || '')) || naam(a).localeCompare(naam(b)));
  if (sorteer === 'actie') {
    const sleutel = (r) => (r.volgende_actie_op ? `0 ${r.volgende_actie_op}` : (trajectVan(r) === 'verloren' ? '2' : '1'));
    return [...rijen].sort((a, b) => sleutel(a).localeCompare(sleutel(b)) || naam(a).localeCompare(naam(b)));
  }
  return rijen;
}

export function filterLeadRijen(rijen = [], {
  zoek = '', classificatie = '', regio = '', beller = '', fase = '', commercieel = '', actie = '', achterstallig = '', reactie = '', geenActie = '', tag = '', behandeling = '', ids = '', traject = '', sorteer = '', vandaag = null, pagina = 1, per = 50,
} = {}) {
  const z = String(zoek || '').trim().toLowerCase();
  const idSet = ids ? new Set(String(ids).split(',').map((x) => x.trim()).filter(Boolean)) : null;
  const past = (r) => (!idSet || idSet.has(r.leadnummer)) && (!z || [r.bedrijfsnaam, r.plaats, r.telefoon, r.email, r.contactpersoon, r.kvk, r.tags].some((v) => String(v || '').toLowerCase().includes(z)))
    && (!classificatie || r.classificatie === classificatie)
    && (!regio || r.provincie === regio)
    && (!beller || (beller === 'niemand' ? !r.toegewezen_aan : r.toegewezen_aan === beller))
    && (!fase || (fase === 'zonder' ? !r.fase : r.fase === fase))
    && (!commercieel || r.commerciele_fase === commercieel)
    && (!actie || (r.volgende_actie_type || '') === actie)
    && (!achterstallig || (vandaag && r.volgende_actie_op && r.volgende_actie_op < vandaag))
    && (!reactie || r.reactie_status === reactie)
    && (!geenActie || !r.volgende_actie)
    && (!tag || String(r.tags || '').split(' ').includes(tag))
    && (!behandeling || Boolean(r.in_behandeling_door));
  /* Eerst alles behalve het traject, zodat de knoppen actief, gepauzeerd en verloren de
     aantallen binnen de andere filters kunnen tonen; dan het traject zelf. */
  const basis = rijen.filter(past);
  const perTraject = { actief: 0, gepauzeerd: 0, verloren: 0 };
  for (const r of basis) perTraject[trajectVan(r)] += 1;
  const gefilterd = sorteerLeadRijen(traject ? basis.filter((r) => trajectVan(r) === traject) : basis, sorteer);
  const uniek = (veld) => [...new Set(rijen.map((r) => r[veld]).filter(Boolean))].sort();
  const p = Math.max(1, Number(pagina) || 1);
  const n = Math.max(1, Math.min(500, Number(per) || 50));
  return {
    totaal: gefilterd.length,
    perTraject,
    pagina: p,
    per: n,
    paginas: Math.max(1, Math.ceil(gefilterd.length / n)),
    rijen: gefilterd.slice((p - 1) * n, p * n),
    filters: {
      classificaties: uniek('classificatie'), regios: uniek('provincie'), bellers: uniek('toegewezen_aan'), fases: uniek('fase'),
      commercieel: [...COMMERCIELE_FASEN, 'verloren'], acties: uniek('volgende_actie_type'), reacties: ['wacht', 'verstreken', 'ontvangen'],
      tags: [...new Set(rijen.flatMap((r) => String(r.tags || '').split(' ').filter(Boolean)))].sort(),
    },
  };
}

/* ---------- de opvolging en de agenda ---------- */

export function bouwOpvolging({ taken = [], leads = [], people = [], afspraken = [], vandaag, companyId, scope = 'iedereen', bellerId = null } = {}) {
  if (!vandaag) throw new Error('bouwOpvolging vereist vandaag.');
  const leadOpId = new Map(leads.filter((l) => !companyId || !l.company_id || l.company_id === companyId).map((l) => [l.id, l]));
  const naamVan = new Map(people.map((p) => [p.id, p.name]));
  const afspraakOpTaak = new Map(afspraken.filter((a) => a.task_id).map((a) => [a.task_id, a]));
  const open = taken
    .filter((t) => t.status !== 'done' && t.lead_id && leadOpId.has(t.lead_id))
    .filter((t) => inScope(scope, bellerId, t.assignee, (leadOpId.get(t.lead_id) || {}).toegewezen_aan))
    .map((t) => {
      const l = leadOpId.get(t.lead_id);
      const dag = dagVan(t.due_date || t.due_at);
      const a = afspraakOpTaak.get(t.id) || null;
      return {
        id: t.id, leadId: l.id, lead: l.naam, plaats: l.plaats || null, telefoon: l.telefoon || null, eigenaar: naamVan.get(l.toegewezen_aan) || null,
        taak: t.task_type || 'check_in', reden: t.reden || t.title, dag, tijd: t.due_at ? tijdVan(t.due_at) : (a ? tijdVan(a.start_at) : null), wie: naamVan.get(t.assignee) || null, wieId: t.assignee || null,
        reeks: t.opvolg_reeks || null, stap: t.opvolg_stap || null, afspraakId: a ? a.id : null, afspraakStatus: a ? a.status : null, gemaaktOp: dagVan(t.created_at),
        dagenTeLaat: dag && dag < vandaag ? dagenTussenDatums(dag, vandaag) : 0,
      };
    })
    .sort((a, b) => String(a.dag || '9999').localeCompare(String(b.dag || '9999')) || String(a.tijd || '').localeCompare(String(b.tijd || '')));
  const week = plusDagen(vandaag, 7);
  return {
    scope,
    achterstallig: open.filter((t) => t.dag && t.dag < vandaag),
    vandaag: open.filter((t) => t.dag === vandaag),
    dezeWeek: open.filter((t) => t.dag && t.dag > vandaag && t.dag <= week),
    later: open.filter((t) => !t.dag || t.dag > week),
    demos: open.filter((t) => t.taak === 'demo'),
    totaal: open.length,
  };
}

/* De agenda: afspraken en taken met een tijd, per dag, van een begindag tot een einddag. */
export function bouwAgenda({ afspraken = [], taken = [], leads = [], people = [], van, tot, companyId, scope = 'iedereen', bellerId = null } = {}) {
  if (!van || !tot) throw new Error('bouwAgenda vereist van en tot.');
  const leadOpId = new Map(leads.filter((l) => !companyId || !l.company_id || l.company_id === companyId).map((l) => [l.id, l]));
  const naamVan = new Map(people.map((p) => [p.id, p.name]));
  const items = [];
  for (const a of afspraken.filter((x) => leadOpId.has(x.lead_id) && !['geannuleerd'].includes(x.status))) {
    const l = leadOpId.get(a.lead_id);
    if (!inScope(scope, bellerId, a.verantwoordelijke, l.toegewezen_aan)) continue;
    const dag = dagVan(a.start_at);
    if (dag < van || dag > tot) continue;
    items.push({ soort: 'afspraak', id: a.id, taakId: a.task_id || null, leadId: l.id, lead: l.naam, plaats: l.plaats || null, dag, tijd: tijdVan(a.start_at), duur: a.duur_minuten || null, wat: a.soort || 'demo', vorm: a.vorm || null, locatie: a.locatie || null, link: a.link || null, doel: a.doel || null, status: a.status, wie: naamVan.get(a.verantwoordelijke) || null, deelnemers: a.deelnemers || null });
  }
  const afspraakTaken = new Set(afspraken.map((a) => a.task_id).filter(Boolean));
  for (const t of taken.filter((x) => x.status !== 'done' && x.lead_id && leadOpId.has(x.lead_id) && x.due_at && !afspraakTaken.has(x.id))) {
    const l = leadOpId.get(t.lead_id);
    if (!inScope(scope, bellerId, t.assignee, l.toegewezen_aan)) continue;
    const dag = dagVan(t.due_at);
    if (dag < van || dag > tot) continue;
    items.push({ soort: 'taak', id: t.id, taakId: t.id, leadId: l.id, lead: l.naam, plaats: l.plaats || null, dag, tijd: tijdVan(t.due_at), duur: null, wat: t.task_type || 'call', vorm: null, doel: t.reden || t.title, status: 'open', wie: naamVan.get(t.assignee) || null });
  }
  items.sort((a, b) => String(a.dag).localeCompare(String(b.dag)) || String(a.tijd || '').localeCompare(String(b.tijd || '')));
  const dagen = [];
  for (let d = van; d <= tot; d = plusDagen(d, 1)) dagen.push({ dag: d, items: items.filter((i) => i.dag === d) });
  return { van, tot, scope, dagen, totaal: items.length };
}

/* ---------- de gesprekken en opnames ---------- */

export function bouwGesprekkenLijst({ interacties = [], leads = [], people = [], limiet = 60, alleenProvisional = false, alleenOpnames = false, type = '', beller = '', companyId } = {}) {
  const leadOpId = new Map(leads.map((l) => [l.id, l]));
  const naamVan = new Map(people.map((p) => [p.id, p.name]));
  const basis = interacties.filter((i) => leadOpId.has(i.lead_id) && (!companyId || i.company_id === companyId));
  const rijen = basis
    .filter((i) => !alleenProvisional || i.review_status === 'provisional')
    .filter((i) => !alleenOpnames || i.opname_ref || (Array.isArray(i.bijlage_refs) && i.bijlage_refs.length))
    .filter((i) => !type || i.type === type)
    .filter((i) => !beller || i.door_person_id === beller)
    .sort((a, b) => String(new Date(b.started_at).toISOString()).localeCompare(String(new Date(a.started_at).toISOString())))
    .slice(0, limiet)
    .map((i) => ({
      id: i.id, leadId: i.lead_id, lead: (leadOpId.get(i.lead_id) || {}).naam, plaats: (leadOpId.get(i.lead_id) || {}).plaats || null,
      type: i.type, richting: i.richting || 'uitgaand', stap: i.stap || null, scriptRef: i.script_ref || null, dag: dagVan(i.started_at), tijd: tijdVan(i.started_at),
      door: naamVan.get(i.door_person_id) || null, doorId: i.door_person_id || null, uitkomst: i.uitkomst || null, splitsing: i.uitkomst ? splitsUitkomst(i.uitkomst) : null, samenvatting: i.samenvatting || null, volgendeStap: i.volgende_stap || null,
      koopkans: i.koopkans ?? null, temperatuur: i.temperatuur || null, sentiment: i.sentiment || null,
      opname: i.opname_ref || null, opnames: Array.isArray(i.bijlage_refs) ? i.bijlage_refs.filter((b) => b && b.soort === 'opname') : [], transcript: i.transcript_ref || null, toestemming: i.opname_toestemming ?? null,
      tags: i.tags || [], provisional: i.review_status === 'provisional', duur: i.duur_seconden || null, aiAdvies: i.ai_advies || null, aiAnalyse: i.ai_analyse || null,
      materiaal: i.materiaal || null, link: i.link || null, templateRef: i.template_ref || null, verzendStatus: i.verzend_status || null, reactieVerwacht: i.reactie_verwacht ?? null, reactieTermijn: i.reactie_termijn ? dagVan(i.reactie_termijn) : null, reactieOntvangenOp: i.reactie_ontvangen_op ? dagVan(i.reactie_ontvangen_op) : null,
      afhaakmoment: i.afhaakmoment || null, aangeslagenOp: Array.isArray(i.aangeslagen_op) ? i.aangeslagen_op : [],
      onboardingGedaan: Array.isArray(i.onboarding_gedaan) ? i.onboarding_gedaan : [], blokkade: i.blokkade || null,
      afTeRonden: ['call', 'demo'].includes(i.type) && !i.uitkomst && i.richting !== 'inkomend',
    }));
  return {
    rijen,
    provisional: basis.filter((i) => i.review_status === 'provisional').length,
    metOpname: basis.filter((i) => i.opname_ref || (Array.isArray(i.bijlage_refs) && i.bijlage_refs.length)).length,
    afTeRonden: basis.filter((i) => ['call', 'demo'].includes(i.type) && !i.uitkomst && i.richting !== 'inkomend').length,
  };
}

/* ---------- feedback en productontwikkeling ---------- */

export function bouwFeedback({ suggesties = [], companyId } = {}) {
  const eigen = suggesties.filter((s) => !companyId || s.company_id === companyId);
  const perCategorie = new Map();
  for (const s of eigen) {
    if (!perCategorie.has(s.categorie)) perCategorie.set(s.categorie, []);
    perCategorie.get(s.categorie).push({ id: s.id, voorstel: s.voorstel, onderbouwing: s.onderbouwing || null, status: s.status, dag: dagVan(s.created_at) });
  }
  const telVoorstel = new Map();
  for (const s of eigen) {
    const k = String(s.voorstel).trim().toLowerCase();
    telVoorstel.set(k, (telVoorstel.get(k) || 0) + 1);
  }
  return {
    totaal: eigen.length,
    perStatus: { voorgesteld: eigen.filter((s) => s.status === 'voorgesteld').length, actief: eigen.filter((s) => s.status === 'actief').length, verworpen: eigen.filter((s) => s.status === 'verworpen').length },
    categorieen: [...perCategorie.entries()].map(([categorie, lijst]) => ({
      categorie,
      aantal: lijst.length,
      rijen: lijst.map((r) => ({ ...r, keerGenoemd: telVoorstel.get(String(r.voorstel).trim().toLowerCase()) || 1 }))
        .sort((a, b) => b.keerGenoemd - a.keerGenoemd || String(b.dag).localeCompare(String(a.dag))),
    })).sort((a, b) => b.aantal - a.aantal),
  };
}

/* ---------- de demo's ---------- */

export function bouwDemoOverzicht({ interacties = [], taken = [], afspraken = [], evaluaties = [], antwoorden = [], leads = [], people = [], vandaag, companyId } = {}) {
  const leadOpId = new Map(leads.map((l) => [l.id, l]));
  const naamVan = new Map(people.map((p) => [p.id, p.name]));
  const afspraakOpTaak = new Map(afspraken.filter((a) => a.task_id).map((a) => [a.task_id, a]));
  const gepland = taken.filter((t) => t.task_type === 'demo' && t.status !== 'done' && leadOpId.has(t.lead_id))
    .map((t) => {
      const a = afspraakOpTaak.get(t.id) || null;
      return { taakId: t.id, afspraakId: a ? a.id : null, leadId: t.lead_id, lead: leadOpId.get(t.lead_id).naam, dag: dagVan(t.due_date || t.due_at), tijd: a ? tijdVan(a.start_at) : (t.due_at ? tijdVan(t.due_at) : null), duur: a ? a.duur_minuten : null, vorm: a ? a.vorm : (t.reden || null), locatie: a ? a.locatie : null, link: a ? a.link : null, doel: a ? a.doel : null, voorbereiding: a ? a.voorbereiding : null, status: a ? a.status : 'gepland', wie: naamVan.get(a ? a.verantwoordelijke : t.assignee) || null, deelnemers: a ? a.deelnemers : null, teLaat: Boolean(vandaag && dagVan(t.due_date || t.due_at) < vandaag) };
    })
    .sort((a, b) => String(a.dag || '9999').localeCompare(String(b.dag || '9999')) || String(a.tijd || '').localeCompare(String(b.tijd || '')));
  const afgezegd = afspraken.filter((a) => leadOpId.has(a.lead_id) && ['geannuleerd', 'niet_verschenen'].includes(a.status))
    .sort((a, b) => String(b.start_at).localeCompare(String(a.start_at))).slice(0, 20)
    .map((a) => ({ afspraakId: a.id, leadId: a.lead_id, lead: leadOpId.get(a.lead_id).naam, dag: dagVan(a.start_at), tijd: tijdVan(a.start_at), status: a.status, reden: a.reden || null }));
  const gedaan = interacties.filter((i) => i.type === 'demo' && leadOpId.has(i.lead_id) && (!companyId || i.company_id === companyId))
    .sort((a, b) => String(new Date(b.started_at).toISOString()).localeCompare(String(new Date(a.started_at).toISOString())))
    .map((i) => {
      const ev = evaluaties.filter((e) => e.interaction_id === i.id);
      const antw = antwoorden.filter((a) => a.interaction_id === i.id);
      const veld = (naam) => (antw.find((a) => a.veld === naam) || {}).waarde || null;
      return {
        id: i.id, leadId: i.lead_id, lead: leadOpId.get(i.lead_id).naam, dag: dagVan(i.started_at), tijd: tijdVan(i.started_at), door: naamVan.get(i.door_person_id) || null,
        uitkomst: i.uitkomst || null, samenvatting: i.samenvatting || null, volgendeStap: i.volgende_stap || null, koopkans: i.koopkans ?? null, opname: i.opname_ref || null,
        getoond: ev.filter((e) => e.getoond).length, begrepen: ev.filter((e) => e.begrepen === true).length,
        interesseVoor: veld('interesse_voor_demo'), interesseNa: veld('interesse_na_demo'), aha: veld('demo_aha_moment'), watGetoond: veld('demo_getoond'), watBegrepen: veld('demo_begrepen'), relevant: veld('demo_relevant'), eerstOplossen: veld('demo_eerst_oplossen'),
        morgen: veld('demo_morgen_gebruiken'), m2: veld('demo_m2_verwacht'), eerstVerbeteren: veld('demo_eerst_verbeteren'),
        onderdelen: ev.map((e) => ({ onderdeel: e.onderdeel, getoond: e.getoond, begrepen: e.begrepen, relevantie: e.relevantie, gebruiksgemak: e.gebruiksgemak, vertrouwen: e.vertrouwen, reactie: e.reactie, verbeterpunt: e.verbeterpunt, bug: e.bug })),
      };
    });
  /* Per onderdeel over alle demo's: hoe vaak getoond, gemiddelde scores, hoe vaak niet begrepen. */
  const perOnderdeel = new Map();
  for (const e of evaluaties.filter((x) => leadOpId.has(x.lead_id))) {
    if (!perOnderdeel.has(e.onderdeel)) perOnderdeel.set(e.onderdeel, { onderdeel: e.onderdeel, getoond: 0, nietBegrepen: 0, relevantie: [], gebruiksgemak: [], vertrouwen: [], bugs: 0, verbeterpunten: 0 });
    const o = perOnderdeel.get(e.onderdeel);
    if (e.getoond) o.getoond += 1;
    if (e.begrepen === false) o.nietBegrepen += 1;
    for (const k of ['relevantie', 'gebruiksgemak', 'vertrouwen']) if (e[k]) o[k].push(Number(e[k]));
    if (e.bug) o.bugs += 1;
    if (e.verbeterpunt) o.verbeterpunten += 1;
  }
  const gem = (a) => (a.length ? Math.round((a.reduce((s, x) => s + x, 0) / a.length) * 10) / 10 : null);
  const onderdelen = [...perOnderdeel.values()].map((o) => ({ ...o, relevantie: gem(o.relevantie), gebruiksgemak: gem(o.gebruiksgemak), vertrouwen: gem(o.vertrouwen) }))
    .sort((a, b) => b.getoond - a.getoond);
  return { gepland, afgezegd, gedaan, onderdelen, vandaag };
}

/* ---------- de inventaris van alle data ---------- */

/* Wat elke tabel is, in gewone woorden, zodat het scherm Data het totaaloverzicht van alle data
   in het spoor kan geven zonder dat iemand het schema hoeft te kennen. */
export const DATA_UITLEG = {
  leads: 'bedrijven in het register (sales_leads)',
  bronnen: 'waar elk bedrijf gevonden is, een rij per vondst (lead_sources)',
  feiten: 'losse feiten met herkomst en geldigheid: telefoon, website, score, merken (lead_facts)',
  classificaties: 'wat voor bedrijf het is: vloerenlegger, winkel, tegelzetter (lead_classifications)',
  research: 'AI-briefings per bedrijf, als snapshots (lead_research)',
  interacties: 'contactmomenten: gesprekken, WhatsApp, mail, demo (interactions)',
  discovery: 'gestructureerde gespreksantwoorden op vaste velden (discovery_answers)',
  bezwaren: 'bezwaren met categorie, reactie en of die werkte (objections)',
  vragen: 'wat leads ons vragen (questions)',
  kansen: 'projectkansen met m2 en datum (opportunities)',
  weetjes: 'persoonlijke weetjes met bron (crm_weetjes)',
  suggesties: 'productwensen en verbeteringen voor script, pagina en demo (sales_suggestions)',
  taken: 'opvolgtaken met type, datum en reden (tasks met lead)',
  queue: 'de dagselecties, wie op welke dag op de lijst stond (sales_queue)',
  evaluaties: 'demo-evaluaties per onderdeel (demo_evaluaties)',
  afspraken: 'geplande contactmomenten met tijd: demo, gesprek, bezoek, onboarding (sales_afspraken)',
  reeksen: 'de opvolgreeksen per aanleiding (sales_opvolgreeksen)',
  partners: 'partneraccounts in het portaal (portal_partners)',
  klanten: 'klanten van partners in het portaal (portal_customers)',
  klussen: 'klussen van partners (portal_projects)',
  inmetingen: 'inmetingen van partners (portal_measurements)',
  calculaties: 'calculaties van partners (portal_calculations)',
  offertes: 'offertes van partners (portal_quotes)',
  facturen: 'facturen van partners (portal_invoices)',
  bestellingen: 'bestellingen via het portaal (portal_orders)',
  people: 'personen in het relatieweb (people)',
  fasen: 'de hoofdstatussen van de pipeline (pipeline_fases)',
  opties: 'de vaste waardelijsten (sales_veldopties)',
};

/* De datasets van de server heten naar de tabel (customers, projects); het scherm spreekt
   Nederlands (klanten, klussen). Deze lijst vertaalt. */
const DATASET_NAAM = {
  klanten: 'customers', klussen: 'projects', inmetingen: 'measurements', calculaties: 'calculations',
  offertes: 'quotes', facturen: 'invoices', bestellingen: 'orders',
};

export function bouwDataInventaris(datasets = {}, { companyId, leads = [] } = {}) {
  const eigenIds = new Set(leads.filter((l) => !companyId || l.company_id === companyId).map((l) => l.id));
  const tel = (naam, rijen = []) => {
    if (naam === 'leads') return eigenIds.size;
    if (rijen.length && 'lead_id' in rijen[0]) return rijen.filter((r) => eigenIds.has(r.lead_id)).length;
    if (rijen.length && 'company_id' in rijen[0] && companyId) return rijen.filter((r) => r.company_id === companyId).length;
    return rijen.length;
  };
  return Object.keys(DATA_UITLEG).map((naam) => ({ naam, uitleg: DATA_UITLEG[naam], aantal: tel(naam, datasets[DATASET_NAAM[naam] || naam] || []) }));
}


/* ---------- de weekreview: wat we leren en wat we besluiten (aanvulling onderdeel 8) ---------- */

export const BESLUIT_STATUSSEN = ['voorstel', 'aangenomen', 'afgewezen', 'uitgevoerd', 'geevalueerd'];

/*
  De weekreview zet naast het weekrapport de dingen die je nodig hebt om te besluiten wat er
  anders moet: de servicefeedback en de terugkerende problemen, de behandeltijd (hoe lang een
  taak open staat en hoe lang een lead over een stap doet), de werkvoorraad (wat er ligt), en
  het resultaat per scriptversie. Daaronder de besluiten van eerdere weken die nu geevalueerd
  moeten worden. Elk cijfer draagt zijn definitie, zodat een besluit navolgbaar is.
*/
export function bouwWeekreview({
  leads = [], fasen = [], interacties = [], taken = [], afspraken = [], bezwaren = [], besluiten = [], werkwijzen = [], people = [], discovery = [],
  vandaag, companyId, venster = 'zeven_dagen', verschuiving = 0,
} = {}) {
  if (!vandaag) throw new Error('bouwWeekreview vereist vandaag.');
  const w = weekVenster(vandaag, venster, verschuiving);
  const naamVan = new Map(people.map((p) => [p.id, p.name]));
  const eigen = (rijen) => rijen.filter((r) => !companyId || !r.company_id || r.company_id === companyId);
  const leadOpId = new Map(eigen(leads).map((l) => [l.id, l]));
  const inWeek = (d) => { const x = dagVan(d); return x && x >= w.van && x <= w.tot; };

  /* Service: de gesprekken van de week met hun uitkomst, en de problemen die eruit kwamen. */
  const serviceGesprekken = eigen(interacties).filter((i) => i.stap === 'service' && inWeek(i.started_at));
  const perServiceUitkomst = new Map();
  for (const i of serviceGesprekken) perServiceUitkomst.set(i.uitkomst || 'zonder uitkomst', (perServiceUitkomst.get(i.uitkomst || 'zonder uitkomst') || 0) + 1);
  const problemen = eigen(taken).filter((t) => t.contactreden === 'probleem_oplossen' && inWeek(t.created_at));
  const perProbleemSoort = new Map();
  for (const t of problemen) {
    const m = /^probleem \(([^)]+)\)/.exec(String(t.reden || ''));
    const soort = m ? m[1] : 'anders';
    perProbleemSoort.set(soort, (perProbleemSoort.get(soort) || 0) + 1);
  }
  const verbeterpunten = eigen(discovery).filter((a) => a.veld === 'verbeterpunt' && inWeek(a.created_at)).map((a) => a.waarde);

  /* Behandeltijd: hoe lang een afgeronde taak open stond, en hoe lang een gesprek duurde. */
  const afgerond = eigen(taken).filter((t) => t.status === 'done' && inWeek(t.afgerond_op));
  const dagenTussen = (a, b) => Math.round((new Date(dagVan(b)) - new Date(dagVan(a))) / 86400000);
  const looptijden = afgerond.map((t) => dagenTussen(t.created_at, t.afgerond_op)).filter((n) => Number.isFinite(n) && n >= 0).sort((a, b) => a - b);
  const mediaan = (lijst) => (lijst.length ? lijst[Math.floor(lijst.length / 2)] : null);
  const duren = eigen(interacties).filter((i) => i.type === 'call' && inWeek(i.started_at) && i.duur_seconden).map((i) => Number(i.duur_seconden)).sort((a, b) => a - b);

  /* Werkvoorraad: wat er nu ligt, ongeacht het venster. */
  const open = eigen(taken).filter((t) => t.status !== 'done');
  const achterstallig = open.filter((t) => dagVan(t.due_date || t.due_at) && dagVan(t.due_date || t.due_at) < vandaag);
  const perSoort = new Map();
  for (const t of open) perSoort.set(t.task_type || 'overig', (perSoort.get(t.task_type || 'overig') || 0) + 1);

  /* Per scriptversie: hoeveel gesprekken, en hoeveel daarvan tot een demo leidden. */
  const perScript = new Map();
  for (const i of eigen(interacties).filter((x) => x.type === 'call' && inWeek(x.started_at) && x.script_ref)) {
    const r = perScript.get(i.script_ref) || { gesprekken: 0, demos: 0 };
    r.gesprekken += 1;
    if (i.uitkomst === 'demo_ingepland') r.demos += 1;
    perScript.set(i.script_ref, r);
  }

  /*
    Het eerste gesprek is op een demo uit. Deze twee tellingen zeggen waar dat misgaat en waar
    het juist werkt: het afhaakmoment in de volgorde van het script, en waar hij naar voren
    leunde. Alleen de eerste gesprekken tellen mee; een opvolging of een demo heeft een ander doel.
  */
  const eersteGesprekken = eigen(interacties).filter((i) => i.type === 'call' && i.stap === 'eerste_contact' && inWeek(i.started_at));
  const perAfhaak = new Map();
  for (const i of eersteGesprekken) {
    if (!i.afhaakmoment) continue;
    perAfhaak.set(i.afhaakmoment, (perAfhaak.get(i.afhaakmoment) || 0) + 1);
  }
  const perAanslag = new Map();
  for (const i of eersteGesprekken) {
    for (const w of Array.isArray(i.aangeslagen_op) ? i.aangeslagen_op : []) perAanslag.set(w, (perAanslag.get(w) || 0) + 1);
  }
  /* Welke ingang leidde tot een demo: per aanslagpunt hoeveel gesprekken en hoeveel demo's. */
  const demoPerAanslag = new Map();
  for (const i of eersteGesprekken) {
    for (const w of Array.isArray(i.aangeslagen_op) ? i.aangeslagen_op : []) {
      const r = demoPerAanslag.get(w) || { gesprekken: 0, demos: 0 };
      r.gesprekken += 1;
      if (i.uitkomst === 'demo_ingepland') r.demos += 1;
      demoPerAanslag.set(w, r);
    }
  }
  const demosUitEerste = eersteGesprekken.filter((i) => i.uitkomst === 'demo_ingepland').length;

  /* De besluiten: wat er deze week geevalueerd moet worden, en wat er open staat. */
  const alle = eigen(besluiten).map((b) => ({
    id: b.id, probleem: b.probleem, wijziging: b.wijziging, status: b.status, herkomst: b.herkomst,
    verantwoordelijke: naamVan.get(b.verantwoordelijke) || null, ingangsdatum: dagVan(b.ingangsdatum), evaluatiedatum: dagVan(b.evaluatiedatum),
    gegevens: b.gegevens || {}, uitkomst: b.uitkomst || null, werkwijzeId: b.werkwijze_id || null,
  }));
  return {
    venster: w.venster, van: w.van, tot: w.tot, vandaag,
    service: {
      gesprekken: { aantal: serviceGesprekken.length, definitie: 'contactmomenten met stap service in dit venster' },
      perUitkomst: [...perServiceUitkomst.entries()].sort((a, b) => b[1] - a[1]),
      problemen: { aantal: problemen.length, definitie: 'taken met contactreden probleem oplossen die deze week ontstonden', perSoort: [...perProbleemSoort.entries()].sort((a, b) => b[1] - a[1]) },
      verbeterpunten,
    },
    behandeltijd: {
      takenAfgerond: afgerond.length,
      medianeLooptijdDagen: mediaan(looptijden),
      definitieLooptijd: 'mediaan van het aantal dagen tussen aanmaken en afronden, over de taken die deze week afgerond zijn',
      medianeGesprekstijdSeconden: mediaan(duren),
    },
    werkvoorraad: {
      open: open.length, achterstallig: achterstallig.length, perSoort: [...perSoort.entries()].sort((a, b) => b[1] - a[1]),
      definitie: 'open taken op dit moment, niet per venster',
    },
    perScript: [...perScript.entries()].map(([ref, r]) => ({ ref, ...r, naarDemo: r.gesprekken ? Math.round((r.demos / r.gesprekken) * 100) : null })).sort((a, b) => b.gesprekken - a.gesprekken),
    eersteGesprek: {
      gesprekken: eersteGesprekken.length,
      demos: demosUitEerste,
      naarDemo: eersteGesprekken.length ? Math.round((demosUitEerste / eersteGesprekken.length) * 100) : null,
      ingevuld: eersteGesprekken.filter((i) => i.afhaakmoment).length,
      definitie: 'contactmomenten van het type call met stap eerste_contact in dit venster; naarDemo is het aandeel dat op demo_ingepland uitkwam',
      perAfhaakmoment: [...perAfhaak.entries()].sort((a, b) => b[1] - a[1]),
      perAanslagpunt: [...perAanslag.entries()].sort((a, b) => b[1] - a[1]),
      demoPerAanslagpunt: [...demoPerAanslag.entries()].map(([punt, r]) => ({ punt, ...r, naarDemo: r.gesprekken ? Math.round((r.demos / r.gesprekken) * 100) : null })).sort((a, b) => b.gesprekken - a.gesprekken),
    },
    bezwaren: (() => {
      const per = new Map();
      for (const b of eigen(bezwaren).filter((x) => inWeek(x.created_at))) per.set(b.categorie || 'zonder categorie', (per.get(b.categorie || 'zonder categorie') || 0) + 1);
      return [...per.entries()].sort((a, b) => b[1] - a[1]);
    })(),
    besluiten: {
      teEvalueren: alle.filter((b) => b.evaluatiedatum && b.evaluatiedatum <= vandaag && b.status !== 'geevalueerd'),
      open: alle.filter((b) => ['voorstel', 'aangenomen'].includes(b.status)),
      voorstellen: alle.filter((b) => b.status === 'voorstel'),
      alle,
    },
    werkwijzenDezeWeek: eigen(werkwijzen).filter((x) => inWeek(x.created_at)).map((x) => ({ soort: x.soort, ref: x.ref, versie: x.versie, watVeranderd: x.wat_veranderd, soortWijziging: x.soort_wijziging })),
  };
}

/* Een verbeterbesluit vastleggen; een AI-voorstel begint altijd als voorstel. */
export async function bewaarVerbeterbesluit(adapter, {
  companyId, probleem, wijziging, gegevens = {}, verantwoordelijkeId = null, ingangsdatum = null, evaluatiedatum = null,
  werkwijzeId = null, werkgebied = null, herkomst = 'mens', status, weekVan = null, doorPersonId = null,
} = {}) {
  if (!companyId || !String(probleem || '').trim() || !String(wijziging || '').trim()) throw new Error('een verbeterbesluit vraagt het probleem en de voorgestelde wijziging.');
  if (!['mens', 'ai'].includes(herkomst)) throw new Error("herkomst is mens of ai.");
  const gekozen = herkomst === 'ai' ? 'voorstel' : (status || 'aangenomen');
  if (!BESLUIT_STATUSSEN.includes(gekozen)) throw new Error(`status '${gekozen}' is onbekend. Kies ${BESLUIT_STATUSSEN.join(', ')}.`);
  const r = await adapter.insertVerbeterbesluit({
    company_id: companyId, probleem: String(probleem).trim(), wijziging: String(wijziging).trim(), gegevens,
    verantwoordelijke: verantwoordelijkeId, ingangsdatum, evaluatiedatum, werkwijze_id: werkwijzeId, werkgebied,
    status: gekozen, herkomst, week_van: weekVan, door: doorPersonId,
  });
  return { id: r.id, status: gekozen, herkomst };
}

/* De stand van een besluit bijwerken; bij geevalueerd hoort de uitkomst erbij. */
export async function zetBesluitStatus(adapter, { besluitId, status, uitkomst = null } = {}) {
  if (!BESLUIT_STATUSSEN.includes(status)) throw new Error(`status '${status}' is onbekend. Kies ${BESLUIT_STATUSSEN.join(', ')}.`);
  if (status === 'geevalueerd' && !String(uitkomst || '').trim()) throw new Error('een geevalueerd besluit vraagt de uitkomst: hielp het, of niet.');
  await adapter.updateVerbeterbesluit(besluitId, { status, uitkomst: uitkomst || null });
  return { ok: true, status };
}
