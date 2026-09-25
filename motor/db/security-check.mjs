#!/usr/bin/env node
/*
  Jarvis beveiligingscheck (blok 3 van het totaalbuild-plan).

  Controleert voor de go-live (en daarna periodiek) vier dingen:
    1. RLS aan: alle bestaande applicatietabellen hebben row level security aanstaan.
    2. Anon dicht: er bestaan geen policies (RLS zonder policies betekent dat de publieke
       PostgREST/anon-API niets prijsgeeft).
    3. Geen secrets in git: geen Anthropic-keys, JWT-achtige Supabase-keys of getrackte
       .env-bestanden in de repository.
    4. De gecontroleerde database: toont host en project-ref; met JARVIS_EXPECTED_PROJECT_REF
       wordt afgedwongen dat de URL bij het verwachte project hoort.

  Read-only: de databasechecks draaien in een expliciete read-only transactie en er staat geen
  DML in dit script. De check mag daarom ook veilig tegen de live database draaien.

  Welke database wordt gecheckt (in volgorde):
    JARVIS_CHECK_DB_URL, anders JARVIS_TEST_DB_URL (als JARVIS_ENV=test), anders JARVIS_DB_URL.

  Gebruik:
    npm run security:check                       (test-omgeving)
    JARVIS_CHECK_DB_URL=... npm run security:check   (expliciete keuze, bijvoorbeeld live)

  Stijl: blokcommentaar, geen lange streepjes en geen emoji, conform de projectafspraken.
*/

import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { EXPECTED_TABLES } from './verify-schema.mjs?v=5dd6073';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..', '..');

/*
  Bestanden die de secretscan bewust overslaat, omdat ze per definitie de zoekpatronen zelf
  bevatten en anders vals alarm geven:
    - db/security-check.mjs: hier staan de patronen (sk-ant-, eyJhbGciOi) als definitie in de code.
    - test/security-and-live-apply.test.mjs: testfixtures met verzonnen connectiestrings (bewust
      geen placeholder-woorden) die juist controleren dat de checker echt en nep kan scheiden.
  De scan blijft overal elders wel op echte secrets letten. Paden zijn relatief aan REPO_ROOT.
*/
const SECRET_SCAN_PATHSPEC = [
  '.',
  ':(exclude)scripts/doc-intake-dry-run/db/security-check.mjs',
  ':(exclude)scripts/doc-intake-dry-run/test/security-and-live-apply.test.mjs',
];

export function pickUrl(env) {
  if (env.JARVIS_CHECK_DB_URL) return { url: env.JARVIS_CHECK_DB_URL, label: 'JARVIS_CHECK_DB_URL (expliciet)' };
  if (env.JARVIS_ENV === 'test' && env.JARVIS_TEST_DB_URL) return { url: env.JARVIS_TEST_DB_URL, label: 'JARVIS_TEST_DB_URL (testdatabase)' };
  if (env.JARVIS_DB_URL) return { url: env.JARVIS_DB_URL, label: 'JARVIS_DB_URL (live)' };
  return null;
}

export function hostAndRef(url) {
  const m = String(url).match(/@([^:/]+)/);
  const host = m ? m[1] : 'onbekend';
  const refMatch = String(url).match(/postgres(?:ql)?:\/\/postgres\.([a-z0-9]+):/);
  return { host, projectRef: refMatch ? refMatch[1] : null };
}

/*
  Databasechecks: RLS-status per tabel en de aanwezige policies, binnen een read-only transactie.
*/
async function checkDatabase(url) {
  const pg = (await import('pg')).default;
  const isLocal = /(@|\/\/)(localhost|127\.0\.0\.1)/.test(url);
  const client = new pg.Client({ connectionString: url, ssl: isLocal ? false : { rejectUnauthorized: false } });
  await client.connect();
  try {
    await client.query('begin read only');
    const rlsRes = await client.query(
      "select tablename, rowsecurity from pg_tables where schemaname = 'public'",
    );
    const policiesRes = await client.query(
      "select tablename, policyname, roles from pg_policies where schemaname = 'public'",
    );
    await client.query('rollback');
    return { rls: rlsRes.rows, policies: policiesRes.rows };
  } finally {
    await client.end();
  }
}

/*
  Filtert placeholder-regels weg bij de connectiestring-check: documentatie en testfixtures
  gebruiken bewust neppe waarden (USER:PASS, WACHTWOORD, :pw@). Een echte connectiestring met
  een echt wachtwoord blijft wel hangen.
*/
export function isPlaceholderLine(line) {
  return /USER|PASS|WACHTWOORD|HOST|:pw@|<|\.\.\./.test(line);
}

/* Git-checks: verdachte patronen in getrackte bestanden, en getrackte .env-bestanden. */
function checkGit() {
  const findings = [];
  const filePatterns = [
    { name: 'Anthropic API key', regex: 'sk-ant-' },
    { name: 'Supabase JWT key', regex: 'eyJhbGciOi' },
  ];
  for (const p of filePatterns) {
    try {
      const out = execFileSync('git', ['-C', REPO_ROOT, 'grep', '-I', '-l', '-E', p.regex, '--', ...SECRET_SCAN_PATHSPEC], { encoding: 'utf8' });
      for (const file of out.trim().split('\n').filter(Boolean)) {
        findings.push(`${p.name} patroon in getrackt bestand: ${file}`);
      }
    } catch {
      /* git grep exit 1 betekent: geen match. Dat is wat we willen. */
    }
  }
  try {
    const out = execFileSync('git', ['-C', REPO_ROOT, 'grep', '-I', '-n', '-E', 'postgres(ql)?://[^ :]+:[^ @*]+@', '--', ...SECRET_SCAN_PATHSPEC], { encoding: 'utf8' });
    for (const line of out.trim().split('\n').filter(Boolean)) {
      if (!isPlaceholderLine(line)) findings.push(`connectiestring met wachtwoord in git: ${line.split(':').slice(0, 2).join(':')}`);
    }
  } catch {
    /* geen matches */
  }
  let trackedEnvFiles = [];
  try {
    const out = execFileSync('git', ['-C', REPO_ROOT, 'ls-files', '*.env', '*.env.*', '.env*', '**/.env*'], { encoding: 'utf8' });
    trackedEnvFiles = out.trim().split('\n').filter(Boolean);
  } catch {
    /* geen matches */
  }
  for (const f of trackedEnvFiles) {
    /* .example-bestanden zijn bewust getrackte placeholders. */
    if (!f.endsWith('.example')) findings.push(`.env-bestand getrackt in git: ${f}`);
  }
  return findings;
}

async function main() {
  const env = process.env;
  const picked = pickUrl(env);
  const checks = [];

  if (!picked) {
    checks.push({ name: 'database geconfigureerd', ok: false, detail: 'geen JARVIS_CHECK_DB_URL, JARVIS_TEST_DB_URL of JARVIS_DB_URL gezet' });
  } else {
    const { host, projectRef } = hostAndRef(picked.url);
    checks.push({ name: 'gecontroleerde database', ok: true, detail: `${picked.label} | host ${host}${projectRef ? ` | project ${projectRef}` : ''}` });

    if (env.JARVIS_EXPECTED_PROJECT_REF) {
      const ok = projectRef === env.JARVIS_EXPECTED_PROJECT_REF;
      checks.push({
        name: 'URL hoort bij het verwachte project',
        ok,
        detail: ok ? `project ${projectRef}` : `verwacht ${env.JARVIS_EXPECTED_PROJECT_REF}, gevonden ${projectRef ?? 'geen'}`,
      });
    }

    const { rls, policies } = await checkDatabase(picked.url);
    const known = new Set(EXPECTED_TABLES);
    const present = rls.filter((r) => known.has(r.tablename));
    const zonderRls = present.filter((r) => r.rowsecurity !== true).map((r) => r.tablename);
    checks.push({
      name: 'RLS aan op alle applicatietabellen',
      ok: zonderRls.length === 0,
      detail: zonderRls.length ? `RLS UIT op: ${zonderRls.join(', ')}` : `${present.length} tabellen met RLS aan`,
    });
    checks.push({
      name: 'geen policies (anon-API geeft niets prijs)',
      ok: policies.length === 0,
      detail: policies.length
        ? `gevonden: ${policies.map((p) => `${p.tablename}.${p.policyname}`).join(', ')}`
        : 'geen policies',
    });
  }

  const gitFindings = checkGit();
  checks.push({
    name: 'geen secrets of .env-bestanden in git',
    ok: gitFindings.length === 0,
    detail: gitFindings.length ? gitFindings.join(' | ') : 'schoon',
  });

  const ok = checks.every((c) => c.ok);
  const out = ['Beveiligingscheck (server-side-only baseline)', '', `Result: ${ok ? 'OK' : 'FOUT'}`];
  for (const c of checks) out.push(`- ${c.ok ? 'OK  ' : 'FOUT'} ${c.name} (${c.detail})`);
  process.stdout.write(`${out.join('\n')}\n`);
  if (!ok) process.exitCode = 1;
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  main().catch((err) => {
    process.stderr.write(`Fout: ${err.message}\n`);
    process.exitCode = 1;
  });
}
