import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import { afterAll, describe, expect, it } from "vitest";
import { fixture, SKIPPED } from "./context";
import { userClient } from "./helpers";

// Realtime mit zwei echten Clients (ADR 017, Review A4, B3): Der Empfänger bekommt message.new auf seinem
// privaten Kanal user:<uuid>, ohne Nachrichtentext. Ein fremder privater Join scheitert, ein öffentliches
// Abo auf dasselbe Topic bekommt nichts.

const f = fixture();
const channels: { client: SupabaseClient; channel: RealtimeChannel }[] = [];

afterAll(async () => {
  for (const { client, channel } of channels) await client.removeChannel(channel);
});

type Event = { event: string; payload: Record<string, unknown> };

function listen(client: SupabaseClient, topic: string, isPrivate: boolean) {
  const events: Event[] = [];
  const channel = client.channel(topic, { config: { private: isPrivate } });
  channels.push({ client, channel });
  const status = new Promise<string>((resolve) => {
    channel
      .on("broadcast", { event: "*" }, (message) => events.push({ event: message.event, payload: message.payload as Record<string, unknown> }))
      .subscribe((state) => {
        if (state !== "CLOSED") resolve(state);
      });
  });
  return { events, status };
}

async function until(check: () => boolean, ms = 8000) {
  const end = Date.now() + ms;
  while (!check() && Date.now() < end) await new Promise((r) => setTimeout(r, 100));
  return check();
}

describe.skipIf(!f)("Chat-Realtime über Broadcast", () => {
  const fx = f ?? SKIPPED;
  const { a, b, c } = fx.users;

  it("Empfänger bekommt message.new ohne Text, Fremde bekommen nichts", async () => {
    const clientA = userClient(fx, a);
    const clientB = userClient(fx, b);
    const clientC = userClient(fx, c);
    await clientB.realtime.setAuth(b.token);
    await clientC.realtime.setAuth(c.token);

    const own = listen(clientB, `user:${b.id}`, true);
    expect(await own.status).toBe("SUBSCRIBED");
    const foreignPrivate = listen(clientC, `user:${b.id}`, true);
    expect(await foreignPrivate.status).not.toBe("SUBSCRIBED");
    // Eigener Client: supabase-js verwendet Kanäle mit gleichem Topic je Client wieder.
    const clientC2 = userClient(fx, c);
    await clientC2.realtime.setAuth(c.token);
    const foreignPublic = listen(clientC2, `user:${b.id}`, false);
    expect(await foreignPublic.status).toBe("SUBSCRIBED");

    const body = `Echtzeit ${Date.now()}`;
    const sent = await clientA.rpc("send_message", { p_conversation_id: fx.ids.conversation, p_body: body });
    expect(sent.error).toBeNull();

    expect(await until(() => own.events.some((e) => e.event === "message.new" && e.payload.message_id === sent.data))).toBe(true);
    const message = own.events.find((e) => e.event === "message.new")!;
    expect(message.payload.conversation_id).toBe(fx.ids.conversation);
    expect(JSON.stringify(own.events)).not.toContain(body);
    expect(own.events.some((e) => e.event === "unread.changed")).toBe(true);

    // Kurz warten, ob doch etwas beim Fremden ankommt
    await new Promise((r) => setTimeout(r, 1000));
    expect(foreignPrivate.events).toEqual([]);
    expect(foreignPublic.events).toEqual([]);
  });
});
