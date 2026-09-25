/*
  node:url in de browser.

  De motor roept fileURLToPath alleen aan op import.meta.url, om te weten waar een module
  staat. In de browser is dat een http-adres; we geven het pad eruit terug, zodat de
  berekeningen eromheen (dirname, join) gewoon werken.
*/

export function fileURLToPath(u) {
  const s = String(u);
  try { return new URL(s).pathname; } catch { return s.replace(/^file:\/\//, ''); }
}

export function pathToFileURL(pad) {
  return new URL(`file://${String(pad).startsWith('/') ? '' : '/'}${pad}`);
}

export default { fileURLToPath, pathToFileURL };
