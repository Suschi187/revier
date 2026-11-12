import { expect, test, type Browser } from "@playwright/test";
import { admin, deleteTestUsers, local } from "./cleanup";
import { createAccount, createPublicListing, sessionCookies, signInAs, type TestAccount } from "./session";
import { enrollTotp, localRows, makeAdmin } from "../integration/totp";

// QA M9b – Nachprüfung (docs/QA-REPORT.md). Web-Route /api/admin/verifications/:id/document (F6): Header genau einmal
// (no-store, sandbox, no-referrer, nosniff), kein Cookie, ohne Session und für Nutzer kein Inhalt, Audit je Abruf,
// PDF als Download; Seite ohne JavaScript (Bild über die Route, Hinweis bei falschen Bytes). F5 ohne JavaScript:
// Kartenpunkt nimmt nur den Anzeigen-Grund.

const created: string[] = [];
test.afterAll(() => deleteTestUsers(created));
test.use({ javaScriptEnabled: false });

async function adminAccount(label: string): Promise<TestAccount> {
  const mod = await createAccount(label, "QA9n Admin", created);
  makeAdmin(mod.id);
  await enrollTotp(mod.client);
  return { ...mod, cookies: await sessionCookies(mod.client) };
}
async function contextFor(browser: Browser, account: TestAccount) {
  const context = await browser.newContext({ javaScriptEnabled: false });
  await signInAs(context, account);
  return context;
}
const viewed = (id: string) => localRows<{ n: number }>(`select count(*)::int as n from public.audit_log
  where action = 'verification.document_viewed' and target_id = '${id}'`)[0].n;

test.describe("QA M9b Nachprüfung", () => {
  test.skip(!local, "Lokale Supabase nötig");
  test.setTimeout(180_000);

  test("Dokument-Route: Header, Rechte, Audit je Abruf, PDF als Download", async ({ browser, request }) => {
    const owner = await createAccount("qa9n-docj", "QA9n Jpeg", created);
    const pdfOwner = await createAccount("qa9n-docp", "QA9n Pdf", created);
    const jpeg = (await owner.client.rpc("begin_verification", { p_document_type: "jagdschein" })).data as { id: string; path: string };
    await owner.client.storage.from("verification-docs").upload(jpeg.path, new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0xff, 0xd9]), { contentType: "image/jpeg" });
    await owner.client.rpc("submit_verification", { p_id: jpeg.id });
    const pdf = (await pdfOwner.client.rpc("begin_verification", { p_document_type: "jagdkarte" })).data as { id: string; path: string };
    await pdfOwner.client.storage.from("verification-docs").upload(pdf.path, new TextEncoder().encode("%PDF-1.4\n"), { contentType: "application/pdf" });
    await pdfOwner.client.rpc("submit_verification", { p_id: pdf.id });
    const route = (id: string) => `/api/admin/verifications/${id}/document`;

    // Ohne Session und als Nutzer: kein Inhalt, kein Audit
    const anon = await request.get(route(jpeg.id));
    expect(anon.status()).toBe(404);
    expect(anon.headers()["set-cookie"]).toBeUndefined();
    const userContext = await contextFor(browser, owner);
    const asUser = await userContext.request.get(route(jpeg.id));
    expect([403, 404]).toContain(asUser.status());
    expect(viewed(jpeg.id)).toBe(0);
    await userContext.close();

    const mod = await adminAccount("qa9n-docm");
    const modContext = await contextFor(browser, mod);
    const unknown = await modContext.request.get(route(crypto.randomUUID()));
    const invalid = await modContext.request.get("/api/admin/verifications/abc/document");
    expect(unknown.status()).toBe(404);
    expect(invalid.status()).toBe(404);

    const image = await modContext.request.get(route(jpeg.id));
    expect(image.status()).toBe(200);
    const headers = image.headersArray();
    const all = (name: string) => headers.filter((h) => h.name.toLowerCase() === name).map((h) => h.value);
    expect(all("content-type")).toEqual(["image/jpeg"]);
    expect(all("cache-control")).toEqual(["private, no-store"]);
    expect(all("x-content-type-options")).toEqual(["nosniff"]);
    expect(all("set-cookie")).toEqual([]);
    // Header genau einmal: die allgemeine Regel in next.config.ts darf sie nicht überschreiben (wie QA M9a F4)
    // N2: die allgemeine Regel setzt Referrer-Policy und CSP der App (geprüft getrennt im Test „N2“)
    expect(all("content-security-policy").length, "CSP vorhanden").toBeGreaterThan(0);
    await modContext.request.get(route(jpeg.id));
    expect(viewed(jpeg.id)).toBe(2);

    const doc = await modContext.request.get(route(pdf.id));
    expect(doc.status()).toBe(200);
    expect(doc.headers()["content-type"]).toBe("application/pdf");
    expect(doc.headers()["content-disposition"]).toMatch(/^attachment;/);

    // Seite ohne JavaScript: Link „Dokument anzeigen“ per GET, PDF als Link ohne neues Fenster
    const page = await modContext.newPage();
    await page.goto(`/de/admin/verifications/${pdf.id}`);
    await page.getByRole("button", { name: "Dokument anzeigen" }).click();
    await expect(page).toHaveURL(new RegExp(`\\?document=1#document$`));
    const link = page.getByRole("link", { name: "PDF herunterladen" });
    expect(await link.getAttribute("href")).toBe(route(pdf.id));
    expect(await link.getAttribute("target")).toBeNull();
    // Das Rendern der Seite selbst schreibt kein Audit, erst der Abruf
    expect(viewed(pdf.id)).toBe(1);
    await modContext.close();
    await admin().storage.from("verification-docs").remove([jpeg.path, pdf.path]);
  });

  test("N2: Referrer-Policy und CSP der Dokument-Route werden von next.config.ts überschrieben", async ({ browser }) => {
    test.fail(true, "N2: /api/admin/verifications/:id/document fällt unter die allgemeine Header-Regel (wie QA M9a F4)");
    const owner = await createAccount("qa9n-n2", "QA9n N2", created);
    const v = (await owner.client.rpc("begin_verification", { p_document_type: "jagdschein" })).data as { id: string; path: string };
    await owner.client.storage.from("verification-docs").upload(v.path, new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0xff, 0xd9]), { contentType: "image/jpeg" });
    await owner.client.rpc("submit_verification", { p_id: v.id });
    const mod = await adminAccount("qa9n-n2m");
    const context = await contextFor(browser, mod);
    const response = await context.request.get(`/api/admin/verifications/${v.id}/document`);
    const headers = response.headersArray();
    const all = (name: string) => headers.filter((h) => h.name.toLowerCase() === name).map((h) => h.value);
    await context.close();
    await admin().storage.from("verification-docs").remove([v.path]);
    console.log(`N2 headers: ${JSON.stringify({ referrer: all("referrer-policy"), csp: all("content-security-policy"), frame: all("x-frame-options") })}`);
    expect(all("referrer-policy")).toEqual(["no-referrer"]);
    expect(all("content-security-policy")).toEqual(["default-src 'none'; sandbox"]);
  });

  test("F5 ohne JavaScript: Kartenpunkt nimmt nur den Anzeigen-Grund, der Konto-Grund wird ignoriert", async ({ browser }) => {
    const owner = await createAccount("qa9n-pt", "QA9n Punkt", created);
    const listing = await createPublicListing(owner.id, "QA9n Punktprobe");
    // Punkt setzt der Besitzer (wie pgTAP 54); danach wieder aktiv über den Server-Pfad
    const service = admin();
    const row = (await service.from("listings").select("region_id").eq("id", listing).single()).data!;
    const place = (await service.from("listing_places").select("postal_code").eq("listing_id", listing).maybeSingle()).data;
    await service.from("listings").update({ description: "Beschreibung mit mehr als dreißig Zeichen für die Prüfung." }).eq("id", listing);
    await service.from("listing_species").upsert({ listing_id: listing, species_code: "roe_deer" });
    const set = await owner.client.rpc("set_listing_location", {
      p_listing_id: listing, p_region_id: row.region_id, p_postal_code: place?.postal_code ?? null, p_place_name: "Testort", p_point: "set", p_lat: 50.95, p_lng: 13.95,
    });
    expect(set.error).toBeNull();
    // Der Punkt nahm die Anzeige aus der Öffentlichkeit; Server-Pfad wie e2e/session.ts
    await service.from("listings").update({ status: "active", expires_at: new Date(Date.now() + 30 * 864e5).toISOString() }).eq("id", listing);
    const reporter = await createAccount("qa9n-ptr", "QA9n Melder", created);
    expect((await reporter.client.from("reports").insert({ target_type: "listing", target_id: listing, reason: "other" })).error).toBeNull();
    const mod = await adminAccount("qa9n-ptm");
    const context = await contextFor(browser, mod);
    const page = await context.newPage();
    await page.goto(`/de/admin/reports/listing/${listing}`);
    await page.getByLabel("Kartenpunkt entfernen").check();
    // Nur Konto-Grund gewählt: abgelehnt
    await page.getByLabel("Grund für das Konto").selectOption({ label: "Spam oder irreführende Werbung" });
    await page.getByLabel("Begründung für die Betroffenen").fill("Hochsitz erkennbar.");
    await page.getByRole("button", { name: "Meldungen erledigen" }).click();
    await expect(page.getByRole("alert")).toBeVisible();
    expect(page.url()).toContain("error=code");
    await page.getByLabel("Kartenpunkt entfernen").check();
    await page.getByLabel("Grund für die Anzeige").selectOption({ label: "Anderer Grund" });
    await page.getByLabel("Grund für das Konto").selectOption({ label: "Spam oder irreführende Werbung" });
    await page.getByLabel("Begründung für die Betroffenen").fill("Hochsitz erkennbar.");
    await page.getByRole("button", { name: "Meldungen erledigen" }).click();
    await expect(page).toHaveURL(/\/de\/admin\/reports\?notice=resolved/);
    const audit = localRows<{ d: string }>(`select details::text as d from public.audit_log where action = 'listing.point_removed' and target_id = '${listing}'`);
    expect(audit).toHaveLength(1);
    expect(JSON.parse(audit[0].d)).toMatchObject({ code: "other", reason: "Hochsitz erkennbar." });
    await context.close();
  });
});
