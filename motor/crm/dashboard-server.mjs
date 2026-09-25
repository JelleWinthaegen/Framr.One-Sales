#!/usr/bin/env node
/*
  Jarvis - dashboard-server: het dashboard van Framr.One Sales.

  Een kleine server op de Jarvis-motor: hij serveert de schermen (crm/dashboard/) en een
  JSON-laag erachter die dezelfde functies aanroept als de belronde-cli. Jelle kijkt mee in
  de browser; Myron en Jelle werken erin, tegelijk, op dezelfde database. Vier standen:

    node crm/dashboard-server.mjs --poort 4620 --nep
        verzonnen gegevens op de mock-adapter (dashboard-nep.mjs); alle schermen gevuld,
        schrijven mag, niets raakt de live database
    node crm/dashboard-server.mjs --poort 4622 --leeg [--leads 100]
        de verse stand: dezelfde mock-adapter, maar het programma zoals het er op dag een uit
        ziet. De seed, twee bellers en honderd net geimporteerde leads, verder helemaal niets:
        geen gesprekken, geen taken, geen demo's, geen partners, geen meldingen. Om de werkwijze
        stap voor stap door te lopen en te zien wat elke stap zelf doet
    node crm/dashboard-server.mjs --poort 4620 --company oaklyn
        de live database, alleen lezen (pg-live-read); elke schrijfknop wordt geweigerd
    JARVIS_LIVE_WRITE=1 node crm/dashboard-server.mjs --poort 4620 --company oaklyn --schrijf NAAR-LIVE
        de live database, schrijven aan (pg-live): dezelfde dubbele grendel als elke live-CLI,
        met de banner bij het starten

  JARVIS_DB_URL komt uit de shell of, als die er niet is, uit ~/jarvis-db-url.txt via de
  canonieke resolver, zodat de launch-configuratie hem niet hoeft te kennen.

  De server bewaart niets zelf: alle data komt uit de adapter, met een korte cache (45
  seconden op live) die na elke schrijfactie leeg gaat. De claim op een lead (wie hem nu
  behandelt) staat in de database, niet in de server, zodat twee servers of twee schermen
  dezelfde waarheid zien. Geen inlog: dit draait lokaal op de Mac van Jelle.

  Stijl: blokcommentaar, geen lange streepjes en geen emoji, conform de projectafspraken.
*/

import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync, writeFileSync, statSync, createReadStream } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname, resolve as resolvePad } from 'node:path';

import { createMockAdapter } from '../db/mock-db-adapter.mjs?v=5dd6073';
import { selectAdapter } from '../db/select-adapter.mjs?v=5dd6073';
import { hostAndRef } from '../db/security-check.mjs?v=5dd6073';
import { DEFAULT_TEST_COMPANY_ID } from '../staging-writer.mjs?v=5dd6073';
import { buildLeadScreen, setLeadFase } from './crm-store.mjs?v=5dd6073';
import {
  FRAMR_PIPELINE, FRAMR_FASEN, BELUITKOMSTEN, UITKOMST_REGELS, KERNBOODSCHAPPEN, INGANGEN, LEADBLAD_KOLOMMEN, DEMO_ONDERDELEN,
  GESPREK_SCRIPT, SCRIPTS, VORIGE_SCRIPTS, SOPS, STAPPEN, BERICHT_TEMPLATES, STANDAARD_OPVOLGREEKSEN, COMMERCIELE_FASEN, TAAKRESULTATEN, BEZWAAR_RESULTATEN, BEZWAAR_SOORTEN, CONTACTREDENEN, WERKBAKKEN, contactredenVoor,
  EXTRA_SOORTEN, AFSPRAAK_STATUSSEN, VERZEND_STATUSSEN, CLAIM_MINUTEN, CONTACTUITKOMSTEN, GESPREKSRESULTATEN, SERVICE_UITKOMSTEN, PROBLEEM_SOORTEN, bevestigLevering, leadVoorPartner, maakLeadHandmatig,
  AFHAAKMOMENTEN, AFHAAKMOMENT_UITLEG, AANSLAGPUNTEN, AANSLAGPUNT_UITLEG, ONBOARDING_MIJLPALEN,
  dagVan, tijdVan, plusDagen, kiesDagselectie, schrijfDagselectie, registreerGesprek, registreerBericht, registreerReactie, planDemo, annuleerDemo,
  registreerDemoGedaan, rondTaakAf, claimLead, geefLeadVrij, hartslagLead, koppelOpname, maakLosContactmoment, bouwDemoBriefing, bouwWerklijst, volgendeVoorSessie,
  volgendeActieVoor, laatsteContactVoor, reactieStatus, commercieleFase, trajectstatus, claimIsActief, kiesStap, scriptRef,
  bouwDagrapport, bouwDashboard, bouwLeadbladRijen, feitenIndex, researchIndex, classificatieIndex,
} from './belronde-store.mjs?v=5dd6073';
import {
  bouwPartnerbeeld, bouwBezwarenbibliotheek, bezwarenVanLead, bouwWeekrapport, filterLeadRijen, bouwOpvolging, bouwAgenda, bouwGesprekkenLijst,
  bouwFeedback, bouwDemoOverzicht, bouwDataInventaris, bouwDagstand, bouwFunnelVerdeling, bouwCohortConversie, partnerKoppeling, weekVenster,
  bouwWeekreview, bewaarVerbeterbesluit, zetBesluitStatus, BESLUIT_STATUSSEN,
  PARTNER_MIJLPALEN, GEZONDHEID, VASTE_ANTWOORDEN,
} from './dashboard-data.mjs?v=5dd6073';
import { bewaarWerkwijze, meldingenVoor, markeerGezien, geschiedenisVan, werkwijzeInhoud, WERKWIJZE_SOORTEN } from './sales-werkwijzen.mjs?v=5dd6073';
import { maakSessies, login, maakGebruiker, wijzigWachtwoord, zonderGeheimen, heeftRecht, rechtenVan, ROLLEN, RECHTEN } from './sales-gebruikers.mjs?v=5dd6073';
import { vulNep } from './dashboard-nep.mjs?v=5dd6073';
import { analyseerGesprek, transcribeerEnAnalyseer, DEFAULT_MODEL } from './gesprek-extractie.mjs?v=5dd6073';

const HIER = dirname(fileURLToPath(import.meta.url));
const SCHERMEN = join(HIER, 'dashboard');
const PORTAAL_CSS = join(HIER, '..', '..', '..', 'framr-portaal', 'app', 'framr.css');
const GEEN_CACHE = 'no-store, no-cache, must-revalidate';
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.webm': 'audio/webm', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4', '.mp4': 'audio/mp4', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.txt': 'text/plain; charset=utf-8' };

function arg(naam, standaard) {
  const i = process.argv.indexOf(`--${naam}`);
  if (i === -1) return standaard;
  const v = process.argv[i + 1];
  return v === undefined || v.startsWith('--') ? true : v;
}

/*
  De adapter en de modus. Een losse functie zodat de tests een server kunnen bouwen zonder
  argumenten van de command line en zonder live database.
*/
export async function maakBron({ nep = false, leeg = false, aantalLeads = null, company = 'oaklyn', schrijf = null, env = process.env, vandaagVast = null, opnamesMap = null, dagdoel = null } = {}) {
  /* Waar de opnames uit de belsessie landen: een map op de Mac (standaard ~/Gesprekken/Framr.One),
     die Jelle zelf naar de Drive laat lopen. In de oefenstand een wegwerpmap. De database krijgt
     alleen de verwijzing (opname_ref), nooit de bytes. */
  const doel = Number(dagdoel || env.JARVIS_SALES_DAGDOEL || 10) || 10;
  if (nep) {
    const adapter = createMockAdapter();
    const vandaag = vandaagVast || dagVan(new Date());
    const map = opnamesMap || join(tmpdir(), 'framr-sales-oefenstand');
    await vulNep(adapter, { companyId: DEFAULT_TEST_COMPANY_ID, vandaag, slug: company, opnamesMap: map, leeg, aantalLeads });
    return { adapter, companyId: DEFAULT_TEST_COMPANY_ID, company, modus: 'nep', leeg, schrijven: true, vandaagVast: vandaag, closeable: false, opnamesMap: map, dagdoel: doel };
  }
  if (!env.JARVIS_DB_URL) {
    const resolver = join(HIER, '..', '..', 'lib', 'resolve-db-url.mjs');
    env.JARVIS_DB_URL = execFileSync(process.execPath, [resolver], { encoding: 'utf8' }).trim();
  }
  const wilSchrijven = schrijf === 'NAAR-LIVE';
  env.PIPELINE_DB = wilSchrijven ? 'pg-live' : 'pg-live-read';
  const { adapter, closeable } = selectAdapter({ env, confirm: wilSchrijven ? 'NAAR-LIVE' : null });
  const c = await adapter.findCompanyBySlug(company);
  if (!c) throw new Error(`geen company met slug '${company}' op deze database.`);
  return { adapter, companyId: c.id, company, modus: wilSchrijven ? 'live-schrijven' : 'live-lezen', schrijven: wilSchrijven, vandaagVast: null, closeable, opnamesMap: opnamesMap || join(homedir(), 'Gesprekken', 'Framr.One'), dagdoel: doel };
}

/* De datasets die de schermen nodig hebben, in een keer, met een korte cache. */
const BRONNEN = {
  leads: 'fetchLeads', fasen: 'fetchPipelineFases', classificaties: 'fetchLeadClassifications', research: 'fetchLeadResearch',
  interacties: 'fetchInteractions', taken: 'fetchTasks', queue: 'fetchSalesQueue', afspraken: 'fetchSalesAfspraken', reeksen: 'fetchOpvolgreeksen',
  bezwaren: 'fetchObjections', kansen: 'fetchOpportunities', vragen: 'fetchQuestions', discovery: 'fetchDiscoveryAnswers', bronnen: 'fetchLeadSources',
  feiten: 'fetchLeadFacts', people: 'fetchPeople', leadPeople: 'fetchLeadPeople', partners: 'fetchPortalPartners', orders: 'fetchPortalOrders',
  projects: 'fetchPortalProjects', measurements: 'fetchPortalMeasurements', quotes: 'fetchPortalQuotes', invoices: 'fetchPortalInvoices',
  customers: 'fetchPortalCustomers', calculations: 'fetchPortalCalculations', suggesties: 'fetchSalesSuggestions', weetjes: 'fetchCrmWeetjes',
  evaluaties: 'fetchDemoEvaluaties', opties: 'fetchVeldopties', werkwijzen: 'fetchSalesWerkwijzen', werkwijzeGezien: 'fetchSalesWerkwijzeGezien', besluiten: 'fetchVerbeterbesluiten',
};

/*
  De AI-client voor de analyse van gesprekken: uit ANTHROPIC_API_KEY, of ingegeven door een
  test. Zonder sleutel geen client, en dan blijft elke analyse op wacht staan met de reden.
*/
async function maakAnthropic(env) {
  if (!env.ANTHROPIC_API_KEY) return null;
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  return new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
}

/*
  Welk recht een route vraagt (aanvulling onderdeel 7). Wat hier niet staat vraagt alleen dat
  je ingelogd bent. De server weigert met 403; het scherm verbergt de knop ook, maar dat is de
  beleefdheid, niet het slot.
*/
const RECHT_PER_ROUTE = {
  'GET /api/funnel': 'rapportages', 'GET /api/weekrapport': 'rapportages', 'GET /api/bezwaren': 'rapportages',
  'GET /api/demos': 'rapportages', 'GET /api/feedback': 'rapportages', 'GET /api/partners': 'rapportages',
  'GET /api/dagrapport': 'rapportages', 'GET /api/dashboard': 'rapportages', 'GET /api/data': 'rapportages', 'GET /api/weekreview': 'rapportages',
  'POST /api/gesprek': 'sales', 'POST /api/bericht': 'sales', 'POST /api/verstuurd': 'sales', 'POST /api/reactie': 'sales',
  'POST /api/demo': 'sales', 'POST /api/demo/annuleren': 'sales', 'POST /api/demo-gedaan': 'sales',
  'POST /api/sessie/volgende': 'sales', 'POST /api/dagselectie/vastzetten': 'sales', 'POST /api/fase': 'sales',
  'POST /api/leads/fase-invullen': 'sales', 'POST /api/toewijzen': 'sales', 'POST /api/lead/pauze': 'sales', 'POST /api/lead/kanalen': 'sales',
  'POST /api/lead/nieuw': 'sales',
  'POST /api/levering/bevestigen': 'service',
  'POST /api/taak/toewijzen': null,
  'POST /api/reeksen': 'werkwijze_beheer', 'POST /api/werkwijze': 'werkwijze_beheer',
  'POST /api/besluit': 'rapportages', 'POST /api/besluit/status': 'rapportages',
  'GET /api/gebruikers': 'gebruikersbeheer', 'POST /api/gebruikers': 'gebruikersbeheer',
  'POST /api/gebruiker/wachtwoord': 'gebruikersbeheer', 'POST /api/gebruiker/rol': 'gebruikersbeheer', 'POST /api/gebruiker/actief': 'gebruikersbeheer',
};

/* Een servicegesprek mag ook met alleen het servicerecht; een verkoopgesprek niet. */
function rechtVoor(sleutel, body = {}) {
  if (sleutel === 'POST /api/gesprek' && body && body.stap === 'service') return 'service';
  if (sleutel === 'POST /api/taak/afronden' || sleutel === 'POST /api/taak/klaar') return null;
  return RECHT_PER_ROUTE[sleutel] || null;
}

export function maakApp(bron, { cacheMs = 45000, anthropic, transcribeer, env = process.env, sessies = maakSessies() } = {}) {
  const { adapter, companyId, company, modus, schrijven } = bron;
  let cache = null;
  let cacheTot = 0;
  const model = env.JARVIS_LLM_MODEL || DEFAULT_MODEL;
  let anthropicClient = anthropic;
  async function aiClient() {
    if (anthropicClient === undefined) anthropicClient = await maakAnthropic(env);
    return anthropicClient;
  }
  /* De verwerking van een opname loopt na het opslaan door, buiten het antwoord om; wat er
     gebeurt staat als status op het contactmoment, nooit alleen in een log. */
  const lopend = new Set();
  async function verwerkAchteraf(interactionId) {
    if (lopend.has(interactionId)) return;
    lopend.add(interactionId);
    try {
      await transcribeerEnAnalyseer(adapter, { companyId, interactionId, env, anthropic: await aiClient(), transcribeer, model, vandaag: await vandaag() });
    } catch (e) {
      process.stderr.write(`AI-verwerking van ${interactionId} mislukt: ${e.message}\n`);
      try { await adapter.updateInteraction(interactionId, { ai_analyse: { status: 'fout', reden: e.message, verwerktOp: new Date().toISOString() } }); } catch { /* niets meer te doen */ }
    } finally {
      lopend.delete(interactionId);
      vergeet();
    }
  }

  async function data() {
    const nu = Date.now();
    if (cache && nu < cacheTot) return cache;
    const uit = {};
    for (const [naam, methode] of Object.entries(BRONNEN)) uit[naam] = adapter[methode] ? await adapter[methode]() : [];
    cache = uit;
    cacheTot = nu + (modus === 'nep' ? 0 : cacheMs);
    return uit;
  }
  function vergeet() { cache = null; }

  async function vandaag() {
    if (bron.vandaagVast) return bron.vandaagVast;
    return dagVan(adapter.fetchNow ? await adapter.fetchNow() : new Date());
  }
  async function nu() {
    if (bron.vandaagVast) return `${bron.vandaagVast}T${new Date().toISOString().slice(11)}`;
    return new Date(adapter.fetchNow ? await adapter.fetchNow() : new Date()).toISOString();
  }

  const bellers = (d) => d.people.filter((p) => p.company_id === companyId && ['owner', 'employee', 'beller'].includes(p.role)).map((p) => ({ id: p.id, name: p.name }));
  const opties = (d, veld) => d.opties.filter((o) => o.company_id === companyId && o.veld === veld && o.actief !== false).map((o) => o.waarde).sort();
  const reeksen = (d) => {
    const eigen = d.reeksen.filter((r) => r.company_id === companyId);
    return STANDAARD_OPVOLGREEKSEN.map((s) => {
      const e = eigen.find((r) => r.aanleiding === s.aanleiding);
      return e ? { id: e.id, aanleiding: e.aanleiding, naam: e.naam || s.naam, stappen: e.stappen || [], maxPogingen: e.max_pogingen, actief: e.actief !== false, versie: e.versie, bron: 'database' } : { id: null, ...s, actief: true, versie: 0, bron: 'standaard' };
    });
  };
  const kort = (l) => ({ id: l.id, naam: l.naam, plaats: l.plaats || null, regio: l.regio || null, telefoon: l.telefoon || null, whatsapp: l.whatsapp || null, email: l.email || null, website: l.website || null, rechtsvorm: l.rechtsvorm || null, belOptIn: l.bel_opt_in ?? null, kvk: l.kvk_nummer || null, toegewezen: l.toegewezen_aan || null, gepauzeerdTot: l.gepauzeerd_tot ? dagVan(l.gepauzeerd_tot) : null, geenContactVia: l.geen_contact_via || [] });
  const scopeVan = (q) => q.get('scope') || 'mijn';
  /* Het werkgebied: het account bepaalt wat je MAG zien (leeg is alles), de werkbalk wat je WIL
     zien. Een gekozen gebied dat niet mag valt terug op wat mag; dat is de afdwinging, niet het
     verbergen van een keuzelijst. */
  const magGebieden = (ctx = {}) => ((ctx.gebruiker && (ctx.gebruiker.werkgebieden || []).length) ? ctx.gebruiker.werkgebieden : null);
  const gebiedVan = (q, ctx = {}) => {
    const mag = magGebieden(ctx);
    const gekozen = q.get('werkgebied') || null;
    if (!mag) return gekozen;
    return gekozen && mag.includes(gekozen) ? gekozen : mag;
  };
  const bellerVan = async (q, d) => q.get('beller') || (bellers(d)[0] || {}).id || null;
  const lijst = (v) => (Array.isArray(v) ? v : (v === undefined || v === null || v === '' ? [] : String(v).split(',').map((x) => x.trim()).filter(Boolean)));

  const routes = {
    /* Inloggen, uitloggen en wie ben ik (aanvulling onderdeel 7). */
    async 'POST /api/inloggen'(q, body) {
      const g = await login(adapter, { companyId, email: body.email, wachtwoord: body.wachtwoord, nu: await nu() });
      if (!g) throw fout(401, 'e-mailadres of wachtwoord klopt niet, of het account staat uit.');
      vergeet();
      return { ok: true, token: sessies.start(g), gebruiker: g };
    },
    async 'POST /api/uitloggen'(q, body, ctx = {}) {
      sessies.stop(ctx.token || body.token || null);
      return { ok: true };
    },
    /* De voorkeuren van de ingelogde gebruiker (weergave begeleid of compact, scope). */
    async 'POST /api/voorkeuren'(q, body, ctx = {}) {
      if (!ctx.gebruiker) throw fout(401, 'niet ingelogd.');
      const g = await adapter.updateSalesGebruiker(ctx.gebruiker.id, { voorkeuren: { ...(ctx.gebruiker.voorkeuren || {}), ...(body.voorkeuren || {}) } });
      vergeet();
      return { ok: true, voorkeuren: (g || {}).voorkeuren || {} };
    },
    /* De weekreview: wat we leren en wat we besluiten (aanvulling onderdeel 8). */
    async 'GET /api/weekreview'(q) {
      const d = await data();
      const v = await vandaag();
      const venster = q.get('venster') === 'kalenderweek' ? 'kalenderweek' : 'zeven_dagen';
      const review = bouwWeekreview({ ...d, vandaag: v, companyId, venster, verschuiving: Number(q.get('verschuiving') || 0) });
      const partnerbeeld = bouwPartnerbeeld({ ...d, vandaag: v, companyId });
      const rapport = bouwWeekrapport({ ...d, vandaag: v, companyId, partnerbeeld, venster, scope: 'iedereen', dagdoel: bron.dagdoel });
      return { ...review, rapport: { dezeWeek: rapport.dezeWeek, vorigeWeek: rapport.vorigeWeek, aandachtspunten: rapport.aandachtspunten, perUitkomst: rapport.perUitkomst }, statussen: BESLUIT_STATUSSEN, bellers: bellers(d) };
    },
    async 'POST /api/besluit'(q, body, ctx = {}) {
      const r = await bewaarVerbeterbesluit(adapter, {
        companyId, probleem: body.probleem, wijziging: body.wijziging, gegevens: body.gegevens && typeof body.gegevens === 'object' ? body.gegevens : {},
        verantwoordelijkeId: leeg(body.verantwoordelijkeId) || null, ingangsdatum: leeg(body.ingangsdatum) || null, evaluatiedatum: leeg(body.evaluatiedatum) || null,
        werkwijzeId: leeg(body.werkwijzeId) || null, werkgebied: leeg(body.werkgebied) || null, herkomst: leeg(body.herkomst) || 'mens',
        status: leeg(body.status), weekVan: leeg(body.weekVan) || null, doorPersonId: (ctx.gebruiker && ctx.gebruiker.person_id) || leeg(body.doorId) || null,
      });
      vergeet();
      return r;
    },
    async 'POST /api/besluit/status'(q, body) {
      const r = await zetBesluitStatus(adapter, { besluitId: body.besluitId, status: body.status, uitkomst: leeg(body.uitkomst) });
      vergeet();
      return r;
    },
    /* De werkwijzen: de geschiedenis per script, template of reeks, en de meldingen. */
    async 'GET /api/werkwijzen'(q, body, ctx = {}) {
      const d = await data();
      const soort = q.get('soort') || null;
      const ref = q.get('ref') || null;
      return {
        meldingen: meldingenVoor({ werkwijzen: d.werkwijzen, gezien: d.werkwijzeGezien, companyId, gebruikerId: ctx.gebruiker ? ctx.gebruiker.id : null, personId: (ctx.gebruiker && ctx.gebruiker.person_id) || q.get('beller') || null, werkgebieden: magGebieden(ctx), vandaag: await vandaag() }),
        geschiedenis: soort && ref ? geschiedenisVan({ werkwijzen: d.werkwijzen, companyId, soort, ref }) : [],
        soorten: WERKWIJZE_SOORTEN,
        alle: d.werkwijzen.filter((w) => w.company_id === companyId).map((w) => ({ id: w.id, soort: w.soort, ref: w.ref, versie: w.versie, watVeranderd: w.wat_veranderd, soortWijziging: w.soort_wijziging, wanneer: dagVan(w.created_at) })).sort((a, b) => String(b.wanneer).localeCompare(String(a.wanneer))),
      };
    },
    async 'POST /api/werkwijze'(q, body, ctx = {}) {
      const r = await bewaarWerkwijze(adapter, {
        companyId, soort: body.soort, ref: body.ref, inhoud: body.inhoud, watVeranderd: leeg(body.watVeranderd), waarom: leeg(body.waarom),
        watAnders: leeg(body.watAnders), voorStappen: Array.isArray(body.voorStappen) ? body.voorStappen : [], soortWijziging: leeg(body.soortWijziging) || 'inhoudelijk',
        geldigVanaf: leeg(body.geldigVanaf) || await vandaag(), werkgebied: leeg(body.werkgebied) || null, doorPersonId: (ctx.gebruiker && ctx.gebruiker.person_id) || leeg(body.doorId) || null,
      });
      vergeet();
      return r;
    },
    async 'POST /api/werkwijze/gezien'(q, body, ctx = {}) {
      const r = await markeerGezien(adapter, { werkwijzeId: body.werkwijzeId, gebruikerId: ctx.gebruiker ? ctx.gebruiker.id : null, personId: (ctx.gebruiker && ctx.gebruiker.person_id) || leeg(body.doorId) || null });
      vergeet();
      return r;
    },
    async 'GET /api/gebruikers'() {
      const alle = (await adapter.fetchSalesGebruikers()).filter((g) => g.company_id === companyId);
      const d = await data();
      const naamVan = new Map(d.people.map((p) => [p.id, p.name]));
      return { rechten: RECHTEN, rollen: ROLLEN, gebruikers: alle.map((g) => ({ ...zonderGeheimen(g), persoon: naamVan.get(g.person_id) || null })).sort((a, b) => String(a.email).localeCompare(String(b.email))) };
    },
    async 'POST /api/gebruikers'(q, body) {
      const r = await maakGebruiker(adapter, { companyId, email: body.email, wachtwoord: body.wachtwoord, rol: leeg(body.rol) || 'sales', personId: leeg(body.personId) || null, werkgebieden: Array.isArray(body.werkgebieden) ? body.werkgebieden : [], rechten: Array.isArray(body.rechten) ? body.rechten : [] });
      vergeet();
      return r;
    },
    async 'POST /api/gebruiker/wachtwoord'(q, body) {
      if (!body.gebruikerId) throw fout(400, 'gebruikerId ontbreekt.');
      await wijzigWachtwoord(adapter, { gebruikerId: body.gebruikerId, wachtwoord: body.wachtwoord });
      sessies.stopAlleVan(body.gebruikerId);
      vergeet();
      return { ok: true };
    },
    async 'POST /api/gebruiker/rol'(q, body) {
      if (!ROLLEN.includes(body.rol)) throw fout(400, `rol '${body.rol}' is onbekend.`);
      const patch = { rol: body.rol };
      if (Array.isArray(body.rechten)) patch.rechten = body.rechten.filter((r) => RECHTEN[String(r).replace(/^-/, '')]);
      await adapter.updateSalesGebruiker(body.gebruikerId, patch);
      vergeet();
      return { ok: true };
    },
    async 'POST /api/gebruiker/actief'(q, body) {
      await adapter.updateSalesGebruiker(body.gebruikerId, { actief: Boolean(body.actief) });
      if (!body.actief) sessies.stopAlleVan(body.gebruikerId);
      vergeet();
      return { ok: true };
    },
    async 'GET /api/stand'(q, body, ctx = {}) {
      const d = await data();
      const fasen = d.fasen.filter((f) => f.company_id === companyId && f.pipeline === FRAMR_PIPELINE);
      return {
        modus, schrijven, company, companyId, vandaag: await vandaag(), pipeline: FRAMR_PIPELINE, leeg: Boolean(bron.leeg),
        seedAanwezig: fasen.length === FRAMR_FASEN.length, fasen: fasen.sort((a, b) => a.volgorde - b.volgorde).map((f) => f.naam),
        commercieleFasen: COMMERCIELE_FASEN, contactuitkomsten: CONTACTUITKOMSTEN, gespreksresultaten: GESPREKSRESULTATEN,
        bellers: bellers(d), uitkomsten: BELUITKOMSTEN, regels: UITKOMST_REGELS, materialen: opties(d, 'materiaal'), demoVormen: opties(d, 'demo_vorm'),
        bezwaarCategorieen: opties(d, 'bezwaar_categorie'), vraagCategorieen: opties(d, 'vraag_categorie'), demoOnderdelen: DEMO_ONDERDELEN,
        bezwaarResultaten: BEZWAAR_RESULTATEN, bezwaarSoorten: BEZWAAR_SOORTEN, extraSoorten: EXTRA_SOORTEN, taakResultaten: TAAKRESULTATEN,
        afspraakStatussen: AFSPRAAK_STATUSSEN, verzendStatussen: VERZEND_STATUSSEN, stappen: STAPPEN,
        kernboodschappen: KERNBOODSCHAPPEN, ingangen: INGANGEN, mijlpalen: PARTNER_MIJLPALEN, gezondheid: GEZONDHEID,
        script: GESPREK_SCRIPT, scripts: SCRIPTS, vorigeScripts: VORIGE_SCRIPTS, sops: SOPS, templates: BERICHT_TEMPLATES, reeksen: reeksen(d), vasteAntwoorden: VASTE_ANTWOORDEN,
        contactredenen: CONTACTREDENEN, werkbakken: WERKBAKKEN, serviceUitkomsten: SERVICE_UITKOMSTEN, probleemSoorten: PROBLEEM_SOORTEN,
        afhaakmomenten: AFHAAKMOMENTEN, afhaakUitleg: AFHAAKMOMENT_UITLEG, aanslagpunten: AANSLAGPUNTEN, aanslagUitleg: AANSLAGPUNT_UITLEG, onboardingMijlpalen: ONBOARDING_MIJLPALEN,
        werkgebieden: (magGebieden(ctx) || [...new Set(d.leads.filter((l) => l.company_id === companyId && l.werkgebied).map((l) => l.werkgebied))]).sort(),
        mijnWerkgebieden: magGebieden(ctx),
        discoveryVelden: opties(d, 'discovery_veld'),
        waardenPerVeld: Object.fromEntries(opties(d, 'discovery_veld').map((veld) => [veld, opties(d, veld)]).filter(([, w]) => w.length)),
        opnamesMap: bron.opnamesMap || null, dagdoel: bron.dagdoel || 10, claimMinuten: CLAIM_MINUTEN,
        /* De ingelogde gebruiker met zijn rechten; zonder accounts staat de deur open (de
           oefenstand en de eerste dagen op live), zodra er een account is moet je inloggen. */
        ik: ctx.gebruiker ? { ...ctx.gebruiker, personId: ctx.gebruiker.person_id || null } : null,
        meldingen: meldingenVoor({ werkwijzen: d.werkwijzen, gezien: d.werkwijzeGezien, companyId, gebruikerId: ctx.gebruiker ? ctx.gebruiker.id : null, personId: (ctx.gebruiker && ctx.gebruiker.person_id) || q.get('beller') || null, werkgebieden: magGebieden(ctx), vandaag: await vandaag() }),
        inlogVereist: await inlogVereist(), rollen: ROLLEN, rechtenLijst: RECHTEN,
        ai: { extractie: Boolean(env.ANTHROPIC_API_KEY || anthropic), transcriptie: Boolean(env.OPENAI_API_KEY || transcribeer), model },
      };
    },
    async 'GET /api/dashboard'() {
      const d = await data();
      return bouwDashboard({ ...d, companyId, pipeline: FRAMR_PIPELINE, vandaag: await vandaag() });
    },
    /* Vandaag: de werklijst (wat moet) en de dagstand (wat is gedaan), in dezelfde scope. */
    async 'GET /api/werklijst'(q, body, ctx = {}) {
      const d = await data();
      const bellerId = await bellerVan(q, d);
      const v = await vandaag();
      const w = bouwWerklijst({ ...d, bellerId, scope: scopeVan(q), vandaag: v, nu: await nu(), aantalNieuw: Number(q.get('aantalNieuw') || 25), pipeline: FRAMR_PIPELINE, classificatie: q.get('classificatie') === 'alle' ? null : (q.get('classificatie') || null), companyId, werkgebied: gebiedVan(q, ctx) });
      const dagstand = bouwDagstand({ ...d, bellerId, scope: scopeVan(q), vandaag: v, dagdoel: bron.dagdoel, companyId });
      return { ...w, items: w.items.map((i) => ({ ...i, lead: kort(i.lead) })), dagstand, bellerId };
    },
    async 'GET /api/dagstand'(q) {
      const d = await data();
      return bouwDagstand({ ...d, bellerId: await bellerVan(q, d), scope: scopeVan(q), vandaag: await vandaag(), dagdoel: bron.dagdoel, companyId });
    },
    async 'GET /api/dagselectie'(q) {
      const d = await data();
      const bellerId = await bellerVan(q, d);
      if (!bellerId) throw fout(400, 'geen beller bekend; leg eerst een persoon vast.');
      const s = kiesDagselectie({ ...d, bellerId, vandaag: await vandaag(), nu: await nu(), aantal: Number(q.get('aantal') || 25), pipeline: FRAMR_PIPELINE, classificatie: q.get('classificatie') === 'alle' ? null : (q.get('classificatie') || 'vloerenlegger'), companyId });
      return { bellerId, vandaag: await vandaag(), selectie: s.map((x) => ({ ...x, lead: kort(x.lead) })) };
    },
    async 'GET /api/dagrapport'(q) {
      const d = await data();
      const bellerId = await bellerVan(q, d);
      const r = bouwDagrapport({ ...d, bellerId, vandaag: await vandaag() });
      delete r.faseVan;
      r.lijst = r.lijst.map((x) => ({ ...x, lead: kort(x.lead) }));
      return { bellerId, ...r };
    },
    async 'GET /api/leads'(q) {
      const d = await data();
      const v = await vandaag();
      const rijen = bouwLeadbladRijen({ ...d, companyId, alles: true, vandaag: v, nu: await nu() }).map((r) => ({ ...r, volgende_actie_type: (volgendeActieVoor({ taken: d.taken, afspraken: d.afspraken, leadId: r.leadnummer, vandaag: v }) || {}).taak || '' }));
      return filterLeadRijen(rijen, {
        zoek: q.get('zoek'), classificatie: q.get('classificatie'), regio: q.get('regio'), beller: q.get('beller'), fase: q.get('fase'), commercieel: q.get('commercieel'), actie: q.get('actie'),
        achterstallig: q.get('achterstallig'), reactie: q.get('reactie'), geenActie: q.get('geenActie'), tag: q.get('tag'), behandeling: q.get('behandeling'), ids: q.get('ids'), traject: q.get('traject'), sorteer: q.get('sorteer'), vandaag: v, pagina: q.get('pagina'), per: q.get('per'),
      });
    },
    async 'GET /api/leadblad'() {
      const d = await data();
      return { kolommen: LEADBLAD_KOLOMMEN, rijen: bouwLeadbladRijen({ ...d, companyId, alles: true, vandaag: await vandaag() }) };
    },
    /* Het dossier: alles over een bedrijf, met bovenaan de antwoorden op wie, met wie, wat we weten,
       wat besproken en gestuurd is, of er gereageerd is, waar we staan en wat hierna komt. */
    async 'GET /api/lead'(q) {
      const d = await data();
      const id = q.get('id');
      const v = await vandaag();
      const s = await buildLeadScreen(adapter, { companyId, leadId: id, limitTijdlijn: 500 });
      const naamVan = new Map(d.people.map((p) => [p.id, p.name]));
      const feiten = feitenIndex(d.feiten).get(id) || new Map();
      const l = s.lead;
      const faseNaam = s.fase ? s.fase.naam : null;
      const afspraken = d.afspraken.filter((a) => a.lead_id === id).sort((a, b) => String(b.start_at).localeCompare(String(a.start_at)));
      const openAfspraak = afspraken.find((a) => ['gepland', 'verplaatst'].includes(a.status)) || null;
      const laatste = laatsteContactVoor(d.interacties, id);
      const klok = await nu();
      const stap = kiesStap({ fase: faseNaam, openTaak: s.openTaken[0] || null, afspraak: openAfspraak, laatsteInteractie: laatste ? { type: laatste.type } : null, laatsteBericht: laatste ? laatste.laatsteBericht : null });
      const koppel = partnerKoppeling({ leads: [l], partners: d.partners }).get(id) || null;
      const discoveryAlle = d.discovery.filter((a) => a.lead_id === id);
      const perVeld = new Map();
      for (const a of [...discoveryAlle].sort((x, y) => String(x.created_at || '').localeCompare(String(y.created_at || '')))) perVeld.set(a.veld, a);
      const zekerheidWoord = (a) => (a.herkomst === 'afgeleid' ? 'voorlopig' : (a.zekerheid === 'bevestigd' ? 'bevestigd' : 'voorlopig'));
      return {
        lead: l, fase: s.fase, commercieel: commercieleFase(faseNaam), traject: trajectstatus({ faseNaam, gepauzeerdTot: l.gepauzeerd_tot, vandaag: v }),
        contacten: s.contacten.map((c) => ({ naam: c.persoon ? c.persoon.name : null, rol: c.rol, primair: c.is_primair, kanaal: c.voorkeurskanaal, telefoon: c.persoon ? c.persoon.phone || null : null, email: c.persoon ? c.persoon.email || null : null })),
        discovery: [...perVeld.values()].map((a) => ({ veld: a.veld, waarde: a.waarde, zekerheid: zekerheidWoord(a), herkomst: a.herkomst, wanneer: dagVan(a.created_at), interactionId: a.interaction_id })),
        vragen: s.vragen, bezwaren: bezwarenVanLead({ bezwaren: d.bezwaren, leadId: id, interacties: d.interacties }), kansen: s.kansen,
        openTaken: s.openTaken.map((t) => ({ id: t.id, titel: t.title, taak: t.task_type, dag: dagVan(t.due_date || t.due_at), tijd: t.due_at ? tijdVan(t.due_at) : null, reden: t.reden, contactreden: t.contactreden || contactredenVoor({ taak: t.task_type || 'call', reeks: t.opvolg_reeks, reden: t.reden }), wie: naamVan.get(t.assignee) || null, wieId: t.assignee || null, reeks: t.opvolg_reeks || null, stap: t.opvolg_stap || null, gemaaktOp: dagVan(t.created_at) })),
        takenHistorie: d.taken.filter((t) => t.lead_id === id && t.status === 'done').sort((a, b) => String(b.afgerond_op || b.updated_at || '').localeCompare(String(a.afgerond_op || a.updated_at || ''))).slice(0, 30).map((t) => ({ id: t.id, taak: t.task_type, dag: dagVan(t.due_date || t.due_at), reden: t.reden || t.title, contactreden: t.contactreden || contactredenVoor({ taak: t.task_type || 'call', reeks: t.opvolg_reeks, reden: t.reden }), resultaat: t.resultaat || 'gedaan', afgerondOp: dagVan(t.afgerond_op) })),
        afspraken: afspraken.map((a) => ({ id: a.id, taakId: a.task_id, soort: a.soort, dag: dagVan(a.start_at), tijd: tijdVan(a.start_at), duur: a.duur_minuten, vorm: a.vorm, locatie: a.locatie, link: a.link, doel: a.doel, voorbereiding: a.voorbereiding, deelnemers: a.deelnemers, wie: naamVan.get(a.verantwoordelijke) || null, status: a.status, reden: a.reden, interactionId: a.interaction_id })),
        tijdlijn: s.tijdlijn.map((i) => ({
          id: i.id, dag: dagVan(i.started_at), tijd: tijdVan(i.started_at), type: i.type, richting: i.richting || 'uitgaand', stap: i.stap || null, scriptRef: i.script_ref || null, contactreden: i.contactreden || null, uitkomst: i.uitkomst, samenvatting: i.samenvatting, volgendeStap: i.volgende_stap || null,
          door: naamVan.get(i.door_person_id) || null, provisional: i.review_status === 'provisional', opname: i.opname_ref || null, opnames: Array.isArray(i.bijlage_refs) ? i.bijlage_refs.filter((b) => b && b.soort === 'opname') : [], transcript: i.transcript_ref || null,
          toestemming: i.opname_toestemming ?? null, tags: i.tags || [], koopkans: i.koopkans ?? null, temperatuur: i.temperatuur || null, aiAdvies: i.ai_advies || null, aiAnalyse: i.ai_analyse || null, duur: i.duur_seconden || null,
          materiaal: i.materiaal || null, link: i.link || null, templateRef: i.template_ref || null, verzendStatus: i.verzend_status || null, reactieVerwacht: i.reactie_verwacht ?? null, reactieTermijn: i.reactie_termijn ? dagVan(i.reactie_termijn) : null, reactieOntvangenOp: i.reactie_ontvangen_op ? dagVan(i.reactie_ontvangen_op) : null,
          afTeRonden: ['call', 'demo'].includes(i.type) && !i.uitkomst && i.richting !== 'inkomend',
        })),
        wilWel: (s.discovery.get('wil_wel') || {}).waarde || null,
        wilNiet: (s.discovery.get('wil_niet') || {}).waarde || null,
        waarom: (s.discovery.get('waarom') || {}).waarde || null,
        briefing: (researchIndex(d.research).get(id) || {}).samenvatting || null,
        demoBriefing: bouwDemoBriefing({ lead: l, discovery: d.discovery, bezwaren: d.bezwaren, kansen: d.kansen, interacties: d.interacties, vragen: d.vragen, afspraak: openAfspraak, people: d.people }),
        classificatie: classificatieIndex(d.classificaties).get(id) || null,
        feiten: [...feiten.values()].map((f) => ({ veld: f.veld, waarde: f.waarde, wanneer: dagVan(f.waargenomen_op) })).sort((a, b) => a.veld.localeCompare(b.veld)),
        bronnen: d.bronnen.filter((b) => b.lead_id === id).map((b) => ({ bron: b.bron, categorie: b.broncategorie, dag: dagVan(b.gevonden_op) })),
        weetjes: d.weetjes.filter((w) => w.lead_id === id).map((w) => ({ weetje: w.weetje, provisional: w.review_status === 'provisional' })),
        evaluaties: d.evaluaties.filter((e) => e.lead_id === id),
        toegewezen: naamVan.get(l.toegewezen_aan) || null,
        inBehandeling: claimIsActief(l, klok) ? { door: l.in_behandeling_door, naam: naamVan.get(l.in_behandeling_door) || null, sinds: l.in_behandeling_sinds } : null,
        volgendeActie: volgendeActieVoor({ taken: d.taken, afspraken: d.afspraken, leadId: id, vandaag: v, people: d.people }),
        laatsteContact: laatste, reactie: reactieStatus(d.interacties, id, v),
        stap, script: SCRIPTS[stap] || null, scriptRef: scriptRef(stap),
        /* De mijlpalen erbij: het onboardinggesprek vinkt aan wat er staat, en begint bij wat
           het portaal zelf al ziet. */
        partner: koppel ? { id: koppel.partner.id, naam: koppel.partner.bedrijfsnaam, koppeling: koppel.koppeling, niveau: koppel.partner.niveau || null,
          mijlpalen: (bouwPartnerbeeld({ ...d, vandaag: v, companyId }).partners.find((p) => p.id === koppel.partner.id) || {}).mijlpalen || [] } : null,
        bestellingen: koppel ? d.orders.filter((o) => o.partner_id === koppel.partner.id).sort((a, b) => String(b.besteld_op || '').localeCompare(String(a.besteld_op || ''))).map((o) => ({ id: o.id, nummer: o.order_nummer || null, bedragEx: o.bedrag_ex ?? null, status: o.status || null, besteldOp: dagVan(o.besteld_op), geleverdOp: o.geleverd_op ? dagVan(o.geleverd_op) : null, geleverdBron: o.geleverd_bron || null, geleverdDoor: naamVan.get(o.geleverd_door) || null, serviceTaak: (d.taken.find((t) => t.order_id === o.id && t.status !== 'done') || {}).id || null })) : [],
      };
    },
    async 'GET /api/opvolging'(q) { const d = await data(); return bouwOpvolging({ ...d, vandaag: await vandaag(), companyId, scope: q.get('scope') || 'iedereen', bellerId: await bellerVan(q, d) }); },
    async 'GET /api/agenda'(q) {
      const d = await data();
      const v = await vandaag();
      return bouwAgenda({ ...d, van: q.get('van') || plusDagen(v, -1), tot: q.get('tot') || plusDagen(v, 14), companyId, scope: q.get('scope') || 'iedereen', bellerId: await bellerVan(q, d) });
    },
    async 'GET /api/gesprekken'(q) { const d = await data(); return bouwGesprekkenLijst({ ...d, limiet: Number(q.get('limiet') || 60), alleenProvisional: q.get('provisional') === '1', alleenOpnames: q.get('opnames') === '1', type: q.get('type') || '', beller: q.get('beller') || '', companyId }); },
    async 'GET /api/demos'() { const d = await data(); return bouwDemoOverzicht({ ...d, antwoorden: d.discovery, vandaag: await vandaag(), companyId }); },
    async 'GET /api/bezwaren'(q) { const d = await data(); return bouwBezwarenbibliotheek({ ...d, companyId, zoek: q.get('zoek') || '', categorie: q.get('categorie') || '' }); },
    async 'GET /api/partners'() {
      const d = await data();
      const beeld = bouwPartnerbeeld({ ...d, vandaag: await vandaag(), companyId });
      const koppel = partnerKoppeling({ leads: d.leads.filter((l) => l.company_id === companyId), partners: d.partners });
      const leadVanPartner = new Map([...koppel.entries()].map(([leadId, k]) => [k.partner.id, { leadId, koppeling: k.koppeling }]));
      beeld.partners = beeld.partners.map((p) => ({ ...p, lead: leadVanPartner.get(p.id) || null }));
      return beeld;
    },
    async 'GET /api/feedback'() { const d = await data(); return bouwFeedback({ ...d, companyId }); },
    async 'GET /api/funnel'(q) {
      const d = await data();
      const v = await vandaag();
      const van = q.get('van') || plusDagen(v, -27);
      const tot = q.get('tot') || v;
      return { verdeling: bouwFunnelVerdeling({ ...d, vandaag: v, companyId, pipeline: FRAMR_PIPELINE }), cohort: bouwCohortConversie({ ...d, van, tot, companyId, pipeline: FRAMR_PIPELINE }) };
    },
    async 'GET /api/weekrapport'(q) {
      const d = await data();
      const v = await vandaag();
      const w = bouwWeekrapport({ ...d, vandaag: v, companyId, partnerbeeld: bouwPartnerbeeld({ ...d, vandaag: v, companyId }), venster: q.get('venster') || 'zeven_dagen', scope: q.get('scope') || 'iedereen', bellerId: await bellerVan(q, d), dagdoel: bron.dagdoel });
      /* De herleiding: elk id uit de cijfers naar een leesbare regel met de lead erbij. */
      const naamVan = new Map(d.leads.map((l) => [l.id, l.naam]));
      const records = {};
      const zet = (rij, velden) => { records[rij.id] = { leadId: rij.lead_id || null, lead: naamVan.get(rij.lead_id) || rij.bedrijfsnaam || rij.naam || null, ...velden }; };
      for (const i of d.interacties) zet(i, { soort: i.type, dag: dagVan(i.started_at), uitkomst: i.uitkomst || null, richting: i.richting || 'uitgaand' });
      for (const x of d.afspraken) zet(x, { soort: 'afspraak', dag: dagVan(x.start_at), status: x.status });
      for (const t of d.taken) zet(t, { soort: 'taak', dag: dagVan(t.due_date || t.due_at), reden: t.reden || t.title, resultaat: t.resultaat || null });
      for (const p of d.partners) zet(p, { soort: 'partner', dag: dagVan(p.created_at) });
      for (const p of d.projects) zet(p, { soort: 'klus', dag: dagVan(p.created_at), partnerId: p.partner_id });
      for (const o of d.orders) zet(o, { soort: 'bestelling', dag: dagVan(o.besteld_op || o.created_at), partnerId: o.partner_id });
      const gebruikt = new Set();
      for (const wk of [w.dezeWeek, w.vorigeWeek]) for (const v2 of Object.values(wk)) if (v2 && Array.isArray(v2.ids)) for (const id of v2.ids) gebruikt.add(id);
      for (const id of w.achterstallig.ids) gebruikt.add(id);
      return { ...w, records: Object.fromEntries([...gebruikt].filter((id) => records[id]).map((id) => [id, records[id]])) };
    },
    async 'GET /api/data'() { const d = await data(); return { modus, vandaag: await vandaag(), inventaris: bouwDataInventaris(d, { companyId, leads: d.leads }) }; },
    async 'GET /api/reeksen'() { const d = await data(); return { reeksen: reeksen(d) }; },
    async 'GET /api/scripts'() { return { scripts: SCRIPTS, templates: BERICHT_TEMPLATES, stappen: STAPPEN }; },

    /* Schrijfroutes. */
    async 'POST /api/dagselectie/vastzetten'(q, body) {
      const d = await data();
      const v = await vandaag();
      const s = kiesDagselectie({ ...d, bellerId: body.bellerId, vandaag: v, nu: await nu(), aantal: Number(body.aantal || 25), pipeline: FRAMR_PIPELINE, companyId });
      const r = await schrijfDagselectie(adapter, { companyId, selectie: s, bellerId: body.bellerId, vandaag: v });
      vergeet();
      return { ...r, aantal: s.length };
    },
    /* De belsessie: de volgende lead, aan de serverkant geclaimd; vrijgeven; de hartslag. */
    async 'POST /api/sessie/volgende'(q, body) {
      if (!body.bellerId) throw fout(400, 'bellerId ontbreekt.');
      const r = await volgendeVoorSessie(adapter, { companyId, bellerId: body.bellerId, vandaag: await vandaag(), nu: await nu(), overslaan: lijst(body.overslaan), leadIds: body.leadIds ? lijst(body.leadIds) : null, aantalNieuw: Number(body.aantalNieuw || 25), pipeline: FRAMR_PIPELINE, classificatie: body.classificatie === 'alle' ? null : (body.classificatie || null) });
      vergeet();
      if (r.item) r.item = { ...r.item, lead: kort(r.item.leadRij), leadRij: undefined };
      return r;
    },
    async 'POST /api/sessie/vrijgeven'(q, body) { const r = await geefLeadVrij(adapter, { leadId: body.leadId, bellerId: body.bellerId }); vergeet(); return r; },
    async 'POST /api/sessie/hartslag'(q, body) { const r = await hartslagLead(adapter, { leadId: body.leadId, bellerId: body.bellerId, nu: await nu() }); vergeet(); return r; },
    async 'POST /api/gesprek'(q, body) {
      const r = await registreerGesprek(adapter, {
        companyId, leadId: body.leadId, doorPersonId: body.doorId, personId: leeg(body.personId), uitkomst: body.uitkomst, samenvatting: leeg(body.samenvatting),
        volgendeStap: leeg(body.volgendeStap), opvolgDatum: leeg(body.opvolgDatum), demoDatum: leeg(body.demoDatum), demoTijd: leeg(body.demoTijd), demoVorm: leeg(body.demoVorm), demoDuur: body.demoDuur ? Number(body.demoDuur) : undefined,
        duurSeconden: body.duurSeconden ? Number(body.duurSeconden) : undefined, startedAt: leeg(body.startedAt),
        opnameRef: leeg(body.opnameRef), transcriptRef: leeg(body.transcriptRef), opnameToestemming: body.toestemming === undefined || body.toestemming === '' ? undefined : Boolean(body.toestemming),
        tags: Array.isArray(body.tags) ? body.tags : (leeg(body.tags) ? String(body.tags).split(',').map((t) => t.trim()).filter(Boolean) : undefined),
        bezwaar: leeg(body.bezwaar), bezwaarCategorie: leeg(body.bezwaarCategorie), reactie: leeg(body.reactie),
        reactieWerkte: body.reactieWerkte === undefined || body.reactieWerkte === '' || body.reactieWerkte === null ? undefined : Boolean(body.reactieWerkte),
        bezwaren: Array.isArray(body.bezwaren) ? body.bezwaren : [], extras: Array.isArray(body.extras) ? body.extras : [],
        antwoorden: body.antwoorden && typeof body.antwoorden === 'object' ? body.antwoorden : {},
        kans: body.kans && body.kans.naam ? body.kans : undefined, stap: leeg(body.stap), scriptRef: leeg(body.scriptRef), verzoekId: leeg(body.verzoekId), interactionId: leeg(body.interactionId),
        gepauzeerdTot: leeg(body.gepauzeerdTot), geenContactVia: Array.isArray(body.geenContactVia) ? body.geenContactVia : undefined,
        problemen: Array.isArray(body.problemen) ? body.problemen : [], orderId: leeg(body.orderId) || null,
        afhaakmoment: leeg(body.afhaakmoment) || null,
        aangeslagenOp: Array.isArray(body.aangeslagenOp) ? body.aangeslagenOp : [],
        onboardingGedaan: Array.isArray(body.onboardingGedaan) ? body.onboardingGedaan : [],
        blokkade: leeg(body.blokkade) || null,
        pipeline: FRAMR_PIPELINE, vandaag: await vandaag(), nu: await nu(),
      });
      vergeet();
      /* Een opname als bestand: meteen door naar transcriptie en analyse, los van dit antwoord. */
      const ref = leeg(body.opnameRef);
      if (!r.herhaald && ref && ref.startsWith('bestand:')) {
        r.aiGestart = true;
        setTimeout(() => verwerkAchteraf(r.interactionId), 0);
      }
      return r;
    },
    /* Een levering bevestigen (aanvulling onderdeel 3): de servicetaak komt uit de motor. */
    /*
      Zelf een bedrijf toevoegen, met de contactpersoon erbij. Hij controleert eerst op dubbelen
      en meldt een bestaand bedrijf terug in plaats van er een tweede rij naast te zetten; met
      erbij true zet de gebruiker bewust door en wordt de bestaande lead bijgewerkt. Heeft het
      account werkgebieden, dan moet het nieuwe bedrijf in een daarvan vallen.
    */
    async 'POST /api/lead/nieuw'(q, body, ctx = {}) {
      const mag = magGebieden(ctx);
      const gebied = body.werkgebied || (mag && mag.length === 1 ? mag[0] : null);
      if (mag && gebied && !mag.includes(gebied)) throw fout(403, `je account werkt niet in ${gebied}.`);
      if (mag && !gebied) throw fout(400, `kies een werkgebied: ${mag.join(', ')}.`);
      const r = await maakLeadHandmatig(adapter, {
        companyId, naam: body.naam, telefoon: body.telefoon, email: body.email, whatsapp: body.whatsapp,
        plaats: body.plaats, website: body.website, kvkNummer: body.kvkNummer, rechtsvorm: body.rechtsvorm,
        werkgebied: gebied, bron: body.bron, notities: body.notities,
        belOptIn: body.belOptIn === true ? true : undefined, vandaag: await vandaag(),
        contactNaam: body.contactNaam, contactRol: body.contactRol,
        toegewezenAan: body.toegewezenAan || (ctx.gebruiker && ctx.gebruiker.person_id) || body.bellerId || null,
        erbij: body.erbij === true, pipeline: FRAMR_PIPELINE,
      });
      vergeet();
      return r;
    },
    async 'POST /api/levering/bevestigen'(q, body) {
      if (!body.orderId) throw fout(400, 'orderId ontbreekt.');
      const r = await bevestigLevering(adapter, { companyId, orderId: body.orderId, doorPersonId: leeg(body.doorId) || null, bron: leeg(body.bron) || 'handmatig', geleverdOp: leeg(body.geleverdOp), assigneeId: leeg(body.assigneeId) || null, vandaag: await vandaag(), nu: await nu() });
      vergeet();
      return r;
    },
    async 'POST /api/bericht'(q, body) {
      const r = await registreerBericht(adapter, {
        companyId, leadId: body.leadId, doorPersonId: body.doorId, personId: leeg(body.personId), kanaal: body.kanaal, materiaal: leeg(body.materiaal), tekst: leeg(body.tekst), link: leeg(body.link),
        templateRef: leeg(body.templateRef), stap: leeg(body.stap), verzendStatus: leeg(body.verzendStatus) || 'bevestigd', reactieVerwacht: body.reactieVerwacht === undefined ? true : Boolean(body.reactieVerwacht),
        reactieTermijnDagen: body.reactieTermijnDagen === undefined || body.reactieTermijnDagen === '' ? undefined : Number(body.reactieTermijnDagen), reactieTermijn: leeg(body.reactieTermijn),
        gekoppeldAanId: leeg(body.gekoppeldAanId), reeks: body.reeks === null ? null : (leeg(body.reeks) || 'informatie_verstuurd_geen_reactie'), verzoekId: leeg(body.verzoekId), pipeline: FRAMR_PIPELINE, vandaag: await vandaag(), nu: await nu(),
      });
      vergeet();
      return r;
    },
    /* De oude route blijft werken voor het scherm van gisteren. */
    async 'POST /api/verstuurd'(q, body) { return routes['POST /api/bericht'](q, body); },
    async 'POST /api/reactie'(q, body) {
      const r = await registreerReactie(adapter, {
        companyId, leadId: body.leadId, doorPersonId: body.doorId, personId: leeg(body.personId), kanaal: leeg(body.kanaal) || 'whatsapp', tekst: leeg(body.tekst), startedAt: leeg(body.startedAt), opBerichtId: leeg(body.opBerichtId),
        volgende: body.volgende === null ? null : (body.volgende || undefined), verzoekId: leeg(body.verzoekId), vandaag: await vandaag(), nu: await nu(),
      });
      vergeet();
      return r;
    },
    async 'POST /api/taak/afronden'(q, body) {
      const r = await rondTaakAf(adapter, { companyId, taakId: body.taakId, resultaat: leeg(body.resultaat) || 'gedaan', nieuweDatum: leeg(body.nieuweDatum), nieuweTijd: leeg(body.nieuweTijd), notitie: leeg(body.notitie), doorPersonId: leeg(body.doorId), vandaag: await vandaag(), nu: await nu() });
      vergeet();
      return r;
    },
    async 'POST /api/taak/klaar'(q, body) { return routes['POST /api/taak/afronden'](q, { ...body, resultaat: 'gedaan' }); },
    async 'POST /api/demo'(q, body) {
      const r = await planDemo(adapter, {
        companyId, leadId: body.leadId, doorPersonId: body.doorId, datum: body.datum, tijd: leeg(body.tijd) || '10:00', duurMinuten: body.duurMinuten ? Number(body.duurMinuten) : 45, vorm: leeg(body.vorm), locatie: leeg(body.locatie), link: leeg(body.link),
        doel: leeg(body.doel), deelnemers: leeg(body.deelnemers), voorbereiding: body.voorbereiding === undefined ? undefined : leeg(body.voorbereiding), verantwoordelijkeId: leeg(body.verantwoordelijkeId), opportunityId: leeg(body.opportunityId), afspraakId: leeg(body.afspraakId), reden: leeg(body.reden),
        pipeline: FRAMR_PIPELINE, vandaag: await vandaag(), nu: await nu(),
      });
      vergeet();
      return r;
    },
    async 'POST /api/demo/annuleren'(q, body) {
      const r = await annuleerDemo(adapter, { companyId, afspraakId: leeg(body.afspraakId), leadId: leeg(body.leadId), reden: leeg(body.reden), nietVerschenen: Boolean(body.nietVerschenen), doorPersonId: leeg(body.doorId), pipeline: FRAMR_PIPELINE, vandaag: await vandaag(), nu: await nu() });
      vergeet();
      return r;
    },
    async 'POST /api/demo-gedaan'(q, body) {
      const r = await registreerDemoGedaan(adapter, {
        companyId, leadId: body.leadId, doorPersonId: body.doorId, personId: leeg(body.personId), taakId: leeg(body.taakId), afspraakId: leeg(body.afspraakId), samenvatting: leeg(body.samenvatting), uitkomst: leeg(body.uitkomst),
        koopkans: body.koopkans === '' || body.koopkans === undefined ? undefined : Number(body.koopkans), antwoorden: body.antwoorden || {}, onderdelen: body.onderdelen || [],
        bezwaren: Array.isArray(body.bezwaren) ? body.bezwaren : [], extras: Array.isArray(body.extras) ? body.extras : [], volgende: body.volgende && body.volgende.taak ? body.volgende : undefined,
        opvolgDatum: leeg(body.opvolgDatum), volgendeStap: leeg(body.volgendeStap), startedAt: leeg(body.startedAt), duurSeconden: body.duurSeconden ? Number(body.duurSeconden) : undefined, opnameRef: leeg(body.opnameRef),
        opnameToestemming: body.toestemming === undefined || body.toestemming === '' ? undefined : Boolean(body.toestemming), verzoekId: leeg(body.verzoekId), pipeline: FRAMR_PIPELINE, vandaag: await vandaag(), nu: await nu(),
      });
      vergeet();
      const ref = leeg(body.opnameRef);
      if (!r.herhaald && ref && ref.startsWith('bestand:')) { r.aiGestart = true; setTimeout(() => verwerkAchteraf(r.interactionId), 0); }
      return r;
    },
    /* De analyse met de hand starten of opnieuw doen: met een geplakt transcript, of vanuit de
       opname die aan het contactmoment hangt. */
    async 'POST /api/gesprek/analyseer'(q, body) {
      if (!body.interactionId) throw fout(400, 'interactionId ontbreekt.');
      let r;
      if (leeg(body.transcript)) {
        const alle = await adapter.fetchInteractions();
        const g = alle.find((i) => i.id === body.interactionId);
        if (!g) throw fout(404, 'contactmoment niet gevonden.');
        if (g.opname_ref && g.opname_ref.startsWith('bestand:')) {
          const pad = `${g.opname_ref.slice('bestand:'.length).replace(/\.[a-z0-9]+$/i, '')}.txt`;
          mkdirSync(dirname(pad), { recursive: true });
          writeFileSync(pad, String(body.transcript), 'utf8');
          await adapter.updateInteraction(g.id, { transcript_ref: `bestand:${pad}` });
        }
        r = await analyseerGesprek(adapter, { companyId, interactionId: body.interactionId, transcript: String(body.transcript), anthropic: await aiClient(), model, vandaag: await vandaag(), bron: 'transcript' });
      } else {
        r = await transcribeerEnAnalyseer(adapter, { companyId, interactionId: body.interactionId, env, anthropic: await aiClient(), transcribeer, model, vandaag: await vandaag() });
      }
      vergeet();
      return r;
    },
    /*
      Een opname: de bytes naar de opnamesmap, en de verwijzing meteen aan een contactmoment
      gekoppeld als er een is (interactionId), of aan een nieuw los contactmoment (nieuw=1, met
      doorId) dat daarna administratief afgerond wordt. Zonder een van beide komt alleen de
      verwijzing terug, voor het scherm dat hem bij het vastleggen meegeeft (de belsessie).
    */
    async 'POST /api/opname'(q, body) {
      if (!body || !body.bytes || !body.bytes.length) throw fout(400, 'geen opname ontvangen.');
      const leadNaam = String(q.get('lead') || 'gesprek').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'gesprek';
      const stempel = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const mime = q.get('mime') || '';
      const naamIn = q.get('naam') || '';
      const extUit = extname(naamIn).replace('.', '').toLowerCase();
      const ext = extUit && /^(webm|ogg|m4a|mp4|mp3|wav)$/.test(extUit) ? extUit : (/ogg/.test(mime) ? 'ogg' : (/mp4|m4a/.test(mime) ? 'm4a' : (/mpeg|mp3/.test(mime) ? 'mp3' : (/wav/.test(mime) ? 'wav' : 'webm'))));
      const map = bron.opnamesMap;
      mkdirSync(map, { recursive: true });
      const naam = `${leadNaam}-${stempel}.${ext}`;
      writeFileSync(join(map, naam), body.bytes);
      const ref = `bestand:${join(map, naam)}`;
      const uit = { ref, naam, bytes: body.bytes.length, map, mime: mime || MIME[`.${ext}`] || null };
      let interactionId = q.get('interactionId') || null;
      if (!interactionId && q.get('nieuw') === '1') {
        if (!q.get('leadId') || !q.get('doorId')) throw fout(400, 'een nieuw contactmoment vereist leadId en doorId.');
        const c = await maakLosContactmoment(adapter, { companyId, leadId: q.get('leadId'), doorPersonId: q.get('doorId'), type: q.get('type') === 'demo' ? 'demo' : 'call', startedAt: q.get('startedAt') || undefined, vandaag: await vandaag() });
        interactionId = c.interactionId;
        uit.nieuw = true;
      }
      if (interactionId) {
        const t = q.get('toestemming');
        const k = await koppelOpname(adapter, { interactionId, ref, naam, bytes: body.bytes.length, mime: uit.mime, duurSeconden: q.get('duur') ? Number(q.get('duur')) : undefined, toestemming: t === '' || t === null ? undefined : t === '1' || t === 'true', nu: await nu() });
        uit.interactionId = interactionId;
        uit.opnames = k.opnames;
        uit.aiGestart = true;
        setTimeout(() => verwerkAchteraf(interactionId), 0);
      }
      vergeet();
      return uit;
    },
    async 'POST /api/fase'(q, body) {
      const r = await setLeadFase(adapter, { companyId, leadId: body.leadId, faseNaam: body.fase, pipeline: FRAMR_PIPELINE });
      vergeet();
      return r;
    },
    /* Leads zonder hoofdstatus opvangen: eerst tellen (droogloop), dan met toepassen op nieuwe_lead zetten. */
    async 'POST /api/leads/fase-invullen'(q, body) {
      const d = await data();
      const zonder = d.leads.filter((l) => l.company_id === companyId && !l.pipeline_fase_id);
      if (!body.toepassen) return { aantal: zonder.length, toegepast: false, leadIds: zonder.slice(0, 50).map((l) => l.id) };
      let n = 0;
      for (const l of zonder) { await setLeadFase(adapter, { companyId, leadId: l.id, faseNaam: 'nieuwe_lead', pipeline: FRAMR_PIPELINE }); n += 1; }
      vergeet();
      return { aantal: zonder.length, toegepast: true, gezet: n };
    },
    async 'POST /api/bevestig'(q, body) {
      await adapter.updateInteraction(body.interactionId, { review_status: 'confirmed' });
      vergeet();
      return { ok: true };
    },
    async 'POST /api/feedback/status'(q, body) {
      if (!['voorgesteld', 'actief', 'verworpen'].includes(body.status)) throw fout(400, 'status moet voorgesteld, actief of verworpen zijn.');
      await adapter.updateSalesSuggestion(body.id, { status: body.status });
      vergeet();
      return { ok: true };
    },
    async 'POST /api/bezwaar/werkte'(q, body) {
      const resultaat = leeg(body.resultaat) || (body.werkte === null || body.werkte === undefined ? 'onbekend' : (body.werkte ? 'ja' : 'nee'));
      if (!BEZWAAR_RESULTATEN.includes(resultaat)) throw fout(400, `resultaat moet ${BEZWAAR_RESULTATEN.join(', ')} zijn.`);
      const patch = { reactie_resultaat: resultaat, reactie_werkte: resultaat === 'ja' ? true : (resultaat === 'nee' ? false : null) };
      if (leeg(body.soort)) patch.soort = body.soort;
      await adapter.updateObjection(body.id, patch);
      vergeet();
      return { ok: true };
    },
    /* Een taak aan een collega geven (aanvulling onderdeel 1 en 9): service kan later door een
       andere medewerker gedaan worden zonder dat er iets verhuist; alleen de uitvoerder verandert. */
    async 'POST /api/taak/toewijzen'(q, body) {
      if (!body.taakId) throw fout(400, 'taakId ontbreekt.');
      const taak = (await adapter.fetchTasks()).find((t) => t.id === body.taakId);
      if (!taak) throw fout(404, 'taak niet gevonden.');
      const naar = leeg(body.assigneeId) || null;
      await adapter.updateTask(taak.id, { assignee: naar });
      vergeet();
      const wie = naar ? ((await adapter.fetchPeople()).find((p) => p.id === naar) || {}).name : null;
      return { ok: true, taakId: taak.id, assignee: naar, naam: wie || null };
    },
    async 'POST /api/toewijzen'(q, body) {
      await adapter.updateLead(body.leadId, { toegewezen_aan: body.bellerId || null });
      vergeet();
      return { ok: true };
    },
    async 'POST /api/lead/pauze'(q, body) {
      await adapter.updateLead(body.leadId, { gepauzeerd_tot: leeg(body.tot) || null });
      if (leeg(body.tot)) await setLeadFase(adapter, { companyId, leadId: body.leadId, faseNaam: 'later_benaderen', pipeline: FRAMR_PIPELINE });
      vergeet();
      return { ok: true, tot: leeg(body.tot) || null };
    },
    async 'POST /api/lead/kanalen'(q, body) {
      await adapter.updateLead(body.leadId, { geen_contact_via: lijst(body.geenContactVia) });
      vergeet();
      return { ok: true };
    },
    async 'POST /api/notitie'(q, body) {
      await adapter.updateLead(body.leadId, { notities: leeg(body.notities) || null });
      vergeet();
      return { ok: true };
    },
    /* Een opvolgreeks aanpassen: de stappen, het maximum, actief of niet; nieuw als hij er nog niet is. */
    async 'POST /api/reeksen'(q, body, ctx = {}) {
      if (!body.aanleiding) throw fout(400, 'aanleiding ontbreekt.');
      if (!Array.isArray(body.stappen) || !body.stappen.length) throw fout(400, 'een reeks heeft minstens een stap.');
      const stappen = body.stappen.map((s, i) => ({
        volgnummer: i + 1, wachtdagen: Math.max(0, Number(s.wachtdagen || 0)), dagsoort: s.dagsoort === 'kalenderdagen' ? 'kalenderdagen' : 'werkdagen', vanaf: 'vorige_stap',
        actie: ['call', 'whatsapp', 'email', 'beoordelen'].includes(s.actie) ? s.actie : 'call', template: leeg(s.template) || null, uitvoerder: leeg(s.uitvoerder) || 'beller',
        voorwaarde: 'geen_reactie', stop: ['reactie_ontvangen', 'niet_meer_benaderen'], reden: leeg(s.reden) || `stap ${i + 1}`,
      }));
      const bestaand = await adapter.findOpvolgreeks(companyId, body.aanleiding);
      const velden = { stappen, max_pogingen: body.maxPogingen ? Number(body.maxPogingen) : null, actief: body.actief === undefined ? true : Boolean(body.actief), naam: leeg(body.naam) || (STANDAARD_OPVOLGREEKSEN.find((r) => r.aanleiding === body.aanleiding) || {}).naam || body.aanleiding };
      let r;
      if (bestaand) r = await adapter.updateOpvolgreeks(bestaand.id, { ...velden, versie: Number(bestaand.versie || 1) + 1 });
      else r = await adapter.insertOpvolgreeks({ company_id: companyId, aanleiding: body.aanleiding, ...velden, versie: 1 });
      /* De wijziging gaat ook als versie de geschiedenis in, met de toelichting die de melding vormt. */
      const werkwijze = await bewaarWerkwijze(adapter, {
        companyId, soort: 'reeks', ref: body.aanleiding, inhoud: velden, watVeranderd: leeg(body.watVeranderd) || 'de stappen van de reeks zijn aangepast',
        waarom: leeg(body.waarom), watAnders: leeg(body.watAnders), voorStappen: Array.isArray(body.voorStappen) ? body.voorStappen : [],
        soortWijziging: leeg(body.soortWijziging) || 'inhoudelijk', geldigVanaf: await vandaag(), doorPersonId: (ctx.gebruiker && ctx.gebruiker.person_id) || null,
      });
      vergeet();
      return { ok: true, id: bestaand ? bestaand.id : r.id, versie: bestaand ? Number(bestaand.versie || 1) + 1 : 1, werkwijze };
    },
  };

  /* Zolang er geen enkel account is blijft het dashboard open: de oefenstand, en de dagen
     voordat de eerste beheerder bestaat. Zodra er een account is moet iedereen inloggen. */
  async function inlogVereist() {
    if (!adapter.fetchSalesGebruikers) return false;
    const alle = await adapter.fetchSalesGebruikers();
    return alle.some((g) => g.company_id === companyId && g.actief !== false);
  }

  async function gebruikerVan(token) {
    if (!token || !adapter.fetchSalesGebruikers) return null;
    const id = sessies.wie(token);
    if (!id) return null;
    const g = (await adapter.fetchSalesGebruikers()).find((x) => x.id === id && x.company_id === companyId);
    return g && g.actief !== false ? zonderGeheimen(g) : null;
  }

  return {
    routes,
    schrijven,
    modus,
    opnamesMap: bron.opnamesMap,
    sessies,
    inlogVereist,
    gebruikerVan,
    async afhandelen(methode, pad, q, body, ctx = {}) {
      const sleutel = `${methode} ${pad}`;
      const route = routes[sleutel];
      if (!route) throw fout(404, `onbekende route ${sleutel}`);
      if (methode === 'POST' && !schrijven) throw fout(403, 'Deze server leest alleen. Schrijven kan met --schrijf NAAR-LIVE en JARVIS_LIVE_WRITE=1, of in de oefenstand met --nep.');
      /* Inloggen mag altijd; de rest alleen ingelogd zodra er accounts zijn, en dan met het recht. */
      if (sleutel !== 'POST /api/inloggen' && sleutel !== 'POST /api/uitloggen') {
        if (!ctx.gebruiker && await inlogVereist()) throw fout(401, 'log in om verder te gaan.');
        const recht = rechtVoor(sleutel, body);
        if (ctx.gebruiker && recht && !heeftRecht(ctx.gebruiker, recht)) throw fout(403, `je account heeft het recht '${recht}' niet (rol ${ctx.gebruiker.rol}). Vraag een beheerder.`);
      }
      return route(q, body || {}, ctx);
    },
  };
}

function leeg(v) {
  return v === undefined || v === null || String(v).trim() === '' ? undefined : String(v);
}

function fout(status, boodschap) {
  const e = new Error(boodschap);
  e.status = status;
  return e;
}

function leesBody(req, { binair = false, max = 2e6 } = {}) {
  return new Promise((resolve, reject) => {
    const delen = [];
    let lengte = 0;
    req.on('data', (c) => { delen.push(c); lengte += c.length; if (lengte > max) reject(fout(413, 'te groot')); });
    req.on('end', () => {
      if (binair) return resolve({ bytes: Buffer.concat(delen) });
      const buf = Buffer.concat(delen).toString('utf8');
      if (!buf) return resolve({});
      try { resolve(JSON.parse(buf)); } catch { reject(fout(400, 'body is geen JSON')); }
    });
    req.on('error', reject);
  });
}

/* Een opname afspelen: alleen bestanden binnen de opnamesmap, met bereikverzoeken voor de speler. */
function speelOpname(app, ref, req, res) {
  const pad = String(ref || '').startsWith('bestand:') ? resolvePad(String(ref).slice('bestand:'.length)) : null;
  const map = resolvePad(app.opnamesMap || '');
  if (!pad || !map || !pad.startsWith(map + '/') || !existsSync(pad)) throw fout(404, 'opname niet gevonden in de opnamesmap.');
  const grootte = statSync(pad).size;
  const type = MIME[extname(pad).toLowerCase()] || 'application/octet-stream';
  const bereik = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  if (bereik && grootte) {
    const van = bereik[1] ? Number(bereik[1]) : 0;
    const tot = bereik[2] ? Math.min(Number(bereik[2]), grootte - 1) : grootte - 1;
    res.writeHead(206, { 'content-type': type, 'content-range': `bytes ${van}-${tot}/${grootte}`, 'accept-ranges': 'bytes', 'content-length': tot - van + 1, 'cache-control': GEEN_CACHE });
    createReadStream(pad, { start: van, end: tot }).pipe(res);
    return;
  }
  res.writeHead(200, { 'content-type': type, 'content-length': grootte, 'accept-ranges': 'bytes', 'cache-control': GEEN_CACHE });
  createReadStream(pad).pipe(res);
}

/* De sessiecookie: alleen op deze server, niet naar buiten, en niet leesbaar voor scripts. */
function tokenUitCookie(req) {
  const rauw = req.headers.cookie || '';
  const m = /(?:^|;\s*)framr_sales=([^;]+)/.exec(rauw);
  return m ? decodeURIComponent(m[1]) : null;
}

export function maakServer(app) {
  return createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const pad = url.pathname;
    try {
      if (pad === '/api/opname/afspelen' && req.method === 'GET') { speelOpname(app, url.searchParams.get('ref'), req, res); return; }
      if (pad.startsWith('/api/')) {
        const binair = pad === '/api/opname';
        const body = req.method === 'POST' ? await leesBody(req, { binair, max: binair ? 250e6 : 2e6 }) : null;
        const token = tokenUitCookie(req);
        const gebruiker = app.gebruikerVan ? await app.gebruikerVan(token) : null;
        const uit = await app.afhandelen(req.method, pad, url.searchParams, body, { gebruiker, token });
        const koppen = { 'content-type': MIME['.json'], 'cache-control': GEEN_CACHE };
        /* Inloggen zet de cookie, uitloggen haalt hem weg; het token gaat niet mee in het antwoord. */
        if (pad === '/api/inloggen' && uit && uit.token) { koppen['set-cookie'] = `framr_sales=${encodeURIComponent(uit.token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${12 * 3600}`; delete uit.token; }
        if (pad === '/api/uitloggen') koppen['set-cookie'] = 'framr_sales=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0';
        res.writeHead(200, koppen);
        res.end(JSON.stringify(uit));
        return;
      }
      let bestand;
      if (pad === '/app/framr.css') bestand = PORTAAL_CSS;
      else if (pad === '/' || !extname(pad)) bestand = join(SCHERMEN, 'index.html');
      else bestand = join(SCHERMEN, pad.replace(/^\/+/, ''));
      if (!bestand.startsWith(SCHERMEN) && bestand !== PORTAAL_CSS) throw fout(404, 'niet gevonden');
      if (!existsSync(bestand)) throw fout(404, 'niet gevonden');
      res.writeHead(200, { 'content-type': MIME[extname(bestand)] || 'application/octet-stream', 'cache-control': GEEN_CACHE });
      res.end(readFileSync(bestand));
    } catch (e) {
      const status = e.status || 500;
      if (status === 500) process.stderr.write(`fout op ${req.method} ${pad}: ${e.stack || e.message}\n`);
      res.writeHead(status, { 'content-type': MIME['.json'], 'cache-control': GEEN_CACHE });
      res.end(JSON.stringify({ fout: e.message }));
    }
  });
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isDirectRun) {
  const poort = Number(arg('poort', 4620));
  const nep = process.argv.includes('--nep');
  /* De verse stand: het programma zoals het er op dag een uit ziet, met alleen een lijst leads. */
  const leeg = process.argv.includes('--leeg');
  const leads = arg('leads', null);
  const company = String(arg('company', 'oaklyn'));
  const schrijf = arg('schrijf', null);
  const opnames = arg('opnames', null);
  const dagdoel = arg('dagdoel', null);
  maakBron({ nep: nep || leeg, leeg, aantalLeads: leads === true ? null : leads, company, schrijf: schrijf === true ? null : schrijf, opnamesMap: opnames === true ? null : opnames, dagdoel: dagdoel === true ? null : dagdoel }).then((bron) => {
    const app = maakApp(bron);
    if (bron.modus !== 'nep') {
      const { host, projectRef } = hostAndRef(process.env.JARVIS_DB_URL);
      process.stdout.write(`${bron.modus === 'live-schrijven' ? 'LIVE-modus, SCHRIJVEN AAN' : 'Live, alleen lezen'}: host ${host}, project ${projectRef}, company ${company}.\n`);
    } else {
      process.stdout.write(`Oefenstand: verzonnen gegevens op de mock-adapter, niets raakt de live database.${bron.leeg ? ' Verse stand: alleen een lijst leads, verder niets.' : ''}\n`);
    }
    maakServer(app).listen(poort, () => process.stdout.write(`Framr.One Sales op http://localhost:${poort} (${bron.modus}); opnames naar ${bron.opnamesMap}\n`));
  }).catch((e) => {
    process.stderr.write(`Fout: ${e.message}\n`);
    process.exitCode = 1;
  });
}
