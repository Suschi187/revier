import { expect, test, type Browser, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { admin, deleteTestUsers, local } from "./cleanup";
import { latestMail, uniqueEmail } from "./mailpit";
// Fixtures der Function (keine Binärdateien im Repo), wie in listings.spec.ts.
import {
  COMMENT,
  contains,
  encode,
  exifSegment,
  GPS,
  gpsRationalBytes,
  quadrants,
  withMetadata,
  XMP_MARKER,
} from "../../supabase/functions/process-listing-photo/tests/fixtures.ts";

// QA M3 (docs/QA-REPORT.md, Abschnitt „M3 – Abnahme“): ergänzende Kernfluss-Prüfungen zum Inserieren.
// - Assistent ohne JavaScript (alles außer Fotos, CHANGELOG M3 „Bekannte Lücken“)
// - Fotos: Metadaten über den ganzen Weg entfernt (JPEG mit GPS, WebP mit EXIF; Plan M3 Auflage 5)
// - Fehlerzusammenfassung, Tastatur, 360 px in der längsten Sprache, noindex
// - bekannte Fehler als test.fail (Playwright meldet sie, sobald sie behoben sind)
// Die Testkonten werden am Ende samt Dateien gelöscht, damit pgTAP-Zählungen (08_storage) nicht kippen.

const created: string[] = [];
// Optional gegen einen Produktions-Build (`npx next start -p 3456`): QA_BASE_URL=http://localhost:3456
if (process.env.QA_BASE_URL) test.use({ baseURL: process.env.QA_BASE_URL });

test.afterAll(() => deleteTestUsers(created));

type Messages = { Auth: { login: Record<string, string> }; Profile: Record<string, string>; Welcome: Record<string, string> };
const messages = (locale: string) =>
  JSON.parse(readFileSync(path.resolve(process.cwd(), "messages", `${locale}.json`), "utf8")) as Messages;

async function signUp(page: Page, name: string, locale = "de") {
  const m = messages(locale);
  const email = uniqueEmail("qa-m3");
  created.push(email);
  await page.goto(`/${locale}/login?next=/${locale}/account/listings`);
  const since = new Date(Date.now() - 1000);
  await page.getByLabel(m.Auth.login.emailLabel).fill(email);
  await page.getByRole("button", { name: m.Auth.login.submit }).click();
  const mail = await latestMail(email, since);
  await page.getByLabel(m.Auth.login.codeLabel).fill(mail.code);
  await page.getByRole("button", { name: m.Auth.login.codeSubmit, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/${locale}/welcome`));
  await page.getByLabel(m.Profile.displayName).fill(name);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: m.Welcome.submit }).click();
  await expect(page).toHaveURL(`/${locale}/account/listings`);
}

/** Neue Seite ohne JavaScript mit der Session einer angemeldeten Seite. */
async function withoutJs(browser: Browser, page: Page): Promise<Page> {
  const state = await page.context().storageState();
  const context = await browser.newContext({ javaScriptEnabled: false, storageState: state });
  return context.newPage();
}

async function newHelperDraft(page: Page, title: string) {
  await page.goto("/de/account/listings/new");
  await page.getByLabel("Jagdhelfer/Mitjäger").check();
  await page.getByLabel("Gesuch", { exact: true }).check();
  await page.getByLabel("Titel").fill(title);
  await page.getByLabel("Landkreis bzw. Bezirk").selectOption({ label: "Dresden" });
  await page.getByRole("button", { name: "Entwurf anlegen" }).click();
  await expect(page.getByText("Schritt 2 von 6")).toBeVisible();
  return page.url().match(/listings\/([0-9a-f-]{36})\/edit/)![1];
}

// QA M3 F1: Ohne JavaScript blieb der per Suspense gestreamte Inhalt in <div hidden> stehen. Die Seiten
// rendern jetzt blockierend (`instant = false`); bis auf den Foto-Upload geht alles ohne JS.
test("Assistent ohne JavaScript: Gesuch anlegen, Land wechseln, absenden, Entwurf löschen", async ({ page, browser }) => {
  test.setTimeout(90_000);
  await signUp(page, "Ohne JS");
  const nojs = await withoutJs(browser, page);
  if (process.env.QA_DUMP_HTML) {
    const html = await (await page.request.get("/de/account/listings/new")).text();
    console.log("QA-HTML", html.length, "hiddenS:", (html.match(/<div hidden id="S:[^"]*"/g) ?? []).length,
      "form-at:", html.indexOf('id="f-title"'), "firstHidden-at:", html.indexOf('<div hidden id="S:'), "RC:", html.includes("$RC"));
  }

  // Land per GET-Formular wechseln: Bezirke aus AT erscheinen
  await nojs.goto("/de/account/listings/new");
  await expect(nojs.getByLabel("Titel")).toBeVisible({ timeout: 5_000 });
  await nojs.getByLabel("Land", { exact: true }).selectOption("AT");
  await nojs.getByRole("button", { name: "Land wechseln" }).click();
  await expect(nojs.getByLabel("Landkreis bzw. Bezirk").locator("option", { hasText: "Liezen" })).toHaveCount(1);

  await nojs.getByLabel("Jagdhelfer/Mitjäger").check();
  await nojs.getByLabel("Gesuch", { exact: true }).check();
  await nojs.getByLabel("Titel").fill("Suche Mitjäger ohne JavaScript");
  await nojs.getByLabel("Landkreis bzw. Bezirk").selectOption({ label: "Liezen" });
  await nojs.getByRole("button", { name: "Entwurf anlegen" }).click();
  await expect(nojs.getByText("Schritt 2 von 6")).toBeVisible();

  await nojs.getByRole("button", { name: "Speichern und weiter" }).click();
  await expect(nojs.getByText("Schritt 3 von 6")).toBeVisible();
  await nojs.getByLabel("Beschreibung").fill("Ich suche einen erfahrenen Mitjäger für Ansitz und Revierarbeit im Ennstal.");
  await nojs.getByLabel("Aufgaben").fill("Ansitzbau\nKirrung");
  await nojs.getByRole("button", { name: "Speichern und weiter" }).click();
  await expect(nojs.getByText("Schritt 4 von 6")).toBeVisible();
  // Playwright schaltet nur die Skriptausführung ab, der Parser blendet <noscript> weiter aus; deshalb im HTML prüfen.
  expect(await nojs.content()).toContain("<noscript><p class=\"text-sm\">Zum Hochladen von Fotos wird JavaScript benötigt.</p></noscript>");
  await expect(nojs.getByRole("button", { name: "Fotos auswählen" })).toBeDisabled();
  await nojs.getByRole("link", { name: "Weiter" }).click();
  await expect(nojs.getByText("Schritt 5 von 6")).toBeVisible();
  await nojs.getByRole("radio", { name: "Auf Anfrage" }).check();
  await nojs.getByRole("button", { name: "Speichern und weiter" }).click();
  await expect(nojs.getByText("Schritt 6 von 6")).toBeVisible();
  await expect(nojs.getByText("Alles bereit zum Absenden.")).toBeVisible();
  await nojs.getByRole("button", { name: "Zur Prüfung absenden" }).click();
  await expect(nojs).toHaveURL("/de/account/listings?notice=submitted");
  const row = nojs.getByRole("listitem").filter({ hasText: "Suche Mitjäger ohne JavaScript" });
  await expect(row.getByText("In Prüfung")).toBeVisible();

  // Zurückziehen und Entwurf löschen (details/summary ohne JS)
  await row.getByRole("button", { name: "Aus der Prüfung zurückziehen" }).click();
  await expect(nojs).toHaveURL(/notice=withdrawn/);
  const draft = nojs.getByRole("listitem").filter({ hasText: "Suche Mitjäger ohne JavaScript" });
  await expect(draft.getByText("Status: Entwurf")).toBeVisible();
  await draft.locator("summary").click();
  await draft.getByRole("button", { name: "Endgültig löschen" }).click();
  await expect(nojs).toHaveURL(/notice=deleted/);
  await expect(nojs.getByRole("listitem").filter({ hasText: "Suche Mitjäger ohne JavaScript" })).toHaveCount(0);
  await nojs.context().close();
});

/** WebP (vom Browser kodiert) mit EXIF-Chunk inklusive GPS: VP8X-Container, wie ihn Kameras/Apps schreiben. */
async function webpWithExif(page: Page): Promise<Buffer> {
  const simple = Buffer.from(
    await page.evaluate(async () => {
      const canvas = document.createElement("canvas");
      canvas.width = 640;
      canvas.height = 480;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#2a7"; ctx.fillRect(0, 0, 640, 480);
      ctx.fillStyle = "#a27"; ctx.fillRect(0, 0, 320, 240);
      const blob = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), "image/webp", 0.9));
      return [...new Uint8Array(await blob.arrayBuffer())];
    }),
  );
  const chunk = (fourcc: string, payload: Buffer) => {
    const header = Buffer.alloc(8);
    header.write(fourcc, 0, "latin1");
    header.writeUInt32LE(payload.length, 4);
    return Buffer.concat([header, payload, payload.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0)]);
  };
  // Chrome schreibt je nach Version einfaches (VP8/VP8L) oder erweitertes WebP (VP8X); beides auf VP8X mit EXIF-Flag bringen.
  const first = simple.subarray(12, 16).toString("latin1");
  expect(first).toMatch(/^VP8[ LX]$/);
  let vp8x: Buffer;
  let rest: Buffer;
  if (first === "VP8X") {
    vp8x = Buffer.from(simple.subarray(20, 30));
    rest = simple.subarray(30);
  } else {
    vp8x = Buffer.alloc(10);
    vp8x.writeUIntLE(640 - 1, 4, 3);
    vp8x.writeUIntLE(480 - 1, 7, 3);
    rest = simple.subarray(12);
  }
  vp8x[0] |= 0x08; // EXIF-Flag
  const tiff = Buffer.from(exifSegment({ gps: GPS })).subarray(10); // ohne FF E1, Länge, "Exif\0\0"
  const body = Buffer.concat([Buffer.from("WEBP", "latin1"), chunk("VP8X", vp8x), rest, chunk("EXIF", tiff)]);
  const riff = Buffer.alloc(8);
  riff.write("RIFF", 0, "latin1");
  riff.writeUInt32LE(body.length, 4);
  const file = Buffer.concat([riff, body]);
  expect(contains(file, gpsRationalBytes())).toBe(true); // Positivkontrolle der Fixture
  return file;
}

function assertClean(bytes: Uint8Array, label: string) {
  const text = (s: string) => new TextEncoder().encode(s);
  expect(bytes[0] === 0xff && bytes[1] === 0xd8, `${label}: JPEG`).toBe(true);
  expect(contains(bytes, text("Exif")), `${label}: Exif`).toBe(false);
  expect(contains(bytes, gpsRationalBytes()), `${label}: GPS`).toBe(false);
  expect(contains(bytes, text(XMP_MARKER)), `${label}: XMP`).toBe(false);
  expect(contains(bytes, text(COMMENT)), `${label}: Kommentar`).toBe(false);
  // Nichts nach dem letzten EOI
  expect(bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9, `${label}: endet mit EOI`).toBe(true);
}

test("Fotos: GPS, EXIF, XMP und Kommentar sind in Bild und Thumbnail entfernt, Eingang gelöscht (JPEG und WebP)", async ({ page }) => {
  test.skip(!local, "Lokale Supabase nötig");
  test.setTimeout(120_000);
  await signUp(page, "Foto QA");
  const id = await newHelperDraft(page, "Fotoprüfung Metadaten");
  await page.goto(`/de/account/listings/${id}/edit?step=photos`);
  await page.waitForLoadState("networkidle"); // Uploader ist eine Client-Komponente: erst nach der Hydrierung bereit

  const jpeg = Buffer.from(withMetadata(encode(quadrants(1200, 800)), 6));
  await page.getByLabel("Fotos auswählen").setInputFiles({ name: "gps.jpg", mimeType: "image/jpeg", buffer: jpeg });
  await expect(page.getByText("1 Foto hochgeladen.")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Foto 1 von 1", { exact: true })).toBeVisible({ timeout: 30_000 });
  await page.getByLabel("Fotos auswählen").setInputFiles({ name: "exif.webp", mimeType: "image/webp", buffer: await webpWithExif(page) });
  // Die Statusmeldung „1 Foto hochgeladen.“ steht noch vom ersten Upload da; auf die Liste warten.
  await expect(page.getByText("Foto 2 von 2", { exact: true })).toBeVisible({ timeout: 30_000 });

  const client = admin();
  const { data: photos } = await client
    .from("listing_photos")
    .select("storage_path, thumb_path, upload_path, processed_at, width, height, sort_order")
    .eq("listing_id", id)
    .order("sort_order");
  expect(photos).toHaveLength(2);
  for (const photo of photos!) {
    expect(photo.processed_at).not.toBeNull();
    expect(Math.max(photo.width, photo.height)).toBeLessThanOrEqual(2048);
    for (const path of [photo.storage_path, photo.thumb_path]) {
      const { data: blob, error } = await client.storage.from("listing-photos").download(path);
      expect(error).toBeNull();
      assertClean(new Uint8Array(await blob!.arrayBuffer()), path.endsWith("_thumb.jpg") ? "Thumbnail" : "Bild");
    }
    const { data: input } = await client.storage.from("listing-uploads").download(photo.upload_path);
    expect(input, "Eingang gelöscht").toBeNull();
  }
  // Orientierung 6: 1200 × 800 steht nach dem Drehen hochkant
  expect(photos![0].height).toBeGreaterThan(photos![0].width);

  // Ohne Alt-Text bekommen beide Fotos denselben Ersatztext (Titel); Plan M3 2.7 verlangt „Titel, Foto n von m“.
  const alts = await page.locator("#f-photos img").evaluateAll((imgs) => imgs.map((img) => img.getAttribute("alt")));
  expect(alts).toEqual(["Fotoprüfung Metadaten", "Fotoprüfung Metadaten"]);
});

test("Fehlerzusammenfassung: Anker, aria-invalid und Fehlertext am Feld", async ({ page }) => {
  await signUp(page, "Fehler QA");
  const id = await newHelperDraft(page, "Fehlerprüfung");
  await page.goto(`/de/account/listings/${id}/edit?step=location`);
  await page.getByLabel("PLZ des gesuchten Gebiets (optional)").fill("80331");
  await page.getByRole("button", { name: "Speichern und weiter" }).click();
  await expect(page).toHaveURL(/#error-summary$/);
  const summary = page.locator("#error-summary");
  await expect(summary).toHaveAttribute("role", "alert");
  const link = summary.getByRole("link").first();
  await expect(link).toHaveAttribute("href", "#f-postal");
  const field = page.locator("#f-postal");
  await expect(field).toHaveAttribute("aria-invalid", "true");
  await expect(field).toHaveAttribute("aria-describedby", /f-postal-error/);
  await expect(page.locator("#f-postal-error")).toHaveText("Die PLZ gehört nicht zum gewählten Kreis.");
  // Der Link der Zusammenfassung führt per Tastatur zum Feld
  await link.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#f-postal$/);
});

test("Tastatur: Schritt 1 ohne Maus ausfüllen und absenden", async ({ page }) => {
  await signUp(page, "Tastatur QA");
  await page.goto("/de/account/listings/new");
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Jagdpacht").focus();
  await page.keyboard.press("Space");
  await expect(page.getByLabel("Jagdpacht")).toBeChecked();
  await page.keyboard.press("ArrowDown"); // Radiogruppe: nächste Art wählt sie aus
  await expect(page.getByLabel("Begehungsschein")).toBeChecked();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Space");
  await expect(page.getByLabel("Angebot", { exact: true })).toBeChecked();
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Titel")).toBeFocused();
  await page.keyboard.type("Begehungsschein per Tastatur");
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Sprache des Textes")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Landkreis bzw. Bezirk")).toBeFocused();
  await page.getByLabel("Landkreis bzw. Bezirk").selectOption({ label: "Dresden" });
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Entwurf anlegen" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByText("Schritt 2 von 6")).toBeVisible();
});

test("360 px in Polnisch: keine horizontale Überbreite in Assistent und „Meine Anzeigen“, alle Seiten noindex", async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 360, height: 800 });
  await signUp(page, "Wąska Szerokość", "pl");
  await page.goto("/pl/account/listings/new");
  await page.getByLabel("Pomocnik myśliwego").check();
  await page.locator("input[name=direction][value=offer]").check();
  await page.locator("#f-title").fill("Długi tytuł ogłoszenia o pomocy przy polowaniu zbiorowym w Saksonii");
  await page.locator("#f-district").selectOption({ label: "Dresden" });
  await page.locator("form button[type=submit]").last().click();
  await expect(page).toHaveURL(/step=location/);
  const id = page.url().match(/listings\/([0-9a-f-]{36})\/edit/)![1];

  const pages = ["/pl/account/listings", "/pl/account/listings/new",
    ...["basics", "location", "details", "photos", "price", "preview"].map((s) => `/pl/account/listings/${id}/edit?step=${s}`)];
  const overflow: string[] = [];
  for (const path of pages) {
    await page.goto(path);
    await expect(page.locator("meta[name=robots]")).toHaveAttribute("content", /noindex/);
    const width = await page.evaluate(() => document.documentElement.scrollWidth);
    if (width > 360) overflow.push(`${path}: ${width}px`);
  }
  expect(overflow).toEqual([]);
});

// QA M3 F3: Ein eingetragener Betrag geht nie stumm verloren. Ohne gewählte Option gilt „Betrag angeben“,
// bei „Auf Anfrage“ mit Betrag gibt es einen Feldfehler. Die Option heißt anders als das Feld (F7).
test("Preis: eingegebener Betrag geht nicht stumm verloren", async ({ page }) => {
  await signUp(page, "Preis QA");
  const id = await newHelperDraft(page, "Preisprüfung");
  await page.goto(`/de/account/listings/${id}/edit?step=price`);
  await page.getByRole("radio", { name: "Auf Anfrage" }).check();
  await page.getByLabel("Betrag", { exact: true }).fill("1200");
  await page.getByRole("button", { name: "Speichern und weiter" }).click();
  await expect(page.getByRole("alert").getByText(/Du hast einen Betrag eingetragen/)).toBeVisible();
  await expect(page.getByText("Schritt 5 von 6")).toBeVisible();

  await page.goto(`/de/account/listings/${id}/edit?step=price`);
  await page.getByLabel("Betrag", { exact: true }).fill("1200");
  await page.getByRole("button", { name: "Speichern und weiter" }).click();
  await expect(page.getByText("Schritt 6 von 6")).toBeVisible();
  await expect(page.getByText(/1\.200(,00)?\s€/)).toBeVisible();
  await expect(page.getByText("Keine Preisangabe")).toHaveCount(0);
});

// QA M3 F5: Eingereicht oder veröffentlicht stehen Art und Richtung fest; der Titel bleibt änderbar.
test("Grunddaten: Art und Richtung einer eingereichten Anzeige sind gesperrt", async ({ page }) => {
  test.skip(!local, "Lokale Supabase nötig");
  await signUp(page, "Sperre QA");
  const id = await newHelperDraft(page, "Sperre prüfen");
  // Direkt in die Prüfung legen (Server-Pfad, ohne die übrigen Schritte des Assistenten).
  const { error } = await admin()
    .from("listings")
    .update({ description: "Ich suche Hilfe beim Ansitzbau im Frühjahr.", attributes: { tasks: ["Ansitzbau"] }, status: "pending_review" })
    .eq("id", id);
  expect(error).toBeNull();

  await page.goto(`/de/account/listings/${id}/edit?step=basics`);
  await expect(page.getByText("lassen sich Art und Richtung nicht mehr ändern")).toBeVisible();
  await expect(page.getByRole("radio", { name: "Jagdpacht" })).toBeDisabled();
  await expect(page.getByRole("radio", { name: "Angebot" })).toBeDisabled();
  await page.getByLabel("Titel").fill("Sperre geprüft");
  await page.getByRole("button", { name: "Speichern und weiter" }).click();
  await expect(page.getByText("Schritt 2 von 6")).toBeVisible();

  const { data } = await admin().from("listings").select("kind, direction, title, status").eq("id", id).single();
  expect(data).toEqual({ kind: "helper", direction: "wanted", title: "Sperre geprüft", status: "pending_review" });
});

// QA M3 F6: „Entwurf löschen“ aus einer veralteten Ansicht lässt die Bilder einer inzwischen eingereichten
// Anzeige stehen.
test("Entwurf löschen aus veralteter Ansicht: eingereichte Anzeige behält ihre Fotos", async ({ page }) => {
  test.skip(!local, "Lokale Supabase nötig");
  test.setTimeout(90_000);
  await signUp(page, "Löschen QA");
  const id = await newHelperDraft(page, "Veraltete Ansicht");
  await page.goto(`/de/account/listings/${id}/edit?step=photos`);
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Fotos auswählen").setInputFiles({ name: "a.jpg", mimeType: "image/jpeg", buffer: Buffer.from(encode(quadrants(800, 600))) });
  await expect(page.getByText("Foto 1 von 1", { exact: true })).toBeVisible({ timeout: 30_000 });

  await page.goto("/de/account/listings");
  const row = page.getByRole("listitem").filter({ hasText: "Veraltete Ansicht" });
  await row.locator("summary").click();
  // Inzwischen eingereicht (zweiter Tab, hier als Server-Pfad)
  const client = admin();
  const { error } = await client
    .from("listings")
    .update({ description: "Ich suche Hilfe beim Ansitzbau im Frühjahr.", attributes: { tasks: ["Ansitzbau"] }, status: "pending_review" })
    .eq("id", id);
  expect(error).toBeNull();

  await row.getByRole("button", { name: "Endgültig löschen" }).click();
  await expect(page).toHaveURL(/error=failed/);
  const { data: photo } = await client.from("listing_photos").select("storage_path, thumb_path").eq("listing_id", id).single();
  const folder = photo!.storage_path!.split("/").slice(0, 2).join("/");
  const { data: files } = await client.storage.from("listing-photos").list(folder);
  const names = (files ?? []).map((f) => `${folder}/${f.name}`);
  expect(names).toEqual(expect.arrayContaining([photo!.storage_path, photo!.thumb_path]));
});
