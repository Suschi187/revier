import { spawnSync } from "node:child_process";
import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fixture, SKIPPED } from "./context";
import { acceptLegal, createSignedInUser, deleteUsers, serviceClient, userClient } from "./helpers";
import { localRows, localSql } from "./totp";

// QA M9a – Abnahme (docs/QA-REPORT.md). Proben zu Akzeptanz a über den Integrationstest account-deletion.test.ts
// hinaus: maximale Fixture mit offenem Realtime-Abo und Markierungen in Name, Titel, Beschreibung, Nachricht,
// Suchauftrag und Alt-Text; Inventar auch über bytea-Spalten; Logs der Edge Runtime; ein veraltetes JWT nach der
// Löschung; parallele Läufe der Function; der Zeitstempel in amr nach einem Refresh; Größe des Exports.
// Räumt Dateien (über die API), Meldungen, Ankerzeilen, Realtime-Ereignisse und Konten auf.

const f = fixture();
const created: string[] = [];
const reports: string[] = [];
const channels: { client: SupabaseClient; channel: RealtimeChannel }[] = [];
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 0xff, 0xd9]);
const BUCKETS = ["listing-uploads", "listing-photos", "verification-docs"] as const;
const ALLOWED: Record<string, string[]> = {
  "public.audit_log": ["target_id"],
  "public.reports": ["target_id"],
  "private.reported_message_snapshots": ["sender_id", "body"],
};
const SAFE = /^[A-Za-z0-9@.\- ]+$/;

/** Fundstellen je Nadel in allen Nicht-System-Schemas: Text über to_jsonb, bytea-Spalten per position(). */
function residue(needles: string[]): string[] {
  for (const n of needles) if (!SAFE.test(n)) throw new Error(`Nadel ${n}`);
  const allowed = Object.entries(ALLOWED).map(([rel, cols]) => `('${rel}', array[${cols.map((c) => `'${c}'`).join(",")}])`).join(",");
  const list = needles.map((n) => `'${n.toLowerCase()}'`).join(",");
  const rows = localRows<{ rel: string; needle: string }>(`
    with allow(rel, cols) as (values ${allowed}),
    needles(n) as (select unnest(array[${list}])),
    rels as (
      select c.oid, n.nspname as nsp, c.relname as name, n.nspname || '.' || c.relname as rel,
             coalesce((select array_agg(a.attname::text) from pg_attribute a join pg_type t on t.oid = a.atttypid
                       where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
                         and t.typname in ('geometry', 'geography', 'raster', 'bytea')), '{}')
             || coalesce((select al.cols from allow al where al.rel = n.nspname || '.' || c.relname), '{}') as excl
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where c.relkind in ('r', 'p', 'm') and not c.relispartition
        and n.nspname !~ '^pg_' and n.nspname not in ('information_schema', 'tests')
    ),
    bytea_cols as (
      select r.nsp, r.name, r.rel, a.attname::text as col from rels r join pg_attribute a on a.attrelid = r.oid
      join pg_type t on t.oid = a.atttypid where t.typname = 'bytea' and a.attnum > 0 and not a.attisdropped
    )
    select rel, needle from (
      select r.rel, nd.n as needle, (xpath('/row/n/text()', query_to_xml(format(
        'select count(*) as n from %I.%I t where position(%L in lower((to_jsonb(t) - %L::text[])::text)) > 0',
        r.nsp, r.name, nd.n, r.excl), false, true, '')))[1]::text as hits
      from rels r, needles nd
      union all
      select b.rel || '.' || b.col, nd.n, (xpath('/row/n/text()', query_to_xml(format(
        'select count(*) as n from %I.%I t where position(%L in lower(encode(t.%I, ''escape''))) > 0',
        b.nsp, b.name, nd.n, b.col), false, true, '')))[1]::text
      from bytea_cols b, needles nd
    ) x where hits <> '0' order by 1, 2`);
  return rows.map((r) => `${r.rel}: ${r.needle}`);
}

describe.skipIf(!f)("QA M9a: Account-Löschung, Export und Function gegen den echten Stack", () => {
  const fx = f ?? SKIPPED;
  const service = serviceClient(fx);
  let secret = "";
  let url: string | null = null;
  let region = "";
  let postal = "";
  let logSince = "";

  beforeAll(async () => {
    secret = localRows<{ s: string }>("select decrypted_secret as s from vault.decrypted_secrets where name = 'account_deletion_secret'")[0].s;
    // Wie account-deletion.test.ts: ohne URL stößt pg_net nichts an, die Probe ruft die Function selbst.
    url = localRows<{ s: string }>("select decrypted_secret as s from vault.decrypted_secrets where name = 'account_deletion_url'")[0]?.s ?? null;
    if (url) localSql("delete from vault.secrets where name = 'account_deletion_url'");
    region = (await service.from("regions").select("id").eq("code", "DE-14628").single()).data!.id as string;
    postal = localRows<{ c: string }>(`select code as c from public.postal_code_regions where region_id = '${region}' order by code limit 1`)[0].c;
    logSince = new Date().toISOString();
  });

  afterAll(async () => {
    for (const { client, channel } of channels) await client.removeChannel(channel).catch(() => undefined);
    const ids = created.filter((id) => /^[0-9a-f-]{36}$/.test(id));
    if (ids.length) {
      const list = ids.map((id) => `'${id}'`).join(",");
      const objects = localRows<{ bucket_id: string; name: string }>(`select bucket_id, name from storage.objects where split_part(name, '/', 1) in (${list})`);
      for (const bucket of BUCKETS) {
        const names = objects.filter((o) => o.bucket_id === bucket).map((o) => o.name);
        if (names.length) await service.storage.from(bucket).remove(names);
      }
      localSql(`delete from realtime.messages where topic in (${ids.map((id) => `'user:${id}'`).join(",")})`);
      localSql(`delete from private.account_deletions where user_id in (${list})`);
    }
    if (reports.length) localSql(`delete from public.reports where id in (${reports.map((r) => `'${r}'`).join(",")})`);
    await deleteUsers(fx, created);
    if (url && /^https?:\/\/[\w.:/-]+$/.test(url)) localSql(`select vault.create_secret('${url}', 'account_deletion_url')`);
  });

  const run = async () => {
    const response = await fetch(`${fx.url}/functions/v1/delete-account`, { method: "POST", headers: { "x-account-deletion-secret": secret } });
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  };
  const onlyDue = (id: string) => localSql(`update private.account_deletions set next_attempt_at = now() + interval '1 day' where user_id <> '${id}'`);

  async function activeListing(owner: string, title: string, description?: string): Promise<string> {
    const id = (await service.from("listings")
      .insert({ owner_id: owner, kind: "helper", direction: "wanted", title, description, content_language: "de", region_id: region })
      .select("id").single()).data!.id as string;
    await service.from("listings").update({ status: "active", expires_at: new Date(Date.now() + 864e5 * 30).toISOString() }).eq("id", id);
    return id;
  }

  let conversations: string[] = [];
  let stale: { id: string; email: string; client: SupabaseClient; token: string; listing: string } | null = null;

  it("Maximal-Fixture mit offenem Realtime-Abo: nach der Function keine ID, Adresse oder Markierung außerhalb der Allowlist", async () => {
    const tag = `QA9M${Date.now().toString(36)}`;
    const marks = { name: `${tag} Name`, title: `${tag} Titel`, desc: `${tag} Beschreibung lang genug fuer die Pruefung`, body: `${tag} Ungemeldet`,
      search: `${tag} Suche`, alt: `${tag} Alt`, review: `${tag} Bewertung` };
    const u = await createSignedInUser(fx, "qa9-u");
    const v = await createSignedInUser(fx, "qa9-v");
    const w = await createSignedInUser(fx, "qa9-w");
    created.push(u.id, v.id, w.id);
    for (const x of [u, v, w]) await acceptLegal(x.client);
    await service.from("profiles").update({ display_name: marks.name }).eq("user_id", u.id);

    const lu = await activeListing(u.id, marks.title, marks.desc);
    const lv = await activeListing(v.id, `${tag} Gegenüber`);
    localSql(`insert into public.listing_places (listing_id, postal_code, place_name) values ('${lu}', '${postal}', 'QA9 Ort')`);
    localSql(`insert into public.listing_species (listing_id, species_code) values ('${lu}', 'roe_deer')`);
    // Verarbeitetes Foto (Datei und Thumbnail) und ein unverarbeitetes mit Datei im Eingang.
    const p0 = (await service.from("listing_photos").insert({ listing_id: lu, sort_order: 0, alt_text: marks.alt, processed_at: new Date().toISOString(), width: 8, height: 8 })
      .select("storage_path, thumb_path").single()).data!;
    const p1 = (await service.from("listing_photos").insert({ listing_id: lu, sort_order: 1 }).select("upload_path").single()).data!;
    const files: [string, string][] = [["listing-photos", p0.storage_path], ["listing-photos", p0.thumb_path], ["listing-uploads", p1.upload_path],
      ["verification-docs", `${u.id}/doc.jpg`]];
    for (const [bucket, path] of files) expect((await service.storage.from(bucket).upload(path, JPEG, { contentType: "image/jpeg", upsert: true })).error, path).toBeNull();
    await service.from("verifications").insert({ user_id: u.id, document_type: "jagdschein", document_path: `${u.id}/doc.jpg` });

    // Beziehungen in beide Richtungen.
    expect((await service.from("favorites").insert([{ user_id: u.id, listing_id: lv }, { user_id: v.id, listing_id: lu }])).error).toBeNull();
    expect((await service.from("blocks").insert([{ blocker_id: u.id, blocked_id: w.id }, { blocker_id: w.id, blocked_id: u.id }])).error).toBeNull();
    expect((await service.from("devices").insert({ user_id: u.id, apns_token: "a".repeat(64), platform: "ios", language: "de" })).error).toBeNull();
    expect((await service.from("saved_searches").insert({ user_id: u.id, name: marks.search, filters: { v: 1, kind: "helper" } })).error).toBeNull();
    localSql(`insert into private.unsubscribe_tokens (token_hash, user_id, scope, target_ids) values (extensions.digest('qa9-${tag}', 'sha256'), '${u.id}', 'chat', '{}')`);

    // Offenes Realtime-Abo von U (wie /account/messages) und vom Gegenüber.
    for (const x of [u, v]) {
      const client = userClient(fx, x);
      await client.realtime.setAuth(x.token);
      const channel = client.channel(`user:${x.id}`, { config: { private: true } });
      channels.push({ client, channel });
      const state = await new Promise<string>((resolve) => channel.on("broadcast", { event: "*" }, () => undefined).subscribe((s) => { if (s !== "CLOSED") resolve(s); }));
      expect(state, `Realtime ${x === u ? "U" : "V"}`).toBe("SUBSCRIBED");
    }

    // Chats: V fragt zu U, U antwortet (gemeldet) und schreibt ungemeldet; U fragt zu V.
    const c1 = await v.client.rpc("start_conversation", { p_listing_id: lu, p_body: `${tag} Frage von V` });
    expect(c1.error).toBeNull();
    const reported = await u.client.rpc("send_message", { p_conversation_id: c1.data, p_body: `${tag} Gemeldet` });
    expect(reported.error).toBeNull();
    expect((await u.client.rpc("send_message", { p_conversation_id: c1.data, p_body: marks.body })).error).toBeNull();
    const c2 = await u.client.rpc("start_conversation", { p_listing_id: lv, p_body: `${marks.body} zwei` });
    expect(c2.error).toBeNull();
    localSql(`insert into public.reviews (conversation_id, author_id, target_id, rating, text) values
      ('${c1.data}', '${u.id}', '${v.id}', 5, '${marks.review}'), ('${c1.data}', '${v.id}', '${u.id}', 4, 'QA9 von V')`);

    // Meldungen: V meldet die Nachricht und das Profil von U, U meldet die Anzeige von V.
    for (const [client, row] of [
      [v.client, { target_type: "message", target_id: reported.data, reason: "harassment" }],
      [v.client, { target_type: "profile", target_id: u.id, reason: "scam", note: "QA9 Notiz V" }],
      [u.client, { target_type: "listing", target_id: lv, reason: "scam", note: `${tag} Notiz U` }],
    ] as const) expect((await client.from("reports").insert(row)).error).toBeNull();
    reports.push(...localRows<{ id: string }>(`select id from public.reports where target_id in ('${lv}', '${reported.data}', '${u.id}')`).map((r) => r.id));
    expect((await u.client.rpc("export_my_data")).error).toBeNull();

    // Antrag (frischer Login aus createSignedInUser), dann genau ein Lauf.
    expect((await u.client.rpc("request_account_deletion")).error).toBeNull();
    onlyDue(u.id);
    const result = await run();
    expect(result.status).toBe(200);
    expect(result.body.done).toBe(1);
    // Antwort nur Zähler (net._http_response speichert sie beim Cron-Weg).
    expect(Object.values(result.body).every((x) => typeof x === "number")).toBe(true);

    expect((await service.auth.admin.getUserById(u.id)).data.user).toBeNull();
    for (const [bucket, path] of files) expect((await service.storage.from(bucket).download(path)).error, `${bucket} ${path}`).not.toBeNull();
    const needles = [u.id, u.email, lu, marks.name, marks.title, marks.desc, marks.body, marks.search, marks.alt, marks.review];
    expect(residue(needles), "Inventar mit Markierungen").toEqual([]);
    // Pseudonymisierte eigene Meldung von U bleibt mit Notiz (ADR 008 set null; Hinweis im Bericht).
    expect(localRows<{ n: number }>(`select count(*)::int as n from public.reports where note = '${tag} Notiz U' and reporter_id is null`)[0].n).toBe(1);
    // Das Gegenüber behält seine Daten, das Abo von V bleibt bestehen.
    expect((await service.from("listings").select("id").eq("id", lv)).data).toHaveLength(1);

    stale = { id: u.id, email: u.email, client: u.client, token: u.token, listing: lu };
    conversations = [String(c1.data), String(c2.data)];
  }, 90_000);

  // F3: unread.changed-Ereignisse beim Gegenüber tragen nur die conversation_id; finalize sucht nur die Nutzer-ID.
  it.fails("F3: keine Realtime-Ereignisse mit IDs gelöschter Unterhaltungen des Kontos beim Gegenüber", () => {
    expect(conversations).toHaveLength(2);
    expect(residue(conversations)).toEqual([]);
  });

  it("Logs der Edge Runtime: keine Nutzer-ID und keine Adresse aus dem Lauf", () => {
    expect(stale).not.toBeNull();
    // Die Edge Runtime schreibt nach stderr.
    const logs = spawnSync("docker", ["logs", "--since", logSince, "supabase_edge_runtime_revier"], { encoding: "utf8" });
    const all = `${logs.stdout}${logs.stderr}`;
    expect(all).toContain('"fn":"delete-account"');
    expect(all.includes(stale!.id), "Nutzer-ID im Log").toBe(false);
    expect(all.toLowerCase().includes(stale!.email.toLowerCase()), "Adresse im Log").toBe(false);
  });

  it("veraltetes JWT nach der Löschung: keine Uploads, kein neuer Anker, kein Export, keine Reste", async () => {
    expect(stale).not.toBeNull();
    const { id, client, listing } = stale!;
    const attempts: [string, string][] = [["listing-uploads", `${id}/${listing}/late`], ["verification-docs", `${id}/late.jpg`], ["listing-photos", `${id}/${listing}/late.jpg`]];
    for (const [bucket, path] of attempts) {
      const { error } = await client.storage.from(bucket).upload(path, JPEG, { contentType: "image/jpeg" });
      expect(error, `${bucket} Upload mit altem JWT`).not.toBeNull();
    }
    expect((await client.rpc("export_my_data")).error?.code).toBe("42501");
    expect((await client.rpc("request_account_deletion")).error).toBeNull();
    expect(localRows<{ n: number }>(`select count(*)::int as n from private.account_deletions where user_id = '${id}'`)[0].n, "kein neuer Anker").toBe(0);
    expect((await client.from("devices").insert({ apns_token: "b".repeat(64), platform: "ios", language: "de" })).error).not.toBeNull();
    expect(residue([id, stale!.email]), "Inventar nach Schreibversuchen").toEqual([]);
  });

  it("zwei parallele Läufe der Function: genau eine Löschung, kein Fehler, keine Reste", async () => {
    const x = await createSignedInUser(fx, "qa9-par");
    created.push(x.id);
    await acceptLegal(x.client);
    const lx = await activeListing(x.id, "QA9 Parallel");
    const photo = (await service.from("listing_photos").insert({ listing_id: lx, sort_order: 0, processed_at: new Date().toISOString(), width: 8, height: 8, alt_text: "P" })
      .select("storage_path").single()).data!.storage_path as string;
    expect((await service.storage.from("listing-photos").upload(photo, JPEG, { contentType: "image/jpeg", upsert: true })).error).toBeNull();
    expect((await x.client.rpc("request_account_deletion")).error).toBeNull();
    onlyDue(x.id);
    const [r1, r2] = await Promise.all([run(), run()]);
    expect([r1.status, r2.status]).toEqual([200, 200]);
    expect(Number(r1.body.done) + Number(r2.body.done)).toBe(1);
    expect(Number(r1.body.failed) + Number(r2.body.failed)).toBe(0);
    expect((await service.auth.admin.getUserById(x.id)).data.user).toBeNull();
    expect(residue([x.id, x.email])).toEqual([]);
  }, 60_000);

  it("Refresh behält den amr-Zeitstempel (eine alte Session wird nicht frisch)", async () => {
    const y = await createSignedInUser(fx, "qa9-amr");
    created.push(y.id);
    const decode = (jwt: string) => JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString("utf8")) as { amr: { method: string; timestamp: number }[]; iat: number };
    const session = (await y.client.auth.getSession()).data.session!;
    const before = decode(session.access_token);
    await new Promise((r) => setTimeout(r, 1500));
    const refreshed = await y.client.auth.refreshSession({ refresh_token: session.refresh_token });
    expect(refreshed.error).toBeNull();
    const after = decode(refreshed.data.session!.access_token);
    expect(after.iat).toBeGreaterThan(before.iat);
    expect(after.amr).toEqual(before.amr);
    expect(after.amr.map((a) => a.method)).toEqual(["otp"]);
  });

  it("Export eines großen Kontos (300 Unterhaltungen, 6000 Nachrichten) bleibt unter dem statement_timeout von authenticated (8 s)", async () => {
    const big = await createSignedInUser(fx, "qa9-big");
    const peer = await createSignedInUser(fx, "qa9-peer");
    created.push(big.id, peer.id);
    for (const x of [big, peer]) await acceptLegal(x.client);
    const lb = await activeListing(big.id, "QA9 Groß");
    expect(lb).toBeTruthy();
    // 300 Unterhaltungen über 300 Anzeigen des Gegenübers (eigene Konten je Unterhaltung wären zu teuer).
    localSql(`insert into public.listings (owner_id, kind, direction, title, content_language, region_id, status, expires_at, published_at)
              select '${peer.id}', 'helper', 'wanted', 'QA9 Peer ' || g, 'de', '${region}', 'active', now() + interval '30 days', now() from generate_series(1, 300) g`);
    localSql(`insert into public.conversations (listing_id, owner_id, interested_id)
              select l.id, '${peer.id}', '${big.id}' from public.listings l where l.owner_id = '${peer.id}'`);
    // Ohne Trigger (session_replication_role): 6000 Broadcast-Ereignisse stauten sonst die Realtime-Replikation für
    // nachfolgende Testdateien. recipient_id setzt sonst der Trigger.
    localSql(`do $$ begin set local session_replication_role = replica;
              insert into public.messages (conversation_id, sender_id, recipient_id, body)
              select c.id, case when g % 2 = 0 then '${big.id}'::uuid else '${peer.id}'::uuid end,
                     case when g % 2 = 0 then '${peer.id}'::uuid else '${big.id}'::uuid end, 'QA9 Nachricht ' || g || ' ' || repeat('x', 200)
              from public.conversations c, generate_series(1, 20) g where c.interested_id = '${big.id}'; end $$`);
    const started = Date.now();
    const { data, error } = await big.client.rpc("export_my_data");
    const ms = Date.now() - started;
    expect(error).toBeNull();
    const size = JSON.stringify(data).length;
    process.stdout.write(`QA M9a Export groß: ${ms} ms, ${(size / 1e6).toFixed(1)} MB\n`);
    expect((data as { conversations: unknown[] }).conversations).toHaveLength(300);
    expect(ms).toBeLessThan(8000);
  }, 120_000);
});
