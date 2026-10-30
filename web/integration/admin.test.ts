import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fixture, SKIPPED } from "./context";
import { anonClient, createSignedInUser, deleteUsers, serviceClient, userClient } from "./helpers";
import { enrollTotp, makeAdmin } from "./totp";

// M4 (ADR 014) über die echte API mit echtem aal2: Freigabe macht die Anzeige öffentlich (Akzeptanz a),
// Ablehnung zeigt Code und Freitext dem Besitzer (b), Version schützt vor ungesehenen Änderungen (B1),
// Rollenänderung mit frischem TOTP aus dem echten Claim amr (B2).

const f = fixture();

function claims(token: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
}

describe.skipIf(!f)("Moderation und Admin-Verwaltung über PostgREST", () => {
  const fx = f ?? SKIPPED;
  const { a, c } = fx.users;
  const service = serviceClient(fx);
  const users: string[] = [];
  const listings: string[] = [];
  let mod: Awaited<ReturnType<typeof createSignedInUser>>;
  let candidate: Awaited<ReturnType<typeof createSignedInUser>>;
  let accessBefore: unknown;

  beforeAll(async () => {
    [mod, candidate] = await Promise.all([createSignedInUser(fx, "mod"), createSignedInUser(fx, "kandidat")]);
    users.push(mod.id, candidate.id);
    makeAdmin(mod.id);
    accessBefore = (await mod.client.rpc("admin_access").single()).data;
    await enrollTotp(mod.client);
  });

  afterAll(async () => {
    if (listings.length) {
      await service.from("audit_log").delete().in("target_id", listings);
      await service.from("listings").delete().in("id", listings);
    }
    await deleteUsers(fx, users);
  });

  async function submitted(title: string): Promise<string> {
    const owner = userClient(fx, a);
    const res = await owner
      .from("listings")
      .insert({
        kind: "helper", direction: "wanted", title, content_language: "de", region_id: fx.ids.district,
        description: "Wir suchen Hilfe beim Ansitzbau im Frühjahr, zwei Wochenenden.", attributes: { tasks: ["Ansitzbau"] },
      })
      .select("id")
      .single<{ id: string }>();
    expect(res.error).toBeNull();
    listings.push(res.data!.id);
    expect((await owner.from("listings").update({ status: "pending_review" }).eq("id", res.data!.id)).error).toBeNull();
    return res.data!.id;
  }

  async function version(id: string): Promise<string> {
    const res = await mod.client.rpc("admin_listing_version", { p_listing_id: id });
    expect(res.error).toBeNull();
    return res.data as string;
  }

  it("Zugangsstatus: Rolle ohne 2FA, nach TOTP aal2", async () => {
    expect(accessBefore).toEqual({ has_role: true, aal2: false });
    expect((await mod.client.rpc("admin_access").single()).data).toEqual({ has_role: true, aal2: true });
    expect((await userClient(fx, c).rpc("admin_access").single()).data).toEqual({ has_role: false, aal2: false });
  });

  it("Freigabe macht die Anzeige öffentlich (Akzeptanz a)", async () => {
    const id = await submitted("Freigabe über die API");
    expect((await anonClient(fx).from("listings").select("id").eq("id", id)).data).toEqual([]);
    const res = await mod.client.rpc("moderate_listing", { p_listing_id: id, p_decision: "approve", p_expected_version: await version(id) });
    expect(res.error).toBeNull();
    expect(res.data).toBe("active");
    expect((await anonClient(fx).from("listings").select("id, status").eq("id", id)).data).toEqual([{ id, status: "active" }]);
  });

  it("Ablehnung: Besitzer sieht Code und Freitext, Fremde nicht (Akzeptanz b)", async () => {
    const id = await submitted("Ablehnung über die API");
    const res = await mod.client.rpc("moderate_listing", {
      p_listing_id: id, p_decision: "reject", p_expected_version: await version(id), p_code: "contact_in_text", p_note: "Bitte ohne Telefonnummer.",
    });
    expect(res.error).toBeNull();
    const own = await userClient(fx, a).from("listings").select("status, reject_code, reject_reason").eq("id", id).single();
    expect(own.data).toEqual({ status: "rejected", reject_code: "contact_in_text", reject_reason: "Bitte ohne Telefonnummer." });
    expect((await userClient(fx, c).from("listings").select("id").eq("id", id)).data).toEqual([]);
  });

  it("Änderung nach dem Lesen der Version: RV004, zweite Entscheidung: RV003", async () => {
    const id = await submitted("Version über die API");
    const seen = await version(id);
    await userClient(fx, a).from("listings").update({ title: "Nachträglich geändert" }).eq("id", id);
    const changed = await mod.client.rpc("moderate_listing", { p_listing_id: id, p_decision: "approve", p_expected_version: seen });
    expect(changed.error?.code).toBe("RV004");
    const fresh = await version(id);
    expect((await mod.client.rpc("moderate_listing", { p_listing_id: id, p_decision: "request_changes", p_expected_version: fresh, p_code: "incomplete" })).error).toBeNull();
    const again = await mod.client.rpc("moderate_listing", { p_listing_id: id, p_decision: "approve", p_expected_version: fresh });
    expect(again.error?.code).toBe("RV003");
  });

  it("Roh-UPDATE durch den Admin scheitert (nur über die RPC)", async () => {
    const id = await submitted("Roh-UPDATE über die API");
    const res = await mod.client.from("listings").update({ status: "active" }).eq("id", id).select("id");
    expect(res.error?.code).toBe("42501");
  });

  it("Rollen: echter Claim amr mit TOTP, Suche per E-Mail, Ernennen und Entziehen", async () => {
    const { data } = await mod.client.auth.getSession();
    const amr = claims(data.session!.access_token).amr as { method: string; timestamp: number }[];
    expect(amr.some((e) => e.method === "totp" && Date.now() / 1000 - e.timestamp < 600)).toBe(true);

    const found = await mod.client.rpc("admin_find_user", { p_email: candidate.email.toUpperCase() });
    expect(found.data).toEqual([expect.objectContaining({ user_id: candidate.id, is_admin: false })]);
    expect(JSON.stringify(found.data)).not.toContain(candidate.email);

    expect((await candidate.client.rpc("grant_admin", { p_user_id: c.id })).error?.code).toBe("42501");
    expect((await mod.client.rpc("grant_admin", { p_user_id: candidate.id })).error).toBeNull();
    const list = await mod.client.rpc("admin_list_admins");
    expect((list.data as { user_id: string }[]).map((r) => r.user_id)).toEqual(expect.arrayContaining([mod.id, candidate.id]));
    expect((await mod.client.rpc("revoke_admin", { p_user_id: candidate.id })).error).toBeNull();
  });
});
