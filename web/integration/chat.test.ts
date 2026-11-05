import { describe, expect, it } from "vitest";
import { fixture, SKIPPED } from "./context";
import { rest } from "./helpers";

// Chat über die echte API (ADR 017): Schreiben nur per RPC, Lesen nur für Teilnehmer, fremd = unbekannt.
// Fixture: A hat B zur Anzeige activeB angeschrieben (global-setup), C ist unbeteiligt.

const f = fixture();

async function json(response: Response): Promise<unknown> {
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

describe.skipIf(!f)("Chat über PostgREST", () => {
  const fx = f ?? SKIPPED;
  const { a, b, c } = fx.users;

  it("Teilnehmer sehen Liste, Kopf und Nachrichten; der Empfänger hat einen Ungelesen-Zähler", async () => {
    for (const user of [a, b]) {
      const list = (await json(await rest(fx, "rpc/my_conversations", { token: user.token, method: "POST", body: {} }))) as { items: { id: string }[] };
      expect(list.items.map((item) => item.id)).toContain(fx.ids.conversation);
      const info = (await json(await rest(fx, "rpc/conversation_info", { token: user.token, method: "POST", body: { p_conversation_id: fx.ids.conversation } }))) as { id: string } | null;
      expect(info?.id).toBe(fx.ids.conversation);
    }
    const unread = await json(await rest(fx, "rpc/unread_count", { token: b.token, method: "POST", body: {} }));
    expect(unread).toBeGreaterThanOrEqual(1);
  });

  it("Unbeteiligte sehen nichts, fremde und unbekannte IDs antworten gleich", async () => {
    const list = (await json(await rest(fx, "rpc/my_conversations", { token: c.token, method: "POST", body: {} }))) as { items: unknown[] };
    expect(list.items).toEqual([]);
    const foreign = await rest(fx, "rpc/conversation_info", { token: c.token, method: "POST", body: { p_conversation_id: fx.ids.conversation } });
    const unknown = await rest(fx, "rpc/conversation_info", { token: c.token, method: "POST", body: { p_conversation_id: crypto.randomUUID() } });
    expect([foreign.status, await json(foreign)]).toEqual([unknown.status, await json(unknown)]);
    const messages = await rest(fx, "rpc/conversation_messages", { token: c.token, method: "POST", body: { p_conversation_id: fx.ids.conversation } });
    const messagesUnknown = await rest(fx, "rpc/conversation_messages", { token: c.token, method: "POST", body: { p_conversation_id: crypto.randomUUID() } });
    expect(messages.status).toBe(messagesUnknown.status);
    expect(((await json(messages)) as { code: string }).code).toBe(((await json(messagesUnknown)) as { code: string }).code);
    const send = await rest(fx, "rpc/send_message", { token: c.token, method: "POST", body: { p_conversation_id: fx.ids.conversation, p_body: "Hallo" } });
    expect(((await json(send)) as { code: string }).code).toBe("42501");
  });

  it("anon ruft keine Chat-RPC auf", async () => {
    for (const name of ["my_conversations", "unread_count", "send_message", "start_conversation", "mark_conversation_read"]) {
      const response = await rest(fx, `rpc/${name}`, { method: "POST", body: {} });
      expect(response.status, name).toBeGreaterThanOrEqual(400);
    }
  });
});
