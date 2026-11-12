import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fixture, SKIPPED } from "./context";
import { acceptLegal, createSignedInUser, deleteUsers, serviceClient } from "./helpers";
import { enrollTotp, localRows, makeAdmin } from "./totp";

// M9b (ADR 020) über den echten Weg Admin-RPC (aal2) → Warteschlangen → Edge Function send-search-notifications →
// Mailpit:
// - Akzeptanz 2: Meldung einer Anzeige → Entfernen → Mail an den Besitzer mit Begründung (und Frist zum Anfechten)
//   und an die Meldende mit dem Ergebnis, ohne Angaben über das Gegenüber.
// - Akzeptanz 3: Sperre → Beschwerde → Entsperrung durch einen anderen Admin, mit Mails zu Sperre, Beschwerde und
//   Entsperrung.

const f = fixture();
const MAILPIT = process.env.MAILPIT_URL ?? "http://127.0.0.1:54324";
const FN = "send-search-notifications";

type Message = { ID: string; Subject: string };

async function mails(to: string): Promise<Message[]> {
  const response = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`);
  return ((await response.json()) as { messages: Message[] }).messages;
}

async function text(id: string): Promise<string> {
  return ((await (await fetch(`${MAILPIT}/api/v1/message/${id}`)).json()) as { Text: string }).Text;
}

async function mail(to: string, subject: string): Promise<string> {
  let found: Message | undefined;
  await expect.poll(async () => (found = (await mails(to)).find((m) => m.Subject === subject)), { timeout: 15_000 }).toBeTruthy();
  return text(found!.ID);
}

describe.skipIf(!f)("Meldungen, Sperre und Beschwerde: Dienstmails über die Edge Function (M9b)", () => {
  const fx = f ?? SKIPPED;
  const service = serviceClient(fx);
  const users: string[] = [];
  let secret = "";
  let owner: Awaited<ReturnType<typeof createSignedInUser>>;
  let reporter: Awaited<ReturnType<typeof createSignedInUser>>;
  let modA: Awaited<ReturnType<typeof createSignedInUser>>;
  let modB: Awaited<ReturnType<typeof createSignedInUser>>;
  let listing = "";

  const run = async () => {
    const response = await fetch(`${fx.url}/functions/v1/${FN}`, { method: "POST", headers: { "x-search-notify-secret": secret } });
    const body = await response.json();
    expect(response.status, JSON.stringify(body)).toBe(200);
    return body as { moderation: { sent: number }; account: { sent: number } };
  };

  beforeAll(async () => {
    secret = localRows<{ s: string }>("select decrypted_secret as s from vault.decrypted_secrets where name = 'search_notifications_secret'")[0].s;
    [owner, reporter, modA, modB] = await Promise.all(["m9b-mail-owner", "m9b-mail-rep", "m9b-mail-a", "m9b-mail-b"].map((l) => createSignedInUser(fx, l)));
    users.push(owner.id, reporter.id, modA.id, modB.id);
    await Promise.all([owner, reporter].map((u) => acceptLegal(u.client)));
    for (const mod of [modA, modB]) {
      makeAdmin(mod.id);
      await enrollTotp(mod.client);
    }
    // Öffentliche Anzeige über den Server-Pfad (wie e2e/session.ts)
    const inserted = await service.from("listings")
      .insert({ owner_id: owner.id, kind: "helper", direction: "wanted", title: "M9b Mailprobe", content_language: "de", region_id: fx.ids.district })
      .select("id").single();
    expect(inserted.error).toBeNull();
    listing = inserted.data!.id as string;
    expect((await service.from("listings").update({ status: "active", expires_at: new Date(Date.now() + 30 * 864e5).toISOString() }).eq("id", listing)).error).toBeNull();
    // Ausstehende Mails anderer Tests nicht mitzählen: diese Läufe senden sie, die Prüfungen filtern je Empfänger.
    await run();
  });

  afterAll(async () => {
    await service.from("listings").delete().eq("id", listing);
    await deleteUsers(fx, users);
  });

  it("Akzeptanz 2: Entfernen nach Meldung → Mail an den Besitzer mit Begründung und an die Meldende mit dem Ergebnis", async () => {
    expect((await reporter.client.from("reports").insert({ target_type: "listing", target_id: listing, reason: "weapons" })).error).toBeNull();
    const target = (await modA.client.rpc("admin_report_target", { p_target_type: "listing", p_target_id: listing })).data as { listing: { version: string } };
    const resolved = await modA.client.rpc("resolve_reports", {
      p_target_type: "listing", p_target_id: listing, p_outcome: "content_removed", p_code: "weapons",
      p_note: "Im Text werden Patronen angeboten.", p_expected_version: target.listing.version,
    });
    expect(resolved.error).toBeNull();
    const body = await run();
    expect(body.moderation.sent).toBeGreaterThanOrEqual(1);
    expect(body.account.sent).toBeGreaterThanOrEqual(1);

    const removed = await mail(owner.email, "Deine Anzeige auf Revier wurde entfernt");
    expect(removed).toContain("„M9b Mailprobe“");
    expect(removed).toContain("Grund: Waffen oder Munition angeboten");
    expect(removed).toContain("Hinweis der Moderation: Im Text werden Patronen angeboten.");
    expect(removed).toMatch(/Du kannst diese Entscheidung bis zum .+ anfechten:\nhttp:\/\/localhost:3000\/de\/account\/decisions/);
    expect(removed).toContain("[Vorläufiger Hinweis]");
    expect(removed).not.toContain("/imprint");

    const result = await mail(reporter.email, "Deine Meldung auf Revier wurde geprüft");
    expect(result).toContain("deine Meldung zu einer Anzeige wurde geprüft.");
    expect(result).toContain("Ergebnis: Inhalt entfernt");
    expect(result).toContain("/de/account/reports");
    // Nichts über das Gegenüber außer dem Ergebnis (Art. 16 Abs. 5)
    expect(result).not.toContain(owner.email);
    expect(result).not.toContain("Patronen");
    expect(result.toLowerCase()).not.toContain("m9b-mail-a");
  });

  it("Akzeptanz 3: Sperre → Beschwerde → Entsperrung durch einen anderen Admin, je mit Mail", async () => {
    const blocked = await modA.client.rpc("admin_set_account_blocked", {
      p_user_id: owner.id, p_blocked: true, p_code: "harassment", p_note: "Beleidigende Nachrichten.",
    });
    expect(blocked.error).toBeNull();
    await run();
    const blockMail = await mail(owner.email, "Dein Konto auf Revier wurde gesperrt");
    expect(blockMail).toContain("Grund: Belästigung oder Beleidigung");
    expect(blockMail).toContain("Begründung: Beleidigende Nachrichten.");
    expect(blockMail).toContain("/de/account/decisions");

    const decision = ((await owner.client.rpc("my_decisions")).data ?? []).find((d: { action: string }) => d.action === "profile.blocked") as { id: string };
    const appeal = await owner.client.rpc("submit_appeal", { p_decision_id: decision.id, p_text: "Die Nachrichten waren sachlich." });
    expect(appeal.error).toBeNull();
    const own = await modA.client.rpc("decide_appeal", { p_appeal_id: appeal.data as string, p_outcome: "reversed", p_note: "x" });
    expect(own.error?.code).toBe("42501");
    const decided = await modB.client.rpc("decide_appeal", { p_appeal_id: appeal.data as string, p_outcome: "reversed", p_note: "Keine Beleidigung erkennbar." });
    expect(decided.error).toBeNull();
    expect((await service.from("profiles").select("is_blocked").eq("user_id", owner.id).single()).data?.is_blocked).toBe(false);

    await run();
    const appealMail = await mail(owner.email, "Entscheidung über deine Beschwerde auf Revier");
    expect(appealMail).toContain("deine Beschwerde gegen die Entscheidung „Konto gesperrt“ wurde geprüft. Die Entscheidung wurde aufgehoben.");
    expect(appealMail).toContain("Begründung: Keine Beleidigung erkennbar.");
    const unblockMail = await mail(owner.email, "Dein Konto auf Revier ist wieder entsperrt");
    expect(unblockMail).toContain("Du kannst Revier wieder wie gewohnt nutzen.");
    // Nie die Identität der Admins
    for (const m of [blockMail, appealMail, unblockMail]) {
      expect(m).not.toContain(modA.email);
      expect(m).not.toContain(modB.email);
    }
  });
});
