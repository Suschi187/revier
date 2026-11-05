import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fixture, SKIPPED } from "./context";
import { acceptLegal, anonClient, createSignedInUser, deleteUsers, serviceClient, userClient } from "./helpers";
import { localRows, localSql } from "./totp";

// QA M7 Nachprüfung (docs/QA-REPORT.md „M7 – Nachprüfung“), F4 über die echte Edge Function: Nach einem erfolgreichen
// Versand meldet die Function den Erfolg (confirm_chat_notifications), attempts steht danach auf 0. confirm ist über
// PostgREST weder für anon noch für authenticated noch für service_role ohne Geheimnis aufrufbar.

const f = fixture();
const created: string[] = [];
const MAILPIT = process.env.MAILPIT_URL ?? "http://127.0.0.1:54324";

async function mailCount(to: string): Promise<number> {
  const response = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`);
  return ((await response.json()) as { messages: unknown[] }).messages.length;
}

describe.skipIf(!f)("QA M7 Nachprüfung: confirm_chat_notifications", () => {
  const fx = f ?? SKIPPED;
  let secret = "";
  let delay = "2";

  beforeAll(() => {
    secret = localRows<{ s: string }>("select decrypted_secret as s from vault.decrypted_secrets where name = 'chat_notifications_secret'")[0].s;
    delay = localRows<{ v: string }>("select value::text as v from private.app_settings where key = 'chat_email_delay_minutes'")[0].v;
    localSql("update private.app_settings set value = '0' where key = 'chat_email_delay_minutes'");
  });
  afterAll(async () => {
    localSql(`update private.app_settings set value = '${Number(delay) || 2}' where key = 'chat_email_delay_minutes'`);
    await deleteUsers(fx, created);
  });

  it("anon, authenticated und service_role ohne Geheimnis: kein confirm", async () => {
    const user = await createSignedInUser(fx, "qa7n-rights");
    created.push(user.id);
    for (const client of [anonClient(fx), userClient(fx, user)]) {
      const result = await client.rpc("confirm_chat_notifications", { p_secret: secret, p_recipients: [user.id] });
      expect(result.error?.code).toMatch(/^(42501|PGRST202)$/);
    }
    const service = serviceClient(fx);
    expect((await service.rpc("confirm_chat_notifications", { p_secret: "falsch", p_recipients: [user.id] })).error?.code).toBe("42501");
    expect((await service.rpc("confirm_chat_notifications", { p_secret: null, p_recipients: [user.id] })).error?.code).toBe("42501");
  });

  it("Function: Erfolg nach zwei früheren Fehlschlägen setzt attempts auf 0, genau eine Mail", async () => {
    const owner = await createSignedInUser(fx, "qa7n-owner");
    const sender = await createSignedInUser(fx, "qa7n-sender");
    created.push(owner.id, sender.id);
    for (const user of [owner, sender]) await acceptLegal(user.client);
    const service = serviceClient(fx);
    const region = (await service.from("regions").select("id").eq("code", "DE-09162").single()).data!.id as string;
    const listing = (await service.from("listings")
      .insert({ owner_id: owner.id, kind: "helper", direction: "wanted", title: "QA7N Mail", content_language: "de", region_id: region })
      .select("id").single()).data!.id as string;
    await service.from("listings").update({ status: "active", expires_at: new Date(Date.now() + 864e5 * 30).toISOString() }).eq("id", listing);
    const started = await sender.client.rpc("start_conversation", { p_listing_id: listing, p_body: "Frage QA7N" });
    expect(started.error).toBeNull();
    const conversation = started.data as string;
    // Zwei frühere Fehlschläge wie nach release: attempts 2, kein last_sent_at
    localSql(`insert into private.chat_notifications (conversation_id, recipient_id, channel, attempts) values ('${conversation}', '${owner.id}', 'email', 2)
              on conflict (conversation_id, recipient_id, channel) do update set attempts = 2, last_sent_at = null, previous_sent_at = null`);

    const response = await fetch(`${fx.url}/functions/v1/send-chat-notifications`, { method: "POST", headers: { "x-chat-notify-secret": secret } });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { recipients: number; sent: number; failed: number };
    expect(body.failed).toBe(0);
    await expect.poll(() => mailCount(owner.email), { timeout: 10_000 }).toBe(1);
    const row = localRows<{ attempts: number; sent: boolean }>(
      `select attempts, last_sent_at is not null as sent from private.chat_notifications where recipient_id = '${owner.id}' and conversation_id = '${conversation}'`,
    )[0];
    expect(row).toEqual({ attempts: 0, sent: true });
    // Kein zweiter Versand beim nächsten Lauf
    await fetch(`${fx.url}/functions/v1/send-chat-notifications`, { method: "POST", headers: { "x-chat-notify-secret": secret } });
    await new Promise((resolve) => setTimeout(resolve, 1000));
    expect(await mailCount(owner.email)).toBe(1);
  });
});
