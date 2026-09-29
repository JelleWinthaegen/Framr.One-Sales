/*
  node:http in de browser. De browser is hier zelf de server: start.mjs vangt elke fetch naar
  /api/ af en geeft hem aan dezelfde afhandelen-functie die de Node-server gebruikt.
  createServer wordt daarom nooit aangeroepen; gebeurt het toch, dan zeggen we waarom het niet kan.
*/

export function createServer() {
  throw new Error('createServer bestaat niet in de browser; de oefenstand draait de motor in het tabblad zelf (zie shim/start.mjs).');
}

export default { createServer };
