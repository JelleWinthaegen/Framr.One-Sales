/*
  De start van de oefenstand in de browser.

  De Node-server (crm/dashboard-server.mjs) bestaat uit twee delen: maakApp, dat elke
  /api-route afhandelt, en maakServer, dat daar een http-server omheen zet. Hier laten we
  dat tweede deel weg. We bouwen de bron (de mock-adapter, gevuld met verzonnen gegevens) en
  de app, en vangen daarna elke fetch naar /api/ af: die gaat rechtstreeks naar
  app.afhandelen, dezelfde functie die de server aanroept. Het scherm (dashboard.js) merkt
  het verschil niet.

  Alles leeft in het tabblad. Herladen begint opnieuw met dezelfde verzonnen gegevens; er is
  geen account, geen database en geen bestand.

  Wat bewust niet werkt: opnames afspelen en uploaden (dat zijn bytes, en er is geen schijf)
  en de AI-analyse (geen sleutel in de browser, en die hoort daar ook niet).
*/

/* Een minimale process, want de motor leest env en argv bij het laden. Lege argv betekent:
   geen commandoregel, dus de server start zichzelf niet. */
globalThis.process = globalThis.process || {
  env: {}, argv: [], execPath: '', exitCode: 0, platform: 'browser',
  cwd: () => '/',
  stdout: { write: (t) => console.log(String(t).trim()) },
  stderr: { write: (t) => console.error(String(t).trim()) },
};

/* Een minimale Buffer, op Uint8Array. De motor gebruikt hem op drie plekken die de oefenstand
   raakt: de proefopname bij het vullen (Buffer.from van een tekst), de vingerafdruk van een
   document en het lezen van een hash. Meer dan from, concat en isBuffer is daar niet voor nodig. */
if (!globalThis.Buffer) {
  const vanTekst = (t) => new TextEncoder().encode(t);
  const vanHex = (h) => Uint8Array.from((h.match(/.{1,2}/g) || []).map((x) => parseInt(x, 16)));
  const maak = (bytes) => {
    const b = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes);
    b.toString = function (enc = 'utf8') {
      if (enc === 'hex') return [...this].map((x) => x.toString(16).padStart(2, '0')).join('');
      return new TextDecoder().decode(this);
    };
    return b;
  };
  globalThis.Buffer = {
    from(x, enc) {
      if (typeof x === 'string') return maak(enc === 'hex' ? vanHex(x) : vanTekst(x));
      if (x instanceof ArrayBuffer) return maak(new Uint8Array(x));
      return maak(x);
    },
    isBuffer(x) { return x instanceof Uint8Array; },
    concat(delen) {
      const n = delen.reduce((s, d) => s + d.length, 0);
      const uit = new Uint8Array(n);
      let i = 0;
      for (const d of delen) { uit.set(d, i); i += d.length; }
      return maak(uit);
    },
  };
}

const { maakBron, maakApp } = await import('../motor/crm/dashboard-server.mjs?v=5dd6073');

const bron = await maakBron({ nep: true, env: process.env });
const app = maakApp(bron, { env: process.env });

const echteFetch = globalThis.fetch.bind(globalThis);
const JSON_KOPPEN = { 'content-type': 'application/json; charset=utf-8' };

globalThis.fetch = async function (invoer, init = {}) {
  const url = new URL(typeof invoer === 'string' ? invoer : invoer.url, location.href);
  if (!url.pathname.startsWith('/api/')) return echteFetch(invoer, init);
  const methode = (init.method || 'GET').toUpperCase();
  let body = null;
  if (methode === 'POST' && init.body != null) {
    if (typeof init.body === 'string') { try { body = JSON.parse(init.body); } catch { body = init.body; } }
    else body = init.body;
  }
  try {
    const uit = await app.afhandelen(methode, url.pathname, url.searchParams, body, { gebruiker: null, token: null });
    return new Response(JSON.stringify(uit ?? {}), { status: 200, headers: JSON_KOPPEN });
  } catch (e) {
    const status = e && e.status ? e.status : 500;
    return new Response(JSON.stringify({ fout: e && e.message ? e.message : String(e) }), { status, headers: JSON_KOPPEN });
  }
};

await import('../dashboard.js?v=5dd6073');
