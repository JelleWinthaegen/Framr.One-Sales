/*
  Jarvis doc-intake dry-run - deduplicatiebasis.

  Markeert mogelijke dubbelen over kandidaten heen. Gooit nooit automatisch iets weg: bij
  twijfel komt het als possible_duplicate in het reviewrapport. De sleutels komen uit
  docs/wbw-classificatie-en-routing.md (factuurnummer plus afzender plus bedrag; zwakkere
  match bij ontbrekende velden).

  Voor de dry-run leiden we de velden licht af uit onderwerp en snippet (fake data). Echte
  extractie komt later.

  Stijl: blokcommentaar, geen lange streepjes en geen emoji, conform de projectafspraken.
*/

/* Pakt een mogelijk documentnummer uit de tekst. Null als niets gevonden. */
export function extractDocumentNumber(text) {
  const t = (text || '').toLowerCase();
  const labelled = t.match(/factuur(?:nummer)?\s*[:#]?\s*([a-z0-9][a-z0-9-]{3,})/);
  if (labelled) return labelled[1];
  const generic = t.match(/\b(20\d{2}[-/]?\d{3,})\b/);
  return generic ? generic[1].replace(/\//g, '-') : null;
}

/* Pakt een mogelijk bedrag uit de tekst, genormaliseerd naar een string. Null als niets. */
export function extractAmount(text) {
  const t = (text || '').toLowerCase();
  const m = t.match(/(?:€|eur)\s?(\d{1,3}(?:[.\s]\d{3})*(?:[.,]\d{2})?)/) ||
    t.match(/\b(\d{1,6}[.,]\d{2})\b/);
  if (!m) return null;
  return m[1].replace(/\s/g, '').replace(/\./g, '').replace(',', '.');
}

function dateOnly(iso) {
  return (iso || '').slice(0, 10);
}

function firstAttachmentName(message) {
  const a = (message.attachments || [])[0];
  return a ? (a.filename || '').toLowerCase() : null;
}

/*
  Bouwt een dedup-signatuur per kandidaat. text is onderwerp plus snippet.
*/
function signatureFor(message) {
  const text = `${message.subject || ''} ${message.snippet || ''}`;
  return {
    docNumber: extractDocumentNumber(text),
    amount: extractAmount(text),
    from: (message.from || '').toLowerCase() || null,
    date: dateOnly(message.receivedAt),
    attachment: firstAttachmentName(message),
  };
}

function strongMatch(a, b) {
  return Boolean(a.docNumber && a.from && a.amount) &&
    a.docNumber === b.docNumber && a.from === b.from && a.amount === b.amount;
}

function weakMatch(a, b) {
  /* Zwakke match: zonder zeker documentnummer, op afzender plus datum plus bedrag plus bijlage. */
  return Boolean(a.from && a.date && (a.amount || a.attachment)) &&
    a.from === b.from && a.date === b.date &&
    a.amount === b.amount && a.attachment === b.attachment;
}

/*
  Annoteert elke kandidaat met een dedup-status. Eerste voorkomen is 'original'; latere
  matches zijn 'duplicate' (sterk) of 'possible_duplicate' (zwak), met een verwijzing naar
  het origineel via sourceMessageRef. Niets wordt verwijderd.
*/
export function annotateDuplicates(candidates) {
  const seen = [];
  return candidates.map((item) => {
    const sig = signatureFor(item.message);
    let dedup = { status: 'original', matchType: null, matchedRef: null };

    for (const prev of seen) {
      if (strongMatch(sig, prev.sig)) {
        dedup = { status: 'duplicate', matchType: 'strong', matchedRef: prev.ref };
        break;
      }
      if (weakMatch(sig, prev.sig)) {
        dedup = { status: 'possible_duplicate', matchType: 'weak', matchedRef: prev.ref };
        break;
      }
    }

    seen.push({ sig, ref: item.message.sourceMessageRef });
    return { ...item, dedup };
  });
}
