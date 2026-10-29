import { expect, test, type Page } from "@playwright/test";
import { latestMail, uniqueEmail } from "./mailpit";
// Echte JPEGs mit GPS, XMP und Orientierung aus den Fixtures der Function (keine Binärdateien im Repo).
import { encode, quadrants, withMetadata } from "../../supabase/functions/process-listing-photo/tests/fixtures.ts";

// Kernflow Inserieren (SPEC 6 M3, Plan M3 Commit 13): Assistent bis „Zur Prüfung absenden“, danach
// „Meine Anzeigen“ mit Status „In Prüfung“ und ohne Aktion zum Freischalten. Freigeben kann nur die
// Moderation (pgTAP 17_listing_rules, API-Tests listings.test.ts).

let cspViolations: string[] = [];
test.beforeEach(({ page }) => {
  cspViolations = [];
  page.on("console", (message) => {
    if (message.type() === "error" && /Content Security Policy/i.test(message.text())) cspViolations.push(message.text());
  });
});
test.afterEach(() => {
  expect(cspViolations).toEqual([]);
});

async function signUp(page: Page, name: string) {
  const email = uniqueEmail("listing");
  await page.goto("/de/login?next=/de/account/listings");
  const since = new Date(Date.now() - 1000);
  await page.getByLabel("E-Mail-Adresse").fill(email);
  await page.getByRole("button", { name: "Anmelde-E-Mail senden" }).click();
  const mail = await latestMail(email, since);
  await page.getByLabel("Anmeldecode").fill(mail.code);
  await page.getByRole("button", { name: "Anmelden", exact: true }).click();
  await expect(page).toHaveURL(/\/de\/welcome/);
  await page.getByLabel("Anzeigename").fill(name);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Speichern und weiter" }).click();
  await expect(page).toHaveURL("/de/account/listings");
}

test("Pacht-Angebot vollständig anlegen und zur Prüfung absenden", async ({ page }) => {
  await signUp(page, "Pächterin Test");
  await expect(page.getByText("Du hast noch keine Anzeigen.")).toBeVisible();
  await page.getByRole("link", { name: "Anzeige aufgeben" }).click();

  // Schritt 1: Grunddaten, Kreis (Pflichtspalten des Entwurfs)
  await expect(page.getByText("Schritt 1 von 6")).toBeVisible();
  await page.getByLabel("Jagdpacht").check();
  await page.getByLabel("Angebot", { exact: true }).check();
  await page.getByLabel("Titel").fill("Genossenschaftsjagd bei Dresden");
  await page.getByLabel("Landkreis bzw. Bezirk").selectOption({ label: "Dresden" });
  await page.getByRole("button", { name: "Entwurf anlegen" }).click();

  // Schritt 2: Ort; eine PLZ aus einem anderen Kreis wird abgelehnt
  await expect(page.getByText("Schritt 2 von 6")).toBeVisible();
  await page.getByLabel("PLZ des Reviers").fill("80331");
  await page.getByLabel("Ort des Reviers").fill("München");
  await page.getByRole("button", { name: "Speichern und weiter" }).click();
  await expect(page.getByRole("alert").getByText("Die PLZ gehört nicht zum gewählten Kreis.")).toBeVisible();
  await page.getByLabel("PLZ des Reviers").fill("01067");
  await page.getByLabel("Ort des Reviers").fill("Dresden");
  await page.getByRole("button", { name: "Speichern und weiter" }).click();
  await expect(page.getByText("Schritt 3 von 6")).toBeVisible();

  // Vorschau zeigt, was fehlt, mit Links zu den Schritten
  await page.getByRole("link", { name: /Vorschau und Absenden/ }).click();
  await expect(page.getByText("Vor dem Absenden fehlt noch:")).toBeVisible();
  await expect(page.getByRole("link", { name: "Bitte wähle mindestens eine Wildart." })).toBeVisible();
  await page.getByRole("link", { name: "Bitte wähle die Pachtart." }).click();

  // Schritt 3: Details
  await expect(page.getByText("Schritt 3 von 6")).toBeVisible();
  await page.getByLabel("Beschreibung").fill("Genossenschaftsjagd mit 420 Hektar Wald und Feld, Rehwild und Schwarzwild.");
  await page.getByLabel("Fläche in Hektar").fill("420,5");
  await page.getByLabel("Pachtart").selectOption({ label: "Genossenschaftsjagd" });
  await page.getByLabel("Wald", { exact: true }).check();
  await page.getByLabel("Feld", { exact: true }).check();
  await page.getByLabel("Jagdhütte vorhanden").check();
  await page.getByLabel("Rehwild").check();
  await page.getByLabel("Schwarzwild").check();
  await page.getByRole("button", { name: "Speichern und weiter" }).click();

  // Schritt 4: Fotos. HEIC wird mit klarer Meldung abgelehnt; ein JPEG mit GPS wird verarbeitet.
  await expect(page.getByText("Schritt 4 von 6")).toBeVisible();
  const heic = Buffer.from([0, 0, 0, 24, ...Buffer.from("ftypheic"), 0, 0, 0, 0]);
  await page.getByLabel("Fotos auswählen").setInputFiles({ name: "IMG_0001.HEIC", mimeType: "image/heic", buffer: heic });
  await expect(page.getByRole("alert").getByText("HEIC wird nicht unterstützt. Bitte exportiere das Foto als JPEG.")).toBeVisible();
  const photo = Buffer.from(withMetadata(encode(quadrants(1200, 800)), 6));
  await page.getByLabel("Fotos auswählen").setInputFiles({ name: "revier.jpg", mimeType: "image/jpeg", buffer: photo });
  await expect(page.getByText("1 Foto hochgeladen.")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("img", { name: "Genossenschaftsjagd bei Dresden" })).toBeVisible();
  await page.getByLabel("Alt-Text (optional)").fill("Waldrand mit Hochsitz");
  await page.getByRole("button", { name: "Alt-Text speichern" }).click();
  await expect(page.getByText("Alt-Text gespeichert.")).toBeVisible();
  await expect(page.getByRole("img", { name: "Waldrand mit Hochsitz" })).toBeVisible();
  await page.getByRole("link", { name: "Weiter" }).click();

  // Schritt 5: Preis; falsche Eingabe wird erklärt
  await expect(page.getByText("Schritt 5 von 6")).toBeVisible();
  await page.getByRole("radio", { name: "Betrag" }).check();
  await page.getByRole("textbox", { name: "Betrag" }).fill("12,345.6.7");
  await page.getByLabel("Einheit").selectOption({ label: "pro Jahr" });
  await page.getByRole("button", { name: "Speichern und weiter" }).click();
  await expect(page.getByRole("alert").getByText(/Bitte gib den Betrag als Zahl an/)).toBeVisible();
  await page.getByRole("radio", { name: "Betrag" }).check();
  await page.getByRole("textbox", { name: "Betrag" }).fill("8.400");
  await page.getByLabel("Einheit").selectOption({ label: "pro Jahr" });
  await page.getByRole("button", { name: "Speichern und weiter" }).click();

  // Schritt 6: Vorschau und Absenden
  await expect(page.getByText("Schritt 6 von 6")).toBeVisible();
  await expect(page.getByText("Alles bereit zum Absenden.")).toBeVisible();
  await expect(page.getByText("8.400 € pro Jahr")).toBeVisible();
  await expect(page.getByText("nur für dich und die Moderation")).toBeVisible();
  await expect(page.getByText("Genossenschaftsjagd", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Zur Prüfung absenden" }).click();

  await expect(page).toHaveURL("/de/account/listings?notice=submitted");
  await expect(page.getByText("Danke! Deine Anzeige ist jetzt in Prüfung.")).toBeVisible();
  const row = page.getByRole("listitem").filter({ hasText: "Genossenschaftsjagd bei Dresden" });
  await expect(row.getByText("In Prüfung")).toBeVisible();
  // Keine Aktion zum Freischalten für den Besitzer
  await expect(row.getByRole("button", { name: /Freischalten|Veröffentlichen|Aktivieren/ })).toHaveCount(0);
  await expect(row.getByRole("button", { name: "Aus der Prüfung zurückziehen" })).toBeVisible();
});

test("Waffenbegriffe: deutlicher Hinweis in der Vorschau, Absenden bleibt möglich", async ({ page }) => {
  await signUp(page, "Helfer Test");
  await page.goto("/de/account/listings/new");
  await page.getByLabel("Jagdhelfer/Mitjäger").check();
  await page.getByLabel("Gesuch", { exact: true }).check();
  await page.getByLabel("Titel").fill("Suche Mitjäger, Munition vorhanden");
  await page.getByLabel("Landkreis bzw. Bezirk").selectOption({ label: "Dresden" });
  await page.getByRole("button", { name: "Entwurf anlegen" }).click();
  await expect(page.getByText("Schritt 2 von 6")).toBeVisible();
  await page.getByRole("button", { name: "Speichern und weiter" }).click();
  await expect(page.getByText("Schritt 3 von 6")).toBeVisible();
  await page.getByLabel("Beschreibung").fill("Ich suche einen erfahrenen Mitjäger für die Ansitzjagd im Herbst.");
  await page.getByRole("button", { name: "Speichern und weiter" }).click();
  await expect(page.getByText("Schritt 4 von 6")).toBeVisible();
  await page.getByRole("link", { name: "Weiter" }).click();
  await expect(page.getByText("Schritt 5 von 6")).toBeVisible();
  await page.getByRole("button", { name: "Speichern und weiter" }).click();
  await expect(page.getByText("Schritt 6 von 6")).toBeVisible();

  await expect(page.getByRole("heading", { name: "Hinweis: Waffen und Munition" })).toBeVisible();
  await expect(page.getByText("Titel: „Munition“")).toBeVisible();
  await page.getByRole("button", { name: "Zur Prüfung absenden" }).click();
  await expect(page).toHaveURL("/de/account/listings?notice=submitted");
});

// Die übrigen vier Arten per Pflichtfeld-Prüfung (Plan M3 Commit 13): Die Vorschau nennt genau die
// fehlenden Angaben der Art, mit Link zum Schritt.
const KIND_CASES = [
  { kind: "Begehungsschein", missing: ["Bitte wähle den Umfang des Begehungsscheins.", "Bitte gib an, ob der Begehungsschein entgeltlich ist.", "Bitte wähle mindestens eine Wildart."] },
  { kind: "Gesellschaftsjagd", missing: ["Bitte gib das Datum der Jagd an.", "Bitte gib die Zahl der freien Plätze an (1 bis 500)."] },
  { kind: "Trophäen-/Gastjagd", missing: ["Bitte bestätige, dass du die rechtlichen Voraussetzungen kennst.", "Bitte wähle mindestens eine Wildart."] },
  { kind: "Jagdhelfer/Mitjäger", missing: ["Bitte nenne mindestens eine Aufgabe."] },
];

test("Pflichtfelder je Art: Vorschau nennt, was fehlt", async ({ page }) => {
  await signUp(page, "Arten Test");
  for (const { kind, missing } of KIND_CASES) {
    await page.goto("/de/account/listings/new");
    await page.getByLabel(kind).check();
    await page.getByLabel("Angebot", { exact: true }).check();
    await page.getByLabel("Titel").fill(`${kind} bei Dresden`);
    await page.getByLabel("Landkreis bzw. Bezirk").selectOption({ label: "Dresden" });
    await page.getByRole("button", { name: "Entwurf anlegen" }).click();
    await expect(page.getByText("Schritt 2 von 6")).toBeVisible();
    await page.getByLabel("PLZ des Reviers").fill("01067");
    await page.getByLabel("Ort des Reviers").fill("Dresden");
    await page.getByRole("button", { name: "Speichern und weiter" }).click();
    await expect(page.getByText("Schritt 3 von 6")).toBeVisible();
    await page.getByLabel("Beschreibung").fill(`Ausführliche Beschreibung für ${kind}, mehr als dreißig Zeichen.`);
    await page.getByRole("button", { name: "Speichern und weiter" }).click();
    await expect(page.getByText("Schritt 4 von 6")).toBeVisible();
    await page.getByRole("link", { name: /Vorschau und Absenden/ }).click();

    const section = page.getByRole("region", { name: "Vor dem Absenden fehlt noch:" });
    await expect(section.getByRole("listitem")).toHaveText(missing);
    // Absenden ist trotzdem möglich zu versuchen; die DB lehnt mit denselben Feldcodes ab.
    await page.getByRole("button", { name: "Zur Prüfung absenden" }).click();
    await expect(page.getByRole("alert").getByRole("listitem")).toHaveCount(missing.length);
  }
});
