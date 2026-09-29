/*
  node:os in de browser. Twee mappen die alleen als naam bestaan: de oefenstand schrijft
  geen enkel bestand weg.
*/

export function tmpdir() { return '/tmp'; }
export function homedir() { return '/home'; }
export default { tmpdir, homedir };
