import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fixture, SKIPPED } from "./context";
import { acceptLegal, createSignedInUser, deleteUsers, JPEG, rest, serviceClient } from "./helpers";
import { enrollTotp, localRows, localSql, makeAdmin } from "./totp";

// QA M9b – Abnahme (docs/QA-REPORT.md, Abschnitt „M9b – Abnahme“). Proben gegen den echten Stack über
// verification.test.ts und trust-mails.test.ts hinaus:
// - Flags revier.* sind über PostgREST nicht setzbar (set_config und private Helfer nicht erreichbar).
// - B3 über die Storage-API: list() ohne Audit leer, Audit eines Admins gilt nicht für einen anderen, und eine
//   im Fenster erzeugte signierte URL mit langer Laufzeit (F6, behoben: kein Lesen über die Storage-API mehr).
// - Der Bucket prüft nur den gemeldeten Typ: eine HTML-Datei als image/png lässt sich hochladen und einreichen
//   (die Magic-Bytes-Prüfung im Admin muss greifen, E2E qa-m9b.spec.ts).
// - Kontolöschung über die Function mit Verifizierung, Beschwerde, Zählerzeile und Dienstmail: kein Rest außerhalb
//   der Allowlist, keine Datei im Dokument-Bucket.

const f = fixture();
const ALLOWED: Record<string, string[]> = {
  "public.audit_log": ["target_id"],
  "public.reports": ["target_id"],
  "private.reported_message_snapshots": ["sender_id", "body", "message_id", "conversation_id"],
};

/** Fundstellen einer Nadel in allen Nicht-System-Schemas (to_jsonb, ohne Allowlist-Spalten), wie qa-m9a.test.ts. */
function residue(needle: string): string[] {
  if (!/^[A-Za-z0-9@.\- ]+$/.test(needle)) throw new Error("Nadel");
  const allowed = Object.entries(ALLOWED).map(([rel, cols]) => `('${rel}', array[${cols.map((c) => `'${c}'`).join(",")}])`).join(",");
  return localRows<{ rel: string }>(`
    with allow(rel, cols) as (values ${allowed}),
    rels as (
      select n.nspname as nsp, c.relname as name, n.nspname || '.' || c.relname as rel,
             coalesce((select array_agg(a.attname::text) from pg_attribute a join pg_type t on t.oid = a.atttypid
                       where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
                         and t.typname in ('geometry', 'geography', 'raster', 'bytea')), '{}')
             || coalesce((select al.cols from allow al where al.rel = n.nspname || '.' || c.relname), '{}') as excl
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where c.relkind in ('r', 'p', 'm') and not c.relispartition
        and n.nspname !~ '^pg_' and n.nspname not in ('information_schema', 'tests')
    )
    select rel from (
      select r.rel, (xpath('/row/n/text()', query_to_xml(format(
        'select count(*) as n from %I.%I t where position(%L in lower((to_jsonb(t) - %L::text[])::text)) > 0',
        r.nsp, r.name, '${needle.toLowerCase()}', r.excl), false, true, '')))[1]::text as hits
      from rels r
    ) x where hits <> '0' order by 1`).map((r) => r.rel);
}

describe.skipIf(!f)("QA M9b: Flags, Dokumentzugriff und Löschung gegen den echten Stack", () => {
  const fx = f ?? SKIPPED;
  const service = serviceClient(fx);
  const users: string[] = [];
  let owner: Awaited<ReturnType<typeof createSignedInUser>>;
  let modA: Awaited<ReturnType<typeof createSignedInUser>>;
  let modB: Awaited<ReturnType<typeof createSignedInUser>>;
  let request: { id: string; path: string };
  let delSecret = "";
  let url: string | null = null;

  beforeAll(async () => {
    [owner, modA, modB] = await Promise.all(["qa9b-owner", "qa9b-a", "qa9b-b"].map((l) => createSignedInUser(fx, l)));
    users.push(owner.id, modA.id, modB.id);
    await acceptLegal(owner.client);
    for (const mod of [modA, modB]) {
      makeAdmin(mod.id);
      await enrollTotp(mod.client);
    }
    const begun = await owner.client.rpc("begin_verification", { p_document_type: "jagdschein" });
    expect(begun.error).toBeNull();
    request = begun.data as { id: string; path: string };
    expect((await owner.client.storage.from("verification-docs").upload(request.path, JPEG, { contentType: "image/jpeg" })).error).toBeNull();
    expect((await owner.client.rpc("submit_verification", { p_id: request.id })).error).toBeNull();
    delSecret = localRows<{ s: string }>("select decrypted_secret as s from vault.decrypted_secrets where name = 'account_deletion_secret'")[0].s;
    url = localRows<{ s: string }>("select decrypted_secret as s from vault.decrypted_secrets where name = 'account_deletion_url'")[0]?.s ?? null;
  });

  afterAll(async () => {
    const list = users.map((id) => `'${id}'`).join(",");
    const names = localRows<{ name: string }>(`select name from storage.objects where bucket_id = 'verification-docs' and split_part(name, '/', 1) in (${list})`);
    if (names.length) await service.storage.from("verification-docs").remove(names.map((n) => n.name));
    localSql(`delete from private.account_deletions where user_id in (${list})`);
    await deleteUsers(fx, users);
    const current = localRows<{ s: string }>("select decrypted_secret as s from vault.decrypted_secrets where name = 'account_deletion_url'")[0]?.s;
    if (url && !current && /^https?:\/\/[\w.:/-]+$/.test(url)) localSql(`select vault.create_secret('${url}', 'account_deletion_url')`);
  });

  it("Flags revier.* lassen sich über PostgREST nicht setzen; private Helfer sind nicht erreichbar", async () => {
    for (const fn of ["set_config", "moderation_path", "verification_document_viewed", "set_account_blocked", "warn_account", "decisions_for"]) {
      const response = await rest(fx, `rpc/${fn}`, { token: modA.token, method: "POST", body: { setting_name: "revier.appeal", new_value: "on", is_local: true } });
      expect(response.status, fn).toBe(404);
    }
    // Auch über Accept-Profile auf pg_catalog bzw. private nicht
    for (const profile of ["pg_catalog", "private"]) {
      const response = await rest(fx, "rpc/set_config", {
        token: owner.token, method: "POST", headers: { "Content-Profile": profile },
        body: { setting_name: "revier.appeal", new_value: "on", is_local: true },
      });
      expect(response.status, profile).toBe(406);
    }
  });

  it("B3: list() leer; auch nach dem Audit kein Zugriff über die Storage-API, für keinen Admin (seit F6)", async () => {
    const folder = request.path.split("/")[0];
    expect((await modA.client.storage.from("verification-docs").list(folder)).data ?? []).toEqual([]);
    expect((await modA.client.rpc("admin_open_verification_document", { p_id: request.id })).error).toBeNull();
    expect((await modA.client.storage.from("verification-docs").createSignedUrl(request.path, 60)).data).toBeNull();
    expect((await modB.client.storage.from("verification-docs").createSignedUrl(request.path, 60)).data).toBeNull();
    expect((await modB.client.storage.from("verification-docs").download(request.path)).data).toBeNull();
    // Anon und ein dritter Nutzer ohnehin nicht
    expect((await service.storage.from("verification-docs").exists(request.path)).data).toBe(true);
  });

  it("F6 (behoben): Auch nach dem Audit lässt sich keine signierte URL mit langer Laufzeit erzeugen", async () => {
    expect((await modA.client.rpc("admin_open_verification_document", { p_id: request.id })).error).toBeNull();
    const signed = await modA.client.storage.from("verification-docs").createSignedUrl(request.path, 365 * 24 * 3600);
    expect(signed.data).toBeNull();
  });

  it("Bucket prüft nur den gemeldeten Typ: HTML als image/png lässt sich hochladen und einreichen", async () => {
    const other = await createSignedInUser(fx, "qa9b-html");
    users.push(other.id);
    await acceptLegal(other.client);
    const begun = (await other.client.rpc("begin_verification", { p_document_type: "jagdkarte" })).data as { id: string; path: string };
    const html = new TextEncoder().encode("<html><script>alert(1)</script></html>");
    expect((await other.client.storage.from("verification-docs").upload(begun.path, html, { contentType: "image/png" })).error).toBeNull();
    expect((await other.client.rpc("submit_verification", { p_id: begun.id })).error).toBeNull();
    // Die Absicherung liegt in der Admin-Ansicht (Magic Bytes), siehe e2e/qa-m9b.spec.ts.
  });

  it("Kontolöschung mit Verifizierung, Sperre, Beschwerde, Zählerzeile und Dienstmail: kein Rest außerhalb der Allowlist", async () => {
    const blocked = await modA.client.rpc("admin_set_account_blocked", { p_user_id: owner.id, p_blocked: true, p_code: "spam", p_note: "QA9B Sperre" });
    expect(blocked.error).toBeNull();
    const decision = ((await owner.client.rpc("my_decisions")).data ?? []).find((d: { action: string }) => d.action === "profile.blocked") as { id: string };
    expect((await owner.client.rpc("submit_appeal", { p_decision_id: decision.id, p_text: "QA9B Beschwerde gegen die Sperre." })).error).toBeNull();
    const before = localRows<{ a: number; n: number; v: number; p: number }>(`select
      (select count(*) from public.appeals where user_id = '${owner.id}')::int as a,
      (select count(*) from private.account_notifications where user_id = '${owner.id}')::int as n,
      (select count(*) from private.verification_attempts where user_id = '${owner.id}')::int as v,
      (select count(*) from public.verifications where user_id = '${owner.id}')::int as p`)[0];
    expect(before).toEqual({ a: 1, n: 1, v: 1, p: 1 });

    // Ohne URL stößt pg_net nichts an; die Probe ruft die Function selbst (wie qa-m9a.test.ts).
    if (url) localSql("delete from vault.secrets where name = 'account_deletion_url'");
    expect((await owner.client.rpc("request_account_deletion")).error).toBeNull();
    localSql(`update private.account_deletions set next_attempt_at = now() + interval '1 day' where user_id <> '${owner.id}'`);
    const response = await fetch(`${fx.url}/functions/v1/delete-account`, { method: "POST", headers: { "x-account-deletion-secret": delSecret } });
    expect(response.status).toBe(200);
    await expect.poll(() => localRows<{ n: number }>(`select count(*)::int as n from private.account_deletions where user_id = '${owner.id}'`)[0].n, { timeout: 15_000 }).toBe(0);

    expect(residue(owner.id)).toEqual([]);
    expect(residue(owner.email)).toEqual([]);
    expect(residue("QA9B Beschwerde")).toEqual([]);
    expect((await service.storage.from("verification-docs").exists(request.path)).data).toBe(false);
    // Bleibt: Audit der Sperre (target_id als Pseudonym, ADR 019), ohne user_id in den Details.
    const audit = localRows<{ d: string }>(`select details::text as d from public.audit_log where target_id = '${owner.id}' and action = 'profile.blocked'`);
    expect(audit).toHaveLength(1);
    expect(audit[0].d).not.toContain(owner.id);
  });
});
