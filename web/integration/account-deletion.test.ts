import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fixture, SKIPPED } from "./context";
import { acceptLegal, createSignedInUser, deleteUsers, serviceClient } from "./helpers";
import { enrollTotp, localRows, localSql, makeAdmin, nextTotpWindow } from "./totp";
import type { Fixture } from "./types";

// M9a, Akzeptanz a (ADR 019, Review B2): Ein gelöschter Account verschwindet aus allen Tabellen und Buckets, bis auf
// die Allowlist. Verbindlicher Nachweis gegen den echten lokalen Stack: Edge Function delete-account, GoTrue
// deleteUser, Storage-API; danach Gegenprobe je Bucket über die API und das Inventar über alle Nicht-System-Schemas.
// Dazu die Wiederaufnahme nach Abbrüchen: nach Storage-Durchlauf 1, nach deleteUser vor finalize, und ein Upload
// zwischen Durchlauf 1 und 2. Die Function wird direkt aufgerufen (ohne Vault-URL stößt pg_net nichts an).

const f = fixture();
const created: string[] = [];
const BUCKETS = ["listing-uploads", "listing-photos", "verification-docs"] as const;
// Allowlist der Reste (ADR 019, „Was bleibt“): Spalten, die nicht mitgesucht werden.
const ALLOWED: Record<string, string[]> = {
  "public.audit_log": ["target_id"],
  "public.reports": ["target_id"],
  "private.reported_message_snapshots": ["sender_id"],
};
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 0xff, 0xd9]);

/** Inventar wie pgTAP 48, als ein einziges Statement (query_to_xml), weil `supabase db query` nur eines erlaubt. */
function residue(userId: string, email: string): string[] {
  if (!/^[0-9a-f-]{36}$/.test(userId) || !/^[a-z0-9.@-]+$/.test(email.toLowerCase())) throw new Error("Eingabe");
  const allowed = Object.entries(ALLOWED).map(([rel, cols]) => `('${rel}', array[${cols.map((c) => `'${c}'`).join(",")}])`).join(",");
  const rows = localRows<{ rel: string; hits: string }>(`
    with allow(rel, cols) as (values ${allowed}),
    rels as (
      select n.nspname as nsp, c.relname as name, n.nspname || '.' || c.relname as rel,
             coalesce((select array_agg(a.attname::text) from pg_attribute a join pg_type t on t.oid = a.atttypid
                       where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
                         and t.typname in ('geometry', 'geography', 'bytea', 'raster')), '{}')
             || coalesce((select al.cols from allow al where al.rel = n.nspname || '.' || c.relname), '{}') as excl
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where c.relkind in ('r', 'p') and not c.relispartition
        and n.nspname !~ '^pg_' and n.nspname not in ('information_schema', 'tests')
    )
    select rel, hits from (
      select rel, (xpath('/row/n/text()', query_to_xml(format(
        'select count(*) as n from %I.%I t where position(%L in lower((to_jsonb(t) - %L::text[])::text)) > 0 or position(%L in lower((to_jsonb(t) - %L::text[])::text)) > 0',
        nsp, name, '${userId}', excl, '${email.toLowerCase()}', excl), false, true, '')))[1]::text as hits
      from rels
    ) x where hits <> '0' order by rel`);
  return rows.map((r) => `${r.rel} (${r.hits})`);
}

async function storageLeft(fx: Fixture, userId: string, paths: string[]): Promise<string[]> {
  const service = serviceClient(fx);
  const left: string[] = [];
  // list() ist nicht rekursiv: Wurzel des Nutzers und jeder bekannte Unterordner.
  const prefixes = [...new Set([userId, ...paths.map((p) => p.split("/").slice(0, -1).join("/"))])];
  for (const bucket of BUCKETS) {
    for (const prefix of prefixes) {
      const listed = await service.storage.from(bucket).list(prefix, { limit: 1000 });
      for (const o of listed.data ?? []) left.push(`${bucket}:${prefix}/${o.name}`);
    }
  }
  for (const path of paths) {
    for (const bucket of BUCKETS) {
      const download = await service.storage.from(bucket).download(path);
      if (!download.error) left.push(`${bucket}:${path} (Download)`);
    }
  }
  return left;
}

describe.skipIf(!f)("Account-Löschung gegen den echten Stack (Akzeptanz a)", () => {
  const fx = f ?? SKIPPED;
  const service = serviceClient(fx);
  let secret = "";
  let region = "";

  let url: string | null = null;

  beforeAll(async () => {
    secret = localRows<{ s: string }>("select decrypted_secret as s from vault.decrypted_secrets where name = 'account_deletion_secret'")[0].s;
    // Eine lokal gesetzte URL ließe pg_net die Function selbst anstoßen; das konkurrierte mit den Abbruchfällen.
    url = localRows<{ s: string }>("select decrypted_secret as s from vault.decrypted_secrets where name = 'account_deletion_url'")[0]?.s ?? null;
    if (url) localSql("delete from vault.secrets where name = 'account_deletion_url'");
    region = (await service.from("regions").select("id").eq("code", "DE-14628").single()).data!.id as string;
  });
  // Testreste entfernen, auch nach einem Fehlschlag: Dateien (über die API), Ankerzeilen und die Meldungen dieser
  // Datei samt Kopien. Im Betrieb bleiben Meldungen als Rest der Allowlist; hier verfälschten sie pgTAP-Zählungen.
  const reports: string[] = [];
  afterAll(async () => {
    // Namen aus storage.objects (list() ist nicht rekursiv), gelöscht über die API.
    const ids = created.filter((id) => /^[0-9a-f-]{36}$/.test(id));
    const objects = ids.length === 0 ? [] : localRows<{ bucket_id: string; name: string }>(
      `select bucket_id, name from storage.objects where split_part(name, '/', 1) in (${ids.map((id) => `'${id}'`).join(",")})`);
    for (const bucket of BUCKETS) {
      const names = objects.filter((o) => o.bucket_id === bucket).map((o) => o.name);
      if (names.length) await service.storage.from(bucket).remove(names);
    }
    if (reports.length) localSql(`delete from public.reports where id in (${reports.map((r) => `'${r}'`).join(",")})`);
    localSql("delete from private.account_deletions where email like 'it-del-%'");
    await deleteUsers(fx, created);
    if (url && /^https?:\/\/[\w.:/-]+$/.test(url)) localSql(`select vault.create_secret('${url}', 'account_deletion_url')`);
  });

  const run = async (header = secret) => {
    const response = await fetch(`${fx.url}/functions/v1/delete-account`, { method: "POST", headers: { "x-account-deletion-secret": header } });
    return { status: response.status, body: (await response.json()) as Record<string, number> };
  };
  const anchor = (id: string) => localRows<{ n: number }>(`select count(*)::int as n from private.account_deletions where user_id = '${id}'`)[0].n;

  /** Konto mit aktiver Anzeige und Dateien in allen Buckets; liefert die Pfade. */
  async function accountWithFiles(label: string): Promise<{ id: string; email: string; client: SupabaseClient; listing: string; paths: string[] }> {
    const user = await createSignedInUser(fx, `del-${label}`);
    created.push(user.id);
    await acceptLegal(user.client);
    const listing = (await service.from("listings")
      .insert({ owner_id: user.id, kind: "helper", direction: "wanted", title: `Del ${label}`, content_language: "de", region_id: region })
      .select("id").single()).data!.id as string;
    await service.from("listings").update({ status: "active", expires_at: new Date(Date.now() + 864e5 * 30).toISOString() }).eq("id", listing);
    const paths = [`${user.id}/${listing}/photo.jpg`, `${user.id}/${listing}/raw.jpg`, `${user.id}/doc.jpg`];
    for (const [bucket, path] of [["listing-photos", paths[0]], ["listing-uploads", paths[1]], ["verification-docs", paths[2]]] as const) {
      const { error } = await service.storage.from(bucket).upload(path, JPEG, { contentType: "image/jpeg", upsert: true });
      expect(error, `${bucket} Upload`).toBeNull();
    }
    await service.from("listing_photos").insert({ listing_id: listing, sort_order: 0, storage_path: paths[0], alt_text: "Foto" });
    return { ...user, listing, paths };
  }

  async function request(client: SupabaseClient): Promise<void> {
    const { error } = await client.rpc("request_account_deletion");
    expect(error).toBeNull();
  }

  /** Ein abgebrochener Lauf: Lease des Nutzers sofort ablaufen lassen, damit der nächste Lauf ihn wieder claimt. */
  function expireLease(id: string): void {
    localSql(`update private.account_deletions set claimed_until = now() - interval '1 second', next_attempt_at = now() where user_id = '${id}'`);
  }

  async function claimOwn(id: string): Promise<string> {
    // Andere fällige Zeilen nicht anfassen: nur die eigene ist fällig.
    localSql(`update private.account_deletions set next_attempt_at = now() + interval '1 day' where user_id <> '${id}'`);
    const { data, error } = await service.rpc("account_deletion_claim", { p_secret: secret, p_limit: 5 });
    expect(error).toBeNull();
    const own = (data as { user_id: string; claim_id: string }[]).find((c) => c.user_id === id);
    expect(own, "Claim der eigenen Zeile").toBeTruthy();
    return own!.claim_id;
  }

  async function storagePass(claim: string, id: string): Promise<void> {
    const { data } = await service.rpc("account_deletion_objects", { p_claim_id: claim, p_user_id: id });
    for (const o of (data ?? []) as { bucket_id: string; name: string }[]) await service.storage.from(o.bucket_id).remove([o.name]);
  }

  async function expectGone(user: { id: string; email: string; paths: string[] }): Promise<void> {
    expect(anchor(user.id), "Ankerzeile entfernt").toBe(0);
    const lookup = await service.auth.admin.getUserById(user.id);
    expect(lookup.data.user, "auth.users").toBeNull();
    expect(await storageLeft(fx, user.id, user.paths), "Storage über die API").toEqual([]);
    expect(residue(user.id, user.email), "Inventar über alle Nicht-System-Schemas").toEqual([]);
  }

  it("ohne Geheimnis 403, nur POST", async () => {
    expect((await run("falsch")).status).toBe(403);
    expect((await fetch(`${fx.url}/functions/v1/delete-account`)).status).toBe(405);
  });

  it("Normalfall: alle Daten, Dateien, Auth- und Realtime-Reste weg, nur die Allowlist bleibt", async () => {
    const u = await accountWithFiles("normal");
    const v = await createSignedInUser(fx, "del-counterpart");
    created.push(v.id);
    await acceptLegal(v.client);
    const lv = (await service.from("listings")
      .insert({ owner_id: v.id, kind: "helper", direction: "wanted", title: "Del Gegenüber", content_language: "de", region_id: region })
      .select("id").single()).data!.id as string;
    await service.from("listings").update({ status: "active", expires_at: new Date(Date.now() + 864e5 * 30).toISOString() }).eq("id", lv);

    // Chat in beide Richtungen (Realtime-Ereignisse entstehen per Trigger), Favorit, Blockierung, Suchauftrag.
    const conv = await v.client.rpc("start_conversation", { p_listing_id: u.listing, p_body: "Del Frage von Vera" });
    expect(conv.error).toBeNull();
    const reply = await u.client.rpc("send_message", { p_conversation_id: conv.data, p_body: "Del Antwort von Ute" });
    expect(reply.error).toBeNull();
    // Favorit und Suchauftrag über den Server-Pfad (die API schreibt sie nur per RPC).
    expect((await service.from("favorites").insert({ user_id: u.id, listing_id: lv })).error).toBeNull();
    expect((await service.from("saved_searches").insert({ user_id: u.id, name: "Del Suche", filters: { v: 1, kind: "helper" } })).error).toBeNull();
    await service.from("verifications").insert({ user_id: u.id, document_type: "jagdschein", document_path: u.paths[2] });
    // Meldungen: U meldet V, V meldet die Nachricht und das Profil von U (Reste der Allowlist).
    for (const [client, row] of [
      [u.client, { target_type: "listing", target_id: lv, reason: "scam" }],
      [v.client, { target_type: "message", target_id: reply.data, reason: "harassment" }],
      [v.client, { target_type: "profile", target_id: u.id, reason: "scam" }],
    ] as const) {
      const { error } = await client.from("reports").insert(row);
      expect(error).toBeNull();
    }
    reports.push(...localRows<{ id: string }>(`select id from public.reports where target_id in ('${lv}', '${reply.data}', '${u.id}')`).map((r) => r.id));
    // Export-Zähler und ehemaliger Admin mit MFA-Faktor (Rolle entzogen).
    expect((await u.client.rpc("export_my_data")).error).toBeNull();
    makeAdmin(u.id);
    localSql(`delete from private.user_roles where user_id = '${u.id}'`);
    // Ein Code an der Grenze des 30-s-Fensters kann abgelehnt werden: dann im nächsten Fenster noch einmal.
    try {
      await enrollTotp(u.client);
    } catch {
      await nextTotpWindow();
      await enrollTotp(u.client);
    }

    await request(u.client);
    const result = await run();
    expect(result.status).toBe(200);
    expect(result.body.done).toBeGreaterThanOrEqual(1);
    await expectGone(u);

    // Reste und das Gegenüber.
    expect(localRows<{ n: number }>(`select count(*)::int as n from public.reports where target_id = '${u.id}'`)[0].n).toBe(1);
    expect(localRows<{ n: number }>(`select count(*)::int as n from private.reported_message_snapshots where sender_id = '${u.id}'`)[0].n).toBe(1);
    expect((await service.from("listings").select("id").eq("id", lv)).data).toHaveLength(1);
    expect((await service.from("messages").select("id").eq("conversation_id", conv.data)).data).toHaveLength(0);
  });

  it("Abbruch nach Storage-Durchlauf 1: der nächste Lauf holt nach", async () => {
    const u = await accountWithFiles("after-storage");
    await request(u.client);
    const claim = await claimOwn(u.id);
    await storagePass(claim, u.id);
    expireLease(u.id);
    expect((await run()).body.done).toBe(1);
    await expectGone(u);
  });

  it("Abbruch nach deleteUser vor finalize: 404 zählt als Erfolg, finalize läuft nach", async () => {
    const u = await accountWithFiles("after-delete");
    await request(u.client);
    const claim = await claimOwn(u.id);
    await storagePass(claim, u.id);
    expect((await service.rpc("account_deletion_prepare", { p_claim_id: claim, p_user_id: u.id })).error).toBeNull();
    expect((await service.auth.admin.deleteUser(u.id, false)).error).toBeNull();
    // Reste ohne FK sind noch da (deleteUser schreibt selbst einen Audit-Eintrag mit der Adresse).
    expect(residue(u.id, u.email).some((r) => r.startsWith("auth.audit_log_entries"))).toBe(true);
    expireLease(u.id);
    expect((await run()).body.done).toBe(1);
    await expectGone(u);
  });

  it("Upload zwischen Durchlauf 1 und 2: Durchlauf 2 entfernt die späte Datei", async () => {
    const u = await accountWithFiles("late-upload");
    await request(u.client);
    const claim = await claimOwn(u.id);
    await storagePass(claim, u.id);
    expect((await service.rpc("account_deletion_prepare", { p_claim_id: claim, p_user_id: u.id })).error).toBeNull();
    expect((await service.auth.admin.deleteUser(u.id, false)).error).toBeNull();
    const late = `${u.id}/${u.listing}/late.jpg`;
    expect((await service.storage.from("listing-photos").upload(late, JPEG, { contentType: "image/jpeg" })).error).toBeNull();
    expireLease(u.id);
    expect((await run()).body.done).toBe(1);
    await expectGone({ ...u, paths: [...u.paths, late] });
  });

  it("Auslöseweg: request_account_deletion stößt die Function per pg_net an (ohne Aufruf durch den Test)", async () => {
    const u = await accountWithFiles("pg-net");
    localSql("select vault.create_secret('http://kong:8000/functions/v1/delete-account', 'account_deletion_url')");
    try {
      await request(u.client);
      await expect.poll(() => anchor(u.id), { timeout: 20_000, interval: 500 }).toBe(0);
    } finally {
      localSql("delete from vault.secrets where name = 'account_deletion_url'");
    }
    await expectGone(u);
  });
});
