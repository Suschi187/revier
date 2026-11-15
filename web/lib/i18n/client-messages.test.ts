import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import en from "@/messages/en.json";
import { LAYOUT_CLIENT_NAMESPACES, pickMessages } from "./pick";

// Statische Prüfung zu ClientMessages: Jede Server-Datei, die eine übersetzte Client-Komponente einbindet (auch über
// weitere Client-Komponenten), nennt deren Namensräume in ihrer ClientMessages-Grenze oder, ohne Grenze, im Layout.
// Sonst zeigt der Browser nach der Hydration rohe Schlüssel.

const root = join(__dirname, "..", "..");
const files = ["app", "components"].flatMap((dir) => walk(join(root, dir))).filter((f) => /\.tsx?$/.test(f) && !f.endsWith(".test.ts"));
const source = new Map(files.map((f) => [f, readFileSync(f, "utf8")]));
const isClient = (f: string) => /^\s*["']use client["']/.test(source.get(f) ?? "");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

function resolveImport(from: string, spec: string): string | undefined {
  const base = spec.startsWith("@/") ? join(root, spec.slice(2)) : spec.startsWith(".") ? join(dirname(from), spec) : undefined;
  if (!base) return undefined;
  return [`${base}.tsx`, `${base}.ts`, join(base, "index.tsx")].find((f) => existsSync(f) && source.has(f));
}

function imports(file: string): string[] {
  return [...(source.get(file) ?? "").matchAll(/import\s+[^;]*?from\s+["']([^"']+)["']/g)]
    .map((m) => resolveImport(file, m[1]))
    .filter((f): f is string => f !== undefined);
}

/** Namensräume einer Client-Datei samt aller importierten Client-Dateien. */
function clientNamespaces(file: string, seen = new Set<string>()): Set<string> {
  const out = new Set<string>();
  if (seen.has(file)) return out;
  seen.add(file);
  for (const m of (source.get(file) ?? "").matchAll(/useTranslations\(\s*["']([^"']+)["']\s*\)/g)) out.add(m[1]);
  if (/useTranslations\(\s*\)/.test(source.get(file) ?? "")) out.add("*");
  for (const dep of imports(file)) if (isClient(dep)) for (const ns of clientNamespaces(dep, seen)) out.add(ns);
  return out;
}

const covered = (needed: string, listed: readonly string[]) => listed.some((l) => needed === l || needed.startsWith(`${l}.`));

function boundaryNamespaces(file: string): string[] | undefined {
  const lists = [...(source.get(file) ?? "").matchAll(/<ClientMessages\s+namespaces=\{\[([^\]]*)\]\}/g)];
  if (lists.length === 0) return undefined;
  return lists.flatMap((m) => [...m[1].matchAll(/["']([^"']+)["']/g)].map((n) => n[1]));
}

describe("ClientMessages", () => {
  const servers = files.filter((f) => !isClient(f));

  it("findet übersetzte Client-Komponenten (Probe, dass die Prüfung greift)", () => {
    const translating = files.filter((f) => isClient(f) && clientNamespaces(f).size > 0);
    expect(translating.length).toBeGreaterThanOrEqual(14);
    expect(clientNamespaces(join(root, "components/profile/WelcomeForm.tsx"))).toEqual(new Set(["Welcome", "LocaleSwitcher.names", "Profile.errors", "Profile"]));
  });

  it("jede Server-Datei gibt die Namensräume ihrer Client-Komponenten weiter", () => {
    const missing: string[] = [];
    for (const file of servers) {
      const needed = new Set(imports(file).filter(isClient).flatMap((dep) => [...clientNamespaces(dep)]));
      if (needed.size === 0) continue;
      const listed = boundaryNamespaces(file) ?? LAYOUT_CLIENT_NAMESPACES;
      for (const ns of needed) if (!covered(ns, listed)) missing.push(`${relative(root, file)}: ${ns}`);
    }
    expect(missing).toEqual([]);
  });

  it("alle genannten Namensräume gibt es", () => {
    const lists = servers.flatMap((f) => boundaryNamespaces(f) ?? []);
    expect(lists.length).toBeGreaterThan(10);
    expect(() => pickMessages(en, [...lists, ...LAYOUT_CLIENT_NAMESPACES])).not.toThrow();
  });
});
