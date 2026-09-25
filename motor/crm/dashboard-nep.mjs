/*
  Jarvis - dashboard-nep: verzonnen gegevens voor het dashboard van de belronde.

  Met --nep draait de dashboard-server op de mock-adapter met deze inhoud, zodat elk scherm
  te bekijken is zonder de live database aan te raken en zonder dat de seed op live hoeft te
  staan. Alles hieronder is verzonnen en als zodanig herkenbaar: bedrijfsnamen met Proef erin,
  nummers die op nullen eindigen, mailadressen op .voorbeeld. Geen echte prijzen, geen echte
  leads, geen echte partners.

  De geschiedenis wordt niet als losse rijen ingeplakt maar met dezelfde functies gemaakt die
  de echte belronde gebruikt (registreerGesprek, registreerVerstuurd, planDemo,
  registreerDemoGedaan, schrijfDagselectie), over de afgelopen drie werkweken. Zo klopt de
  samenhang: elke uitkomst heeft zijn fase en zijn taak, en het dagrapport telt wat er die
  dag echt gebeurde.

  Stijl: blokcommentaar, geen lange streepjes en geen emoji, conform de projectafspraken.
*/

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { recordLead, recordLeadPerson, recordOpportunity, recordQuestion, setLeadFase } from './crm-store.mjs?v=5dd6073';
import { recordPerson } from '../review/people-store.mjs?v=5dd6073';
import {
  FRAMR_PIPELINE, FRAMR_FASEN, FRAMR_VELDOPTIES, STANDAARD_OPVOLGREEKSEN, dagVan, plusDagen, naarWerkdag,
  registreerGesprek, registreerVerstuurd, registreerReactie, planDemo, annuleerDemo, registreerDemoGedaan, kiesDagselectie, schrijfDagselectie,
  maakLosContactmoment, koppelOpname, DEMO_ONDERDELEN, bevestigLevering, leadVoorPartner,
} from './belronde-store.mjs?v=5dd6073';

/* Een vaste toevalsreeks: elke start geeft dezelfde voorbeelddata. */
function reeks(zaad = 7) {
  let s = zaad;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
}

const WOORDEN = ['Alpha', 'Bravo', 'Cedar', 'Delta', 'Ember', 'Fjord', 'Granite', 'Harbor', 'Iris', 'Juniper',
  'Kestrel', 'Linden', 'Maple', 'Nova', 'Oak', 'Pine', 'Quartz', 'Reed', 'Sage', 'Tamarack', 'Umber', 'Vale',
  'Willow', 'Xenia', 'Yarrow', 'Zephyr', 'Amber', 'Basalt', 'Cobalt', 'Dune', 'Echo', 'Flint', 'Glen', 'Heath',
  'Isle', 'Jade', 'Knoll', 'Lumen', 'Moss', 'North', 'Orchard', 'Pebble', 'Quill', 'Ridge', 'Slate', 'Tide',
  'Upland', 'Vesper'];
const PLAATSEN = [
  ['Sittard', 'Limburg'], ['Heerlen', 'Limburg'], ['Venlo', 'Limburg'], ['Eindhoven', 'Noord-Brabant'],
  ['Tilburg', 'Noord-Brabant'], ['Breda', 'Noord-Brabant'], ['Nijmegen', 'Gelderland'], ['Arnhem', 'Gelderland'],
  ['Utrecht', 'Utrecht'], ['Amersfoort', 'Utrecht'], ['Zwolle', 'Overijssel'], ['Enschede', 'Overijssel'],
  ['Rotterdam', 'Zuid-Holland'], ['Den Haag', 'Zuid-Holland'], ['Haarlem', 'Noord-Holland'], ['Alkmaar', 'Noord-Holland'],
];
const BRIEFINGS = [
  'Klein vloerenbedrijf met eigen busje, vooral PVC voor particulieren. Werkt met een groothandel in de buurt, offertes in Excel.',
  'Familiebedrijf met showroom, laminaat en PVC, ook traprenovatie. Koopt voorraad in bij twee leveranciers.',
  'Zzp-er die vooral als onderaannemer voor aannemers legt; de klant levert vaak het materiaal.',
  'Legt visgraat en brede planken voor renovatie, actief in twee provincies, maakt offertes s avonds op papier.',
  'Vloerenwinkel met drie leggers in dienst, eigen staalboeken, bestelt per project en laat bezorgen.',
  'Allround klusbedrijf dat ook vloeren legt; administratie in WhatsApp en notities.',
];
const SAMENVATTINGEN = [
  'Doet vooral PVC, koopt bij een groothandel, verdient niets op materiaal. Wil de calculator zien.',
  'Legt voor aannemers, klant levert het materiaal. Wel interesse in de offertetool.',
  'Werkt met Excel, offertes kosten hem een avond. Volgende project over twee weken.',
  'Tevreden over zijn leverancier, maar open voor een tweede bij een project.',
  'Heeft het druk tot de herfst. Wil na de vakantie kijken.',
  'Wil eerst de landingspagina zien, belt daarna zelf terug.',
];
const BEZWAREN = [
  ['ik heb al een leverancier', 'huidige leverancier', 'probeer ons eens bij een project, dan vergelijk je zelf'],
  ['ik krijg al goede prijzen', 'prijs', 'hoe vergelijk je dat, alleen de vloerprijs of het hele project'],
  ['ik heb geen tijd voor iets nieuws', 'geen tijd', 'juist daarom, het scheelt tijd per offerte'],
  ['gratis klinkt onbetrouwbaar', 'gratis_klinkt_onbetrouwbaar', 'we verdienen aan het materiaal, niet aan de software'],
  ['ik wil mijn eigen boekhoudpakket houden', 'boekhouding', 'dat mag, we koppelen ermee'],
  ['mijn klant koopt de vloer zelf', 'geen_materiaalverkoop', 'dan is de offertetool alsnog winst'],
];
const UITKOMSTEN_GEWOGEN = [
  ['niet_opgenomen', 22], ['voicemail', 14], ['verkeerd_nummer', 2], ['bedrijf_gestopt', 2],
  ['later_terugbellen', 10], ['geen_tijd', 8], ['geen_interesse', 10], ['eerst_informatie', 10],
  ['mogelijk_interesse', 7], ['goede_interesse', 7], ['demo_aangeboden', 3], ['demo_geweigerd', 2],
  ['demo_ingepland', 4], ['account_gewenst', 2], ['niet_meer_benaderen', 2],
];

function kies(r, lijst) {
  return lijst[Math.floor(r() * lijst.length)];
}

function kiesGewogen(r, lijst) {
  const totaal = lijst.reduce((s, [, g]) => s + g, 0);
  let x = r() * totaal;
  for (const [waarde, g] of lijst) {
    x -= g;
    if (x <= 0) return waarde;
  }
  return lijst[lijst.length - 1][0];
}

function werkdagenTerug(vandaag, n) {
  const dagen = [];
  let d = vandaag;
  while (dagen.length < n) {
    d = plusDagen(d, -1);
    const [j, m, dd] = d.split('-').map(Number);
    const wd = new Date(j, m - 1, dd).getDay();
    if (wd !== 0 && wd !== 6) dagen.unshift(d);
  }
  return dagen;
}

/* Alles wat de motor in de simulatie aanmaakt krijgt de gesimuleerde dag als aanmaakdatum, anders
   lijkt in het weekrapport alles van vandaag (de mock stempelt met de echte klok). */
function stempel(adapter, dag, gezien) {
  for (const tabel of ['tasks', 'sales_afspraken', 'objections', 'questions', 'crm_weetjes', 'sales_suggestions', 'opportunities']) {
    for (const rij of adapter.store[tabel] || []) {
      if (gezien.has(rij.id)) continue;
      gezien.add(rij.id);
      rij.created_at = `${dag}T09:00:00.000Z`;
      if ('updated_at' in rij) rij.updated_at = `${dag}T09:00:00.000Z`;
    }
  }
}

export async function vulNep(adapter, { companyId, vandaag, slug = 'oaklyn', opnamesMap = null, leeg = false, aantalLeads = null } = {}) {
  if (!companyId || !vandaag) throw new Error('vulNep vereist companyId en vandaag.');
  /*
    De verse stand (--leeg): het programma zoals het er op dag een uit zag. De seed staat er, de
    twee bellers staan er, en er ligt een lijst leads die net geimporteerd is. Verder niets: geen
    gesprekken, geen taken, geen demo's, geen partners, geen service, geen meldingen. Zo is elke
    stap die je daarna zet een stap die je zelf gezet hebt, en zie je precies wat hij doet.
  */
  const aantal = Number(aantalLeads) || (leeg ? 100 : 48);
  const r = reeks(11);
  const gezien = new Set();
  await adapter.insertCompany({ id: companyId, slug, name: 'Oaklyn (voorbeelddata)', status: 'active' });

  for (const [volgorde, naam, eind] of FRAMR_FASEN) {
    await adapter.insertPipelineFase({ company_id: companyId, pipeline: FRAMR_PIPELINE, volgorde, naam, is_eindfase: eind });
  }
  const opties = [
    ...FRAMR_VELDOPTIES,
    ['discovery_veld', ['huidige_vloerleverancier', 'huidige_software', 'm2_per_maand', 'projecten_per_maand', 'grootste_pijnpunt',
      'koopt_zelf_in', 'marge_op_materiaal', 'open_voor_tweede_leverancier', 'prijs_per_m2', 'hoe_offertes', 'tijd_per_offerte']],
    ['koopt_zelf_in', ['ja', 'nee', 'wisselend']],
    ['marge_op_materiaal', ['ja', 'een_op_een', 'wisselend']],
    ['open_voor_tweede_leverancier', ['ja', 'nee', 'onbekend']],
    ['vraag_categorie', ['software', 'prijzen', 'levering', 'facturen', 'calculator', 'vloeren', 'garantie', 'partnerprogramma', 'account', 'overig']],
    ['classificatie', ['vloerenlegger', 'stoffeerder', 'vloer_overig', 'traprenovatie', 'vloerenwinkel', 'tegelzetter', 'bouw_algemeen', 'overig']],
  ];
  for (const [veld, waarden] of opties) {
    for (const waarde of waarden) {
      if (!(await adapter.findVeldoptie(companyId, veld, waarde))) await adapter.insertVeldoptie({ company_id: companyId, veld, waarde });
    }
  }

  for (const reeksRij of STANDAARD_OPVOLGREEKSEN) {
    await adapter.insertOpvolgreeks({ company_id: companyId, aanleiding: reeksRij.aanleiding, naam: reeksRij.naam, stappen: reeksRij.stappen, max_pogingen: reeksRij.maxPogingen, versie: 1 });
  }

  const myron = await recordPerson(adapter, { companyId, name: 'Myron Vos', role: 'owner' });
  const jelle = await recordPerson(adapter, { companyId, name: 'Jelle Winthaegen', role: 'owner' });

  /* De bedrijven: om en om aan Myron en Jelle, en elke zesde niet toegewezen (de gedeelde pool).
     In de verse stand staan ze allemaal op Myron, zodat er een werkvoorraad is om mee te beginnen. */
  const leads = [];
  for (let i = 0; i < aantal; i += 1) {
    const woord = WOORDEN[i % WOORDEN.length];
    /* Meer leads dan woorden: dan schuift de plaats mee, anders zou naam plus plaats dezelfde
       sleutel geven en zou de ontdubbeling van recordLead ze op elkaar plakken. */
    const [plaats, regio] = PLAATSEN[(i + Math.floor(i / WOORDEN.length) * 7) % PLAATSEN.length];
    const soort = i % 9 === 0 ? 'vloerenwinkel' : (i % 13 === 0 ? 'tegelzetter' : 'vloerenlegger');
    /* Meer leads dan woorden: de tweede ronde krijgt een windstreek erachter, zodat elke naam
       eenmalig blijft en twee bedrijven niet op elkaar geplakt worden. */
    const ronde = Math.floor(i / WOORDEN.length);
    const streken = ['', ' Noord', ' Zuid', ' Oost', ' West'];
    const lap = ronde < streken.length ? streken[ronde] : ` ${ronde}`;
    const naam = `Proef ${woord} ${soort === 'vloerenwinkel' ? 'Vloerenwinkel' : (soort === 'tegelzetter' ? 'Tegels' : 'Vloeren')}${lap}`;
    const rv = r() < 0.6 ? 'bv' : (r() < 0.6 ? 'eenmanszaak' : null);
    const nr = String(i + 1).padStart(leeg ? 3 : 2, '0');
    /* Een verzonnen nummer van tien cijfers, ook als er honderd leads zijn. */
    const nummer = leeg ? `06 0000 0${nr}` : `06 0000 00${nr}`;
    const l = await recordLead(adapter, {
      companyId, naam, plaats, regio, telefoon: nummer, whatsapp: nummer,
      email: i % 4 === 3 ? undefined : `info@proef${nr}.voorbeeld`, website: `https://proef${nr}.voorbeeld`,
      rechtsvorm: rv || undefined, bel_opt_in: rv === 'eenmanszaak' && r() < 0.4 ? true : undefined,
      bron: 'import-voorbeeld', toegewezen_aan: leeg ? myron.id : (i % 6 === 5 ? undefined : (i % 2 === 0 ? myron.id : jelle.id)),
      /* Werkgebied (aanvulling onderdeel 1): vloeren is het gebied van vandaag; een paar kozijnen, zodat het filter iets doet.
         In de verse stand alles vloeren: een tweede gebied zonder leads leidt alleen maar af. */
      werkgebied: !leeg && i % 11 === 10 ? 'kozijnen' : 'vloeren',
    });
    await adapter.insertLeadClassification({ company_id: companyId, lead_id: l.id, classificatie: soort, door: 'ai', waargenomen_op: plusDagen(vandaag, -40), geldig_van: plusDagen(vandaag, -40) });
    await adapter.insertLeadSource({ company_id: companyId, lead_id: l.id, broncategorie: 'google_maps', bron: 'voorbeeld', gevonden_op: plusDagen(vandaag, -45) });
    await adapter.insertLeadFact({ company_id: companyId, lead_id: l.id, veld: 'telefoon', waarde: nummer, waargenomen_op: plusDagen(vandaag, -45), geldig_van: plusDagen(vandaag, -45) });
    if (r() < 0.7) {
      await adapter.insertLeadFact({ company_id: companyId, lead_id: l.id, veld: 'google_score', waarde: (3.8 + Math.round(r() * 12) / 10).toFixed(1), waargenomen_op: plusDagen(vandaag, -45), geldig_van: plusDagen(vandaag, -45) });
      await adapter.insertLeadFact({ company_id: companyId, lead_id: l.id, veld: 'reviews_aantal', waarde: String(3 + Math.floor(r() * 60)), waargenomen_op: plusDagen(vandaag, -45), geldig_van: plusDagen(vandaag, -45) });
    }
    /* In de verse stand staat elke lead meteen op de beginstatus, zodat de lijst klopt en de
       werkbak nieuwe leads hem toont; zonder status zou het scherm eerst om opruimen vragen. */
    if (leeg) await setLeadFase(adapter, { companyId, leadId: l.id, faseNaam: 'nieuwe_lead', pipeline: FRAMR_PIPELINE });
    /* Een briefing komt van het onderzoek achteraf; op dag een is dat er nog niet. */
    if (!leeg && r() < 0.6) await adapter.insertLeadResearch({ company_id: companyId, lead_id: l.id, versie: 1, samenvatting: kies(r, BRIEFINGS), model: 'voorbeeld' });
    /* Bij de helft een contactpersoon, als draad naar het relatieweb. */
    if (i % 2 === 0) {
      const contact = await recordPerson(adapter, { companyId, name: `${kies(r, ['Piet', 'Sanne', 'Kees', 'Lotte', 'Bram', 'Noor'])} van ${woord}`, role: 'client' });
      await recordLeadPerson(adapter, { companyId, leadId: l.id, personId: contact.id, rol: i % 4 === 0 ? 'eigenaar' : 'compagnon', isPrimair: true, voorkeurskanaal: 'whatsapp' });
    }
    /* Elke achtste lead blijft ongebeld, zodat de bak Nieuwe leads op Vandaag ook na weken simulatie iets toont. */
    leads.push({ id: l.id, naam, beller: leeg ? myron.id : (i % 6 === 5 ? null : (i % 2 === 0 ? myron.id : jelle.id)), klaar: false, bewaard: !leeg && i % 8 === 7 });
  }
  stempel(adapter, plusDagen(vandaag, -40), gezien);

  /* De verse stand stopt hier: de lijst ligt klaar, de rest gaat Jelle zelf doen. */
  if (leeg) return { leads: leads.length, bellers: { myron: myron.id, jelle: jelle.id }, demos: 0, leeg: true };

  /* Drie werkweken bellen, vooral door Myron, met dezelfde dagselectie als de echte belronde:
     eerst wat vervalt, dan herhaalpogingen, dan nieuwe leads. */
  const dagen = werkdagenTerug(vandaag, 15);
  const demos = [];
  const leadOpId = new Map(leads.map((l) => [l.id, l]));
  for (const [dagIndex, dag] of dagen.entries()) {
    /* Vier van de vijf dagen belt Myron; vast per dag, zodat de verdeling niet met de rest van het toeval meeschuift. */
    const wie = dagIndex % 5 === 4 ? jelle.id : myron.id;
    const stand = {
      leads: await adapter.fetchLeads(), fasen: await adapter.fetchPipelineFases(), classificaties: await adapter.fetchLeadClassifications(),
      research: await adapter.fetchLeadResearch(), interacties: await adapter.fetchInteractions(), taken: await adapter.fetchTasks(), queue: [],
    };
    const lijst = kiesDagselectie({ ...stand, bellerId: wie, vandaag: dag, aantal: 6 + Math.floor(r() * 5), pipeline: FRAMR_PIPELINE, classificatie: null, companyId });
    for (const s of lijst) {
      const l = leadOpId.get(s.lead.id);
      if (!l || l.bewaard) continue;
      const uitkomst = kiesGewogen(r, UITKOMSTEN_GEWOGEN);
      const bereikt = !['niet_opgenomen', 'voicemail', 'verkeerd_nummer'].includes(uitkomst);
      const metBezwaar = bereikt && r() < 0.45 ? kies(r, BEZWAREN) : null;
      const start = `${dag}T${String(9 + Math.floor(r() * 7)).padStart(2, '0')}:${String(Math.floor(r() * 60)).padStart(2, '0')}:00.000Z`;
      const args = {
        companyId, leadId: l.id, doorPersonId: wie, uitkomst, vandaag: dag, startedAt: start, nu: start,
        samenvatting: bereikt ? kies(r, SAMENVATTINGEN) : undefined,
        duurSeconden: bereikt ? 120 + Math.floor(r() * 600) : 20,
        opnameRef: bereikt && r() < 0.5 ? `drive:Gesprekken/${l.naam.toLowerCase().replace(/\s+/g, '-')}-${dag}.m4a` : undefined,
        opnameToestemming: bereikt && r() < 0.5 ? true : undefined,
        tags: bereikt ? ['koopmotief', r() < 0.5 ? 'calculator' : 'marge'] : undefined,
      };
      if (metBezwaar) {
        args.bezwaar = metBezwaar[0];
        args.bezwaarCategorie = metBezwaar[1];
        args.reactie = metBezwaar[2];
        args.reactieWerkte = r() < 0.55 ? true : (r() < 0.5 ? false : undefined);
      }
      if (uitkomst === 'demo_ingepland') { args.demoDatum = naarWerkdag(plusDagen(dag, 3 + Math.floor(r() * 5))); args.demoTijd = `${10 + Math.floor(r() * 7)}:${r() < 0.5 ? '00' : '30'}`; args.demoVorm = r() < 0.7 ? 'online' : 'telefonisch'; }
      if (bereikt && r() < 0.3) args.extras = [{ soort: kies(r, ['inzicht', 'persoonlijke_context', 'productwens']), inhoud: kies(r, ['zoon neemt de zaak over', 'belt liever na 17:00', 'wil zijn eigen logo op de offerte', 'werkt veel voor een aannemer in Venlo']) }];
      const uit = await registreerGesprek(adapter, args);
      if (uitkomst === 'eerst_informatie') {
        await registreerVerstuurd(adapter, { companyId, leadId: l.id, doorPersonId: wie, kanaal: 'whatsapp', materiaal: 'landingspagina', templateRef: 'whatsapp_landingspagina@v1', link: 'https://framr.one/p/vloeren', vandaag: dag, startedAt: start.replace(/T(\d\d)/, (m, h) => `T${String(Number(h) + 1).padStart(2, '0')}`), nu: `${dag}T12:00:00.000Z` });
      }
      if (uitkomst === 'demo_ingepland') demos.push({ lead: l, wie, dag: args.demoDatum, tijd: args.demoTijd });
      if (['verloren', 'niet_meer_benaderen', 'later_benaderen', 'demo_gepland', 'account_aangeboden'].includes(uit.fase)) l.klaar = true;
      if (uitkomst === 'goede_interesse' && r() < 0.5) {
        await recordOpportunity(adapter, { companyId, leadId: l.id, naam: `PVC woning ${kies(r, PLAATSEN)[0]}`, geschatM2: 60 + Math.floor(r() * 90), projectdatum: naarWerkdag(plusDagen(dag, 7 + Math.floor(r() * 14))), stage: 'aanstaand' });
      }
      if (bereikt && r() < 0.25) {
        await recordQuestion(adapter, { companyId, leadId: l.id, interactionId: uit.interactionId, vraag: kies(r, ['Werkt het met Moneybird?', 'Kan ik mijn eigen logo op de offerte zetten?', 'Hebben jullie visgraat?', 'Wat is de levertijd?', 'Kan ik afhalen?']), categorie: kies(r, ['software', 'vloeren', 'levering']) });
      }
    }
    /* Reacties op berichten van een paar dagen terug: sommige leads appen terug. */
    for (const b of adapter.store.interactions.filter((i) => i.type === 'whatsapp' && i.richting !== 'inkomend' && i.reactie_verwacht && !i.reactie_ontvangen_op && dagVan(i.started_at) === plusDagen(dag, -2))) {
      if (r() < 0.4) {
        await registreerReactie(adapter, { companyId, leadId: b.lead_id, doorPersonId: b.door_person_id, kanaal: 'whatsapp', tekst: kies(r, ['Ziet er goed uit, bel me morgen even', 'Ik kijk er volgende week naar', 'Kun je een voorbeeldofferte sturen?']), vandaag: dag, startedAt: `${dag}T${String(8 + Math.floor(r() * 9)).padStart(2, '0')}:15:00.000Z`, nu: `${dag}T12:00:00.000Z` });
      }
    }
    stempel(adapter, dag, gezien);
  }

  /* Demo's die al geweest zijn: afronden met een evaluatie; een ervan kwam niet opdagen. */
  let nietVerschenen = false;
  for (const d of demos) {
    if (d.dag >= vandaag) continue;
    if (!nietVerschenen && r() < 0.5) {
      nietVerschenen = true;
      await annuleerDemo(adapter, { companyId, leadId: d.lead.id, nietVerschenen: true, reden: 'niet opgenomen op het afgesproken tijdstip', doorPersonId: d.wie, vandaag: d.dag, nu: `${d.dag}T14:30:00.000Z` });
      stempel(adapter, d.dag, gezien);
      continue;
    }
    const onderdelen = DEMO_ONDERDELEN.slice(0, 8 + Math.floor(r() * 8)).map((o) => ({
      onderdeel: o, getoond: true, begrepen: r() < 0.85, relevantie: 2 + Math.floor(r() * 4), gebruiksgemak: 2 + Math.floor(r() * 4), vertrouwen: 2 + Math.floor(r() * 4),
      reactie: r() < 0.3 ? 'dat scheelt me een avond' : null, verbeterpunt: r() < 0.2 ? 'plinten per ruimte apart tonen' : null, bug: r() < 0.1 ? 'de m2 sprongen na het wissen van een vlak' : null,
    }));
    const uitkomst = r() < 0.4 ? 'account_gewenst' : (r() < 0.7 ? 'goede_interesse' : 'mogelijk_interesse');
    await registreerDemoGedaan(adapter, {
      companyId, leadId: d.lead.id, doorPersonId: d.wie, samenvatting: 'Eigen project van 85 m2 doorgerekend; de materiaalberekening en de offerte landden het best.',
      uitkomst, koopkans: 40 + Math.floor(r() * 50), vandaag: d.dag, startedAt: `${d.dag}T${(d.tijd || '14:00').padStart(5, '0')}:00.000Z`, nu: `${d.dag}T15:00:00.000Z`, volgendeStap: uitkomst === 'account_gewenst' ? 'account aanmaken en het eerste project samen invoeren' : 'hij stuurt de maten van zijn volgende project door',
      antwoorden: { interesse_voor_demo: String(4 + Math.floor(r() * 4)), interesse_na_demo: String(6 + Math.floor(r() * 4)), demo_aha_moment: 'de offerte stond klaar voor hij in de bus zat', demo_getoond: 'inmeting, materiaalberekening, offerte', demo_begrepen: 'de marge per project', demo_relevant: 'de offerte in een keer klaar', demo_eerst_oplossen: r() < 0.5 ? 'koppeling met de boekhouding' : 'plinten per ruimte', demo_morgen_gebruiken: uitkomst === 'account_gewenst' ? 'ja' : 'misschien', demo_m2_verwacht: String(80 + Math.floor(r() * 200)), demo_eerst_verbeteren: r() < 0.5 ? 'koppeling met de boekhouding' : 'plinten per ruimte' },
      bezwaren: r() < 0.5 ? [{ bezwaar: 'ik wil eerst zien hoe de levering gaat', categorie: 'levering', reactie: 'bestel het eerste project klein, dan zie je het', resultaat: 'gedeeltelijk', soort: 'tijdelijk' }] : [],
      onderdelen,
    });
    stempel(adapter, d.dag, gezien);
  }

  /* De funnel verder gevuld: twee partners die na de demo een account namen en bestelden. */
  const warmUitkomsten = new Set(['account_gewenst', 'goede_interesse', 'demo_ingepland']);
  const laatsteUitkomst = (leadId) => (adapter.store.interactions.filter((i) => i.lead_id === leadId && i.uitkomst).sort((a, b) => String(b.started_at).localeCompare(String(a.started_at)))[0] || {}).uitkomst;
  const accounts = leads.filter((l) => l.beller === myron.id && warmUitkomsten.has(laatsteUitkomst(l.id))).slice(0, 3);
  const fasenNa = ['account_aangemaakt', 'onboarding', 'eerste_bestelling'];
  for (const [i, l] of accounts.entries()) {
    await setLeadFase(adapter, { companyId, leadId: l.id, faseNaam: fasenNa[i], pipeline: FRAMR_PIPELINE });
    l.klaar = true;
  }

  /* Een gesprek dat de AI verwerkte en dat nog bevestigd moet worden. */
  const ai = leads.find((l) => l.beller === myron.id && !l.klaar);
  if (ai) {
    const uit = await registreerGesprek(adapter, {
      companyId, leadId: ai.id, doorPersonId: myron.id, uitkomst: 'goede_interesse', vandaag: plusDagen(vandaag, -1), startedAt: `${plusDagen(vandaag, -1)}T15:20:00.000Z`,
      samenvatting: 'AI: legt PVC en laminaat voor particulieren, koopt bij een groothandel, offertes in Word. Wil de calculator op zijn project van 70 m2 zien.',
      opnameRef: 'drive:Gesprekken/proef-ai-voorbeeld.m4a', transcriptRef: 'drive:Gesprekken/proef-ai-voorbeeld.txt', opnameToestemming: true, tags: ['calculator', 'software', 'koopmotief'],
    });
    await adapter.updateInteraction(uit.interactionId, {
      review_status: 'provisional', koopkans: 62, temperatuur: 'warm', sentiment: 'positief',
      ai_advies: 'Begin bij de brutomarge op zijn eigen project; laat de calculator pas zien als hij vertelt hoe hij nu rekent.',
      ai_verwerkt_op: `${plusDagen(vandaag, -1)}T15:40:00.000Z`,
      ai_analyse: {
        status: 'klaar', bron: 'opname', model: 'voorbeeld', verwerktOp: `${plusDagen(vandaag, -1)}T15:40:00.000Z`,
        samenvatting: 'Legt PVC en laminaat voor particulieren in de regio, koopt bij een groothandel om de hoek en verdient niets op het materiaal. Maakt offertes in Word, meestal s avonds. Heeft over twee weken een woning van 70 m2 en wil de calculator daarop zien.',
        wilWel: 'sneller een offerte de deur uit, en wat overhouden op het materiaal als dat zonder gedoe kan',
        wilNiet: 'overstappen van leverancier of een abonnement; niets nieuws leren in het seizoen',
        waarom: 'hij vertrouwt zijn groothandel omdat die altijd levert, en is al eens op software afgeknapt die tijd kostte in plaats van bespaarde',
        uitkomst: 'goede_interesse', temperatuur: 'warm', koopkans: 62, sentiment: 'positief',
        aiAdvies: 'Begin bij de brutomarge op zijn eigen project; laat de calculator pas zien als hij vertelt hoe hij nu rekent.',
        discovery: [{ veld: 'huidige_software', waarde: 'Word', zekerheid: 'bevestigd' }, { veld: 'koopt_zelf_in', waarde: 'ja', zekerheid: 'bevestigd' }, { veld: 'hoe_offertes', waarde: 's avonds in Word', zekerheid: 'bevestigd' }],
        bezwaren: [{ bezwaar: 'ik heb al een leverancier waar ik tevreden over ben', onderliggendeReden: 'vertrouwen in levering', categorie: 'huidige leverancier', reactie: 'we vragen niet om over te stappen, probeer ons bij een project', reactieWerkte: true }],
        vragen: [{ vraag: 'Werkt het ook met mijn boekhoudpakket?', antwoord: 'de koppeling staat op de roadmap', categorie: 'software' }],
        kansen: [{ naam: 'PVC woning', geschatM2: 70, projectdatum: plusDagen(vandaag, 13), plaats: 'Sittard' }],
        beloftesFramr: ['een voorbeeldberekening sturen van de woning van 70 m2'], beloftesLead: ['de maten doorgeven'], onbeantwoordeVragen: ['of visgraat leverbaar is'],
        weetjes: ['belt liever na 17:00'], suggesties: [{ categorie: 'product', voorstel: 'eigen logo op de offerte' }],
        volgendeActie: { actie: 'terugbellen met de voorbeeldberekening', datum: plusDagen(vandaag, 2) },
        tags: ['calculator', 'software', 'koopmotief', 'concurrent'], voorgesteldBericht: 'Hoi, leuk gesprek net. Ik stuur je de berekening van die woning van 70 m2, dan zie je meteen wat je eraan overhoudt.',
        praatAandeelBeller: 34, waarschuwingen: [],
      },
    });
    await adapter.insertCrmWeetje({ company_id: companyId, lead_id: ai.id, weetje: 'belt liever na 17:00', bron_interaction_id: uit.interactionId, review_status: 'provisional' });
    for (const [veld, waarde] of [['wil_wel', 'sneller een offerte de deur uit, en wat overhouden op het materiaal'], ['wil_niet', 'overstappen van leverancier of een abonnement'], ['waarom', 'zijn groothandel levert altijd; eerder afgeknapt op software die tijd kostte']]) {
      await adapter.insertDiscoveryAnswer({ company_id: companyId, lead_id: ai.id, interaction_id: uit.interactionId, veld, waarde, zekerheid: 'waarschijnlijk', herkomst: 'afgeleid' });
    }
  }

  const suggesties = [
    ['product', 'eigen logo op de offerte'], ['product', 'koppeling met Moneybird'], ['product', 'plinten per ruimte apart tonen'],
    ['belscript', 'de opnamezin eerder in het gesprek'], ['landingspagina', 'een voorbeeldofferte als beeld'], ['demo', 'beginnen bij de materiaalberekening, niet bij het dashboard'],
    ['product', 'eigen logo op de offerte'],
  ];
  for (const [categorie, voorstel] of suggesties) {
    await adapter.insertSalesSuggestion({ company_id: companyId, categorie, voorstel, onderbouwing: 'uit de gesprekken van de afgelopen weken (voorbeeld)', status: 'voorgesteld' });
  }

  /* Vijf partners in het portaal, elk op een andere plek in de activatie. */
  const partnerRijen = [
    { naam: 'Proef Alpha Vloeren', dagen: 40, vrij: true, klant: true, niveau: 'zilver', logo: true, iban: true, klanten: 3, klussen: 3, inmetingen: 3, calculaties: 2, offertes: 3, gewonnen: 2, facturen: 2, orders: 3, stil: 3 },
    { naam: 'Proef Cedar Vloeren', dagen: 25, vrij: true, klant: true, niveau: 'brons', logo: true, iban: false, klanten: 2, klussen: 2, inmetingen: 2, calculaties: 1, offertes: 1, gewonnen: 0, facturen: 0, orders: 0, stil: 4 },
    { naam: 'Proef Ember Vloeren', dagen: 70, vrij: true, klant: true, niveau: 'brons', logo: false, iban: false, klanten: 1, klussen: 1, inmetingen: 1, calculaties: 0, offertes: 0, gewonnen: 0, facturen: 0, orders: 1, stil: 45 },
    { naam: 'Proef Granite Vloeren', dagen: 95, vrij: true, klant: true, niveau: 'goud', logo: true, iban: true, klanten: 4, klussen: 5, inmetingen: 5, calculaties: 4, offertes: 5, gewonnen: 4, facturen: 4, orders: 2, stil: 70 },
    { naam: 'Proef Iris Vloeren', dagen: 3, vrij: false, klant: false, niveau: null, logo: false, iban: false, klanten: 0, klussen: 0, inmetingen: 0, calculaties: 0, offertes: 0, gewonnen: 0, facturen: 0, orders: 0, stil: 3 },
  ];
  for (const [i, p] of partnerRijen.entries()) {
    const id = `partner-${i + 1}`;
    const start = plusDagen(vandaag, -p.dagen);
    const laatste = plusDagen(vandaag, -p.stil);
    adapter.store.portal_partners.push({
      id, company_id: companyId, bedrijfsnaam: p.naam, plaats: PLAATSEN[i][0], created_at: `${start}T09:00:00.000Z`, updated_at: `${laatste}T09:00:00.000Z`,
      vrijgegeven_op: p.vrij ? `${start}T10:00:00.000Z` : null, shopify_customer_id: p.klant ? `nep-${i}` : null, niveau: p.niveau,
      niveau_gecheckt_op: p.niveau ? `${start}T10:00:00.000Z` : null, kvk: '00000000', adres: 'Proefstraat 1', email: `partner${i}@proef.voorbeeld`,
      logo_data: p.logo ? 'x' : null, iban: p.iban ? 'NL00PROE0000000000' : null, klant_bron: i % 2 ? 'framr' : 'oaklyn', quote_counter: p.offertes + 1,
    });
    const stap = (n, t) => plusDagen(start, Math.min(p.dagen - 1, 2 + n * 3 + t));
    for (let k = 0; k < p.klanten; k += 1) adapter.store.portal_customers.push({ id: `${id}-k${k}`, partner_id: id, naam: `Klant ${k + 1} (voorbeeld)`, plaats: PLAATSEN[k][0], created_at: `${stap(k, 0)}T09:00:00.000Z`, updated_at: `${stap(k, 0)}T09:00:00.000Z` });
    for (let k = 0; k < p.klussen; k += 1) adapter.store.portal_projects.push({ id: `${id}-p${k}`, company_id: companyId, partner_id: id, customer_id: `${id}-k0`, naam: `Klus ${k + 1}`, status: 'open', created_at: `${stap(k, 1)}T09:00:00.000Z`, updated_at: `${stap(k, 1)}T09:00:00.000Z` });
    for (let k = 0; k < p.inmetingen; k += 1) adapter.store.portal_measurements.push({ id: `${id}-i${k}`, company_id: companyId, partner_id: id, project_id: `${id}-p0`, gemeten_op: stap(k, 2), totaal_m2: 45 + k * 20, created_at: `${stap(k, 2)}T09:00:00.000Z`, updated_at: `${stap(k, 2)}T09:00:00.000Z` });
    for (let k = 0; k < p.calculaties; k += 1) adapter.store.portal_calculations.push({ id: `${id}-c${k}`, company_id: companyId, partner_id: id, project_id: `${id}-p0`, naam: `Calculatie ${k + 1}`, oppervlak_m2: 50 + k * 10, created_at: `${stap(k, 3)}T09:00:00.000Z`, updated_at: `${stap(k, 3)}T09:00:00.000Z` });
    for (let k = 0; k < p.offertes; k += 1) {
      const gewonnen = k < p.gewonnen;
      adapter.store.portal_quotes.push({ id: `${id}-o${k}`, company_id: companyId, partner_id: id, customer_id: `${id}-k0`, nummer: `OFF-${k + 1}`, status: gewonnen ? 'gewonnen' : 'verstuurd', totaal: 1800 + k * 400, verstuurd_op: `${stap(k, 4)}T09:00:00.000Z`, beslist_op: gewonnen ? `${stap(k, 5)}T09:00:00.000Z` : null, created_at: `${stap(k, 4)}T09:00:00.000Z`, updated_at: `${stap(k, 5)}T09:00:00.000Z` });
    }
    for (let k = 0; k < p.facturen; k += 1) adapter.store.portal_invoices.push({ id: `${id}-f${k}`, company_id: companyId, partner_id: id, soort: 'factuur', nummer: `FAC-${k + 1}`, status: 'verstuurd', factuurdatum: stap(k, 6), totaal: 2100 + k * 300, created_at: `${stap(k, 6)}T09:00:00.000Z`, updated_at: `${stap(k, 6)}T09:00:00.000Z` });
    for (let k = 0; k < p.orders; k += 1) adapter.store.portal_orders.push({ id: `${id}-b${k}`, company_id: companyId, partner_id: id, order_nummer: `1${i}0${k}`, bedrag_ex: 900 + k * 250, status: 'betaald', besteld_op: `${plusDagen(laatste, -k * 12)}T09:00:00.000Z`, created_at: `${plusDagen(laatste, -k * 12)}T09:00:00.000Z` });
  }

  /* Twee verbeterbesluiten uit de weekreview (aanvulling onderdeel 8): een aangenomen besluit dat
     vandaag geevalueerd moet worden, en een AI-voorstel dat op een mens wacht. */
  const { bewaarVerbeterbesluit } = await import('./dashboard-data.mjs?v=5dd6073');
  await bewaarVerbeterbesluit(adapter, {
    companyId, probleem: 'demo zonder een eigen klus van de partner loopt vaker dood', wijziging: 'geen demo meer plannen zonder een concrete klus of inmeting',
    gegevens: { bron: `funnel demo naar account, ${plusDagen(vandaag, -30)} tot ${vandaag}`, onzeker: 'kleine aantallen, elf demos' },
    verantwoordelijkeId: myron.id, ingangsdatum: plusDagen(vandaag, -14), evaluatiedatum: vandaag, doorPersonId: jelle.id,
  });
  await bewaarVerbeterbesluit(adapter, {
    companyId, probleem: 'de nabeltaak na een WhatsApp komt gemiddeld vier dagen na het bericht', wijziging: 'de reeks informatie verstuurd op twee werkdagen zetten',
    gegevens: { bron: 'opvolgreeks informatie_verstuurd_geen_reactie, stap 1', onzeker: 'niet gecorrigeerd voor weekenden' }, herkomst: 'ai', doorPersonId: null,
  });

  /* Een wijziging in de werkwijze die nog gemeld moet worden, en een kleine die niets meldt
     (aanvulling onderdeel 6), zodat de meldingbalk op Vandaag te zien is. */
  const { bewaarWerkwijze } = await import('./sales-werkwijzen.mjs?v=5dd6073');
  await bewaarWerkwijze(adapter, {
    companyId, soort: 'script', ref: 'opvolging_na_informatie', inhoud: {}, watVeranderd: 'de opvolging na verstuurde informatie begint nu met zijn eigen klus in plaats van met de pagina',
    waarom: 'uit de weekreview: gesprekken over een echte klus leiden vaker tot een demo', watAnders: 'vraag eerst of er een project speelt, pas daarna of hij de pagina zag',
    voorStappen: ['opvolging_na_informatie'], soortWijziging: 'inhoudelijk', geldigVanaf: plusDagen(vandaag, -1), doorPersonId: jelle.id,
  });
  await bewaarWerkwijze(adapter, {
    companyId, soort: 'template', ref: 'whatsapp_landingspagina@v1', inhoud: {}, watVeranderd: 'spelfout in de groet',
    soortWijziging: 'klein', geldigVanaf: plusDagen(vandaag, -1), doorPersonId: jelle.id,
  });

  /* Service (aanvulling onderdeel 3): van de partners met bestellingen is de laatste bestelling bij de
     eerste twee bevestigd geleverd (een door de winkel, een met de hand), zodat er servicetaken in de bak
     Service staan; bij de eerste is het servicegesprek al gevoerd, met een probleem voor Jelle. */
  const partnerOpId = new Map(adapter.store.portal_partners.map((p) => [p.id, p]));
  const eindfaseIds = new Set(adapter.store.pipeline_fases.filter((f) => f.is_eindfase).map((f) => f.id));
  /* Elke partner die aan een levende lead hangt heeft minstens een bestelling, anders is er niets te leveren. */
  for (const p of adapter.store.portal_partners) {
    const l = leadVoorPartner(adapter.store.sales_leads, p);
    if (!l || eindfaseIds.has(l.pipeline_fase_id) || adapter.store.portal_orders.some((o) => o.partner_id === p.id)) continue;
    adapter.store.portal_orders.push({ id: `${p.id}-b0`, company_id: companyId, partner_id: p.id, order_nummer: `9${adapter.store.portal_orders.length + 1}0`, bedrag_ex: 1150, status: 'betaald', besteld_op: `${plusDagen(vandaag, -6)}T09:00:00.000Z`, created_at: `${plusDagen(vandaag, -6)}T09:00:00.000Z` });
  }
  const geleverd = adapter.store.portal_orders.filter((o) => { const l = leadVoorPartner(adapter.store.sales_leads, partnerOpId.get(o.partner_id)); return o.company_id === companyId && l && !eindfaseIds.has(l.pipeline_fase_id); }).slice(0, 2);
  for (const [k, o] of geleverd.entries()) {
    const r = await bevestigLevering(adapter, { companyId, orderId: o.id, doorPersonId: myron.id, bron: k === 0 ? 'shopify' : 'handmatig', geleverdOp: `${plusDagen(vandaag, -3 - k)}T11:00:00.000Z`, vandaag: plusDagen(vandaag, -3 - k), nu: `${plusDagen(vandaag, -3 - k)}T11:05:00.000Z` });
    if (k === 0 && r.leadId) {
      await registreerGesprek(adapter, {
        companyId, leadId: r.leadId, doorPersonId: myron.id, stap: 'service', uitkomst: 'probleem_gemeld', vandaag: plusDagen(vandaag, -1), startedAt: `${plusDagen(vandaag, -1)}T10:15:00.000Z`, nu: `${plusDagen(vandaag, -1)}T10:30:00.000Z`,
        samenvatting: 'Geleverd zoals afgesproken, een pak met een beschadigde hoek. Project loopt goed, klant blij.', duurSeconden: 420,
        antwoorden: { levering_goed: 'ja, op tijd, een pak beschadigd', project_verlopen: 'goed, vloer ligt', klant_tevreden: 'ja', problemen_gehad: 'een pak met kapotte hoek', verbeterpunt: 'pakken beter beschermen op de pallet' },
        problemen: [{ omschrijving: 'een pak met een beschadigde hoek, twee planken onbruikbaar', soort: 'levering', verantwoordelijkeId: jelle.id, vervolgdatum: vandaag }],
        extras: [{ soort: 'persoonlijke_context', inhoud: 'gaat in oktober twee weken naar Spanje' }],
      });
    }
  }

  /* Twee demo's in de agenda: een vanmiddag telefonisch (op de werklijst van vandaag) en een over drie werkdagen online. */
  const demoKandidaten = leads.filter((l) => !l.klaar && ['goede_interesse', 'demo_aangeboden'].includes(laatsteUitkomst(l.id)));
  const demoVandaag = demoKandidaten.find((l) => l.beller === myron.id);
  const demoLater = demoKandidaten.find((l) => l !== demoVandaag);
  if (demoVandaag) { await planDemo(adapter, { companyId, leadId: demoVandaag.id, doorPersonId: myron.id, datum: vandaag, tijd: '15:00', vorm: 'telefonisch', doel: 'zijn project van 60 m2 doorrekenen', deelnemers: 'de eigenaar', vandaag, nu: `${plusDagen(vandaag, -2)}T10:00:00.000Z` }); demoVandaag.klaar = true; }
  if (demoLater) { await planDemo(adapter, { companyId, leadId: demoLater.id, doorPersonId: demoLater.beller || jelle.id, verantwoordelijkeId: demoLater.beller || jelle.id, datum: naarWerkdag(plusDagen(vandaag, 3)), tijd: '11:00', vorm: 'online', link: 'https://meet.voorbeeld/framr-demo', doel: 'de calculator op zijn eigen project', vandaag, nu: `${plusDagen(vandaag, -1)}T16:00:00.000Z` }); demoLater.klaar = true; }
  stempel(adapter, plusDagen(vandaag, -1), gezien);

  /* Een opname van vanochtend die nog administratief afgerond moet worden, met een echt bestandje in de
     opnamesmap zodat afspelen en koppelen te proberen zijn (de inhoud is geen audio, alleen bytes). */
  const losLead = leads.find((l) => l.beller === myron.id && !l.klaar && !adapter.store.interactions.some((i) => i.lead_id === l.id && dagVan(i.started_at) === vandaag));
  if (losLead && opnamesMap) {
    mkdirSync(opnamesMap, { recursive: true });
    const pad = join(opnamesMap, 'proef-opname-zonder-uitkomst.webm');
    writeFileSync(pad, Buffer.from('proefopname, geen echte audio'));
    const los = await maakLosContactmoment(adapter, { companyId, leadId: losLead.id, doorPersonId: myron.id, startedAt: `${vandaag}T07:45:00.000Z`, vandaag });
    await koppelOpname(adapter, { interactionId: los.interactionId, ref: `bestand:${pad}`, naam: 'proef-opname-zonder-uitkomst.webm', bytes: 29, mime: 'audio/webm', duurSeconden: 340, toestemming: true, nu: `${vandaag}T07:52:00.000Z` });
  }

  /* De lijst van vandaag voor Myron, en een gesprek van vanochtend dat er al op staat. */
  const data = {
    leads: await adapter.fetchLeads(), fasen: await adapter.fetchPipelineFases(), classificaties: await adapter.fetchLeadClassifications(),
    research: await adapter.fetchLeadResearch(), interacties: await adapter.fetchInteractions(), taken: await adapter.fetchTasks(), queue: await adapter.fetchSalesQueue(),
  };
  const selectie = kiesDagselectie({ ...data, bellerId: myron.id, vandaag, aantal: 10, companyId });
  await schrijfDagselectie(adapter, { companyId, selectie, bellerId: myron.id, vandaag });
  for (const q of adapter.store.sales_queue) q.berekend_op = `${vandaag}T07:30:00.000Z`;
  const eerste = selectie.find((s) => !s.bestaand);
  if (eerste) {
    await registreerGesprek(adapter, { companyId, leadId: eerste.lead.id, doorPersonId: myron.id, uitkomst: 'eerst_informatie', samenvatting: 'Kort gesproken, hij zit op een project. Wil de pagina zien.', vandaag, startedAt: `${vandaag}T08:40:00.000Z`, nu: `${vandaag}T08:45:00.000Z` });
    await registreerVerstuurd(adapter, { companyId, leadId: eerste.lead.id, doorPersonId: myron.id, kanaal: 'whatsapp', materiaal: 'landingspagina', templateRef: 'whatsapp_landingspagina@v1', tekst: 'Hoi, leuk je net gesproken te hebben. Hier de pagina: https://framr.one/p/vloeren', link: 'https://framr.one/p/vloeren', vandaag, startedAt: `${vandaag}T08:50:00.000Z`, nu: `${vandaag}T08:50:00.000Z` });
  }
  stempel(adapter, vandaag, gezien);
  return { leads: leads.length, bellers: { myron: myron.id, jelle: jelle.id }, demos: demos.length };
}
