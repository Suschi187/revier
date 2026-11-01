// Lokales Konto zum Admin machen (Runbook „erster Admin“, ADR 005), nur gegen die lokale Supabase:
//   npm run admin:local -- ich@example.local          Rolle vergeben (zurückdatiert, ohne 7 Tage Karenz)
//   npm run admin:local -- ich@example.local --remove  Rolle entziehen
// Läuft über `supabase db query --local`, braucht keinen Schlüssel. Die 2FA richtet das Konto danach selbst
// unter /de/admin ein. Nie gegen die Cloud: dort gilt das Runbook im SQL-Editor.
import { execFileSync } from "node:child_process";
import path from "node:path";

const args = process.argv.slice(2);
const remove = args.includes("--remove");
const email = args.find((a) => !a.startsWith("--"))?.trim().toLowerCase();

// Streng geprüft, weil die Adresse in den SQL-Text geht (kein Platzhalter über die CLI möglich).
if (!email || !/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(email)) {
  console.error("Aufruf: npm run admin:local -- <e-mail> [--remove]");
  process.exit(1);
}

const repoRoot = path.resolve(import.meta.dirname, "..", "..");

/**
 * `-o json` erzwingt JSON: Ohne die Option gibt die CLI im Terminal eine Tabelle aus (nur in Agent-Umgebungen
 * JSON). Die Ausgabe ist ein Array oder ein Objekt mit `rows`; insert und delete geben nichts aus.
 */
function query(sql, { expectRows = false } = {}) {
  const out = execFileSync("supabase", ["db", "query", "--local", "-o", "json", sql], {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 30_000,
  });
  const start = out.search(/[[{]/);
  if (start < 0) {
    if (expectRows) throw new Error(`Unerwartete Ausgabe der Supabase-CLI:\n${out}`);
    return [];
  }
  const parsed = JSON.parse(out.slice(start));
  return Array.isArray(parsed) ? parsed : (parsed.rows ?? []);
}

let rows;
try {
  rows = query(`select u.id::text as id, (r.user_id is not null) as admin
                from auth.users u left join private.user_roles r on r.user_id = u.id and r.role = 'admin'
                where lower(u.email) = '${email}'`, { expectRows: true });
} catch (error) {
  console.error("Abfrage fehlgeschlagen. Läuft die lokale Supabase (`supabase start` im Repo-Root)?");
  console.error(String(error.stderr ?? error.message).trim());
  process.exit(1);
}

if (rows.length === 0) {
  console.error(`Kein Konto mit ${email}. Erst unter http://localhost:3000/de/login anmelden und das Onboarding abschließen.`);
  process.exit(1);
}

const { id, admin } = rows[0];
if (remove) {
  if (!admin) {
    console.log(`${email} ist kein Admin.`);
    process.exit(0);
  }
  query(`delete from private.user_roles where user_id = '${id}' and role = 'admin'`);
  console.log(`Admin-Rolle für ${email} entzogen.`);
} else if (admin) {
  console.log(`${email} ist schon Admin. Weiter unter http://localhost:3000/de/admin`);
} else {
  query(`insert into private.user_roles (user_id, role, created_at) values ('${id}', 'admin', now() - interval '7 days') on conflict do nothing`);
  console.log(`${email} ist jetzt Admin (zurückdatiert, ohne Karenz).`);
  console.log("Weiter: http://localhost:3000/de/admin öffnen und den Authenticator einrichten.");
}
