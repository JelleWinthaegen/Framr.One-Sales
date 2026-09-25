/*
  Jarvis - sales-gebruikers: de accounts, rollen en rechten van Framr.One Sales.

  Aanvulling van Jelle (15-09-2026, onderdeel 7): iedere medewerker een eigen inlog, een
  overzichtelijk rollenmodel (beheerder, sales, service) dat uitbreidbaar is, rechten die de
  server afdwingt en niet alleen knoppen verbergt, en zichtbaar wie wat toevoegde of afrondde.

  Het wachtwoord staat als scrypt-hash met een eigen salt (node:crypto), nooit leesbaar. De
  sessie is een cookie die alleen in het geheugen van de dashboard-server leeft; een herstart
  logt iedereen uit, en dat is bij een lokale server precies goed. De persoon in het relatieweb
  (people) blijft de identiteit op contactmomenten en taken; het account is de deur.

  Stijl: blokcommentaar, geen lange streepjes en geen emoji, conform de projectafspraken.
*/

import { scryptSync, randomBytes, timingSafeEqual, randomUUID } from 'node:crypto';

export const ROLLEN = ['beheerder', 'sales', 'service'];

/* De rechten die de server toetst, met wat ze openzetten. */
export const RECHTEN = {
  sales: 'leads benaderen: gesprekken, berichten, demo\'s, onboarding',
  service: 'servicetaken en servicegesprekken, leveringen bevestigen',
  rapportages: 'funnel, weekrapport, weekreview, bezwaren, demo\'s, feedback, partners',
  omzet: 'de bedragen in de rapportages',
  werkwijze_beheer: 'scripts, templates, reeksen en keuzelijsten aanpassen',
  gebruikersbeheer: 'accounts aanmaken, rollen en wachtwoorden',
  alles_zien: 'het werk van iedereen zien, ook zonder rapportagerecht',
};

/* Wat een rol standaard mag; rechten op het account voegen toe (recht) of nemen weg (-recht). */
export const ROL_RECHTEN = {
  beheerder: Object.keys(RECHTEN),
  sales: ['sales', 'rapportages', 'alles_zien'],
  service: ['service', 'rapportages', 'alles_zien'],
};

export function rechtenVan(gebruiker) {
  if (!gebruiker) return new Set();
  const uit = new Set(ROL_RECHTEN[gebruiker.rol] || []);
  for (const r of gebruiker.rechten || []) {
    const s = String(r);
    if (s.startsWith('-')) uit.delete(s.slice(1));
    else if (RECHTEN[s]) uit.add(s);
  }
  return uit;
}

export function heeftRecht(gebruiker, recht) {
  return rechtenVan(gebruiker).has(recht);
}

/* Wachtwoorden: scrypt met een salt van zestien bytes; vergelijken in constante tijd. */
export function hashWachtwoord(wachtwoord, salt = randomBytes(16).toString('hex')) {
  if (!wachtwoord || String(wachtwoord).length < 8) throw new Error('een wachtwoord heeft minstens acht tekens.');
  const hash = scryptSync(String(wachtwoord), salt, 64).toString('hex');
  return { hash, salt };
}

export function controleerWachtwoord(wachtwoord, hash, salt) {
  if (!wachtwoord || !hash || !salt) return false;
  const proef = scryptSync(String(wachtwoord), salt, 64);
  const echt = Buffer.from(hash, 'hex');
  return proef.length === echt.length && timingSafeEqual(proef, echt);
}

/*
  De sessies: in het geheugen van de server, per token de gebruiker en wanneer hij binnenkwam.
  Een sessie verloopt na twaalf uur zonder gebruik.
*/
export function maakSessies({ maxUur = 12 } = {}) {
  const sessies = new Map();
  const nu = () => Date.now();
  return {
    start(gebruiker) {
      const token = randomUUID() + randomBytes(8).toString('hex');
      sessies.set(token, { gebruikerId: gebruiker.id, laatst: nu() });
      return token;
    },
    wie(token) {
      const s = token ? sessies.get(token) : null;
      if (!s) return null;
      if (nu() - s.laatst > maxUur * 3600000) { sessies.delete(token); return null; }
      s.laatst = nu();
      return s.gebruikerId;
    },
    stop(token) { sessies.delete(token); },
    stopAlleVan(gebruikerId) { for (const [t, s] of sessies) if (s.gebruikerId === gebruikerId) sessies.delete(t); },
    aantal() { return sessies.size; },
  };
}

/* Een account aanmaken: e-mail uniek per bedrijf, wachtwoord gehasht, rol geldig. */
export async function maakGebruiker(adapter, { companyId, email, wachtwoord, rol = 'sales', personId = null, werkgebieden = [], rechten = [], voorkeuren = {} } = {}) {
  if (!companyId || !email) throw new Error('maakGebruiker vereist companyId en email.');
  if (!ROLLEN.includes(rol)) throw new Error(`rol '${rol}' is onbekend. Kies ${ROLLEN.join(', ')}.`);
  const adres = String(email).trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(adres)) throw new Error('geen geldig e-mailadres.');
  const bestaand = await adapter.findSalesGebruikerByEmail(companyId, adres);
  if (bestaand) throw new Error(`er bestaat al een account met ${adres}.`);
  const { hash, salt } = hashWachtwoord(wachtwoord);
  const r = await adapter.insertSalesGebruiker({ company_id: companyId, person_id: personId, email: adres, wachtwoord_hash: hash, wachtwoord_salt: salt, rol, werkgebieden, rechten, voorkeuren, actief: true });
  return { id: r.id, email: adres, rol };
}

/* Inloggen: e-mail plus wachtwoord, alleen een actief account; geeft de gebruiker zonder geheimen. */
export async function login(adapter, { companyId, email, wachtwoord, nu = null } = {}) {
  const g = await adapter.findSalesGebruikerByEmail(companyId, String(email || '').trim().toLowerCase());
  if (!g || g.actief === false || !controleerWachtwoord(wachtwoord, g.wachtwoord_hash, g.wachtwoord_salt)) return null;
  await adapter.updateSalesGebruiker(g.id, { laatste_inlog: nu || new Date().toISOString() });
  return zonderGeheimen(g);
}

export function zonderGeheimen(g) {
  if (!g) return null;
  const { wachtwoord_hash, wachtwoord_salt, ...rest } = g;
  return { ...rest, rechtenActief: [...rechtenVan(g)] };
}

export async function wijzigWachtwoord(adapter, { gebruikerId, wachtwoord } = {}) {
  const { hash, salt } = hashWachtwoord(wachtwoord);
  await adapter.updateSalesGebruiker(gebruikerId, { wachtwoord_hash: hash, wachtwoord_salt: salt });
  return { ok: true };
}
