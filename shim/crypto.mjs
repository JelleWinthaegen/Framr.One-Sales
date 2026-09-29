/*
  node:crypto in de browser, op WebCrypto.

  randomUUID en randomBytes komen van de browser zelf en zijn even goed als in Node. scryptSync
  hoort bij wachtwoorden; de gepubliceerde oefenstand heeft geen accounts (zonder account staat
  het dashboard open), dus die weigert. createHash bestaat in WebCrypto alleen asynchroon; de
  motor wil hem synchroon, voor een vingerafdruk van een document. Hieronder staat daarom een
  eenvoudige, deterministische vingerafdruk (FNV-1a, twee keer) die NIET cryptografisch is en
  alleen in de oefenstand gebruikt wordt, waar niets bewaard wordt en niets echt is.
*/

export function randomUUID() { return crypto.randomUUID(); }

export function randomBytes(n) {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  b.toString = function (enc = 'hex') {
    if (enc === 'hex') return [...this].map((x) => x.toString(16).padStart(2, '0')).join('');
    if (enc === 'base64') return btoa(String.fromCharCode(...this));
    return new TextDecoder().decode(this);
  };
  return b;
}

export function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let v = 0;
  for (let i = 0; i < a.length; i += 1) v |= a[i] ^ b[i];
  return v === 0;
}

export function scryptSync() {
  throw new Error('scryptSync bestaat niet in de browser: de oefenstand kent geen accounts en geen wachtwoorden.');
}

function fnv1a(tekst, zaad) {
  let h = zaad >>> 0;
  for (let i = 0; i < tekst.length; i += 1) { h ^= tekst.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h;
}

export function createHash() {
  let buffer = '';
  const hash = {
    update(deel) { buffer += typeof deel === 'string' ? deel : new TextDecoder().decode(deel); return hash; },
    digest(enc = 'hex') {
      const delen = [fnv1a(buffer, 0x811c9dc5), fnv1a(buffer, 0x01000193), fnv1a(`${buffer}1`, 0x811c9dc5), fnv1a(`${buffer}2`, 0x811c9dc5)];
      const hex = delen.map((x) => x.toString(16).padStart(8, '0')).join('');
      return enc === 'hex' ? hex : hex;
    },
  };
  return hash;
}

export default { randomUUID, randomBytes, timingSafeEqual, scryptSync, createHash };
