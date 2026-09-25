/*
  node:fs in de browser. Er is geen schijf.

  De oefenstand maakt bij het vullen een map voor opnames aan en zet daar een verwijzing
  naar; die twee (mkdirSync, writeFileSync) doen hier niets, want de database krijgt toch
  alleen de verwijzing en de browser kan geen bestand neerzetten. Lezen kan nooit kloppen
  zonder schijf, dus readFileSync en de rest weigeren met een duidelijke reden; existsSync
  zegt eerlijk dat er niets is.
*/

const geen = (naam) => () => { throw new Error(`${naam} bestaat niet in de browser: de oefenstand heeft geen schijf.`); };

export function mkdirSync() { return undefined; }
export function writeFileSync() { return undefined; }
export function existsSync() { return false; }
export const readFileSync = geen('readFileSync');
export const statSync = geen('statSync');
export const createReadStream = geen('createReadStream');

export default { mkdirSync, writeFileSync, existsSync, readFileSync, statSync, createReadStream };
