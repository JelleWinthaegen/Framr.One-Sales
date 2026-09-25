/* Framr.One Sales: de schermen. Geen framework, geen bouwstap; de server levert JSON, dit
   bestand tekent. Elk scherm is een functie die zijn data haalt en het blad vult. Alle tekst
   uit de data gaat door esc() voordat hij in de pagina komt.

   Drie groepen in de navigatie: werk uitvoeren (Vandaag, Belsessie, Leads, Agenda, Opvolging),
   terugkijken en verbeteren (Funnel, Weekrapport, Gesprekken, Bezwaren, Demo's, Feedback,
   Partners) en beheer (Scripts, Templates, Opvolgreeksen, Keuzelijsten, Gegevens). Overal
   dezelfde filter: mijn werk, iedereen, of een collega.

   Stijl: blokcommentaar, geen lange streepjes en geen emoji, conform de projectafspraken. */

const scherm = document.getElementById('scherm');
const nav = document.getElementById('nav');
const zijvoet = document.getElementById('zijvoet');

const GROEPEN = [
  ['Werk', 'wat je vandaag doet', [['vandaag', 'Vandaag'], ['bellen', 'Belsessie'], ['leads', 'Leads'], ['nieuw', 'Bedrijf toevoegen'], ['agenda', 'Agenda'], ['opvolging', 'Opvolging']]],
  ['Terugkijken', 'wat we leren', [['funnel', 'Funnel'], ['week', 'Weekrapport'], ['weekreview', 'Weekreview'], ['gesprekken', 'Gesprekken en opnames'], ['bezwaren', 'Bezwaren'], ['demos', "Demo's"], ['feedback', 'Feedback'], ['partners', 'Partners']]],
  ['Beheer', 'hoe we werken', [['scripts', 'Scripts'], ['templates', 'Berichttemplates'], ['reeksen', 'Opvolgreeksen'], ['keuzelijsten', 'Keuzelijsten'], ['gebruikers', 'Gebruikers'], ['data', 'Gegevens']]],
];
const SCHERMEN = GROEPEN.flatMap(([, , lijst]) => lijst);
/* Welke groepen openstaan in het menu. Werk staat open, de rest klap je uit als je hem nodig
   hebt; zo is de lijst kort en valt er niets meer onder de rand weg. Keuze blijft bewaard. */
let navOpen = ['Werk'];
/* De aantallen achter Vandaag en Belsessie. Ze komen uit de werklijst en staan hier zodat je ze
   vanaf elk scherm ziet: dat is het overzicht van wat er nog moet. */
let navTellers = {};

let stand = null;
let beller = null;
let scope = 'mijn';
/* Begeleid (de hele werkwijze bij elke taak) of compact (context, aandachtspunten en de velden; de werkwijze achter een knop). Voorkeur per gebruiker. */
let weergave = 'begeleid';
/* Het werkgebied (vloeren, kozijnen, schilders): leeg is alles. Dezelfde basis, eigen werkwijzen per gebied. */
let werkgebied = '';

function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const woord = (s) => esc(String(s || '').replace(/_/g, ' '));
const dag = (d) => (d ? esc(String(d).slice(0, 10)) : '');
const tal = (n) => (n === null || n === undefined ? 'n.v.t.' : esc(n));
const pct = (n) => (n === null || n === undefined ? 'n.v.t.' : `${esc(n)}%`);
const cijfers = (s) => String(s || '').replace(/\D/g, '').replace(/^0/, '31');
const uuid = () => (window.crypto && crypto.randomUUID ? crypto.randomUUID() : `v-${Date.now()}-${Math.random().toString(16).slice(2)}`);
const naamVanBeller = (id) => ((stand.bellers.find((b) => b.id === id) || {}).name || null);
/* Heeft de ingelogde gebruiker dit recht? Zonder accounts staat alles open (de oefenstand). */
const mag = (recht) => !stand.ik || (stand.ik.rechtenActief || []).includes(recht);
const vandaagDag = () => stand.vandaag;

async function api(pad, body) {
  const r = await fetch(pad, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : undefined);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.fout || `fout ${r.status}`);
  return j;
}

function melding(tekst) {
  const oud = document.querySelector('.fr-melding');
  if (oud) oud.remove();
  const el = document.createElement('div');
  el.className = 'fr-melding';
  el.textContent = tekst;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 4200);
}

async function doe(pad, body, klaar) {
  try {
    const r = await api(pad, body);
    melding(klaar ? klaar(r) : 'Vastgelegd.');
    render();
  } catch (e) {
    melding(e.message);
  }
}

/* ---------- bouwstenen ---------- */

function modusBalk() {
  /* Voor het inloggen weten we de stand nog niet; dan geen misleidend bandje. */
  if (!stand || stand.modus === 'onbekend') return '';
  return `<div class="bd-modus ${stand.modus === 'nep' ? 'nep' : (stand.modus === 'live-lezen' ? 'lezen' : '')}">${stand.modus === 'nep' ? 'oefenstand, verzonnen gegevens' : (stand.modus === 'live-lezen' ? 'live, alleen lezen' : 'live, schrijven aan')} | ${esc(stand.vandaag)}</div>`;
}
function kop(eyebrow, titel, onderkop, rechts = '', uitleg = '') {
  return `${modusBalk()}<div class="fr-paginakop"><div><p class="fr-eyebrow">${esc(eyebrow)}</p><h1 class="fr-kop">${esc(titel)}</h1>${onderkop ? `<p class="fr-onderkop">${onderkop}</p>` : ''}${uitleg ? `<details class="bd-uitleg"><summary>Hoe werkt dit</summary><p>${uitleg}</p></details>` : ''}</div>${rechts ? `<div class="fr-paginakop-acties">${rechts}</div>` : ''}</div>`;
}
function blokkop(titel, maatje = null, rechts = '') {
  return `<div class="fr-blokkop"><h2>${esc(titel)}</h2>${maatje !== null ? `<span class="maatje">${esc(maatje)}</span>` : ''}${rechts ? `<div class="rechts">${rechts}</div>` : ''}</div>`;
}
function tegels(lijst) {
  return `<div class="fr-tegels">${lijst.map(([naam, waarde, extra, titel]) => `<div class="fr-tegel" ${titel ? `title="${esc(titel)}"` : ''}><div class="naam">${esc(naam)}</div><div class="waarde ${extra || ''}">${waarde}</div></div>`).join('')}</div>`;
}
function leeg(tekst) {
  return `<div class="fr-leeg"><p>${esc(tekst)}</p></div>`;
}
function stip(klasse, tekst) {
  return `<span class="bd-stip ${klasse}">${woord(tekst)}</span>`;
}
/* De werkbalk die op elk werkscherm staat: wie ben ik, en welk werk zie ik. */
function werkbalk() {
  const collegas = stand.bellers.filter((b) => b.id !== beller);
  /* Ingelogd: je bent wie je bent, en je logt uit. Zonder accounts kies je wie je bent. */
  const wie = stand.ik
    ? `<div class="bd-kies"><label>ik ben</label><span class="bd-ikben">${esc(naamVanBeller(beller) || stand.ik.email)} <span class="bd-badge">${esc(stand.ik.rol)}</span></span><button type="button" class="bd-knopje" data-uitloggen="1">Uitloggen</button></div>`
    : `<div class="bd-kies"><label>ik ben</label><div class="fr-seg klein">${stand.bellers.map((b) => `<button type="button" data-beller="${esc(b.id)}" class="${b.id === beller ? 'aan' : ''}">${esc(b.name)}</button>`).join('')}</div></div>`;
  return `<div class="bd-werkbalk">${wie}
    ${(stand.werkgebieden || []).length > 1 ? `<div class="bd-kies"><label>werkgebied</label><select class="fr-in klein" data-werkgebied="1"><option value="">${stand.mijnWerkgebieden ? 'mijn gebieden' : 'alle'}</option>${stand.werkgebieden.map((g) => `<option value="${esc(g)}" ${werkgebied === g ? 'selected' : ''}>${woord(g)}</option>`).join('')}</select></div>` : ''}
    <div class="bd-kies"><label>weergave</label><div class="fr-seg klein"><button type="button" data-weergave="begeleid" class="${weergave === 'begeleid' ? 'aan' : ''}" title="de hele werkwijze bij elke taak">begeleid</button><button type="button" data-weergave="compact" class="${weergave === 'compact' ? 'aan' : ''}" title="context, aandachtspunten en de velden; de werkwijze achter een knop">compact</button></div></div>
    <div class="bd-kies"><label>werk van</label><select class="fr-in klein" data-scope="1"><option value="mijn" ${scope === 'mijn' ? 'selected' : ''}>mijn werk</option><option value="iedereen" ${scope === 'iedereen' ? 'selected' : ''}>iedereen</option>${collegas.map((b) => `<option value="${esc(b.id)}" ${scope === b.id ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}</select></div></div>`;
}
const scopeQuery = () => `beller=${encodeURIComponent(beller || '')}&scope=${encodeURIComponent(scope)}${werkgebied ? `&werkgebied=${encodeURIComponent(werkgebied)}` : ''}`;
const scopeWoord = () => (scope === 'mijn' ? 'mijn werk' : (scope === 'iedereen' ? 'iedereen' : naamVanBeller(scope) || 'collega'));

/* Een knop die schrijft: buiten de schrijfstand staat hij uit. Een verzendknop van een
   formulier krijgt type submit; een tweede type-attribuut in attrs zou de browser negeren. */
function schrijfKnop(label, klasse = 'fr-knop klein', attrs = '', recht = 'sales') {
  const submit = /type="submit"/.test(attrs);
  const rest = attrs.replace(/type="submit"/, '');
  const uit = !stand.schrijven ? 'Deze server leest alleen' : (recht && !mag(recht) ? `je account heeft het recht ${recht} niet` : null);
  return `<button type="${submit ? 'submit' : 'button'}" class="${klasse}" ${rest} ${uit ? `disabled title="${esc(uit)}"` : ''}>${esc(label)}</button>`;
}
function fase(naam) {
  if (!naam) return '<span class="bd-stip">zonder status</span>';
  const eind = ['verloren', 'niet_meer_benaderen'].includes(naam);
  const warm = ['gesproken', 'gekwalificeerd', 'informatie_verstuurd', 'follow_up_nodig', 'demo_gepland', 'demo_afgerond', 'account_aangeboden'].includes(naam);
  const partner = ['account_aangemaakt', 'onboarding', 'eerste_project', 'eerste_bestelling', 'actieve_partner'].includes(naam);
  return stip(eind ? 'stil' : (partner ? 'goed' : (warm ? 'aan' : '')), naam);
}
function commercieel(c) {
  return `<span class="bd-badge ${c === 'actieve_partner' ? 'groen' : (['demo', 'onboarding', 'gekwalificeerd'].includes(c) ? 'oranje' : '')}">${woord(c || 'verloren')}</span>`;
}
function reactieWoord(r) {
  if (!r || r.status === 'geen') return '<span class="fr-hint">geen reactie verwacht</span>';
  if (r.status === 'wacht') return `<span class="bd-badge">wacht op reactie${r.termijn ? ` tot ${dag(r.termijn)}` : ''}</span>`;
  if (r.status === 'verstreken') return `<span class="bd-badge oranje">termijn verstreken ${dag(r.termijn)}</span>`;
  return `<span class="bd-badge groen">reactie ${dag(r.ontvangenOp)}</span>`;
}
function laatsteContactWoord(c) {
  if (!c) return '<span class="fr-hint">nog geen contact</span>';
  return `${dag(c.dag)} ${c.richting === 'inkomend' ? 'reactie per ' : ''}${typeWoord(c.type)}${c.uitkomst ? `: ${woord(c.uitkomst)}` : ''}`;
}
function volgendeWoord(v) {
  if (!v) return '<span class="bd-let">geen volgende actie</span>';
  return `${v.contactreden ? `<b>${redenWoord(v.contactreden)}</b>: ` : ''}${taakWoord(v.taak)} ${dag(v.dag)}${v.tijd ? ` ${esc(v.tijd)}` : ''}${v.teLaat ? ' <span class="bd-let">te laat</span>' : ''}${v.wieNaam ? ` <span class="fr-hint">${esc(v.wieNaam)}</span>` : ''}<span class="bd-sub">${esc(v.reden || '')}</span>`;
}
const linkLead = (id, naam) => `<a href="#/lead/${esc(id)}">${esc(naam)}</a>`;
const TAAKWOORD = { call: 'bellen', whatsapp: 'WhatsApp', email: 'mail', demo: 'demo', onboarding: 'account inrichten', check_in: 'beoordelen', afronden: 'afronden', beoordelen: 'beoordelen', gesprek: 'gesprek', bezoek: 'bezoek' };
const taakWoord = (t) => esc(TAAKWOORD[t] || String(t || 'controle').replace(/_/g, ' '));
const typeWoord = (t) => esc(t === 'call' ? 'gesprek' : (t === 'note' ? 'notitie' : String(t || '')));
/* De reden voor contact in gewone woorden (aanvulling Jelle, onderdeel 2). */
const REDENWOORD = { eerste_kennismaking: 'eerste kennismaking', terugbellen_op_verzoek: 'terugbellen op verzoek', informatie_sturen: 'informatie sturen', opvolgen_na_informatie: 'opvolgen na verstuurde informatie', demo_plannen: 'demo plannen', demo_uitvoeren: 'demo uitvoeren', demo_opvolgen: 'demo opvolgen', helpen_bij_eerste_project: 'helpen bij het eerste project', bestelling_geleverd: 'bestelling geleverd: vragen hoe het ging', probleem_oplossen: 'probleem oplossen', relatie_onderhouden: 'klantrelatie onderhouden', volgend_project_bespreken: 'volgend project bespreken', beoordelen: 'beoordelen: pauzeren of stoppen', later_opnieuw_peilen: 'later opnieuw peilen' };
const redenWoord = (r) => esc(REDENWOORD[r] || String(r || 'reden onbekend').replace(/_/g, ' '));

/* Het AI-kopje bij een gesprek: wat er volgens de AI gebeurd is. Naast wat de beller zelf
   invulde, nooit in plaats daarvan. Zonder analyse zegt het waarom, met een knop om hem te
   starten of een transcript te plakken. */
function aiKopje(i) {
  const a = i.aiAnalyse;
  const lijst = (titel, items, f = (x) => esc(x)) => (items && items.length ? `<p class="bd-ai-p"><b>${esc(titel)}</b> ${items.map(f).join('; ')}</p>` : '');
  const plak = `<div id="tr-${esc(i.id)}" hidden><form class="fr-form" data-transcript="${esc(i.id)}"><label>Transcript<textarea name="transcript" placeholder="Plak hier de tekst van het gesprek"></textarea></label><div class="fr-knoppenrij">${schrijfKnop('Analyseer', 'fr-knop klein', 'type="submit"')}</div></form></div>`;
  if (!a) {
    if (!i.opname && !i.transcript && !(i.opnames && i.opnames.length)) return '';
    return `<div class="bd-ai"><span class="bd-ai-kop">AI</span><span class="fr-hint">nog niet geanalyseerd</span> ${schrijfKnop('Laat AI kijken', 'bd-knopje', `data-analyseer="${esc(i.id)}"`)} ${schrijfKnop('Transcript plakken', 'bd-knopje', `data-uitklap="tr-${esc(i.id)}"`)}${plak}</div>`;
  }
  if (a.status === 'wacht' || a.status === 'fout') {
    return `<div class="bd-ai"><span class="bd-ai-kop">AI</span><span class="${a.status === 'fout' ? 'bd-let' : 'fr-hint'}">${esc(a.status === 'fout' ? 'mislukt' : 'wacht')}: ${esc(a.reden || '')}</span> ${schrijfKnop('Opnieuw', 'bd-knopje', `data-analyseer="${esc(i.id)}"`)} ${schrijfKnop('Transcript plakken', 'bd-knopje', `data-uitklap="tr-${esc(i.id)}"`)}${plak}</div>`;
  }
  return `<div class="bd-ai"><span class="bd-ai-kop">Volgens AI</span><span class="fr-hint">voorstel, ${esc(a.model || '')}${a.praatAandeelBeller ? `, beller sprak ${esc(a.praatAandeelBeller)}%` : ''}${a.koopkans !== null && a.koopkans !== undefined ? `, koopkans ${esc(a.koopkans)}%` : ''}${a.temperatuur ? `, ${esc(a.temperatuur)}` : ''}</span>
    ${a.samenvatting ? `<p class="bd-ai-p">${esc(a.samenvatting)}</p>` : ''}
    ${a.wilWel ? `<p class="bd-ai-p"><b>Wil wel</b> ${esc(a.wilWel)}</p>` : ''}${a.wilNiet ? `<p class="bd-ai-p"><b>Wil niet</b> ${esc(a.wilNiet)}</p>` : ''}${a.waarom ? `<p class="bd-ai-p"><b>Waarom</b> ${esc(a.waarom)}</p>` : ''}
    ${lijst('Bezwaren', a.bezwaren, (b) => `${esc(b.bezwaar)}${b.categorie ? ` [${woord(b.categorie)}]` : ''}${b.reactie ? `, reactie: ${esc(b.reactie)}` : ''}${b.reactieWerkte === true ? ' (werkte)' : (b.reactieWerkte === false ? ' (werkte niet)' : '')}`)}
    ${lijst('Vragen', a.vragen, (q) => `${esc(q.vraag)}${q.antwoord ? ` (${esc(q.antwoord)})` : ' (onbeantwoord)'}`)}
    ${lijst('Kansen', a.kansen, (k) => `${esc(k.naam)}${k.geschatM2 ? `, ${esc(k.geschatM2)} m2` : ''}${k.projectdatum ? `, ${esc(k.projectdatum)}` : ''}`)}
    ${lijst('Voorgestelde veldwijzigingen', a.discovery, (d) => `${woord(d.veld)}: ${esc(d.waarde)} (${esc(d.zekerheid || 'voorlopig')})`)}
    ${lijst('Beloftes van ons', a.beloftesFramr)}${lijst('Beloftes van hem', a.beloftesLead)}${lijst('Onbeantwoord', a.onbeantwoordeVragen)}${lijst('Weetjes', a.weetjes)}
    ${lijst('Suggesties', a.suggesties, (s) => `${esc(s.categorie)}: ${esc(s.voorstel)}`)}
    ${a.aiAdvies ? `<p class="bd-ai-p"><b>Advies</b> ${esc(a.aiAdvies)}</p>` : ''}
    ${a.volgendeActie ? `<p class="bd-ai-p"><b>Volgende actie</b> ${esc(a.volgendeActie.actie)}${a.volgendeActie.datum ? ` op ${esc(a.volgendeActie.datum)}` : ''}</p>` : ''}
    ${a.voorgesteldBericht ? `<p class="bd-ai-p"><b>Voorgesteld bericht</b> ${esc(a.voorgesteldBericht)}</p>` : ''}
    ${a.tags && a.tags.length ? `<p class="bd-ai-p">${a.tags.map((t) => `<span class="bd-badge">${esc(t)}</span>`).join(' ')}</p>` : ''}
    ${a.waarschuwingen && a.waarschuwingen.length ? `<p class="bd-ai-p bd-let">${a.waarschuwingen.map(esc).join(' ')}</p>` : ''}
    <div class="bd-acties">${i.provisional ? schrijfKnop('Bevestig als gecontroleerd', 'bd-knopje', `data-bevestig="${esc(i.id)}"`) : '<span class="fr-hint">bevestigd door een mens; wat de beller invulde blijft leidend</span>'} ${schrijfKnop('Opnieuw analyseren', 'bd-knopje', `data-analyseer="${esc(i.id)}"`)}</div></div>`;
}

/* De drie vragen van Jelle, in elk gespreksformulier bovenaan de invullijst. */
function drieVragen(bekend = {}) {
  const hint = (v) => (bekend[v] ? `<span class="fr-hint">eerder: ${esc(bekend[v])}</span>` : '');
  return `<p class="bd-tekst"><b>Wat wil hij wel, wat wil hij niet, en waarom</b> (in zijn woorden)</p>
    <div class="fr-veldrij"><label>Wil wel${hint('wil_wel')}<textarea name="a_wil_wel" rows="2"></textarea></label><label>Wil niet${hint('wil_niet')}<textarea name="a_wil_niet" rows="2"></textarea></label><label>Waarom${hint('waarom')}<textarea name="a_waarom" rows="2"></textarea></label></div>`;
}
/* De samenvatting in vier onderdelen: wie en context, hoe hij nu werkt, behoefte of belemmering, afgesproken. */
function samenvattingVier() {
  return `<p class="bd-tekst"><b>Samenvatting in vier onderdelen</b> (een overzicht, geen limiet: de rest komt in bezwaren, extra's en velden)</p>
    <div class="fr-veldrij"><label>Wie gesproken en in welke context<textarea name="s_wie" rows="2"></textarea></label><label>Hoe werkt hij nu<textarea name="s_werkt" rows="2"></textarea></label></div>
    <div class="fr-veldrij"><label>Behoefte, kans of belemmering<textarea name="s_behoefte" rows="2"></textarea></label><label>Wat is concreet afgesproken<textarea name="s_afgesproken" rows="2"></textarea></label></div>`;
}
function samenvattingUit(d) {
  const delen = [['Wie', d.s_wie], ['Nu', d.s_werkt], ['Behoefte', d.s_behoefte], ['Afgesproken', d.s_afgesproken]].filter(([, v]) => v && v.trim()).map(([k, v]) => `${k}: ${v.trim()}`);
  return delen.length ? delen.join('\n') : (d.samenvatting || '');
}
/* Een herhaalbaar blok: bezwaren (nul, een of meer) en extra dingen. */
function bezwaarBlok(n = 0) {
  const cats = stand.bezwaarCategorieen.map((c) => `<option value="${esc(c)}">${woord(c)}</option>`).join('');
  return `<div class="bd-herhaal-item" data-soort="bezwaar"><div class="fr-veldrij"><label>Letterlijke uitspraak<input type="text" name="b_bezwaar" placeholder="ik heb al een leverancier"></label><label>Categorie<select name="b_categorie"><option value="">kies</option>${cats}</select></label><label>Soort<select name="b_soort"><option value="">-</option><option value="tijdelijk">tijdelijk bezwaar</option><option value="definitief">definitieve afwijzing</option></select></label></div>
    <div class="fr-veldrij"><label>Context<input type="text" name="b_context" placeholder="waar in het gesprek, waarom"></label><label>Onze reactie<input type="text" name="b_reactie"></label><label>Werkte het<select name="b_resultaat"><option value="onbekend">onbekend</option><option value="ja">ja</option><option value="gedeeltelijk">gedeeltelijk</option><option value="nee">nee</option></select></label></div>
    <div class="fr-veldrij"><label>Wat daarna is afgesproken<input type="text" name="b_afspraak"></label><label>Vervolgactie<input type="text" name="b_vervolg"></label><label>&nbsp;<button type="button" class="bd-knopje" data-verwijder="1">Weg</button></label></div></div>`;
}
/* De servicevelden en een probleem uit een servicegesprek (aanvulling onderdeel 3). */
const SERVICE_VELDEN = ['levering_goed', 'project_verlopen', 'klant_tevreden', 'problemen_gehad', 'verbeterpunt', 'context_volgend_gesprek'];
const uitkomstOpties = (stap) => (stap === 'service' ? stand.serviceUitkomsten : stand.uitkomsten.filter((u) => !(stand.regels[u] || {}).oud)).map((u) => `<option value="${esc(u)}">${woord(u)}</option>`).join('');
function probleemBlok() {
  return `<div class="bd-herhaal-item" data-soort="probleem"><div class="fr-veldrij"><label style="flex:3 1 320px">Probleem<input type="text" name="p_omschrijving" placeholder="wat is er mis, in zijn woorden"></label><label>Soort<select name="p_soort">${stand.probleemSoorten.map((x) => `<option value="${esc(x)}">${esc(x)}</option>`).join('')}</select></label><label>Verantwoordelijke<select name="p_wie">${stand.bellers.map((b) => `<option value="${esc(b.id)}" ${b.id === beller ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}</select></label><label>Vervolg op<input type="date" name="p_datum"></label><label>&nbsp;<button type="button" class="bd-knopje" data-verwijder="1">Weg</button></label></div></div>`;
}
function probleemBlokken() {
  return `<p class="bd-tekst"><b>Problemen</b> <span class="fr-hint">(elk apart: wie pakt het op en wanneer is het vervolg)</span></p>${probleemSectie()}`;
}
function extraBlok() {
  return `<div class="bd-herhaal-item" data-soort="extra"><div class="fr-veldrij"><label>Soort<select name="e_soort">${stand.extraSoorten.map((s) => `<option value="${esc(s)}">${woord(s)}</option>`).join('')}</select></label><label style="flex:3 1 320px">Inhoud<input type="text" name="e_inhoud" placeholder="wat je hoorde, in zijn woorden"></label><label>&nbsp;<button type="button" class="bd-knopje" data-verwijder="1">Weg</button></label></div></div>`;
}
/* De drie herhaalbare stukken los, zodat de belsessie ze in eigen vakken kan zetten en het
   demoscherm ze onder elkaar houdt. */
function bezwaarSectie(eerdereBezwaren = []) {
  return `${eerdereBezwaren.length ? `<ul class="bd-lijstje bd-eerder">${eerdereBezwaren.slice(0, 5).map((b) => `<li><span class="fr-hint">eerder ${dag(b.datum)}:</span> "${esc(b.bezwaar)}"${b.categorie ? ` <span class="bd-badge">${woord(b.categorie)}</span>` : ''}${b.reactie ? ` <span class="fr-hint">reactie: ${esc(b.reactie)} (${esc(b.resultaat)})</span>` : ''}</li>`).join('')}</ul>` : ''}
    <div class="bd-herhaal" data-herhaal="bezwaar"></div><div class="bd-acties"><button type="button" class="bd-knopje" data-toevoegen="bezwaar">Bezwaar toevoegen</button></div>`;
}
function extraSectie() {
  return '<div class="bd-herhaal" data-herhaal="extra"></div><div class="bd-acties"><button type="button" class="bd-knopje" data-toevoegen="extra">Toevoegen</button></div>';
}
function probleemSectie() {
  return '<div class="bd-herhaal" data-herhaal="probleem"></div><div class="bd-acties"><button type="button" class="bd-knopje" data-toevoegen="probleem">Probleem toevoegen</button></div>';
}
function herhaalBlokken(eerdereBezwaren = []) {
  return `<p class="bd-tekst"><b>Bezwaren</b> (nul, een of meer; elk apart)</p>
    ${bezwaarSectie(eerdereBezwaren)}
    <p class="bd-tekst"><b>Meer dat je hoorde</b> (vraag, inzicht, productwens, persoonlijke context, afspraak, notitie)</p>
    ${extraSectie()}`;
}
function verzamelHerhaal(form) {
  const bezwaren = [...form.querySelectorAll('.bd-herhaal-item[data-soort="bezwaar"]')].map((el) => {
    const v = (n) => (el.querySelector(`[name="${n}"]`) || {}).value || '';
    return { bezwaar: v('b_bezwaar'), categorie: v('b_categorie'), soort: v('b_soort'), context: v('b_context'), reactie: v('b_reactie'), resultaat: v('b_resultaat') || 'onbekend', afspraak: v('b_afspraak'), vervolgactie: v('b_vervolg') };
  }).filter((b) => b.bezwaar.trim());
  const problemen = [...form.querySelectorAll('.bd-herhaal-item[data-soort="probleem"]')].map((el) => { const v = (n) => (el.querySelector(`[name="${n}"]`) || {}).value || ''; return { omschrijving: v('p_omschrijving'), soort: v('p_soort'), verantwoordelijkeId: v('p_wie'), vervolgdatum: v('p_datum') || undefined }; }).filter((x) => x.omschrijving.trim());
  const extras = [...form.querySelectorAll('.bd-herhaal-item[data-soort="extra"]')].map((el) => ({ soort: (el.querySelector('[name="e_soort"]') || {}).value, inhoud: (el.querySelector('[name="e_inhoud"]') || {}).value || '' })).filter((e) => e.inhoud.trim());
  return { bezwaren, extras, problemen };
}
function discoveryVeldInput(veld, label, bekend = {}) {
  const lijst = stand.waardenPerVeld[veld];
  const hint = bekend[veld] ? `<span class="fr-hint">bekend: ${esc(bekend[veld])}</span>` : '';
  if (lijst) return `<label>${esc(label)}${hint}<select name="a_${esc(veld)}"><option value="">-</option>${lijst.map((w) => `<option value="${esc(w)}">${woord(w)}</option>`).join('')}</select></label>`;
  return `<label>${esc(label)}${hint}<input type="text" name="a_${esc(veld)}"></label>`;
}
function templateKeuze(kanaal, stap) {
  const lijst = stand.templates.filter((t) => t.kanaal === kanaal);
  return `<select name="templateRef" data-template="1"><option value="">zonder template</option>${lijst.map((t) => `<option value="${esc(t.ref)}" ${t.stap === stap ? 'selected' : ''}>${esc(t.naam)} (${esc(t.ref)})</option>`).join('')}</select>`;
}
function vulTemplate(tekst, waarden) {
  return String(tekst || '').replace(/\[(\w+)\]/g, (m, k) => (waarden[k] ? String(waarden[k]) : m));
}
function templateTekst(ref, lead) {
  const t = stand.templates.find((x) => x.ref === ref);
  if (!t) return '';
  return vulTemplate(t.tekst, { naam: lead ? (lead.contactpersoon || lead.naam) : '', beller: naamVanBeller(beller) || '', link: 'https://framr.one/p/vloeren' });
}
/* Het formulier om een bericht vast te leggen: wat, via wat, met welke link, of een reactie verwacht wordt en tot wanneer. */
function berichtForm(leadId, lead, stap = 'eerste_contact', kanaal = 'whatsapp') {
  const mats = stand.materialen.length ? stand.materialen : ['landingspagina'];
  const t = stand.templates.find((x) => x.kanaal === kanaal && x.stap === stap) || stand.templates.find((x) => x.kanaal === kanaal);
  return `<form class="fr-form" data-bericht="${esc(leadId)}">
    <div class="fr-veldrij"><label>Kanaal<select name="kanaal"><option value="whatsapp" ${kanaal === 'whatsapp' ? 'selected' : ''}>WhatsApp</option><option value="email" ${kanaal === 'email' ? 'selected' : ''}>mail</option></select></label><label>Template${templateKeuze(kanaal, stap)}</label><label>Materiaal<select name="materiaal">${mats.map((m) => `<option value="${esc(m)}" ${t && t.materiaal === m ? 'selected' : ''}>${woord(m)}</option>`).join('')}</select></label></div>
    <label>Berichttekst (wat er echt verstuurd is)<textarea name="tekst" rows="4">${esc(t ? templateTekst(t.ref, lead) : '')}</textarea></label>
    <div class="fr-veldrij"><label>Exacte link<input type="text" name="link" value="https://framr.one/p/vloeren"></label><label>Status<select name="verzendStatus"><option value="bevestigd">verstuurd, met de hand bevestigd</option><option value="concept">concept, klaargezet</option><option value="mislukt">verzending mislukt</option></select></label><label>Reactie verwacht<select name="reactieVerwacht"><option value="1">ja</option><option value="0">nee</option></select></label><label>Termijn (werkdagen)<input type="number" name="reactieTermijnDagen" min="0" value="${esc(t ? t.reactieTermijnDagen : 3)}"></label></div>
    <div class="fr-knoppenrij">${lead && (lead.whatsapp || lead.telefoon) ? `<a class="fr-knop klein tweede" href="https://wa.me/${esc(cijfers(lead.whatsapp || lead.telefoon))}" target="_blank" rel="noopener">Open WhatsApp</a>` : ''}${lead && lead.email ? `<a class="fr-knop klein tweede" href="mailto:${esc(lead.email)}">Open mail</a>` : ''}${schrijfKnop('Als verstuurd vastleggen', 'fr-knop klein', 'type="submit"')}<span class="fr-hint">Een klik op WhatsApp is geen bewijs; jij bevestigt dat het weg is. Geen reactie binnen de termijn maakt de nabeltaak uit de reeks.</span></div></form>`;
}
function reactieForm(leadId) {
  return `<form class="fr-form" data-reactie="${esc(leadId)}"><div class="fr-veldrij"><label>Via<select name="kanaal"><option value="whatsapp">WhatsApp</option><option value="email">mail</option><option value="call">hij belde</option></select></label><label style="flex:3 1 320px">Wat hij zei<input type="text" name="tekst" placeholder="letterlijk of kort"></label><label>Volgende actie<select name="volgendeTaak"><option value="call">bellen</option><option value="whatsapp">WhatsApp terug</option><option value="email">mail terug</option><option value="">geen</option></select></label><label>Op<input type="date" name="volgendeDatum" value="${esc(vandaagDag())}"></label></div>
    <div class="fr-knoppenrij">${schrijfKnop('Reactie vastleggen', 'fr-knop klein', 'type="submit"')}<span class="fr-hint">Een reactie stopt de geen-reactie-opvolging en maakt de vervolgtaak.</span></div></form>`;
}
/* Een demo plannen of verplaatsen: datum en tijd, duur, vorm, locatie of link, doel, deelnemers, verantwoordelijke. */
function demoForm(leadId, { afspraak = null, briefing = null } = {}) {
  const vormen = stand.demoVormen.length ? stand.demoVormen : ['online', 'telefonisch', 'locatie'];
  return `<form class="fr-form" data-demo="${esc(leadId)}" ${afspraak ? `data-afspraak="${esc(afspraak.id)}"` : ''}>
    <div class="fr-veldrij"><label>Datum<input type="date" name="datum" required value="${esc(afspraak ? afspraak.dag : '')}"></label><label>Starttijd<input type="time" name="tijd" required value="${esc(afspraak ? afspraak.tijd : '10:00')}"></label><label>Duur (minuten)<input type="number" name="duurMinuten" min="10" value="${esc(afspraak ? afspraak.duur || 45 : 45)}"></label><label>Vorm<select name="vorm">${vormen.map((v) => `<option value="${esc(v)}" ${(afspraak ? afspraak.vorm === v : v === 'online') ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></label></div>
    <div class="fr-veldrij"><label>Locatie of vergaderlink<input type="text" name="link" value="${esc(afspraak ? afspraak.link || afspraak.locatie || '' : '')}"></label><label>Verantwoordelijke<select name="verantwoordelijkeId">${stand.bellers.map((b) => `<option value="${esc(b.id)}" ${(afspraak ? afspraak.wie === b.name : b.id === beller) ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}</select></label><label>Deelnemers<input type="text" name="deelnemers" value="${esc(afspraak ? afspraak.deelnemers || '' : '')}" placeholder="contactpersoon, compagnon"></label></div>
    <label>Doel<input type="text" name="doel" value="${esc(afspraak ? afspraak.doel || '' : 'zijn eigen project samen doorrekenen')}"></label>
    ${briefing ? `<details class="bd-details"><summary>Voorbereiding uit eerdere gesprekken</summary><pre class="bd-pre">${esc(briefing)}</pre></details>` : ''}
    <div class="fr-knoppenrij">${schrijfKnop(afspraak ? 'Verplaatsen' : 'Demo plannen', 'fr-knop klein', 'type="submit"')}<span class="fr-hint">Een lead heeft een open afspraak; opnieuw plannen verplaatst die, nooit een tweede.</span></div></form>`;
}
/* Een taak afronden met resultaat, of verplaatsen. */
function afrondForm(t) {
  return `<form class="fr-form bd-afrond" data-afronden="${esc(t.id)}"><div class="fr-veldrij"><label>Resultaat<select name="resultaat"><option value="gedaan">gedaan</option>${['call', 'whatsapp', 'email'].includes(t.taak) ? '<option value="geen_reactie">geen reactie (volgende stap van de reeks)</option>' : ''}<option value="verplaatst">verplaatsen</option><option value="vervallen">vervallen</option></select></label><label>Nieuwe datum<input type="date" name="nieuweDatum"></label><label>Tijd<input type="time" name="nieuweTijd"></label><label>Notitie<input type="text" name="notitie"></label><label>&nbsp;${schrijfKnop('Afronden', 'fr-knop klein', 'type="submit"')}</label></div></form>`;
}
/* Een opname afspelen en uploaden. */
function speler(o, interactionId) {
  const ref = typeof o === 'string' ? o : o.ref;
  if (!ref) return '';
  if (!String(ref).startsWith('bestand:')) return `<span class="bd-sub">opname: ${esc(ref)} (op de Drive, hier niet af te spelen)</span>`;
  const naam = typeof o === 'string' ? ref.split('/').pop() : (o.naam || ref.split('/').pop());
  return `<div class="bd-speler"><audio controls preload="none" src="/api/opname/afspelen?ref=${encodeURIComponent(ref)}"></audio><span class="bd-sub">${esc(naam)}${o.duurSeconden ? `, ${esc(Math.round(o.duurSeconden / 60))} min` : ''}${o.bytes ? `, ${esc(Math.round(o.bytes / 1024))} kB` : ''}${o.status ? `, ${esc(o.status)}` : ''}</span></div>`;
}
function opnameUpload(leadId, { interactionId = null, keuzes = [] } = {}) {
  return `<form class="fr-form bd-upload" data-opname-upload="${esc(leadId)}" ${interactionId ? `data-interaction="${esc(interactionId)}"` : ''}><div class="fr-veldrij"><label>Audiobestand<input type="file" name="bestand" accept="audio/*,.m4a,.mp3,.wav,.webm,.ogg" required></label>${!interactionId ? `<label>Hoort bij<select name="doel"><option value="nieuw">nieuw gesprek (daarna afronden)</option>${keuzes.map((k) => `<option value="${esc(k.id)}">${esc(k.label)}</option>`).join('')}</select></label>` : ''}<label>Toestemming<select name="toestemming"><option value="">niet vastgelegd</option><option value="1">ja gezegd</option><option value="0">nee</option></select></label><label>&nbsp;${schrijfKnop('Uploaden en koppelen', 'fr-knop klein', 'type="submit"')}</label></div><p class="fr-hint bd-upload-status"></p></form>`;
}

/* Het gespreksformulier: alles in een keer, onder een rij, op het dossier, of om een gesprek
   zonder uitkomst af te ronden (interactionId). */
function gesprekForm(leadId, { interactionId = null, bekend = {}, eerdereBezwaren = [], lead = null, stap = 'eerste_contact', velden = null } = {}) {
  const opties = uitkomstOpties(stap);
  const dv = (velden || (stap === 'service' ? SERVICE_VELDEN : ['huidige_vloerleverancier', 'huidige_software', 'projecten_per_maand', 'm2_per_maand', 'koopt_zelf_in', 'marge_op_materiaal', 'grootste_pijnpunt', 'open_voor_tweede_leverancier', 'tevredenheid_leverancier'])).filter((v) => stand.discoveryVelden.includes(v));
  const vid = uuid();
  return `<form class="fr-form bd-gesprek" data-gesprek="${esc(leadId)}" ${interactionId ? `data-interaction="${esc(interactionId)}"` : ''} data-verzoek="${vid}" data-stap="${esc(stap)}">
    <div class="fr-veldrij">
      <label>Uitkomst<select name="uitkomst" required data-uitkomst-form="1"><option value="">kies</option>${opties}</select></label>
      <label>Opvolgen op (een afgesproken datum gaat voor de reeks)<input type="date" name="opvolgDatum"></label>
      <label>Duur (seconden)<input type="number" name="duurSeconden" min="0"></label>
    </div>
    <div class="fr-veldrij bd-demo-velden" hidden><label>Demodatum<input type="date" name="demoDatum"></label><label>Tijd<input type="time" name="demoTijd" value="10:00"></label><label>Vorm<select name="demoVorm">${(stand.demoVormen.length ? stand.demoVormen : ['online', 'telefonisch', 'locatie']).map((v) => `<option value="${esc(v)}">${esc(v)}</option>`).join('')}</select></label><label>Duur (min)<input type="number" name="demoDuur" value="45"></label></div>
    ${samenvattingVier()}
    ${drieVragen(bekend)}
    <p class="bd-tekst"><b>Wat je te weten kwam</b></p>
    <div class="fr-veldrij">${dv.map((v) => discoveryVeldInput(v, v.replace(/_/g, ' '), bekend)).join('')}</div>
    ${herhaalBlokken(eerdereBezwaren)}${stap === 'service' ? probleemBlokken() : ''}
    <p class="bd-tekst"><b>Volgend project</b></p>
    <div class="fr-veldrij"><label>Project (bijvoorbeeld PVC woning Sittard)<input type="text" name="kansNaam"></label><label>Geschatte m2<input type="number" name="kansM2" min="0"></label><label>Datum<input type="date" name="kansDatum"></label></div>
    <div class="fr-veldrij"><label>Opname (verwijzing)<input type="text" name="opnameRef" placeholder="drive:Gesprekken/bedrijf-datum.m4a of bestand:..."></label><label>Toestemming opname<select name="toestemming"><option value="">niet gevraagd</option><option value="1">ja</option><option value="0">nee</option></select></label><label>Tags (komma)<input type="text" name="tags" placeholder="concurrent, calculator, marge"></label></div>
    <div class="fr-knoppenrij">${schrijfKnop(interactionId ? 'Gesprek afronden' : 'Gesprek vastleggen', 'fr-knop', 'type="submit"')}<span class="fr-hint">De uitkomst bepaalt de fase en de volgende taak; script ${esc(stap)}.</span></div>
  </form>`;
}
function bekendVan(d) {
  const uit = {};
  for (const a of d.discovery || []) uit[a.veld] = a.waarde;
  if (d.wilWel) uit.wil_wel = d.wilWel;
  if (d.wilNiet) uit.wil_niet = d.wilNiet;
  if (d.waarom) uit.waarom = d.waarom;
  return uit;
}

/* ---------- Meldingen over een gewijzigde werkwijze (aanvulling onderdeel 6) ---------- */

/*
  Een inhoudelijke wijziging in een script, template of reeks komt hier binnen: wat is
  veranderd, waarom, vanaf wanneer, voor welke werkzaamheden, wat voortaan anders. Bekeken is
  bekeken; daarna komt hij niet meer terug. Een kleine tekstcorrectie meldt niets.
*/
function meldingBalk(stappen = null) {
  const lijst = (stand.meldingen || []).filter((m) => !stappen || !m.voorStappen.length || m.voorStappen.some((x) => stappen.includes(x)));
  if (!lijst.length) return '';
  return `<div class="bd-meldingen">${lijst.map((m) => `<div class="bd-melding">
    <div class="kop"><b>De werkwijze is aangepast</b> <span class="bd-badge">${woord(m.soort)} ${woord(m.ref)} v${esc(m.versie)}</span>${m.geldigVanaf ? `<span class="fr-hint">vanaf ${dag(m.geldigVanaf)}</span>` : ''}</div>
    <p class="bd-tekst">${esc(m.watVeranderd || '')}</p>
    ${m.waarom ? `<p class="bd-sub"><b>Waarom:</b> ${esc(m.waarom)}</p>` : ''}
    ${m.watAnders ? `<p class="bd-sub"><b>Voortaan:</b> ${esc(m.watAnders)}</p>` : ''}
    ${m.voorStappen.length ? `<p class="bd-sub">geldt voor: ${esc(m.voorStappen.map((x) => x.replace(/_/g, ' ')).join(', '))}</p>` : ''}
    <div class="bd-acties"><button type="button" class="fr-knop klein" data-gezien="${esc(m.id)}">Bekeken</button></div></div>`).join('')}</div>`;
}

/* ---------- Inloggen (aanvulling onderdeel 7) ---------- */

function schermInloggen(melding = '') {
  document.getElementById('nav').innerHTML = '';
  scherm.innerHTML = `${modusBalk()}<div class="bd-inlog"><p class="fr-eyebrow">Framr.One Sales</p><h1 class="fr-kop">Inloggen</h1>
    <p class="fr-onderkop">Met je eigen account: je ziet je eigen werk, en wat je doet staat op jouw naam.</p>
    ${melding ? `<p class="fr-formfout">${esc(melding)}</p>` : ''}
    <form class="fr-form" data-inloggen="1">
      <label>E-mailadres<input type="email" name="email" required autocomplete="username" autofocus></label>
      <label>Wachtwoord<input type="password" name="wachtwoord" required autocomplete="current-password"></label>
      <div class="fr-knoppenrij"><button type="submit" class="fr-knop">Inloggen</button></div>
    </form>
    <p class="fr-hint">Geen account? Een beheerder maakt er een onder Beheer, Gebruikers. De allereerste komt vanaf de terminal met crm/gebruiker-cli.mjs.</p></div>`;
}

/* ---------- Beheer: gebruikers ---------- */

let reviewVenster = 'zeven_dagen';

/*
  De weekreview (aanvulling onderdeel 8): wat we deze week leerden, en wat we daarom besluiten.
  Elk cijfer draagt zijn definitie; elk besluit draagt zijn gegevens, zijn verantwoordelijke en
  zijn evaluatiemoment. Een AI-voorstel blijft een voorstel tot een mens het aanneemt.
*/
/* Een lijstje met een staafje erachter: het grootste getal is de volle breedte. */
function balken(paren, label = (k) => k) {
  const max = Math.max(...paren.map(([, n]) => n), 1);
  return `<ul class="bd-balken">${paren.map(([k, n]) => `<li><span class="lbl">${esc(label(k))}</span><span class="staaf"><i style="width:${Math.round((n / max) * 100)}%"></i></span><span class="tal">${esc(n)}</span></li>`).join('')}</ul>`;
}

async function schermWeekreview() {
  const d = await api(`/api/weekreview?venster=${encodeURIComponent(reviewVenster)}`);
  const html = [kop('terugkijken', 'Weekreview', `Van ${dag(d.van)} tot ${dag(d.tot)}. Wat het opleverde, wat vastliep, en wat we daarom anders doen.`,
    `<div class="fr-seg klein"><button type="button" data-rvenster="zeven_dagen" class="${reviewVenster === 'zeven_dagen' ? 'aan' : ''}">zeven dagen</button><button type="button" data-rvenster="kalenderweek" class="${reviewVenster === 'kalenderweek' ? 'aan' : ''}">kalenderweek</button></div>`)];
  const r = d.rapport.dezeWeek;
  const vorig = d.rapport.vorigeWeek;
  const verschil = (nu, toen) => (toen === undefined || toen === null ? '' : (nu > toen ? 'goed' : (nu < toen ? 'let' : '')));
  const tel = (v) => (v && typeof v === 'object' ? v.aantal : v);
  html.push(blokkop('De week in cijfers', null, '<span class="fr-hint">tussen haakjes de week ervoor</span>'));
  html.push(tegels([
    ['belpogingen', `${esc(tel(r.belpogingen))}<small>(${esc(tel(vorig.belpogingen))})</small>`, verschil(tel(r.belpogingen), tel(vorig.belpogingen))],
    ['bereikt', `${esc(tel(r.bereikt))}<small>(${esc(tel(vorig.bereikt))})</small>`, verschil(tel(r.bereikt), tel(vorig.bereikt))],
    ['inhoudelijk', `${esc(tel(r.gesprekken))}<small>(${esc(tel(vorig.gesprekken))})</small>`, verschil(tel(r.gesprekken), tel(vorig.gesprekken))],
    ["demo's gedaan", `${esc(tel(r.demosGedaan))}<small>(${esc(tel(vorig.demosGedaan))})</small>`, verschil(tel(r.demosGedaan), tel(vorig.demosGedaan))],
    ['accounts', `${esc(tel(r.accounts))}<small>(${esc(tel(vorig.accounts))})</small>`, verschil(tel(r.accounts), tel(vorig.accounts))],
  ]));
  /* Het eerste gesprek: het doel is een demo, dus waar loopt het stuk en waar werkt het. */
  const eg = d.eersteGesprek || null;
  if (eg && eg.gesprekken) {
    html.push(blokkop('Het eerste gesprek', eg.gesprekken, `<span class="fr-hint">${esc(eg.definitie)}</span>`));
    html.push(tegels([
      ['eerste gesprekken', esc(eg.gesprekken)],
      ["demo's eruit", esc(eg.demos), eg.demos ? 'goed' : ''],
      ['dat is', eg.naarDemo === null ? 'n.v.t.' : `${esc(eg.naarDemo)}%`],
      ['afhaakmoment ingevuld', `${esc(eg.ingevuld)} van ${esc(eg.gesprekken)}`, eg.ingevuld < eg.gesprekken ? 'let' : ''],
    ]));
    html.push(`<div class="fr-twee"><div><p class="bd-tekst"><b>Waar hij afhaakte</b></p>${eg.perAfhaakmoment.length ? balken(eg.perAfhaakmoment, (k) => (stand.afhaakUitleg || {})[k] || k.replace(/_/g, ' ')) : '<p class="fr-hint">Nog niets ingevuld deze week.</p>'}</div>
      <div><p class="bd-tekst"><b>Waar hij op aansloeg</b> <span class="fr-hint">met het aandeel dat een demo werd</span></p>${eg.demoPerAanslagpunt.length ? `<ul class="bd-lijstje">${eg.demoPerAanslagpunt.map((x) => `<li>${esc((stand.aanslagUitleg || {})[x.punt] || x.punt.replace(/_/g, ' '))}: <b>${esc(x.gesprekken)}</b> keer, ${esc(x.demos)} demo${x.naarDemo === null ? '' : ` (${esc(x.naarDemo)}%)`}</li>`).join('')}</ul>` : '<p class="fr-hint">Nog niets ingevuld deze week.</p>'}</div></div>`);
  }

  /* Service en problemen. */
  html.push(blokkop('Service en problemen', d.service.gesprekken.aantal, `<span class="fr-hint">${esc(d.service.gesprekken.definitie)}</span>`));
  html.push(`<div class="fr-twee"><div><p class="bd-tekst"><b>Servicegesprekken</b></p>${d.service.perUitkomst.length ? `<ul class="bd-lijstje">${d.service.perUitkomst.map(([u, n]) => `<li>${woord(u)}: ${esc(n)}</li>`).join('')}</ul>` : '<p class="fr-hint">Geen servicegesprekken deze week.</p>'}
    <p class="bd-tekst"><b>Problemen</b> <span class="fr-hint">${esc(d.service.problemen.definitie)}</span></p>${d.service.problemen.perSoort.length ? `<ul class="bd-lijstje">${d.service.problemen.perSoort.map(([soort, n]) => `<li>${woord(soort)}: ${esc(n)}</li>`).join('')}</ul>` : '<p class="fr-hint">Geen problemen gemeld.</p>'}</div>
    <div><p class="bd-tekst"><b>Wat klanten beter willen</b></p>${d.service.verbeterpunten.length ? `<ul class="bd-lijstje">${d.service.verbeterpunten.map((v) => `<li>${esc(v)}</li>`).join('')}</ul>` : '<p class="fr-hint">Nog niets opgehaald.</p>'}
    <p class="bd-tekst"><b>Bezwaren deze week</b></p>${d.bezwaren.length ? `<ul class="bd-lijstje">${d.bezwaren.map(([c, n]) => `<li>${woord(c)}: ${esc(n)}</li>`).join('')}</ul>` : '<p class="fr-hint">Geen bezwaren vastgelegd.</p>'}</div></div>`);
  /* Behandeltijd en werkvoorraad. */
  html.push(blokkop('Behandeltijd en werkvoorraad'));
  html.push(tegels([
    ['taken afgerond', esc(d.behandeltijd.takenAfgerond), '', 'taken die deze week zijn afgerond'],
    ['mediane looptijd', d.behandeltijd.medianeLooptijdDagen === null ? 'n.v.t.' : `${esc(d.behandeltijd.medianeLooptijdDagen)}<small>dagen</small>`, '', d.behandeltijd.definitieLooptijd],
    ['mediane gesprekstijd', d.behandeltijd.medianeGesprekstijdSeconden === null ? 'n.v.t.' : `${esc(Math.round(d.behandeltijd.medianeGesprekstijdSeconden / 60))}<small>min</small>`],
    ['open taken', esc(d.werkvoorraad.open), '', d.werkvoorraad.definitie],
    ['achterstallig', esc(d.werkvoorraad.achterstallig), d.werkvoorraad.achterstallig ? 'let' : ''],
  ]));
  html.push(`<ul class="bd-lijstje">${d.werkvoorraad.perSoort.map(([soort, n]) => `<li>${taakWoord(soort)}: ${esc(n)}</li>`).join('')}</ul>`);
  /* Per scriptversie: werkt het nieuwe script beter dan het oude. */
  html.push(blokkop('Per scriptversie', d.perScript.length, '<span class="fr-hint">gesprekken deze week, en hoeveel daarvan een demo opleverden</span>'));
  html.push(d.perScript.length ? `<div class="bd-tabel-wrap"><table class="bd-tabel"><thead><tr><th>versie</th><th class="tal">gesprekken</th><th class="tal">demo's</th><th class="tal">naar demo</th></tr></thead><tbody>${d.perScript.map((x) => `<tr><td class="mono">${esc(x.ref)}</td><td class="tal">${esc(x.gesprekken)}</td><td class="tal">${esc(x.demos)}</td><td class="tal">${pct(x.naarDemo)}</td></tr>`).join('')}</tbody></table></div>` : leeg('Nog geen gesprekken met een scriptversie deze week.'));
  if (d.werkwijzenDezeWeek.length) {
    html.push(blokkop('Werkwijzen die deze week veranderden', d.werkwijzenDezeWeek.length));
    html.push(`<ul class="bd-lijstje">${d.werkwijzenDezeWeek.map((x) => `<li><b>${woord(x.soort)} ${woord(x.ref)}</b> v${esc(x.versie)} <span class="bd-badge ${x.soortWijziging === 'klein' ? '' : 'oranje'}">${woord(x.soortWijziging)}</span> ${esc(x.watVeranderd || '')}</li>`).join('')}</ul>`);
  }
  /* De besluiten. */
  if (d.besluiten.teEvalueren.length) {
    html.push(blokkop('Nu evalueren', d.besluiten.teEvalueren.length, '<span class="fr-hint">de evaluatiedatum is er; hielp het, of niet</span>'));
    html.push(`<div class="fr-rijen">${d.besluiten.teEvalueren.map((b) => besluitRij(b, true)).join('')}</div>`);
  }
  html.push(blokkop('Lopende besluiten', d.besluiten.open.length));
  html.push(d.besluiten.open.length ? `<div class="fr-rijen">${d.besluiten.open.map((b) => besluitRij(b, false)).join('')}</div>` : leeg('Geen lopende besluiten. Een besluit hieronder toevoegen maakt van een waarneming een afspraak.'));
  html.push(blokkop('Een verbeterbesluit vastleggen'));
  html.push(`<form class="fr-form" data-besluit="1">
    <label>Wat zien we<input type="text" name="probleem" required placeholder="vier van de vijf demo's zonder eigen klus lopen dood"></label>
    <label>Wat gaan we anders doen<input type="text" name="wijziging" required placeholder="geen demo meer plannen zonder een concrete klus"></label>
    <div class="fr-veldrij"><label>Welke gegevens dragen dit<input type="text" name="gegevens" placeholder="weekreview ${esc(d.van)} tot ${esc(d.tot)}, funnel demo naar account"></label>
    <label>Wie<select name="verantwoordelijkeId">${(d.bellers || stand.bellers).map((b) => `<option value="${esc(b.id)}" ${b.id === beller ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}</select></label>
    <label>Vanaf<input type="date" name="ingangsdatum" value="${esc(stand.vandaag)}"></label>
    <label>Evalueren op<input type="date" name="evaluatiedatum"></label></div>
    <div class="fr-knoppenrij">${schrijfKnop('Besluit vastleggen', 'fr-knop klein', 'type="submit"', 'rapportages')}</div></form>`);
  scherm.innerHTML = html.join('');
}

function besluitRij(b, evalueren) {
  return `<div class="fr-rij bd-rij"><div class="hoofd">${esc(b.probleem)}${b.herkomst === 'ai' ? ' <span class="bd-badge oranje">AI-voorstel</span>' : ''}</div>
    <div class="sub"><b>${esc(b.wijziging)}</b><span class="bd-sub">${esc(b.verantwoordelijke || 'niemand')}${b.ingangsdatum ? `, vanaf ${dag(b.ingangsdatum)}` : ''}${b.evaluatiedatum ? `, evalueren ${dag(b.evaluatiedatum)}` : ''}</span>${b.gegevens && b.gegevens.bron ? `<span class="bd-sub">gegevens: ${esc(b.gegevens.bron)}</span>` : ''}${b.uitkomst ? `<span class="bd-sub">uitkomst: ${esc(b.uitkomst)}</span>` : ''}</div>
    <div class="maatje"><span class="wanneer">${woord(b.status)}</span></div>
    <div class="rechts">${b.status === 'voorstel' ? `${schrijfKnop('Aannemen', 'bd-knopje', `data-besluit-status="${esc(b.id)}" data-naar="aangenomen"`, 'rapportages')} ${schrijfKnop('Afwijzen', 'bd-knopje', `data-besluit-status="${esc(b.id)}" data-naar="afgewezen"`, 'rapportages')}` : ''}
      ${evalueren ? schrijfKnop('Evalueren', 'bd-knopje', `data-besluit-evalueren="${esc(b.id)}"`, 'rapportages') : ''}</div></div>`;
}

async function schermGebruikers() {
  if (!mag('gebruikersbeheer')) { scherm.innerHTML = kop('beheer', 'Gebruikers', 'Je account heeft het recht gebruikersbeheer niet. Vraag een beheerder.'); return; }
  const d = await api('/api/gebruikers');
  const html = [kop('beheer', 'Gebruikers', 'Iedere medewerker een eigen account met een eigen rol.', '', 'De rol geeft de standaardrechten; met een recht erbij, of een min ervoor, wijk je per persoon af. De server dwingt de rechten af, niet alleen de knop.')];
  html.push(blokkop('Accounts', d.gebruikers.length));
  html.push(`<div class="fr-rijen">${d.gebruikers.map((g) => `<div class="fr-rij bd-rij"><div class="hoofd">${esc(g.email)}${g.actief === false ? ' <span class="bd-badge oranje">inactief</span>' : ''}</div>
    <div class="sub">${esc(g.rol)}<span class="bd-sub">${esc((g.rechtenActief || []).join(', '))}</span>${g.persoon ? `<span class="bd-sub">persoon: ${esc(g.persoon)}</span>` : '<span class="bd-sub bd-let">niet aan een persoon gekoppeld</span>'}</div>
    <div class="maatje"><span class="wanneer">${g.laatste_inlog ? `laatst ${dag(g.laatste_inlog)}` : 'nog niet ingelogd'}</span></div>
    <div class="rechts"><select class="fr-in klein" data-rol-van="${esc(g.id)}">${d.rollen.map((r) => `<option value="${esc(r)}" ${g.rol === r ? 'selected' : ''}>${esc(r)}</option>`).join('')}</select>
      ${schrijfKnop('Wachtwoord', 'bd-knopje', `data-wachtwoord="${esc(g.id)}"`, 'gebruikersbeheer')}
      ${schrijfKnop(g.actief === false ? 'Aanzetten' : 'Uitzetten', 'bd-knopje', `data-actief="${esc(g.id)}" data-naar="${g.actief === false ? '1' : '0'}"`, 'gebruikersbeheer')}</div></div>`).join('')}</div>`);
  html.push(blokkop('Account toevoegen'));
  html.push(`<form class="fr-form" data-gebruiker-nieuw="1"><div class="fr-veldrij">
    <label>E-mailadres<input type="email" name="email" required></label>
    <label>Wachtwoord<input type="password" name="wachtwoord" required minlength="8" placeholder="minstens acht tekens"></label>
    <label>Rol<select name="rol">${d.rollen.map((r) => `<option value="${esc(r)}">${esc(r)}</option>`).join('')}</select></label>
    <label>Persoon<select name="personId"><option value="">geen</option>${stand.bellers.map((b) => `<option value="${esc(b.id)}">${esc(b.name)}</option>`).join('')}</select></label>
    <label>&nbsp;${schrijfKnop('Aanmaken', 'fr-knop klein', 'type="submit"', 'gebruikersbeheer')}</label></div></form>`);
  html.push(blokkop('De rechten'));
  html.push(`<ul class="bd-lijstje">${Object.entries(d.rechten).map(([k, v]) => `<li><b>${esc(k)}</b>: ${esc(v)}</li>`).join('')}</ul>`);
  scherm.innerHTML = html.join('');
}

/* ---------- Vandaag: de werklijst en de dagstand ---------- */

let aantalNieuw = 25;
let werkFilter = 'alles'; /* alles, laat, vandaag, later of nieuw */

/* Structuur A (keuze Jelle 25-09-2026 uit vijf varianten): een werklijst op urgentie. Geen
   bakken en geen tegels; een lijst met te laat bovenaan, dan vandaag (met tijd eerst), dan
   later, en de nieuwe leads onderaan. Per regel een zin die zegt wat je moet doen, de reden
   eronder, en de knop ernaast. Klaar is weg. */

const DAGNAMEN = ['zo', 'ma', 'di', 'wo', 'do', 'vr', 'za'];
const MAANDNAMEN = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
function dagKort(d) {
  if (!d) return '';
  const x = new Date(`${String(d).slice(0, 10)}T12:00:00`);
  if (Number.isNaN(x.getTime())) return dag(d);
  return `${DAGNAMEN[x.getDay()]} ${x.getDate()} ${MAANDNAMEN[x.getMonth()]}`;
}
const hoofdletter = (t) => (t ? t.charAt(0).toUpperCase() + t.slice(1) : t);
const dagenTussen = (a, b) => Math.round((new Date(`${b}T12:00:00`) - new Date(`${a}T12:00:00`)) / 86400000);

/* Waar een rij in de lijst hoort. groep: 0 te laat, 1 vandaag met tijd, 2 vandaag, 3 later, 4 nieuw. */
function urgentie(i) {
  const v = stand.vandaag;
  const laat = i.dagenTeLaat || (i.deadline && v && i.deadline < v ? dagenTussen(i.deadline, v) : 0);
  if (laat) return { groep: 0, laat, tekst: `Te laat, ${laat} ${laat === 1 ? 'dag' : 'dagen'}`, klas: 'laat' };
  if (i.soort === 'nieuw') return { groep: 4, laat: 0, tekst: 'Nieuw', klas: 'later' };
  if (i.deadline === v && i.tijd) return { groep: 1, laat: 0, tekst: `Vandaag ${i.tijd}`, klas: '' };
  if (!i.deadline || i.deadline === v) return { groep: 2, laat: 0, tekst: 'Vandaag', klas: '' };
  return { groep: 3, laat: 0, tekst: dagKort(i.deadline), klas: 'later' };
}

const WERKFILTERS = [['alles', 'Alles', [0, 1, 2, 3, 4]], ['laat', 'Te laat', [0]], ['vandaag', 'Vandaag', [1, 2]], ['later', 'Later', [3]], ['nieuw', 'Nieuwe leads', [4]]];

async function schermVandaag() {
  if (!beller) { scherm.innerHTML = kop('vandaag', 'Geen beller bekend', 'Leg eerst een persoon vast in het relatieweb.'); return; }
  const w = await api(`/api/werklijst?${scopeQuery()}&aantalNieuw=${aantalNieuw}`);
  const s = w.dagstand;
  navTellers = { vandaag: w.items.length, bellen: w.belItems || 0 };
  tekenNav('vandaag');
  const items = w.items.map((i) => ({ ...i, u: urgentie(i) }))
    .sort((a, b) => a.u.groep - b.u.groep || b.u.laat - a.u.laat || String(a.tijd || '99').localeCompare(String(b.tijd || '99')) || String(a.deadline || '').localeCompare(String(b.deadline || '')) || (b.prioriteit || 0) - (a.prioriteit || 0));
  const tel = (groepen) => items.filter((i) => groepen.includes(i.u.groep)).length;
  const actief = WERKFILTERS.find((f) => f[0] === werkFilter) || WERKFILTERS[0];
  const lijst = items.filter((i) => actief[2].includes(i.u.groep));
  const teDoen = tel([0, 1, 2, 3]);
  const html = [kop('vandaag', 'Wat nu aandacht vraagt',
    `${teDoen ? `${esc(teDoen)} ${teDoen === 1 ? 'lead waar' : 'leads waar'} iets moet gebeuren, de dringendste bovenaan.` : 'Niets dat wacht.'} ${Number(w.nieuwBeschikbaar) ? `Daarna ${esc(w.nieuwBeschikbaar)} nieuwe leads in voorraad: de belsessie gaat vanzelf door.` : 'De voorraad nieuwe leads is op.'}`,
    w.belItems || w.nieuwBeschikbaar ? `<a class="fr-knop" href="#/bellen">Bel de volgende</a>` : '',
    `Werk van ${esc(scopeWoord())}. Een lijst: te laat bovenaan, dan vandaag (met tijd eerst), dan later, en de nieuwe leads onderaan. Wie je bent en wiens werk je ziet stel je in onder het menu. Wat we van het werk leren staat onder Terugkijken, de werkwijze onder Beheer.`)];
  html.push(meldingBalk());
  const voorraad = Math.max(tel([4]), Number(w.nieuwBeschikbaar) || 0);
  html.push(`<div class="wl-chips">${WERKFILTERS.map(([k, naam, g]) => `<button type="button" class="wl-chip ${k === werkFilter ? 'aan' : ''}" data-werkfilter="${k}">${esc(naam)} <span>${esc(k === 'nieuw' ? voorraad : (k === 'alles' ? tel([0, 1, 2, 3]) + voorraad : tel(g)))}</span></button>`).join('')}</div>`);
  if (!lijst.length) html.push(leeg(werkFilter === 'alles' ? 'Niets te doen voor deze scope: geen afspraken, geen open taken, geen berichten en geen nieuwe leads met telefoonnummer.' : 'Niets in deze groep.'));
  else { html.push('<div class="wl-lijst">'); for (const i of lijst) html.push(werkRij(i)); html.push('</div>'); }
  if (w.nieuwBeschikbaar > aantalNieuw) html.push(`<p class="wl-meer"><button type="button" class="bd-knopje" data-meer-nieuw="1">Meer nieuwe leads laden (${esc(w.nieuwBeschikbaar - aantalNieuw)} beschikbaar)</button></p>`);
  /* De dagstand als een regel; de tegels pas bij het openen. */
  const t = (naam, c, extra = '') => [naam, esc(c.aantal), extra, c.definitie];
  html.push(`<details class="bd-details bd-dagstand"><summary>Gedaan vandaag: <b>${esc(s.uniekeLeads.aantal)}</b> unieke leads (dagdoel ${esc(s.dagdoel)}${s.dagdoelGehaald ? ', gehaald' : ''}), ${esc(s.contactmomenten.aantal)} contactmomenten, ${esc(s.bereikt.aantal)} bereikt, ${esc(s.demosGepland.aantal)} demo's gepland, ${esc(s.afgerondeTaken.aantal)} taken afgerond</summary>${tegels([t('unieke leads', s.uniekeLeads, s.dagdoelGehaald ? 'goed' : ''), t('contactmomenten', s.contactmomenten), t('belpogingen', s.belpogingen), t('bereikt', s.bereikt), t('inhoudelijk', s.inhoudelijk), t('WhatsApp', s.whatsapp), t('mail', s.email), t('reacties', s.reacties), t("demo's gepland", s.demosGepland), t("demo's gedaan", s.demosUitgevoerd), t('vervolgafspraken', s.vervolgafspraken), t('taken afgerond', s.afgerondeTaken)])}</details>`);
  scherm.innerHTML = html.join('');
}

function werkRij(i) {
  const l = i.lead;
  const u = i.u || urgentie(i);
  const knop = (() => {
    if (['call', 'service'].includes(i.actie) || (i.soort === 'afspraak' && i.vorm === 'telefonisch')) return `<a class="fr-knop klein" href="#/bellen?lead=${esc(i.leadId)}">Bel nu</a>`;
    if (i.soort === 'afspraak') return `<a class="fr-knop klein" href="#/demos">Demo afronden</a>`;
    if (i.actie === 'whatsapp' || i.actie === 'email') return schrijfKnop('Bericht vastleggen', 'fr-knop klein', `data-uitklap="w-${esc(i.leadId)}"`);
    if (i.soort === 'af_te_ronden') return schrijfKnop('Afronden', 'fr-knop klein', `data-uitklap="w-${esc(i.leadId)}"`);
    if (i.soort === 'te_beoordelen') return `<a class="fr-knop klein tweede" href="#/gesprekken?provisional=1">Beoordelen</a>`;
    if (i.actie === 'onboarding' || i.actie === 'check_in') return schrijfKnop('Afronden', 'fr-knop klein', `data-uitklap="w-${esc(i.leadId)}"`);
    return '';
  })();
  const uitklap = (() => {
    if (i.actie === 'whatsapp' || i.actie === 'email') return berichtForm(i.leadId, l, i.stap, i.actie);
    if (i.soort === 'af_te_ronden') return gesprekForm(i.leadId, { interactionId: i.interactionId, stap: i.stap });
    if (i.taakId && (i.actie === 'onboarding' || i.actie === 'check_in')) return afrondForm({ id: i.taakId, taak: i.actie });
    return '';
  })();
  const sop = uitklap ? sopVoorItem(i) : null;
  const werkwijze = sop ? (weergave === 'compact' ? `<details class="bd-details"><summary>Werkwijze: ${esc(sop.titel || sop.stap || '')} <span class="bd-badge">${esc(sop.versie || '')}</span></summary>${sopBlok(sop)}</details>` : `<p class="fr-eyebrow">werkwijze: ${esc(sop.titel || (sop.stap || '').replace(/_/g, ' '))}</p>${sopBlok(sop)}`) : '';
  /* De tweede regel: de reden, en wie en waar. Wie alleen als het niet vanzelf spreekt. */
  const wie = [];
  if (i.contactpersoon) wie.push(i.contactpersoon);
  if (l.plaats) wie.push(l.plaats);
  const uitvoerder = i.uitvoerderNaam || i.eigenaarNaam || null;
  if (uitvoerder && (scope !== 'mijn' || uitvoerder !== naamVanBeller(beller))) wie.push(`bij ${uitvoerder}`);
  return `<div class="wl-rij ${u.klas}">
    <div class="wl-wanneer">${esc(u.tekst)}</div>
    <div class="wl-wat"><div class="wl-titel">${hoofdletter(redenWoord(i.contactreden))}: ${linkLead(l.id, l.naam)}</div>
      <div class="wl-waarom">${taakWoord(i.actie)}: ${esc(String(i.reden || '').replace(/ \(stond op \d{4}-\d{2}-\d{2}\)$/, ''))}${wie.length ? `. ${esc(wie.join(', '))}` : ''}${i.inBehandelingDoor ? ` <span class="bd-badge oranje">nu bij ${esc(i.inBehandelingNaam || 'collega')}</span>` : ''}</div>
      ${(i.waarschuwingen || []).map((x) => `<div class="wl-waarom bd-let">${esc(x)}</div>`).join('')}</div>
    <div class="wl-acties">${knop}<a class="fr-knop klein tweede" href="#/lead/${esc(l.id)}">Dossier</a></div>
    ${uitklap ? `<div class="bd-uitklap wl-uitklap" id="w-${esc(i.leadId)}" hidden>${werkwijze}${uitklap}</div>` : ''}
  </div>`;
}

/* Het script van een stap als blok: opening, wat je zegt bij elke reactie (het script van
   Myron), de vragen per thema met het veld dat ze vullen en wat al bekend is, samenvatten,
   afsluiting. Zonder reacties in het script komen de vaste antwoorden uit de bezwarenbibliotheek. */
/* De SOP-delen van een script of taakwerkwijze: doel, voorbereiding, stappen, vast te leggen, uitkomsten. */
function sopBlok(sop, { metDoel = true } = {}) {
  if (!sop) return '';
  const lijst = (titel, items) => (items && items.length ? `<p class="bd-tekst"><b>${esc(titel)}</b></p><ol class="bd-lijstje">${items.map((z) => `<li>${esc(z)}</li>`).join('')}</ol>` : '');
  return `<div class="bd-sop">${metDoel && sop.doel ? `<p class="bd-tekst"><b>Doel:</b> ${esc(sop.doel)} <span class="bd-badge">${esc(sop.versie || '')}</span></p>` : ''}${lijst('Voorbereiding', sop.voorbereiding)}${lijst('Stappen', sop.stappen)}${sop.vastTeLeggen && sop.vastTeLeggen.length ? `<p class="bd-tekst"><b>Vast te leggen:</b> ${esc(sop.vastTeLeggen.join(', '))}</p>` : ''}${sop.uitkomsten && sop.uitkomsten.length ? `<p class="bd-tekst"><b>Uitkomsten en vervolg</b></p><ul class="bd-lijstje">${sop.uitkomsten.map((u) => `<li><b>${woord(u.uitkomst)}</b>: ${esc(u.vervolg)}</li>`).join('')}</ul>` : ''}</div>`;
}
/* De werkwijze bij een rij op de werklijst: het script van de stap voor een gesprek, anders de SOP van de taaksoort. */
function sopVoorItem(i) {
  if (['whatsapp', 'email'].includes(i.actie)) return stand.sops.bericht;
  if (i.actie === 'beoordelen' || i.actie === 'check_in' || i.soort === 'te_beoordelen') return stand.sops.beoordelen;
  if (i.actie === 'afronden' || i.soort === 'af_te_ronden') return stand.sops.afronden;
  return stand.scripts[i.stap] || stand.script;
}
/* Wat in de compacte weergave overblijft naast de velden: de aandachtspunten uit het dossier. */
function aandachtspunten(dossier, { metBezwaren = true } = {}) {
  const punten = [];
  if (dossier.volgendeActie && dossier.volgendeActie.reden) punten.push(`afgesproken: ${dossier.volgendeActie.reden}${dossier.volgendeActie.dag ? ` (${dossier.volgendeActie.dag})` : ''}`);
  if (metBezwaren) for (const b of (dossier.bezwaren || []).slice(0, 3)) punten.push(`eerder bezwaar: "${b.bezwaar}"${b.reactie ? `, reactie: ${b.reactie} (${b.resultaat || 'onbekend'})` : ''}`);
  if (dossier.wilNiet) punten.push(`wil niet: ${dossier.wilNiet}`);
  if (dossier.demoBriefing && dossier.demoBriefing.onbekend && dossier.demoBriefing.onbekend.length) punten.push(`nog te vragen: ${dossier.demoBriefing.onbekend.slice(0, 5).map((v) => v.replace(/_/g, ' ')).join(', ')}`);
  if (dossier.reactie && dossier.reactie.status === 'verstreken') punten.push(`geen reactie op ${dossier.reactie.materiaal || 'het bericht'} van ${dossier.reactie.dag}`);
  return `<p class="fr-eyebrow">aandachtspunten</p>${punten.length ? `<ul class="bs-lijst">${punten.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '<p class="fr-hint">Niets bijzonders: gewoon het gesprek voeren.</p>'}`;
}
function scriptBlok(script, bekend = {}, vasteAntwoorden = [], metSop = false, metVelden = true) {
  const themas = [...new Set((script.vragen || []).map((v) => v.thema || ''))];
  const vraag = (v) => `<li class="bs-vraag">${esc(v.vraag)}<span class="door">doorvragen: ${esc(v.door)}</span>${metVelden ? `<span class="vult">vult ${esc((v.vult || []).join(', '))}${bekend[v.veld] ? `, bekend: ${esc(bekend[v.veld])}` : ''}</span>` : (bekend[v.veld] ? `<span class="vult">al bekend: ${esc(bekend[v.veld])}</span>` : '')}</li>`;
  return `<div class="bs-script"><p class="fr-hint">${esc(script.doel || '')} <span class="bd-badge">${esc(script.versie || '')}</span>${script.nodig ? `<span class="bd-let"> Voorlopig: ${esc(script.nodig)}.</span>` : ''}</p>
    ${metSop ? sopBlok({ voorbereiding: script.voorbereiding, stappen: script.stappen }, { metDoel: false }) : ''}
    ${script.opnamezin ? `<p class="bd-tekst bs-regel"><b>Opname:</b> ${esc(script.opnamezin)}</p>` : ''}
    <h3>Opening</h3><ol>${(script.opening || []).map((z) => `<li>${esc(z)}</li>`).join('')}</ol>
    ${script.reacties && script.reacties.length ? `<h3>Als hij zegt</h3><div class="bs-reacties">${script.reacties.map((r) => `<details class="bd-details bs-reactie"><summary><b>${esc(r.op)}</b>${r.herken && r.herken.length ? ` <span class="fr-hint">${esc(r.herken.join(' / '))}</span>` : ''}</summary><ol>${(r.zeg || []).map((z) => `<li>${esc(z)}</li>`).join('')}</ol>${r.daarna ? `<p class="bd-sub"><b>Daarna:</b> ${esc(r.daarna)}</p>` : ''}${r.uitkomst ? `<p class="bd-sub">uitkomst als het hierbij blijft: ${woord(r.uitkomst)}</p>` : ''}</details>`).join('')}</div>` : ''}
    <h3>${script.reacties && script.reacties.length ? 'Als je meer wilt onderzoeken' : 'De vragen'}</h3>${themas.length > 1 ? themas.map((th) => `<p class="bd-tekst"><b>${esc(th)}</b></p><ol>${(script.vragen || []).filter((v) => (v.thema || '') === th).map(vraag).join('')}</ol>`).join('') : `<ol>${(script.vragen || []).map(vraag).join('')}</ol>`}
    <p class="bd-tekst"><b>Bij aarzeling:</b> ${esc(script.bijAarzeling || '')}</p>
    ${script.samenvatten && script.samenvatten.length ? `<h3>Samenvatten wat hij heeft verteld</h3><ol>${script.samenvatten.map((z) => `<li>${esc(z)}</li>`).join('')}</ol>` : ''}
    <h3>Afsluiting</h3><ul>${(script.afsluiting || []).map((z) => `<li>${esc(z)}</li>`).join('')}</ul>
    ${!(script.reacties && script.reacties.length) && vasteAntwoorden.length ? `<h3>Als hij een bezwaar noemt</h3><ul>${vasteAntwoorden.map((v) => `<li><b>${esc(v.bezwaar)}:</b> ${esc(v.antwoord)}</li>`).join('')}</ul>` : ''}
    ${metSop ? sopBlok({ vastTeLeggen: script.vastTeLeggen, uitkomsten: script.uitkomsten }, { metDoel: false }) : ''}</div>`;
}

/* ---------- de belsessie: de server geeft de volgende, geclaimd ---------- */

const sessie = { item: null, positie: 0, totaal: 0, overslaan: [], leadIds: null, gestart: null, klok: null, opname: null, hartslag: null, opnameRef: null, opnameKlaar: false, toestemming: undefined, verzoekId: null, resterend: 0, nieuwBeschikbaar: 0 };

function tijdTekst(ms) {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/* De opname loopt in de browser (microfoon van de Mac, dus op luidspreker ook de andere kant).
   Hij start pas als de gesprekspartner ja heeft gezegd op de opnamezin. */
async function opnameStart() {
  if (!navigator.mediaDevices || !window.MediaRecorder) { melding('Opnemen kan niet in deze browser.'); return false; }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : (MediaRecorder.isTypeSupported('audio/mp4') ? 'audio/mp4' : '');
    const recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
    const chunks = [];
    recorder.addEventListener('dataavailable', (e) => { if (e.data && e.data.size) chunks.push(e.data); });
    recorder.start(1000);
    sessie.opname = { stream, recorder, chunks, mime: recorder.mimeType || mime || 'audio/webm', ref: null };
    return true;
  } catch (e) {
    melding(`Geen opname: ${e.message}. Het gesprek gaat gewoon door.`);
    return false;
  }
}

async function opnameStop(leadNaam) {
  const o = sessie.opname;
  if (!o || !o.recorder) return null;
  if (o.recorder.state !== 'inactive') {
    await new Promise((r) => { o.recorder.addEventListener('stop', r, { once: true }); o.recorder.stop(); });
  }
  o.stream.getTracks().forEach((t) => t.stop());
  const blob = new Blob(o.chunks, { type: o.mime });
  sessie.opname = null;
  if (!blob.size) return null;
  const r = await fetch(`/api/opname?lead=${encodeURIComponent(leadNaam)}&mime=${encodeURIComponent(o.mime)}`, { method: 'POST', body: blob });
  const j = await r.json();
  if (!r.ok) throw new Error(j.fout || 'opname niet bewaard');
  return j.ref;
}

async function uploadBestand(bestand, params) {
  const q = new URLSearchParams({ ...params, naam: bestand.name, mime: bestand.type || '' });
  const r = await fetch(`/api/opname?${q}`, { method: 'POST', body: bestand });
  const j = await r.json();
  if (!r.ok) throw new Error(j.fout || 'upload mislukt');
  return j;
}

async function sessieVolgende() {
  let r = await api('/api/sessie/volgende', { bellerId: beller, overslaan: sessie.overslaan, leadIds: sessie.leadIds, aantalNieuw });
  /* Doorbellen tot de voorraad op is (Jelle, 25-09-2026): het dagdoel is een indicator, geen
     grens. Is de eigen lijst af maar staan er nog nieuwe leads klaar, dan laadt de sessie ze
     zelf bij en gaat door; de knop "meer laden" is weg. Alleen een gekozen lijst stopt. */
  for (let ronde = 0; !r.item && !sessie.leadIds && r.nieuwBeschikbaar > aantalNieuw && ronde < 40; ronde += 1) {
    aantalNieuw = Math.min(aantalNieuw + 50, r.nieuwBeschikbaar);
    r = await api('/api/sessie/volgende', { bellerId: beller, overslaan: sessie.overslaan, leadIds: sessie.leadIds, aantalNieuw });
  }
  sessie.item = r.item;
  sessie.positie = r.positie;
  sessie.totaal = r.totaal;
  sessie.resterend = r.resterend;
  sessie.nieuwBeschikbaar = r.nieuwBeschikbaar;
  sessie.gedaanVandaag = r.gedaanVandaag;
  sessie.gestart = null;
  sessie.opname = null;
  sessie.opnameKlaar = false;
  sessie.opnameRef = null;
  sessie.toestemming = undefined;
  sessie.verzoekId = uuid();
  clearInterval(sessie.hartslag);
  if (sessie.item) sessie.hartslag = setInterval(() => { api('/api/sessie/hartslag', { leadId: sessie.item.leadId, bellerId: beller }).catch(() => {}); }, 5 * 60000);
}

async function sessieLoslaten() {
  clearInterval(sessie.hartslag);
  if (sessie.item) { try { await api('/api/sessie/vrijgeven', { leadId: sessie.item.leadId, bellerId: beller }); } catch { /* al los */ } }
  sessie.item = null;
}

/*
  De belsessie staat in twee kolommen: links wie je belt en wat je zegt, rechts wat je vastlegt.
  Op 20-09-2026 is dat een keer een kolom met genummerde stappen geweest, maar Jelle wilde het
  naast elkaar terug: tijdens het invullen wil je het script kunnen blijven zien.

  Wat van die ronde bleef: het formulier staat in vakken. Open wat je bij elk gesprek invult,
  dicht wat er soms bij hoort. Dicht is niet uit; wat erin staat verstuurt gewoon mee.
*/
function bsVak(titel, inhoud, open = true, hint = '') {
  return `<details class="bs-vak" ${open ? 'open' : ''}><summary><span class="t">${esc(titel)}</span>${hint ? `<span class="fr-hint">${esc(hint)}</span>` : ''}</summary><div class="bs-vak-in">${inhoud}</div></details>`;
}

/* De vaste stukken die elk blad kan gebruiken. */
const vakSamenvatting = (hint) => bsVak('Samenvatting in vier onderdelen', `<div class="fr-veldrij"><label>Wie gesproken en in welke context<textarea name="s_wie" rows="2"></textarea></label><label>Hoe werkt hij nu<textarea name="s_werkt" rows="2"></textarea></label></div>
  <div class="fr-veldrij"><label>Behoefte, kans of belemmering<textarea name="s_behoefte" rows="2"></textarea></label><label>Wat is concreet afgesproken<textarea name="s_afgesproken" rows="2"></textarea></label></div>`, true, hint || 'een overzicht, geen limiet');
const vakDrieVragen = (bekend) => bsVak('Wat wil hij wel, wat wil hij niet, en waarom', drieVragen(bekend).replace(/^<p class="bd-tekst">[\s\S]*?<\/p>/, ''), true, 'in zijn woorden');
const vakBezwaren = (eerdere) => bsVak('Bezwaren', bezwaarSectie(eerdere), true, 'letterlijk, met je reactie en of die werkte');
const vakExtras = () => bsVak('Meer dat je hoorde', extraSectie(), false, 'een vraag, een inzicht, een productwens, persoonlijke context');
const vakKans = (open, hint) => bsVak('Zijn klus', `<div class="fr-veldrij"><label>Project (bijvoorbeeld PVC woning Sittard)<input type="text" name="kansNaam"></label><label>Geschatte m2<input type="number" name="kansM2" min="0"></label><label>Datum<input type="date" name="kansDatum"></label></div>`, open, hint || 'alleen als hij een klus noemde');
const vakVelden = (velden, bekend) => (velden.length ? bsVak('Wat je te weten kwam', `<div class="fr-veldrij">${velden.map((v) => discoveryVeldInput(v, v.replace(/_/g, ' '), bekend)).join('')}</div>`, false, 'alleen wat langskwam') : '');

/* Waar het gesprek strandde: een keuze, in de volgorde van het script. */
function vakAfhaken() {
  const lijst = stand.afhaakmomenten || [];
  if (!lijst.length) return '';
  return bsVak('Waar haakte hij af', `<div class="bd-keuzes">${lijst.map((m, i) => `<label class="bd-keuze"><input type="radio" name="afhaakmoment" value="${esc(m)}"> <span>${esc((stand.afhaakUitleg || {})[m] || m.replace(/_/g, ' '))}</span></label>`).join('')}</div>`, true, 'een punt, in de volgorde van het gesprek');
}
/* En waar hij juist naar voren leunde; meerdere mogen. */
function vakAanslag() {
  const lijst = stand.aanslagpunten || [];
  if (!lijst.length) return '';
  return bsVak('Waar ging hij op aan', `<div class="bd-keuzes">${lijst.map((m) => `<label class="bd-keuze"><input type="checkbox" name="aangeslagenOp" value="${esc(m)}"> <span>${esc((stand.aanslagUitleg || {})[m] || m.replace(/_/g, ' '))}</span></label>`).join('')}</div>`, true, 'meerdere mogen');
}
/* De onboardingstand: wat er staat en wat er in de weg zit. */
function vakOnboarding(dossier) {
  const lijst = stand.onboardingMijlpalen || [];
  const gehaald = new Set((((dossier.partner || {}).mijlpalen) || []).filter((m) => m.gehaald).map((m) => m.naam));
  return `${bsVak('Wat staat er nu', `${gehaald.size ? `<p class="fr-hint">Het portaal ziet er ${esc(gehaald.size)} van gehaald; die staan aangevinkt. Corrigeer wat hij zelf zegt.</p>` : '<p class="fr-hint">Het portaal ziet nog geen enkele mijlpaal. Vink aan wat hij zelf zegt dat er staat.</p>'}
    <div class="bd-keuzes">${lijst.map((m) => `<label class="bd-keuze"><input type="checkbox" name="onboardingGedaan" value="${esc(m)}" ${gehaald.has(m) ? 'checked' : ''}> <span>${esc(m.replace(/_/g, ' '))}</span></label>`).join('')}</div>`, true, 'zestien mijlpalen')}
    ${bsVak('Wat houdt hem tegen', '<label>In zijn woorden<textarea name="blokkade" rows="2" placeholder="waar loopt hij op vast"></textarea></label>', true, 'bewust vrije tekst')}`;
}

/*
  Het invulblad per stap. Jelle, 20-09-2026: elke stap zijn eigen lijst. Het eerste gesprek gaat
  om een demo, dus daar staan het afhaakmoment, waar hij op aansloeg en zijn klus voorop; het
  onboardinggesprek gaat om wat er staat en wat hem tegenhoudt. Wat een stap niet nodig heeft
  komt niet in beeld, ook niet dichtgeklapt.
*/
function vastlegVakken(stap, { script, bekend, dossier, velden }) {
  if (stap === 'eerste_contact') {
    return [vakAfhaken(), vakAanslag(), vakDrieVragen(bekend), vakBezwaren(dossier.bezwaren),
      vakKans(true, 'de opstap naar de demo: heeft hij een klus die aankomt'), vakSamenvatting(),
      vakExtras(), vakVelden(velden, bekend)].join('');
  }
  if (stap === 'onboarding') {
    return [vakOnboarding(dossier), vakBezwaren(dossier.bezwaren), vakSamenvatting('wat is er besproken'),
      vakExtras(), vakKans(false)].join('');
  }
  if (stap === 'service') {
    return [vakSamenvatting(), bsVak('Problemen', probleemSectie(), true, 'elk probleem krijgt een eigenaar en een datum'),
      vakDrieVragen(bekend), vakBezwaren(dossier.bezwaren), vakExtras(), vakKans(false), vakVelden(velden, bekend)].join('');
  }
  /* De overige stappen houden het blad zoals het was, tot we ze een voor een doorlopen. */
  return [vakSamenvatting(), vakDrieVragen(bekend), vakBezwaren(dossier.bezwaren),
    vakExtras(), vakVelden(velden, bekend), vakKans(false)].join('');
}

async function schermBellen(params) {
  if (!beller) { scherm.innerHTML = kop('bellen', 'Geen beller bekend', 'Kies eerst wie je bent op Vandaag.'); return; }
  const gekozen = params.get('lead');
  if (gekozen && !(sessie.leadIds && sessie.leadIds.includes(gekozen))) { await sessieLoslaten(); sessie.leadIds = [gekozen]; sessie.overslaan = []; }
  if (!gekozen && sessie.leadIds && sessie.leadIds.length === 1 && !sessie.item) sessie.leadIds = null;
  if (!sessie.item) {
    try { await sessieVolgende(); } catch (e) { scherm.innerHTML = kop('belsessie', 'Dat lukte niet', esc(e.message)); return; }
  }
  if (!sessie.item) {
    const d = await api(`/api/dagstand?${scopeQuery()}`);
    scherm.innerHTML = kop('belsessie', sessie.totaal || sessie.gedaanVandaag ? 'Klaar met deze selectie' : 'Niets te bellen', sessie.leadIds ? 'De gekozen lijst is af.' : 'Alle belregels zijn gedaan of overgeslagen en de voorraad nieuwe leads is op. Er moeten nieuwe leads bij voordat er verder gebeld kan worden.')
      + tegels([['unieke leads', esc(d.uniekeLeads.aantal)], ['belpogingen', esc(d.belpogingen.aantal)], ['bereikt', esc(d.bereikt.aantal)], ['inhoudelijk', esc(d.inhoudelijk.aantal)], ['WhatsApp', esc(d.whatsapp.aantal)], ["demo's gepland", esc(d.demosGepland.aantal)]])
      + `<div class="bs-klaar"><a class="fr-knop" href="#/vandaag">Naar Vandaag</a> <button type="button" class="fr-knop tweede" data-sessie="opnieuw">Overgeslagen opnieuw</button></div>`;
    return;
  }
  const s = sessie.item;
  const l = s.lead;
  const dossier = await api(`/api/lead?id=${encodeURIComponent(l.id)}`);
  const stap = dossier.stap || s.stap || 'eerste_contact';
  const script = stand.scripts[stap] || stand.script;
  const bekend = bekendVan(dossier);
  const aiStand = stand.ai && stand.ai.extractie ? (stand.ai.transcriptie ? 'AI transcribeert en ontleedt de opname na het opslaan.' : 'AI ontleedt een transcript; zonder transcriptiesleutel plak je het transcript zelf bij het gesprek.') : 'Geen AI-sleutel in deze stand: opnemen en afspelen werkt, het AI-kopje blijft op wacht staan.';
  const html = [modusBalk()];
  html.push(`<div class="bs-kop"><span class="stap">belsessie ${esc(sessie.positie)} van ${esc(sessie.totaal)}${sessie.leadIds ? ' (gekozen lijst)' : ''}, ${esc(sessie.gedaanVandaag || 0)} gebeld vandaag</span><span class="bs-tijd" id="bs-tijd">${sessie.gestart ? tijdTekst(Date.now() - sessie.gestart) : 'nog niet gestart'}</span><span class="bs-opname ${sessie.opname ? 'aan' : ''}" id="bs-opname">${sessie.opname ? 'opname loopt' : (sessie.opnameKlaar && sessie.opnameRef ? 'opname bewaard' : 'geen opname')}</span>
    <div class="rechts"><span class="fr-seg klein"><button type="button" data-weergave="begeleid" class="${weergave === 'begeleid' ? 'aan' : ''}">begeleid</button><button type="button" data-weergave="compact" class="${weergave === 'compact' ? 'aan' : ''}">compact</button></span><button type="button" class="bd-knopje" data-sessie="overslaan">Overslaan</button><button type="button" class="bd-knopje" data-sessie="stop">Stop sessie</button></div></div>`);
  html.push(meldingBalk([stap]));
  html.push('<div class="bs-twee"><div>');
  html.push(`<p class="fr-eyebrow">${woord(s.soort)}, script ${woord(stap)}</p><h1 class="fr-kop">${linkLead(l.id, l.naam)}</h1><p class="fr-onderkop">${esc([l.plaats, l.regio].filter(Boolean).join(', '))}${l.rechtsvorm ? `, ${esc(l.rechtsvorm)}` : ''}${l.belOptIn ? ', opt-in ja' : ''}${s.contactpersoon ? `, spreek met ${esc(s.contactpersoon)}` : ''}</p>`);
  html.push(`<div class="bs-nummer">${l.telefoon ? `<a href="tel:${esc(cijfers(l.telefoon) ? '+' + cijfers(l.telefoon) : l.telefoon)}">${esc(l.telefoon)}</a>` : 'geen nummer'}</div>`);
  html.push(`<div class="bd-acties bs-start">${sessie.gestart ? '' : '<button type="button" class="fr-knop" data-sessie="start">Gesprek gestart</button>'}${sessie.gestart && !sessie.opname && !sessie.opnameKlaar ? '<button type="button" class="fr-knop" data-sessie="opname-aan">Hij zei ja, opname aan</button><button type="button" class="fr-knop tweede" data-sessie="opname-nee">Geen opname</button>' : ''}${sessie.opname ? '<button type="button" class="fr-knop tweede" data-sessie="opname-uit">Opname stoppen</button>' : ''}${l.whatsapp || l.telefoon ? `<a class="fr-knop klein tweede" href="https://wa.me/${esc(cijfers(l.whatsapp || l.telefoon))}" target="_blank" rel="noopener">App</a>` : ''}${l.email ? `<a class="fr-knop klein tweede" href="mailto:${esc(l.email)}">Mail</a>` : ''}${l.website ? `<a class="fr-knop klein tweede" href="${esc(l.website)}" target="_blank" rel="noopener">Site</a>` : ''}<span class="fr-hint">eigenaar ${esc(s.eigenaarNaam || 'niemand')}, geclaimd door jou tot je opslaat of overslaat</span></div>`);
  html.push(`<ul class="bs-lijst"><li><span><b>${redenWoord(s.contactreden)}</b>: ${esc(s.reden)}</span></li>${s.laatsteContact ? `<li>laatste contact ${dag(s.laatsteContact.dag)} (${typeWoord(s.laatsteContact.type)}${s.laatsteContact.uitkomst ? `: ${woord(s.laatsteContact.uitkomst)}` : ''}), ${esc(s.pogingen)} pogingen zonder gehoor</li>` : '<li>nog nooit gebeld</li>'}${s.laatsteVerstuurd ? `<li>gestuurd ${dag(s.laatsteVerstuurd.dag)}: ${woord(s.laatsteVerstuurd.materiaal || s.laatsteVerstuurd.type)}, ${reactieWoord(s.reactie)}</li>` : ''}${s.waarschuwingen.map((w) => `<li class="bd-let">${esc(w)}</li>`).join('')}<li>ingang: ${esc(stand.ingangen[s.ingang] || '')}</li></ul>`);
  if (s.briefing) html.push(`<p class="bd-citaat">${esc(s.briefing)}</p>`);
  if (dossier.demoBriefing && dossier.demoBriefing.tekst) html.push(`<details class="bd-details" ${stap !== 'eerste_contact' ? 'open' : ''}><summary>Wat we al weten (${esc(dossier.demoBriefing.bekend.length)} velden, ${esc(dossier.bezwaren.length)} bezwaren)</summary><pre class="bd-pre">${esc(dossier.demoBriefing.tekst)}</pre></details>`);
  if (weergave === 'compact') {
    html.push(aandachtspunten(dossier));
    html.push(`<details class="bd-details bs-werkwijze"><summary>Volledige werkwijze <span class="bd-badge">${esc(script.versie || '')}</span></summary>${scriptBlok(script, bekend, stand.vasteAntwoorden, true, false)}</details>`);
  } else {
    html.push(scriptBlok(script, bekend, stand.vasteAntwoorden, true, false));
  }
  html.push('</div><div>');
  html.push('<p class="fr-eyebrow">na het gesprek</p><h2 class="bs-rechtskop">Wat je vastlegt</h2>');
  if ((script.naHetGesprek || []).length) {
    html.push(`<details class="bd-uitleg"><summary>Wat er in moet</summary><ul class="bs-lijst">${(script.naHetGesprek || []).map((z) => `<li>${esc(z)}</li>`).join('')}</ul></details>`);
  }
  /* Het formulier in vakken, in de volgorde van het gesprek. Wat je bij elk gesprek invult staat
     open; wat er soms bij hoort staat dicht en is een klik weg. Dicht betekent niet uit: alles
     verstuurt gewoon mee. */
  const velden = (script.vragen.flatMap((v) => v.vult).filter((v) => stand.discoveryVelden.includes(v)));
  html.push(`<form class="fr-form bd-gesprek" data-belsessie="${esc(l.id)}" data-stap="${esc(stap)}">
    <div class="fr-veldrij bs-uitkomst"><label>Uitkomst<select name="uitkomst" required data-uitkomst-form="1"><option value="">kies</option>${uitkomstOpties(stap)}</select></label><label>Opvolgen op (afgesproken datum gaat voor)<input type="date" name="opvolgDatum"></label></div>
    <div class="fr-veldrij bd-demo-velden" hidden><label>Demodatum<input type="date" name="demoDatum"></label><label>Tijd<input type="time" name="demoTijd" value="10:00"></label><label>Vorm<select name="demoVorm">${(stand.demoVormen.length ? stand.demoVormen : ['online', 'telefonisch', 'locatie']).map((v) => `<option value="${esc(v)}">${esc(v)}</option>`).join('')}</select></label><label>Duur (min)<input type="number" name="demoDuur" value="45"></label></div>
    ${vastlegVakken(stap, { script, bekend, dossier, velden })}
    ${bsVak('Bericht na het gesprek', `<div class="fr-veldrij"><label>Sturen via<select name="berichtKanaal"><option value="">geen bericht</option><option value="whatsapp">WhatsApp</option><option value="email">mail</option></select></label><label>Template${templateKeuze('whatsapp', stap)}</label><label>Reactie verwacht binnen (werkdagen)<input type="number" name="reactieTermijnDagen" min="0" value="3"></label></div>
      <label>Berichttekst<textarea name="berichtTekst" rows="3">${esc(templateTekst((stand.templates.find((x) => x.kanaal === 'whatsapp' && x.stap === stap) || {}).ref, { naam: s.contactpersoon || l.naam }))}</textarea></label>
      <div class="fr-veldrij"><label>Link<input type="text" name="berichtLink" value="https://framr.one/p/vloeren"></label></div>`, false, 'alleen als afgesproken; jij bevestigt dat het weg is')}
    ${bsVak('Tags en opname', `<div class="fr-veldrij"><label>Tags (komma)<input type="text" name="tags" placeholder="concurrent, calculator, marge"></label><label>Opname als bestand<input type="file" name="opnameBestand" accept="audio/*"></label></div>`, false)}
    <div class="fr-knoppenrij">${schrijfKnop('Opslaan en volgende', 'fr-knop', 'type="submit"')}<span class="fr-hint">${sessie.opname ? 'De opname stopt en wordt bewaard bij het opslaan.' : (sessie.opnameKlaar && sessie.opnameRef ? 'Opname bewaard.' : 'Zonder opname.')} ${esc(aiStand)}</span></div>
  </form>`);
  html.push('</div></div>');
  scherm.innerHTML = html.join('');
  clearInterval(sessie.klok);
  if (sessie.gestart) sessie.klok = setInterval(() => { const el = document.getElementById('bs-tijd'); if (el) { el.textContent = tijdTekst(Date.now() - sessie.gestart); el.classList.add('loopt'); } }, 1000);
}

/* ---------- Leads: een totaaloverzicht ---------- */

let leadFilter = { zoek: '', classificatie: '', regio: '', beller: '', fase: '', commercieel: '', actie: '', achterstallig: '', reactie: '', geenActie: '', tag: '', behandeling: '', ids: '', traject: 'actief', sorteer: 'actie', pagina: 1 };
const LEAD_TRAJECTEN = [['actief', 'Actief'], ['gepauzeerd', 'Gepauzeerd'], ['verloren', 'Verloren'], ['', 'Alles']];
const LEAD_SORTERINGEN = [['actie', 'op volgende actie'], ['naam', 'op naam'], ['contact', 'op laatste contact']];

/* Leads in de regelvorm van A (Jelle, 25-09-2026): een regel per bedrijf, kolommen die
   boven hun cel staan, verloren standaard eruit, en de volgende actie als het ding dat je
   scant. De dropdowns blijven, achter "Meer filters". */
async function schermLeads(params) {
  if (params.get('ids')) leadFilter = { ...leadFilter, ids: params.get('ids'), traject: '', pagina: 1 };
  if (params.get('commercieel') !== null) leadFilter = { ...leadFilter, commercieel: params.get('commercieel') || '', traject: params.get('commercieel') === 'verloren' ? '' : leadFilter.traject, pagina: 1 };
  if (params.get('fase') !== null) leadFilter = { ...leadFilter, fase: params.get('fase') || '', traject: '', pagina: 1 };
  const f = { ...leadFilter };
  /* De leadlijst draagt de naam van de eigenaar, niet zijn id. */
  if (scope === 'mijn') f.beller = naamVanBeller(beller) || ''; else if (scope !== 'iedereen') f.beller = naamVanBeller(scope) || '';
  const q = new URLSearchParams(Object.entries(f).filter(([, v]) => v !== '' && v !== undefined && v !== null));
  const d = await api(`/api/leads?${q}`);
  const sel = (naam, waarden, label, f2 = woord) => `<select data-filter="${naam}"><option value="">${esc(label)}</option>${waarden.map((v) => `<option value="${esc(v)}" ${leadFilter[naam] === v ? 'selected' : ''}>${f2(v)}</option>`).join('')}</select>`;
  const vink = (naam, label) => `<label class="bd-vink"><input type="checkbox" data-filter="${naam}" value="1" ${leadFilter[naam] ? 'checked' : ''}> ${esc(label)}</label>`;
  const extraAan = ['classificatie', 'regio', 'fase', 'commercieel', 'actie', 'reactie', 'tag', 'achterstallig', 'geenActie', 'behandeling'].filter((k) => leadFilter[k]).length;
  const html = [kop('leads', 'Leads', 'Een regel per bedrijf. De volgende actie is wat je scant; wat te laat is staat bovenaan.', `<a class="fr-knop" href="#/nieuw">Bedrijf toevoegen</a>`, `Werk van ${esc(scopeWoord())}. Actief is de standaard: verloren en gepauzeerd zie je alleen als je erom vraagt. In het dossier staat alles van een bedrijf bij elkaar: de gesprekken, de taken, de berichten, de bestellingen en de service.`)];
  html.push(`<div class="ll-balk"><input type="search" id="zoek" class="ll-zoek" placeholder="Zoek op naam, plaats, nummer of contactpersoon" value="${esc(leadFilter.zoek)}">
    <div class="wl-chips">${LEAD_TRAJECTEN.map(([k, naam]) => `<button type="button" class="wl-chip ${leadFilter.traject === k ? 'aan' : ''}" data-lead-traject="${k}">${esc(naam)} <span>${esc(k ? d.perTraject[k] : d.perTraject.actief + d.perTraject.gepauzeerd + d.perTraject.verloren)}</span></button>`).join('')}</div>
    <select class="fr-in klein ll-sorteer" data-lead-sorteer="1">${LEAD_SORTERINGEN.map(([k, naam]) => `<option value="${k}" ${leadFilter.sorteer === k ? 'selected' : ''}>${esc(naam)}</option>`).join('')}</select></div>`);
  html.push(`<details class="bd-details ll-meer" ${extraAan || leadFilter.ids ? 'open' : ''}><summary>Meer filters${extraAan ? ` (${esc(extraAan)} aan)` : ''}</summary>
    <div class="fr-zoekbalk">${sel('commercieel', d.filters.commercieel, 'alle fasen')}${sel('fase', ['zonder', ...d.filters.fases], 'alle hoofdstatussen')}${sel('actie', d.filters.acties, 'elke volgende actie')}${sel('reactie', d.filters.reacties, 'elke reactiestatus')}${sel('classificatie', d.filters.classificaties, 'alle soorten')}${sel('regio', d.filters.regios, 'alle provincies')}${sel('tag', d.filters.tags, 'alle tags', esc)}</div>
    <div class="bd-vinken">${vink('achterstallig', 'achterstallig')}${vink('geenActie', 'geen volgende actie')}${vink('behandeling', 'nu in behandeling')}${leadFilter.ids ? `<span class="bd-badge oranje">selectie uit de funnel</span> <button type="button" class="bd-knopje" data-filter-wis="ids">wis</button>` : ''}</div></details>`);
  html.push(`<div class="ll-kop"><span>Bedrijf</span><span>Fase</span><span>Laatste contact</span><span>Volgende actie</span><span></span></div>`);
  if (!d.rijen.length) html.push(leeg(leadFilter.traject === 'actief' && !leadFilter.zoek && !extraAan ? 'Geen actieve leads in deze scope.' : 'Niets gevonden met deze filters.'));
  html.push('<div class="ll-lijst">');
  for (const r of d.rijen) html.push(leadRij(r));
  html.push('</div>');
  const ids = d.rijen.map((r) => r.leadnummer);
  html.push(`<div class="fr-blader"><span class="maatje">${esc(d.totaal)} leads, pagina ${esc(d.pagina)} van ${esc(d.paginas)}</span>${d.pagina > 1 ? '<button type="button" class="fr-knop klein tweede" data-pagina="-1">Vorige</button>' : ''}${d.pagina < d.paginas ? '<button type="button" class="fr-knop klein tweede" data-pagina="1">Volgende</button>' : ''}${ids.length ? `<a class="fr-knop klein" href="#/bellen?lijst=${esc(ids.join(','))}">Belsessie met deze ${esc(ids.length)}</a>` : ''}${leadFilter.fase === 'zonder' && d.totaal ? schrijfKnop(`Zet deze ${d.totaal} op nieuwe lead`, 'fr-knop klein tweede', 'data-fase-invullen="1"') : ''}</div>`);
  scherm.innerHTML = html.join('');
  const zoek = document.getElementById('zoek');
  let t;
  zoek.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { leadFilter.zoek = zoek.value; leadFilter.pagina = 1; schermLeads(new URLSearchParams()); }, 250); });
}

/* Wanneer de volgende actie is, in de woorden van Vandaag: te laat, vandaag, een dag, of niets. */
function actieWanneer(r) {
  const gesloten = ['verloren', 'niet_meer_benaderen'].includes(r.fase) || String(r.trajectstatus || '').startsWith('verloren');
  if (!r.volgende_actie) return gesloten ? { tekst: 'Gesloten', klas: 'later' } : { tekst: 'Geen', klas: 'geen' };
  const v = stand.vandaag;
  const op = r.volgende_actie_op || '';
  if (op && v && op < v) { const n = dagenTussen(op, v); return { tekst: `Te laat, ${n} ${n === 1 ? 'dag' : 'dagen'}`, klas: 'laat' }; }
  if (!op || op === v) return { tekst: 'Vandaag', klas: '' };
  return { tekst: dagKort(op), klas: 'later' };
}

function leadRij(r) {
  const w = actieWanneer(r);
  const gesloten = w.tekst === 'Gesloten';
  const wie = [r.contactpersoon, [r.plaats, r.provincie].filter(Boolean).join(', ')].filter(Boolean);
  if (scope !== 'mijn' && r.toegewezen_aan) wie.push(`bij ${r.toegewezen_aan}`);
  if (!r.toegewezen_aan) wie.push('niet toegewezen');
  const laatste = r.laatste_contact
    ? `${dagKort(r.laatste_contact)} <span class="ll-sub">${woord(r.laatste_contact_type)}${r.laatste_uitkomst && r.laatste_contact_type === 'call' ? `: ${woord(r.laatste_uitkomst)}` : ''}</span>`
    : '<span class="ll-sub">nog geen contact</span>';
  const reactie = r.reactie_status ? reactieWoord({ status: r.reactie_status, termijn: null, ontvangenOp: r.laatste_reactie }) : (r.laatste_reactie ? `reactie ${dagKort(r.laatste_reactie)}` : '');
  return `<div class="ll-rij ${w.klas}">
    <div class="ll-bedrijf"><div class="ll-naam"><a href="#/lead/${esc(r.leadnummer)}">${esc(r.bedrijfsnaam)}</a>${r.in_behandeling_door ? ` <span class="bd-badge oranje">nu bij ${esc(r.in_behandeling_door)}</span>` : ''}</div><div class="ll-sub">${esc(wie.join(', '))}</div></div>
    <div class="ll-fase"><span class="ll-stip ${r.commerciele_fase === 'actieve_partner' ? 'groen' : (gesloten ? 'stil' : '')}"></span>${woord(r.commerciele_fase || (gesloten ? 'verloren' : 'nieuw'))}${r.fase && r.fase !== r.commerciele_fase && !gesloten ? `<div class="ll-sub">${woord(r.fase)}</div>` : ''}${String(r.trajectstatus || '').startsWith('gepauzeerd') ? `<div class="ll-sub">${esc(r.trajectstatus)}</div>` : ''}</div>
    <div class="ll-contact">${laatste}${reactie ? `<div class="ll-sub">${reactie}</div>` : ''}</div>
    <div class="ll-actie"><div class="ll-wanneer">${esc(w.tekst)}</div>${r.volgende_actie ? `<div class="ll-sub">${taakWoord(r.volgende_actie_type)}: ${esc(String(r.volgende_actie).replace(/ \(stond op \d{4}-\d{2}-\d{2}\)$/, ''))}${r.volgende_actie_wie && scope !== 'mijn' ? `, ${esc(r.volgende_actie_wie)}` : ''}</div>` : ''}</div>
    <div class="wl-acties">${!gesloten && r.telefoon ? `<a class="fr-knop klein" href="#/bellen?lead=${esc(r.leadnummer)}">Bel nu</a>` : ''}<a class="fr-knop klein tweede" href="#/lead/${esc(r.leadnummer)}">Dossier</a></div>
  </div>`;
}

/* ---------- het dossier ---------- */

let tijdlijnFilter = 'alles';
async function schermLead(id) {
  const d = await api(`/api/lead?id=${encodeURIComponent(id)}`);
  const l = d.lead;
  const bekend = bekendVan(d);
  const faseKeuze = `<select class="fr-in klein" data-fase="${esc(l.id)}" ${stand.schrijven ? '' : 'disabled'}><option value="">hoofdstatus kiezen</option>${stand.fasen.map((f) => `<option value="${esc(f)}" ${d.fase && d.fase.naam === f ? 'selected' : ''}>${woord(f)}</option>`).join('')}</select>`;
  const bellerKeuze = `<select class="fr-in klein" data-toewijzen="${esc(l.id)}" ${stand.schrijven ? '' : 'disabled'}><option value="">niet toegewezen</option>${stand.bellers.map((b) => `<option value="${esc(b.id)}" ${l.toegewezen_aan === b.id ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}</select>`;
  const primair = d.contacten.find((c) => c.primair) || d.contacten[0] || null;
  const openAfspraak = d.afspraken.find((a) => ['gepland', 'verplaatst'].includes(a.status)) || null;
  const html = [kop(woord(d.classificatie || 'lead'), l.naam, [l.plaats, l.regio].filter(Boolean).join(', '), `${commercieel(d.commercieel)} ${fase(d.fase && d.fase.naam)} ${faseKeuze} ${bellerKeuze} <a class="fr-knop klein" href="#/bellen?lead=${esc(l.id)}">Bel nu</a>`)];
  /* Bovenaan: de acht antwoorden. */
  html.push(`<div class="bd-dossierkop">
    <div><span class="k">met wie</span>${primair ? `${esc(primair.naam || '')}${primair.rol ? ` (${esc(primair.rol)})` : ''}` : '<span class="fr-hint">geen contactpersoon vastgelegd</span>'}</div>
    <div><span class="k">eigenaar</span>${esc(d.toegewezen || 'niemand')}${d.inBehandeling ? ` <span class="bd-badge oranje">nu in behandeling bij ${esc(d.inBehandeling.naam || 'collega')}</span>` : ''}</div>
    <div><span class="k">waar staan we</span>${woord(d.commercieel || 'verloren')}${d.fase ? ` (${woord(d.fase.naam)})` : ' (zonder hoofdstatus)'}${d.traject.status !== 'actief' ? `, ${esc(d.traject.status)}${d.traject.tot ? ` tot ${dag(d.traject.tot)}` : ''}` : ''}</div>
    <div><span class="k">laatste contact</span>${laatsteContactWoord(d.laatsteContact)}</div>
    <div><span class="k">laatste reactie</span>${d.laatsteContact && d.laatsteContact.laatsteReactie ? `${dag(d.laatsteContact.laatsteReactie.dag)}: ${esc(d.laatsteContact.laatsteReactie.samenvatting || d.laatsteContact.laatsteReactie.type)}` : reactieWoord(d.reactie)}</div>
    <div><span class="k">wat gebeurt hierna</span>${volgendeWoord(d.volgendeActie)}</div>
  </div>`);
  html.push(tegels([['gesprekken', esc(d.tijdlijn.filter((i) => i.type === 'call').length)], ['berichten', esc(d.tijdlijn.filter((i) => ['whatsapp', 'email'].includes(i.type)).length)], ['bezwaren', esc(d.bezwaren.length)], ['vragen', esc(d.vragen.length)], ['kansen', esc(d.kansen.length)], ['open taken', esc(d.openTaken.length)], ['opnames', esc(d.tijdlijn.reduce((s, i) => s + (i.opnames.length || (i.opname ? 1 : 0)), 0))]]));
  if (d.wilWel || d.wilNiet || d.waarom) html.push(`<div class="bd-wil"><div><span class="k">wil wel</span>${esc(d.wilWel || 'nog niet gevraagd')}</div><div><span class="k">wil niet</span>${esc(d.wilNiet || 'nog niet gevraagd')}</div><div><span class="k">waarom</span>${esc(d.waarom || 'nog niet gevraagd')}</div></div>`);
  /* Gegevens en wat we weten. */
  html.push(`<div class="fr-twee"><div>${blokkop('Bedrijf en contact')}<ul class="bd-lijstje">
    ${l.telefoon ? `<li>telefoon <b>${esc(l.telefoon)}</b></li>` : ''}${l.whatsapp ? `<li>WhatsApp <b>${esc(l.whatsapp)}</b></li>` : ''}${l.email ? `<li>mail <b>${esc(l.email)}</b></li>` : ''}${l.website ? `<li>website <a href="${esc(l.website)}" target="_blank" rel="noopener">${esc(l.website)}</a></li>` : ''}
    ${l.kvk_nummer ? `<li>KvK ${esc(l.kvk_nummer)}</li>` : ''}<li>rechtsvorm ${esc(l.rechtsvorm || 'onbekend')}${l.bel_opt_in ? ', opt-in ja' : ''}</li>${l.bedrijfsgrootte ? `<li>grootte ${esc(l.bedrijfsgrootte)}</li>` : ''}${l.huidige_leverancier ? `<li>leverancier ${esc(l.huidige_leverancier)}</li>` : ''}${l.huidige_software ? `<li>software ${esc(l.huidige_software)}</li>` : ''}
    <li>bron ${esc(l.bron || 'onbekend')}, ${esc(d.bronnen.length)} bronrecords</li>${l.geen_contact_via && l.geen_contact_via.length ? `<li class="bd-let">wil geen contact via ${esc(l.geen_contact_via.join(', '))}</li>` : ''}${d.partner ? `<li>partner in het portaal: <b>${esc(d.partner.naam)}</b> (gekoppeld op ${esc(d.partner.koppeling)})</li>` : ''}</ul>
    ${d.contacten.length ? `<p class="bd-tekst"><b>Contactpersonen</b></p><ul class="bd-lijstje">${d.contacten.map((c) => `<li>${esc(c.naam || '')}${c.rol ? ` (${esc(c.rol)})` : ''}${c.primair ? ' <span class="bd-badge">primair</span>' : ''}${c.kanaal ? `, liefst via ${esc(c.kanaal)}` : ''}</li>`).join('')}</ul>` : ''}
    ${d.feiten.length ? `<p class="bd-tekst"><b>Feiten uit de verrijking</b></p><ul class="bd-lijstje">${d.feiten.map((f) => `<li>${woord(f.veld)}: ${esc(f.waarde)} <span class="fr-hint">${dag(f.wanneer)}</span></li>`).join('')}</ul>` : ''}
    <form class="fr-form" data-kanalen="${esc(l.id)}"><div class="fr-veldrij">${['whatsapp', 'email', 'telefoon'].map((k) => `<label class="bd-vink"><input type="checkbox" name="geen" value="${k}" ${(l.geen_contact_via || []).includes(k) ? 'checked' : ''}> geen ${k}</label>`).join('')}<label>&nbsp;${schrijfKnop('Kanalen bewaren', 'bd-knopje', 'type="submit"')}</label></div></form>
    <form class="fr-form" data-pauze="${esc(l.id)}"><div class="fr-veldrij"><label>Pauzeren tot<input type="date" name="tot" value="${esc(l.gepauzeerd_tot ? String(l.gepauzeerd_tot).slice(0, 10) : '')}"></label><label>&nbsp;${schrijfKnop('Pauze zetten of opheffen', 'bd-knopje', 'type="submit"')}</label></div></form>
    </div><div>${blokkop('Wat we weten')}<p class="bd-tekst">${esc(d.briefing || 'Nog geen AI-briefing voor dit bedrijf.')}</p>
    ${d.discovery.length ? `<ul class="bd-lijstje">${d.discovery.map((a) => `<li>${woord(a.veld)}: ${esc(a.waarde)} <span class="bd-badge ${a.zekerheid === 'bevestigd' ? 'groen' : 'oranje'}">${esc(a.zekerheid)}</span> <span class="fr-hint">${esc(a.herkomst === 'beller' ? 'beller' : a.herkomst)}, ${dag(a.wanneer)}</span></li>`).join('')}</ul>` : '<p class="fr-hint">Nog niets besproken.</p>'}
    ${d.demoBriefing.onbekend.length ? `<p class="fr-hint">Nog niet besproken: ${esc(d.demoBriefing.onbekend.map((v) => v.replace(/_/g, ' ')).join(', '))}</p>` : ''}
    ${d.weetjes.length ? `<p class="bd-tekst"><b>Persoonlijke context</b></p><ul class="bd-lijstje">${d.weetjes.map((w) => `<li>${esc(w.weetje)}${w.provisional ? ' <span class="bd-badge oranje">AI, voorlopig</span>' : ''}</li>`).join('')}</ul>` : ''}
    ${d.kansen.length ? `<p class="bd-tekst"><b>Projectkansen</b></p><ul class="bd-lijstje">${d.kansen.map((k) => `<li><b>${esc(k.naam)}</b> ${esc(k.stage)}${k.geschat_m2 ? `, ${esc(k.geschat_m2)} m2` : ''}${k.projectdatum ? `, ${dag(k.projectdatum)}` : ''}</li>`).join('')}</ul>` : ''}
    </div></div>`);
  /* Bezwaren en vragen. */
  html.push(blokkop('Bezwaren en vragen', d.bezwaren.length + d.vragen.length));
  html.push(`<div class="fr-twee"><div>${d.bezwaren.length ? `<ul class="bd-lijstje">${d.bezwaren.map((b) => `<li>"${esc(b.bezwaar)}"${b.categorie ? ` <span class="bd-badge">${woord(b.categorie)}</span>` : ''}${b.soort ? ` <span class="bd-badge ${b.soort === 'definitief' ? 'oranje' : ''}">${esc(b.soort)}</span>` : ''} <span class="fr-hint">${dag(b.datum)}${b.stap ? `, ${woord(b.stap)}` : ''}</span>${b.context ? `<span class="bd-sub">context: ${esc(b.context)}</span>` : ''}${b.reactie ? `<span class="bd-sub">reactie: ${esc(b.reactie)} <select class="fr-in klein" data-bezwaar-resultaat="${esc(b.id)}" ${stand.schrijven ? '' : 'disabled'}>${stand.bezwaarResultaten.map((r) => `<option value="${r}" ${b.resultaat === r ? 'selected' : ''}>werkte: ${r}</option>`).join('')}</select></span>` : ''}${b.afspraak ? `<span class="bd-sub">afgesproken: ${esc(b.afspraak)}</span>` : ''}</li>`).join('')}</ul>` : '<p class="fr-hint">Geen bezwaren vastgelegd.</p>'}</div>
    <div>${d.vragen.length ? `<ul class="bd-lijstje">${d.vragen.map((q) => `<li>${esc(q.vraag)}${q.antwoord ? `<span class="bd-sub">${esc(q.antwoord)}</span>` : ' <span class="fr-hint">onbeantwoord</span>'}</li>`).join('')}</ul>` : '<p class="fr-hint">Geen vragen vastgelegd.</p>'}</div></div>`);
  /* Berichten en reacties. */
  const berichten = d.tijdlijn.filter((i) => ['whatsapp', 'email'].includes(i.type) || i.richting === 'inkomend');
  html.push(blokkop('Berichten en reacties', berichten.length, `${schrijfKnop('Bericht vastleggen', 'bd-knopje', 'data-uitklap="b-nieuw"')} ${schrijfKnop('Reactie ontvangen', 'bd-knopje', 'data-uitklap="r-nieuw"')}`));
  html.push(`<div id="b-nieuw" hidden class="bd-uitklap">${berichtForm(l.id, { ...l, contactpersoon: primair ? primair.naam : null }, d.stap)}</div><div id="r-nieuw" hidden class="bd-uitklap">${reactieForm(l.id)}</div>`);
  html.push(berichten.length ? `<div class="fr-rijen">${berichten.map((i) => `<div class="fr-rij"><div class="hoofd">${i.richting === 'inkomend' ? `reactie via ${esc(i.type)}` : `${esc(i.type)}${i.materiaal ? `: ${woord(i.materiaal)}` : ''}`}${i.templateRef ? ` <span class="bd-badge">${esc(i.templateRef)}</span>` : ''}</div><div class="sub">${esc(i.samenvatting || '')}${i.link ? `<span class="bd-sub"><a href="${esc(i.link)}" target="_blank" rel="noopener">${esc(i.link)}</a></span>` : ''}${i.richting !== 'inkomend' ? `<span class="bd-sub">${esc(i.verzendStatus || 'bevestigd')}${i.reactieVerwacht ? `, ${i.reactieOntvangenOp ? `reactie op ${dag(i.reactieOntvangenOp)}` : (i.reactieTermijn ? `${i.reactieTermijn < stand.vandaag ? 'termijn verstreken' : 'wacht op reactie tot'} ${dag(i.reactieTermijn)}` : 'wacht op reactie')}` : ', geen reactie verwacht'}</span>` : ''}</div><div class="maatje"><span class="wanneer">${dag(i.dag)} ${esc(i.tijd || '')}</span>${i.door ? `<span class="wanneer">${esc(i.door)}</span>` : ''}</div></div>`).join('')}</div>` : leeg('Nog geen berichten of reacties.'));
  /* Demo's en afspraken. */
  html.push(blokkop("Demo's en afspraken", d.afspraken.length, `${schrijfKnop(openAfspraak ? 'Verplaatsen' : 'Demo plannen', 'bd-knopje', 'data-uitklap="d-nieuw"')}${openAfspraak ? ` ${schrijfKnop('Annuleren', 'bd-knopje', `data-annuleer-demo="${esc(openAfspraak.id)}"`)} ${schrijfKnop('Niet verschenen', 'bd-knopje', `data-niet-verschenen="${esc(openAfspraak.id)}"`)} <a class="bd-knopje" href="#/demos">Afronden</a>` : ''}`));
  html.push(`<div id="d-nieuw" hidden class="bd-uitklap">${demoForm(l.id, { afspraak: openAfspraak, briefing: d.demoBriefing.tekst })}</div>`);
  html.push(d.afspraken.length ? `<div class="fr-rijen">${d.afspraken.map((a) => `<div class="fr-rij"><div class="hoofd">${woord(a.soort)} ${esc(a.vorm || '')} ${stip(a.status === 'uitgevoerd' ? 'goed' : (['geannuleerd', 'niet_verschenen'].includes(a.status) ? 'stil' : 'aan'), a.status)}</div><div class="sub">${esc(a.doel || '')}${a.link ? `<span class="bd-sub"><a href="${esc(a.link)}" target="_blank" rel="noopener">${esc(a.link)}</a></span>` : ''}${a.locatie ? `<span class="bd-sub">${esc(a.locatie)}</span>` : ''}${a.deelnemers ? `<span class="bd-sub">met ${esc(a.deelnemers)}</span>` : ''}${a.reden ? `<span class="bd-sub">${esc(a.reden)}</span>` : ''}</div><div class="maatje"><span class="wanneer">${dag(a.dag)} ${esc(a.tijd || '')}${a.duur ? `, ${esc(a.duur)} min` : ''}</span>${a.wie ? `<span class="wanneer">${esc(a.wie)}</span>` : ''}</div></div>`).join('')}</div>` : leeg('Nog geen demo gepland.'));
  /* Bestellingen en service (aanvulling onderdeel 3): alleen een bevestigde levering telt. */
  if (d.partner) {
    html.push(blokkop('Bestellingen en service', d.bestellingen.length, '<span class="fr-hint">een bevestigde levering zet de servicetaak klaar; een verwachte leverdatum telt niet</span>'));
    html.push(d.bestellingen.length ? `<div class="fr-rijen">${d.bestellingen.map((o) => `<div class="fr-rij bd-rij"><div class="hoofd">bestelling ${esc(o.nummer || '')}${o.bedragEx !== null ? ` <span class="fr-hint">${esc(o.bedragEx)} ex btw</span>` : ''}</div><div class="sub">${esc(o.status || '')}${o.geleverdOp ? `<span class="bd-sub">geleverd ${dag(o.geleverdOp)} (${esc(o.geleverdBron)}${o.geleverdDoor ? `, ${esc(o.geleverdDoor)}` : ''})</span>` : '<span class="bd-sub">levering niet bevestigd</span>'}${o.serviceTaak ? '<span class="bd-sub">servicetaak staat open</span>' : ''}</div><div class="maatje"><span class="wanneer">besteld ${dag(o.besteldOp)}</span></div><div class="rechts">${o.geleverdOp ? '' : schrijfKnop('Levering bevestigen', 'bd-knopje', `data-levering="${esc(o.id)}"`)}</div></div>`).join('')}</div>` : leeg('Nog geen bestellingen van deze partner in het portaal.'));
  }
  /* Taken. */
  html.push(blokkop('Taken', d.openTaken.length));
  html.push(d.openTaken.length ? `<div class="fr-rijen">${d.openTaken.map((t) => `<div class="fr-rij bd-rij"><div class="hoofd">${taakWoord(t.taak)}${t.reeks ? ` <span class="bd-badge">${woord(t.reeks)} stap ${esc(t.stap)}</span>` : ''}</div><div class="sub">${esc(t.reden || t.titel)}${t.wie ? ` <span class="wie">${esc(t.wie)}</span>` : ''}<span class="bd-sub">gemaakt ${dag(t.gemaaktOp)}</span></div><div class="maatje"><span class="wanneer">${dag(t.dag)} ${esc(t.tijd || '')}${t.dag < stand.vandaag ? ' <span class="bd-let">te laat</span>' : ''}</span></div><div class="rechts"><select class="fr-in klein" data-taak-toewijzen="${esc(t.id)}" title="wie doet dit" ${stand.schrijven ? '' : 'disabled'}><option value="">niemand</option>${stand.bellers.map((b) => `<option value="${esc(b.id)}" ${t.wieId === b.id ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}</select>${schrijfKnop('Afronden', 'bd-knopje', `data-uitklap="t-${esc(t.id)}"`)}</div><div class="bd-uitklap" id="t-${esc(t.id)}" hidden>${afrondForm(t)}</div></div>`).join('')}</div>` : leeg('Geen open taken.'));
  if (d.takenHistorie.length) html.push(`<details class="bd-details"><summary>Afgeronde taken (${esc(d.takenHistorie.length)})</summary><ul class="bd-lijstje">${d.takenHistorie.map((t) => `<li>${taakWoord(t.taak)} ${dag(t.dag)}: ${esc(t.reden)} <span class="bd-badge">${woord(t.resultaat)}</span> <span class="fr-hint">${dag(t.afgerondOp)}</span></li>`).join('')}</ul></details>`);
  /* Acties: gesprek vastleggen en opname uploaden. */
  html.push(blokkop('Vastleggen', null, `${schrijfKnop('Gesprek vastleggen', 'bd-knopje', 'data-uitklap="g-nieuw"')} ${schrijfKnop('Opname uploaden', 'bd-knopje', 'data-uitklap="o-nieuw"')}`));
  html.push(`<p class="fr-hint">Volgende stap volgens de stand: script <b>${woord(d.stap)}</b> (${esc(d.scriptRef)}).</p>`);
  html.push(`<div id="g-nieuw" hidden class="bd-uitklap">${gesprekForm(l.id, { bekend, eerdereBezwaren: d.bezwaren, lead: l, stap: d.stap })}</div>`);
  const keuzes = d.tijdlijn.filter((i) => ['call', 'demo'].includes(i.type)).slice(0, 15).map((i) => ({ id: i.id, label: `${i.type} ${i.dag} ${i.tijd || ''}${i.uitkomst ? ` (${i.uitkomst.replace(/_/g, ' ')})` : ' (zonder uitkomst)'}` }));
  html.push(`<div id="o-nieuw" hidden class="bd-uitklap">${opnameUpload(l.id, { keuzes })}</div>`);
  /* De tijdlijn. */
  const soorten = [['alles', 'alles'], ['call', 'gesprekken'], ['bericht', 'berichten'], ['inkomend', 'reacties'], ['demo', "demo's"], ['note', 'notities']];
  const zichtbaar = d.tijdlijn.filter((i) => tijdlijnFilter === 'alles' || (tijdlijnFilter === 'bericht' ? ['whatsapp', 'email'].includes(i.type) && i.richting !== 'inkomend' : (tijdlijnFilter === 'inkomend' ? i.richting === 'inkomend' : i.type === tijdlijnFilter)));
  html.push(blokkop('Tijdlijn', zichtbaar.length, `<div class="fr-seg klein">${soorten.map(([k, lbl]) => `<button type="button" data-tijdlijn="${k}" class="${tijdlijnFilter === k ? 'aan' : ''}">${esc(lbl)}</button>`).join('')}</div>`));
  html.push(zichtbaar.length ? `<div class="fr-rijen">${zichtbaar.map((i) => tijdlijnRij(i, l, d)).join('')}</div>` : leeg('Nog geen contact geweest.'));
  html.push(blokkop('Notities'));
  html.push(`<form class="fr-form" data-notitie="${esc(l.id)}"><label>Eigen notities<textarea name="notities">${esc(l.notities || '')}</textarea></label><div class="fr-knoppenrij">${schrijfKnop('Bewaren', 'fr-knop klein', 'type="submit"')}</div></form>`);
  scherm.innerHTML = html.join('');
}

function tijdlijnRij(i, l, d) {
  const titel = i.richting === 'inkomend' ? `reactie via ${esc(i.type)}` : (i.type === 'note' ? `notitie${i.tags.length ? ` (${woord(i.tags[0])})` : ''}` : `${esc(i.type === 'call' ? 'gesprek' : i.type)}${i.uitkomst ? `: ${woord(i.uitkomst)}` : (i.afTeRonden ? ' <span class="bd-let">zonder uitkomst</span>' : '')}${i.materiaal ? `: ${woord(i.materiaal)}` : ''}`);
  return `<div class="fr-rij bd-rij"><div class="hoofd">${titel}${i.contactreden ? ` <span class="bd-badge">${redenWoord(i.contactreden)}</span>` : ''}${i.stap ? ` <span class="bd-badge">${woord(i.stap)}</span>` : ''}${i.provisional ? ' <span class="bd-badge oranje">AI, te bevestigen</span>' : ''}</div>
    <div class="sub">${esc(i.samenvatting || '').replace(/\n/g, '<br>')}${i.volgendeStap ? `<span class="bd-sub">afgesproken: ${esc(i.volgendeStap)}</span>` : ''}${i.aiAdvies ? `<span class="bd-sub">advies: ${esc(i.aiAdvies)}</span>` : ''}${i.tags.length && i.type !== 'note' ? `<span class="bd-sub">${i.tags.map((t) => `<span class="bd-badge">${esc(t)}</span>`).join(' ')}</span>` : ''}</div>
    <div class="maatje"><span class="wanneer">${dag(i.dag)} ${esc(i.tijd || '')}</span>${i.door ? `<span class="wanneer">${esc(i.door)}</span>` : ''}${i.duur ? `<span class="wanneer">${esc(Math.round(i.duur / 60))} min</span>` : ''}${i.koopkans !== null ? `<span class="tal">${esc(i.koopkans)}%</span>` : ''}${i.scriptRef ? `<span class="wanneer">${esc(i.scriptRef)}</span>` : ''}</div>
    <div class="rechts">${i.provisional ? schrijfKnop('Bevestig', 'bd-knopje', `data-bevestig="${esc(i.id)}"`) : ''}${i.afTeRonden ? schrijfKnop('Afronden', 'bd-knopje', `data-uitklap="af-${esc(i.id)}"`) : ''}${['call', 'demo'].includes(i.type) ? schrijfKnop('Opname erbij', 'bd-knopje', `data-uitklap="op-${esc(i.id)}"`) : ''}</div>
    ${i.opnames.length || i.opname ? `<div class="bd-uitklap-ai">${(i.opnames.length ? i.opnames : [i.opname]).map((o) => speler(o, i.id)).join('')}${i.transcript ? `<span class="bd-sub">transcript: ${esc(i.transcript)}</span>` : ''}${i.toestemming === true ? '<span class="bd-badge groen">toestemming ja</span>' : (i.toestemming === false ? '<span class="bd-badge oranje">geen toestemming</span>' : '')}</div>` : ''}
    ${i.type === 'call' || i.type === 'demo' ? `<div class="bd-uitklap-ai">${aiKopje(i)}</div>` : ''}
    ${i.afTeRonden ? `<div class="bd-uitklap" id="af-${esc(i.id)}" hidden>${gesprekForm(l.id, { interactionId: i.id, bekend: bekendVan(d), eerdereBezwaren: d.bezwaren, lead: l, stap: d.stap })}</div>` : ''}
    ${['call', 'demo'].includes(i.type) ? `<div class="bd-uitklap" id="op-${esc(i.id)}" hidden>${opnameUpload(l.id, { interactionId: i.id })}</div>` : ''}
  </div>`;
}

/* ---------- Agenda en Opvolging ---------- */

async function schermAgenda(params) {
  const van = params.get('van') || stand.vandaag;
  const tot = params.get('tot') || null;
  const q = tot ? `&van=${van}&tot=${tot}` : `&van=${van}`;
  const d = await api(`/api/agenda?${scopeQuery()}${q}`);
  const html = [kop('agenda', 'Agenda', `Alles met een tijd erop, van ${dag(d.van)} tot ${dag(d.tot)}.`, '', `Werk van ${esc(scopeWoord())}. Een demo plannen of verplaatsen kan hier, en ook vanuit het dossier van het bedrijf.`)];
  html.push(`<div class="bd-acties"><a class="bd-knopje" href="#/agenda?van=${esc(vorigeDagen(d.van, 14))}">Vorige twee weken</a><a class="bd-knopje" href="#/agenda">Vandaag</a><a class="bd-knopje" href="#/agenda?van=${esc(vorigeDagen(d.tot, -1))}">Volgende twee weken</a></div>`);
  for (const dg of d.dagen) {
    if (!dg.items.length && dg.dag !== stand.vandaag) continue;
    html.push(`<h3 class="bd-groepkop ${dg.dag === stand.vandaag ? 'vandaag' : ''}">${esc(dagWoord(dg.dag))} <span class="maatje">${esc(dg.items.length)}</span></h3>`);
    html.push(dg.items.length ? `<div class="fr-rijen">${dg.items.map((i) => `<div class="fr-rij bd-rij"><div class="maatje" style="flex:0 0 80px"><span class="tal">${esc(i.tijd || '')}</span>${i.duur ? `<span class="wanneer">${esc(i.duur)} min</span>` : ''}</div><div class="hoofd">${linkLead(i.leadId, i.lead)}<span class="bd-sub">${taakWoord(i.wat)}${i.vorm ? `, ${esc(i.vorm)}` : ''} ${i.soort === 'afspraak' ? stip(i.status === 'uitgevoerd' ? 'goed' : (['niet_verschenen'].includes(i.status) ? 'stil' : 'aan'), i.status) : ''}</span></div><div class="sub">${esc(i.doel || '')}${i.link ? `<span class="bd-sub"><a href="${esc(i.link)}" target="_blank" rel="noopener">${esc(i.link)}</a></span>` : ''}${i.locatie ? `<span class="bd-sub">${esc(i.locatie)}</span>` : ''}${i.deelnemers ? `<span class="bd-sub">met ${esc(i.deelnemers)}</span>` : ''}</div><div class="maatje"><span class="wanneer">${esc(i.wie || '')}</span></div><div class="rechts">${i.soort === 'afspraak' && ['gepland', 'verplaatst'].includes(i.status) ? `${schrijfKnop('Verplaatsen', 'bd-knopje', `data-uitklap="ag-${esc(i.id)}"`)} ${schrijfKnop('Annuleren', 'bd-knopje', `data-annuleer-demo="${esc(i.id)}"`)} ${schrijfKnop('Niet verschenen', 'bd-knopje', `data-niet-verschenen="${esc(i.id)}"`)} <a class="bd-knopje" href="#/demos">Afronden</a>` : (i.soort === 'taak' ? schrijfKnop('Afronden', 'bd-knopje', `data-uitklap="ag-${esc(i.id)}"`) : '')}</div>${i.soort === 'afspraak' && ['gepland', 'verplaatst'].includes(i.status) ? `<div class="bd-uitklap" id="ag-${esc(i.id)}" hidden>${demoForm(i.leadId, { afspraak: { id: i.id, dag: i.dag, tijd: i.tijd, duur: i.duur, vorm: i.vorm, link: i.link, locatie: i.locatie, doel: i.doel, deelnemers: i.deelnemers, wie: i.wie } })}</div>` : (i.soort === 'taak' ? `<div class="bd-uitklap" id="ag-${esc(i.id)}" hidden>${afrondForm({ id: i.taakId, taak: i.wat })}</div>` : '')}</div>`).join('')}</div>` : leeg('Niets gepland.'));
  }
  scherm.innerHTML = html.join('');
}
function vorigeDagen(d, n) {
  const [j, m, dd] = String(d).split('-').map(Number);
  const dt = new Date(j, m - 1, dd - n);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}
function dagWoord(d) {
  const [j, m, dd] = String(d).split('-').map(Number);
  const dt = new Date(j, m - 1, dd);
  return `${['zondag', 'maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag'][dt.getDay()]} ${dd}-${String(m).padStart(2, '0')}`;
}

async function schermOpvolging() {
  const d = await api(`/api/opvolging?${scopeQuery()}`);
  const rijen = (lijst) => (lijst.length ? `<div class="fr-rijen">${lijst.map((t) => `<div class="fr-rij bd-rij"><div class="hoofd">${linkLead(t.leadId, t.lead)}<span class="bd-sub">${esc(t.plaats || '')}${t.eigenaar ? `, eigenaar ${esc(t.eigenaar)}` : ''}</span></div><div class="sub">${taakWoord(t.taak)}${t.reeks ? ` <span class="bd-badge">${woord(t.reeks)} ${esc(t.stap)}</span>` : ''}<span class="bd-sub">${esc(t.reden || '')}</span><span class="bd-sub fr-hint">gemaakt ${dag(t.gemaaktOp)}: dat is waarom deze taak bestaat</span></div><div class="maatje"><span class="wanneer">${dag(t.dag) || 'zonder datum'} ${esc(t.tijd || '')}${t.dagenTeLaat ? ` (${esc(t.dagenTeLaat)} dagen te laat)` : ''}</span>${t.wie ? `<span class="wanneer">${esc(t.wie)}</span>` : ''}<span class="tal">${esc(t.telefoon || '')}</span></div><div class="rechts">${t.taak === 'call' ? `<a class="bd-knopje" href="#/bellen?lead=${esc(t.leadId)}">Bel nu</a>` : ''}${schrijfKnop('Afronden', 'bd-knopje', `data-uitklap="t-${esc(t.id)}"`)}</div><div class="bd-uitklap" id="t-${esc(t.id)}" hidden>${afrondForm(t)}</div></div>`).join('')}</div>` : leeg('Niets.'));
  scherm.innerHTML = [kop('opvolging', 'Opvolging', `Elke warme lead heeft een volgende actie. Hier staan ze op een rij.`, '', `Werk van ${esc(scopeWoord())}. Elke uitkomst van een gesprek maakt zijn eigen taak, en elke taak zegt waarom hij bestaat. Het zijn dezelfde taken als op Vandaag en in het dossier, alleen anders gerangschikt.`),
    tegels([['open', esc(d.totaal)], ['achterstallig', esc(d.achterstallig.length), d.achterstallig.length ? 'let' : ''], ['vandaag', esc(d.vandaag.length)], ['deze week', esc(d.dezeWeek.length)], ["demo's", esc(d.demos.length)]]),
    blokkop('Achterstallig', d.achterstallig.length), rijen(d.achterstallig),
    blokkop('Vandaag', d.vandaag.length), rijen(d.vandaag),
    blokkop('Deze week', d.dezeWeek.length), rijen(d.dezeWeek),
    blokkop('Later', d.later.length), rijen(d.later)].join('');
}

/* ---------- Een bedrijf toevoegen ---------- */

/* Wat er na het opslaan gebeurd is; blijft staan tot je het scherm verlaat, zodat je ziet dat
   het gelukt is en meteen door kunt naar het dossier of naar de volgende. */
let nieuwResultaat = null;

async function schermNieuw() {
  const gebieden = stand.werkgebieden || [];
  const html = [kop('toevoegen', 'Bedrijf toevoegen', 'Naam is het enige dat moet. Een nummer erbij en hij staat morgen in je belsessie.', '',
    'Hij komt binnen als nieuwe lead, in de werkbak nieuwe leads. Staat het bedrijf er al, op KvK, website, of op naam plus plaats, dan zegt dit scherm dat en komt er geen tweede rij naast; je kunt dan naar het bestaande dossier of bewust doorzetten en de gegevens bijwerken.')];
  if (nieuwResultaat) {
    const r = nieuwResultaat;
    html.push(`<div class="bd-uitkomst ${r.bestond && !r.nieuw ? 'let' : 'goed'}"><p><b>${esc(r.melding)}</b></p>
      <div class="bd-acties"><a class="fr-knop klein" href="#/lead/${esc(r.leadId)}">Naar het dossier</a>
      <a class="fr-knop klein tweede" href="#/bellen?lead=${esc(r.leadId)}">Meteen bellen</a>
      <button type="button" class="fr-knop klein tweede" data-nieuw-opnieuw="1">Nog een bedrijf</button></div></div>`);
  }
  html.push(`<form class="fr-form bd-nieuwform" data-lead-nieuw="1">
    <div class="fr-veldrij">
      <label>Bedrijfsnaam<input type="text" name="naam" required autofocus placeholder="zoals het op de gevel staat"></label>
      <label>Plaats<input type="text" name="plaats"></label>
      <label>Telefoon<input type="tel" name="telefoon" placeholder="waar je hem op belt"></label>
    </div>
    <div class="fr-veldrij">
      <label>Contactpersoon<input type="text" name="contactNaam" placeholder="wie je aan de lijn wil"></label>
      <label>Zijn rol<input type="text" name="contactRol" placeholder="eigenaar, planner, uitvoerder"></label>
      <label>E-mailadres<input type="email" name="email"></label>
    </div>
    <div class="fr-veldrij">
      <label>Rechtsvorm<select name="rechtsvorm"><option value="">onbekend</option><option value="bv">bv</option><option value="eenmanszaak">eenmanszaak</option><option value="vof">vof</option></select></label>
      <label class="bd-vinkje"><input type="checkbox" name="belOptIn" value="1"> Hij heeft zelf om contact gevraagd</label>
      ${gebieden.length > 1 ? `<label>Werkgebied<select name="werkgebied" required><option value="">kies een werkgebied</option>${gebieden.map((g) => `<option value="${esc(g)}" ${werkgebied === g ? 'selected' : ''}>${woord(g)}</option>`).join('')}</select></label>` : ''}
    </div>
    <p class="fr-hint">Een bv mag je koud bellen. Bij een eenmanszaak of vof mag dat alleen als hij zelf om contact vroeg; weet je het niet, dan waarschuwt de belsessie je en kijk je eerst bij de KvK.</p>
    <details class="bd-details"><summary>Meer gegevens</summary><div class="fr-veldrij">
      <label>WhatsApp<input type="tel" name="whatsapp"></label>
      <label>Website<input type="text" name="website" placeholder="framr.one"></label>
      <label>KvK-nummer<input type="text" name="kvkNummer"></label>
    </div><div class="fr-veldrij">
      <label>Waar komt hij vandaan<input type="text" name="bron" placeholder="beurs, doorverwijzing, website"></label>
      <label class="breed">Notitie<input type="text" name="notities" placeholder="wat je nu al weet"></label>
    </div></details>
    <div class="bd-acties">${schrijfKnop('Toevoegen', 'fr-knop', 'type="submit"')}
      <label class="bd-vinkje"><input type="checkbox" name="erbij" value="1"> Doorzetten als hij er al staat</label></div>
  </form>`);
  scherm.innerHTML = html.join('');
}

/* ---------- Terugkijken: funnel, weekrapport, gesprekken, bezwaren, demo's, partners, feedback ---------- */

let funnelTab = 'verdeling';
async function schermFunnel(params) {
  const van = params.get('van') || '';
  const tot = params.get('tot') || '';
  const d = await api(`/api/funnel${van ? `?van=${van}&tot=${tot || stand.vandaag}` : ''}`);
  const v = d.verdeling;
  const c = d.cohort;
  const html = [kop('funnel', 'Funnel', 'Waar de leads staan, en waar het vastloopt.',
    `<div class="fr-seg klein"><button type="button" data-tab="verdeling" class="${funnelTab === 'verdeling' ? 'aan' : ''}">huidige verdeling</button><button type="button" data-tab="cohort" class="${funnelTab === 'cohort' ? 'aan' : ''}">conversie over tijd</button></div>`)];
  if (!stand.seedAanwezig) html.push('<p class="fr-note"><b>De seed staat nog niet op deze database.</b> Zonder de twintig hoofdstatussen blijft elke lead zonder status en weigert de belronde elke uitkomst. Draai research/seed-cli.mjs --set framr.</p>');
  if (funnelTab === 'verdeling') {
    const max = Math.max(1, ...v.commercieel.map((f) => f.aantal));
    html.push(tegels([['leads', esc(v.totaal)], ['actief', esc(v.trajectstatus.actief)], ['gepauzeerd', esc(v.trajectstatus.gepauzeerd)], ['verloren', esc(v.trajectstatus.verloren)], ['zonder status', esc(v.zonderStatus.aantal), v.zonderStatus.aantal ? 'let' : '']]));
    html.push(blokkop('Per commerciele fase', null, '<span class="fr-hint">klik op een fase voor de leads</span>'));
    html.push(`<ul class="bd-funnel">${v.commercieel.map((f) => `<li class="${f.fase === 'verloren' ? 'eind' : ''}"><span class="nr"></span><span class="naam"><a href="#/leads?commercieel=${esc(f.fase)}">${woord(f.fase)}</a></span><span class="staaf"><i style="width:${Math.round((f.aantal / max) * 100)}%"></i></span><span class="tal">${esc(f.aantal)}</span><span class="bd-sub" style="grid-column:2/5">${f.hoofdstatussen.map((h) => `<a href="#/leads?fase=${esc(h.naam === 'zonder status' ? 'zonder' : h.naam)}">${woord(h.naam)} ${esc(h.aantal)}</a>`).join(', ')}</span></li>`).join('')}</ul>`);
    if (v.zonderStatus.aantal) html.push(`<p class="fr-note"><b>${esc(v.zonderStatus.aantal)} leads zonder hoofdstatus.</b> ${esc(v.zonderStatus.uitleg)}. ${schrijfKnop('Zet ze op nieuwe lead', 'bd-knopje', 'data-fase-invullen="1"')}</p>`);
    html.push(`<p class="fr-hint">${esc(v.definitie)}</p>`);
  } else {
    html.push(`<form class="fr-form bd-periode" data-periode="1"><div class="fr-veldrij"><label>Startgroep van<input type="date" name="van" value="${esc(c.van)}"></label><label>tot<input type="date" name="tot" value="${esc(c.tot)}"></label><label>&nbsp;<button type="submit" class="fr-knop klein">Toon</button></label></div></form>`);
    html.push(`<p class="bd-tekst">${esc(c.definitie)} Startgroep: <b>${esc(c.cohort)}</b> leads.</p>`);
    html.push(`<div class="bd-tabel-wrap"><table class="bd-tabel"><thead><tr><th>stap</th><th class="tal">leads</th><th class="tal">van</th><th class="tal">%</th><th>definitie</th><th></th></tr></thead><tbody>${c.trap.map((s) => `<tr><td>${woord(s.stap)}</td><td class="tal">${esc(s.teller)}</td><td class="tal">${esc(s.noemer)}</td><td class="tal">${pct(s.pct)}</td><td class="fr-hint">${esc(s.definitie)}</td><td>${s.leadIds.length ? `<a class="bd-knopje" href="#/leads?ids=${esc(s.leadIds.slice(0, 300).join(','))}">toon</a>` : ''}</td></tr>`).join('')}</tbody></table></div>`);
    if (c.zonderDemo) html.push(`<p class="fr-hint">${esc(c.zonderDemo)} van deze leads kwam zonder demo tot een account.</p>`);
    html.push(blokkop('Tijd tussen stappen (mediaan in dagen) en pogingen'));
    html.push(tegels([['contact naar bereikt', `${tal(c.tijd.eersteContactNaarBereikt.mediaanDagen)}<small>${esc(c.tijd.eersteContactNaarBereikt.aantal)} leads</small>`], ['bereikt naar demo geboekt', `${tal(c.tijd.bereiktNaarDemoGeboekt.mediaanDagen)}<small>${esc(c.tijd.bereiktNaarDemoGeboekt.aantal)}</small>`], ['geboekt naar uitgevoerd', `${tal(c.tijd.demoGeboektNaarUitgevoerd.mediaanDagen)}<small>${esc(c.tijd.demoGeboektNaarUitgevoerd.aantal)}</small>`], ['demo naar account', `${tal(c.tijd.demoNaarAccount.mediaanDagen)}<small>${esc(c.tijd.demoNaarAccount.aantal)}</small>`], ['pogingen voor bereikt', `${tal(c.pogingenVoorBereikt.gemiddeld)}<small>gemiddeld</small>`]]));
    const tabel = (titel, lijst) => `${blokkop(titel)}${lijst.length ? `<div class="bd-tabel-wrap"><table class="bd-tabel"><thead><tr><th></th><th class="tal">benaderd</th><th class="tal">bereikt</th><th class="tal">gekwalificeerd</th><th class="tal">demo</th><th class="tal">account</th></tr></thead><tbody>${lijst.map((r) => `<tr><td>${esc(r.naam)}</td><td class="tal">${esc(r.benaderd)}</td><td class="tal">${esc(r.bereikt)}</td><td class="tal">${esc(r.gekwalificeerd)}</td><td class="tal">${esc(r.demo)}</td><td class="tal">${esc(r.account)}</td></tr>`).join('')}</tbody></table></div>` : leeg('Geen leads in deze startgroep.')}`;
    html.push(tabel('Per beller (eerste contact)', c.perBeller), tabel('Per bron', c.perBron), tabel('Per scriptversie (eerste gesprek)', c.perScript));
    html.push(blokkop('Uitvalredenen', c.uitvalredenen.length));
    html.push(c.uitvalredenen.length ? `<ul class="bd-lijstje">${c.uitvalredenen.map((u) => `<li>${woord(u.uitkomst)}: ${esc(u.aantal)}</li>`).join('')}</ul>` : leeg('Geen uitval in deze startgroep.'));
  }
  scherm.innerHTML = html.join('');
}

let weekVenster = 'zeven_dagen';
let herleidOpen = new Set();
async function schermWeek() {
  const d = await api(`/api/weekrapport?venster=${weekVenster}&${scopeQuery()}`);
  const w = d.dezeWeek;
  const p = d.vorigeWeek;
  const cel = (k, naam) => {
    const a = w[k]; const b = p[k];
    const n = (x) => (x && typeof x === 'object' ? x.aantal : x);
    const def = a && typeof a === 'object' ? a.definitie : '';
    const ids = a && typeof a === 'object' ? a.ids : [];
    return `<span class="k" title="${esc(def)}">${esc(naam)}</span><span class="tal">${tal(n(a))}${ids && ids.length ? ` <button type="button" class="bd-mini" data-herleid="${esc(k)}" title="${esc(def)}">herleid</button>` : ''}</span><span class="tal stil">${tal(n(b))}</span>${herleidOpen.has(k) ? `<span class="bd-herleiding">${ids.map((id) => { const r = d.records[id]; return r ? `<a href="#/lead/${esc(r.leadId || '')}">${esc(r.lead || id)}</a> <span class="fr-hint">${esc(r.soort)} ${dag(r.dag)}${r.uitkomst ? `, ${woord(r.uitkomst)}` : ''}${r.status ? `, ${woord(r.status)}` : ''}${r.resultaat ? `, ${woord(r.resultaat)}` : ''}</span>` : esc(id); }).join('<br>')}<br><span class="fr-hint">${esc(def)}</span></span>` : ''}`;
  };
  const max = Math.max(d.dagdoel, ...d.perDag.map((x) => x.gebeld));
  const html = [kop('weekrapport', 'Weekrapport', `${weekVenster === 'kalenderweek' ? 'Kalenderweek' : 'Afgelopen zeven dagen'} ${esc(w.van)} tot ${esc(w.tot)}, naast de periode ervoor. Werk van ${esc(scopeWoord())}.`,
    `<div class="fr-seg klein"><button type="button" data-venster="zeven_dagen" class="${weekVenster === 'zeven_dagen' ? 'aan' : ''}">zeven dagen</button><button type="button" data-venster="kalenderweek" class="${weekVenster === 'kalenderweek' ? 'aan' : ''}">kalenderweek</button></div>`)];
  html.push(blokkop('Per dag', null, `<span class="fr-hint">dagdoel ${esc(d.dagdoel)} is een indicator</span>`));
  html.push(`<div class="bd-dagen">${d.perDag.map((x) => `<div class="bd-dag"><span class="tal">${esc(x.uniek)}/${esc(x.gebeld)}</span><div class="kolom"><div class="doel" style="bottom:${Math.round((d.dagdoel / max) * 100)}%"></div><div class="staaf" style="height:${Math.round((x.gebeld / max) * 100)}%"></div></div><span class="lbl">${esc(x.dag.slice(5))}</span></div>`).join('')}</div><p class="fr-hint">unieke leads / belpogingen per dag</p>`);
  html.push(blokkop('Deze periode naast de vorige'));
  html.push(`<div class="bd-vergelijk"><span class="k"></span><span class="k">deze</span><span class="k">vorige</span>
    ${cel('uniekeLeads', 'unieke leads behandeld')}${cel('belpogingen', 'belpogingen')}${cel('bereikt', 'personen bereikt')}${cel('gesprekken', 'inhoudelijke gesprekken')}
    ${cel('whatsapp', 'WhatsApp verstuurd')}${cel('email', 'mails verstuurd')}${cel('reacties', 'reacties ontvangen')}${cel('verlopenTermijnen', 'reactietermijnen verlopen')}
    ${cel('demosGepland', "demo's geboekt")}${cel('demosGedaan', "demo's uitgevoerd")}${cel('annuleringen', 'annuleringen')}${cel('nietVerschenen', 'niet verschenen')}
    <span class="k" title="${esc(w.demoOpkomstDefinitie)}">demo-opkomst</span><span class="tal">${pct(w.demoOpkomstPct)}</span><span class="tal stil">${pct(p.demoOpkomstPct)}</span>
    ${cel('accounts', 'accounts geactiveerd')}${cel('eersteProjecten', 'eerste projecten')}${cel('eersteBestellingen', 'eerste bestellingen')}${cel('bestellingen', 'bestellingen')}
    <span class="k" title="${esc(w.omzet.definitie)}">omzet portaal (ex btw)</span><span class="tal">${esc(w.omzet.bedrag.toFixed(0))}</span><span class="tal stil">${esc(p.omzet.bedrag.toFixed(0))}</span></div>`);
  html.push(`<p class="fr-hint">${esc(w.omzet.definitie)}</p>`);
  html.push(blokkop('Stand van nu'));
  html.push(tegels([['achterstallige acties', esc(d.achterstallig.aantal), d.achterstallig.aantal ? 'let' : '', d.achterstallig.definitie], ['leads zonder volgende actie', esc(d.zonderActie.length), d.zonderActie.length ? 'let' : ''], ['reeks afgelopen, beoordelen', esc(d.teBeoordelen.length)], ["demo's zonder opvolging", esc(d.demoZonderOpvolging.length)]]));
  const tabel = (titel, lijst) => `${blokkop(titel)}${lijst.length ? `<div class="bd-tabel-wrap"><table class="bd-tabel"><thead><tr><th></th><th class="tal">gebeld</th><th class="tal">bereikt</th><th class="tal">inhoudelijk</th></tr></thead><tbody>${lijst.map((r) => `<tr><td>${woord(r.naam)}</td><td class="tal">${esc(r.gebeld)}</td><td class="tal">${esc(r.bereikt)}</td><td class="tal">${esc(r.gesprekken)}</td></tr>`).join('')}</tbody></table></div>` : leeg('Geen gesprekken in deze periode.')}`;
  html.push(tabel('Per beller', d.perBeller), tabel('Per scriptversie', d.perScript), tabel('Per provincie', d.perRegio), tabel('Per soort bedrijf', d.perClassificatie));
  html.push(blokkop('Uitkomsten en bezwaren'));
  html.push(`<div class="fr-twee"><div><ul class="bd-lijstje">${d.perUitkomst.map(([k, n]) => `<li>${woord(k)}: ${esc(n)}</li>`).join('') || '<li>geen</li>'}</ul></div><div><ul class="bd-lijstje">${d.bezwaren.map(([k, n]) => `<li>${woord(k)}: ${esc(n)}</li>`).join('') || '<li>geen bezwaren</li>'}</ul></div></div>`);
  html.push(blokkop('Leerpunten en aandachtspunten voor volgende week'));
  html.push(`<ul class="bd-lijstje">${d.aandachtspunten.map((a) => `<li>${esc(a)}</li>`).join('') || '<li>niets bijzonders</li>'}</ul>`);
  if (d.leerpunten.length) html.push(`<ul class="bd-lijstje">${d.leerpunten.map((s) => `<li><span class="bd-badge">${esc(s.categorie)}</span> ${esc(s.voorstel)} <span class="fr-hint">${esc(s.status)}</span></li>`).join('')}</ul>`);
  html.push(`<ul class="bd-lijstje"><li>Warme leads zonder volgende actie: ${d.zonderActie.length ? d.zonderActie.map((l) => linkLead(l.leadId, l.naam)).join(', ') : 'geen'}</li><li>Demo's zonder opvolging: ${d.demoZonderOpvolging.length ? d.demoZonderOpvolging.map((l) => linkLead(l.leadId, l.naam)).join(', ') : 'geen'}</li><li>Partners die dreigen af te haken: ${d.partnersRisico.length ? esc(d.partnersRisico.join(', ')) : 'geen'}</li></ul>`);
  scherm.innerHTML = html.join('');
}

let gesprekFilter = { provisional: '', opnames: '', type: '', afTeRonden: '' };
async function schermGesprekken(params) {
  if (params.get('provisional')) gesprekFilter = { ...gesprekFilter, provisional: '1' };
  const q = new URLSearchParams({ limiet: '80', provisional: gesprekFilter.provisional, opnames: gesprekFilter.opnames, type: gesprekFilter.type, beller: scope === 'mijn' ? beller : (scope === 'iedereen' ? '' : scope) });
  const d = await api(`/api/gesprekken?${q}`);
  const rijen = gesprekFilter.afTeRonden ? d.rijen.filter((i) => i.afTeRonden) : d.rijen;
  const seg = (naam, waarde, label) => `<button type="button" data-gfilter="${naam}" data-waarde="${waarde}" class="${gesprekFilter[naam] === waarde ? 'aan' : ''}">${esc(label)}</button>`;
  const html = [kop('gesprekken', 'Gesprekken en opnames', `Elk gesprek met zijn uitkomst. Werk van ${esc(scopeWoord())}.`,
    `<div class="fr-seg klein">${seg('provisional', '', 'alles')}${seg('provisional', '1', `te bevestigen (${esc(d.provisional)})`)}${seg('opnames', '1', `met opname (${esc(d.metOpname)})`)}${seg('afTeRonden', '1', `af te ronden (${esc(d.afTeRonden)})`)}</div><div class="fr-seg klein">${seg('type', '', 'alle typen')}${seg('type', 'call', 'gesprekken')}${seg('type', 'demo', "demo's")}${seg('type', 'whatsapp', 'WhatsApp')}${seg('type', 'email', 'mail')}</div>`)];
  html.push(rijen.length ? `<div class="fr-rijen">${rijen.map((i) => `<div class="fr-rij bd-rij"><div class="hoofd">${linkLead(i.leadId, i.lead)}<span class="bd-sub">${i.richting === 'inkomend' ? 'reactie via ' : ''}${esc(i.type === 'call' ? 'gesprek' : i.type)}${i.uitkomst ? `: ${woord(i.uitkomst)}` : (i.afTeRonden ? ' <span class="bd-let">zonder uitkomst</span>' : '')}${i.stap ? ` <span class="bd-badge">${woord(i.stap)}</span>` : ''}${i.provisional ? ' <span class="bd-badge oranje">AI</span>' : ''}</span></div><div class="sub">${esc(i.samenvatting || '').replace(/\n/g, '<br>')}${i.aiAdvies ? `<span class="bd-sub">advies: ${esc(i.aiAdvies)}</span>` : ''}${i.tags.length ? `<span class="bd-sub">${i.tags.map((t) => `<span class="bd-badge">${esc(t)}</span>`).join(' ')}</span>` : ''}</div><div class="maatje"><span class="wanneer">${dag(i.dag)} ${esc(i.tijd || '')}</span>${i.door ? `<span class="wanneer">${esc(i.door)}</span>` : ''}${i.opname || i.opnames.length ? `<span class="wanneer">opname${i.toestemming === true ? ' met ja' : ''}</span>` : ''}${i.transcript ? '<span class="wanneer">transcript</span>' : ''}${i.koopkans !== null ? `<span class="tal">${esc(i.koopkans)}%</span>` : ''}${i.scriptRef ? `<span class="wanneer">${esc(i.scriptRef)}</span>` : ''}</div><div class="rechts">${i.provisional ? schrijfKnop('Bevestig', 'bd-knopje', `data-bevestig="${esc(i.id)}"`) : ''}${i.afTeRonden ? schrijfKnop('Afronden', 'bd-knopje', `data-uitklap="af-${esc(i.id)}"`) : ''}${['call', 'demo'].includes(i.type) ? schrijfKnop('Opname erbij', 'bd-knopje', `data-uitklap="op-${esc(i.id)}"`) : ''}</div>
    ${i.opnames.length || i.opname ? `<div class="bd-uitklap-ai">${(i.opnames.length ? i.opnames : [i.opname]).map((o) => speler(o, i.id)).join('')}</div>` : ''}
    ${i.type === 'call' || i.type === 'demo' ? `<div class="bd-uitklap-ai">${aiKopje(i)}</div>` : ''}
    ${i.afTeRonden ? `<div class="bd-uitklap" id="af-${esc(i.id)}" hidden>${gesprekForm(i.leadId, { interactionId: i.id })}</div>` : ''}
    ${['call', 'demo'].includes(i.type) ? `<div class="bd-uitklap" id="op-${esc(i.id)}" hidden>${opnameUpload(i.leadId, { interactionId: i.id })}</div>` : ''}</div>`).join('')}</div>` : leeg('Nog geen gesprekken voor deze selectie.'));
  scherm.innerHTML = html.join('');
}

let bezwaarFilter = { zoek: '', categorie: '' };
async function schermBezwaren() {
  const d = await api(`/api/bezwaren?zoek=${encodeURIComponent(bezwaarFilter.zoek)}&categorie=${encodeURIComponent(bezwaarFilter.categorie)}`);
  const html = [kop('bezwaren', 'Bezwaren', `${esc(d.regel)}`, '', `${esc(d.uitleg)}`)];
  html.push(`<div class="fr-zoekbalk"><input type="search" id="bzoek" placeholder="Zoek in uitspraken, reacties en bedrijven" value="${esc(bezwaarFilter.zoek)}"><select data-bfilter="categorie"><option value="">alle categorieen</option>${d.alleCategorieen.map((c) => `<option value="${esc(c)}" ${bezwaarFilter.categorie === c ? 'selected' : ''}>${woord(c)}</option>`).join('')}</select></div>`);
  html.push(tegels([['bezwaren', esc(d.totaal)], ['categorieen', esc(d.categorieen.length)]]));
  for (const c of d.categorieen) {
    html.push(blokkop(c.categorie.replace(/_/g, ' '), c.aantal, `<span class="fr-hint">${esc(c.uniekeLeads)} bedrijven, ${esc(c.tijdelijk)} tijdelijk, ${esc(c.definitief)} definitief; daarna ${esc(c.voortgang.demo)} naar een demo, ${esc(c.voortgang.account)} naar een account</span>`));
    if (c.besteReactie) html.push(`<p class="bd-tekst"><b>Beste bewezen reactie:</b> ${esc(c.besteReactie.reactie)} <span class="fr-hint">${esc(c.besteReactie.tekst)}; ${esc(c.besteReactie.voortgang)} keer echte voortgang</span></p>`);
    if (c.vastAntwoord) html.push(`<p class="bd-citaat"><b>Vast antwoord:</b> ${esc(c.vastAntwoord.antwoord)}</p>`);
    if (c.reacties.length > 1) html.push(`<ul class="bd-lijstje">${c.reacties.slice(0, 6).map((r) => `<li>${esc(r.reactie)} <span class="fr-hint">${esc(r.tekst)}${r.bellers.length ? `, ${esc(r.bellers.join(', '))}` : ''}</span></li>`).join('')}</ul>`);
    html.push(`<div class="fr-rijen">${c.voorbeelden.slice(0, 12).map((v) => `<div class="fr-rij"><div class="hoofd">"${esc(v.bezwaar)}"${v.soort ? ` <span class="bd-badge ${v.soort === 'definitief' ? 'oranje' : ''}">${esc(v.soort)}</span>` : ''}</div><div class="sub">${v.context ? `<span class="bd-sub">${esc(v.context)}</span>` : ''}${v.reactie ? `<span class="bd-sub">reactie: ${esc(v.reactie)}</span>` : ''}${v.afspraak ? `<span class="bd-sub">afgesproken: ${esc(v.afspraak)}</span>` : ''}</div><div class="maatje"><span class="wanneer">${v.lead ? linkLead(v.leadId, v.lead) : ''}</span><span class="wanneer">${dag(v.datum)}${v.door ? `, ${esc(v.door)}` : ''}${v.stap ? `, ${woord(v.stap)}` : ''}</span>${v.voortgang ? `<span class="bd-badge groen">${esc(v.voortgang)}</span>` : ''}</div><div class="rechts"><select class="fr-in klein" data-bezwaar-resultaat="${esc(v.id)}" ${stand.schrijven ? '' : 'disabled'}>${stand.bezwaarResultaten.map((r) => `<option value="${r}" ${v.resultaat === r ? 'selected' : ''}>werkte: ${r}</option>`).join('')}</select></div></div>`).join('')}</div>`);
  }
  html.push(blokkop('De zes vaste antwoorden uit het gesprekssysteem'));
  html.push(`<div class="fr-rijen">${d.vasteAntwoorden.map((v) => `<div class="fr-rij"><div class="hoofd">${esc(v.bezwaar)}</div><div class="sub">${esc(v.antwoord)}</div><div class="maatje"><span class="wanneer">${woord(v.categorie)}</span></div></div>`).join('')}</div>`);
  scherm.innerHTML = html.join('');
  const z = document.getElementById('bzoek');
  let t;
  z.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { bezwaarFilter.zoek = z.value; schermBezwaren(); }, 250); });
}

async function schermDemos() {
  const d = await api('/api/demos');
  const scoreSel = (naam) => `<select name="${naam}"><option value="">-</option>${[1, 2, 3, 4, 5].map((n) => `<option value="${n}">${n}</option>`).join('')}</select>`;
  const demoForm2 = (t) => `<form class="fr-form bd-gesprek" data-demogedaan="${esc(t.leadId)}" data-taak="${esc(t.taakId)}" data-afspraak="${esc(t.afspraakId || '')}" data-verzoek="${uuid()}">
    ${t.voorbereiding ? `<details class="bd-details" open><summary>Briefing uit het telefoongesprek en de berichten</summary><pre class="bd-pre">${esc(t.voorbereiding)}</pre></details>` : ''}
    <div class="fr-veldrij"><label>Uitkomst<select name="uitkomst"><option value="">kies</option>${['account_gewenst', 'goede_interesse', 'mogelijk_interesse', 'later_terugbellen', 'nu_geen_behoefte', 'geen_match', 'niet_meer_benaderen'].map((u) => `<option value="${u}">${woord(u)}</option>`).join('')}</select></label><label>Koopkans (0 tot 100)<input type="number" name="koopkans" min="0" max="100"></label></div>
    <p class="bd-tekst"><b>Samenvatting</b></p>
    <div class="fr-veldrij"><label>Wat is getoond<input type="text" name="a_demo_getoond"></label><label>Wat begreep de lead<input type="text" name="a_demo_begrepen"></label><label>Wat was relevant<input type="text" name="a_demo_relevant"></label></div>
    <div class="fr-veldrij"><label>Aha-moment<input type="text" name="a_demo_aha_moment"></label><label>Wat moet eerst opgelost worden<input type="text" name="a_demo_eerst_oplossen"></label><label>Samenvatting<input type="text" name="samenvatting"></label></div>
    <p class="bd-tekst"><b>Verdieping</b> (de vragen uit het demoscript)</p>
    <div class="fr-veldrij">${['huidige_vloerleverancier', 'tevredenheid_leverancier', 'hoe_offertes', 'huidige_software', 'koopt_zelf_in', 'marge_op_materiaal', 'projecten_per_maand', 'm2_per_maand', 'besliscriteria'].filter((v) => stand.discoveryVelden.includes(v)).map((v) => discoveryVeldInput(v, v.replace(/_/g, ' '))).join('')}</div>
    ${herhaalBlokken([])}
    <p class="bd-tekst"><b>Concrete volgende stap</b> (eigenaar en datum)</p>
    <div class="fr-veldrij"><label>Actie<select name="volgendeTaak"><option value="">volgens de reeks demo uitgevoerd</option><option value="onboarding">account inrichten</option><option value="call">bellen</option><option value="whatsapp">WhatsApp</option><option value="email">mail</option><option value="demo">tweede demo</option></select></label><label>Op<input type="date" name="volgendeDatum"></label><label>Wie<select name="volgendeWie">${stand.bellers.map((b) => `<option value="${esc(b.id)}" ${b.id === beller ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}</select></label><label>Afgesproken<input type="text" name="volgendeStap" placeholder="wat is concreet afgesproken"></label></div>
    <details class="bd-details"><summary>Uitgebreide evaluatie per onderdeel (optioneel)</summary>
    <div class="fr-veldrij"><label>Interesse voor de demo (1 tot 10)<input type="text" name="a_interesse_voor_demo"></label><label>Interesse na de demo<input type="text" name="a_interesse_na_demo"></label><label>Zou hij het morgen gebruiken<select name="a_demo_morgen_gebruiken"><option value="">-</option><option>ja</option><option>nee</option><option>misschien</option></select></label><label>Verwachte m2 per maand<input type="text" name="a_demo_m2_verwacht"></label></div>
    <div class="bd-tabel-wrap"><table class="bd-tabel bd-demo-onderdelen"><thead><tr><th>onderdeel</th><th>getoond</th><th>begrepen</th><th>relevant</th><th>gemak</th><th>vertrouwen</th><th>reactie</th><th>bug</th></tr></thead><tbody>
    ${stand.demoOnderdelen.map((o) => `<tr data-onderdeel="${esc(o)}"><td>${woord(o)}</td><td><input type="checkbox" name="getoond"></td><td><input type="checkbox" name="begrepen"></td><td>${scoreSel('relevantie')}</td><td>${scoreSel('gebruiksgemak')}</td><td>${scoreSel('vertrouwen')}</td><td><input type="text" name="reactie"></td><td><input type="text" name="bug"></td></tr>`).join('')}
    </tbody></table></div></details>
    <div class="fr-veldrij"><label>Opname als bestand<input type="file" name="opnameBestand" accept="audio/*"></label><label>Toestemming<select name="toestemming"><option value="">niet gevraagd</option><option value="1">ja</option><option value="0">nee</option></select></label></div>
    <div class="fr-knoppenrij">${schrijfKnop('Demo afronden', 'fr-knop', 'type="submit"')}</div></form>`;
  const html = [kop("demo's", 'Waarde laten ervaren, niet verkopen', 'Een demo is het samen doorrekenen van een echt project. De briefing komt uit het telefoongesprek en de berichten; na afloop de samenvatting, de bezwaren, de volgende stap met eigenaar en datum.')];
  html.push(tegels([['gepland', esc(d.gepland.length)], ['gedaan', esc(d.gedaan.length)], ['afgezegd of niet verschenen', esc(d.afgezegd.length)], ['onderdelen gescoord', esc(d.onderdelen.length)]]));
  html.push(blokkop('Gepland', d.gepland.length));
  html.push(d.gepland.length ? `<div class="fr-rijen">${d.gepland.map((t) => `<div class="fr-rij bd-rij"><div class="hoofd">${linkLead(t.leadId, t.lead)}<span class="bd-sub">${esc(t.vorm || 'demo')}${t.link ? ` <a href="${esc(t.link)}" target="_blank" rel="noopener">link</a>` : ''}${t.locatie ? `, ${esc(t.locatie)}` : ''} ${stip(t.teLaat ? 'let' : 'aan', t.status)}</span></div><div class="sub">${esc(t.doel || '')}${t.wie ? ` <span class="wie">${esc(t.wie)}</span>` : ''}${t.deelnemers ? `<span class="bd-sub">met ${esc(t.deelnemers)}</span>` : ''}</div><div class="maatje"><span class="wanneer">${dag(t.dag)} ${esc(t.tijd || '')}${t.duur ? `, ${esc(t.duur)} min` : ''}</span></div><div class="rechts">${schrijfKnop('Afronden', 'bd-knopje', `data-uitklap="d-${esc(t.taakId)}"`)}${t.afspraakId ? ` ${schrijfKnop('Verplaatsen', 'bd-knopje', `data-uitklap="v-${esc(t.taakId)}"`)} ${schrijfKnop('Annuleren', 'bd-knopje', `data-annuleer-demo="${esc(t.afspraakId)}"`)} ${schrijfKnop('Niet verschenen', 'bd-knopje', `data-niet-verschenen="${esc(t.afspraakId)}"`)}` : ''}</div><div class="bd-uitklap" id="d-${esc(t.taakId)}" hidden>${demoForm2(t)}</div>${t.afspraakId ? `<div class="bd-uitklap" id="v-${esc(t.taakId)}" hidden>${demoForm(t.leadId, { afspraak: { id: t.afspraakId, dag: t.dag, tijd: t.tijd, duur: t.duur, vorm: t.vorm, link: t.link, locatie: t.locatie, doel: t.doel, deelnemers: t.deelnemers, wie: t.wie } })}</div>` : ''}</div>`).join('')}</div>` : leeg("Geen demo's gepland."));
  html.push(blokkop('Gedaan', d.gedaan.length));
  html.push(d.gedaan.length ? `<div class="fr-rijen">${d.gedaan.map((g) => `<div class="fr-rij"><div class="hoofd">${linkLead(g.leadId, g.lead)}<span class="bd-sub">${woord(g.uitkomst || '')}</span></div><div class="sub">${esc(g.samenvatting || '')}<span class="bd-sub">${g.watGetoond ? `getoond: ${esc(g.watGetoond)}. ` : ''}${g.aha ? `aha: ${esc(g.aha)}. ` : ''}${g.eerstOplossen ? `eerst oplossen: ${esc(g.eerstOplossen)}. ` : ''}${g.volgendeStap ? `afgesproken: ${esc(g.volgendeStap)}` : ''}</span></div><div class="maatje"><span class="wanneer">${dag(g.dag)} ${esc(g.tijd || '')}</span><span class="wanneer">${esc(g.door || '')}</span>${g.getoond ? `<span class="tal">${esc(g.getoond)} getoond</span>` : ''}${g.koopkans !== null ? `<span class="tal">${esc(g.koopkans)}%</span>` : ''}</div></div>`).join('')}</div>` : leeg("Nog geen demo's gedaan."));
  if (d.afgezegd.length) { html.push(blokkop('Afgezegd of niet verschenen', d.afgezegd.length)); html.push(`<ul class="bd-lijstje">${d.afgezegd.map((a) => `<li>${linkLead(a.leadId, a.lead)}: ${woord(a.status)} ${dag(a.dag)} ${esc(a.tijd || '')}${a.reden ? `, ${esc(a.reden)}` : ''}</li>`).join('')}</ul>`); }
  html.push(blokkop('Per onderdeel', d.onderdelen.length));
  html.push(d.onderdelen.length ? `<div class="bd-tabel-wrap"><table class="bd-tabel"><thead><tr><th>onderdeel</th><th class="tal">getoond</th><th class="tal">niet begrepen</th><th class="tal">relevantie</th><th class="tal">gemak</th><th class="tal">vertrouwen</th><th class="tal">verbeterpunten</th><th class="tal">bugs</th></tr></thead><tbody>${d.onderdelen.map((o) => `<tr><td>${woord(o.onderdeel)}</td><td class="tal">${esc(o.getoond)}</td><td class="tal">${esc(o.nietBegrepen)}</td><td class="tal">${tal(o.relevantie)}</td><td class="tal">${tal(o.gebruiksgemak)}</td><td class="tal">${tal(o.vertrouwen)}</td><td class="tal">${esc(o.verbeterpunten)}</td><td class="tal">${esc(o.bugs)}</td></tr>`).join('')}</tbody></table></div>` : leeg('Nog geen onderdelen gescoord.'));
  scherm.innerHTML = html.join('');
}

async function schermPartners() {
  const d = await api('/api/partners');
  const kleur = { nieuw: '', onboarding: 'aan', actief: 'goed', groeiend: 'goed', aandacht_nodig: 'let', slapend: 'stil', afgehaakt: 'stil' };
  const html = [kop('partners', 'Partners', 'Wat een partner sinds zijn account gedaan heeft.', '', 'Zestien mijlpalen per partner, de gezondheid uit zijn eigen ritme, en de omzet uit het portaal. Elke partner is gekoppeld aan zijn lead in het dossier, op verwijzing of op naam.')];
  html.push(tegels([['partners', esc(d.totaal)], ['omzet portaal', `${esc(d.omzet.toFixed(0))}<small>ex btw</small>`, 'geld'], ['bestellingen', esc(d.bestellingen)], ['m2 ingemeten', esc(d.m2)], ['aandacht', esc(d.perGezondheid.aandacht_nodig + d.perGezondheid.slapend), d.risico.length ? 'let' : '']]));
  html.push(blokkop('Per gezondheid'));
  html.push(`<ul class="bd-lijstje">${stand.gezondheid.map((g) => `<li>${woord(g)}: ${esc(d.perGezondheid[g] || 0)}</li>`).join('')}</ul>`);
  html.push(blokkop('Partners', d.totaal));
  html.push(d.partners.length ? `<div class="fr-rijen">${d.partners.map((p) => `<div class="fr-rij bd-rij"><div class="hoofd">${p.lead ? linkLead(p.lead.leadId, p.bedrijfsnaam) : esc(p.bedrijfsnaam)}<span class="bd-sub">${esc(p.plaats || '')}${p.niveau ? ` <b>${esc(p.niveau)}</b>` : ''}${p.klantBron ? ` via ${esc(p.klantBron)}` : ''}${p.lead ? ` <span class="bd-badge">dossier gekoppeld op ${esc(p.lead.koppeling)}</span>` : ' <span class="bd-badge oranje">geen lead gevonden</span>'}</span></div><div class="sub">${stip(kleur[p.gezondheid], p.gezondheid)}<span class="bd-sub"><span class="bd-mijlpalen" title="${esc(p.mijlpalen.filter((m) => m.gehaald).map((m) => m.naam).join(', '))}">${p.mijlpalen.map((m) => `<i class="${m.gehaald ? 'ja' : ''}"></i>`).join('')}</span> ${esc(p.gehaald)} van 16${p.vastgelopenBij ? `, volgende: ${woord(p.vastgelopenBij)}` : ''}</span></div><div class="maatje"><span class="tal">${esc(p.cijfers.bestellingen)} best.</span><span class="tal">${esc(p.cijfers.m2)} m2</span><span class="geld">${esc(p.cijfers.omzet.toFixed(0))}</span><span class="wanneer">${p.dagenStil !== null ? `${esc(p.dagenStil)} dagen stil` : ''}</span></div></div>`).join('')}</div>` : leeg('Nog geen partners in het portaal.'));
  html.push(blokkop('Waar de activatie vastloopt'));
  html.push(`<div class="bd-tabel-wrap"><table class="bd-tabel"><thead><tr><th>mijlpaal</th><th class="tal">gehaald</th></tr></thead><tbody>${d.perMijlpaal.map((m) => `<tr><td>${woord(m.naam)}</td><td class="tal">${esc(m.aantal)}</td></tr>`).join('')}</tbody></table></div>`);
  scherm.innerHTML = html.join('');
}

async function schermFeedback() {
  const d = await api('/api/feedback');
  const html = [kop('feedback', 'Feedback', 'Wat klanten vragen en missen. Hoe vaker genoemd, hoe hoger.', '', 'Productwensen en verbeteringen voor het belscript, de landingspagina en de demo, opgehaald uit de gesprekken zelf. Zo ontwikkelen we op data en niet op gevoel.')];
  html.push(tegels([['voorgesteld', esc(d.perStatus.voorgesteld)], ['actief', esc(d.perStatus.actief)], ['verworpen', esc(d.perStatus.verworpen)]]));
  for (const c of d.categorieen) {
    html.push(blokkop(c.categorie, c.aantal));
    html.push(`<div class="fr-rijen">${c.rijen.map((r) => `<div class="fr-rij"><div class="hoofd">${esc(r.voorstel)}${r.keerGenoemd > 1 ? ` <span class="bd-badge oranje">${esc(r.keerGenoemd)} keer</span>` : ''}</div><div class="sub">${esc(r.onderbouwing || '')}</div><div class="maatje"><span class="wanneer">${dag(r.dag)}</span></div><div class="rechts"><div class="fr-seg klein">${['voorgesteld', 'actief', 'verworpen'].map((s) => `<button type="button" data-suggestie="${esc(r.id)}" data-status="${s}" class="${r.status === s ? 'aan' : ''}" ${stand.schrijven ? '' : 'disabled'}>${s}</button>`).join('')}</div></div></div>`).join('')}</div>`);
  }
  if (!d.categorieen.length) html.push(leeg('Nog geen feedback vastgelegd. De gespreksverwerking en de extra\'s (productwens) vullen dit.'));
  scherm.innerHTML = html.join('');
}

/* ---------- Beheer: scripts, templates, reeksen, keuzelijsten, gegevens ---------- */

async function schermScripts() {
  const html = [kop('beheer', 'Scripts', 'Wat je zegt per stap van het gesprek.', '', 'Het telefoongesprek en de demo zijn bewust gescheiden: het eerste gesprek is kort, de verdieping hoort bij de demo. Elk contactmoment bewaart de scriptversie die gebruikt is, dus een oude registratie houdt zijn context.')];
  html.push('<p class="fr-note">Het eerste gesprek is sinds 17-09-2026 het belscript van Myron (versie v2-myron); de letterlijke tekst staat in het brein als wiki framr-belscript-myron. Scripts bewerken in het scherm met versiebeheer en meldingen bij een wijziging volgt (aanvulling stap 6).</p>');
  for (const stap of stand.stappen.filter((s) => stand.scripts[s])) {
    const s = stand.scripts[stap];
    html.push(blokkop(stap.replace(/_/g, ' '), null, `<span class="bd-badge">${esc(s.versie)}</span>${s.nodig ? ` <span class="bd-badge oranje">voorlopig</span>` : ''}`));
    html.push(`<p class="fr-hint">bron: ${esc(s.bron)}${s.nodig ? `; nodig: ${esc(s.nodig)}` : ''}</p>`);
    html.push(scriptBlok(s, {}, [], true));
    html.push(`<p class="bd-tekst"><b>Na het gesprek</b></p><ul class="bd-lijstje">${(s.naHetGesprek || []).map((z) => `<li>${esc(z)}</li>`).join('')}</ul>`);
  }
  html.push(blokkop('Werkwijzen voor taken die geen gesprek zijn', Object.keys(stand.sops || {}).length, '<span class="fr-hint">bij de taak op Vandaag; begeleid toont ze, compact zet ze achter een knop</span>'));
  for (const sop of Object.values(stand.sops || {})) html.push(`<details class="bd-details"><summary><b>${esc(sop.titel)}</b> <span class="bd-badge">${esc(sop.versie)}</span></summary>${sopBlok(sop)}</details>`);
  /* Bewerken met versiebeheer: de tekstdelen als regels, plus de toelichting die de melding vormt. */
  if (mag('werkwijze_beheer')) {
    const g = await api('/api/werkwijzen');
    html.push(blokkop('Een script aanpassen', null, '<span class="fr-hint">een inhoudelijke wijziging meldt zich bij iedereen die die stap uitvoert, tot hij hem bekeken heeft</span>'));
    html.push(`<form class="fr-form" data-werkwijze="script">
      <div class="fr-veldrij"><label>Stap<select name="ref">${stand.stappen.filter((x) => stand.scripts[x]).map((x) => `<option value="${esc(x)}">${woord(x)}</option>`).join('')}</select></label>
      <label>Soort wijziging<select name="soortWijziging"><option value="inhoudelijk">inhoudelijk (melden)</option><option value="klein">kleine tekstcorrectie (niet melden)</option></select></label>
      <label>Geldig vanaf<input type="date" name="geldigVanaf" value="${esc(stand.vandaag)}"></label>
      ${(stand.werkgebieden || []).length > 1 ? `<label>Werkgebied<select name="werkgebied"><option value="">alle</option>${stand.werkgebieden.map((g) => `<option value="${esc(g)}">${woord(g)}</option>`).join('')}</select></label>` : ''}</div>
      <label>Doel<textarea name="doel" rows="2" placeholder="laat leeg om het te laten zoals het is"></textarea></label>
      <label>Opening (een regel per zin)<textarea name="opening" rows="3"></textarea></label>
      <label>Afsluiting (een regel per zin)<textarea name="afsluiting" rows="3"></textarea></label>
      <div class="fr-veldrij"><label>Wat is er veranderd<input type="text" name="watVeranderd" required placeholder="de opening noemt nu de marge per meter"></label>
      <label>Waarom<input type="text" name="waarom" placeholder="uit de weekreview: dat opent beter"></label>
      <label>Wat moet hij voortaan anders doen<input type="text" name="watAnders"></label></div>
      <div class="fr-knoppenrij">${schrijfKnop('Nieuwe versie bewaren', 'fr-knop klein', 'type="submit"', 'werkwijze_beheer')}</div></form>`);
    if (g.alle.length) {
      html.push(blokkop('Wijzigingsgeschiedenis', g.alle.length));
      html.push(`<ul class="bd-lijstje">${g.alle.slice(0, 20).map((w) => `<li>${dag(w.wanneer)}: <b>${woord(w.soort)} ${woord(w.ref)}</b> v${esc(w.versie)} <span class="bd-badge ${w.soortWijziging === 'klein' ? '' : 'oranje'}">${woord(w.soortWijziging)}</span> ${esc(w.watVeranderd || '')}</li>`).join('')}</ul>`);
    }
  }
  const vorige = Object.entries(stand.vorigeScripts || {});
  if (vorige.length) {
    html.push(blokkop('Vorige versies', vorige.length, '<span class="fr-hint">een oude registratie wijst met zijn scriptversie hiernaartoe</span>'));
    for (const [ref, v] of vorige) html.push(`<details class="bd-details"><summary><b>${esc(ref)}</b> <span class="fr-hint">${esc(v.bron || '')}</span></summary>${scriptBlok(v, {}, [])}</details>`);
  }
  scherm.innerHTML = html.join('');
}

async function schermTemplates() {
  const html = [kop('beheer', 'Berichttemplates', 'Een startpunt voor een bericht. [naam], [beller], [link], [datum], [tijd] en [afspraak] worden ingevuld.', '', 'Een template heeft een versie; wat er echt verstuurd is staat op het contactmoment zelf. Zo blijft een oud bericht leesbaar zoals het de deur uit ging.')];
  html.push(`<div class="fr-rijen">${stand.templates.map((t) => `<div class="fr-rij"><div class="hoofd">${esc(t.naam)}<span class="bd-sub"><span class="bd-badge">${esc(t.ref)}</span> ${esc(t.kanaal)}, stap ${woord(t.stap)}, materiaal ${woord(t.materiaal)}, reactie binnen ${esc(t.reactieTermijnDagen)} werkdagen</span></div><div class="sub"><pre class="bd-pre">${esc(t.tekst)}</pre></div></div>`).join('')}</div>`);
  if (mag('werkwijze_beheer')) {
    html.push(blokkop('Een template aanpassen', null, '<span class="fr-hint">de nieuwe versie geldt vanaf de datum die je kiest; wat al verstuurd is houdt zijn eigen versie</span>'));
    html.push(`<form class="fr-form" data-werkwijze="template">
      <div class="fr-veldrij"><label>Template<select name="ref">${stand.templates.map((t) => `<option value="${esc(t.ref)}">${esc(t.naam)}</option>`).join('')}</select></label>
      <label>Reactietermijn (dagen)<input type="number" name="reactieTermijnDagen" min="0" placeholder="laat leeg om te houden"></label>
      <label>Soort wijziging<select name="soortWijziging"><option value="inhoudelijk">inhoudelijk (melden)</option><option value="klein">kleine tekstcorrectie (niet melden)</option></select></label>
      <label>Geldig vanaf<input type="date" name="geldigVanaf" value="${esc(stand.vandaag)}"></label></div>
      <label>Tekst<textarea name="tekst" rows="4" placeholder="laat leeg om de tekst te laten zoals hij is"></textarea></label>
      <div class="fr-veldrij"><label>Wat is er veranderd<input type="text" name="watVeranderd" required></label>
      <label>Waarom<input type="text" name="waarom"></label>
      <label>Wat moet hij voortaan anders doen<input type="text" name="watAnders"></label></div>
      <div class="fr-knoppenrij">${schrijfKnop('Nieuwe versie bewaren', 'fr-knop klein', 'type="submit"', 'werkwijze_beheer')}</div></form>`);
  } else {
    html.push('<p class="fr-hint">Templates aanpassen vraagt het recht werkwijze beheer.</p>');
  }
  scherm.innerHTML = html.join('');
}

async function schermReeksen() {
  const d = await api('/api/reeksen');
  const acties = ['call', 'whatsapp', 'email', 'beoordelen'];
  const html = [kop('beheer', 'Opvolgreeksen', 'Wat er gebeurt als iemand niet reageert: wanneer bellen we opnieuw, en wanneer stoppen we.', '', 'Per aanleiding een reeks stappen; elke stap zet een taak klaar, nooit een automatisch bericht. Een concreet afgesproken datum gaat voor; een reactie stopt de reeks; niet meer benaderen stopt alles.')];
  for (const r of d.reeksen) {
    html.push(blokkop(r.naam || r.aanleiding, null, `<span class="bd-badge">${esc(r.aanleiding)}</span> <span class="fr-hint">${r.bron === 'database' ? `versie ${esc(r.versie)} in de database` : 'standaard, nog niet aangepast'}${r.actief ? '' : ', uit'}</span>`));
    html.push(`<form class="fr-form" data-reeks="${esc(r.aanleiding)}"><div class="bd-tabel-wrap"><table class="bd-tabel bd-reeks"><thead><tr><th>stap</th><th>wachttijd</th><th>dagen</th><th>vanaf</th><th>actie</th><th>template</th><th>uitvoerder</th><th>reden op de taak</th><th></th></tr></thead><tbody>
      ${r.stappen.map((s, i) => reeksRij(s, i, acties)).join('')}</tbody></table></div>
      <div class="fr-veldrij"><label>Maximumaantal pogingen<input type="number" name="maxPogingen" min="1" value="${esc(r.maxPogingen || '')}"></label><label>Actief<select name="actief"><option value="1" ${r.actief ? 'selected' : ''}>ja</option><option value="0" ${r.actief ? '' : 'selected'}>nee</option></select></label><label>&nbsp;<button type="button" class="bd-knopje" data-reeks-stap="1">Stap toevoegen</button></label><label>&nbsp;${schrijfKnop('Reeks bewaren', 'fr-knop klein', 'type="submit"')}</label></div></form>`);
  }
  html.push('<p class="fr-hint">Stop-voorwaarden per stap zijn vast: reactie ontvangen, of niet meer benaderen. Automatisch extern verzenden is bewust niet ingebouwd.</p>');
  scherm.innerHTML = html.join('');
}
function reeksRij(s, i, acties) {
  return `<tr class="bd-reeks-stap"><td class="mono">${esc(i + 1)}</td><td><input type="number" name="wachtdagen" min="0" value="${esc(s.wachtdagen)}" style="width:70px"></td><td><select name="dagsoort"><option value="werkdagen" ${s.dagsoort !== 'kalenderdagen' ? 'selected' : ''}>werkdagen</option><option value="kalenderdagen" ${s.dagsoort === 'kalenderdagen' ? 'selected' : ''}>kalenderdagen</option></select></td><td class="fr-hint">${esc(s.vanaf === 'vorige_stap' ? 'vorige stap gedaan' : s.vanaf)}</td><td><select name="actie">${acties.map((a) => `<option value="${a}" ${s.actie === a ? 'selected' : ''}>${a}</option>`).join('')}</select></td><td><select name="template"><option value="">geen</option>${stand.templates.map((t) => `<option value="${esc(t.ref)}" ${s.template === t.ref ? 'selected' : ''}>${esc(t.naam)}</option>`).join('')}</select></td><td><select name="uitvoerder"><option value="beller" ${s.uitvoerder !== 'eigenaar' ? 'selected' : ''}>beller</option><option value="eigenaar" ${s.uitvoerder === 'eigenaar' ? 'selected' : ''}>eigenaar</option></select></td><td><input type="text" name="reden" value="${esc(s.reden || '')}"></td><td><button type="button" class="bd-knopje" data-verwijder-rij="1">Weg</button></td></tr>`;
}

async function schermKeuzelijsten() {
  const html = [kop('beheer', 'Keuzelijsten', 'De waarden waaruit de schermen kiezen, en wat elke uitkomst doet.', '', 'De lijsten leven per bedrijf in sales_veldopties (de seed framr); de regels erachter staan in belronde-store.mjs.')];
  html.push(blokkop('Uitkomsten van een gesprek', stand.uitkomsten.length));
  html.push(`<div class="bd-tabel-wrap"><table class="bd-tabel"><thead><tr><th>uitkomst</th><th>contactuitkomst</th><th>gespreksresultaat</th><th>fase erna</th><th>opvolging</th></tr></thead><tbody>${stand.uitkomsten.map((u) => { const r = stand.regels[u] || {}; return `<tr><td>${woord(u)}${r.oud ? ' <span class="bd-badge">oud, gesplitst</span>' : ''}</td><td>${woord(splitsClient(u).contact)}</td><td>${woord(splitsClient(u).resultaat || '')}</td><td>${r.fase === 'poging' ? 'eerste poging, dan niet bereikt, na vier keer later benaderen' : woord(r.fase || 'blijft')}</td><td>${r.reeks ? `reeks ${woord(r.reeks)}` : (r.opvolg ? `${woord(r.opvolg.taak || 'controle')} na ${esc(r.opvolg.dagen)} dagen: ${esc(r.opvolg.reden)}` : (r.demoVerplicht ? 'demo plannen met datum en tijd' : 'geen'))}${r.pauzeer ? ', lead gepauzeerd' : ''}</td></tr>`; }).join('')}</tbody></table></div>`);
  html.push(blokkop('Hoofdstatussen en commerciele fase', stand.fasen.length));
  html.push(`<ul class="bd-lijstje">${stand.fasen.map((f) => `<li>${woord(f)} <span class="fr-hint">${woord(commercieelClient(f) || 'verloren')}</span></li>`).join('')}</ul>`);
  const lijst = (titel, waarden) => `${blokkop(titel, waarden.length)}<p class="bd-tekst">${waarden.map((w) => `<span class="bd-badge">${woord(w)}</span>`).join(' ') || '<span class="fr-hint">leeg</span>'}</p>`;
  html.push(lijst('Bezwaarcategorieen', stand.bezwaarCategorieen), lijst('Resultaat van een reactie op een bezwaar', stand.bezwaarResultaten), lijst('Soort bezwaar', stand.bezwaarSoorten), lijst('Extra dingen uit een gesprek', stand.extraSoorten), lijst('Materialen', stand.materialen), lijst('Demovormen', stand.demoVormen), lijst('Taakresultaten', stand.taakResultaten), lijst('Afspraakstatussen', stand.afspraakStatussen), lijst('Verzendstatussen', stand.verzendStatussen), lijst('Discovery-velden', stand.discoveryVelden), lijst('Stappen', stand.stappen));
  scherm.innerHTML = html.join('');
}
function splitsClient(u) {
  const m = { niet_opgenomen: ['niet_opgenomen', null], voicemail: ['voicemail', null], verkeerd_nummer: ['verkeerd_nummer', null], bedrijf_gestopt: ['gesprek_gevoerd', 'bedrijf_gestopt'], later_terugbellen: ['terugbelverzoek', null], geen_tijd: ['gesprek_gevoerd', 'geen_tijd'], geen_interesse: ['gesprek_gevoerd', 'geen_match'], nu_geen_behoefte: ['gesprek_gevoerd', 'nu_geen_behoefte'], geen_match: ['gesprek_gevoerd', 'geen_match'], eerst_informatie: ['gesprek_gevoerd', 'informatie_gevraagd'], mogelijk_interesse: ['gesprek_gevoerd', 'interesse'], goede_interesse: ['gesprek_gevoerd', 'interesse'], demo_aangeboden: ['gesprek_gevoerd', 'interesse'], demo_geweigerd: ['gesprek_gevoerd', 'interesse'], demo_ingepland: ['gesprek_gevoerd', 'demo_afgesproken'], account_gewenst: ['gesprek_gevoerd', 'account_gewenst'], niet_meer_benaderen: ['gesprek_gevoerd', 'geen_contact_meer'] };
  const s = m[u] || ['gesprek_gevoerd', null];
  return { contact: s[0], resultaat: s[1] };
}
function commercieelClient(f) {
  const m = { nieuwe_lead: 'nieuw', te_bellen: 'nieuw', eerste_poging: 'nieuw', niet_bereikt: 'nieuw', later_benaderen: 'nieuw', gesproken: 'in_gesprek', informatie_verstuurd: 'in_gesprek', follow_up_nodig: 'in_gesprek', gekwalificeerd: 'gekwalificeerd', demo_gepland: 'demo', demo_afgerond: 'demo', account_aangeboden: 'demo', account_aangemaakt: 'onboarding', onboarding: 'onboarding', eerste_project: 'onboarding', eerste_bestelling: 'actieve_partner', actieve_partner: 'actieve_partner', slapende_partner: 'actieve_partner' };
  return m[f] || null;
}

async function schermData() {
  const d = await api('/api/data');
  const html = [kop('beheer', 'Gegevens', 'Elke tabel in gewone woorden, met het aantal rijen voor dit bedrijf.', '', 'Oefendata en echte gegevens staan nooit door elkaar: welke stand je voor je hebt staat bovenaan elk scherm.')];
  html.push(`<div class="bd-tabel-wrap"><table class="bd-tabel"><thead><tr><th>wat</th><th>uitleg</th><th class="tal">rijen</th></tr></thead><tbody>${d.inventaris.map((i) => `<tr><td class="mono">${esc(i.naam)}</td><td>${esc(i.uitleg)}</td><td class="tal">${esc(i.aantal)}</td></tr>`).join('')}</tbody></table></div>`);
  html.push(`<p class="fr-note"><b>${d.modus === 'nep' ? 'Oefenstand.' : 'Live.'}</b> ${d.modus === 'nep' ? 'Dit zijn verzonnen gegevens op de mock-adapter; niets hiervan bestaat echt.' : 'Dit is de stand van de live database, gelezen op ' + esc(d.vandaag) + '.'} Het leadblad met alle kolommen komt uit belronde-cli --action leadblad. Opnames staan in ${esc(stand.opnamesMap || 'de opnamesmap')}.</p>`);
  scherm.innerHTML = html.join('');
}

/* ---------- gedrag ---------- */

function formData(form) {
  const uit = {};
  for (const [k, v] of new FormData(form).entries()) uit[k] = v;
  return uit;
}
function antwoordenUit(d) {
  const antwoorden = {};
  for (const [k, v] of Object.entries(d)) if (k.startsWith('a_') && v) antwoorden[k.slice(2)] = v;
  return antwoorden;
}

document.addEventListener('click', async (e) => {
  const t = e.target.closest('[data-sessie]');
  if (!t) return;
  const wat = t.dataset.sessie;
  if (wat === 'start') { sessie.gestart = Date.now(); render(); }
  else if (wat === 'opname-aan') { sessie.toestemming = true; if (await opnameStart()) render(); }
  else if (wat === 'opname-nee') { sessie.toestemming = false; sessie.opnameKlaar = true; render(); }
  else if (wat === 'opname-uit') { try { sessie.opnameRef = await opnameStop(sessie.item.lead.naam); sessie.opnameKlaar = true; melding(sessie.opnameRef ? 'Opname bewaard.' : 'Geen opname bewaard.'); } catch (err) { melding(err.message); } render(); }
  else if (wat === 'overslaan') { if (sessie.item) sessie.overslaan.push(sessie.item.leadId); await sessieLoslaten(); render(); }
  else if (wat === 'stop') { await sessieLoslaten(); sessie.leadIds = null; location.hash = '#/vandaag'; }
  else if (wat === 'opnieuw') { sessie.overslaan = []; sessie.leadIds = null; sessie.item = null; render(); }
  else if (wat === 'meer') { aantalNieuw += 25; sessie.item = null; render(); }
});

document.addEventListener('click', async (e) => {
  const t = e.target.closest('[data-rvenster],[data-besluit-status],[data-besluit-evalueren],[data-gezien],[data-uitloggen],[data-wachtwoord],[data-actief],[data-weergave],[data-levering],[data-werkfilter],[data-lead-traject],[data-beller],[data-uitklap],[data-vastzetten],[data-bevestig],[data-suggestie],[data-pagina],[data-analyseer],[data-toevoegen],[data-verwijder],[data-verwijder-rij],[data-reeks-stap],[data-tab],[data-venster],[data-herleid],[data-fase-invullen],[data-annuleer-demo],[data-niet-verschenen],[data-meer-nieuw],[data-nieuw-opnieuw],[data-tijdlijn],[data-gfilter],[data-filter-wis]');
  if (!t) return;
  if (t.dataset.analyseer) { t.disabled = true; t.textContent = 'AI kijkt'; await doe('/api/gesprek/analyseer', { interactionId: t.dataset.analyseer }, (r) => (r.status === 'klaar' ? 'AI-analyse klaar.' : `AI: ${r.status}, ${r.reden || ''}`)); return; }
  if (t.dataset.rvenster) { reviewVenster = t.dataset.rvenster; render(); return; }
  if (t.dataset.besluitStatus) { await doe('/api/besluit/status', { besluitId: t.dataset.besluitStatus, status: t.dataset.naar }, (r) => `Besluit ${r.status}.`); return; }
  if (t.dataset.besluitEvalueren) { const u = window.prompt('Wat leverde het op? (hielp het, of niet)') || ''; if (u) await doe('/api/besluit/status', { besluitId: t.dataset.besluitEvalueren, status: 'geevalueerd', uitkomst: u }, () => 'Besluit geevalueerd.'); return; }
  if (t.dataset.gezien) { await api('/api/werkwijze/gezien', { werkwijzeId: t.dataset.gezien, doorId: beller }); stand = await api(`/api/stand?beller=${encodeURIComponent(beller || '')}`); melding('Bekeken; deze melding komt niet terug.'); render(); return; }
  if (t.dataset.uitloggen) { await api('/api/uitloggen', {}); location.reload(); return; }
  if (t.dataset.wachtwoord) { const w = window.prompt('Nieuw wachtwoord (minstens acht tekens):') || ''; if (w) await doe('/api/gebruiker/wachtwoord', { gebruikerId: t.dataset.wachtwoord, wachtwoord: w }, () => 'Wachtwoord gezet; die sessies zijn uitgelogd.'); return; }
  if (t.dataset.actief) { await doe('/api/gebruiker/actief', { gebruikerId: t.dataset.actief, actief: t.dataset.naar === '1' }, () => 'Account bijgewerkt.'); return; }
  if (t.dataset.weergave) { weergave = t.dataset.weergave; try { localStorage.setItem('bd-weergave', weergave); } catch { /* geen opslag */ } if (stand.ik) api('/api/voorkeuren', { voorkeuren: { weergave } }).catch(() => {}); render(); return; }
  if (t.dataset.levering) { await doe('/api/levering/bevestigen', { orderId: t.dataset.levering, doorId: beller }, (r) => (r.taak ? `Levering bevestigd; servicetaak op ${r.taak.dueDate}.` : `Levering bevestigd. ${r.reden || ''}`)); return; }
  if (t.dataset.werkfilter) { werkFilter = t.dataset.werkfilter; schermVandaag(); return; }
  if (t.dataset.leadTraject !== undefined) { leadFilter.traject = t.dataset.leadTraject; leadFilter.pagina = 1; render(); return; }
  if (t.dataset.nieuwOpnieuw) { nieuwResultaat = null; render(); return; }
  if (t.dataset.beller) { beller = t.dataset.beller; try { localStorage.setItem('bd-beller', beller); } catch { /* geen opslag */ } await sessieLoslaten(); render(); return; }
  if (t.dataset.uitklap) { const el = document.getElementById(t.dataset.uitklap); if (el) el.hidden = !el.hidden; t.classList.toggle('aan', el && !el.hidden); return; }
  if (t.dataset.toevoegen) { const box = t.closest('form').querySelector(`[data-herhaal="${t.dataset.toevoegen}"]`); if (box) box.insertAdjacentHTML('beforeend', t.dataset.toevoegen === 'bezwaar' ? bezwaarBlok() : (t.dataset.toevoegen === 'probleem' ? probleemBlok() : extraBlok())); return; }
  if (t.dataset.verwijder) { const item = t.closest('.bd-herhaal-item'); if (item) item.remove(); return; }
  if (t.dataset.verwijderRij) { const rij = t.closest('tr'); if (rij) rij.remove(); return; }
  if (t.dataset.reeksStap) { const body = t.closest('form').querySelector('tbody'); body.insertAdjacentHTML('beforeend', reeksRij({ wachtdagen: 3, dagsoort: 'werkdagen', vanaf: 'vorige_stap', actie: 'call', reden: '' }, body.children.length, ['call', 'whatsapp', 'email', 'beoordelen'])); return; }
  if (t.dataset.vastzetten) { await doe('/api/dagselectie/vastzetten', { bellerId: beller, aantal: aantalNieuw }, (r) => `Lijst vastgezet: ${r.geschreven} nieuw.`); return; }
  if (t.dataset.bevestig) { await doe('/api/bevestig', { interactionId: t.dataset.bevestig }, () => 'Bevestigd.'); return; }
  if (t.dataset.suggestie) { await doe('/api/feedback/status', { id: t.dataset.suggestie, status: t.dataset.status }, () => `Status ${t.dataset.status}.`); return; }
  if (t.dataset.pagina) { leadFilter.pagina += Number(t.dataset.pagina); render(); return; }
  if (t.dataset.tab) { funnelTab = t.dataset.tab; render(); return; }
  if (t.dataset.venster) { weekVenster = t.dataset.venster; render(); return; }
  if (t.dataset.herleid) { if (herleidOpen.has(t.dataset.herleid)) herleidOpen.delete(t.dataset.herleid); else herleidOpen.add(t.dataset.herleid); render(); return; }
  if (t.dataset.tijdlijn) { tijdlijnFilter = t.dataset.tijdlijn; render(); return; }
  if (t.dataset.gfilter) { gesprekFilter[t.dataset.gfilter] = gesprekFilter[t.dataset.gfilter] === t.dataset.waarde && t.dataset.waarde !== '' ? '' : t.dataset.waarde; if (t.dataset.gfilter === 'provisional') { gesprekFilter.opnames = ''; gesprekFilter.afTeRonden = ''; } render(); return; }
  if (t.dataset.filterWis) { leadFilter[t.dataset.filterWis] = ''; leadFilter.pagina = 1; location.hash = '#/leads'; render(); return; }
  if (t.dataset.meerNieuw) { aantalNieuw += 25; render(); return; }
  if (t.dataset.faseInvullen) {
    const r = await api('/api/leads/fase-invullen', { toepassen: false });
    if (!r.aantal) { melding('Geen leads zonder status.'); return; }
    if (window.confirm(`${r.aantal} leads zonder hoofdstatus op nieuwe lead zetten? Dit is omkeerbaar per lead via het dossier.`)) await doe('/api/leads/fase-invullen', { toepassen: true }, (x) => `${x.gezet} leads op nieuwe lead gezet.`);
    return;
  }
  if (t.dataset.annuleerDemo) { const reden = window.prompt('Waarom wordt de demo geannuleerd?') || ''; await doe('/api/demo/annuleren', { afspraakId: t.dataset.annuleerDemo, reden, doorId: beller }, (r) => `Demo geannuleerd, taak ${r.taak ? `op ${r.taak.dueDate}` : 'geen'}.`); return; }
  if (t.dataset.nietVerschenen) { await doe('/api/demo/annuleren', { afspraakId: t.dataset.nietVerschenen, nietVerschenen: true, doorId: beller }, (r) => `Niet verschenen vastgelegd; ${r.taak ? `${TAAKWOORD[r.taak.taak] || r.taak.taak} op ${r.taak.dueDate}` : 'geen taak'}.`); }
});

document.addEventListener('change', async (e) => {
  const t = e.target;
  if (t.dataset.uitkomstForm) {
    /* Essentiele registratie, ook compact: bij een inhoudelijk gesprek zijn de drie vragen verplicht. */
    const f = t.closest('form');
    const regel = stand.regels[t.value] || {};
    const inhoudelijk = Boolean(t.value) && regel.bereikt && !regel.service && !['later_terugbellen', 'geen_tijd', 'niet_meer_benaderen'].includes(t.value);
    for (const naam of ['a_wil_wel', 'a_wil_niet', 'a_waarom']) { const veld = f && f.querySelector(`[name="${naam}"]`); if (veld) veld.required = inhoudelijk; }
  }
  if (t.name === 'b_categorie') {
    /* De reactie uit het script van deze stap voorstellen; wat de beller typt blijft leidend. */
    const form = t.closest('form');
    const script = stand.scripts[(form && form.dataset.stap) || 'eerste_contact'] || {};
    const r = (script.reacties || []).find((x) => x.bezwaarCategorie && x.bezwaarCategorie === t.value);
    const vak = t.closest('.bd-herhaal-item') && t.closest('.bd-herhaal-item').querySelector('input[name="b_reactie"]');
    if (r && vak && !vak.value) { vak.value = (r.zeg || []).find((z) => !/^(STOP|Niet blijven|Laat hem|Luister)/.test(z)) || ''; vak.placeholder = 'uit het script'; }
    return;
  }
  if (t.dataset.werkgebied !== undefined && t.tagName === 'SELECT') { werkgebied = t.value; try { localStorage.setItem('bd-werkgebied', werkgebied); } catch { /* geen opslag */ } render(); return; }
  if (t.dataset.scope) { scope = t.value; try { localStorage.setItem('bd-scope', scope); } catch { /* geen opslag */ } render(); return; }
  if (t.dataset.leadSorteer) { leadFilter.sorteer = t.value; leadFilter.pagina = 1; render(); return; }
  if (t.dataset.filter) { leadFilter[t.dataset.filter] = t.type === 'checkbox' ? (t.checked ? '1' : '') : t.value; leadFilter.pagina = 1; render(); return; }
  if (t.dataset.bfilter) { bezwaarFilter[t.dataset.bfilter] = t.value; render(); return; }
  if (t.dataset.fase) { if (t.value) await doe('/api/fase', { leadId: t.dataset.fase, fase: t.value }, (r) => `Hoofdstatus ${r.naam.replace(/_/g, ' ')}.`); return; }
  if (t.dataset.rolVan) { await doe('/api/gebruiker/rol', { gebruikerId: t.dataset.rolVan, rol: t.value }, () => 'Rol gezet.'); return; }
  if (t.dataset.taakToewijzen) { await doe('/api/taak/toewijzen', { taakId: t.dataset.taakToewijzen, assigneeId: t.value || null }, (r) => `Taak staat nu bij ${r.naam || 'niemand'}.`); return; }
  if (t.dataset.toewijzen) { await doe('/api/toewijzen', { leadId: t.dataset.toewijzen, bellerId: t.value || null }, () => 'Eigenaar gezet.'); return; }
  if (t.dataset.bezwaarResultaat) { await doe('/api/bezwaar/werkte', { id: t.dataset.bezwaarResultaat, resultaat: t.value }, () => 'Beoordeling bewaard.'); return; }
  if (t.dataset.uitkomstForm !== undefined) { const f = t.closest('form'); const demo = f.querySelector('.bd-demo-velden'); if (demo) demo.hidden = t.value !== 'demo_ingepland'; return; }
  if (t.dataset.template !== undefined) {
    const f = t.closest('form');
    const tekst = f.querySelector('[name="tekst"],[name="berichtTekst"]');
    const naam = (sessie.item && sessie.item.contactpersoon) || (sessie.item && sessie.item.lead && sessie.item.lead.naam) || '';
    if (tekst && t.value) tekst.value = templateTekst(t.value, { naam, contactpersoon: naam });
    const tm = stand.templates.find((x) => x.ref === t.value);
    const term = f.querySelector('[name="reactieTermijnDagen"]');
    if (tm && term) term.value = tm.reactieTermijnDagen;
    const mat = f.querySelector('[name="materiaal"]');
    if (tm && mat) mat.value = tm.materiaal;
  }
  if (t.name === 'kanaal' && t.closest('[data-bericht]')) {
    const f = t.closest('form');
    const sel = f.querySelector('[name="templateRef"]');
    if (sel) sel.outerHTML = templateKeuze(t.value, f.dataset.stap || 'eerste_contact');
  }
});

async function gesprekBody(f, d, leadId) {
  const { bezwaren, extras, problemen } = verzamelHerhaal(f);
  return {
    leadId, doorId: beller, uitkomst: d.uitkomst, problemen, samenvatting: samenvattingUit(d), opvolgDatum: d.opvolgDatum, demoDatum: d.demoDatum, demoTijd: d.demoTijd, demoVorm: d.demoVorm, demoDuur: d.demoDuur,
    duurSeconden: d.duurSeconden, bezwaren, extras, antwoorden: antwoordenUit(d), tags: d.tags, stap: f.dataset.stap, verzoekId: f.dataset.verzoek,
    kans: d.kansNaam ? { naam: d.kansNaam, geschatM2: d.kansM2, projectdatum: d.kansDatum } : undefined,
    opnameRef: d.opnameRef, toestemming: d.toestemming === '' || d.toestemming === undefined ? '' : d.toestemming === '1', interactionId: f.dataset.interaction || undefined,
    afhaakmoment: d.afhaakmoment || undefined,
    aangeslagenOp: [...f.querySelectorAll('[name="aangeslagenOp"]:checked')].map((x) => x.value),
    onboardingGedaan: [...f.querySelectorAll('[name="onboardingGedaan"]:checked')].map((x) => x.value),
    blokkade: d.blokkade || undefined,
  };
}

/* Een verplicht veld in een dichtgeklapt vak zou het opslaan stil tegenhouden: de browser kan
   niet focussen op wat hij niet kan tonen. Slaat de controle ergens op aan, dan klapt het vak
   eromheen open zodat je ziet wat er mist. */
document.addEventListener('invalid', (e) => {
  for (let d = e.target.closest('details'); d; d = d.parentElement ? d.parentElement.closest('details') : null) d.open = true;
}, true);

document.addEventListener('submit', async (e) => {
  const f = e.target;
  e.preventDefault();
  const d = formData(f);
  const knop = f.querySelector('button[type="submit"]');
  if (knop) knop.disabled = true;
  try {
    if (f.dataset.inloggen) {
      try {
        const r = await api('/api/inloggen', { email: d.email, wachtwoord: d.wachtwoord });
        melding(`Welkom, ${r.gebruiker.email}.`);
        location.reload();
      } catch (err) { schermInloggen(err.message); }
      return;
    }
    if (f.dataset.besluit) {
      await doe('/api/besluit', { probleem: d.probleem, wijziging: d.wijziging, gegevens: d.gegevens ? { bron: d.gegevens } : {}, verantwoordelijkeId: d.verantwoordelijkeId, ingangsdatum: d.ingangsdatum, evaluatiedatum: d.evaluatiedatum, doorId: beller }, (r) => `Besluit vastgelegd (${r.status}).`);
      return;
    }
    if (f.dataset.werkwijze) {
      const regels = (v) => String(v || '').split('\n').map((x) => x.trim()).filter(Boolean);
      const soort = f.dataset.werkwijze;
      const basis = soort === 'script' ? (stand.scripts[d.ref] || {}) : (stand.templates.find((t) => t.ref === d.ref) || {});
      const inhoud = soort === 'script'
        ? { ...basis, doel: d.doel || basis.doel, opening: regels(d.opening).length ? regels(d.opening) : basis.opening, afsluiting: regels(d.afsluiting).length ? regels(d.afsluiting) : basis.afsluiting }
        : { ...basis, tekst: d.tekst || basis.tekst, reactieTermijnDagen: d.reactieTermijnDagen === '' || d.reactieTermijnDagen === undefined ? basis.reactieTermijnDagen : Number(d.reactieTermijnDagen) };
      await doe('/api/werkwijze', {
        soort, ref: d.ref, inhoud, watVeranderd: d.watVeranderd, waarom: d.waarom, watAnders: d.watAnders,
        soortWijziging: d.soortWijziging, geldigVanaf: d.geldigVanaf, werkgebied: d.werkgebied || null, voorStappen: soort === 'script' ? [d.ref] : (basis.stap ? [basis.stap] : []), doorId: beller,
      }, (r) => `${r.soort === 'script' ? 'Script' : 'Template'} ${r.ref.replace(/_/g, ' ')}${r.werkgebied ? ` (${r.werkgebied})` : ''} staat op versie ${r.versie}${r.gemeld ? '; je collegas krijgen de melding' : ', zonder melding'}.`);
      return;
    }
    if (f.dataset.leadNieuw) {
      const r = await api('/api/lead/nieuw', {
        naam: d.naam, plaats: d.plaats, telefoon: d.telefoon, email: d.email, whatsapp: d.whatsapp,
        website: d.website, kvkNummer: d.kvkNummer, rechtsvorm: d.rechtsvorm, bron: d.bron, notities: d.notities,
        belOptIn: d.belOptIn === '1', werkgebied: d.werkgebied || werkgebied || null,
        contactNaam: d.contactNaam, contactRol: d.contactRol, bellerId: beller, erbij: d.erbij === '1',
      });
      nieuwResultaat = r;
      melding(r.melding);
      render();
      return;
    }
    if (f.dataset.gebruikerNieuw) {
      await doe('/api/gebruikers', { email: d.email, wachtwoord: d.wachtwoord, rol: d.rol, personId: d.personId || null }, (r) => `Account ${r.email} aangemaakt als ${r.rol}.`);
      return;
    }
    if (f.dataset.gesprek) {
      const body = await gesprekBody(f, d, f.dataset.gesprek);
      await doe('/api/gesprek', body, (r) => `${r.herhaald ? 'Stond al vast' : 'Gesprek vastgelegd'}${r.fase ? `, fase ${r.fase.replace(/_/g, ' ')}` : ''}${r.taken && r.taken.length ? `, ${TAAKWOORD[r.taken[0].taak] || r.taken[0].taak} op ${r.taken[0].dueDate}` : ''}${r.bezwaarIds && r.bezwaarIds.length ? `, ${r.bezwaarIds.length} bezwaren` : ''}${r.aiGestart ? ', AI kijkt naar de opname' : ''}.`);
    } else if (f.dataset.belsessie) {
      const leadId = f.dataset.belsessie;
      const l = sessie.item.lead;
      let opnameRef = sessie.opnameRef || undefined;
      try {
        if (sessie.opname) opnameRef = (await opnameStop(l.naam)) || undefined;
        const bestand = f.querySelector('[name="opnameBestand"]');
        if (!opnameRef && bestand && bestand.files && bestand.files[0]) opnameRef = (await uploadBestand(bestand.files[0], { lead: l.naam })).ref;
      } catch (err) { melding(`Opname niet bewaard: ${err.message}. Het gesprek wordt wel vastgelegd.`); }
      const { bezwaren, extras, problemen } = verzamelHerhaal(f);
      const duur = sessie.gestart ? Math.round((Date.now() - sessie.gestart) / 1000) : undefined;
      const r = await api('/api/gesprek', {
        leadId, doorId: beller, uitkomst: d.uitkomst, samenvatting: samenvattingUit(d), opvolgDatum: d.opvolgDatum, demoDatum: d.demoDatum, demoTijd: d.demoTijd, demoVorm: d.demoVorm, demoDuur: d.demoDuur, duurSeconden: duur,
        startedAt: sessie.gestart ? new Date(sessie.gestart).toISOString() : undefined, bezwaren, extras, problemen, opnameRef, toestemming: sessie.toestemming === undefined ? '' : sessie.toestemming, tags: d.tags, antwoorden: antwoordenUit(d),
        kans: d.kansNaam ? { naam: d.kansNaam, geschatM2: d.kansM2, projectdatum: d.kansDatum } : undefined, stap: f.dataset.stap, verzoekId: sessie.verzoekId,
        afhaakmoment: d.afhaakmoment || undefined, blokkade: d.blokkade || undefined,
        aangeslagenOp: [...f.querySelectorAll('[name="aangeslagenOp"]:checked')].map((x) => x.value),
        onboardingGedaan: [...f.querySelectorAll('[name="onboardingGedaan"]:checked')].map((x) => x.value),
      });
      let bericht = null;
      if (d.berichtKanaal) bericht = await api('/api/bericht', { leadId, doorId: beller, kanaal: d.berichtKanaal, templateRef: d.templateRef, tekst: d.berichtTekst, link: d.berichtLink, materiaal: (stand.templates.find((x) => x.ref === d.templateRef) || {}).materiaal || 'landingspagina', reactieVerwacht: true, reactieTermijnDagen: d.reactieTermijnDagen, stap: f.dataset.stap, verzoekId: `${sessie.verzoekId}-bericht` });
      melding(`${r.herhaald ? 'Stond al vast' : 'Vastgelegd'}${r.fase ? `, fase ${r.fase.replace(/_/g, ' ')}` : ''}${r.taken && r.taken.length ? `, ${TAAKWOORD[r.taken[0].taak] || r.taken[0].taak} op ${r.taken[0].dueDate}` : ''}${r.bezwaarIds && r.bezwaarIds.length ? `, ${r.bezwaarIds.length} bezwaren` : ''}${bericht ? `, bericht vastgelegd${bericht.taak ? `, nabellen ${bericht.taak.dueDate}` : ''}` : ''}${r.aiGestart ? ', AI kijkt naar de opname' : ''}.`);
      clearInterval(sessie.hartslag);
      sessie.item = null;
      render();
    } else if (f.dataset.bericht) {
      await doe('/api/bericht', { leadId: f.dataset.bericht, doorId: beller, kanaal: d.kanaal, templateRef: d.templateRef, materiaal: d.materiaal, tekst: d.tekst, link: d.link, verzendStatus: d.verzendStatus, reactieVerwacht: d.reactieVerwacht === '1', reactieTermijnDagen: d.reactieTermijnDagen, verzoekId: uuid() }, (r) => `${r.herhaald ? 'Stond al vast' : 'Bericht vastgelegd'}${r.fase ? `, fase ${r.fase.replace(/_/g, ' ')}` : ''}${r.taak ? `, nabellen op ${r.taak.dueDate} als er geen reactie komt` : ''}.`);
    } else if (f.dataset.reactie) {
      await doe('/api/reactie', { leadId: f.dataset.reactie, doorId: beller, kanaal: d.kanaal, tekst: d.tekst, volgende: d.volgendeTaak ? { taak: d.volgendeTaak, dueDate: d.volgendeDatum, reden: 'reactie ontvangen, opvolgen' } : null, verzoekId: uuid() }, (r) => `Reactie vastgelegd, ${r.berichten} bericht beantwoord, ${r.takenGesloten} opvolgtaken gestopt${r.taak ? `, ${TAAKWOORD[r.taak.taak] || r.taak.taak} op ${r.taak.dueDate}` : ''}.`);
    } else if (f.dataset.afronden) {
      await doe('/api/taak/afronden', { taakId: f.dataset.afronden, resultaat: d.resultaat, nieuweDatum: d.nieuweDatum, nieuweTijd: d.nieuweTijd, notitie: d.notitie, doorId: beller }, (r) => `Taak ${r.resultaat.replace(/_/g, ' ')}${r.volgende ? `, volgende: ${TAAKWOORD[r.volgende.taak] || r.volgende.taak} op ${r.volgende.dueDate}` : (r.reeksKlaar ? ', de reeks is afgelopen' : '')}.`);
    } else if (f.dataset.transcript) {
      await doe('/api/gesprek/analyseer', { interactionId: f.dataset.transcript, transcript: d.transcript }, (r) => (r.status === 'klaar' ? 'AI-analyse klaar.' : `AI: ${r.status}, ${r.reden || ''}`));
    } else if (f.dataset.demo) {
      await doe('/api/demo', { leadId: f.dataset.demo, doorId: beller, datum: d.datum, tijd: d.tijd, duurMinuten: d.duurMinuten, vorm: d.vorm, link: /^https?:/.test(d.link || '') ? d.link : undefined, locatie: /^https?:/.test(d.link || '') ? undefined : d.link, doel: d.doel, deelnemers: d.deelnemers, verantwoordelijkeId: d.verantwoordelijkeId, afspraakId: f.dataset.afspraak || undefined }, (r) => `${r.verplaatst ? 'Demo verplaatst' : 'Demo gepland'} naar ${r.dag} ${r.tijd}, fase ${r.fase.replace(/_/g, ' ')}.`);
    } else if (f.dataset.notitie) {
      await doe('/api/notitie', { leadId: f.dataset.notitie, notities: d.notities }, () => 'Notitie bewaard.');
    } else if (f.dataset.pauze) {
      await doe('/api/lead/pauze', { leadId: f.dataset.pauze, tot: d.tot }, (r) => (r.tot ? `Gepauzeerd tot ${r.tot}.` : 'Pauze opgeheven.'));
    } else if (f.dataset.kanalen) {
      const geen = [...f.querySelectorAll('[name="geen"]:checked')].map((x) => x.value);
      await doe('/api/lead/kanalen', { leadId: f.dataset.kanalen, geenContactVia: geen }, () => 'Kanalen bewaard.');
    } else if (f.dataset.reeks) {
      const stappen = [...f.querySelectorAll('tr.bd-reeks-stap')].map((tr) => { const v = (n) => (tr.querySelector(`[name="${n}"]`) || {}).value; return { wachtdagen: v('wachtdagen'), dagsoort: v('dagsoort'), actie: v('actie'), template: v('template'), uitvoerder: v('uitvoerder'), reden: v('reden') }; });
      await doe('/api/reeksen', { aanleiding: f.dataset.reeks, stappen, maxPogingen: d.maxPogingen, actief: d.actief === '1' }, (r) => `Reeks bewaard, versie ${r.versie}.`);
    } else if (f.dataset.periode) {
      location.hash = `#/funnel?van=${d.van}&tot=${d.tot}`;
    } else if (f.dataset.opnameUpload) {
      const bestand = f.querySelector('[name="bestand"]').files[0];
      const status = f.querySelector('.bd-upload-status');
      if (!bestand) throw new Error('kies een bestand');
      status.textContent = `Uploaden ${bestand.name} (${Math.round(bestand.size / 1024)} kB)...`;
      const params = { lead: f.dataset.opnameUpload, leadId: f.dataset.opnameUpload, toestemming: d.toestemming || '' };
      if (f.dataset.interaction) params.interactionId = f.dataset.interaction;
      else if (d.doel === 'nieuw') { params.nieuw = '1'; params.doorId = beller; } else params.interactionId = d.doel;
      try {
        const r = await uploadBestand(bestand, params);
        status.textContent = `Geupload en gekoppeld (${r.opnames} opname${r.opnames === 1 ? '' : 's'} bij dit gesprek)${r.nieuw ? '; rond het gesprek nu af' : ''}.`;
        melding('Opname gekoppeld.');
        render();
      } catch (err) {
        status.textContent = `Mislukt: ${err.message}. Probeer opnieuw.`;
        if (knop) knop.disabled = false;
      }
    } else if (f.dataset.demogedaan) {
      const { bezwaren, extras } = verzamelHerhaal(f);
      const onderdelen = [...f.querySelectorAll('tr[data-onderdeel]')].map((tr) => ({
        onderdeel: tr.dataset.onderdeel, getoond: tr.querySelector('[name=getoond]').checked, begrepen: tr.querySelector('[name=getoond]').checked ? tr.querySelector('[name=begrepen]').checked : null,
        relevantie: tr.querySelector('[name=relevantie]').value || null, gebruiksgemak: tr.querySelector('[name=gebruiksgemak]').value || null, vertrouwen: tr.querySelector('[name=vertrouwen]').value || null,
        reactie: tr.querySelector('[name=reactie]').value || null, bug: tr.querySelector('[name=bug]').value || null,
      })).filter((o) => o.getoond || o.reactie || o.bug);
      let opnameRef;
      const bestand = f.querySelector('[name="opnameBestand"]');
      if (bestand && bestand.files && bestand.files[0]) { try { opnameRef = (await uploadBestand(bestand.files[0], { lead: 'demo' })).ref; } catch (err) { melding(`Opname niet bewaard: ${err.message}.`); } }
      await doe('/api/demo-gedaan', { leadId: f.dataset.demogedaan, doorId: beller, taakId: f.dataset.taak, afspraakId: f.dataset.afspraak || undefined, uitkomst: d.uitkomst, samenvatting: d.samenvatting, koopkans: d.koopkans, antwoorden: antwoordenUit(d), bezwaren, extras, onderdelen, volgendeStap: d.volgendeStap, volgende: d.volgendeTaak ? { taak: d.volgendeTaak, dueDate: d.volgendeDatum || undefined, wie: d.volgendeWie, reden: d.volgendeStap || 'na de demo opvolgen' } : undefined, opnameRef, toestemming: d.toestemming === '' ? '' : d.toestemming === '1', verzoekId: f.dataset.verzoek },
        (r) => `Demo afgerond, fase ${r.fase.replace(/_/g, ' ')}, ${r.evaluaties} onderdelen gescoord${r.taken.length ? `, ${TAAKWOORD[r.taken[0].taak] || r.taken[0].taak} op ${r.taken[0].dueDate}` : ''}.`);
    }
  } catch (err) {
    melding(err.message);
  } finally {
    if (knop && document.body.contains(knop)) knop.disabled = false;
  }
});

/* Smal scherm: het menu is een balk bovenaan die opzij schuift (framr.css). Een dichtgeklapte
   groep zou daar zijn onderdelen verbergen zonder dat je de groepskop ziet, dus daar staat
   alles open en loopt het als een rij. */
const smalScherm = () => window.matchMedia('(max-width: 900px)').matches;

let navSmal = null;
window.addEventListener('resize', () => {
  const nu = smalScherm();
  if (nu === navSmal) return;
  navSmal = nu;
  tekenNav((location.hash.replace(/^#\/?/, '').split('?')[0].split('/')[0]) || 'vandaag');
});

function tekenNav(actief) {
  const smal = smalScherm();
  const tabsVan = (lijst) => lijst.map(([r, l]) => {
    const n = navTellers[r];
    return `<a class="fr-tab ${actief === r ? 'actief' : ''}" href="#/${r}"><span class="tick"></span><span class="lbl">${esc(l)}</span>${n ? `<span class="bd-navtal">${esc(n)}</span>` : ''}</a>`;
  }).join('');
  /* Breed: uitklapbare groepen onder elkaar. Smal: een rij die opzij schuift, met de groepsnaam
     als tussenkopje. Daar geen uitklappen, want wat dichtstaat is dan onvindbaar. */
  nav.innerHTML = smal
    ? GROEPEN.map(([groep, , lijst]) => `<span class="bd-navkop">${esc(groep)}</span>${tabsVan(lijst)}`).join('')
    : GROEPEN.map(([groep, waarvoor, lijst]) => {
      const open = lijst.some(([r]) => r === actief) || navOpen.includes(groep);
      return `<details class="bd-navgroep" ${open ? 'open' : ''} data-navgroep="${esc(groep)}"><summary><span class="naam">${esc(groep)}</span><span class="waarvoor">${esc(waarvoor)}</span></summary>${tabsVan(lijst)}</details>`;
    }).join('');
  const idx = Math.max(0, SCHERMEN.findIndex(([r]) => r === actief));
  document.getElementById('rail').style.height = `${Math.round(((idx + 1) / SCHERMEN.length) * 100)}%`;
}

/* Een groep open of dicht klappen; de keuze blijft bewaard voor de volgende keer. */
nav.addEventListener('toggle', (e) => {
  const d = e.target.closest('[data-navgroep]');
  if (!d || smalScherm()) return;
  const groep = d.dataset.navgroep;
  navOpen = d.open ? [...new Set([...navOpen, groep])] : navOpen.filter((g) => g !== groep);
  try { localStorage.setItem('bd-navopen', JSON.stringify(navOpen)); } catch { /* geen opslag, geen ramp */ }
}, true);

/* De voet van het menu: de stand (oefenstand of live) en de werkbalk: wie je bent, het
   werkgebied, de weergave en wiens werk je ziet. Een plek voor alle schermen (structuur A). */
function tekenZijvoet() {
  const b = stand.bellers.find((x) => x.id === beller);
  zijvoet.innerHTML = `<span class="naam">${esc(stand.modus === 'nep' ? 'Oefenstand' : (stand.modus === 'live-lezen' ? 'Live, lezen' : 'Live, schrijven'))}</span><span class="sub">${esc(stand.ik ? stand.ik.email : (b ? b.name : stand.company))}</span>${werkbalk()}`;
}

async function render() {
  const hash = location.hash.replace(/^#\/?/, '') || 'vandaag';
  const [padDeel, queryDeel] = hash.split('?');
  const params = new URLSearchParams(queryDeel || '');
  const [route, id] = padDeel.split('/');
  tekenNav(route === 'lead' ? 'leads' : route);
  tekenZijvoet();
  if (route !== 'nieuw') nieuwResultaat = null;
  if (route !== 'bellen' && sessie.item) { await sessieLoslaten(); }
  if (route === 'bellen' && params.get('lijst')) { const ids = params.get('lijst').split(',').filter(Boolean); if (JSON.stringify(ids) !== JSON.stringify(sessie.leadIds)) { await sessieLoslaten(); sessie.leadIds = ids; sessie.overslaan = []; } }
  try {
    if (route === 'vandaag') await schermVandaag();
    else if (route === 'bellen') await schermBellen(params);
    else if (route === 'funnel') await schermFunnel(params);
    else if (route === 'leads') await schermLeads(params);
    else if (route === 'nieuw') await schermNieuw();
    else if (route === 'lead' && id) await schermLead(id);
    else if (route === 'agenda') await schermAgenda(params);
    else if (route === 'opvolging') await schermOpvolging();
    else if (route === 'gesprekken') await schermGesprekken(params);
    else if (route === 'demos') await schermDemos();
    else if (route === 'bezwaren') await schermBezwaren();
    else if (route === 'partners') await schermPartners();
    else if (route === 'feedback') await schermFeedback();
    else if (route === 'week') await schermWeek();
    else if (route === 'weekreview') await schermWeekreview();
    else if (route === 'scripts') await schermScripts();
    else if (route === 'templates') await schermTemplates();
    else if (route === 'reeksen') await schermReeksen();
    else if (route === 'keuzelijsten') await schermKeuzelijsten();
    else if (route === 'gebruikers') await schermGebruikers();
    else if (route === 'data') await schermData();
    else { location.hash = '#/vandaag'; }
  } catch (e) {
    scherm.innerHTML = `${kop('fout', 'Dat lukte niet', esc(e.message))}`;
  }
  window.scrollTo(0, 0);
}

async function start() {
  try {
    stand = await api('/api/stand');
  } catch (e) {
    /* 401: er zijn accounts en we zijn niet ingelogd. */
    stand = { modus: 'onbekend', vandaag: '', schrijven: false, bellers: [] };
    schermInloggen(/log in/i.test(e.message) ? '' : e.message);
    document.addEventListener('submit', () => {}, { once: true });
    return;
  }
  try { const g = JSON.parse(localStorage.getItem('bd-navopen') || 'null'); if (Array.isArray(g)) navOpen = g; } catch { /* geen opslag, geen ramp */ }
  try { beller = localStorage.getItem('bd-beller'); scope = localStorage.getItem('bd-scope') || 'mijn'; weergave = localStorage.getItem('bd-weergave') === 'compact' ? 'compact' : 'begeleid'; werkgebied = localStorage.getItem('bd-werkgebied') || ''; } catch { beller = null; }
  /* Ingelogd: de persoon van het account is de beller, en zijn voorkeuren gaan voor. */
  if (stand.ik) {
    if (stand.ik.personId) beller = stand.ik.personId;
    const v = stand.ik.voorkeuren || {};
    if (v.weergave) weergave = v.weergave === 'compact' ? 'compact' : 'begeleid';
    if (v.scope) scope = v.scope;
  }
  if (!beller || !stand.bellers.some((b) => b.id === beller)) beller = (stand.bellers.find((b) => /myron/i.test(b.name)) || stand.bellers[0] || {}).id || null;
  if (!['mijn', 'iedereen'].includes(scope) && !stand.bellers.some((b) => b.id === scope)) scope = 'mijn';
  /* De meldingen zijn per persoon; nu we weten wie we zijn halen we de stand opnieuw. */
  if (!stand.ik && beller) { try { stand = await api(`/api/stand?beller=${encodeURIComponent(beller)}`); } catch { /* de eerste stand blijft staan */ } }
  tekenZijvoet();
  document.title = 'Framr.One Sales';
  window.addEventListener('hashchange', render);
  window.addEventListener('beforeunload', () => { if (sessie.item) navigator.sendBeacon && navigator.sendBeacon('/api/sessie/vrijgeven', new Blob([JSON.stringify({ leadId: sessie.item.leadId, bellerId: beller })], { type: 'application/json' })); });
  render();
}

start().catch((e) => { scherm.innerHTML = `<p class="fr-formfout">${esc(e.message)}</p>`; });
