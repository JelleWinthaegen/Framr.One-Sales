/*
  Jarvis - gesprek-extractie: van transcript naar CRM-voorstel (de AI-laag op het Client OS).

  Stap 2 tot en met 5 van het Commercial Intelligence System (Jelle 02-08-2026): transcriptie,
  AI-samenvatting met vaste velden, AI vult het CRM, AI tagt het gesprek. Deze module doet
  het denkwerk zonder zelf iets te schrijven: uit een transcript komt een VOORSTEL met vaste
  velden, en schrijfVoorstel zet dat als provisional rijen weg, zodat de beller of Jelle
  bevestigt wat de AI afleidde (het twee-emmer-patroon uit 0060).

  Wat de AI vult, en waar het landt:
    samenvatting, uitkomst, temperatuur, koopkans, sentiment, ai_advies, tags
                                          -> interactions (provisional)
    discovery (veld, waarde, zekerheid)   -> discovery_answers (herkomst afgeleid)
    bezwaren (bezwaar, categorie, reactie)-> objections
    vragen (vraag, antwoord, categorie)   -> questions
    kansen (naam, m2, datum, plaats)      -> opportunities (stage aanstaand)
    weetjes over de persoon               -> crm_weetjes (provisional)
    productwensen, script- en paginaverbeteringen
                                          -> sales_suggestions (voorgesteld)
    volgende actie met datum              -> tasks (opvolgtaak)

  De transcriptie zelf (audio naar tekst) is een externe dienst. Er is een provider voor de
  OpenAI-transcriptie-API (OPENAI_API_KEY); zonder sleutel werkt de route met een transcript
  als tekstbestand, bijvoorbeeld uit de opname-app op de telefoon. De extractie loopt via de
  Anthropic API (ANTHROPIC_API_KEY); de transcripttekst gaat dus naar een externe dienst.

  Alle netwerkclients zijn injecteerbaar; tests doen nooit een echte aanroep.

  Stijl: blokcommentaar, geen lange streepjes en geen emoji, conform de projectafspraken.
*/

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { basename } from 'node:path';

import { recordInteraction, recordDiscoveryAnswer, recordObjection, recordQuestion, recordOpportunity, setLeadFase } from './crm-store.mjs?v=5dd6073';
import { recordTask } from '../review/task-store.mjs?v=5dd6073';
import {
  BELUITKOMSTEN, UITKOMST_REGELS, FRAMR_PIPELINE, bepaalFaseNaUitkomst, bepaalOpvolging, taakTitel, telPogingen,
  plusDagen, dagVan,
} from './belronde-store.mjs?v=5dd6073';

export const DEFAULT_MODEL = 'claude-opus-5';

/* De standaard bewaartermijn van opname en transcript, in dagen. Een jaar tot Jelle anders
   beslist; de ronde die opruimt leest opname_bewaren_tot en niet dit getal. */
export const BEWAARTERMIJN_DAGEN = 365;

/* De vaste tagwoorden; wat hier niet in staat wordt bij het normaliseren weggelaten. */
export const TAGWOORDEN = [
  'concurrent', 'bezwaar', 'koopmotief', 'product', 'calculator', 'offerte', 'projectgrootte',
  'software', 'levering', 'marge', 'showroom', 'stalen', 'demo', 'account', 'prijs', 'boekhouding',
  'onderaannemer', 'particulier', 'zakelijk', 'pvc', 'laminaat', 'parket', 'visgraat', 'egaliseren',
  'traprenovatie', 'voorraad', 'afhalen', 'bezorgen', 'geen_interesse', 'terugbellen',
];

export const TEMPERATUREN = ['koud', 'lauw', 'warm'];
export const SENTIMENTEN = ['positief', 'neutraal', 'negatief'];
export const ZEKERHEDEN = ['bevestigd', 'waarschijnlijk', 'onbekend'];
export const SUGGESTIE_CATEGORIEEN = ['product', 'belscript', 'landingspagina', 'demo'];

const stringOf = (extra = {}) => ({ type: 'string', ...extra });

/* Het antwoordschema. Lijsten mogen leeg zijn; velden die niet in het gesprek zaten krijgen
   'onbekend' of een lege lijst, nooit een gok. */
export const EXTRACTIE_SCHEMA = {
  type: 'object',
  properties: {
    samenvatting: stringOf({ description: 'Vier regels: wie, wat hij nu doet, waar het schuurt, wat er is afgesproken.' }),
    wil_wel: stringOf({ description: 'Wat hij wel wil, in zijn eigen woorden. Leeg als het niet gezegd is.' }),
    wil_niet: stringOf({ description: 'Wat hij niet wil, in zijn eigen woorden. Leeg als het niet gezegd is.' }),
    waarom: stringOf({ description: 'Waarom: de reden achter wat hij wel en niet wil.' }),
    uitkomst: stringOf({ enum: [...BELUITKOMSTEN, 'onbekend'] }),
    temperatuur: stringOf({ enum: [...TEMPERATUREN, 'onbekend'] }),
    koopkans: { type: 'integer', minimum: 0, maximum: 100 },
    sentiment: stringOf({ enum: [...SENTIMENTEN, 'onbekend'] }),
    ai_advies: stringOf({ description: 'De aanbevolen aanpak voor het volgende contact, in twee zinnen.' }),
    discovery: {
      type: 'array',
      items: {
        type: 'object',
        properties: { veld: stringOf(), waarde: stringOf(), zekerheid: stringOf({ enum: ZEKERHEDEN }) },
        required: ['veld', 'waarde', 'zekerheid'],
        additionalProperties: false,
      },
    },
    bezwaren: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          bezwaar: stringOf({ description: 'Letterlijk wat hij zei.' }),
          onderliggende_reden: stringOf(),
          categorie: stringOf(),
          reactie: stringOf({ description: 'Wat de beller antwoordde.' }),
          opgelost: stringOf({ enum: ['ja', 'nee', 'onbekend'] }),
        },
        required: ['bezwaar', 'onderliggende_reden', 'categorie', 'reactie', 'opgelost'],
        additionalProperties: false,
      },
    },
    vragen: {
      type: 'array',
      items: {
        type: 'object',
        properties: { vraag: stringOf(), antwoord: stringOf(), categorie: stringOf(), beantwoord: stringOf({ enum: ['ja', 'nee'] }) },
        required: ['vraag', 'antwoord', 'categorie', 'beantwoord'],
        additionalProperties: false,
      },
    },
    kansen: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          naam: stringOf({ description: 'Bijvoorbeeld: PVC woning Maastricht.' }),
          geschat_m2: { type: 'integer', minimum: 0 },
          projectdatum: stringOf({ description: 'JJJJ-MM-DD of leeg.' }),
          plaats: stringOf(),
        },
        required: ['naam', 'geschat_m2', 'projectdatum', 'plaats'],
        additionalProperties: false,
      },
    },
    beloftes_framr: { type: 'array', items: stringOf() },
    beloftes_lead: { type: 'array', items: stringOf() },
    onbeantwoorde_vragen: { type: 'array', items: stringOf() },
    weetjes: { type: 'array', items: stringOf({ description: 'Over de persoon: belt liever na 17:00, is op vrijdag vrij.' }) },
    productwensen: { type: 'array', items: stringOf() },
    verbeteringen_belscript: { type: 'array', items: stringOf() },
    verbeteringen_landingspagina: { type: 'array', items: stringOf() },
    verbeteringen_demo: { type: 'array', items: stringOf() },
    volgende_actie: {
      type: 'object',
      properties: { actie: stringOf(), datum: stringOf({ description: 'JJJJ-MM-DD of leeg.' }) },
      required: ['actie', 'datum'],
      additionalProperties: false,
    },
    tags: { type: 'array', items: stringOf() },
    voorgesteld_bericht: stringOf({ description: 'Een kort persoonlijk WhatsApp-bericht na dit gesprek, in de woorden van de lead.' }),
    praat_aandeel_beller: { type: 'integer', minimum: 0, maximum: 100, description: 'Geschat percentage van de tijd dat de beller aan het woord was; 0 als niet te schatten.' },
  },
  required: ['samenvatting', 'wil_wel', 'wil_niet', 'waarom', 'uitkomst', 'temperatuur', 'koopkans', 'sentiment', 'ai_advies', 'discovery',
    'bezwaren', 'vragen', 'kansen', 'beloftes_framr', 'beloftes_lead', 'onbeantwoorde_vragen', 'weetjes',
    'productwensen', 'verbeteringen_belscript', 'verbeteringen_landingspagina', 'verbeteringen_demo',
    'volgende_actie', 'tags', 'voorgesteld_bericht', 'praat_aandeel_beller'],
  additionalProperties: false,
};

/* De prompt: de vaste lijsten gaan mee, zodat de AI nooit eigen veldnamen verzint. */
export function bouwPrompt({
  bedrijf, plaats, beller, datum, transcript, discoveryVelden = [], bezwaarCategorieen = [], vraagCategorieen = [],
} = {}) {
  return [
    `Je leest het transcript van een verkoopgesprek van Framr.One (gratis bedrijfssoftware plus materiaal met partnerprijzen voor vloerenleggers) met het bedrijf "${bedrijf}"${plaats ? ` uit ${plaats}` : ''}.`,
    `De beller is ${beller || 'onze verkoper'}; de datum is ${datum || 'onbekend'}. De gesprekspartner is de vloerenlegger.`,
    'Haal uitsluitend uit het transcript wat er echt gezegd is. Verzin niets: staat iets er niet, gebruik dan "onbekend", 0 of een lege lijst.',
    '',
    `uitkomst: precies een van ${BELUITKOMSTEN.join(', ')}; kies "onbekend" als het gesprek geen duidelijke uitkomst had.`,
    'temperatuur: koud, lauw of warm. koopkans: 0 tot 100. sentiment: positief, neutraal of negatief.',
    'wil_wel, wil_niet, waarom: wat hij wel wil, wat hij niet wil, en de reden erachter, in zijn eigen woorden; dit zijn de belangrijkste drie velden.',
    `discovery: alleen deze veldnamen zijn toegestaan: ${discoveryVelden.join(', ') || 'geen'}. Laat een veld weg als het niet ter sprake kwam. zekerheid is bevestigd (hij zei het letterlijk), waarschijnlijk (af te leiden) of onbekend.`,
    `bezwaren: categorie is een van ${bezwaarCategorieen.join(', ') || 'anders'}. Noteer het bezwaar letterlijk, de onderliggende reden, wat de beller antwoordde en of het opgelost werd (het gesprek eindigde met een proef of een datum).`,
    `vragen: wat de lead ONS vroeg; categorie is een van ${vraagCategorieen.join(', ') || 'overig'}.`,
    'kansen: elk concreet volgend project met naam, geschatte m2, datum (JJJJ-MM-DD) en plaats.',
    `tags: alleen woorden uit deze lijst: ${TAGWOORDEN.join(', ')}.`,
    'volgende_actie: wat er is afgesproken en op welke datum (JJJJ-MM-DD), of leeg.',
    'praat_aandeel_beller: schat hoeveel procent van de tijd de beller sprak; de norm is hoogstens 30.',
    'Schrijf alles in het Nederlands, zonder lange streepjes en zonder emoji.',
    '',
    'TRANSCRIPT:',
    transcript,
  ].join('\n');
}

/* De LLM-extractie met gestructureerde uitvoer; de client is injecteerbaar. */
export async function extraheer({ anthropic, model = DEFAULT_MODEL, prompt, maxTokens = 4096 } = {}) {
  if (!anthropic) throw new Error('extraheer vereist een Anthropic-client.');
  const response = await anthropic.messages.create({
    model,
    max_tokens: maxTokens,
    output_config: { format: { type: 'json_schema', schema: EXTRACTIE_SCHEMA } },
    messages: [{ role: 'user', content: prompt }],
  });
  if (response.stop_reason === 'refusal') return { extractie: null, usage: response.usage, model };
  const blok = (response.content || []).find((b) => b.type === 'text');
  let extractie = null;
  if (blok && blok.text) {
    try { extractie = JSON.parse(blok.text); } catch { extractie = null; }
  }
  return { extractie, usage: response.usage, model };
}

const leeg = (v) => v === undefined || v === null || String(v).trim() === '' || String(v).trim().toLowerCase() === 'onbekend';

/*
  Van ruwe extractie naar een voorstel dat het schema en de waardelijsten respecteert. Wat
  buiten de lijsten valt gaat niet stil verloren: het komt als waarschuwing mee, zodat de
  beller ziet wat de AI wilde zeggen.
*/
export function naarVoorstel(extractie, {
  discoveryVelden = [], bezwaarCategorieen = [], vraagCategorieen = [], waardenPerVeld = new Map(), vandaag,
} = {}) {
  if (!extractie) return null;
  const w = [];
  const inLijst = (lijst, v) => lijst.includes(v);
  const datumOk = (d) => (!leeg(d) && /^\d{4}-\d{2}-\d{2}$/.test(String(d).trim()) ? String(d).trim() : null);

  const uitkomst = inLijst(BELUITKOMSTEN, extractie.uitkomst) ? extractie.uitkomst : null;
  if (!uitkomst) w.push(`uitkomst '${extractie.uitkomst}' staat niet in de vaste lijst; kies hem zelf bij het verwerken (--uitkomst).`);

  const discovery = [];
  for (const d of extractie.discovery || []) {
    if (leeg(d.waarde)) continue;
    if (!inLijst(discoveryVelden, d.veld)) { w.push(`discovery-veld '${d.veld}' is geen bekend veld (waarde: ${d.waarde}); overgeslagen.`); continue; }
    const waarde = String(d.waarde).trim();
    const vast = waardenPerVeld.get(d.veld) || [];
    if (vast.length && !vast.includes(waarde)) {
      w.push(`discovery ${d.veld}: '${waarde}' staat niet in de vaste lijst (${vast.join(', ')}); overgeslagen.`);
      continue;
    }
    discovery.push({ veld: d.veld, waarde, zekerheid: inLijst(ZEKERHEDEN, d.zekerheid) ? d.zekerheid : 'waarschijnlijk' });
  }

  const bezwaren = (extractie.bezwaren || []).filter((b) => !leeg(b.bezwaar)).map((b) => {
    const categorie = inLijst(bezwaarCategorieen, b.categorie) ? b.categorie : (bezwaarCategorieen.includes('anders') ? 'anders' : null);
    if (categorie !== b.categorie) w.push(`bezwaarcategorie '${b.categorie}' onbekend, geworden: ${categorie || 'geen'}.`);
    return {
      bezwaar: String(b.bezwaar).trim(), onderliggendeReden: leeg(b.onderliggende_reden) ? null : b.onderliggende_reden, categorie,
      reactie: leeg(b.reactie) ? null : b.reactie, reactieWerkte: b.opgelost === 'ja' ? true : (b.opgelost === 'nee' ? false : undefined),
    };
  });

  const vragen = (extractie.vragen || []).filter((q) => !leeg(q.vraag)).map((q) => {
    const categorie = inLijst(vraagCategorieen, q.categorie) ? q.categorie : (vraagCategorieen.includes('overig') ? 'overig' : null);
    return { vraag: String(q.vraag).trim(), antwoord: q.beantwoord === 'ja' && !leeg(q.antwoord) ? q.antwoord : null, categorie };
  });

  const kansen = (extractie.kansen || []).filter((k) => !leeg(k.naam)).map((k) => ({
    naam: String(k.naam).trim(), geschatM2: Number(k.geschat_m2) > 0 ? Number(k.geschat_m2) : undefined,
    projectdatum: datumOk(k.projectdatum), plaats: leeg(k.plaats) ? null : k.plaats,
  }));

  /* Tags: kleine letters; 'Project grootte' wordt projectgrootte, 'geen interesse' geen_interesse. */
  const tagVan = (t) => {
    const s = String(t).trim().toLowerCase();
    return [s, s.replace(/\s+/g, '_'), s.replace(/\s+/g, '')].find((k) => TAGWOORDEN.includes(k)) || null;
  };
  const tags = [...new Set((extractie.tags || []).map(tagVan).filter(Boolean))];
  const koopkans = Number.isFinite(Number(extractie.koopkans)) ? Math.max(0, Math.min(100, Math.round(Number(extractie.koopkans)))) : null;
  const volgendeActie = extractie.volgende_actie && !leeg(extractie.volgende_actie.actie)
    ? { actie: extractie.volgende_actie.actie, datum: datumOk(extractie.volgende_actie.datum) }
    : null;
  if (volgendeActie && volgendeActie.datum && vandaag && volgendeActie.datum < vandaag) {
    w.push(`de volgende actie staat op ${volgendeActie.datum}, dat is voor vandaag; controleer de datum.`);
  }

  const suggesties = [];
  const voeg = (categorie, lijst) => { for (const v of lijst || []) if (!leeg(v)) suggesties.push({ categorie, voorstel: String(v).trim() }); };
  voeg('product', extractie.productwensen);
  voeg('belscript', extractie.verbeteringen_belscript);
  voeg('landingspagina', extractie.verbeteringen_landingspagina);
  voeg('demo', extractie.verbeteringen_demo);

  return {
    samenvatting: leeg(extractie.samenvatting) ? null : extractie.samenvatting.trim(),
    wilWel: leeg(extractie.wil_wel) ? null : String(extractie.wil_wel).trim(),
    wilNiet: leeg(extractie.wil_niet) ? null : String(extractie.wil_niet).trim(),
    waarom: leeg(extractie.waarom) ? null : String(extractie.waarom).trim(),
    uitkomst,
    temperatuur: inLijst(TEMPERATUREN, extractie.temperatuur) ? extractie.temperatuur : null,
    koopkans,
    sentiment: inLijst(SENTIMENTEN, extractie.sentiment) ? extractie.sentiment : null,
    aiAdvies: leeg(extractie.ai_advies) ? null : extractie.ai_advies.trim(),
    discovery,
    bezwaren,
    vragen,
    kansen,
    beloftesFramr: (extractie.beloftes_framr || []).filter((x) => !leeg(x)),
    beloftesLead: (extractie.beloftes_lead || []).filter((x) => !leeg(x)),
    onbeantwoordeVragen: (extractie.onbeantwoorde_vragen || []).filter((x) => !leeg(x)),
    weetjes: (extractie.weetjes || []).filter((x) => !leeg(x)),
    suggesties,
    volgendeActie,
    tags,
    voorgesteldBericht: leeg(extractie.voorgesteld_bericht) ? null : extractie.voorgesteld_bericht.trim(),
    praatAandeelBeller: Number(extractie.praat_aandeel_beller) > 0 ? Number(extractie.praat_aandeel_beller) : null,
    waarschuwingen: w,
  };
}

/* De waardelijsten van een bedrijf, zoals de prompt en de normalisatie ze nodig hebben. */
export function lijstenUitOpties(opties = [], companyId) {
  const van = (veld) => opties.filter((o) => o.company_id === companyId && o.veld === veld && o.actief !== false).map((o) => o.waarde);
  const discoveryVelden = van('discovery_veld');
  const waardenPerVeld = new Map(discoveryVelden.map((veld) => [veld, van(veld)]));
  return { discoveryVelden, waardenPerVeld, bezwaarCategorieen: van('bezwaar_categorie'), vraagCategorieen: van('vraag_categorie'), uitkomsten: van('uitkomst') };
}

/*
  Het voorstel wegschrijven. Alles wat de AI afleidde komt provisional binnen; de fase van de
  lead verschuift alleen met faseToepassen (anders blijft dat een menselijk besluit via
  belronde-cli --action gesprek). De opvolgtaak komt er wel, want geen warme lead zonder
  volgende actie is een harde regel.
*/
export async function schrijfVoorstel(adapter, {
  companyId, leadId, doorPersonId, personId, voorstel, uitkomst, startedAt, duurSeconden, opnameRef, transcriptRef,
  opnameToestemming, bewaarDagen = BEWAARTERMIJN_DAGEN, faseToepassen = false, pipeline = FRAMR_PIPELINE, vandaag,
} = {}) {
  if (!companyId || !leadId || !doorPersonId) throw new Error('schrijfVoorstel vereist companyId, leadId en doorPersonId.');
  if (!voorstel) throw new Error('schrijfVoorstel vereist een voorstel (naarVoorstel).');
  const gekozenUitkomst = uitkomst || voorstel.uitkomst;
  if (!gekozenUitkomst || !BELUITKOMSTEN.includes(gekozenUitkomst)) {
    throw new Error(`geen vaste uitkomst: geef --uitkomst <${BELUITKOMSTEN.slice(0, 3).join('|')}|...>.`);
  }
  if (opnameRef && opnameToestemming !== true) {
    throw new Error('een opname verwerken vereist --toestemming ja (zonder ja geen opname).');
  }
  const dag = vandaag || dagVan(startedAt) || dagVan(new Date());
  const lead = await adapter.getLeadById(leadId);
  const naam = lead ? lead.naam : leadId;

  const contact = await recordInteraction(adapter, {
    companyId, leadId, type: 'call', doorPersonId, personId, richting: 'uitgaand',
    startedAt: startedAt || `${dag}T12:00:00.000Z`, duurSeconden, samenvatting: voorstel.samenvatting || undefined,
    uitkomst: gekozenUitkomst, volgendeStap: voorstel.volgendeActie ? voorstel.volgendeActie.actie : undefined,
    opnameRef, transcriptRef,
  });
  const patch = { review_status: 'provisional' };
  if (voorstel.koopkans !== null) patch.koopkans = voorstel.koopkans;
  if (voorstel.temperatuur) patch.temperatuur = voorstel.temperatuur;
  if (voorstel.sentiment) patch.sentiment = voorstel.sentiment;
  if (voorstel.aiAdvies) patch.ai_advies = voorstel.aiAdvies;
  if (voorstel.tags.length) patch.tags = voorstel.tags;
  if (opnameToestemming !== undefined) patch.opname_toestemming = opnameToestemming;
  if (opnameRef || transcriptRef) patch.opname_bewaren_tot = plusDagen(dag, bewaarDagen);
  await adapter.updateInteraction(contact.id, patch);

  const geschreven = { discovery: 0, bezwaren: 0, vragen: 0, kansen: 0, weetjes: 0, suggesties: 0, taken: [] };
  for (const d of voorstel.discovery) {
    await recordDiscoveryAnswer(adapter, { companyId, leadId, interactionId: contact.id, veld: d.veld, waarde: d.waarde, zekerheid: d.zekerheid, herkomst: 'afgeleid' });
    geschreven.discovery += 1;
  }
  for (const b of voorstel.bezwaren) {
    await recordObjection(adapter, {
      companyId, leadId, interactionId: contact.id, bezwaar: b.onderliggendeReden ? `${b.bezwaar} (reden: ${b.onderliggendeReden})` : b.bezwaar,
      categorie: b.categorie || undefined, gegevenReactie: b.reactie || undefined, reactieWerkte: b.reactieWerkte,
    });
    geschreven.bezwaren += 1;
  }
  for (const q of voorstel.vragen) {
    await recordQuestion(adapter, { companyId, leadId, interactionId: contact.id, vraag: q.vraag, antwoord: q.antwoord || undefined, categorie: q.categorie || undefined });
    geschreven.vragen += 1;
  }
  for (const k of voorstel.kansen) {
    await recordOpportunity(adapter, { companyId, leadId, personId, naam: k.plaats && !k.naam.includes(k.plaats) ? `${k.naam} (${k.plaats})` : k.naam, geschatM2: k.geschatM2, projectdatum: k.projectdatum || undefined, stage: 'aanstaand' });
    geschreven.kansen += 1;
  }
  for (const weetje of voorstel.weetjes) {
    await adapter.insertCrmWeetje({ company_id: companyId, lead_id: leadId, person_id: personId || null, weetje, bron_interaction_id: contact.id, review_status: 'provisional' });
    geschreven.weetjes += 1;
  }
  for (const s of voorstel.suggesties) {
    await adapter.insertSalesSuggestion({ company_id: companyId, categorie: s.categorie, voorstel: s.voorstel, onderbouwing: `uit het gesprek met ${naam} op ${dag}`, status: 'voorgesteld' });
    geschreven.suggesties += 1;
  }

  /* De opvolging: de datum van de AI als die er is, anders de regel bij de uitkomst. */
  const alle = await adapter.fetchInteractions();
  const pogingenVoor = telPogingen(alle.filter((i) => i.lead_id === leadId && i.id !== contact.id), leadId);
  const faseNa = bepaalFaseNaUitkomst({ uitkomst: gekozenUitkomst, pogingenVoor });
  const opvolging = bepaalOpvolging({ uitkomst: gekozenUitkomst, opvolgDatum: voorstel.volgendeActie ? voorstel.volgendeActie.datum : undefined, vandaag: dag, faseNa });
  if (opvolging) {
    const t = await recordTask(adapter, { companyId, title: taakTitel(opvolging.taak, naam), dueDate: opvolging.dueDate, assigneeId: doorPersonId, description: voorstel.volgendeActie ? voorstel.volgendeActie.actie : (voorstel.aiAdvies || null) });
    await adapter.updateTask(t.id, { lead_id: leadId, task_type: opvolging.taak, reden: `${opvolging.reden} (voorstel AI)`, linked_interaction_id: contact.id, status: 'todo', due_date: opvolging.dueDate });
    geschreven.taken.push({ id: t.id, dueDate: opvolging.dueDate, taak: opvolging.taak });
  }
  let fase = null;
  if (faseToepassen && faseNa) fase = (await setLeadFase(adapter, { companyId, leadId, faseNaam: faseNa, pipeline })).naam;

  return { interactionId: contact.id, uitkomst: gekozenUitkomst, faseVoorgesteld: faseNa, fase, geschreven, bewaarTot: patch.opname_bewaren_tot || null };
}

/*
  Transcriptie. De OpenAI-provider stuurt het audiobestand naar de transcriptie-API; fetch is
  injecteerbaar. Zonder sleutel is er geen provider en werkt alleen --transcript.
*/
export function transcriptieProvider({ env = process.env, fetchImpl = globalThis.fetch, naam } = {}) {
  const gekozen = naam || (env.OPENAI_API_KEY ? 'openai' : null);
  if (!gekozen) return null;
  if (gekozen !== 'openai') throw new Error(`Onbekende transcriptieprovider '${gekozen}'. Alleen openai wordt ondersteund.`);
  if (!env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is niet gezet; zonder sleutel geen transcriptie. Geef anders --transcript <tekstbestand>.');
  const model = env.JARVIS_TRANSCRIPTIE_MODEL || 'whisper-1';
  return {
    naam: 'openai',
    model,
    async transcribeer(bestandPad) {
      const bytes = readFileSync(bestandPad);
      const form = new FormData();
      form.append('file', new Blob([bytes]), basename(bestandPad));
      form.append('model', model);
      form.append('language', 'nl');
      form.append('response_format', 'json');
      const r = await fetchImpl('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` },
        body: form,
      });
      if (!r.ok) throw new Error(`transcriptie mislukt: ${r.status} ${await r.text()}`);
      const data = await r.json();
      if (!data || typeof data.text !== 'string') throw new Error('transcriptie gaf geen tekst terug.');
      return data.text;
    },
  };
}

/*
  De analyse van een gesprek dat er al staat (uit de belsessie): het transcript lezen, het
  voorstel als ai_analyse op datzelfde contactmoment zetten (migration 0106), de kop ervan in
  de losse AI-velden waar de beller niets invulde, en wat een zekerheid draagt (discovery met
  herkomst afgeleid, weetjes provisional) meteen in de eigen tabellen. Bezwaren, vragen en
  kansen blijven in het document tot een mens ze overneemt. Geen nieuw contactmoment.
*/
export async function analyseerGesprek(adapter, {
  companyId, interactionId, transcript, anthropic, model = DEFAULT_MODEL, vandaag, bron = 'transcript',
} = {}) {
  if (!companyId || !interactionId) throw new Error('analyseerGesprek vereist companyId en interactionId.');
  const alle = await adapter.fetchInteractions();
  const gesprek = alle.find((i) => i.id === interactionId);
  if (!gesprek) throw new Error('contactmoment niet gevonden.');
  const lead = await adapter.getLeadById(gesprek.lead_id);
  const nu = new Date().toISOString();
  const wacht = async (reden) => {
    await adapter.updateInteraction(interactionId, { ai_analyse: { status: 'wacht', reden, verwerktOp: nu, bron } });
    return { status: 'wacht', reden };
  };
  if (!transcript || !String(transcript).trim()) return wacht('geen transcript');
  if (!anthropic) return wacht('geen extractiesleutel (ANTHROPIC_API_KEY)');

  const people = await adapter.fetchPeople();
  const beller = people.find((p) => p.id === gesprek.door_person_id);
  const lijsten = lijstenUitOpties(await adapter.fetchVeldopties(), companyId);
  const dag = vandaag || dagVan(gesprek.started_at);
  const prompt = bouwPrompt({ bedrijf: lead ? lead.naam : 'onbekend', plaats: lead ? lead.plaats : null, beller: beller ? beller.name : null, datum: dag, transcript, ...lijsten });
  let r;
  try {
    r = await extraheer({ anthropic, model, prompt });
  } catch (e) {
    await adapter.updateInteraction(interactionId, { ai_analyse: { status: 'fout', reden: e.message, verwerktOp: nu, bron, model } });
    return { status: 'fout', reden: e.message };
  }
  if (!r.extractie) {
    await adapter.updateInteraction(interactionId, { ai_analyse: { status: 'fout', reden: 'de AI gaf geen bruikbaar antwoord', verwerktOp: nu, bron, model } });
    return { status: 'fout', reden: 'de AI gaf geen bruikbaar antwoord' };
  }
  const voorstel = naarVoorstel(r.extractie, { ...lijsten, vandaag: dag });
  const analyse = { ...voorstel, status: 'klaar', bron, model, verwerktOp: nu, usage: r.usage || null };

  /* De kop: alleen invullen waar de beller niets zette; tags samenvoegen. */
  const patch = { ai_analyse: analyse, ai_verwerkt_op: nu };
  if (gesprek.koopkans == null && voorstel.koopkans !== null) patch.koopkans = voorstel.koopkans;
  if (!gesprek.temperatuur && voorstel.temperatuur) patch.temperatuur = voorstel.temperatuur;
  if (!gesprek.sentiment && voorstel.sentiment) patch.sentiment = voorstel.sentiment;
  if (!gesprek.ai_advies && voorstel.aiAdvies) patch.ai_advies = voorstel.aiAdvies;
  if (!gesprek.samenvatting && voorstel.samenvatting) patch.samenvatting = `AI: ${voorstel.samenvatting}`;
  const tags = [...new Set([...(gesprek.tags || []), ...voorstel.tags])];
  if (tags.length) patch.tags = tags;
  await adapter.updateInteraction(interactionId, patch);

  /* Discovery en de drie vragen van Jelle: afgeleid, naast wat de beller zelf al invulde. */
  const bestaand = new Set((await adapter.fetchDiscoveryAnswers()).filter((a) => a.interaction_id === interactionId).map((a) => a.veld));
  const extraDiscovery = [...voorstel.discovery];
  for (const [veld, waarde] of [['wil_wel', voorstel.wilWel], ['wil_niet', voorstel.wilNiet], ['waarom', voorstel.waarom]]) {
    if (waarde && lijsten.discoveryVelden.includes(veld)) extraDiscovery.push({ veld, waarde, zekerheid: 'waarschijnlijk' });
  }
  let discoveryGeschreven = 0;
  for (const d of extraDiscovery) {
    if (bestaand.has(d.veld)) continue;
    await recordDiscoveryAnswer(adapter, { companyId, leadId: gesprek.lead_id, interactionId, veld: d.veld, waarde: d.waarde, zekerheid: d.zekerheid, herkomst: 'afgeleid' });
    bestaand.add(d.veld);
    discoveryGeschreven += 1;
  }
  for (const weetje of voorstel.weetjes) {
    await adapter.insertCrmWeetje({ company_id: companyId, lead_id: gesprek.lead_id, weetje, bron_interaction_id: interactionId, review_status: 'provisional' });
  }
  for (const s of voorstel.suggesties) {
    await adapter.insertSalesSuggestion({ company_id: companyId, categorie: s.categorie, voorstel: s.voorstel, onderbouwing: `AI uit het gesprek met ${lead ? lead.naam : 'onbekend'} op ${dag}`, status: 'voorgesteld' });
  }
  return { status: 'klaar', analyse, discoveryGeschreven, weetjes: voorstel.weetjes.length, suggesties: voorstel.suggesties.length };
}

/*
  De hele keten voor een opgeslagen opname: het bestand achter opname_ref transcriberen (de
  tekst naast de opname bewaren, transcript_ref zetten) en dan analyseren. Zonder
  transcriptiedienst blijft de analyse op wacht staan, met de reden.
*/
export async function transcribeerEnAnalyseer(adapter, {
  companyId, interactionId, env = process.env, fetchImpl, anthropic, transcribeer, model, vandaag,
} = {}) {
  const alle = await adapter.fetchInteractions();
  const gesprek = alle.find((i) => i.id === interactionId);
  if (!gesprek) throw new Error('contactmoment niet gevonden.');
  let transcript = null;
  const transcriptPad = gesprek.transcript_ref && gesprek.transcript_ref.startsWith('bestand:') ? gesprek.transcript_ref.slice('bestand:'.length) : null;
  if (transcriptPad && existsSync(transcriptPad)) transcript = readFileSync(transcriptPad, 'utf8');
  if (!transcript) {
    const opnamePad = gesprek.opname_ref && gesprek.opname_ref.startsWith('bestand:') ? gesprek.opname_ref.slice('bestand:'.length) : null;
    if (!opnamePad || !existsSync(opnamePad)) {
      await adapter.updateInteraction(interactionId, { ai_analyse: { status: 'wacht', reden: 'geen opname als bestand', verwerktOp: new Date().toISOString(), bron: 'opname' } });
      return { status: 'wacht', reden: 'geen opname als bestand' };
    }
    let provider = null;
    try { provider = transcribeer ? { naam: 'injectie', transcribeer } : transcriptieProvider({ env, fetchImpl }); } catch (e) { provider = null; }
    if (!provider) {
      await adapter.updateInteraction(interactionId, { ai_analyse: { status: 'wacht', reden: 'geen transcriptiedienst (OPENAI_API_KEY); plak het transcript of geef het bestand', verwerktOp: new Date().toISOString(), bron: 'opname' } });
      return { status: 'wacht', reden: 'geen transcriptiedienst' };
    }
    try {
      transcript = await provider.transcribeer(opnamePad);
    } catch (e) {
      await adapter.updateInteraction(interactionId, { ai_analyse: { status: 'fout', reden: `transcriptie mislukt: ${e.message}`, verwerktOp: new Date().toISOString(), bron: 'opname' } });
      return { status: 'fout', reden: e.message };
    }
    const pad = `${opnamePad.replace(/\.[a-z0-9]+$/i, '')}.txt`;
    writeFileSync(pad, transcript, 'utf8');
    await adapter.updateInteraction(interactionId, { transcript_ref: `bestand:${pad}` });
  }
  return analyseerGesprek(adapter, { companyId, interactionId, transcript, anthropic, model, vandaag, bron: transcriptPad ? 'transcript' : 'opname' });
}
