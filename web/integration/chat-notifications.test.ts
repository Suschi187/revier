import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fixture, SKIPPED } from "./context";
import { acceptLegal, createSignedInUser, deleteUsers, serviceClient } from "./helpers";
import { localRows, localSql } from "./totp";

// Benachrichtigung per Mail über die echte Edge Function und Mailpit (ADR 017, Review B2, H10): ohne Cron-Wartezeit
// (Verzögerung für den Test auf 0, die Function direkt aufgerufen). Genau eine Mail, Sprache des Empfängers, kein
// Nachrichtentext, keine zweite Mail ohne neue Nachricht, Abmeldung.

const f = fixture();
const created: string[] = [];
const MAILPIT = process.env.MAILPIT_URL ?? "http://127.0.0.1:54324";

type Message = { ID: string; Subject: string };

async function mails(to: string): Promise<Message[]> {
  const response = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`);
  return ((await response.json()) as { messages: Message[] }).messages;
}

async function text(id: string): Promise<string> {
  return ((await (await fetch(`${MAILPIT}/api/v1/message/${id}`)).json()) as { Text: string }).Text;
}

describe.skipIf(!f)("Chat-Benachrichtigung per Mail", () => {
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

  const run = (header = secret) =>
    fetch(`${fx.url}/functions/v1/send-chat-notifications`, { method: "POST", headers: { "x-chat-notify-secret": header } });

  it("Ohne Geheimnis 401, mit Geheimnis genau eine Mail ohne Nachrichtentext in der Sprache des Empfängers", async () => {
    expect((await run("falsch")).status).toBe(401);

    const owner = await createSignedInUser(fx, "notify-owner");
    const sender = await createSignedInUser(fx, "notify-sender");
    created.push(owner.id, sender.id);
    for (const user of [owner, sender]) await acceptLegal(user.client);
    const service = serviceClient(fx);
    await service.from("profiles").update({ display_name: "Pavel Posel" }).eq("user_id", sender.id);
    await service.from("profiles").update({ preferred_language: "cs" }).eq("user_id", owner.id);
    const region = (await service.from("regions").select("id").eq("code", "DE-14628").single()).data!.id as string;
    const listing = (await service.from("listings")
      .insert({ owner_id: owner.id, kind: "helper", direction: "wanted", title: "Honitba Test", content_language: "cs", region_id: region })
      .select("id").single()).data!.id as string;
    await service.from("listings").update({ status: "active", expires_at: new Date(Date.now() + 864e5 * 30).toISOString() }).eq("id", listing);
    const started = await sender.client.rpc("start_conversation", { p_listing_id: listing, p_body: "Tajná zpráva 31337" });
    expect(started.error).toBeNull();

    const first = await run();
    expect(first.status).toBe(200);
    await expect.poll(async () => (await mails(owner.email)).length, { timeout: 10_000 }).toBe(1);
    const [mail] = await mails(owner.email);
    expect(mail.Subject).toBe("Nové zprávy na Revier");
    const body = await text(mail.ID);
    expect(body).toContain("Pavel Posel");
    expect(body).toContain("Honitba Test");
    expect(body).toContain(`/cs/account/messages/${started.data}`);
    expect(body).not.toContain("31337");
    expect((await mails(sender.email)).length).toBe(0);

    // Ohne neue Nachricht keine zweite Mail, auch nicht beim nächsten Lauf
    await run();
    await new Promise((resolve) => setTimeout(resolve, 1000));
    expect((await mails(owner.email)).length).toBe(1);

    // Abgemeldet: auch nach einer neuen Nachricht nichts (die Grenze je Empfänger ist ohnehin aktiv)
    await service.from("profiles").update({ notify_chat_email: false }).eq("user_id", owner.id);
    await sender.client.rpc("send_message", { p_conversation_id: started.data as string, p_body: "Noch eine" });
    await run();
    await new Promise((resolve) => setTimeout(resolve, 1000));
    expect((await mails(owner.email)).length).toBe(1);
  });
});
