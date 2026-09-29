/*
  node:path in de browser. Puur rekenen met tekst, geen schijf.

  De motor gebruikt paden alleen om namen aan elkaar te plakken (de map voor de opnames, de
  plek van een migration). In de gepubliceerde oefenstand komt er nooit een bestand aan te
  pas; de paden blijven tekenreeksen die nergens heen wijzen.
*/

export function normalizeDelen(pad) {
  const absoluut = pad.startsWith('/');
  const uit = [];
  for (const deel of pad.split('/')) {
    if (!deel || deel === '.') continue;
    if (deel === '..') { if (uit.length && uit[uit.length - 1] !== '..') uit.pop(); else if (!absoluut) uit.push('..'); continue; }
    uit.push(deel);
  }
  return (absoluut ? '/' : '') + uit.join('/');
}

export function join(...delen) {
  const samen = delen.filter((d) => d !== undefined && d !== null && d !== '').join('/');
  return normalizeDelen(samen) || '.';
}

export function resolve(...delen) {
  let uit = '';
  for (const deel of delen) uit = deel.startsWith('/') ? deel : `${uit}/${deel}`;
  return normalizeDelen(uit) || '/';
}

export function dirname(pad) {
  const p = String(pad).replace(/\/+$/, '');
  const i = p.lastIndexOf('/');
  if (i === -1) return '.';
  if (i === 0) return '/';
  return p.slice(0, i);
}

export function basename(pad, ext) {
  const p = String(pad).replace(/\/+$/, '');
  const naam = p.slice(p.lastIndexOf('/') + 1);
  return ext && naam.endsWith(ext) ? naam.slice(0, -ext.length) : naam;
}

export function extname(pad) {
  const naam = basename(pad);
  const i = naam.lastIndexOf('.');
  return i <= 0 ? '' : naam.slice(i);
}

export function isAbsolute(pad) { return String(pad).startsWith('/'); }

export const sep = '/';
export default { join, resolve, dirname, basename, extname, isAbsolute, sep };
