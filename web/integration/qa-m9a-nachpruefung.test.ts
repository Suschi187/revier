import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fixture, SKIPPED } from "./context";
import { acceptLegal, createSignedInUser, deleteUsers, serviceClient } from "./helpers";
import { localRows, localSql } from "./totp";

// QA M9a – Nachprüfung (docs/QA-REPORT.md). Gegen den echten Stack:
// - F1: Eine Adresse mit „&“ schreibt GoTrue im Auth-Audit als &. finalize vergleicht den JSON-Text; die Probe
//   prüft, dass trotzdem kein Eintrag mit der Adresse bleibt (die Einträge tragen auch die Nutzer-ID).
// - F3: Ein Realtime-Ereignis, das das Gegenüber nach prepare eines abgebrochenen Laufs auslöst (Unterhaltung
//   gelesen), entfernt der nächste Lauf (prepare läuft erneut vor deleteUser).

const f = fixture();
const created: string[] = [];

/** Fundstellen eines Werts in allen Nicht-System-Schemas (to_jsonb dekodiert &). */
function hits(needle: string): string[] {
  if (!/^[a-z0-9@.&+-]+$/.test(needle)) throw new Error("Nadel");
  return localRows<{ rel: string }>(`
    select rel from (
      select n.nspname || '.' || c.relname as rel, (xpath('/row/n/text()', query_to_xml(format(
        'select count(*) as n from %I.%I t where position(%L in lower(to_jsonb(t)::text)) > 0', n.nspname, c.relname, '${needle.toLowerCase()}'),
        false, true, '')))[1]::text as h
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where c.relkind in ('r', 'p') and not c.relispartition and n.nspname !~ '^pg_' and n.nspname not in ('information_schema', 'tests')
    ) x where h <> '0' order by 1`).map((r) => r.rel);
}

describe.skipIf(!f)("QA M9a Nachprüfung gegen den echten Stack", () => {
  const fx = f ?? SKIPPED;
  const service = serviceClient(fx);
  let secret = "";
  let url: string | null = null;
  let region = "";

  beforeAll(async () => {
    secret = localRows<{ s: string }>("select decrypted_secret as s from vault.decrypted_secrets where name = 'account_deletion_secret'")[0].s;
    url = localRows<{ s: string }>("select decrypted_secret as s from vault.decrypted_secrets where name = 'account_deletion_url'")[0]?.s ?? null;
    if (url) localSql("delete from vault.secrets where name = 'account_deletion_url'");
    region = (await service.from("regions").select("id").eq("code", "DE-14628").single()).data!.id as string;
  });
  afterAll(async () => {
    const ids = created.filter((id) => /^[0-9a-f-]{36}$/.test(id));
    if (ids.length) {
      localSql(`delete from realtime.messages where topic in (${ids.map((id) => `'user:${id}'`).join(",")})`);
      localSql(`delete from private.account_deletions where user_id in (${ids.map((id) => `'${id}'`).join(",")})`);
    }
    await deleteUsers(fx, created);
    if (url && /^https?:\/\/[\w.:/-]+$/.test(url)) localSql(`select vault.create_secret('${url}', 'account_deletion_url')`);
  });

  const run = async () => (await fetch(`${fx.url}/functions/v1/delete-account`, { method: "POST", headers: { "x-account-deletion-secret": secret } })).json();
  const onlyDue = (id: string) => localSql(`update private.account_deletions set next_attempt_at = now() + interval '1 day' where user_id <> '${id}'`);

  it("F1: Adresse mit & (im Auth-Audit als \\u0026): nach der Löschung weder Adresse noch ID", async () => {
    const email = `qa9n&amp${Date.now()}@test.local`;
    const made = await service.auth.admin.createUser({ email, email_confirm: true });
    expect(made.error).toBeNull();
    const id = made.data.user!.id;
    created.push(id);
    expect((await service.auth.admin.generateLink({ type: "magiclink", email })).error).toBeNull();
    expect(localRows<{ n: number }>(`select count(*)::int as n from auth.audit_log_entries where payload::text like '%qa9n\\\\u0026amp%'`)[0].n).toBeGreaterThan(0);
    localSql(`insert into private.account_deletions (user_id, email) select id, email from auth.users where id = '${id}'`);
    localSql(`update public.profiles set deleted_at = now() where user_id = '${id}'`);
    onlyDue(id);
    expect(((await run()) as { done: number }).done).toBe(1);
    expect(hits(email)).toEqual([]);
    expect(hits(id)).toEqual([]);
  });

  it("F3: Ereignis des Gegenübers nach prepare eines abgebrochenen Laufs entfernt der nächste Lauf", async () => {
    const u = await createSignedInUser(fx, "qa9n-u");
    const v = await createSignedInUser(fx, "qa9n-v");
    created.push(u.id, v.id);
    for (const x of [u, v]) await acceptLegal(x.client);
    const listing = (await service.from("listings")
      .insert({ owner_id: u.id, kind: "helper", direction: "wanted", title: "QA9n", content_language: "de", region_id: region }).select("id").single()).data!.id as string;
    await service.from("listings").update({ status: "active", expires_at: new Date(Date.now() + 864e5 * 30).toISOString() }).eq("id", listing);
    const conv = await v.client.rpc("start_conversation", { p_listing_id: listing, p_body: "QA9n Frage" });
    expect(conv.error).toBeNull();
    expect((await u.client.rpc("send_message", { p_conversation_id: conv.data, p_body: "QA9n Antwort" })).error).toBeNull();
    expect((await u.client.rpc("request_account_deletion")).error).toBeNull();
    onlyDue(u.id);
    const claim = ((await service.rpc("account_deletion_claim", { p_secret: secret, p_limit: 5 })).data as { user_id: string; claim_id: string }[])
      .find((c) => c.user_id === u.id)!.claim_id;
    expect((await service.rpc("account_deletion_prepare", { p_claim_id: claim, p_user_id: u.id })).error).toBeNull();
    // Das Gegenüber liest die Unterhaltung nach prepare (sie besteht noch, U hat deleted_at).
    expect((await v.client.rpc("mark_conversation_read", { p_conversation_id: conv.data })).error).toBeNull();
    const late = localRows<{ n: number }>(`select count(*)::int as n from realtime.messages where payload ->> 'conversation_id' = '${conv.data}'`)[0].n;
    expect(late, "neues Ereignis nach prepare").toBeGreaterThan(0);
    // Lauf bricht ab (Lease läuft ab); der nächste Lauf ruft prepare erneut vor deleteUser.
    localSql(`update private.account_deletions set claimed_until = now() - interval '1 second', next_attempt_at = now() where user_id = '${u.id}'`);
    expect(((await run()) as { done: number }).done).toBe(1);
    expect(hits(String(conv.data))).toEqual([]);
    expect(hits(u.id)).toEqual([]);
  }, 60_000);
});
