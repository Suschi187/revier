// Übersetzt die Web-Texte per DeepL nach cs und pl (SPEC M10a Schritt 5). de und en bleiben handgeschrieben.
// Aufruf: `npm run i18n:deepl` (Schlüssel DEEPL_API_KEY in .env.local, nie im Repo).
//
// - Anrede: Du (cs „ty“, pl „ty“), Entscheidung vom 2026-11-13. DeepL kann für Tschechisch keine Anrede wählen und
//   siezt aus dem Englischen; aus dem deutschen Du-Text duzt es. Deshalb: cs aus de, pl aus en (formality).
// - Glossar aus docs/GLOSSARY.md (Quellspalte → cs/pl), damit Fachbegriffe auf Web und iOS gleich bleiben. Einträge
//   mit kleinem Anfangsbuchstaben, sonst stehen Begriffe mitten im Satz groß; am Satzanfang folgt die Quelle.
// - Platzhalter `{name}` und Tags `<link>…</link>` laufen als XML durch DeepL und bleiben unverändert.
// - ICU-Plural/Select bleibt aus der bisherigen Datei (cs/pl brauchen one/few/many/other, DeepL kennt das nicht);
//   die Schlüssel stehen im Bericht zur Prüfung.
// - Handkorrekturen stehen in scripts/i18n-overrides.json und überschreiben das DeepL-Ergebnis.
// - Schreibt cs.json und pl.json direkt (Prüfung über git diff) und einen Bericht nach scripts/.deepl-report.json.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const KEY = process.env.DEEPL_API_KEY;
if (!KEY) {
  console.error("DEEPL_API_KEY fehlt (in web/.env.local eintragen).");
  process.exit(1);
}
const API = KEY.endsWith(":fx") ? "https://api-free.deepl.com" : "https://api.deepl.com";
/** Ziel → Quelldatei und Glossarspalten (| Code | en | de | cs | pl | Status |). */
const TARGETS = {
  cs: { source: "de", from: 3, to: 4, context: "Oberfläche von Huntroy, einem Online-Marktplatz für Jagdgelegenheiten. Den Nutzer duzen (ty), nie siezen. Kurz halten. Rechts- und Sicherheitshinweise sachlich." },
  pl: { source: "en", from: 2, to: 5, context: "User interface of Huntroy, an online marketplace for hunting opportunities. Address the user informally (ty). Keep texts short. Legal and safety notes stay factual." },
};
// Eigennamen, der Namenszusatz (SPEC M10a Schritt 5, je Sprache von Hand), Sprachnamen in eigener Sprache, Schriftproben
// und der OSM-Pflichtvermerk (HTML) bleiben, wie sie sind.
const SKIP = [
  /^LocaleSwitcher\.names\./, /^Brand\.(name|endorsement|tagline)$/, /^Styleguide\.bodySample$/, /^Map\.attribution$/,
  // Gleiche Labels in den Mails (supabase/tests/fixtures/mail_labels.json, Test lib/public/mail-links.test.ts): nur gemeinsam ändern.
  /^Listings\.preview\.onRequest$/, /^Listings\.priceUnits\./, /^Moderation\.(reasons|accountCodes)\./, /^Verification\.(documentTypes|reasons|revokeReasons)\./,
  /^Report\.outcomes\./, /^Decisions\.actions\./,
];
const PLURAL = /\{\s*\w+\s*,\s*(plural|select|selectordinal)\s*,/;

function flatten(node, path = "", out = new Map()) {
  if (Array.isArray(node)) node.forEach((v, i) => flatten(v, `${path}[${i}]`, out));
  else if (node && typeof node === "object") for (const [k, v] of Object.entries(node)) flatten(v, path ? `${path}.${k}` : k, out);
  else out.set(path, node);
  return out;
}

function rebuild(source, path, lookup) {
  if (Array.isArray(source)) return source.map((v, i) => rebuild(v, `${path}[${i}]`, lookup));
  if (source && typeof source === "object") {
    return Object.fromEntries(Object.entries(source).map(([k, v]) => [k, rebuild(v, path ? `${path}.${k}` : k, lookup)]));
  }
  return lookup(path, source);
}

const escapeXml = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const unescapeXml = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

/** `{name}` → `<x n="name"/>`, `<link>` bleibt Tag; alles andere wird XML-sicher. */
function toXml(text) {
  const parts = text.split(/(\{\w+\}|<\/?\w+>)/);
  return parts
    .map((part) => {
      const ph = part.match(/^\{(\w+)\}$/);
      if (ph) return `<x n="${ph[1]}"/>`;
      if (/^<\/?\w+>$/.test(part)) return part;
      return escapeXml(part);
    })
    .join("");
}

function fromXml(xml) {
  return unescapeXml(xml.replace(/<x n="(\w+)"\s*\/>/g, "{$1}"));
}

const lowerFirst = (s) => s.charAt(0).toLocaleLowerCase() + s.slice(1);

/** Beginnt die Quelle groß, beginnt auch die Übersetzung groß (Glossarbegriffe am Anfang stehen sonst klein). */
function matchCase(sourceText, out) {
  const s = sourceText.match(/\p{L}/u)?.[0];
  const i = out.search(/\p{L}/u);
  if (!s || i < 0 || s !== s.toLocaleUpperCase()) return out;
  return out.slice(0, i) + out.charAt(i).toLocaleUpperCase() + out.slice(i + 1);
}

async function deepl(path, body, method = "POST") {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `DeepL-Auth-Key ${KEY}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`DeepL ${path}: ${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

/** Glossar aus den Tabellen in docs/GLOSSARY.md, ohne die URL-Wörter (ASCII ohne Diakritika, ADR 015). */
function glossaryEntries({ from, to }) {
  const seen = new Map();
  let urlWords = false;
  for (const line of readFileSync(join(root, "..", "docs", "GLOSSARY.md"), "utf8").split("\n")) {
    if (line.startsWith("#")) urlWords = /URL/.test(line);
    if (urlWords) continue;
    const cells = line.split("|").map((c) => c.trim());
    if (cells.length < 7 || cells[1] === "Code" || /^-+$/.test(cells[1])) continue;
    const src = cells[from];
    const tr = cells[to];
    // Nur eindeutige, schlichte Begriffe: DeepL lehnt doppelte Quellen und Tabs ab.
    if (!src || !tr || src.includes("/") || tr.includes("/") || /[\t`]/.test(src + tr) || seen.has(src.toLowerCase())) continue;
    seen.set(src.toLowerCase(), [lowerFirst(src), lowerFirst(tr)]);
  }
  return [...seen.values()].map(([s, t]) => `${s}\t${t}`).join("\n");
}

async function translate(texts, target, config, glossaryId) {
  const out = [];
  for (let i = 0; i < texts.length; i += 50) {
    const batch = texts.slice(i, i + 50);
    const res = await deepl("/v2/translate", {
      text: batch.map(toXml),
      source_lang: config.source.toUpperCase(),
      target_lang: target.toUpperCase(),
      tag_handling: "xml",
      ignore_tags: ["x"],
      formality: "prefer_less",
      context: config.context,
      preserve_formatting: true,
      ...(glossaryId ? { glossary_id: glossaryId } : {}),
    });
    out.push(...res.translations.map((t, j) => matchCase(batch[j], fromXml(t.text))));
    process.stdout.write(`\r${target}: ${Math.min(i + 50, texts.length)}/${texts.length}`);
  }
  process.stdout.write("\n");
  return out;
}

const en = JSON.parse(readFileSync(join(root, "messages", "en.json"), "utf8"));
const overrides = JSON.parse(readFileSync(join(root, "scripts", "i18n-overrides.json"), "utf8"));
const report = { usage: null, plurals: [], skipped: [], placeholderMismatch: {}, changed: {} };

for (const [target, config] of Object.entries(TARGETS)) {
  const source = flatten(JSON.parse(readFileSync(join(root, "messages", `${config.source}.json`), "utf8")));
  const file = join(root, "messages", `${target}.json`);
  const current = flatten(JSON.parse(readFileSync(file, "utf8")));
  const keys = [...source.keys()].filter((k) => typeof source.get(k) === "string" && source.get(k).trim() !== "");
  const keep = new Set(keys.filter((k) => SKIP.some((re) => re.test(k)) || PLURAL.test(source.get(k))));
  const todo = keys.filter((k) => !keep.has(k));
  report.plurals = keys.filter((k) => PLURAL.test(source.get(k)));
  report.skipped = keys.filter((k) => SKIP.some((re) => re.test(k)));

  const entries = glossaryEntries(config);
  const glossary = entries
    ? await deepl("/v2/glossaries", { name: `huntroy-${config.source}-${target}`, source_lang: config.source, target_lang: target, entries, entries_format: "tsv" })
    : null;
  let translated;
  try {
    translated = await translate(todo.map((k) => source.get(k)), target, config, glossary?.glossary_id);
  } finally {
    if (glossary) await deepl(`/v2/glossaries/${glossary.glossary_id}`, null, "DELETE");
  }

  const result = new Map(todo.map((k, i) => [k, translated[i]]));
  const placeholders = (s) => [...String(s).matchAll(/\{\w+\}|<\/?\w+>/g)].map((m) => m[0]).sort().join(" ");
  const mismatch = todo.filter((k) => placeholders(source.get(k)) !== placeholders(result.get(k)));
  report.placeholderMismatch[target] = mismatch.map((k) => ({ key: k, source: source.get(k), out: result.get(k) }));
  // Bei kaputten Platzhaltern bleibt der alte Text; der Bericht nennt die Stelle.
  for (const k of mismatch) result.delete(k);
  // Handkorrekturen (scripts/i18n-overrides.json) gehen vor.
  for (const [k, v] of Object.entries(overrides[target] ?? {})) {
    if (!source.has(k)) throw new Error(`Override ${target} ${k}: Schlüssel gibt es nicht mehr`);
    result.set(k, v);
  }
  report.changed[target] = [...result].filter(([k, v]) => current.get(k) !== v).length;

  // Struktur und Reihenfolge aus en.json; fehlt ein Schlüssel in der Zieldatei, bleibt der englische Text.
  const merged = rebuild(en, "", (path, value) => (result.has(path) ? result.get(path) : current.has(path) ? current.get(path) : value));
  writeFileSync(file, `${JSON.stringify(merged, null, 2)}\n`);
}

report.usage = await deepl("/v2/usage", null, "GET");
writeFileSync(join(root, "scripts", ".deepl-report.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(`Geschrieben: geändert cs ${report.changed.cs}, pl ${report.changed.pl}; Plural behalten ${report.plurals.length}; ` +
  `Platzhalter-Fehler cs ${report.placeholderMismatch.cs.length}, pl ${report.placeholderMismatch.pl.length}. Bericht: scripts/.deepl-report.json`);
