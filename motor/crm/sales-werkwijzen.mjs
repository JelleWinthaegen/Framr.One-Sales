/*
  Jarvis - sales-werkwijzen: scripts, templates en reeksen met versies, geschiedenis en meldingen.

  Aanvulling van Jelle (15-09-2026, onderdeel 6): verandert een SOP, script of berichttemplate,
  dan een duidelijke melding aan de medewerkers voor wie dat relevant is, met wat er veranderd
  is, waarom, vanaf wanneer, voor welke werkzaamheden en wat hij voortaan anders moet doen.
  Versies en geschiedenis blijven bewaard, een bekeken wijziging komt niet terug, en een kleine
  tekstcorrectie onderbreekt niemand.

  De code (sales-scripts.mjs) blijft de startwaarde: zolang er geen eigen versie in de database
  staat werkt alles gewoon. Zodra er een versie is wint die, en het contactmoment draagt het
  versienummer dat op dat moment gold (script_ref, template_ref uit migration 0107).

  Stijl: blokcommentaar, geen lange streepjes en geen emoji, conform de projectafspraken.
*/

import { SCRIPTS, BERICHT_TEMPLATES, SOPS } from './sales-scripts.mjs?v=5dd6073';

export const WERKWIJZE_SOORTEN = ['script', 'template', 'reeks', 'sop'];
export const WIJZIGING_SOORTEN = ['klein', 'inhoudelijk'];

const eigen = (rijen = [], companyId) => rijen.filter((r) => !companyId || r.company_id === companyId);

/*
  De laatste versie per soort en ref. Met een werkgebied wint een versie die voor dat gebied
  geschreven is boven een algemene; zonder werkgebied tellen alleen de algemene versies mee.
  Zo heeft elk werkgebied dezelfde basis met een eigen werkwijze waar dat nodig is.
*/
export function laatsteWerkwijzen(werkwijzen = [], companyId, werkgebied = null) {
  const uit = new Map();
  for (const w of eigen(werkwijzen, companyId)) {
    const gebied = w.werkgebied || null;
    if (gebied && gebied !== werkgebied) continue;
    const sleutel = `${w.soort}:${w.ref}`;
    const huidig = uit.get(sleutel);
    const specifieker = Boolean(gebied) && !(huidig && huidig.werkgebied);
    const nieuwer = Boolean(gebied) === Boolean(huidig && huidig.werkgebied) && Number(w.versie || 0) > Number((huidig || {}).versie || 0);
    if (!huidig || specifieker || nieuwer) uit.set(sleutel, w);
  }
  return uit;
}

/* De geldende inhoud van een werkwijze: de database als die een versie heeft, anders de code. */
export function werkwijzeInhoud({ werkwijzen = [], companyId, soort, ref, werkgebied = null } = {}) {
  const w = laatsteWerkwijzen(werkwijzen, companyId, werkgebied).get(`${soort}:${ref}`);
  if (w) return { inhoud: w.inhoud || {}, versie: Number(w.versie || 1), bron: 'database', werkgebied: w.werkgebied || null, ref: `${ref}@v${w.versie}` };
  if (soort === 'script') { const s = SCRIPTS[ref]; return s ? { inhoud: s, versie: s.versie, bron: 'code', ref: `${ref}@${s.versie}` } : null; }
  if (soort === 'sop') { const s = SOPS[ref]; return s ? { inhoud: s, versie: s.versie, bron: 'code', ref: `${ref}@${s.versie}` } : null; }
  if (soort === 'template') { const t = BERICHT_TEMPLATES.find((x) => x.ref === ref || x.ref.split('@')[0] === ref); return t ? { inhoud: t, versie: t.ref.split('@')[1] || 'v1', bron: 'code', ref: t.ref } : null; }
  return null;
}

/*
  Een nieuwe versie bewaren. Het versienummer telt op binnen soort en ref; de toelichting is
  wat de medewerker straks als melding leest. Een kleine wijziging meldt niets.
*/
export async function bewaarWerkwijze(adapter, {
  companyId, soort, ref, inhoud, watVeranderd, waarom, watAnders, voorStappen = [], soortWijziging = 'inhoudelijk', geldigVanaf, doorPersonId = null, werkgebied = null,
} = {}) {
  if (!companyId || !soort || !ref) throw new Error('bewaarWerkwijze vereist companyId, soort en ref.');
  if (!WERKWIJZE_SOORTEN.includes(soort)) throw new Error(`soort '${soort}' is onbekend. Kies ${WERKWIJZE_SOORTEN.join(', ')}.`);
  if (!WIJZIGING_SOORTEN.includes(soortWijziging)) throw new Error(`soort wijziging '${soortWijziging}' is onbekend. Kies ${WIJZIGING_SOORTEN.join(', ')}.`);
  if (soortWijziging === 'inhoudelijk' && !String(watVeranderd || '').trim()) throw new Error('een inhoudelijke wijziging vraagt wat er veranderd is; dat is de melding aan je collega.');
  const alle = await adapter.fetchSalesWerkwijzen();
  /* Het versienummer telt door binnen soort, ref en werkgebied. */
  const huidig = [...laatsteWerkwijzen(alle, companyId, werkgebied).values()].find((x) => x.soort === soort && x.ref === ref && (x.werkgebied || null) === (werkgebied || null));
  const versie = Number((huidig || {}).versie || 0) + 1;
  const r = await adapter.insertSalesWerkwijze({
    company_id: companyId, soort, ref, versie, inhoud: inhoud || {},
    wat_veranderd: watVeranderd || null, waarom: waarom || null, wat_anders: watAnders || null,
    voor_stappen: voorStappen, soort_wijziging: soortWijziging, geldig_vanaf: geldigVanaf || null, door: doorPersonId, werkgebied: werkgebied || null,
  });
  return { id: r.id, soort, ref, versie, werkgebied: werkgebied || null, gemeld: soortWijziging === 'inhoudelijk' };
}

/*
  De meldingen voor een medewerker: inhoudelijke wijzigingen die hij nog niet bekeken heeft,
  die vandaag of eerder ingaan. Met stappen erbij filtert hij op zijn eigen werkzaamheden.
*/
export function meldingenVoor({ werkwijzen = [], gezien = [], companyId, gebruikerId, personId = null, stappen = null, werkgebieden = null, vandaag } = {}) {
  /* Wie heeft hem gezien: het account als er een is, anders de persoon (de oefenstand en de
     dagen voordat de eerste beheerder bestaat). */
  const isVanMij = (g) => (gebruikerId ? g.gebruiker_id === gebruikerId : (personId ? g.person_id === personId : true));
  const bekeken = new Set(gezien.filter(isVanMij).map((g) => g.werkwijze_id));
  return eigen(werkwijzen, companyId)
    .filter((w) => w.soort_wijziging === 'inhoudelijk' && w.actief !== false)
    .filter((w) => !bekeken.has(w.id))
    .filter((w) => !vandaag || !w.geldig_vanaf || String(w.geldig_vanaf).slice(0, 10) <= vandaag)
    .filter((w) => !stappen || !(w.voor_stappen || []).length || (w.voor_stappen || []).some((s) => stappen.includes(s)))
    .filter((w) => !w.werkgebied || !werkgebieden || !werkgebieden.length || werkgebieden.includes(w.werkgebied))
    .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
    .map((w) => ({
      id: w.id, soort: w.soort, ref: w.ref, versie: w.versie, watVeranderd: w.wat_veranderd, waarom: w.waarom,
      watAnders: w.wat_anders, voorStappen: w.voor_stappen || [], werkgebied: w.werkgebied || null, geldigVanaf: w.geldig_vanaf ? String(w.geldig_vanaf).slice(0, 10) : null, door: w.door,
    }));
}

/* Bekeken: dezelfde melding komt daarna niet meer terug. */
export async function markeerGezien(adapter, { werkwijzeId, gebruikerId = null, personId = null } = {}) {
  if (!werkwijzeId) throw new Error('markeerGezien vereist werkwijzeId.');
  await adapter.insertSalesWerkwijzeGezien({ werkwijze_id: werkwijzeId, gebruiker_id: gebruikerId, person_id: personId });
  return { ok: true };
}

/* De geschiedenis van een werkwijze: elke versie met zijn toelichting, nieuwste eerst. */
export function geschiedenisVan({ werkwijzen = [], companyId, soort, ref } = {}) {
  return eigen(werkwijzen, companyId)
    .filter((w) => w.soort === soort && w.ref === ref)
    .sort((a, b) => Number(b.versie || 0) - Number(a.versie || 0))
    .map((w) => ({ id: w.id, versie: w.versie, watVeranderd: w.wat_veranderd, waarom: w.waarom, watAnders: w.wat_anders, soortWijziging: w.soort_wijziging, geldigVanaf: w.geldig_vanaf ? String(w.geldig_vanaf).slice(0, 10) : null, door: w.door, wanneer: w.created_at }));
}
