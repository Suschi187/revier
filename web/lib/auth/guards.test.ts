import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { PROTECTED_SECTIONS } from "./paths";

// ADR 010: Der Proxy schützt nur optimistisch. Autoritativ prüft jede geschützte Seite und jede
// Server Action selbst (Layouts schützen keine Actions). Dieser Test verhindert, dass eine neue
// Seite oder Action die Prüfung vergisst (Review M2, Architekt 2).

const APP_DIR = join(__dirname, "..", "..", "app");
const GUARD_RE = /\bawait (requireOnboardedUser|requireSessionUser|requireAdmin|requireAdminRole)\(/;
// Unter /admin zählt nur die Admin-Prüfung (ADR 014, Review A1).
const ADMIN_GUARD_RE = /\bawait (requireAdmin|requireAdminRole)\(/;

// Bewusst öffentliche Actions, jeweils mit Grund.
const PUBLIC_ACTIONS: Record<string, string> = {
  "[locale]/auth/actions.ts#confirmSignIn": "Anmelden selbst: prüft das Einmal-Token",
  "[locale]/auth/actions.ts#signOut": "Abmelden ist ohne Session harmlos",
};

// Ohne Legal-Gate und für gesperrte Konten erreichbar (App Store, DSGVO; ADR 019, Review A4), jeweils mit Grund.
// Diese Seiten prüfen nur die Session; ein requireOnboardedUser würde Löschen und Export hinter die Zustimmung legen.
const SESSION_ONLY: Record<string, string> = {
  "[locale]/account/delete/page.tsx": "Konto löschen muss ohne aktuelle Zustimmung und gesperrt gehen",
  "[locale]/account/delete/actions.ts": "Bestätigung der Löschung, gleicher Grund",
  "[locale]/account/data/page.tsx": "Datenexport (Art. 15/20 DSGVO) ohne aktuelle Zustimmung",
  "[locale]/account/report/listing/[id]/page.tsx": "Melden (DSA Art. 16) auch ohne Zustimmung und gesperrt (ADR 020)",
  "[locale]/account/report/profile/[id]/page.tsx": "Melden eines Anbieters, gleicher Grund",
  "[locale]/account/report/actions.ts": "Meldung absenden, gleicher Grund",
  "[locale]/account/reports/page.tsx": "Meine Meldungen mit Ergebnis (Art. 16 Abs. 5)",
  "[locale]/account/decisions/page.tsx": "Entscheidungen und Begründungen (Art. 17), gerade für gesperrte Konten",
  "[locale]/account/decisions/[id]/appeal/page.tsx": "Beschwerde (Art. 20), gerade für gesperrte Konten",
  "[locale]/account/decisions/[id]/appeal/actions.ts": "Beschwerde absenden, gleicher Grund",
};

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? files(join(dir, entry.name)) : [join(dir, entry.name)],
  );
}

const all = files(APP_DIR).map((file) => ({ file, path: relative(APP_DIR, file).split(sep).join("/") }));

/** Exportierte Funktionen mit ihrem Rumpf (bis zum nächsten Export). */
function exportedFunctions(source: string): { name: string; body: string }[] {
  const matches = [...source.matchAll(/^export (?:async )?function (\w+)/gm)];
  return matches.map((match, index) => ({
    name: match[1],
    body: source.slice(match.index, matches[index + 1]?.index ?? source.length),
  }));
}

describe("Geschützte Seiten und Server Actions", () => {
  const sectionRe = new RegExp(`^\\[locale\\]/(${PROTECTED_SECTIONS.join("|")})/`);

  it("Jede Seite in einem geschützten Bereich prüft die Anmeldung selbst", () => {
    const pages = all.filter(({ path }) => sectionRe.test(path) && path.endsWith("/page.tsx"));
    expect(pages.length).toBeGreaterThan(0);
    for (const { file, path } of pages) {
      expect(readFileSync(file, "utf8"), path).toMatch(GUARD_RE);
    }
  });

  it("Seiten und Actions unter /admin prüfen die Admin-Rolle selbst", () => {
    const admin = all.filter(({ path }) => path.startsWith("[locale]/admin/") && /\.(tsx?)$/.test(path));
    const pages = admin.filter(({ path }) => path.endsWith("/page.tsx"));
    expect(pages.length).toBeGreaterThan(0);
    for (const { file, path } of pages) expect(readFileSync(file, "utf8"), path).toMatch(ADMIN_GUARD_RE);
    for (const { file, path } of admin.filter(({ file }) => /^\s*["']use server["']/.test(readFileSync(file, "utf8")))) {
      for (const { name, body } of exportedFunctions(readFileSync(file, "utf8"))) expect(body, `${path}#${name}`).toMatch(ADMIN_GUARD_RE);
    }
  });

  it("Seiten mit Anmeldeprüfung liegen in einem geschützten Bereich (Proxy, noindex)", () => {
    for (const { file, path } of all.filter(({ path }) => path.endsWith("/page.tsx"))) {
      if (GUARD_RE.test(readFileSync(file, "utf8"))) expect(path, path).toMatch(sectionRe);
    }
  });

  it("Konto löschen und Datenexport prüfen nur die Session, nicht die Zustimmung (Review A4)", () => {
    for (const [path, reason] of Object.entries(SESSION_ONLY)) {
      const entry = all.find((f) => f.path === path);
      expect(entry, path).toBeTruthy();
      const source = readFileSync(entry!.file, "utf8");
      expect(source, `${path}: ${reason}`).toMatch(/\bawait requireSessionUser\(/);
      expect(source, `${path}: ${reason}`).not.toMatch(/requireOnboardedUser\(|@\/lib\/services\/gate/);
    }
  });

  it("Jede exportierte Server Action prüft die Anmeldung oder ist bewusst öffentlich", () => {
    const actionFiles = all.filter(({ file }) => /^\s*["']use server["']/.test(readFileSync(file, "utf8")));
    expect(actionFiles.length).toBeGreaterThan(0);
    const seen = new Set<string>();
    for (const { file, path } of actionFiles) {
      for (const { name, body } of exportedFunctions(readFileSync(file, "utf8"))) {
        const key = `${path}#${name}`;
        seen.add(key);
        if (key in PUBLIC_ACTIONS) continue;
        expect(body, key).toMatch(GUARD_RE);
      }
    }
    // Veraltete Ausnahmen fallen auf.
    for (const key of Object.keys(PUBLIC_ACTIONS)) expect(seen, key).toContain(key);
  });
});
