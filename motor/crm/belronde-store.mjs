/*
  Jarvis - belronde-store: de dagelijkse belronde van Framr.One op het CRM-fundament.

  Het Client OS (migration 0060 en 0061, crm-store.mjs) kent leads, contactmomenten,
  discovery-antwoorden, bezwaren, kansen en taken. Deze module legt daar de werkdag van
  de beller overheen, zoals Jelle die op 15-09-2026 vroeg: meerdere bellers op een gedeelde
  database zonder dubbel werk, onbeperkt doorwerken vanuit Vandaag, elk gesprek met een
  vaste uitkomst en meerdere bezwaren, berichten met hun reactiestatus, instelbare
  opvolgreeksen, demo's met datum en tijd, opnames gekoppeld aan het gesprek, en overal
  dezelfde volgende actie.

  Wat hier staat is generiek per context (company_id) en per pipeline. De pipeline
  'framr' met de twintig hoofdstatussen van Jelle is de eerste vulling; de leads zelf
  staan onder de context die ze geoogst heeft (voor de vloerenleggers is dat oaklyn).

  De regels in een oogopslag:
    - Een uitkomst is een vaste keuze uit BELUITKOMSTEN (sales_veldopties, veld uitkomst).
    - Elke uitkomst zet de lead in de bijbehorende fase (UITKOMST_REGELS) en maakt de
      volgende taak; die komt uit de opvolgreeks van de aanleiding (sales_opvolgreeksen,
      met STANDAARD_OPVOLGREEKSEN als vulling) of uit de regel zelf. Een concreet
      afgesproken datum gaat altijd voor de reeks.
    - Een lead krijgt nooit twee identieke open taken; een nieuwe afspraak vervangt de oude
      taak (resultaat vervangen), de historie blijft staan. Taken gaan dicht met een resultaat.
    - Een ontvangen reactie sluit de geen-reactie-opvolging; niet meer benaderen sluit alles.
    - Wie een lead opent voor een benaderactie claimt hem aan de serverkant; een collega
      krijgt die lead niet als volgende. De claim verloopt na CLAIM_MINUTEN zonder hartslag.
    - Dubbel vastleggen (dubbelklik, herladen, opnieuw) geeft het bestaande contactmoment
      terug: het scherm stuurt een verzoek_id mee.
    - De twintig hoofdstatussen blijven de opgeslagen fase; de commerciele fase, de
      trajectstatus en de reactiestatus zijn afgeleiden (splitsUitkomst, commercieleFase,
      trajectstatus, reactieStatus), zodat de historie niets verliest.
    - Bellen zonder opt-in mag alleen bij een rechtspersoon (bv). Is de rechtsvorm
      onbekend, dan staat de lead wel op de lijst maar met een waarschuwing: eerst KvK
      kijken. Dat oordeel blijft bij de beller.
    - Deze module schrijft nooit zelf berichten; mailen en appen doet de mens, en legt het
      daarna vast (approve-first-regel).

  Stijl: blokcommentaar, geen lange streepjes en geen emoji, conform de projectafspraken.
*/

import { recordInteraction, recordObjection, recordDiscoveryAnswer, recordOpportunity, recordQuestion, setLeadFase, recordLead, recordLeadPerson, findExistingLead, normalizeLeadName, normalizeDomein, assertOptieToegestaan } from './crm-store.mjs?v=5dd6073';
import { recordPerson } from '../review/people-store.mjs?v=5dd6073';
import { SCRIPTS, VORIGE_SCRIPTS, SOPS, sopVoor, GESPREK_SCRIPT, STAPPEN, kiesStap, scriptRef, scriptVoorRef, BERICHT_TEMPLATES, templateVoor } from './sales-scripts.mjs?v=5dd6073';

export { SCRIPTS, VORIGE_SCRIPTS, SOPS, sopVoor, GESPREK_SCRIPT, STAPPEN, kiesStap, scriptRef, scriptVoorRef, BERICHT_TEMPLATES, templateVoor };

/* De pipeline van Framr.One: de twintig hoofdstatussen van Jelle (15-09-2026), in volgorde. */
export const FRAMR_PIPELINE = 'framr';
export const FRAMR_FASEN = [
  [1, 'nieuwe_lead', false],
  [2, 'te_bellen', false],
  [3, 'eerste_poging', false],
  [4, 'niet_bereikt', false],
  [5, 'gesproken', false],
  [6, 'gekwalificeerd', false],
  [7, 'informatie_verstuurd', false],
  [8, 'follow_up_nodig', false],
  [9, 'demo_gepland', false],
  [10, 'demo_afgerond', false],
  [11, 'account_aangeboden', false],
  [12, 'account_aangemaakt', false],
  [13, 'onboarding', false],
  [14, 'eerste_project', false],
  [15, 'eerste_bestelling', false],
  [16, 'actieve_partner', false],
  [17, 'slapende_partner', false],
  [18, 'later_benaderen', false],
  [19, 'verloren', true],
  [20, 'niet_meer_benaderen', true],
];

/* Wat een servicegesprek als uitkomst kan hebben: de contactuitkomsten plus de service-eigen. */
export const SERVICE_UITKOMSTEN = ['niet_opgenomen', 'voicemail', 'verkeerd_nummer', 'later_terugbellen', 'tevreden', 'probleem_gemeld', 'volgend_project_besproken', 'niet_meer_benaderen'];
export const PROBLEEM_SOORTEN = ['product', 'levering', 'verwerking', 'anders'];

export const EINDFASEN = new Set(['verloren', 'niet_meer_benaderen']);

/*
  De commerciele fase als afgeleide van de hoofdstatus (Jelle 15-09-2026, onderdeel 13): een
  handvol stappen die zeggen waar een bedrijf commercieel staat, zonder de contactuitkomsten en
  taken die in de twintig meelopen. De trajectstatus (actief, gepauzeerd, verloren) staat ernaast.
*/
export const COMMERCIELE_FASEN = ['nieuw', 'in_gesprek', 'gekwalificeerd', 'demo', 'onboarding', 'actieve_partner'];
const COMMERCIEEL = {
  nieuwe_lead: 'nieuw', te_bellen: 'nieuw', eerste_poging: 'nieuw', niet_bereikt: 'nieuw', later_benaderen: 'nieuw',
  gesproken: 'in_gesprek', informatie_verstuurd: 'in_gesprek', follow_up_nodig: 'in_gesprek',
  gekwalificeerd: 'gekwalificeerd',
  demo_gepland: 'demo', demo_afgerond: 'demo', account_aangeboden: 'demo',
  account_aangemaakt: 'onboarding', onboarding: 'onboarding', eerste_project: 'onboarding',
  eerste_bestelling: 'actieve_partner', actieve_partner: 'actieve_partner', slapende_partner: 'actieve_partner',
  verloren: null, niet_meer_benaderen: null,
};
export function commercieleFase(faseNaam) {
  if (!faseNaam) return 'nieuw';
  return COMMERCIEEL[faseNaam] === undefined ? 'nieuw' : COMMERCIEEL[faseNaam];
}
export function trajectstatus({ faseNaam, gepauzeerdTot, vandaag } = {}) {
  if (EINDFASEN.has(faseNaam)) return { status: 'verloren', tot: null };
  if (gepauzeerdTot && vandaag && dagVan(gepauzeerdTot) > vandaag) return { status: 'gepauzeerd', tot: dagVan(gepauzeerdTot) };
  if (['later_benaderen', 'slapende_partner'].includes(faseNaam)) return { status: 'gepauzeerd', tot: gepauzeerdTot ? dagVan(gepauzeerdTot) : null };
  return { status: 'actief', tot: null };
}

/* De fasen waarin een lead niet meer op de dagselectie hoort: de eindfasen, wat al een
   eigen afspraak of eigen taak heeft, en wat bewust geparkeerd is. */
export const FASEN_BUITEN_DAGSELECTIE = new Set([
  'demo_gepland', 'demo_afgerond', 'account_aangeboden', 'account_aangemaakt', 'onboarding',
  'eerste_project', 'eerste_bestelling', 'actieve_partner', 'slapende_partner',
  'later_benaderen', 'verloren', 'niet_meer_benaderen',
]);

/* De vaste beluitkomsten (Jelle 15-09-2026, vijftien) plus de twee die geen interesse
   splitsen in tijdelijk geen behoefte en geen passende match (15-09-2026, onderdeel 13).
   geen_interesse blijft geldig voor de historie. Namen zonder spaties, zodat ze als
   argument door de terminal kunnen en telbaar blijven. */
export const BELUITKOMSTEN = [
  'niet_opgenomen', 'voicemail', 'verkeerd_nummer', 'bedrijf_gestopt', 'later_terugbellen',
  'geen_tijd', 'geen_interesse', 'nu_geen_behoefte', 'geen_match', 'eerst_informatie', 'mogelijk_interesse', 'goede_interesse',
  'demo_aangeboden', 'demo_geweigerd', 'demo_ingepland', 'account_gewenst', 'niet_meer_benaderen',
];

/* Uitkomsten waarbij de juiste persoon niet aan de lijn was. */
export const NIET_BEREIKT = new Set(['niet_opgenomen', 'voicemail', 'verkeerd_nummer']);

/* Na zoveel pogingen zonder gehoor gaat een lead naar later_benaderen, met een taak over
   dertig dagen; anders blijft hij elke dag de lijst vullen zonder dat er iets gebeurt. */
export const MAX_POGINGEN = 4;

/* Een claim op een lead verloopt na zoveel minuten zonder hartslag. */
export const CLAIM_MINUTEN = 30;

/*
  Per uitkomst: de fase erna ('poging' is de belpoging-teller), of er een opvolging
  hoort (warm: verplicht, met datum), de opvolgreeks (sales_opvolgreeksen.aanleiding) die
  de volgende taak bepaalt, en de standaard uit de regel als die reeks er niet is.
  null bij fase betekent: de fase blijft staan. pauzeer zet gepauzeerd_tot op de lead.
*/
export const UITKOMST_REGELS = {
  niet_opgenomen: { fase: 'poging', bereikt: false, warm: false, reeks: 'niet_opgenomen', opvolg: { dagen: 1, taak: 'call', reden: 'nieuwe belpoging' } },
  voicemail: { fase: 'poging', bereikt: false, warm: false, reeks: 'voicemail', opvolg: { dagen: 2, taak: 'call', reden: 'voicemail ingesproken, opnieuw proberen' } },
  verkeerd_nummer: { fase: null, bereikt: false, warm: false, opvolg: { dagen: 1, taak: null, reden: 'telefoonnummer controleren (website, KvK)' } },
  bedrijf_gestopt: { fase: 'verloren', bereikt: true, warm: false, opvolg: null },
  later_terugbellen: { fase: 'follow_up_nodig', bereikt: true, warm: true, opvolg: { dagen: 2, taak: 'call', reden: 'terugbellen op verzoek' } },
  geen_tijd: { fase: 'follow_up_nodig', bereikt: true, warm: true, reeks: 'geen_tijd', opvolg: { dagen: 3, taak: 'call', reden: 'had geen tijd, opnieuw bellen' } },
  geen_interesse: { fase: 'verloren', bereikt: true, warm: false, opvolg: null, oud: true },
  nu_geen_behoefte: { fase: 'later_benaderen', bereikt: true, warm: false, reeks: 'nu_geen_project', pauzeer: true, opvolg: { dagen: 60, taak: 'call', reden: 'nu geen behoefte, later opnieuw peilen' } },
  geen_match: { fase: 'verloren', bereikt: true, warm: false, opvolg: null },
  eerst_informatie: { fase: 'gesproken', bereikt: true, warm: true, opvolg: { dagen: 0, taak: 'whatsapp', reden: 'informatie sturen (landingspagina)' } },
  mogelijk_interesse: { fase: 'gesproken', bereikt: true, warm: true, opvolg: { dagen: 3, taak: 'call', reden: 'mogelijk interesse, opvolgen' } },
  goede_interesse: { fase: 'gekwalificeerd', bereikt: true, warm: true, opvolg: { dagen: 2, taak: 'call', reden: 'goede interesse, demo of proefproject afspreken' } },
  demo_aangeboden: { fase: 'gekwalificeerd', bereikt: true, warm: true, reeks: 'demo_aangeboden_niet_gepland', opvolg: { dagen: 2, taak: 'call', reden: 'demo aangeboden, datum vastzetten' } },
  demo_geweigerd: { fase: 'follow_up_nodig', bereikt: true, warm: true, opvolg: { dagen: 14, taak: 'call', reden: 'demo geweigerd, later opnieuw peilen' } },
  demo_ingepland: { fase: 'demo_gepland', bereikt: true, warm: true, opvolg: null, demoVerplicht: true },
  account_gewenst: { fase: 'account_aangeboden', bereikt: true, warm: true, opvolg: { dagen: 0, taak: 'onboarding', reden: 'accountlink sturen en helpen inrichten' } },
  /* De uitkomsten van een servicegesprek (stap service, aanvulling onderdeel 3): raken de
     verkoopfase nooit (fase null). Een probleem maakt zijn eigen taken via problemen. */
  tevreden: { fase: null, bereikt: true, warm: false, service: true, opvolg: { dagen: 60, taak: 'service', reden: 'relatie onderhouden: even horen hoe het gaat', contactreden: 'relatie_onderhouden' } },
  probleem_gemeld: { fase: null, bereikt: true, warm: false, service: true, opvolg: null },
  volgend_project_besproken: { fase: null, bereikt: true, warm: false, service: true, opvolg: { dagen: 14, taak: 'call', reden: 'volgend project bespreken', contactreden: 'volgend_project_bespreken' } },
  niet_meer_benaderen: { fase: 'niet_meer_benaderen', bereikt: true, warm: false, opvolg: null },
};

/*
  De uitkomst gesplitst in contactuitkomst (wat er aan de lijn gebeurde) en gespreksresultaat
  (wat het gesprek opleverde), zoals Jelle het in onderdeel 13 wil. De opgeslagen uitkomst
  blijft een waarde; dit is de leesbril voor de rapportages en de tijdlijn.
*/
export const CONTACTUITKOMSTEN = ['niet_opgenomen', 'voicemail', 'verkeerd_nummer', 'gesprek_gevoerd', 'terugbelverzoek'];
export const GESPREKSRESULTATEN = ['informatie_gevraagd', 'interesse', 'demo_afgesproken', 'account_gewenst', 'nu_geen_behoefte', 'geen_match', 'geen_contact_meer', 'bedrijf_gestopt', 'geen_tijd'];
const SPLITSING = {
  niet_opgenomen: ['niet_opgenomen', null], voicemail: ['voicemail', null], verkeerd_nummer: ['verkeerd_nummer', null],
  bedrijf_gestopt: ['gesprek_gevoerd', 'bedrijf_gestopt'], later_terugbellen: ['terugbelverzoek', null], geen_tijd: ['gesprek_gevoerd', 'geen_tijd'],
  geen_interesse: ['gesprek_gevoerd', 'geen_match'], nu_geen_behoefte: ['gesprek_gevoerd', 'nu_geen_behoefte'], geen_match: ['gesprek_gevoerd', 'geen_match'],
  eerst_informatie: ['gesprek_gevoerd', 'informatie_gevraagd'], mogelijk_interesse: ['gesprek_gevoerd', 'interesse'], goede_interesse: ['gesprek_gevoerd', 'interesse'],
  demo_aangeboden: ['gesprek_gevoerd', 'interesse'], demo_geweigerd: ['gesprek_gevoerd', 'interesse'], demo_ingepland: ['gesprek_gevoerd', 'demo_afgesproken'],
  account_gewenst: ['gesprek_gevoerd', 'account_gewenst'], niet_meer_benaderen: ['gesprek_gevoerd', 'geen_contact_meer'],
};
export function splitsUitkomst(uitkomst) {
  const s = SPLITSING[uitkomst];
  if (!s) return { contact: uitkomst ? 'gesprek_gevoerd' : null, resultaat: null, bereikt: Boolean(uitkomst && !NIET_BEREIKT.has(uitkomst)) };
  return { contact: s[0], resultaat: s[1], bereikt: !NIET_BEREIKT.has(uitkomst) };
}
/* Een inhoudelijk gesprek: bereikt, en niet alleen een terugbelverzoek of een gestopt bedrijf. */
export function isInhoudelijk(uitkomst) {
  return Boolean(uitkomst) && !NIET_BEREIKT.has(uitkomst) && !['later_terugbellen', 'bedrijf_gestopt', 'geen_tijd'].includes(uitkomst);
}

export const TAAKRESULTATEN = ['gedaan', 'geen_reactie', 'reactie_ontvangen', 'verplaatst', 'vervallen', 'vervangen', 'niet_bereikt', 'bereikt'];
export const BEZWAAR_RESULTATEN = ['ja', 'gedeeltelijk', 'nee', 'onbekend'];
export const BEZWAAR_SOORTEN = ['tijdelijk', 'definitief'];
export const EXTRA_SOORTEN = ['vraag', 'inzicht', 'productwens', 'persoonlijke_context', 'afspraak', 'notitie'];

/*
  De reden voor contact (aanvulling van Jelle, 15-09-2026, onderdeel 2): waarom zoeken we
  contact, als vaste keuze naast de vrije tekst in tasks.reden. Kanaal (task_type, type),
  resultaat (uitkomst, resultaat) en volgende actie (volgende_stap, de vervolgtaak) staan er
  los van. Dezelfde lijst als de check in migration 0109; de reden staat groot bij het openen
  van een taak en de werkbakken op Vandaag groeperen erop.
*/
export const CONTACTREDENEN = [
  'eerste_kennismaking', 'terugbellen_op_verzoek', 'informatie_sturen', 'opvolgen_na_informatie',
  'demo_plannen', 'demo_uitvoeren', 'demo_opvolgen', 'helpen_bij_eerste_project',
  'bestelling_geleverd', 'probleem_oplossen', 'relatie_onderhouden', 'volgend_project_bespreken',
  'beoordelen', 'later_opnieuw_peilen',
];
const REDEN_PER_STAP = { eerste_contact: 'eerste_kennismaking', opvolging_na_informatie: 'opvolgen_na_informatie', demo: 'demo_uitvoeren', opvolging_na_demo: 'demo_opvolgen', onboarding: 'helpen_bij_eerste_project', heractivatie: 'relatie_onderhouden', service: 'bestelling_geleverd' };
const REDEN_PER_REEKS = { informatie_verstuurd_geen_reactie: 'opvolgen_na_informatie', geen_tijd: 'terugbellen_op_verzoek', nu_geen_project: 'later_opnieuw_peilen', demo_aangeboden_niet_gepland: 'demo_plannen', demo_uitgevoerd: 'demo_opvolgen', niet_verschenen_bij_demo: 'demo_plannen', account_aangemaakt_niet_gestart: 'helpen_bij_eerste_project', partner_inactief: 'relatie_onderhouden' };
const REDEN_PER_TAAKTYPE = { demo: 'demo_uitvoeren', onboarding: 'helpen_bij_eerste_project', check_in: 'beoordelen', whatsapp: 'informatie_sturen', email: 'informatie_sturen', service: 'bestelling_geleverd' };

/* De contactreden van een taak: opgegeven, anders uit de reeks, de vrije tekst, het taaktype of
   de stap. Zo krijgen ook taken van voor migration 0109 een reden. */
export function contactredenVoor({ taak = 'call', reeks = null, reden = '', stap = null, contactreden = null } = {}) {
  if (contactreden && CONTACTREDENEN.includes(contactreden)) return contactreden;
  if (reeks && REDEN_PER_REEKS[reeks]) return REDEN_PER_REEKS[reeks];
  const t = taak || 'call';
  const tekst = String(reden || '').toLowerCase();
  if (/terugbel/.test(tekst)) return 'terugbellen_op_verzoek';
  if (/probleem/.test(tekst)) return 'probleem_oplossen';
  if (/geleverd|levering/.test(tekst)) return 'bestelling_geleverd';
  if (/eerste project|account/.test(tekst)) return 'helpen_bij_eerste_project';
  if (/demo/.test(tekst) && t !== 'demo') return /opvolg|na de demo|nabellen/.test(tekst) ? 'demo_opvolgen' : 'demo_plannen';
  if (/project/.test(tekst)) return 'volgend_project_bespreken';
  if (/opnieuw peilen/.test(tekst)) return 'later_opnieuw_peilen';
  if (['whatsapp', 'email'].includes(t)) return 'informatie_sturen';
  if (/reactie|informatie|opvolgen/.test(tekst) && t === 'call') return 'opvolgen_na_informatie';
  if (REDEN_PER_TAAKTYPE[t]) return REDEN_PER_TAAKTYPE[t];
  if (stap && REDEN_PER_STAP[stap]) return REDEN_PER_STAP[stap];
  return t === 'call' ? 'eerste_kennismaking' : null;
}

/* De reden van de vervolgtaak na een uitkomst; een herhaalpoging houdt de reden van het gesprek. */
export function contactredenNaUitkomst(uitkomst, redenVanGesprek = 'eerste_kennismaking') {
  const per = {
    niet_opgenomen: redenVanGesprek, voicemail: redenVanGesprek, verkeerd_nummer: redenVanGesprek,
    later_terugbellen: 'terugbellen_op_verzoek', geen_tijd: 'terugbellen_op_verzoek',
    nu_geen_behoefte: 'later_opnieuw_peilen', demo_geweigerd: 'later_opnieuw_peilen',
    eerst_informatie: 'informatie_sturen', mogelijk_interesse: 'opvolgen_na_informatie', goede_interesse: 'demo_plannen',
    demo_aangeboden: 'demo_plannen', demo_afgesproken: 'demo_uitvoeren', account_gewenst: 'helpen_bij_eerste_project',
  };
  return per[uitkomst] || null;
}
export const contactredenVanStap = (stap) => REDEN_PER_STAP[stap] || null;

/*
  Waar het eerste gesprek strandde, in de volgorde van het belscript van Myron. Jelle, 20-09-2026:
  het doel van dat gesprek is een demo, dus we willen niet alleen weten DAT iemand afviel maar ook
  WAAR. Valt het op de belofte, dan is de opening het probleem; valt het pas bij het plannen, dan
  is het demovoorstel het probleem.
*/
export const AFHAAKMOMENTEN = [
  'voor_opening', 'op_de_belofte', 'bij_de_vraag', 'tijdens_de_vragen',
  'bij_samenvatten', 'bij_het_demovoorstel', 'bij_dag_en_tijd', 'niet_afgehaakt',
];
export const AFHAAKMOMENT_UITLEG = {
  voor_opening: 'hij kapte af voordat de opening eruit was',
  op_de_belofte: 'op de zes euro per vierkante meter',
  bij_de_vraag: 'bij de vraag of dat interessant klinkt',
  tijdens_de_vragen: 'tijdens de onderzoeksvragen',
  bij_samenvatten: 'bij het samenvatten',
  bij_het_demovoorstel: 'bij het voorstel om een kwartiertje te laten zien',
  bij_dag_en_tijd: 'bij het plannen van dag en tijd',
  niet_afgehaakt: 'niet afgehaakt, de demo staat',
};

/* Het spiegelbeeld: waar hij juist naar voren leunde. Meerdere per gesprek. */
export const AANSLAGPUNTEN = [
  'marge_op_materiaal', 'sneller_offreren', 'offerte_zelfde_dag',
  'alles_in_een_systeem', 'bestellen_en_levering', 'nergens_op',
];
export const AANSLAGPUNT_UITLEG = {
  marge_op_materiaal: 'de marge op materiaal, de zes euro',
  sneller_offreren: 'sneller inmeten, calculeren en offreren',
  offerte_zelfde_dag: 'de offerte dezelfde dag bij de klant',
  alles_in_een_systeem: 'alles in een systeem in plaats van Excel, WhatsApp en papier',
  bestellen_en_levering: 'bestellen en levering',
  nergens_op: 'nergens op',
};

/* De zestien mijlpalen van de onboarding; het portaal houdt ze zelf bij, het gesprek vinkt af
   wat de partner zelf zegt dat er staat. */
export const ONBOARDING_MIJLPALEN = [
  'account_aangemaakt', 'vrijgegeven', 'klant_in_de_winkel', 'niveau_gekozen',
  'bedrijfsprofiel_ingevuld', 'logo_toegevoegd', 'bankgegevens', 'eerste_klant',
  'eerste_klus', 'eerste_inmeting', 'eerste_calculatie', 'eerste_offerte',
  'eerste_offerte_verstuurd', 'eerste_akkoord', 'eerste_factuur', 'eerste_bestelling',
];

/* De vijf werkbakken van Vandaag (aanvulling onderdeel 4), in vaste volgorde. */
export const WERKBAKKEN = [
  { bak: 'nieuwe_leads', titel: 'Nieuwe leads' }, { bak: 'opvolging', titel: 'Opvolging' }, { bak: 'demos', titel: "Demo's" },
  { bak: 'onboarding', titel: 'Onboarding' }, { bak: 'service', titel: 'Service' },
];
export const bakVoor = (soort, taakType) => (taakType === 'demo' || soort === 'afspraak' ? 'demos' : (taakType === 'onboarding' ? 'onboarding' : (taakType === 'service' || soort === 'service' ? 'service' : (['nieuw', 'herhaalpoging'].includes(soort) ? 'nieuwe_leads' : 'opvolging'))));
export const AFSPRAAK_STATUSSEN = ['gepland', 'verplaatst', 'geannuleerd', 'niet_verschenen', 'uitgevoerd'];
export const VERZEND_STATUSSEN = ['concept', 'verstuurd', 'bevestigd', 'mislukt'];

/*
  De standaard opvolgreeksen (Jelle 15-09-2026, onderdeel 10): per aanleiding wat er gebeurt
  als iemand niet reageert. De intervallen zijn een illustratie en instelbaar; ze komen als
  seed in sales_opvolgreeksen en zijn daarna in het dashboard aan te passen. Een stap is een
  taak; actie beoordelen is een controletaak (check_in) om te pauzeren of te stoppen.
  Per stap: volgnummer, wachtdagen, dagsoort (werkdagen of kalenderdagen), vanaf
  (vorige_stap: de wachttijd telt vanaf het moment dat de vorige stap gedaan is), actie
  (call, whatsapp, email, beoordelen), template, uitvoerder (eigenaar of beller), voorwaarde
  (geen_reactie), stop (wat de reeks beeindigt) en de reden op de taak.
*/
const stap = (volgnummer, wachtdagen, actie, reden, extra = {}) => ({
  volgnummer, wachtdagen, dagsoort: 'werkdagen', vanaf: 'vorige_stap', actie, template: null, uitvoerder: 'beller',
  voorwaarde: 'geen_reactie', stop: ['reactie_ontvangen', 'niet_meer_benaderen'], reden, ...extra,
});
export const STANDAARD_OPVOLGREEKSEN = [
  { aanleiding: 'niet_opgenomen', naam: 'Niet opgenomen', maxPogingen: MAX_POGINGEN, stappen: [
    stap(1, 1, 'call', 'nieuwe belpoging'), stap(2, 2, 'call', 'opnieuw proberen, ander dagdeel'), stap(3, 3, 'call', 'opnieuw proberen'),
  ] },
  { aanleiding: 'voicemail', naam: 'Voicemail ingesproken', maxPogingen: MAX_POGINGEN, stappen: [
    stap(1, 2, 'call', 'voicemail ingesproken, opnieuw proberen'), stap(2, 3, 'whatsapp', 'kort bericht na de voicemail', { template: 'whatsapp_landingspagina@v1' }), stap(3, 5, 'call', 'opnieuw proberen na het bericht'),
  ] },
  { aanleiding: 'informatie_verstuurd_geen_reactie', naam: 'Informatie gestuurd, geen reactie', maxPogingen: 3, stappen: [
    stap(1, 3, 'call', 'geen reactie op de informatie, nabellen'), stap(2, 5, 'call', 'opnieuw proberen na de informatie'), stap(3, 10, 'call', 'laatste poging na de informatie'),
    stap(4, 1, 'beoordelen', 'beoordelen: pauzeren of stoppen'),
  ] },
  { aanleiding: 'geen_tijd', naam: 'Geen tijd', maxPogingen: 2, stappen: [
    stap(1, 3, 'call', 'had geen tijd, opnieuw bellen'), stap(2, 7, 'call', 'opnieuw proberen op een rustiger moment'), stap(3, 1, 'beoordelen', 'beoordelen: pauzeren of stoppen'),
  ] },
  { aanleiding: 'nu_geen_project', naam: 'Nu geen project', maxPogingen: 2, stappen: [
    stap(1, 60, 'call', 'nu geen behoefte, later opnieuw peilen', { dagsoort: 'kalenderdagen' }), stap(2, 90, 'call', 'opnieuw peilen', { dagsoort: 'kalenderdagen' }), stap(3, 1, 'beoordelen', 'beoordelen: pauzeren of stoppen'),
  ] },
  { aanleiding: 'demo_aangeboden_niet_gepland', naam: 'Demo aangeboden, nog niet gepland', maxPogingen: 3, stappen: [
    stap(1, 2, 'call', 'demo aangeboden, datum vastzetten'), stap(2, 5, 'whatsapp', 'demovoorstel sturen met twee tijden', { template: 'whatsapp_demo_uitnodiging@v1' }), stap(3, 7, 'call', 'demo alsnog plannen'),
    stap(4, 1, 'beoordelen', 'beoordelen: pauzeren of stoppen'),
  ] },
  { aanleiding: 'demo_uitgevoerd', naam: 'Demo uitgevoerd', maxPogingen: 3, stappen: [
    stap(1, 1, 'whatsapp', 'na de demo: afspraken bevestigen', { template: 'whatsapp_na_demo@v1' }), stap(2, 2, 'call', 'na de demo opvolgen'), stap(3, 7, 'call', 'na de demo opnieuw opvolgen'),
    stap(4, 1, 'beoordelen', 'beoordelen: pauzeren of stoppen'),
  ] },
  { aanleiding: 'niet_verschenen_bij_demo', naam: 'Niet verschenen bij de demo', maxPogingen: 2, stappen: [
    stap(1, 0, 'whatsapp', 'niet verschenen: nieuw moment voorstellen'), stap(2, 2, 'call', 'demo opnieuw plannen'), stap(3, 1, 'beoordelen', 'beoordelen: pauzeren of stoppen'),
  ] },
  { aanleiding: 'account_aangemaakt_niet_gestart', naam: 'Account aangemaakt, nog niet gestart', maxPogingen: 3, stappen: [
    stap(1, 3, 'call', 'account aangemaakt, eerste project begeleiden'), stap(2, 7, 'whatsapp', 'even checken of het lukt', { template: 'whatsapp_accountlink@v1' }), stap(3, 14, 'call', 'eerste project alsnog inplannen'),
    stap(4, 1, 'beoordelen', 'beoordelen: pauzeren of stoppen'),
  ] },
  { aanleiding: 'partner_inactief', naam: 'Partner langere tijd inactief', maxPogingen: 2, stappen: [
    stap(1, 0, 'call', 'partner stil: even checken'), stap(2, 14, 'whatsapp', 'even checken per bericht', { template: 'whatsapp_heractivatie@v1' }), stap(3, 1, 'beoordelen', 'beoordelen: pauzeren of stoppen'),
  ] },
];
/* De reeksen die stoppen zodra er een reactie binnenkomt. */
export const GEEN_REACTIE_REEKSEN = new Set(STANDAARD_OPVOLGREEKSEN.map((r) => r.aanleiding));

/* De extra waardelijsten die de belronde nodig heeft, als seed per bedrijf. De
   bezwaarcategorieen breiden de lijst uit 0060 uit met wat Jelle op 15-09-2026 noemde. */
export const FRAMR_VELDOPTIES = [
  ['uitkomst', BELUITKOMSTEN],
  /* De uitkomsten van een servicegesprek (stap service), naast de beluitkomsten. */
  ['uitkomst', ['tevreden', 'probleem_gemeld', 'volgend_project_besproken']],
  ['opvolg_actie', ['opnieuw_bellen', 'whatsapp_sturen', 'email_sturen', 'landingspagina_sturen',
    'demo_video_sturen', 'prijsvoorbeeld_sturen', 'demo_inplannen', 'demo_bevestigen',
    'demo_opnieuw_plannen', 'account_helpen_instellen', 'eerste_project_begeleiden',
    'stalenboek_versturen', 'eerste_bestelling_bespreken', 'tevredenheid_na_bestelling',
    'na_30_dagen_spreken']],
  ['materiaal', ['landingspagina', 'demo_video', 'margecalculator', 'prijsvoorbeeld',
    'productcatalogus', 'stalenboekinformatie', 'accountlink', 'demo_uitnodiging',
    'afspraakbevestiging', 'handleiding', 'persoonlijk_bericht']],
  ['demo_vorm', ['online', 'telefonisch', 'locatie']],
  /* Waar het gesprek strandde en waar het aansloeg (0114, 20-09-2026). */
  ['afhaakmoment', AFHAAKMOMENTEN],
  ['aangeslagen_op', AANSLAGPUNTEN],
  ['bezwaar_categorie', ['huidige leverancier', 'prijs', 'geen interesse', 'geen tijd', 'software',
    'vertrouwen', 'merk', 'levering', 'overstappen', 'gratis_klinkt_onbetrouwbaar',
    'geen_materiaalverkoop', 'onderaannemer', 'huisstijl_of_nummering', 'boekhouding',
    'eerst_stalen_of_ervaringen', 'genoeg_werk', 'anders']],
  ['kanaal', ['telefoon', 'whatsapp', 'email', 'linkedin', 'post', 'bezoek', 'advertentie', 'referral']],
  /* De drie vragen die Jelle na elk gesprek beantwoord wil zien (15-09-2026): wat wil hij wel,
     wat wil hij niet, en waarom. Vrije tekst, in zijn eigen woorden; dat is de belangrijke data. */
  ['discovery_veld', ['wil_wel', 'wil_niet', 'waarom']],
  /* De velden die de scripts per stap vullen (sales-scripts.mjs) en die het fundament nog niet kende. */
  ['discovery_veld', ['reactie_op_informatie', 'besliscriteria', 'onboarding_profiel', 'specialisme', 'b2c_of_b2b']],
  /* De vragen van het belscript van Myron (eerste_contact v2, 17-09-2026), per thema. */
  /* Het servicegesprek (aanvulling onderdeel 3): de zeven vragen na een levering. */
  ['discovery_veld', ['levering_goed', 'project_verlopen', 'klant_tevreden', 'problemen_gehad', 'verbeterpunt', 'context_volgend_gesprek']],
  ['discovery_veld', ['hoe_materialen_berekend', 'tijd_per_offerte', 'doorlooptijd_offerte', 'offertes_blijven_liggen', 'offerte_conversie',
    'offertes_opvolgen', 'ophalen_of_bezorgen', 'meerdere_leveranciers']],
  /* De demo-evaluatie (brainstorm onderdeel 14) als discovery-velden op het demo-contactmoment;
     de scores per getoond onderdeel staan in demo_evaluaties (migration 0105). */
  ['discovery_veld', ['interesse_voor_demo', 'interesse_na_demo', 'demo_aha_moment', 'demo_verwarring',
    'demo_favoriete_functie', 'demo_minst_relevant', 'demo_ontbrekende_functie', 'demo_onverwachte_behoefte',
    'demo_reden_direct_starten', 'demo_reden_niet_starten', 'demo_morgen_gebruiken', 'demo_zou_bestellen',
    'demo_m2_verwacht', 'demo_zou_aanbevelen', 'demo_eerst_verbeteren', 'demo_getoond', 'demo_begrepen', 'demo_relevant', 'demo_eerst_oplossen']],
  ['demo_morgen_gebruiken', ['ja', 'nee', 'misschien']],
  ['demo_zou_bestellen', ['ja', 'nee', 'misschien']],
  ['demo_zou_aanbevelen', ['ja', 'nee', 'misschien']],
];

/* De onderdelen van de productdemonstratie (brainstorm onderdeel 13), in de volgorde van de
   klusflow. Per onderdeel wordt na de demo gescoord (demo_evaluaties). */
export const DEMO_ONDERDELEN = [
  'dashboard', 'klant_aanmaken', 'project_aanmaken', 'verdiepingen_en_ruimtes', 'inmeting', 'ondergrond',
  'voorbereiding', 'snijverlies', 'plinten', 'band_en_bies', 'productkeuze', 'materiaalberekening',
  'arbeidsberekening', 'eigen_marge', 'offerte', 'digitaal_akkoord', 'planning', 'bestelling_framr',
  'bestelling_andere_leverancier', 'factuur', 'boekhouding', 'status_en_overzicht',
];

/* Het gesprekskader: de kernboodschappen en de ingang per signaal, als tekst voor het
   scherm van de beller. Geen prijzen en geen bedragen: die horen niet in git. */
export const KERNBOODSCHAPPEN = [
  'Gratis bedrijfssoftware voor vloerenleggers: van inmeting naar calculatie, offerte en factuur.',
  'Materiaal bestellen met partnerprijzen, eigen leverancier mag blijven, geen verplichte overstap.',
  'Extra brutomarge op het materiaal van projecten die je toch al doet.',
  'Demo gericht op zijn eigen werkwijze: een echt project samen doorrekenen.',
];

export const INGANGEN = {
  marge: 'Pakt hij niets op materiaal: begin bij de brutomarge per project.',
  administratie: 'Werkt hij s avonds aan offertes: begin bij inmeten naar offerte in een keer.',
  bestellen: 'Grijpt hij mis op materiaal: begin bij de materiaalberekening en het bestellen.',
  alles_in_een: 'Excel, WhatsApp en papier door elkaar: begin bij alles in een systeem.',
};

/* Datums: de pg-driver geeft een date-kolom als lokale Date terug; via toISOString zou
   de dag verschuiven. Daarom altijd in lokale tijd naar JJJJ-MM-DD. */
export function dagVan(d) {
  if (!d) return null;
  if (d instanceof Date) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  const s = String(d);
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) return dagVan(new Date(s));
  return s.slice(0, 10);
}

/* De tijd (UU:MM, lokaal) van een timestamptz; null zonder tijd. */
export function tijdVan(d) {
  if (!d) return null;
  const dt = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(dt.getTime())) return null;
  return `${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`;
}

/* Een lokale dag en tijd naar een tijdstip (ISO, in UTC) zoals de database het bewaart. */
export function tijdstipVan(dag, tijd = '10:00') {
  const [j, m, d] = String(dag).split('-').map(Number);
  const [u, mi] = String(tijd || '10:00').split(':').map(Number);
  return new Date(j, m - 1, d, u || 0, mi || 0).toISOString();
}

export function plusDagen(dag, dagen) {
  const [j, m, d] = String(dag).split('-').map(Number);
  const dt = new Date(j, m - 1, d + Number(dagen || 0));
  return dagVan(dt);
}

/* Zoveel werkdagen verder (weekend telt niet mee); nul is dezelfde dag, op een werkdag. */
/* n werkdagen terug: het spiegelbeeld van plusWerkdagen (die alleen vooruit telt). */
export function minWerkdagen(dag, n) {
  let d = dag;
  let over = Number(n || 0);
  while (over > 0) {
    d = plusDagen(d, -1);
    const wd = weekdagVan(d);
    if (wd !== 0 && wd !== 6) over -= 1;
  }
  return d;
}

export function plusWerkdagen(dag, n) {
  let d = dag;
  let over = Number(n || 0);
  if (over === 0) return naarWerkdag(d);
  while (over > 0) {
    d = plusDagen(d, 1);
    const wd = weekdagVan(d);
    if (wd !== 0 && wd !== 6) over -= 1;
  }
  return d;
}

function weekdagVan(dag) {
  const [j, m, d] = String(dag).split('-').map(Number);
  return new Date(j, m - 1, d).getDay();
}

export function vandaagLokaal(nu = new Date()) {
  return dagVan(nu);
}

/* Werkdagen: een opvolging op zaterdag of zondag schuift naar maandag. */
export function naarWerkdag(dag) {
  const wd = weekdagVan(dag);
  if (wd === 6) return plusDagen(dag, 2);
  if (wd === 0) return plusDagen(dag, 1);
  return dag;
}

function sorteerOpStart(interacties = []) {
  return [...interacties].sort((a, b) => String(new Date(b.started_at).toISOString())
    .localeCompare(String(new Date(a.started_at).toISOString())));
}

/* Huidige classificatie per lead: de rij met een open geldig_tot. */
export function classificatieIndex(classificaties = []) {
  const idx = new Map();
  for (const c of classificaties) {
    if (c.geldig_tot) continue;
    idx.set(c.lead_id, c.classificatie);
  }
  return idx;
}

/* De laatste AI-briefing per lead (hoogste versie). */
export function researchIndex(research = []) {
  const idx = new Map();
  for (const r of research) {
    const h = idx.get(r.lead_id);
    if (!h || Number(r.versie) > Number(h.versie)) idx.set(r.lead_id, r);
  }
  return idx;
}

/* Per lead: de gesprekken, de laatste interactie (van welk type ook), het laatste bericht,
   de laatste inkomende reactie en het aantal belpogingen zonder gehoor sinds het laatste
   echte contact. */
export function contactIndex(interacties = []) {
  const idx = new Map();
  for (const i of sorteerOpStart(interacties)) {
    if (!idx.has(i.lead_id)) idx.set(i.lead_id, { laatste: i, gesprekken: [], berichten: [], laatsteBericht: null, laatsteReactie: null, pogingen: 0, bereikt: false });
    const e = idx.get(i.lead_id);
    if (i.richting === 'inkomend' && !e.laatsteReactie) e.laatsteReactie = i;
    if (['whatsapp', 'email'].includes(i.type) && i.richting !== 'inkomend') {
      e.berichten.push(i);
      if (!e.laatsteBericht) e.laatsteBericht = i;
    }
    if (i.type !== 'call') continue;
    e.gesprekken.push(i);
    if (!e.bereikt) {
      if (i.uitkomst && NIET_BEREIKT.has(i.uitkomst)) e.pogingen += 1;
      else if (i.uitkomst) e.bereikt = true;
    }
  }
  return idx;
}

export function telPogingen(interacties = [], leadId) {
  const e = contactIndex(interacties.filter((i) => i.lead_id === leadId)).get(leadId);
  return e ? e.pogingen : 0;
}

/* Het laatste contactmoment van een lead, van welk type ook, voor de lijsten. */
export function laatsteContactVoor(interacties = [], leadId) {
  const e = contactIndex(interacties.filter((i) => i.lead_id === leadId)).get(leadId);
  if (!e) return null;
  const l = e.laatste;
  const g = e.gesprekken[0] || null;
  return {
    id: l.id, dag: dagVan(l.started_at), tijd: tijdVan(l.started_at), type: l.type, richting: l.richting || 'uitgaand', uitkomst: l.uitkomst || null, samenvatting: l.samenvatting || null,
    laatsteGesprek: g ? { dag: dagVan(g.started_at), uitkomst: g.uitkomst || null } : null,
    laatsteBericht: e.laatsteBericht ? { id: e.laatsteBericht.id, dag: dagVan(e.laatsteBericht.started_at), type: e.laatsteBericht.type, materiaal: e.laatsteBericht.materiaal || null, link: e.laatsteBericht.link || null } : null,
    laatsteReactie: e.laatsteReactie ? { dag: dagVan(e.laatsteReactie.started_at), type: e.laatsteReactie.type, samenvatting: e.laatsteReactie.samenvatting || null } : null,
    pogingen: e.pogingen,
  };
}

/*
  De reactiestatus van een lead: het laatste uitgaande bericht waarop een reactie verwacht
  werd bepaalt hem. wacht (termijn loopt), verstreken (termijn voorbij, geen reactie),
  ontvangen (reactie binnen) of geen (geen reactie verwacht).
*/
export function reactieStatus(interacties = [], leadId, vandaag) {
  const berichten = sorteerOpStart(interacties.filter((i) => i.lead_id === leadId && ['whatsapp', 'email'].includes(i.type) && i.richting !== 'inkomend'));
  const b = berichten.find((x) => x.reactie_verwacht === true) || berichten[0];
  if (!b) return { status: 'geen', bericht: null, termijn: null };
  const basis = { bericht: b.id, dag: dagVan(b.started_at), materiaal: b.materiaal || null, termijn: b.reactie_termijn ? dagVan(b.reactie_termijn) : null };
  if (b.reactie_ontvangen_op) return { status: 'ontvangen', ...basis, ontvangenOp: dagVan(b.reactie_ontvangen_op) };
  if (!b.reactie_verwacht) return { status: 'geen', ...basis };
  if (basis.termijn && vandaag && basis.termijn < vandaag) return { status: 'verstreken', ...basis };
  return { status: 'wacht', ...basis };
}

/* Of een claim op een lead nog geldt: er staat iemand, en de claim is niet verlopen. */
export function claimIsActief(lead, nu = new Date()) {
  if (!lead || !lead.in_behandeling_door || !lead.in_behandeling_sinds) return false;
  const sinds = new Date(lead.in_behandeling_sinds).getTime();
  return (new Date(nu).getTime() - sinds) < CLAIM_MINUTEN * 60000;
}

/*
  De fase na een uitkomst. 'poging' telt: de eerste keer zonder gehoor is eerste_poging,
  daarna niet_bereikt, en na MAX_POGINGEN gaat de lead naar later_benaderen.
*/
export function bepaalFaseNaUitkomst({ uitkomst, pogingenVoor = 0 } = {}) {
  const regel = UITKOMST_REGELS[uitkomst];
  if (!regel) throw new Error(`onbekende uitkomst '${uitkomst}'. Kies ${BELUITKOMSTEN.join(', ')}.`);
  if (regel.fase !== 'poging') return regel.fase;
  const pogingenNa = pogingenVoor + 1;
  if (pogingenNa >= MAX_POGINGEN) return 'later_benaderen';
  return pogingenNa === 1 ? 'eerste_poging' : 'niet_bereikt';
}

/* De reeks voor een aanleiding: de rij uit sales_opvolgreeksen van dit bedrijf, anders de
   standaard. Een reeks die op inactief staat telt als afwezig. */
export function reeksVoor(reeksen = [], aanleiding, companyId) {
  const eigen = reeksen.find((r) => r.aanleiding === aanleiding && (!companyId || r.company_id === companyId));
  if (eigen) return eigen.actief === false ? null : { aanleiding: eigen.aanleiding, naam: eigen.naam, maxPogingen: eigen.max_pogingen, stappen: eigen.stappen || [], versie: eigen.versie };
  return STANDAARD_OPVOLGREEKSEN.find((r) => r.aanleiding === aanleiding) || null;
}

/* De stap met dit volgnummer uit een reeks, als taakvoorstel: de datum vanaf vanafDag, het
   taaktype en de reden. null als de reeks daar ophoudt. */
export function stapUitReeks({ reeks, volgnummer = 1, vanafDag } = {}) {
  if (!reeks || !vanafDag) return null;
  const s = (reeks.stappen || []).find((x) => Number(x.volgnummer) === Number(volgnummer));
  if (!s) return null;
  const dagen = Number(s.wachtdagen || 0);
  const dueDate = s.dagsoort === 'kalenderdagen' ? naarWerkdag(plusDagen(vanafDag, dagen)) : plusWerkdagen(vanafDag, dagen);
  const taak = s.actie === 'beoordelen' ? 'check_in' : (s.actie || 'call');
  return { dueDate, taak, reden: s.reden || `${reeks.naam || reeks.aanleiding}, stap ${s.volgnummer}`, reeks: reeks.aanleiding, stap: Number(s.volgnummer), template: s.template || null, uitvoerder: s.uitvoerder || 'beller', laatste: !(reeks.stappen || []).some((x) => Number(x.volgnummer) === Number(volgnummer) + 1) };
}

/*
  De opvolging na een uitkomst: een opgegeven datum gaat voor (de concrete afspraak), anders
  de eerste stap van de reeks van de aanleiding, anders de standaard uit de regel; altijd op
  een werkdag. Na de laatste vergeefse poging: dertig dagen rust.
*/
export function bepaalOpvolging({ uitkomst, opvolgDatum, vandaag, faseNa, reeksen = [], companyId } = {}) {
  const regel = UITKOMST_REGELS[uitkomst];
  if (!regel) throw new Error(`onbekende uitkomst '${uitkomst}'.`);
  if (faseNa === 'later_benaderen' && regel.fase === 'poging') {
    return { dueDate: opvolgDatum || naarWerkdag(plusDagen(vandaag, 30)), taak: 'call', reden: `${MAX_POGINGEN} keer geen gehoor, over een maand opnieuw` };
  }
  if (!regel.opvolg) {
    if (opvolgDatum) return { dueDate: opvolgDatum, taak: 'call', reden: 'opvolgen op verzoek van de beller' };
    return null;
  }
  if (opvolgDatum) return { dueDate: opvolgDatum, taak: regel.opvolg.taak || 'call', reden: regel.opvolg.reden, reeks: regel.reeks || null, stap: regel.reeks ? 1 : null };
  const reeks = regel.reeks ? reeksVoor(reeksen, regel.reeks, companyId) : null;
  if (reeks) {
    const s = stapUitReeks({ reeks, volgnummer: 1, vanafDag: vandaag });
    if (s) return s;
  }
  const dueDate = naarWerkdag(plusDagen(vandaag, regel.opvolg.dagen));
  return { dueDate, taak: regel.opvolg.taak, reden: regel.opvolg.reden };
}

const TAAKTITEL = {
  call: 'Bellen',
  whatsapp: 'WhatsApp sturen',
  email: 'Mail sturen',
  demo: 'Demo',
  onboarding: 'Account inrichten',
  check_in: 'Beoordelen',
 service: 'Service' };

export function taakTitel(taakType, leadNaam) {
  return `${TAAKTITEL[taakType] || 'Opvolgen'}: ${leadNaam}`;
}

function openTaken(taken = []) {
  return taken.filter((t) => t.status !== 'done');
}

function nuIso(nu) {
  return nu ? new Date(nu).toISOString() : new Date().toISOString();
}

/* De eerstvolgende actie van een lead, uit zijn open taken en afspraken: overal dezelfde
   bron, zodat Vandaag, de leadlijst en het dossier hetzelfde zeggen. */
export function volgendeActieVoor({ taken = [], afspraken = [], leadId, vandaag, people = [] } = {}) {
  const naamVan = new Map(people.map((p) => [p.id, p.name]));
  const open = openTaken(taken).filter((t) => t.lead_id === leadId);
  const kandidaten = open.map((t) => ({
    taakId: t.id, taak: t.task_type || 'check_in', dag: dagVan(t.due_date || t.due_at), tijd: t.due_at ? tijdVan(t.due_at) : null,
    reden: t.reden || t.title, contactreden: t.contactreden || contactredenVoor({ taak: t.task_type || 'call', reeks: t.opvolg_reeks, reden: t.reden }), wie: t.assignee || null, wieNaam: naamVan.get(t.assignee) || null, reeks: t.opvolg_reeks || null, stap: t.opvolg_stap || null, bron: 'taak',
  }));
  for (const a of afspraken.filter((x) => x.lead_id === leadId && ['gepland', 'verplaatst'].includes(x.status))) {
    if (a.task_id && kandidaten.some((k) => k.taakId === a.task_id)) continue;
    kandidaten.push({ taakId: a.task_id || null, afspraakId: a.id, taak: a.soort || 'demo', dag: dagVan(a.start_at), tijd: tijdVan(a.start_at), reden: `${a.soort || 'demo'} ${a.vorm || ''}`.trim(), contactreden: 'demo_uitvoeren', wie: a.verantwoordelijke || null, wieNaam: naamVan.get(a.verantwoordelijke) || null, bron: 'afspraak' });
  }
  if (!kandidaten.length) return null;
  kandidaten.sort((a, b) => String(a.dag || '9999').localeCompare(String(b.dag || '9999')) || String(a.tijd || '').localeCompare(String(b.tijd || '')));
  const v = kandidaten[0];
  return { ...v, teLaat: Boolean(v.dag && vandaag && v.dag < vandaag), aantalOpen: kandidaten.length };
}

/*
  De dagselectie: welke leads vandaag aan de beurt zijn voor deze beller, in volgorde.

  Drie lagen, elk met een reden die op het scherm komt:
    1. opvolgtaken die vandaag of eerder vervallen (prioriteit 90), oudste eerst;
    2. leads die eerder niet bereikt zijn en waarvan de laatste poging minstens
       twee dagen terug is (prioriteit 70), langst geleden eerst;
    3. nog nooit gebelde leads (prioriteit 50): eerst die van de beller zelf, dan de niet
       toegewezen leads (de gedeelde pool); rechtspersonen en leads met opt-in eerst, dan
       met AI-briefing, dan op regio en naam.

  Wat er al vandaag in de queue staat (gepland of uitgevoerd) telt mee en wordt niet
  opnieuw gekozen; de reden van zo een rij wordt ververst uit de actuele taak. Leads zonder
  telefoonnummer, leads in een fase die niet op de lijst hoort, gepauzeerde leads en leads
  die een collega nu in behandeling heeft vallen af. Het aantal begrenst alleen laag 3.
*/
export function kiesDagselectie({
  leads = [], fasen = [], classificaties = [], research = [], interacties = [], taken = [],
  queue = [], afspraken = [], bellerId, vandaag, nu = null, aantal = 10, pipeline = FRAMR_PIPELINE,
  classificatie = 'vloerenlegger', companyId, metPool = true,
} = {}) {
  if (!bellerId) throw new Error('kiesDagselectie vereist bellerId (wie belt).');
  if (!vandaag) throw new Error('kiesDagselectie vereist vandaag (JJJJ-MM-DD).');

  const faseOpId = new Map(fasen.map((f) => [f.id, f]));
  const clsIdx = classificatieIndex(classificaties);
  const resIdx = researchIndex(research);
  const conIdx = contactIndex(interacties);
  const leadOpId = new Map(leads.map((l) => [l.id, l]));
  const klok = nu || `${vandaag}T12:00:00`;

  const eigen = leads.filter((l) => (!companyId || l.company_id === companyId));
  const vanBeller = (l) => l.toegewezen_aan === bellerId;
  const faseNaam = (l) => (l.pipeline_fase_id ? (faseOpId.get(l.pipeline_fase_id) || {}).naam : null);
  const inPipeline = (l) => !l.pipeline_fase_id || (faseOpId.get(l.pipeline_fase_id) || {}).pipeline === pipeline;
  const gepauzeerd = (l) => l.gepauzeerd_tot && dagVan(l.gepauzeerd_tot) > vandaag;
  const bijCollega = (l) => claimIsActief(l, klok) && l.in_behandeling_door !== bellerId;
  const mag = (l) => l && l.telefoon && inPipeline(l) && !gepauzeerd(l) && !bijCollega(l) && !EINDFASEN.has(faseNaam(l));

  /* Vandaag al op de lijst (uit een eerdere berekening): die rijen blijven staan. */
  const vandaagQueue = queue.filter((q) => dagVan(q.berekend_op) === vandaag
    && q.redenen && q.redenen.beller === bellerId);
  const alGekozen = new Set(vandaagQueue.map((q) => q.lead_id));

  const selectie = [];
  const gezien = new Set();
  const neem = (lead, prioriteit, reden, extra = {}) => {
    if (!lead || gezien.has(lead.id) || alGekozen.has(lead.id)) return;
    gezien.add(lead.id);
    selectie.push({ lead, prioriteit, reden, ...extra });
  };

  /* Laag 0: de bestaande lijst van vandaag, in de volgorde van toen, met de actuele reden. */
  for (const q of [...vandaagQueue].sort((a, b) => (a.redenen.volgnummer || 0) - (b.redenen.volgnummer || 0))) {
    const lead = leadOpId.get(q.lead_id);
    if (!lead) continue;
    gezien.add(lead.id);
    const actueel = volgendeActieVoor({ taken, afspraken, leadId: lead.id, vandaag });
    const reden = actueel && actueel.dag && actueel.dag <= vandaag ? `${actueel.reden}${actueel.dag < vandaag ? ` (stond op ${actueel.dag})` : ''}` : q.redenen.reden;
    selectie.push({ lead, prioriteit: q.prioriteit, reden, status: q.status, queueId: q.id, bestaand: true, taakId: actueel ? actueel.taakId : null });
  }

  /* Laag 1: opvolgtaken van vandaag en eerder. */
  const opvolg = openTaken(taken)
    .filter((t) => t.lead_id && (t.task_type === 'call' || !t.task_type))
    .filter((t) => (t.assignee ? t.assignee === bellerId : vanBeller(leadOpId.get(t.lead_id) || {})))
    .filter((t) => dagVan(t.due_date || t.due_at) && dagVan(t.due_date || t.due_at) <= vandaag)
    .sort((a, b) => String(dagVan(a.due_date || a.due_at)).localeCompare(String(dagVan(b.due_date || b.due_at))));
  for (const t of opvolg) {
    const lead = leadOpId.get(t.lead_id);
    if (!mag(lead)) continue;
    const dag = dagVan(t.due_date || t.due_at);
    const teLaat = dag < vandaag ? ` (stond op ${dag})` : '';
    neem(lead, 90, `${t.reden || t.title}${teLaat}`, { taakId: t.id });
  }

  /* Laag 2: eerder niet bereikt, laatste poging minstens twee dagen terug. */
  const grens = plusDagen(vandaag, -2);
  const nietBereikt = eigen
    .filter((l) => vanBeller(l) && mag(l))
    .filter((l) => ['eerste_poging', 'niet_bereikt'].includes(faseNaam(l)))
    .map((l) => ({ l, c: conIdx.get(l.id) }))
    .filter(({ c }) => c && c.laatste && dagVan(c.laatste.started_at) <= grens)
    .sort((a, b) => String(dagVan(a.c.laatste.started_at)).localeCompare(String(dagVan(b.c.laatste.started_at))));
  for (const { l, c } of nietBereikt) {
    neem(l, 70, `${c.pogingen}e poging zonder gehoor op ${dagVan(c.laatste.started_at)}, opnieuw proberen`);
  }

  /* Laag 3: nog nooit gebeld; eigen leads eerst, dan de gedeelde pool. */
  const rang = (l) => {
    const rv = String(l.rechtsvorm || '').toLowerCase();
    if (rv === 'bv') return 0;
    if (l.bel_opt_in === true) return 1;
    if (rv === '' || rv === 'onbekend') return 2;
    return 3;
  };
  const nieuw = eigen
    .filter((l) => (vanBeller(l) || (metPool && !l.toegewezen_aan)) && mag(l))
    .filter((l) => !conIdx.has(l.id))
    .filter((l) => !faseNaam(l) || ['nieuwe_lead', 'te_bellen'].includes(faseNaam(l)))
    .filter((l) => !classificatie || clsIdx.get(l.id) === classificatie)
    .sort((a, b) => Number(!vanBeller(a)) - Number(!vanBeller(b)) || rang(a) - rang(b)
      || Number(resIdx.has(b.id)) - Number(resIdx.has(a.id))
      || String(a.regio || 'zzz').localeCompare(String(b.regio || 'zzz'))
      || String(a.naam).localeCompare(String(b.naam)));
  let nieuwGeteld = 0;
  for (const l of nieuw) {
    if (nieuwGeteld >= aantal) break;
    neem(l, 50, `${resIdx.has(l.id) ? 'nog nooit gebeld, briefing klaar' : 'nog nooit gebeld'}${vanBeller(l) ? '' : ' (uit de gedeelde pool)'}`);
    nieuwGeteld += 1;
  }

  /* Opvolgtaken en herhaalpogingen komen altijd mee, ook boven het aantal: een afspraak
     verdwijnt niet omdat de lijst vol is. Alleen de nieuwe leads vullen aan tot het aantal. */
  const lijst = selectie.map((s, i) => ({
    ...s,
    volgnummer: i + 1,
    classificatie: clsIdx.get(s.lead.id) || null,
    fase: faseNaam(s.lead),
    briefing: (resIdx.get(s.lead.id) || {}).samenvatting || null,
    pogingen: (conIdx.get(s.lead.id) || {}).pogingen || 0,
    laatsteContact: conIdx.has(s.lead.id) ? dagVan(conIdx.get(s.lead.id).laatste.started_at) : null,
    waarschuwingen: waarschuwingenVoor(s.lead),
    ingang: kiesIngang(resIdx.get(s.lead.id)),
    inBehandelingDoor: claimIsActief(s.lead, klok) ? s.lead.in_behandeling_door : null,
  }));
  const totaalNieuw = nieuw.length;
  return lijst.map((x) => ({ ...x, totaalNieuw, meerNieuw: Math.max(0, totaalNieuw - nieuwGeteld) }));
}

/* De wet en de datakwaliteit, zichtbaar op de regel. */
export function waarschuwingenVoor(lead) {
  const w = [];
  const rv = String(lead.rechtsvorm || '').toLowerCase();
  if (rv === 'bv') { /* rechtspersoon: koud bellen mag */ } else if (lead.bel_opt_in === true) {
    /* opt-in vastgelegd */
  } else if (!rv || rv === 'onbekend') {
    w.push('rechtsvorm onbekend: eerst KvK kijken, eenmanszaak alleen met opt-in');
  } else {
    w.push(`${rv} zonder opt-in: niet koud bellen, eerst opt-in (mail of website)`);
  }
  if (!lead.email) w.push('geen e-mailadres bekend');
  if (!lead.whatsapp && !lead.telefoon) w.push('geen nummer voor WhatsApp');
  if (Array.isArray(lead.geen_contact_via) && lead.geen_contact_via.length) w.push(`wil geen contact via ${lead.geen_contact_via.join(', ')}`);
  return w;
}

/* Welke ingang de briefing suggereert; zonder briefing de marge, want dat is de belofte
   van de vloerenpagina. */
export function kiesIngang(researchRij) {
  const s = String((researchRij || {}).samenvatting || '').toLowerCase();
  if (!s) return 'marge';
  if (/excel|word|papier|avond|administratie/.test(s)) return 'administratie';
  if (/bestel|voorraad|levering/.test(s)) return 'bestellen';
  if (/allround|klus|onderhoud/.test(s)) return 'alles_in_een';
  return 'marge';
}

/*
  De dagselectie vastzetten in sales_queue, zodat de lijst van vandaag morgen nog te
  zien is en het dagrapport kan tellen wie er niet gebeld is. Idempotent per dag en per
  lead: wat er al staat wordt niet opnieuw geschreven.
*/
export async function schrijfDagselectie(adapter, { companyId, selectie = [], bellerId, vandaag } = {}) {
  if (!companyId || !bellerId || !vandaag) throw new Error('schrijfDagselectie vereist companyId, bellerId en vandaag.');
  let geschreven = 0;
  for (const s of selectie) {
    if (s.bestaand) continue;
    await adapter.insertSalesQueue({
      company_id: companyId,
      lead_id: s.lead.id,
      kanaal_voorstel: 'call',
      prioriteit: s.prioriteit,
      redenen: { reden: s.reden, beller: bellerId, dag: vandaag, volgnummer: s.volgnummer },
      status: 'gepland',
    });
    geschreven += 1;
  }
  return { geschreven, overgeslagen: selectie.length - geschreven };
}

/* De queue-rij van vandaag voor deze lead op uitgevoerd zetten (als die er is). */
async function sluitQueueRij(adapter, { leadId, vandaag }) {
  if (!adapter.fetchSalesQueue || !adapter.updateSalesQueue) return null;
  const rijen = (await adapter.fetchSalesQueue()).filter((q) => q.lead_id === leadId
    && dagVan(q.berekend_op) === vandaag && q.status === 'gepland');
  for (const q of rijen) await adapter.updateSalesQueue(q.id, { status: 'uitgevoerd' });
  return rijen.length;
}

/* ---------- taken: maken zonder dubbelen, sluiten met resultaat, afronden ---------- */

/*
  Een salestaak maken. Niet via recordTask (die hergebruikt een taak op titel en wist zo de
  historie), maar rechtstreeks, met de regel: een open taak van deze lead met hetzelfde type,
  dezelfde datum en dezelfde reden bestaat al, dan die en geen tweede. Met vervangOpen gaan
  oudere open taken van hetzelfde type dicht als vervangen (een nieuwe afspraak vervangt de
  achterhaalde), met een verwijzing naar de nieuwe.
*/
export async function maakSalesTaak(adapter, {
  companyId, leadId, leadNaam, taak = 'call', dueDate, dueAt = null, reden, assigneeId = null, interactionId = null,
  reeks = null, stap = null, description = null, vervangOpen = true, nu = null, taken = null, contactreden = null, orderId = null,
} = {}) {
  if (!companyId || !leadId || !dueDate) throw new Error('maakSalesTaak vereist companyId, leadId en dueDate.');
  const redenCode = contactredenVoor({ taak, reeks, reden, contactreden });
  const alle = taken || (await adapter.fetchTasks());
  const open = openTaken(alle).filter((t) => t.lead_id === leadId && (t.task_type || 'call') === taak);
  const zelfde = open.find((t) => dagVan(t.due_date || t.due_at) === dueDate && String(t.reden || '') === String(reden || ''));
  if (zelfde) return { id: zelfde.id, dueDate, taak, reden, nieuw: false, vervangen: 0 };
  const r = await adapter.insertTask({
    company_id: companyId, title: taakTitel(taak, leadNaam || leadId), description, status: 'todo', priority: 'medium',
    due_date: dueDate, due_at: dueAt, assignee: assigneeId, lead_id: leadId, task_type: taak, reden: reden || null,
    linked_interaction_id: interactionId, opvolg_reeks: reeks, opvolg_stap: stap, contactreden: redenCode, order_id: orderId || null,
  });
  let vervangen = 0;
  if (vervangOpen) {
    for (const o of open) {
      await adapter.updateTask(o.id, { status: 'done', resultaat: 'vervangen', vervangen_door: r.id, afgerond_op: nuIso(nu) });
      vervangen += 1;
    }
  }
  return { id: r.id, dueDate, taak, reden, contactreden: redenCode, reeks, stap, nieuw: true, vervangen };
}

/* Open taken van een lead sluiten met een resultaat; kies is een filter op de taak. */
export async function sluitTaken(adapter, { leadId, kies = () => true, resultaat = 'gedaan', nu = null, taken = null } = {}) {
  const alle = taken || (await adapter.fetchTasks());
  const open = openTaken(alle).filter((t) => t.lead_id === leadId && kies(t));
  for (const t of open) await adapter.updateTask(t.id, { status: 'done', resultaat, afgerond_op: nuIso(nu) });
  return open.length;
}

/*
  Een taak afronden met een resultaat. gedaan sluit; geen_reactie sluit en maakt de volgende
  stap van de reeks (of niets meer als de reeks op is); verplaatst sluit en maakt dezelfde taak
  op de nieuwe datum; vervallen sluit zonder vervolg. Een taak die al dicht is blijft dicht.
*/
export async function rondTaakAf(adapter, { companyId, taakId, resultaat = 'gedaan', nieuweDatum, nieuweTijd, notitie, doorPersonId, vandaag, nu = null, reeksen = null } = {}) {
  if (!taakId) throw new Error('rondTaakAf vereist taakId.');
  if (!TAAKRESULTATEN.includes(resultaat)) throw new Error(`resultaat '${resultaat}' is onbekend. Kies ${TAAKRESULTATEN.join(', ')}.`);
  const alle = await adapter.fetchTasks();
  const t = alle.find((x) => x.id === taakId);
  if (!t) throw new Error('taak niet gevonden.');
  if (t.status === 'done') return { taakId, resultaat: t.resultaat || 'gedaan', herhaald: true, volgende: null };
  const dag = vandaag || vandaagLokaal();
  const lead = t.lead_id ? await adapter.getLeadById(t.lead_id) : null;
  const naam = lead ? lead.naam : t.lead_id;
  const patch = { status: 'done', resultaat, afgerond_op: nuIso(nu) };
  if (notitie) patch.description = [t.description, notitie].filter(Boolean).join('\n');
  let volgende = null;
  if (resultaat === 'verplaatst') {
    if (!nieuweDatum) throw new Error('verplaatsen vereist een nieuwe datum.');
    const v = await maakSalesTaak(adapter, {
      companyId: companyId || t.company_id, leadId: t.lead_id, leadNaam: naam, taak: t.task_type || 'call', dueDate: nieuweDatum,
      dueAt: nieuweTijd ? tijdstipVan(nieuweDatum, nieuweTijd) : null, reden: t.reden || t.title, assigneeId: t.assignee || doorPersonId || null,
      interactionId: t.linked_interaction_id || null, reeks: t.opvolg_reeks || null, stap: t.opvolg_stap || null, description: t.description || null, vervangOpen: false, nu, taken: alle,
    });
    patch.vervangen_door = v.id;
    volgende = v;
  } else if (resultaat === 'geen_reactie' && t.lead_id && !EINDFASEN.has(await faseNaamVanLead(adapter, lead))) {
    const reeks = t.opvolg_reeks ? reeksVoor(reeksen || (adapter.fetchOpvolgreeksen ? await adapter.fetchOpvolgreeksen() : []), t.opvolg_reeks, companyId || t.company_id) : null;
    const s = reeks ? stapUitReeks({ reeks, volgnummer: Number(t.opvolg_stap || 1) + 1, vanafDag: dag }) : null;
    if (s) {
      volgende = await maakSalesTaak(adapter, { companyId: companyId || t.company_id, leadId: t.lead_id, leadNaam: naam, taak: s.taak, dueDate: s.dueDate, reden: s.reden, assigneeId: t.assignee || doorPersonId || null, interactionId: t.linked_interaction_id || null, reeks: s.reeks, stap: s.stap, vervangOpen: false, nu, taken: alle });
    }
  }
  await adapter.updateTask(taakId, patch);
  return { taakId, resultaat, herhaald: false, volgende, reeksKlaar: resultaat === 'geen_reactie' && !volgende };
}

async function faseNaamVanLead(adapter, lead) {
  if (!lead || !lead.pipeline_fase_id) return null;
  const f = (await adapter.fetchPipelineFases()).find((x) => x.id === lead.pipeline_fase_id);
  return f ? f.naam : null;
}

/* ---------- de claim: wie behandelt de lead nu ---------- */

/*
  Een lead claimen voor een benaderactie. Voorwaardelijk aan de databasekant: alleen als
  niemand anders hem vasthoudt of die claim verlopen is. Geeft {ok, door} terug; bij ok false
  staat erbij wie hem heeft. Een lead zonder eigenaar krijgt de claimer als eigenaar: wie
  hem het eerst belt, houdt hem.
*/
export async function claimLead(adapter, { leadId, bellerId, nu = null } = {}) {
  if (!leadId || !bellerId) throw new Error('claimLead vereist leadId en bellerId.');
  const sinds = nuIso(nu);
  const verlopenVoor = new Date(new Date(sinds).getTime() - CLAIM_MINUTEN * 60000).toISOString();
  const rij = await adapter.claimLead(leadId, { door: bellerId, sinds, verlopenVoor });
  if (!rij) {
    const l = await adapter.getLeadById(leadId);
    return { ok: false, door: l ? l.in_behandeling_door : null, sinds: l ? l.in_behandeling_sinds : null };
  }
  if (!rij.toegewezen_aan) await adapter.updateLead(leadId, { toegewezen_aan: bellerId });
  return { ok: true, door: bellerId, sinds };
}

/* De claim loslaten (na opslaan, overslaan of stoppen); alleen de houder kan dat. */
export async function geefLeadVrij(adapter, { leadId, bellerId } = {}) {
  const l = await adapter.getLeadById(leadId);
  if (!l) return { ok: false };
  if (l.in_behandeling_door && l.in_behandeling_door !== bellerId) return { ok: false, door: l.in_behandeling_door };
  await adapter.updateLead(leadId, { in_behandeling_door: null, in_behandeling_sinds: null });
  return { ok: true };
}

/* De hartslag van een open sessie: de claim verlengen zolang het scherm open staat. */
export async function hartslagLead(adapter, { leadId, bellerId, nu = null } = {}) {
  return claimLead(adapter, { leadId, bellerId, nu });
}

/* ---------- het gesprek ---------- */

/* De bezwaren bij een contactmoment wegschrijven; reactie_werkte blijft de afgeleide voor de
   bibliotheek. Het oude enkelvoud (bezwaar, categorie, reactie, werkte) wordt hier ook aanvaard. */
async function schrijfBezwaren(adapter, { companyId, leadId, interactionId, bezwaren = [] }) {
  const ids = [];
  for (const b of bezwaren) {
    if (!b || !String(b.bezwaar || '').trim()) continue;
    const resultaat = b.resultaat || (b.reactieWerkte === true ? 'ja' : (b.reactieWerkte === false ? 'nee' : null));
    if (resultaat && !BEZWAAR_RESULTATEN.includes(resultaat)) throw new Error(`bezwaarresultaat '${resultaat}' is onbekend. Kies ${BEZWAAR_RESULTATEN.join(', ')}.`);
    if (b.soort && !BEZWAAR_SOORTEN.includes(b.soort)) throw new Error(`bezwaarsoort '${b.soort}' is onbekend. Kies ${BEZWAAR_SOORTEN.join(', ')}.`);
    const rij = await recordObjection(adapter, {
      companyId, leadId, interactionId, bezwaar: String(b.bezwaar).trim(), categorie: b.categorie || undefined,
      gegevenReactie: b.reactie || undefined, reactieWerkte: resultaat === 'ja' ? true : (resultaat === 'nee' ? false : undefined),
    });
    const extra = { reactie_werkte: resultaat === 'ja' ? true : (resultaat === 'nee' ? false : null) };
    if (b.context) extra.context = b.context;
    if (resultaat) extra.reactie_resultaat = resultaat;
    if (b.afspraak) extra.afspraak = b.afspraak;
    if (b.vervolgactie) extra.vervolgactie = b.vervolgactie;
    if (b.soort) extra.soort = b.soort;
    if (Object.keys(extra).length && adapter.updateObjection) await adapter.updateObjection(rij.id, extra);
    ids.push(rij.id);
  }
  return ids;
}

/*
  Extra dingen uit een gesprek zonder een nieuw databaseveld: een vraag (questions), persoonlijke
  context (crm_weetjes, bevestigd want de beller hoorde het zelf), een productwens
  (sales_suggestions plus een notitie op de tijdlijn), een inzicht, een afspraak of een losse
  notitie (een contactmoment van het type note met de soort als tag).
*/
async function verwerkExtras(adapter, { companyId, leadId, interactionId, doorPersonId, personId, startedAt, stap, extras = [], leadNaam, dag }) {
  const uit = [];
  for (const e of extras) {
    if (!e || !String(e.inhoud || '').trim()) continue;
    const soort = EXTRA_SOORTEN.includes(e.soort) ? e.soort : 'notitie';
    const inhoud = String(e.inhoud).trim();
    if (soort === 'vraag') {
      const q = await recordQuestion(adapter, { companyId, leadId, interactionId, vraag: inhoud, antwoord: e.antwoord || undefined, categorie: e.categorie || undefined });
      uit.push({ soort, id: q.id });
      continue;
    }
    if (soort === 'persoonlijke_context') {
      const w = await adapter.insertCrmWeetje({ company_id: companyId, lead_id: leadId, person_id: personId || null, weetje: inhoud, bron_interaction_id: interactionId, review_status: 'confirmed' });
      uit.push({ soort, id: w.id });
      continue;
    }
    if (soort === 'productwens' && adapter.insertSalesSuggestion) {
      await adapter.insertSalesSuggestion({ company_id: companyId, categorie: 'product', voorstel: inhoud, onderbouwing: `${leadNaam || leadId}, gesprek van ${dag}`, status: 'voorgesteld' });
    }
    const n = await recordInteraction(adapter, { companyId, leadId, type: 'note', doorPersonId, personId, richting: 'uitgaand', startedAt: startedAt || `${dag}T12:00:00.000Z`, samenvatting: inhoud });
    const patch = { tags: [soort] };
    if (stap) patch.stap = stap;
    if (adapter.updateInteraction) await adapter.updateInteraction(n.id, patch);
    uit.push({ soort, id: n.id });
  }
  return uit;
}

/* Een eerder verzoek met dezelfde sleutel, of hetzelfde gesprek binnen een minuut: niet twee keer. */
function vindHerhaling(alle, { companyId, verzoekId, leadId, doorPersonId, type, uitkomst, startedAt }) {
  if (verzoekId) {
    const b = alle.find((i) => i.verzoek_id === verzoekId && (!companyId || i.company_id === companyId));
    if (b) return b;
  }
  if (startedAt) {
    const t = new Date(startedAt).getTime();
    return alle.find((i) => i.lead_id === leadId && i.type === type && i.door_person_id === doorPersonId && (i.uitkomst || null) === (uitkomst || null)
      && Math.abs(new Date(i.started_at).getTime() - t) < 60000) || null;
  }
  return null;
}

/*
  Een belpoging vastleggen: het contactmoment (met opname- en transcriptverwijzing), de
  fase erna, de opvolgtaak uit de reeks, de bezwaren, de antwoorden, de extra's, de kans, de
  demo-afspraak en de queue-rij van vandaag. Alles in een keer, zodat een gesprek nooit half
  in het systeem staat. Met interactionId wordt een bestaand contactmoment (een opname zonder
  gesprek, een gesprek zonder uitkomst) afgerond in plaats van een nieuw gemaakt. Met een
  verzoekId geeft een herhaald verzoek het bestaande contactmoment terug.
*/
export async function registreerGesprek(adapter, {
  companyId, leadId, doorPersonId, personId, uitkomst, samenvatting, volgendeStap, opvolgDatum,
  demoDatum, demoTijd, demoVorm, demoDuur, duurSeconden, startedAt, opnameRef, transcriptRef, opnameToestemming, tags,
  bezwaar, bezwaarCategorie, reactie, reactieWerkte, bezwaren, extras = [], antwoorden = {}, kans,
  stap, scriptRef: scriptRefIn, verzoekId, interactionId: bestaandId, gepauzeerdTot, geenContactVia, problemen = [], orderId = null,
  afhaakmoment = null, aangeslagenOp = [], onboardingGedaan = [], blokkade = null,
  pipeline = FRAMR_PIPELINE, vandaag, nu = null, interacties, reeksen, taken,
} = {}) {
  if (!companyId || !leadId) throw new Error('registreerGesprek vereist companyId en leadId.');
  if (!doorPersonId) throw new Error('registreerGesprek vereist doorPersonId (wie belde).');
  const isService = stap === 'service';
  if (isService ? !SERVICE_UITKOMSTEN.includes(uitkomst) : !BELUITKOMSTEN.includes(uitkomst)) {
    throw new Error(isService ? `uitkomst '${uitkomst || ''}' is geen service-uitkomst. Kies ${SERVICE_UITKOMSTEN.join(', ')}.` : `uitkomst '${uitkomst || ''}' is geen vaste beluitkomst. Kies ${BELUITKOMSTEN.join(', ')}.`);
  }
  const regel = UITKOMST_REGELS[uitkomst];
  const dag = vandaag || dagVan(startedAt) || vandaagLokaal();
  if (regel.demoVerplicht && !demoDatum) {
    throw new Error('demo_ingepland vereist een demodatum (en liefst een tijd en vorm).');
  }
  if (regel.warm && !regel.opvolg && !regel.demoVerplicht && !opvolgDatum) {
    throw new Error(`uitkomst ${uitkomst} is warm: geef een opvolgdatum (geen warme lead zonder volgende actie).`);
  }

  /*
    Waar het gesprek strandde, waar het aansloeg en de onboardingstand (0114). Eerst controleren,
    dan pas schrijven: stond deze controle na het aanmaken van het contactmoment, dan liet een
    afgekeurde waarde een half record achter dat bij de volgende poging als herhaling terugkwam.
    De twee lijsten leven als veldoptie, dus ze kunnen met het script mee zonder migration.
  */
  if (afhaakmoment) await assertOptieToegestaan(adapter, { companyId, veld: 'afhaakmoment', waarde: afhaakmoment });
  const aangeslagen = (Array.isArray(aangeslagenOp) ? aangeslagenOp : [aangeslagenOp]).filter(Boolean);
  for (const w of aangeslagen) await assertOptieToegestaan(adapter, { companyId, veld: 'aangeslagen_op', waarde: w });
  const gedaan = (Array.isArray(onboardingGedaan) ? onboardingGedaan : [onboardingGedaan]).filter(Boolean);
  const onbekendeMijlpalen = gedaan.filter((m) => !ONBOARDING_MIJLPALEN.includes(m));
  if (onbekendeMijlpalen.length) {
    throw new Error(`onbekende mijlpaal: ${onbekendeMijlpalen.join(', ')}. Kies uit ${ONBOARDING_MIJLPALEN.join(', ')}.`);
  }

  const alle = interacties || (await adapter.fetchInteractions());
  const lead = await adapter.getLeadById(leadId);
  const naam = lead ? lead.naam : leadId;
  const alleFasen = await adapter.fetchPipelineFases();
  const huidigeFase = lead && lead.pipeline_fase_id ? (alleFasen.find((f) => f.id === lead.pipeline_fase_id) || {}).naam : null;

  const herhaling = bestaandId ? null : vindHerhaling(alle, { companyId, verzoekId, leadId, doorPersonId, type: 'call', uitkomst, startedAt });
  if (herhaling) {
    return { interactionId: herhaling.id, herhaald: true, fase: huidigeFase, taken: [], takenGesloten: 0, bezwaarIds: [], bezwaarId: null, antwoorden: 0, kansId: null, extras: [], pogingen: telPogingen(alle.filter((i) => i.lead_id === leadId), leadId), queueGesloten: 0 };
  }

  const pogingenVoor = telPogingen(alle.filter((i) => i.lead_id === leadId && i.id !== bestaandId), leadId);
  /* Een servicegesprek raakt de verkoopfase nooit; alleen niet meer benaderen sluit ook daar. */
  const faseNa = isService ? (uitkomst === 'niet_meer_benaderen' ? 'niet_meer_benaderen' : null) : bepaalFaseNaUitkomst({ uitkomst, pogingenVoor });
  const alleTaken = taken || (await adapter.fetchTasks());
  const alleAfspraken = adapter.fetchSalesAfspraken ? await adapter.fetchSalesAfspraken() : [];
  const gekozenStap = stap || kiesStap({
    fase: huidigeFase, openTaak: openTaken(alleTaken).find((t) => t.lead_id === leadId) || null,
    afspraak: alleAfspraken.find((a) => a.lead_id === leadId && ['gepland', 'verplaatst'].includes(a.status)) || null,
    laatsteInteractie: sorteerOpStart(alle.filter((i) => i.lead_id === leadId && i.type !== 'note'))[0] || null,
  });
  const scriptVersie = scriptRefIn || scriptRef(gekozenStap);
  /* Waarom dit gesprek: de reden van de beltaak die het afrondt, anders die van de stap. */
  const redenGesprek = (openTaken(alleTaken).find((t) => t.lead_id === leadId && t.contactreden && (isService ? t.task_type === 'service' : ['call', 'check_in'].includes(t.task_type || 'call'))) || {}).contactreden
    || contactredenVanStap(gekozenStap) || 'eerste_kennismaking';

  let contact;
  if (bestaandId) {
    const b = alle.find((i) => i.id === bestaandId);
    if (!b) throw new Error('het contactmoment om af te ronden bestaat niet.');
    const patch = { uitkomst, samenvatting: samenvatting || b.samenvatting || null, volgende_stap: volgendeStap || b.volgende_stap || null };
    if (duurSeconden) patch.duur_seconden = Number(duurSeconden);
    if (opnameRef) patch.opname_ref = opnameRef;
    if (transcriptRef) patch.transcript_ref = transcriptRef;
    if (personId) patch.person_id = personId;
    await adapter.updateInteraction(bestaandId, patch);
    contact = { id: bestaandId };
  } else {
    contact = await recordInteraction(adapter, {
      companyId, leadId, type: 'call', doorPersonId, personId, richting: 'uitgaand',
      startedAt: startedAt || `${dag}T12:00:00.000Z`, duurSeconden, samenvatting, uitkomst,
      volgendeStap, opnameRef, transcriptRef,
    });
  }
  const extra = { stap: gekozenStap, script_ref: scriptVersie, contactreden: redenGesprek };
  if (afhaakmoment) extra.afhaakmoment = afhaakmoment;
  if (aangeslagen.length) extra.aangeslagen_op = aangeslagen;
  if (gedaan.length) extra.onboarding_gedaan = gedaan;
  if (blokkade && String(blokkade).trim()) extra.blokkade = String(blokkade).trim();
  if (opnameToestemming !== undefined) extra.opname_toestemming = opnameToestemming;
  if (tags && tags.length) extra.tags = tags;
  if (verzoekId) extra.verzoek_id = verzoekId;
  if (adapter.updateInteraction) await adapter.updateInteraction(contact.id, extra);

  /* Dit gesprek was de opvolging: de open beltaken van deze lead zijn hiermee gedaan, en bij een
     eindfase gaan alle open taken dicht als vervallen. De nieuwe uitkomst maakt zo nodig een nieuwe taak. */
  const eind = EINDFASEN.has(faseNa);
  const oudeTaken = openTaken(alleTaken).filter((t) => t.lead_id === leadId && (eind || (isService ? t.task_type === 'service' : (t.task_type === 'call' || !t.task_type || t.task_type === 'check_in'))));
  const orderVanTaak = orderId || (oudeTaken.find((t) => t.order_id) || {}).order_id || null;
  for (const t of oudeTaken) {
    /* Het gesprek is gevoerd: een beltaak is bereikt of niet bereikt, een beoordeeltaak gedaan; bij een eindfase vervalt alles. */
    const resultaat = eind ? 'vervallen' : (t.task_type === 'check_in' ? 'gedaan' : (regel.bereikt ? 'bereikt' : 'niet_bereikt'));
    await adapter.updateTask(t.id, { status: 'done', resultaat, afgerond_op: nuIso(nu) });
  }
  /* Een reeks die op een reactie wachtte stopt zodra we de persoon zelf spreken. */
  if (regel.bereikt && !eind) {
    await sluitTaken(adapter, { leadId, kies: (t) => t.opvolg_reeks && !['call', 'check_in'].includes(t.task_type || 'call'), resultaat: 'vervangen', nu });
  }

  const alleBezwaren = [...(bezwaren || [])];
  if (bezwaar) alleBezwaren.unshift({ bezwaar, categorie: bezwaarCategorie, reactie, reactieWerkte });
  const bezwaarIds = await schrijfBezwaren(adapter, { companyId, leadId, interactionId: contact.id, bezwaren: alleBezwaren });

  /* Wat de beller te weten kwam, als discovery-antwoorden op dit contactmoment (bevestigd,
     want hij hoorde het zelf); een lege waarde is geen antwoord. */
  let antwoordenGeschreven = 0;
  for (const [veld, waarde] of Object.entries(antwoorden || {})) {
    if (waarde === undefined || waarde === null || String(waarde).trim() === '') continue;
    await recordDiscoveryAnswer(adapter, { companyId, leadId, interactionId: contact.id, veld, waarde: String(waarde).trim(), zekerheid: 'bevestigd', herkomst: 'beller' });
    antwoordenGeschreven += 1;
  }
  const extrasUit = await verwerkExtras(adapter, { companyId, leadId, interactionId: contact.id, doorPersonId, personId, startedAt: startedAt || `${dag}T12:00:00.000Z`, stap: gekozenStap, extras, leadNaam: naam, dag });

  /* Het volgende project als kans; een projectdatum maakt de beltaak twee dagen ervoor. */
  let kansId = null;
  if (kans && kans.naam) {
    const k = await recordOpportunity(adapter, {
      companyId, leadId, personId, naam: kans.naam, geschatM2: kans.geschatM2 ? Number(kans.geschatM2) : undefined,
      projectdatum: kans.projectdatum || undefined, stage: 'aanstaand',
    });
    kansId = k.id;
  }

  let fase = null;
  if (faseNa) fase = await setLeadFase(adapter, { companyId, leadId, faseNaam: faseNa, pipeline });

  const leadPatch = {};
  if (regel.pauzeer) leadPatch.gepauzeerd_tot = opvolgDatum || naarWerkdag(plusDagen(dag, (regel.opvolg || {}).dagen || 60));
  else if (gepauzeerdTot) leadPatch.gepauzeerd_tot = gepauzeerdTot;
  else if (regel.bereikt && lead && lead.gepauzeerd_tot) leadPatch.gepauzeerd_tot = null;
  if (Array.isArray(geenContactVia)) leadPatch.geen_contact_via = geenContactVia;
  /* De claim gaat los: het gesprek is vastgelegd. */
  if (lead && lead.in_behandeling_door === doorPersonId) { leadPatch.in_behandeling_door = null; leadPatch.in_behandeling_sinds = null; }
  if (Object.keys(leadPatch).length) await adapter.updateLead(leadId, leadPatch);

  const takenUit = [];
  const alleReeksen = reeksen || (adapter.fetchOpvolgreeksen ? await adapter.fetchOpvolgreeksen() : []);
  const opvolging = bepaalOpvolging({ uitkomst, opvolgDatum, vandaag: dag, faseNa, reeksen: alleReeksen, companyId });
  if (opvolging) {
    /* De oude beltaken zijn hierboven al met resultaat gesloten; een beltaak voor een projectdatum blijft staan.
       Bij service blijft een herhaalpoging een servicetaak, met de reden van dit gesprek. */
    const taakSoort = isService && (opvolging.taak || 'call') === 'call' && !(regel.opvolg && regel.opvolg.taak) ? 'service' : (opvolging.taak || 'call');
    const t = await maakSalesTaak(adapter, { companyId, leadId, leadNaam: naam, taak: taakSoort, dueDate: opvolging.dueDate, reden: opvolging.reden, assigneeId: doorPersonId, interactionId: contact.id, reeks: opvolging.reeks || null, stap: opvolging.stap || null, description: volgendeStap || samenvatting || null, vervangOpen: false, nu, contactreden: (regel.opvolg && regel.opvolg.contactreden) || (isService ? redenGesprek : contactredenNaUitkomst(uitkomst, redenGesprek)), orderId: isService ? orderVanTaak : null });
    takenUit.push(t);
  }
  /* Problemen uit een servicegesprek: elk een servicetaak bij een verantwoordelijke op een vervolgdatum,
     aan dezelfde bestelling, plus een notitie op de tijdlijn zodat de historie het draagt. */
  const problemenUit = [];
  for (const pr of problemen || []) {
    if (!pr || !String(pr.omschrijving || '').trim()) continue;
    const soort = PROBLEEM_SOORTEN.includes(pr.soort) ? pr.soort : 'anders';
    const omschrijving = String(pr.omschrijving).trim();
    const t = await maakSalesTaak(adapter, { companyId, leadId, leadNaam: naam, taak: 'service', dueDate: pr.vervolgdatum || naarWerkdag(plusDagen(dag, 2)), reden: `probleem (${soort}): ${omschrijving}`, assigneeId: pr.verantwoordelijkeId || doorPersonId, interactionId: contact.id, description: omschrijving, vervangOpen: false, nu, contactreden: 'probleem_oplossen', orderId: pr.orderId || orderVanTaak });
    const n = await recordInteraction(adapter, { companyId, leadId, type: 'note', doorPersonId, personId, richting: 'uitgaand', startedAt: startedAt || `${dag}T12:00:00.000Z`, samenvatting: `Probleem (${soort}): ${omschrijving}` });
    if (adapter.updateInteraction) await adapter.updateInteraction(n.id, { tags: ['probleem', soort], stap: 'service', contactreden: 'probleem_oplossen' });
    problemenUit.push({ taakId: t.id, dueDate: t.dueDate, soort, omschrijving, verantwoordelijke: pr.verantwoordelijkeId || doorPersonId });
    takenUit.push(t);
  }
  let afspraak = null;
  if (regel.demoVerplicht) {
    afspraak = await planDemo(adapter, { companyId, leadId, doorPersonId, datum: demoDatum, tijd: demoTijd, vorm: demoVorm, duurMinuten: demoDuur, interactionId: contact.id, pipeline, vandaag: dag, nu, viaGesprek: true });
    takenUit.push({ id: afspraak.taakId, dueDate: demoDatum, taak: 'demo', reden: 'demo afgesproken in het gesprek' });
  }

  const queue = await sluitQueueRij(adapter, { leadId, vandaag: dag });
  return {
    interactionId: contact.id, herhaald: false, fase: fase ? fase.naam : huidigeFase, stap: gekozenStap, scriptRef: scriptVersie, contactreden: redenGesprek, taken: takenUit, takenGesloten: oudeTaken.length, problemen: problemenUit,
    bezwaarIds, bezwaarId: bezwaarIds[0] || null, antwoorden: antwoordenGeschreven, extras: extrasUit, kansId, afspraakId: afspraak ? afspraak.afspraakId : null,
    pogingen: pogingenVoor + (regel.bereikt ? 0 : 1), queueGesloten: queue,
  };
}

/* ---------- berichten en reacties ---------- */

/*
  Een bericht vastleggen (WhatsApp of mail): het contactmoment met wat er precies gestuurd is
  (materiaal, link, tekst of template), de verzendstatus (bevestigd: met de hand als verstuurd
  bevestigd; een klik is geen bewijs), of een reactie verwacht wordt en tot wanneer. Sluit de
  open taak van dat kanaal, zet een lead die om informatie vroeg op informatie_verstuurd
  (nooit een lead die al verder is), en maakt uit de reeks de nabeltaak voor als er geen
  reactie komt. Versturen zelf doet de mens.
*/
export async function registreerBericht(adapter, {
  companyId, leadId, doorPersonId, personId, kanaal, materiaal, tekst, link, templateRef, stap, verzendStatus = 'bevestigd',
  reactieVerwacht = true, reactieTermijnDagen, reactieTermijn, gekoppeldAanId, reeks = 'informatie_verstuurd_geen_reactie',
  startedAt, pipeline = FRAMR_PIPELINE, vandaag, nu = null, fasen, verzoekId, reeksen,
} = {}) {
  if (!companyId || !leadId) throw new Error('registreerBericht vereist companyId en leadId.');
  if (!['whatsapp', 'email'].includes(kanaal)) throw new Error('kanaal moet whatsapp of email zijn.');
  if (!materiaal && !tekst && !templateRef) throw new Error('registreerBericht vereist materiaal, tekst of een template.');
  if (!VERZEND_STATUSSEN.includes(verzendStatus)) throw new Error(`verzendstatus '${verzendStatus}' is onbekend. Kies ${VERZEND_STATUSSEN.join(', ')}.`);
  const dag = vandaag || vandaagLokaal();
  const start = startedAt || `${dag}T12:00:00.000Z`;
  const alle = await adapter.fetchInteractions();
  const herhaling = vindHerhaling(alle, { companyId, verzoekId, leadId, doorPersonId, type: kanaal, uitkomst: null, startedAt: verzoekId ? null : startedAt });
  if (herhaling) return { interactionId: herhaling.id, herhaald: true, fase: null, takenGesloten: 0, taak: null };

  const t = templateRef ? templateVoor(templateRef) : null;
  const mat = materiaal || (t ? t.materiaal : 'persoonlijk_bericht');
  const samenvatting = tekst || [`${mat} gestuurd via ${kanaal}`, link ? `link ${link}` : null].filter(Boolean).join(' | ');
  const contact = await recordInteraction(adapter, {
    companyId, leadId, type: kanaal, doorPersonId, personId, richting: 'uitgaand', startedAt: start, samenvatting,
  });
  const termijn = reactieVerwacht ? (reactieTermijn || plusWerkdagen(dag, reactieTermijnDagen !== undefined ? Number(reactieTermijnDagen) : (t && t.reactieTermijnDagen) || 3)) : null;
  const patch = {
    materiaal: mat, link: link || null, template_ref: templateRef || null, verzend_status: verzendStatus, reactie_verwacht: Boolean(reactieVerwacht),
    reactie_termijn: termijn, stap: stap || (t ? t.stap : null) || null, script_ref: templateRef || null,
    contactreden: ['demo_uitnodiging', 'afspraakbevestiging'].includes(mat) ? 'demo_plannen'
      : (mat === 'accountlink' ? 'helpen_bij_eerste_project'
        : (mat === 'persoonlijk_bericht' && contactredenVanStap(stap || (t ? t.stap : null)) ? contactredenVanStap(stap || (t ? t.stap : null)) : 'informatie_sturen')),
  };
  if (verzoekId) patch.verzoek_id = verzoekId;
  if (gekoppeldAanId) patch.opportunity_id = null;
  await adapter.updateInteraction(contact.id, patch);

  /* De opvolgtaak voor dit kanaal is hiermee gedaan. */
  const gesloten = await sluitTaken(adapter, { leadId, kies: (x) => x.task_type === kanaal, resultaat: 'gedaan', nu });

  let fase = null;
  const lead = await adapter.getLeadById(leadId);
  const naam = lead ? lead.naam : leadId;
  const alleFasen = fasen || (await adapter.fetchPipelineFases());
  const huidige = lead && lead.pipeline_fase_id ? alleFasen.find((f) => f.id === lead.pipeline_fase_id) : null;
  if (['landingspagina', 'demo_video', 'margecalculator', 'prijsvoorbeeld', 'productcatalogus'].includes(mat)
    && (!huidige || ['gesproken', 'te_bellen', 'nieuwe_lead', 'eerste_poging', 'niet_bereikt'].includes(huidige.naam))) {
    fase = await setLeadFase(adapter, { companyId, leadId, faseNaam: 'informatie_verstuurd', pipeline });
  }

  /* Geen reactie binnen de termijn: de reeks bepaalt de volgende stap. Een concreet volgend
     contactmoment (een demo, een terugbelafspraak) gaat voor: dan geen nabeltaak erbij. */
  let taak = null;
  if (reactieVerwacht && reeks && !EINDFASEN.has(huidige ? huidige.naam : null)) {
    const open = openTaken(await adapter.fetchTasks()).filter((x) => x.lead_id === leadId && ['call', 'demo'].includes(x.task_type) && dagVan(x.due_date || x.due_at) && dagVan(x.due_date || x.due_at) > dag);
    const afspraken = adapter.fetchSalesAfspraken ? (await adapter.fetchSalesAfspraken()).filter((a) => a.lead_id === leadId && ['gepland', 'verplaatst'].includes(a.status)) : [];
    if (!open.length && !afspraken.length) {
      const r = reeksVoor(reeksen || (adapter.fetchOpvolgreeksen ? await adapter.fetchOpvolgreeksen() : []), reeks, companyId);
      const s = r ? stapUitReeks({ reeks: r, volgnummer: 1, vanafDag: dag }) : null;
      if (s) {
        const dueDate = reactieTermijn ? naarWerkdag(reactieTermijn) : (reactieTermijnDagen !== undefined ? termijn : s.dueDate);
        taak = await maakSalesTaak(adapter, { companyId, leadId, leadNaam: naam, taak: s.taak, dueDate, reden: s.reden, assigneeId: doorPersonId, interactionId: contact.id, reeks: s.reeks, stap: s.stap, vervangOpen: false, nu });
      }
    }
  }
  return { interactionId: contact.id, herhaald: false, fase: fase ? fase.naam : null, takenGesloten: gesloten, taak, reactieTermijn: termijn, verzendStatus };
}

/* De oude naam, voor de CLI en de nepdata: verstuurd materiaal vastleggen. */
export async function registreerVerstuurd(adapter, args = {}) {
  return registreerBericht(adapter, args);
}

/*
  Een inkomende reactie vastleggen (WhatsApp, mail of een telefoontje van hem): het inkomende
  contactmoment, het bericht waar het een reactie op is krijgt reactie_ontvangen_op, de
  geen-reactie-opvolging stopt (resultaat reactie_ontvangen), en er komt een taak om de
  reactie op te volgen, standaard vandaag.
*/
export async function registreerReactie(adapter, {
  companyId, leadId, doorPersonId, personId, kanaal = 'whatsapp', tekst, startedAt, vandaag, nu = null, opBerichtId,
  volgende = { taak: 'call', dagen: 0, reden: 'reactie ontvangen, opvolgen' }, verzoekId, uitkomst,
} = {}) {
  if (!companyId || !leadId) throw new Error('registreerReactie vereist companyId en leadId.');
  if (!['whatsapp', 'email', 'call'].includes(kanaal)) throw new Error('kanaal moet whatsapp, email of call zijn.');
  const dag = vandaag || vandaagLokaal();
  const start = startedAt || `${dag}T12:00:00.000Z`;
  const alle = await adapter.fetchInteractions();
  const herhaling = vindHerhaling(alle, { companyId, verzoekId, leadId, doorPersonId, type: kanaal, uitkomst: null, startedAt: verzoekId ? null : startedAt });
  if (herhaling && herhaling.richting === 'inkomend') return { interactionId: herhaling.id, herhaald: true, berichten: 0, takenGesloten: 0, taak: null };

  const contact = await recordInteraction(adapter, { companyId, leadId, type: kanaal, doorPersonId, personId, richting: 'inkomend', startedAt: start, samenvatting: tekst || null, uitkomst: uitkomst || undefined });
  const patch = { stap: 'reactie' };
  if (verzoekId) patch.verzoek_id = verzoekId;
  await adapter.updateInteraction(contact.id, patch);

  /* Het bericht waarop dit een reactie is: het opgegeven, anders elk open uitgaand bericht. */
  const open = sorteerOpStart(alle.filter((i) => i.lead_id === leadId && ['whatsapp', 'email'].includes(i.type) && i.richting !== 'inkomend' && i.reactie_verwacht === true && !i.reactie_ontvangen_op));
  const doel = opBerichtId ? open.filter((i) => i.id === opBerichtId) : open;
  for (const b of doel) await adapter.updateInteraction(b.id, { reactie_ontvangen_op: start, reactie_interaction_id: contact.id });

  const gesloten = await sluitTaken(adapter, { leadId, kies: (t) => Boolean(t.opvolg_reeks) && GEEN_REACTIE_REEKSEN.has(t.opvolg_reeks), resultaat: 'reactie_ontvangen', nu });

  let taak = null;
  if (volgende && volgende.taak) {
    const lead = await adapter.getLeadById(leadId);
    const dueDate = volgende.dueDate || plusWerkdagen(dag, Number(volgende.dagen || 0));
    taak = await maakSalesTaak(adapter, { companyId, leadId, leadNaam: lead ? lead.naam : leadId, taak: volgende.taak, dueDate, reden: volgende.reden || 'reactie ontvangen, opvolgen', assigneeId: doorPersonId, interactionId: contact.id, vervangOpen: false, nu, contactreden: 'opvolgen_na_informatie' });
  }
  return { interactionId: contact.id, herhaald: false, berichten: doel.length, takenGesloten: gesloten, taak };
}

/* ---------- de demo: afspraak met tijd, levensloop, briefing, afronden ---------- */

/*
  De briefing voor de demo of de opvolging: wat we al weten uit de gesprekken en berichten,
  zodat we niet alles opnieuw vragen. Bekende antwoorden per veld met bron en zekerheid, de
  bezwaren, de kansen, het laatste gesprek, de verstuurde berichten en de afspraken uit de
  demo zelf; plus de demovelden die nog open staan.
*/
export function bouwDemoBriefing({ lead, discovery = [], bezwaren = [], kansen = [], interacties = [], vragen = [], afspraak = null, people = [] } = {}) {
  const naamVan = new Map(people.map((p) => [p.id, p.name]));
  const leadId = lead ? lead.id : null;
  const eigen = (rijen) => rijen.filter((r) => r.lead_id === leadId);
  const perVeld = new Map();
  for (const a of [...eigen(discovery)].sort((x, y) => String(x.created_at || '').localeCompare(String(y.created_at || '')))) {
    const h = perVeld.get(a.veld);
    if (!h || a.zekerheid === 'bevestigd' || h.zekerheid !== 'bevestigd') perVeld.set(a.veld, a);
  }
  const bekend = [...perVeld.values()].map((a) => ({ veld: a.veld, waarde: a.waarde, zekerheid: a.zekerheid, herkomst: a.herkomst, wanneer: dagVan(a.created_at) })).sort((x, y) => x.veld.localeCompare(y.veld));
  const gesprekken = sorteerOpStart(eigen(interacties).filter((i) => ['call', 'demo'].includes(i.type) && i.uitkomst));
  const laatsteGesprek = gesprekken[0] ? { dag: dagVan(gesprekken[0].started_at), type: gesprekken[0].type, uitkomst: gesprekken[0].uitkomst, samenvatting: gesprekken[0].samenvatting || null, volgendeStap: gesprekken[0].volgende_stap || null, door: naamVan.get(gesprekken[0].door_person_id) || null } : null;
  const laatsteDemo = gesprekken.find((i) => i.type === 'demo') || null;
  const berichten = sorteerOpStart(eigen(interacties).filter((i) => ['whatsapp', 'email'].includes(i.type))).slice(0, 5).map((i) => ({ dag: dagVan(i.started_at), type: i.type, richting: i.richting || 'uitgaand', materiaal: i.materiaal || null, link: i.link || null, samenvatting: i.samenvatting || null, reactie: i.reactie_ontvangen_op ? dagVan(i.reactie_ontvangen_op) : null }));
  const bezw = eigen(bezwaren).map((b) => ({ bezwaar: b.bezwaar, categorie: b.categorie || null, reactie: b.gegeven_reactie || null, resultaat: b.reactie_resultaat || (b.reactie_werkte === true ? 'ja' : (b.reactie_werkte === false ? 'nee' : null)), soort: b.soort || null, afspraak: b.afspraak || null, dag: dagVan(b.created_at) }));
  const kans = eigen(kansen).map((k) => ({ naam: k.naam, m2: k.geschat_m2 || null, datum: k.projectdatum ? dagVan(k.projectdatum) : null, stage: k.stage }));
  const openVragen = eigen(vragen).filter((q) => !q.antwoord).map((q) => q.vraag);
  const demoVelden = ['huidige_vloerleverancier', 'tevredenheid_leverancier', 'hoe_inmeten', 'hoe_offertes', 'huidige_software', 'koopt_zelf_in', 'marge_op_materiaal', 'projecten_per_maand', 'm2_per_maand', 'besliscriteria'];
  const onbekend = demoVelden.filter((v) => !perVeld.has(v));
  const wil = (v) => (perVeld.get(v) || {}).waarde || null;
  const regels = [];
  if (laatsteGesprek) regels.push(`Laatste ${laatsteGesprek.type === 'demo' ? 'demo' : 'gesprek'} ${laatsteGesprek.dag} (${laatsteGesprek.uitkomst.replace(/_/g, ' ')})${laatsteGesprek.samenvatting ? `: ${laatsteGesprek.samenvatting}` : ''}`);
  if (laatsteDemo && laatsteDemo.volgende_stap) regels.push(`Afgesproken in de demo: ${laatsteDemo.volgende_stap}`);
  if (wil('wil_wel')) regels.push(`Wil wel: ${wil('wil_wel')}`);
  if (wil('wil_niet')) regels.push(`Wil niet: ${wil('wil_niet')}`);
  if (wil('waarom')) regels.push(`Waarom: ${wil('waarom')}`);
  for (const b of bekend.filter((x) => !['wil_wel', 'wil_niet', 'waarom'].includes(x.veld))) regels.push(`${b.veld.replace(/_/g, ' ')}: ${b.waarde}${b.zekerheid !== 'bevestigd' ? ` (${b.zekerheid})` : ''}`);
  for (const b of bezw) regels.push(`Bezwaar: "${b.bezwaar}"${b.reactie ? `, reactie: ${b.reactie}` : ''}${b.resultaat ? ` (${b.resultaat})` : ''}`);
  for (const k of kans) regels.push(`Project: ${k.naam}${k.m2 ? `, ${k.m2} m2` : ''}${k.datum ? `, ${k.datum}` : ''}`);
  for (const b of berichten.filter((x) => x.richting !== 'inkomend')) regels.push(`Gestuurd ${b.dag} via ${b.type}: ${b.materiaal || b.samenvatting || ''}${b.reactie ? `, reactie op ${b.reactie}` : ''}`);
  if (onbekend.length) regels.push(`Nog te vragen: ${onbekend.map((v) => v.replace(/_/g, ' ')).join(', ')}`);
  return { bekend, wilWel: wil('wil_wel'), wilNiet: wil('wil_niet'), waarom: wil('waarom'), laatsteGesprek, demoAfspraken: laatsteDemo ? laatsteDemo.volgende_stap || null : null, berichten, bezwaren: bezw, kansen: kans, openVragen, onbekend, afspraak: afspraak ? { dag: dagVan(afspraak.start_at), tijd: tijdVan(afspraak.start_at), vorm: afspraak.vorm, doel: afspraak.doel } : null, tekst: regels.join('\n') };
}

/*
  Een demo plannen, verplaatsen of bevestigen, overal via deze ene functie: de afspraak met
  datum, tijd, duur, vorm, locatie of link, doel, deelnemers en verantwoordelijke; de taak
  (type demo) als werkitem op die dag en tijd; de fase demo_gepland. Heeft de lead al een
  open afspraak, dan is dit een verplaatsing van die afspraak (geen tweede record, geen
  tweede taak). Een open taak uit de reeks demo_aangeboden gaat dicht als gedaan.
*/
export async function planDemo(adapter, {
  companyId, leadId, doorPersonId, datum, tijd = '10:00', duurMinuten = 45, vorm, locatie, link, doel, deelnemers, voorbereiding,
  verantwoordelijkeId, opportunityId, interactionId, reden, pipeline = FRAMR_PIPELINE, vandaag, nu = null, viaGesprek = false, afspraakId,
} = {}) {
  if (!companyId || !leadId) throw new Error('planDemo vereist companyId en leadId.');
  if (!datum) throw new Error('planDemo vereist een datum JJJJ-MM-DD.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(datum))) throw new Error('de demodatum moet JJJJ-MM-DD zijn.');
  if (tijd && !/^\d{1,2}:\d{2}$/.test(String(tijd))) throw new Error('de demotijd moet UU:MM zijn.');
  const lead = await adapter.getLeadById(leadId);
  const naam = lead ? lead.naam : leadId;
  const startAt = tijdstipVan(datum, tijd || '10:00');
  const wie = verantwoordelijkeId || doorPersonId || null;
  const alleAfspraken = adapter.fetchSalesAfspraken ? await adapter.fetchSalesAfspraken() : [];
  const open = alleAfspraken.find((a) => a.lead_id === leadId && (afspraakId ? a.id === afspraakId : ['gepland', 'verplaatst'].includes(a.status)));
  const velden = { start_at: startAt, duur_minuten: duurMinuten ? Number(duurMinuten) : null, vorm: vorm || null, locatie: locatie || null, link: link || null, doel: doel || null, deelnemers: deelnemers || null, verantwoordelijke: wie };
  if (voorbereiding !== undefined) velden.voorbereiding = voorbereiding;
  else if (!open) {
    const b = bouwDemoBriefing({ lead, discovery: await adapter.fetchDiscoveryAnswers(), bezwaren: await adapter.fetchObjections(), kansen: await adapter.fetchOpportunities(), interacties: await adapter.fetchInteractions(), vragen: await adapter.fetchQuestions() });
    velden.voorbereiding = b.tekst || null;
  }
  if (opportunityId) velden.opportunity_id = opportunityId;

  let taakId;
  let id;
  let verplaatst = false;
  if (open) {
    verplaatst = String(dagVan(open.start_at)) !== String(datum) || tijdVan(open.start_at) !== (tijd || '10:00');
    await adapter.updateSalesAfspraak(open.id, { ...velden, status: verplaatst ? 'verplaatst' : open.status, reden: reden || open.reden || null });
    id = open.id;
    if (open.task_id) {
      await adapter.updateTask(open.task_id, { due_date: datum, due_at: startAt, reden: `demo ${vorm || open.vorm || ''}`.trim(), assignee: wie, description: doel || null });
      taakId = open.task_id;
    }
  }
  if (!taakId) {
    const t = await maakSalesTaak(adapter, { companyId, leadId, leadNaam: naam, taak: 'demo', dueDate: datum, dueAt: startAt, reden: `demo ${vorm || ''}`.trim(), assigneeId: wie, interactionId: interactionId || null, description: doel || null, vervangOpen: true, nu, contactreden: 'demo_uitvoeren' });
    taakId = t.id;
  }
  if (!open) {
    const a = await adapter.insertSalesAfspraak({ company_id: companyId, lead_id: leadId, task_id: taakId, interaction_id: interactionId || null, soort: 'demo', status: 'gepland', ...velden });
    id = a.id;
  }
  /* De reeks demo aangeboden is hiermee klaar, en een losse beltaak om de demo te plannen ook. */
  await sluitTaken(adapter, { leadId, kies: (t) => t.task_type !== 'demo' && (t.opvolg_reeks === 'demo_aangeboden_niet_gepland' || /demo/i.test(String(t.reden || ''))), resultaat: 'gedaan', nu });
  const fase = await setLeadFase(adapter, { companyId, leadId, faseNaam: 'demo_gepland', pipeline });
  return { afspraakId: id, taakId, fase: fase.naam, startAt, dag: datum, tijd: tijd || '10:00', verplaatst, viaGesprek };
}

/*
  Een demo annuleren of als niet verschenen registreren: de afspraak krijgt de status, de
  demotaak gaat dicht als vervallen, de lead terug naar gekwalificeerd, en de opvolging komt
  uit de reeks (niet_verschenen_bij_demo) of is een beltaak over twee werkdagen.
*/
export async function annuleerDemo(adapter, { companyId, afspraakId, leadId, reden, nietVerschenen = false, doorPersonId, pipeline = FRAMR_PIPELINE, vandaag, nu = null, reeksen } = {}) {
  const dag = vandaag || vandaagLokaal();
  const alle = adapter.fetchSalesAfspraken ? await adapter.fetchSalesAfspraken() : [];
  const a = afspraakId ? alle.find((x) => x.id === afspraakId) : alle.find((x) => x.lead_id === leadId && ['gepland', 'verplaatst'].includes(x.status));
  if (!a) throw new Error('geen open demo-afspraak gevonden.');
  const status = nietVerschenen ? 'niet_verschenen' : 'geannuleerd';
  await adapter.updateSalesAfspraak(a.id, { status, reden: reden || null });
  const gesloten = await sluitTaken(adapter, { leadId: a.lead_id, kies: (t) => t.task_type === 'demo', resultaat: 'vervallen', nu });
  const lead = await adapter.getLeadById(a.lead_id);
  const fase = await setLeadFase(adapter, { companyId, leadId: a.lead_id, faseNaam: 'gekwalificeerd', pipeline });
  let taak = null;
  if (nietVerschenen) {
    const r = reeksVoor(reeksen || (adapter.fetchOpvolgreeksen ? await adapter.fetchOpvolgreeksen() : []), 'niet_verschenen_bij_demo', companyId);
    const s = r ? stapUitReeks({ reeks: r, volgnummer: 1, vanafDag: dag }) : null;
    if (s) taak = await maakSalesTaak(adapter, { companyId, leadId: a.lead_id, leadNaam: lead ? lead.naam : a.lead_id, taak: s.taak, dueDate: s.dueDate, reden: s.reden, assigneeId: doorPersonId || a.verantwoordelijke || null, reeks: s.reeks, stap: s.stap, nu });
  } else {
    taak = await maakSalesTaak(adapter, { companyId, leadId: a.lead_id, leadNaam: lead ? lead.naam : a.lead_id, taak: 'call', dueDate: plusWerkdagen(dag, 2), reden: 'demo geannuleerd, nieuw moment afspreken', assigneeId: doorPersonId || a.verantwoordelijke || null, nu });
  }
  return { afspraakId: a.id, status, fase: fase.naam, takenGesloten: gesloten, taak };
}

/*
  Een demo afronden: het contactmoment van het type demo, de samenvatting in onderdelen (wat is
  getoond, wat begreep hij, wat was relevant, het aha-moment, wat eerst opgelost moet worden)
  als discovery-antwoorden, de bezwaren en extra's, de scores per getoond onderdeel in
  demo_evaluaties (0105), de afspraak op uitgevoerd, de demotaak op klaar, de fase erna, en de
  concrete volgende stap met eigenaar en datum (of de reeks demo_uitgevoerd). Geen demo zonder
  opvolging. De uitgebreide evaluatie is optioneel.
*/
export async function registreerDemoGedaan(adapter, {
  companyId, leadId, doorPersonId, personId, taakId, afspraakId, samenvatting, uitkomst, koopkans, antwoorden = {}, bezwaren = [], extras = [],
  onderdelen = [], volgende, opvolgDatum, volgendeStap, startedAt, duurSeconden, opnameRef, opnameToestemming, verzoekId,
  pipeline = FRAMR_PIPELINE, vandaag, nu = null, reeksen,
} = {}) {
  if (!companyId || !leadId || !doorPersonId) throw new Error('registreerDemoGedaan vereist companyId, leadId en doorPersonId.');
  const dag = vandaag || dagVan(startedAt) || vandaagLokaal();
  if (uitkomst && !['account_gewenst', 'goede_interesse', 'mogelijk_interesse', 'later_terugbellen', 'geen_interesse', 'nu_geen_behoefte', 'geen_match', 'niet_meer_benaderen'].includes(uitkomst)) {
    throw new Error('de uitkomst van een demo is account_gewenst, goede_interesse, mogelijk_interesse, later_terugbellen, nu_geen_behoefte, geen_match, geen_interesse of niet_meer_benaderen.');
  }
  const alle = await adapter.fetchInteractions();
  const herhaling = vindHerhaling(alle, { companyId, verzoekId, leadId, doorPersonId, type: 'demo', uitkomst, startedAt: verzoekId ? null : startedAt });
  if (herhaling) return { interactionId: herhaling.id, herhaald: true, fase: null, antwoorden: 0, evaluaties: 0, demotakenGesloten: 0, taken: [], queueGesloten: 0 };
  const lead = await adapter.getLeadById(leadId);
  const naam = lead ? lead.naam : leadId;
  const contact = await recordInteraction(adapter, {
    companyId, leadId, type: 'demo', doorPersonId, personId, richting: 'uitgaand',
    startedAt: startedAt || `${dag}T12:00:00.000Z`, duurSeconden, samenvatting, uitkomst, volgendeStap: volgendeStap || (volgende ? volgende.reden : undefined), opnameRef,
  });
  const patch = { stap: 'demo', script_ref: scriptRef('demo'), contactreden: 'demo_uitvoeren' };
  if (koopkans !== undefined && koopkans !== null && koopkans !== '') patch.koopkans = Math.max(0, Math.min(100, Number(koopkans)));
  if (opnameToestemming !== undefined) patch.opname_toestemming = opnameToestemming;
  if (verzoekId) patch.verzoek_id = verzoekId;
  if (adapter.updateInteraction) await adapter.updateInteraction(contact.id, patch);
  let antwoordenGeschreven = 0;
  for (const [veld, waarde] of Object.entries(antwoorden)) {
    if (waarde === undefined || waarde === null || String(waarde).trim() === '') continue;
    await recordDiscoveryAnswer(adapter, { companyId, leadId, interactionId: contact.id, veld, waarde: String(waarde).trim(), zekerheid: 'bevestigd', herkomst: 'beller' });
    antwoordenGeschreven += 1;
  }
  const bezwaarIds = await schrijfBezwaren(adapter, { companyId, leadId, interactionId: contact.id, bezwaren });
  const extrasUit = await verwerkExtras(adapter, { companyId, leadId, interactionId: contact.id, doorPersonId, personId, startedAt: startedAt || `${dag}T12:00:00.000Z`, stap: 'demo', extras, leadNaam: naam, dag });
  let evaluaties = 0;
  for (const o of onderdelen) {
    if (!o || !o.onderdeel) continue;
    const score = (v) => (v === undefined || v === null || v === '' ? null : Math.max(1, Math.min(5, Number(v))));
    await adapter.insertDemoEvaluatie({
      company_id: companyId, lead_id: leadId, interaction_id: contact.id, onderdeel: o.onderdeel,
      getoond: o.getoond !== false, begrepen: o.begrepen === undefined || o.begrepen === null ? null : Boolean(o.begrepen),
      relevantie: score(o.relevantie), gebruiksgemak: score(o.gebruiksgemak), vertrouwen: score(o.vertrouwen),
      reactie: o.reactie || null, verbeterpunt: o.verbeterpunt || null, bug: o.bug || null,
    });
    evaluaties += 1;
  }
  /* De afspraak is uitgevoerd en de demotaak is gedaan: de opgegeven, of anders elke open van deze lead. */
  const alleAfspraken = adapter.fetchSalesAfspraken ? await adapter.fetchSalesAfspraken() : [];
  const afspraak = alleAfspraken.find((a) => (afspraakId ? a.id === afspraakId : a.lead_id === leadId && ['gepland', 'verplaatst'].includes(a.status)));
  if (afspraak) await adapter.updateSalesAfspraak(afspraak.id, { status: 'uitgevoerd', interaction_id: contact.id });
  const gesloten = await sluitTaken(adapter, { leadId, kies: (t) => t.task_type === 'demo' && (!taakId || t.id === taakId), resultaat: 'gedaan', nu });

  const faseNa = uitkomst === 'account_gewenst' ? 'account_aangeboden'
    : (['geen_interesse', 'geen_match'].includes(uitkomst) ? 'verloren' : (uitkomst === 'niet_meer_benaderen' ? 'niet_meer_benaderen' : (uitkomst === 'nu_geen_behoefte' ? 'later_benaderen' : 'demo_afgerond')));
  const fase = await setLeadFase(adapter, { companyId, leadId, faseNaam: faseNa, pipeline });
  const leadPatch = {};
  if (uitkomst === 'nu_geen_behoefte') leadPatch.gepauzeerd_tot = opvolgDatum || naarWerkdag(plusDagen(dag, 60));
  if (lead && lead.in_behandeling_door === doorPersonId) { leadPatch.in_behandeling_door = null; leadPatch.in_behandeling_sinds = null; }
  if (Object.keys(leadPatch).length) await adapter.updateLead(leadId, leadPatch);

  const taken = [];
  if (EINDFASEN.has(faseNa)) {
    await sluitTaken(adapter, { leadId, resultaat: 'vervallen', nu });
  } else {
    let plan = null;
    if (volgende && volgende.taak) plan = { taak: volgende.taak, dueDate: volgende.dueDate || opvolgDatum || plusWerkdagen(dag, Number(volgende.dagen || 2)), reden: volgende.reden || 'na de demo opvolgen', wie: volgende.wie || doorPersonId, tijd: volgende.tijd || null };
    else if (uitkomst === 'account_gewenst') plan = { taak: 'onboarding', dueDate: opvolgDatum || naarWerkdag(dag), reden: 'na de demo: account inrichten en eerste project begeleiden', wie: doorPersonId };
    else if (uitkomst === 'nu_geen_behoefte') plan = { taak: 'call', dueDate: opvolgDatum || naarWerkdag(plusDagen(dag, 60)), reden: 'nu geen behoefte na de demo, later opnieuw peilen', wie: doorPersonId };
    else {
      const r = reeksVoor(reeksen || (adapter.fetchOpvolgreeksen ? await adapter.fetchOpvolgreeksen() : []), 'demo_uitgevoerd', companyId);
      const s = r ? stapUitReeks({ reeks: r, volgnummer: 1, vanafDag: dag }) : null;
      plan = s ? { taak: s.taak, dueDate: opvolgDatum || s.dueDate, reden: s.reden, wie: doorPersonId, reeks: s.reeks, stap: s.stap } : { taak: 'call', dueDate: opvolgDatum || plusWerkdagen(dag, 2), reden: 'na de demo opvolgen', wie: doorPersonId };
    }
    const t = await maakSalesTaak(adapter, { companyId, leadId, leadNaam: naam, taak: plan.taak, dueDate: plan.dueDate, dueAt: plan.tijd ? tijdstipVan(plan.dueDate, plan.tijd) : null, reden: plan.reden, assigneeId: plan.wie, interactionId: contact.id, reeks: plan.reeks || null, stap: plan.stap || null, description: samenvatting || null, vervangOpen: false, nu });
    taken.push(t);
  }
  const queue = await sluitQueueRij(adapter, { leadId, vandaag: dag });
  return { interactionId: contact.id, herhaald: false, fase: fase.naam, antwoorden: antwoordenGeschreven, bezwaarIds, extras: extrasUit, evaluaties, demotakenGesloten: gesloten, afspraakId: afspraak ? afspraak.id : null, taken, queueGesloten: queue };
}

/* ---------- opnames: koppelen aan een contactmoment ---------- */

/*
  Een opname koppelen aan een specifiek contactmoment: het bestand komt in bijlage_refs (meer
  bestanden per gesprek kan), opname_ref wijst naar het eerste, de toestemming staat op de rij.
  De bytes staan nooit in de database, alleen de verwijzing.
*/
export async function koppelOpname(adapter, { interactionId, ref, naam, bytes, mime, duurSeconden, toestemming, nu = null } = {}) {
  if (!interactionId || !ref) throw new Error('koppelOpname vereist interactionId en ref.');
  const alle = await adapter.fetchInteractions();
  const i = alle.find((x) => x.id === interactionId);
  if (!i) throw new Error('contactmoment niet gevonden.');
  const bestaande = Array.isArray(i.bijlage_refs) ? i.bijlage_refs : [];
  if (bestaande.some((b) => b && b.ref === ref)) return { interactionId, opnames: bestaande.length, herhaald: true };
  const bijlage = { soort: 'opname', ref, naam: naam || null, bytes: bytes || null, mime: mime || null, duurSeconden: duurSeconden || null, geuploadOp: nuIso(nu), status: 'geupload' };
  const patch = { bijlage_refs: [...bestaande, bijlage] };
  if (!i.opname_ref) patch.opname_ref = ref;
  if (toestemming !== undefined && toestemming !== null) patch.opname_toestemming = Boolean(toestemming);
  await adapter.updateInteraction(interactionId, patch);
  return { interactionId, opnames: bestaande.length + 1, herhaald: false, eerste: !i.opname_ref };
}

/* Een contactmoment zonder uitkomst (een opname of een gesprek dat nog administratief afgerond
   moet worden); het komt op Vandaag onder af te ronden. */
export async function maakLosContactmoment(adapter, { companyId, leadId, doorPersonId, personId, type = 'call', startedAt, samenvatting, stap, vandaag } = {}) {
  if (!companyId || !leadId || !doorPersonId) throw new Error('maakLosContactmoment vereist companyId, leadId en doorPersonId.');
  const dag = vandaag || dagVan(startedAt) || vandaagLokaal();
  const c = await recordInteraction(adapter, { companyId, leadId, type, doorPersonId, personId, richting: 'uitgaand', startedAt: startedAt || `${dag}T12:00:00.000Z`, samenvatting });
  if (stap && adapter.updateInteraction) await adapter.updateInteraction(c.id, { stap, script_ref: scriptRef(stap), contactreden: contactredenVanStap(stap) });
  return { interactionId: c.id };
}

/* ---------- service: de bevestigde levering en de servicetaak ---------- */

const normaal = (v) => String(v || '').toLowerCase().replace(/\b(bv|b\.v\.|vof|v\.o\.f\.|de|het)\b/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

/* De lead die bij een partner in het portaal hoort: op verwijzing, anders op naam. */
export function leadVoorPartner(leads = [], partner) {
  if (!partner) return null;
  return leads.find((l) => l.portal_partner_ref && String(l.portal_partner_ref) === String(partner.id))
    || leads.find((l) => normaal(l.naam) && normaal(l.naam) === normaal(partner.bedrijfsnaam)) || null;
}

/*
  Een levering bevestigen (aanvulling onderdeel 3): de bestelling krijgt het bevestigde levermoment
  met bron en wie, en er komt een servicetaak (bestelling geleverd, vragen hoe het ging) twee
  werkdagen later bij de eigenaar van de lead of een aangewezen servicemedewerker, aan de
  bestelling gehangen. Een verwachte leverdatum bevestigt niets; dit is een bewuste handeling of
  een melding van de winkelkoppeling. Een tweede bevestiging maakt geen tweede taak.
*/
export async function bevestigLevering(adapter, { companyId, orderId, doorPersonId, bron = 'handmatig', geleverdOp, assigneeId = null, vandaag, nu = null } = {}) {
  if (!companyId || !orderId) throw new Error('bevestigLevering vereist companyId en orderId.');
  if (!['shopify', 'handmatig'].includes(bron)) throw new Error('bron is shopify of handmatig.');
  const dag = vandaag || vandaagLokaal();
  const orders = await adapter.fetchPortalOrders();
  const order = orders.find((o) => o.id === orderId);
  if (!order) throw new Error('bestelling niet gevonden.');
  const partners = adapter.fetchPortalPartners ? await adapter.fetchPortalPartners() : [];
  const partner = partners.find((p) => p.id === order.partner_id) || null;
  const lead = leadVoorPartner((await adapter.fetchLeads()).filter((l) => !companyId || l.company_id === companyId), partner);
  const moment = geleverdOp || nuIso(nu) || `${dag}T12:00:00.000Z`;
  if (!order.geleverd_op) await adapter.updatePortalOrder(orderId, { geleverd_op: moment, geleverd_bron: bron, geleverd_door: bron === 'handmatig' ? doorPersonId || null : null });
  if (!lead) return { orderId, leadId: null, taak: null, alBevestigd: Boolean(order.geleverd_op), reden: 'geen lead bij deze partner; geen servicetaak' };
  const bestaand = openTaken(await adapter.fetchTasks()).find((t) => t.order_id === orderId && t.task_type === 'service');
  if (bestaand) return { orderId, leadId: lead.id, taak: { id: bestaand.id, dueDate: dagVan(bestaand.due_date || bestaand.due_at), taak: 'service', nieuw: false }, alBevestigd: Boolean(order.geleverd_op) };
  const taak = await maakSalesTaak(adapter, {
    companyId, leadId: lead.id, leadNaam: lead.naam, taak: 'service', dueDate: plusWerkdagen(dagVan(moment) || dag, 2),
    reden: `bestelling ${order.order_nummer || ''} geleverd op ${dagVan(moment) || dag}: vragen hoe het ging`.replace('  ', ' '), assigneeId: assigneeId || lead.toegewezen_aan || doorPersonId || null,
    vervangOpen: false, nu, contactreden: 'bestelling_geleverd', orderId,
  });
  return { orderId, leadId: lead.id, taak, alBevestigd: Boolean(order.geleverd_op) };
}

/* ---------- zelf een bedrijf toevoegen ---------- */

/*
  Een bedrijf met zijn contactpersoon erbij zetten, vanuit het scherm.

  Waarom dit bestaat: tot 20-09-2026 kwamen leads uitsluitend uit een import. Belde er iemand
  terug, of gaf een klant een collega door, dan kon dat er niet in. Jelle vroeg erom in zijn
  woorden: "ik wil weten hoe ik dingen toevoegen, contacten toevoegen".

  Twee dingen bewaakt deze functie. Eerst de dubbelen: hij kijkt langs dezelfde vier sleutels als
  de import (KvK, btw, domein, naam plus plaats) en meldt een bestaand bedrijf in plaats van er
  stilletjes een tweede rij naast te zetten. Wie het toch wil kan met erbij true doorzetten, en
  dan werkt hij de bestaande lead bij. Daarna de status: een nieuw bedrijf begint op nieuwe_lead,
  zodat hij meteen in de werkbak nieuwe leads staat en niet in het niemandsland van zonder status.

  De contactpersoon loopt via de gewone personenlaag (people plus lead_people), niet als los
  naamveld; dat is het meesterrecord-principe uit 0035 en 0060.
*/
export async function maakLeadHandmatig(adapter, {
  companyId, naam, telefoon = null, email = null, whatsapp = null, plaats = null, website = null,
  kvkNummer = null, rechtsvorm = null, werkgebied = null, bron = null, notities = null, belOptIn = null,
  contactNaam = null, contactRol = null, toegewezenAan = null, erbij = false, vandaag = null, pipeline = FRAMR_PIPELINE,
} = {}) {
  if (!companyId) throw new Error('maakLeadHandmatig vereist companyId.');
  const bedrijf = String(naam || '').trim();
  if (!bedrijf) throw new Error('Een bedrijfsnaam is verplicht.');
  const genormaliseerdeNaam = normalizeLeadName(bedrijf);
  const domein = website ? normalizeDomein(website) : null;

  /* Staat hij er al? Dan geen tweede rij, maar het bestaande bedrijf terug met de reden. */
  const gevonden = await findExistingLead(adapter, {
    companyId, kvkNummer: kvkNummer || undefined, domein: domein || undefined,
    genormaliseerdeNaam, plaats: plaats || undefined,
  });
  if (gevonden.lead && !erbij) {
    return {
      leadId: gevonden.lead.id, naam: gevonden.lead.naam, nieuw: false, bestond: true,
      gevondenOp: gevonden.matchedOn, contact: null,
      melding: `${gevonden.lead.naam} staat er al (gevonden op ${gevonden.matchedOn}).`,
    };
  }

  const velden = {};
  const zet = (k, v) => { if (v !== null && v !== undefined && String(v).trim() !== '') velden[k] = String(v).trim(); };
  zet('telefoon', telefoon);
  zet('email', email);
  zet('whatsapp', whatsapp);
  zet('plaats', plaats);
  zet('website', website);
  zet('kvk_nummer', kvkNummer);
  zet('rechtsvorm', rechtsvorm);
  zet('werkgebied', werkgebied);
  zet('bron', bron);
  zet('notities', notities);
  if (toegewezenAan) velden.toegewezen_aan = toegewezenAan;
  /* Opt-in is het wettelijke onderscheid: een eenmanszaak of vof mag je alleen bellen als hij
     zelf om contact vroeg. Wie dat vinkje zet legt meteen vast waar en wanneer dat was. */
  if (belOptIn === true) {
    velden.bel_opt_in = true;
    velden.opt_in_bron = bron || 'handmatig toegevoegd in het scherm';
    velden.opt_in_datum = vandaag || vandaagLokaal();
  } else if (belOptIn === false) {
    velden.bel_opt_in = false;
  }

  const r = await recordLead(adapter, { companyId, naam: bedrijf, ...velden });
  /* Alleen een nieuw bedrijf krijgt de beginstatus; een bestaand bedrijf houdt de zijne. */
  if (r.created) {
    try { await setLeadFase(adapter, { companyId, leadId: r.id, faseNaam: 'nieuwe_lead', pipeline }); } catch { /* geen fasen geseed: de lead staat er, de status komt later */ }
  }

  let contact = null;
  if (contactNaam && String(contactNaam).trim()) {
    const persoon = await recordPerson(adapter, { companyId, name: String(contactNaam).trim(), role: 'contact' });
    await recordLeadPerson(adapter, {
      companyId, leadId: r.id, personId: persoon.id, rol: contactRol || null, isPrimair: true,
      voorkeurskanaal: telefoon ? 'telefoon' : (whatsapp ? 'whatsapp' : (email ? 'email' : null)),
    });
    contact = { id: persoon.id, naam: String(contactNaam).trim(), nieuw: persoon.created };
  }
  return {
    leadId: r.id, naam: bedrijf, nieuw: r.created, bestond: !r.created,
    gevondenOp: r.matchedOn, contact,
    melding: r.created ? `${bedrijf} toegevoegd als nieuwe lead.` : `${bedrijf} bestond al en is bijgewerkt.`,
  };
}

/* ---------- de werklijst van vandaag en de belsessie ---------- */

/*
  De werklijst: alles wat vandaag moet, uit dezelfde taken en afspraken die ook het dossier en
  de opvolging tonen. Per item de soort, de lead, eigenaar en uitvoerder, wie hem nu in
  behandeling heeft, de actie en de reden, het laatste contact, het laatst verstuurde, de
  reactiestatus en de deadline of tijd. Scope: mijn (eigenaar of uitvoerder is de beller),
  iedereen, of een specifieke collega. Geen limiet; het aantal nieuwe leads is een pagina.
*/
export function bouwWerklijst({
  leads = [], fasen = [], classificaties = [], research = [], interacties = [], taken = [], queue = [], afspraken = [], people = [], leadPeople = [],
  bellerId, scope = 'mijn', vandaag, nu = null, aantalNieuw = 25, pipeline = FRAMR_PIPELINE, classificatie = null, companyId, werkgebied = null,
} = {}) {
  if (!vandaag) throw new Error('bouwWerklijst vereist vandaag.');
  const klok = nu || `${vandaag}T12:00:00`;
  const faseOpId = new Map(fasen.map((f) => [f.id, f]));
  const naamVan = new Map(people.map((p) => [p.id, p.name]));
  const resIdx = researchIndex(research);
  const clsIdx = classificatieIndex(classificaties);
  const conIdx = contactIndex(interacties);
  /* Werkgebied (aanvulling onderdeel 1 en 7): leeg is alles. Een lijst komt van het account (wat
     hij mag zien), een enkele waarde is de keuze in de werkbalk; allebei filteren hetzelfde. */
  const gebieden = werkgebied === null || werkgebied === undefined || werkgebied === '' ? null : new Set(Array.isArray(werkgebied) ? werkgebied : [werkgebied]);
  const inGebied = (l) => !gebieden || gebieden.has(l.werkgebied || '');
  const leadOpId = new Map(leads.filter((l) => (!companyId || l.company_id === companyId) && inGebied(l)).map((l) => [l.id, l]));
  const primair = new Map();
  for (const lp of leadPeople) if (lp.is_primair || !primair.has(lp.lead_id)) primair.set(lp.lead_id, naamVan.get(lp.person_id) || null);
  const faseNaam = (l) => (l && l.pipeline_fase_id ? (faseOpId.get(l.pipeline_fase_id) || {}).naam : null);
  const inScope = (eigenaar, uitvoerder) => {
    if (scope === 'iedereen') return true;
    const wie = scope === 'mijn' ? bellerId : scope;
    if (!wie) return true;
    return uitvoerder ? uitvoerder === wie : (eigenaar === wie || (!eigenaar && scope === 'mijn'));
  };
  const items = [];
  const gezien = new Set();
  const maak = (l, soort, prioriteit, velden) => {
    const c = laatsteContactVoor(interacties, l.id);
    const claim = claimIsActief(l, klok) ? l.in_behandeling_door : null;
    const item = {
      soort, prioriteit, leadId: l.id, lead: l, naam: l.naam, contactpersoon: primair.get(l.id) || null, plaats: l.plaats || null, regio: l.regio || null, telefoon: l.telefoon || null, werkgebied: l.werkgebied || null,
      eigenaar: l.toegewezen_aan || null, eigenaarNaam: naamVan.get(l.toegewezen_aan) || null, inBehandelingDoor: claim, inBehandelingNaam: naamVan.get(claim) || null,
      fase: faseNaam(l), commercieel: commercieleFase(faseNaam(l)), classificatie: clsIdx.get(l.id) || null,
      laatsteContact: c ? { dag: c.dag, type: c.type, uitkomst: c.uitkomst, richting: c.richting } : null,
      laatsteVerstuurd: c && c.laatsteBericht ? c.laatsteBericht : null, reactie: reactieStatus(interacties, l.id, vandaag),
      pogingen: c ? c.pogingen : 0, waarschuwingen: waarschuwingenVoor(l), briefing: (resIdx.get(l.id) || {}).samenvatting || null, ingang: kiesIngang(resIdx.get(l.id)),
      ...velden,
    };
    item.bak = bakVoor(soort, velden.taakType);
    item.contactreden = velden.contactreden || null;
    item.urgent = Boolean(velden.dagenTeLaat) || soort === 'afspraak' || soort === 'reactie_verstreken' || Boolean(velden.tijd && velden.deadline === vandaag);
    item.stap = kiesStap({ fase: item.fase, openTaak: velden.taakType ? { task_type: velden.taakType } : null, afspraak: velden.afspraakId ? { status: 'gepland' } : null, laatsteInteractie: c ? { type: c.type } : null, laatsteBericht: c ? c.laatsteBericht : null });
    items.push(item);
  };
  const eigenaar = (l) => l.toegewezen_aan || null;
  const mag = (l) => l && !EINDFASEN.has(faseNaam(l)) && !(l.gepauzeerd_tot && dagVan(l.gepauzeerd_tot) > vandaag);
  /* Service loopt door waar sales stopt: een klant die bestelt krijgt zijn servicegesprek ook als de
     verkoopfase verloren zegt; alleen niet meer benaderen sluit ook de service. */
  const magService = (l) => l && faseNaam(l) !== 'niet_meer_benaderen';

  /* 1. Afspraken van vandaag, op tijd. */
  for (const a of afspraken.filter((x) => leadOpId.has(x.lead_id) && ['gepland', 'verplaatst'].includes(x.status) && dagVan(x.start_at) === vandaag).sort((x, y) => String(x.start_at).localeCompare(String(y.start_at)))) {
    const l = leadOpId.get(a.lead_id);
    if (!inScope(eigenaar(l), a.verantwoordelijke)) continue;
    maak(l, 'afspraak', 100, { contactreden: 'demo_uitvoeren', actie: a.soort || 'demo', reden: `${a.soort || 'demo'} ${a.vorm || ''} om ${tijdVan(a.start_at)}${a.doel ? `: ${a.doel}` : ''}`.trim(), deadline: vandaag, tijd: tijdVan(a.start_at), afspraakId: a.id, taakId: a.task_id || null, uitvoerder: a.verantwoordelijke || null, uitvoerderNaam: naamVan.get(a.verantwoordelijke) || null, taakType: 'demo', vorm: a.vorm || null, link: a.link || null, locatie: a.locatie || null });
    gezien.add(`${l.id}:${a.task_id || a.id}`);
  }
  /* 2. Open taken die vandaag of eerder vervallen: achterstallig, terugbellen, opvolgen, berichten, beoordelen. */
  const open = openTaken(taken).filter((t) => t.lead_id && leadOpId.has(t.lead_id) && dagVan(t.due_date || t.due_at) && dagVan(t.due_date || t.due_at) <= vandaag)
    .sort((a, b) => String(dagVan(a.due_date || a.due_at)).localeCompare(String(dagVan(b.due_date || b.due_at))) || String(a.due_at || '').localeCompare(String(b.due_at || '')));
  for (const t of open) {
    const l = leadOpId.get(t.lead_id);
    const type = t.task_type || 'check_in';
    if (gezien.has(`${l.id}:${t.id}`) || !(type === 'service' ? magService(l) : mag(l))) continue;
    if (!inScope(eigenaar(l), t.assignee)) continue;
    const dag = dagVan(t.due_date || t.due_at);
    const teLaat = dag < vandaag;
    const soort = teLaat ? 'achterstallig' : (['whatsapp', 'email'].includes(type) ? 'bericht' : (type === 'check_in' ? 'beoordelen' : (type === 'service' ? 'service' : (/terugbel/i.test(String(t.reden || '')) ? 'terugbellen' : (type === 'demo' ? 'afspraak' : (type === 'onboarding' ? 'onboarding' : 'opvolging'))))));
    maak(l, soort, teLaat ? 95 : (['whatsapp', 'email'].includes(type) ? 80 : 90), { contactreden: t.contactreden || contactredenVoor({ taak: type, reeks: t.opvolg_reeks, reden: t.reden }), actie: type, reden: `${t.reden || t.title}${teLaat ? ` (stond op ${dag})` : ''}`, deadline: dag, tijd: t.due_at ? tijdVan(t.due_at) : null, taakId: t.id, taakType: type, uitvoerder: t.assignee || null, uitvoerderNaam: naamVan.get(t.assignee) || null, reeks: t.opvolg_reeks || null, reeksStap: t.opvolg_stap || null, template: null, dagenTeLaat: teLaat ? Math.round((new Date(vandaag) - new Date(dag)) / 86400000) : 0 });
    gezien.add(`${l.id}:${t.id}`);
  }
  /* 3. Berichten waarvan de reactietermijn verstreken is zonder taak erop. */
  for (const l of leadOpId.values()) {
    if (!mag(l) || !inScope(eigenaar(l), null)) continue;
    const r = reactieStatus(interacties, l.id, vandaag);
    if (r.status !== 'verstreken') continue;
    if (items.some((i) => i.leadId === l.id)) continue;
    maak(l, 'reactie_verstreken', 85, { contactreden: 'opvolgen_na_informatie', actie: 'call', reden: `geen reactie op ${r.materiaal || 'het bericht'} van ${r.dag}, termijn verstreken op ${r.termijn}`, deadline: r.termijn, tijd: null, taakId: null, taakType: 'call', uitvoerder: null, uitvoerderNaam: null });
  }
  /* 4. Gesprekken die nog administratief afgerond moeten worden (zonder uitkomst), en opnames of
     AI-voorstellen die beoordeeld moeten worden (provisional). */
  for (const i of sorteerOpStart(interacties.filter((x) => leadOpId.has(x.lead_id) && ['call', 'demo'].includes(x.type) && !x.uitkomst && x.richting !== 'inkomend'))) {
    const l = leadOpId.get(i.lead_id);
    if (!inScope(eigenaar(l), i.door_person_id)) continue;
    maak(l, 'af_te_ronden', 75, { contactreden: i.contactreden || contactredenVanStap(i.stap) || (i.type === 'demo' ? 'demo_uitvoeren' : 'eerste_kennismaking'), actie: 'afronden', reden: `${i.type === 'demo' ? 'demo' : 'gesprek'} van ${dagVan(i.started_at)} zonder uitkomst${i.opname_ref ? ', met opname' : ''}`, deadline: dagVan(i.started_at), tijd: tijdVan(i.started_at), interactionId: i.id, taakId: null, taakType: null, uitvoerder: i.door_person_id || null, uitvoerderNaam: naamVan.get(i.door_person_id) || null });
  }
  for (const i of sorteerOpStart(interacties.filter((x) => leadOpId.has(x.lead_id) && x.review_status === 'provisional'))) {
    const l = leadOpId.get(i.lead_id);
    if (!inScope(eigenaar(l), i.door_person_id)) continue;
    maak(l, 'te_beoordelen', 60, { contactreden: 'beoordelen', actie: 'beoordelen', reden: `AI-voorstel bij het ${i.type} van ${dagVan(i.started_at)} wacht op bevestiging`, deadline: dagVan(i.started_at), tijd: null, interactionId: i.id, taakId: null, taakType: null, uitvoerder: i.door_person_id || null, uitvoerderNaam: naamVan.get(i.door_person_id) || null });
  }
  /* 5. Herhaalpogingen en nieuwe leads, uit dezelfde dagselectie als de belsessie. */
  const bellers = scope === 'iedereen' ? [...new Set(leads.map((l) => l.toegewezen_aan).filter(Boolean))] : [scope === 'mijn' ? bellerId : scope];
  for (const wie of bellers.filter(Boolean)) {
    const sel = kiesDagselectie({ leads: [...leadOpId.values()], fasen, classificaties, research, interacties, taken, queue: [], afspraken, bellerId: wie, vandaag, nu: klok, aantal: aantalNieuw, pipeline, classificatie, companyId, metPool: scope === 'mijn' });
    for (const s of sel) {
      if (s.prioriteit === 90) continue;
      if (items.some((i) => i.leadId === s.lead.id)) continue;
      maak(s.lead, s.prioriteit === 70 ? 'herhaalpoging' : 'nieuw', s.prioriteit, { contactreden: 'eerste_kennismaking', actie: 'call', reden: s.reden, deadline: vandaag, tijd: null, taakId: null, taakType: 'call', uitvoerder: wie, uitvoerderNaam: naamVan.get(wie) || null, totaalNieuw: s.totaalNieuw });
    }
  }
  items.sort((a, b) => b.prioriteit - a.prioriteit || String(a.tijd || '99').localeCompare(String(b.tijd || '99')) || String(a.deadline || '').localeCompare(String(b.deadline || '')));
  const groepen = {};
  for (const i of items) { if (!groepen[i.soort]) groepen[i.soort] = 0; groepen[i.soort] += 1; }
  const nieuwBeschikbaar = Math.max(0, ...items.filter((i) => i.soort === 'nieuw').map((i) => i.totaalNieuw || 0));
  const belbaar = (i) => Boolean(i.telefoon) && (['call', 'service'].includes(i.actie) || (i.soort === 'afspraak' && i.vorm === 'telefonisch'));
  /* Geen botsing tussen sales en service (aanvulling onderdeel 3): een collega die dezelfde klant net
     benaderde of er een open taak heeft binnen twee werkdagen, staat als waarschuwing op de rij. */
  const grensTerug = minWerkdagen(vandaag, 2);
  const grensVooruit = plusWerkdagen(vandaag, 2);
  for (const i of items) {
    const wie = i.uitvoerder || i.eigenaar || bellerId;
    const recent = interacties.filter((x) => x.lead_id === i.leadId && x.type !== 'note' && x.door_person_id && x.door_person_id !== wie && dagVan(x.started_at) >= grensTerug && dagVan(x.started_at) <= vandaag);
    for (const x of recent.slice(0, 1)) i.waarschuwingen.push(`${naamVan.get(x.door_person_id) || 'een collega'} had op ${dagVan(x.started_at)} al contact (${x.type === 'call' ? 'gesprek' : x.type}); stem af voor je belt`);
    const andere = openTaken(taken).filter((t) => t.lead_id === i.leadId && t.id !== i.taakId && t.assignee && t.assignee !== wie && dagVan(t.due_date || t.due_at) && dagVan(t.due_date || t.due_at) <= grensVooruit);
    for (const t of andere.slice(0, 1)) i.waarschuwingen.push(`${naamVan.get(t.assignee) || 'een collega'} heeft hier ook een taak (${t.task_type || 'call'}, ${dagVan(t.due_date || t.due_at)}): een moment, niet twee`);
  }
  /* De vijf werkbakken: per bak het aantal, hoeveel daarvan urgent (te laat, of vandaag met een
     tijd) en hoeveel belbaar, zodat Vandaag rustig blijft en de details pas bij het openen komen. */
  const bakken = WERKBAKKEN.map(({ bak, titel }) => {
    const lijst = items.filter((i) => i.bak === bak);
    /* Nieuwe leads komen per pagina binnen (aantalNieuw). Het aantal op de tegel is wat er ligt,
       niet wat er geladen is, anders staat er 25 terwijl er honderd wachten. */
    const beschikbaar = bak === 'nieuwe_leads' ? Math.max(lijst.length, nieuwBeschikbaar) : lijst.length;
    return { bak, titel, aantal: lijst.length, beschikbaar, urgent: lijst.filter((i) => i.urgent).length, belbaar: lijst.filter(belbaar).length, leadIds: lijst.filter(belbaar).map((i) => i.leadId) };
  });
  return { items, groepen, bakken, scope, bellerId, vandaag, aantalNieuw, werkgebied, nieuwBeschikbaar, belItems: items.filter(belbaar).length };
}

/*
  De volgende lead voor een belsessie, aan de serverkant geclaimd: de eerste belregel van de
  werklijst (scope mijn) die niet overgeslagen is, niet bij een collega in behandeling is en
  vandaag nog niet gebeld is. Twee bellers die tegelijk vragen krijgen nooit dezelfde, want de
  claim is een voorwaardelijke update. Met leadIds beperkt de sessie zich tot een gekozen lijst.
*/
export async function volgendeVoorSessie(adapter, { companyId, bellerId, vandaag, nu = null, data, overslaan = [], leadIds = null, aantalNieuw = 25, pipeline = FRAMR_PIPELINE, classificatie = null } = {}) {
  if (!bellerId) throw new Error('volgendeVoorSessie vereist bellerId.');
  const klok = nu || new Date().toISOString();
  const d = data || {
    leads: await adapter.fetchLeads(), fasen: await adapter.fetchPipelineFases(), classificaties: await adapter.fetchLeadClassifications(), research: await adapter.fetchLeadResearch(),
    interacties: await adapter.fetchInteractions(), taken: await adapter.fetchTasks(), queue: await adapter.fetchSalesQueue(), afspraken: adapter.fetchSalesAfspraken ? await adapter.fetchSalesAfspraken() : [], people: await adapter.fetchPeople(), leadPeople: await adapter.fetchLeadPeople(),
  };
  const w = bouwWerklijst({ ...d, bellerId, scope: 'mijn', vandaag, nu: klok, aantalNieuw, pipeline, classificatie, companyId });
  const gebeldVandaag = new Set(d.interacties.filter((i) => i.type === 'call' && dagVan(i.started_at) === vandaag && i.uitkomst).map((i) => i.lead_id));
  /* Belregels: elke beltaak, en een afspraak alleen als die telefonisch is. */
  const belbaar = (i) => i.telefoon && (['call', 'service'].includes(i.actie) || (i.soort === 'afspraak' && i.vorm === 'telefonisch'));
  const kandidaten = w.items.filter((i) => belbaar(i) && !overslaan.includes(i.leadId) && (!leadIds || leadIds.includes(i.leadId))
    && (i.soort === 'afspraak' || i.soort === 'achterstallig' || !gebeldVandaag.has(i.leadId)));
  let positie = 0;
  for (const k of kandidaten) {
    positie += 1;
    if (k.inBehandelingDoor && k.inBehandelingDoor !== bellerId) continue;
    const c = await claimLead(adapter, { leadId: k.leadId, bellerId, nu: klok });
    if (!c.ok) continue;
    /* De queue-rij van vandaag, zodat het dagrapport kan tellen; idempotent per dag en lead. */
    const alQueue = d.queue.some((q) => q.lead_id === k.leadId && dagVan(q.berekend_op) === vandaag);
    if (!alQueue && adapter.insertSalesQueue) {
      await adapter.insertSalesQueue({ company_id: companyId, lead_id: k.leadId, kanaal_voorstel: 'call', prioriteit: k.prioriteit, redenen: { reden: k.reden, beller: bellerId, dag: vandaag, volgnummer: positie, soort: k.soort }, status: 'gepland' });
    }
    return { item: { ...k, lead: undefined, leadRij: k.lead }, positie, totaal: kandidaten.length, resterend: kandidaten.length - positie, claim: c, gedaanVandaag: gebeldVandaag.size, nieuwBeschikbaar: w.nieuwBeschikbaar };
  }
  return { item: null, positie: kandidaten.length, totaal: kandidaten.length, resterend: 0, gedaanVandaag: gebeldVandaag.size, nieuwBeschikbaar: w.nieuwBeschikbaar };
}

/*
  Het dagrapport van een beller: wat er vandaag gebeurd is, wat er nog open staat en
  waar de registratie achterloopt. Leest alleen.
*/
export function bouwDagrapport({
  leads = [], fasen = [], interacties = [], taken = [], queue = [], bellerId, vandaag,
} = {}) {
  if (!bellerId || !vandaag) throw new Error('bouwDagrapport vereist bellerId en vandaag.');
  const leadOpId = new Map(leads.map((l) => [l.id, l]));
  const faseOpId = new Map(fasen.map((f) => [f.id, f]));
  const vanVandaag = interacties.filter((i) => i.door_person_id === bellerId && dagVan(i.started_at) === vandaag);
  const gesprekken = vanVandaag.filter((i) => i.type === 'call');
  const bereikt = gesprekken.filter((i) => i.uitkomst && !NIET_BEREIKT.has(i.uitkomst));
  const perUitkomst = new Map();
  for (const g of gesprekken) perUitkomst.set(g.uitkomst || 'zonder uitkomst', (perUitkomst.get(g.uitkomst || 'zonder uitkomst') || 0) + 1);

  const lijst = queue
    .filter((q) => dagVan(q.berekend_op) === vandaag && q.redenen && q.redenen.beller === bellerId)
    .sort((a, b) => (a.redenen.volgnummer || 0) - (b.redenen.volgnummer || 0))
    .map((q) => {
      const l = leadOpId.get(q.lead_id) || { naam: q.lead_id };
      const gedaan = (type) => vanVandaag.some((i) => i.lead_id === q.lead_id && i.type === type);
      return { lead: l, gebeld: gedaan('call'), gemaild: gedaan('email'), geappt: gedaan('whatsapp'), status: q.status };
    });

  const open = openTaken(taken).filter((t) => t.lead_id && (!t.assignee || t.assignee === bellerId));
  const dag = (t) => dagVan(t.due_date || t.due_at);
  const vandaagTaken = open.filter((t) => dag(t) === vandaag);
  const achterstallig = open.filter((t) => dag(t) && dag(t) < vandaag);
  const demos = open.filter((t) => t.task_type === 'demo' && dag(t) === vandaag);
  const zonderNotitie = gesprekken.filter((g) => !g.samenvatting && g.uitkomst && !NIET_BEREIKT.has(g.uitkomst));

  const naamVan = (t) => (leadOpId.get(t.lead_id) || {}).naam || t.lead_id;
  return {
    vandaag,
    gebeld: gesprekken.length,
    bereikt: bereikt.length,
    perUitkomst: [...perUitkomst.entries()].sort((a, b) => b[1] - a[1]),
    verstuurd: { whatsapp: vanVandaag.filter((i) => i.type === 'whatsapp').length, email: vanVandaag.filter((i) => i.type === 'email').length },
    lijst,
    lijstCompleet: lijst.filter((r) => r.gebeld && r.gemaild && r.geappt).length,
    opvolgVandaag: vandaagTaken.map((t) => ({ lead: naamVan(t), taak: t.task_type, reden: t.reden, dag: dag(t) })),
    achterstallig: achterstallig.map((t) => ({ lead: naamVan(t), taak: t.task_type, reden: t.reden, dag: dag(t) })),
    demos: demos.map((t) => ({ lead: naamVan(t), reden: t.reden })),
    zonderNotitie: zonderNotitie.map((g) => (leadOpId.get(g.lead_id) || {}).naam || g.lead_id),
    faseVan: (leadId) => {
      const l = leadOpId.get(leadId);
      return l && l.pipeline_fase_id ? (faseOpId.get(l.pipeline_fase_id) || {}).naam : null;
    },
  };
}

function dagenTerug(vandaag, n) {
  return plusDagen(vandaag, -n);
}

/*
  Het dashboard: het totaaloverzicht van alle data in het verkoopspoor. De funnel per
  fase, de cijfers van vandaag en deze week, de conversies, wat er open staat, de
  partners en bestellingen uit het portaal, en de inventaris van wat er in het brein
  ligt. Leest alleen; de weergave doet de CLI.
*/
export function bouwDashboard({
  leads = [], fasen = [], classificaties = [], research = [], interacties = [], taken = [],
  bezwaren = [], kansen = [], bronnen = [], feiten = [], people = [], partners = [], orders = [],
  queue = [], afspraken = [], companyId, pipeline = FRAMR_PIPELINE, vandaag,
} = {}) {
  if (!vandaag) throw new Error('bouwDashboard vereist vandaag.');
  const eigen = leads.filter((l) => !companyId || l.company_id === companyId);
  const eigenIds = new Set(eigen.map((l) => l.id));
  const vanEigen = (rijen) => rijen.filter((r) => eigenIds.has(r.lead_id));
  const faseOpId = new Map(fasen.map((f) => [f.id, f]));
  const clsIdx = classificatieIndex(classificaties);
  const resIdx = researchIndex(research);
  const naamVan = new Map(people.map((p) => [p.id, p.name]));

  /* Funnel. */
  const pipelineFasen = fasen.filter((f) => f.pipeline === pipeline && (!companyId || f.company_id === companyId))
    .sort((a, b) => a.volgorde - b.volgorde);
  const perFase = pipelineFasen.map((f) => ({ volgorde: f.volgorde, naam: f.naam, aantal: eigen.filter((l) => l.pipeline_fase_id === f.id).length }));
  const zonderFase = eigen.filter((l) => !l.pipeline_fase_id).length;
  const inAndereFase = eigen.filter((l) => l.pipeline_fase_id && (faseOpId.get(l.pipeline_fase_id) || {}).pipeline !== pipeline).length;
  const faseNaamVan = (l) => (l.pipeline_fase_id ? (faseOpId.get(l.pipeline_fase_id) || {}).naam : null);
  const volgordeVan = new Map(pipelineFasen.map((f) => [f.naam, f.volgorde]));
  const minstens = (naam) => eigen.filter((l) => {
    const v = volgordeVan.get(faseNaamVan(l));
    return v !== undefined && v >= volgordeVan.get(naam) && v <= 17;
  }).length;

  /* Gesprekken. */
  const calls = vanEigen(interacties).filter((i) => i.type === 'call');
  const weekGrens = dagenTerug(vandaag, 6);
  const callsWeek = calls.filter((i) => dagVan(i.started_at) >= weekGrens);
  const callsVandaag = calls.filter((i) => dagVan(i.started_at) === vandaag);
  const bereikt = (rij) => rij.filter((i) => i.uitkomst && !NIET_BEREIKT.has(i.uitkomst));
  const gebeldeLeads = new Set(calls.map((i) => i.lead_id));
  const bereikteLeads = new Set(bereikt(calls).map((i) => i.lead_id));
  const perUitkomst = new Map();
  for (const c of calls) perUitkomst.set(c.uitkomst || 'zonder uitkomst', (perUitkomst.get(c.uitkomst || 'zonder uitkomst') || 0) + 1);
  const perBeller = new Map();
  for (const c of calls) {
    const k = naamVan.get(c.door_person_id) || 'onbekend';
    if (!perBeller.has(k)) perBeller.set(k, { gebeld: 0, bereikt: 0 });
    perBeller.get(k).gebeld += 1;
    if (c.uitkomst && !NIET_BEREIKT.has(c.uitkomst)) perBeller.get(k).bereikt += 1;
  }

  /* Open werk. */
  const open = openTaken(taken).filter((t) => t.lead_id && eigenIds.has(t.lead_id));
  const dag = (t) => dagVan(t.due_date || t.due_at);
  const achterstallig = open.filter((t) => dag(t) && dag(t) < vandaag);
  const vandaagTaken = open.filter((t) => dag(t) === vandaag);
  const demosWeek = afspraken.length
    ? afspraken.filter((a) => eigenIds.has(a.lead_id) && ['gepland', 'verplaatst'].includes(a.status) && dagVan(a.start_at) >= vandaag && dagVan(a.start_at) <= plusDagen(vandaag, 6))
    : open.filter((t) => t.task_type === 'demo' && dag(t) && dag(t) >= vandaag && dag(t) <= plusDagen(vandaag, 6));
  const warmeFasen = new Set(['gesproken', 'gekwalificeerd', 'informatie_verstuurd', 'follow_up_nodig', 'demo_afgerond', 'account_aangeboden']);
  const leadsMetOpenTaak = new Set(open.map((t) => t.lead_id));
  const warmZonderActie = eigen.filter((l) => warmeFasen.has(faseNaamVan(l)) && !leadsMetOpenTaak.has(l.id));

  /* Bezwaren en kansen. */
  const perBezwaar = new Map();
  for (const b of vanEigen(bezwaren)) perBezwaar.set(b.categorie || 'zonder categorie', (perBezwaar.get(b.categorie || 'zonder categorie') || 0) + 1);
  const openKansen = vanEigen(kansen).filter((k) => ['aanstaand', 'inmeten', 'offerte'].includes(k.stage));
  const m2Open = openKansen.reduce((s, k) => s + (Number(k.geschat_m2) || 0), 0);

  /* Toewijzing en classificatie. */
  const perToegewezen = new Map();
  for (const l of eigen) {
    const k = l.toegewezen_aan ? (naamVan.get(l.toegewezen_aan) || l.toegewezen_aan) : 'niet toegewezen';
    perToegewezen.set(k, (perToegewezen.get(k) || 0) + 1);
  }
  const perClassificatie = new Map();
  for (const l of eigen) {
    const k = clsIdx.get(l.id) || 'zonder classificatie';
    perClassificatie.set(k, (perClassificatie.get(k) || 0) + 1);
  }

  const partnersEigen = partners.filter((p) => !companyId || p.company_id === companyId);
  const ordersEigen = orders.filter((o) => !companyId || o.company_id === companyId);

  const pct = (t, n) => (n ? Math.round((t / n) * 100) : null);
  return {
    vandaag,
    pipeline,
    funnel: { perFase, zonderFase, inAndereFase },
    leads: {
      totaal: eigen.length,
      metTelefoon: eigen.filter((l) => l.telefoon).length,
      metEmail: eigen.filter((l) => l.email).length,
      metBriefing: eigen.filter((l) => resIdx.has(l.id)).length,
      perClassificatie: [...perClassificatie.entries()].sort((a, b) => b[1] - a[1]),
      perToegewezen: [...perToegewezen.entries()].sort((a, b) => b[1] - a[1]),
    },
    gesprekken: {
      totaal: calls.length,
      week: callsWeek.length,
      vandaag: callsVandaag.length,
      bereiktWeek: bereikt(callsWeek).length,
      bereiktVandaag: bereikt(callsVandaag).length,
      perUitkomst: [...perUitkomst.entries()].sort((a, b) => b[1] - a[1]),
      perBeller: [...perBeller.entries()],
      metOpname: calls.filter((i) => i.opname_ref).length,
      metTranscript: calls.filter((i) => i.transcript_ref).length,
      metSamenvatting: calls.filter((i) => i.samenvatting).length,
    },
    conversie: {
      bereiktVanGebeld: pct(bereikteLeads.size, gebeldeLeads.size),
      gesprokenVanBereikt: pct(minstens('gesproken'), bereikteLeads.size),
      demoVanGesproken: pct(minstens('demo_gepland'), minstens('gesproken')),
      accountVanDemo: pct(minstens('account_aangemaakt'), minstens('demo_gepland')),
      bestellingVanAccount: pct(minstens('eerste_bestelling'), minstens('account_aangemaakt')),
    },
    openWerk: {
      taken: open.length,
      vandaag: vandaagTaken.length,
      achterstallig: achterstallig.length,
      demosDezeWeek: demosWeek.length,
      warmZonderActie: warmZonderActie.map((l) => l.naam),
      queueVandaag: queue.filter((q) => dagVan(q.berekend_op) === vandaag).length,
    },
    bezwaren: [...perBezwaar.entries()].sort((a, b) => b[1] - a[1]),
    kansen: { open: openKansen.length, m2: m2Open },
    partners: {
      totaal: partnersEigen.length,
      vrijgegeven: partnersEigen.filter((p) => p.vrijgegeven_op).length,
      metNiveau: partnersEigen.filter((p) => p.niveau).length,
      metKlant: partnersEigen.filter((p) => p.shopify_customer_id).length,
    },
    bestellingen: { totaal: ordersEigen.length, bedragEx: ordersEigen.reduce((s, o) => s + (Number(o.bedrag_ex) || 0), 0) },
    inventaris: {
      leads: eigen.length,
      bronnen: vanEigen(bronnen).length,
      feiten: vanEigen(feiten).length,
      briefings: vanEigen(research).length,
      contactmomenten: vanEigen(interacties).length,
      gesprekken: calls.length,
      bezwaren: vanEigen(bezwaren).length,
      kansen: vanEigen(kansen).length,
      taken: taken.filter((t) => t.lead_id && eigenIds.has(t.lead_id)).length,
      queue: queue.filter((q) => eigenIds.has(q.lead_id)).length,
      partners: partnersEigen.length,
      bestellingen: ordersEigen.length,
    },
  };
}

/* Het leadblad: alle gegevens per lead op een regel. De kolommen in de volgorde van
   Jelles brainstorm: eerst wie, dan contact, dan wat we weten, dan waar hij staat. */
export const LEADBLAD_KOLOMMEN = [
  'leadnummer', 'werkgebied', 'bedrijfsnaam', 'contactpersoon', 'telefoon', 'whatsapp', 'email', 'website',
  'plaats', 'postcode', 'provincie', 'kvk', 'rechtsvorm', 'bel_opt_in', 'classificatie',
  'bedrijfsgrootte', 'specialisme', 'huidige_leverancier', 'huidige_software',
  'diensten', 'merken', 'pvc', 'doelgroep', 'team', 'google_score', 'reviews', 'instagram', 'facebook', 'linkedin',
  'bron', 'bronnen', 'toegevoegd_op', 'toegewezen_aan',
  'fase', 'commerciele_fase', 'trajectstatus', 'gesprekken', 'pogingen', 'laatste_contact', 'laatste_contact_type', 'laatste_uitkomst', 'laatste_reactie', 'reactie_status',
  'volgende_actie', 'volgende_actie_op', 'volgende_actie_wie', 'in_behandeling_door', 'tags',
  'kansen', 'bezwaren', 'briefing', 'notities',
];

const FEITVELDEN = {
  diensten: 'diensten', merken: 'merken', pvc: 'pvc', doelgroep: 'doelgroep', team: 'team_indicatie',
  google_score: 'google_score', reviews: 'reviews_aantal', instagram: 'instagram', facebook: 'facebook',
  linkedin: 'linkedin',
};

/* Het laatste geldende feit per lead en veld. */
export function feitenIndex(feiten = []) {
  const idx = new Map();
  for (const f of feiten) {
    if (f.geldig_tot) continue;
    if (!idx.has(f.lead_id)) idx.set(f.lead_id, new Map());
    const m = idx.get(f.lead_id);
    const h = m.get(f.veld);
    if (!h || String(f.waargenomen_op || '') > String(h.waargenomen_op || '')) m.set(f.veld, f);
  }
  return idx;
}

export function bouwLeadbladRijen({
  leads = [], fasen = [], classificaties = [], research = [], interacties = [], taken = [],
  feiten = [], bronnen = [], people = [], leadPeople = [], kansen = [], bezwaren = [], afspraken = [],
  companyId, bellerId, classificatie, alles = false, vandaag = null, nu = null,
} = {}) {
  const faseOpId = new Map(fasen.map((f) => [f.id, f]));
  const clsIdx = classificatieIndex(classificaties);
  const resIdx = researchIndex(research);
  const conIdx = contactIndex(interacties);
  const feitIdx = feitenIndex(feiten);
  const naamVan = new Map(people.map((p) => [p.id, p.name]));
  const bronTelling = new Map();
  for (const b of bronnen) bronTelling.set(b.lead_id, (bronTelling.get(b.lead_id) || 0) + 1);
  const primair = new Map();
  for (const lp of leadPeople) if (lp.is_primair || !primair.has(lp.lead_id)) primair.set(lp.lead_id, naamVan.get(lp.person_id) || null);
  const kansTelling = new Map();
  for (const k of kansen) kansTelling.set(k.lead_id, (kansTelling.get(k.lead_id) || 0) + 1);
  const bezwaarTelling = new Map();
  for (const b of bezwaren) bezwaarTelling.set(b.lead_id, (bezwaarTelling.get(b.lead_id) || 0) + 1);
  const klok = nu || (vandaag ? `${vandaag}T12:00:00` : new Date().toISOString());
  const tagsVan = new Map();
  for (const i of interacties) for (const t of (i.tags || [])) { if (!tagsVan.has(i.lead_id)) tagsVan.set(i.lead_id, new Set()); tagsVan.get(i.lead_id).add(t); }

  return leads
    .filter((l) => !companyId || l.company_id === companyId)
    .filter((l) => alles || !bellerId || l.toegewezen_aan === bellerId)
    .filter((l) => alles || !classificatie || clsIdx.get(l.id) === classificatie)
    .sort((a, b) => String(a.regio || 'zzz').localeCompare(String(b.regio || 'zzz')) || String(a.naam).localeCompare(String(b.naam)))
    .map((l) => {
      const c = conIdx.get(l.id);
      const f = feitIdx.get(l.id) || new Map();
      const feit = (veld) => (f.get(veld) || {}).waarde || '';
      const v = volgendeActieVoor({ taken, afspraken, leadId: l.id, vandaag, people });
      const faseNaam = l.pipeline_fase_id ? (faseOpId.get(l.pipeline_fase_id) || {}).naam || '' : '';
      const traject = trajectstatus({ faseNaam, gepauzeerdTot: l.gepauzeerd_tot, vandaag });
      const reactie = reactieStatus(interacties, l.id, vandaag);
      const rij = {
        leadnummer: l.id,
        werkgebied: l.werkgebied || '',
        bedrijfsnaam: l.naam,
        contactpersoon: primair.get(l.id) || feit('eigenaar') || '',
        telefoon: l.telefoon || '',
        whatsapp: l.whatsapp || '',
        email: l.email || feit('email') || '',
        website: l.website || '',
        plaats: l.plaats || '',
        postcode: l.postcode || '',
        provincie: l.regio || '',
        kvk: l.kvk_nummer || feit('kvk_nummer') || '',
        rechtsvorm: l.rechtsvorm || feit('rechtsvorm') || '',
        bel_opt_in: l.bel_opt_in == null ? '' : (l.bel_opt_in ? 'ja' : 'nee'),
        classificatie: clsIdx.get(l.id) || '',
        bedrijfsgrootte: l.bedrijfsgrootte || '',
        specialisme: l.specialisme || '',
        huidige_leverancier: l.huidige_leverancier || '',
        huidige_software: l.huidige_software || '',
        bron: l.bron || '',
        bronnen: bronTelling.get(l.id) || 0,
        toegevoegd_op: dagVan(l.created_at) || '',
        toegewezen_aan: l.toegewezen_aan ? (naamVan.get(l.toegewezen_aan) || '') : '',
        fase: faseNaam,
        commerciele_fase: faseNaam ? commercieleFase(faseNaam) || 'verloren' : 'nieuw',
        trajectstatus: traject.status + (traject.tot ? ` tot ${traject.tot}` : ''),
        gesprekken: c ? c.gesprekken.length : 0,
        pogingen: c ? c.pogingen : 0,
        laatste_contact: c ? dagVan(c.laatste.started_at) : '',
        laatste_contact_type: c ? `${c.laatste.richting === 'inkomend' ? 'inkomend ' : ''}${c.laatste.type}` : '',
        laatste_uitkomst: c && c.gesprekken[0] ? (c.gesprekken[0].uitkomst || '') : '',
        laatste_reactie: c && c.laatsteReactie ? dagVan(c.laatsteReactie.started_at) : '',
        reactie_status: reactie.status === 'geen' ? '' : reactie.status,
        volgende_actie: v ? v.reden : '',
        volgende_actie_op: v && v.dag ? v.dag : '',
        volgende_actie_wie: v ? (v.wieNaam || '') : '',
        in_behandeling_door: claimIsActief(l, klok) ? (naamVan.get(l.in_behandeling_door) || l.in_behandeling_door) : '',
        tags: [...(tagsVan.get(l.id) || [])].sort().join(' '),
        kansen: kansTelling.get(l.id) || 0,
        bezwaren: bezwaarTelling.get(l.id) || 0,
        briefing: (resIdx.get(l.id) || {}).samenvatting || '',
        notities: l.notities || '',
      };
      for (const [kolom, veld] of Object.entries(FEITVELDEN)) rij[kolom] = feit(veld);
      return rij;
    });
}

export function csvVeld(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function maakCsv(kolommen, rijen) {
  const regels = [kolommen.map(csvVeld).join(',')];
  for (const rij of rijen) regels.push(kolommen.map((k) => csvVeld(rij[k])).join(','));
  return `${regels.join('\n')}\n`;
}
