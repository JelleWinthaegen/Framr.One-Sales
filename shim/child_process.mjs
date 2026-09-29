/*
  node:child_process in de browser. Alleen de live-stand start een los proces (het opzoeken van
  de database-url); de oefenstand komt daar nooit langs. Wordt het toch aangeroepen, dan is er
  per ongeluk een live-pad geraakt en moet dat luid mislukken in plaats van stil.
*/

export function execFileSync() {
  throw new Error('execFileSync bestaat niet in de browser; dit is de oefenstand, die nooit een database opzoekt.');
}

export default { execFileSync };
