import { describe, expect, it } from "vitest";
import fixtures from "../../supabase/tests/fixtures/chat_rules.json";
import { fixture, SKIPPED } from "./context";
import { userClient } from "./helpers";

// Gleiches Urteil wie Zod (lib/chat/rules.test.ts): die RPC mit denselben Fällen (ADR 017, Review A9).
// Gültige Fälle schreibt A in die Fixture-Unterhaltung und liest den gespeicherten Text zurück.

const f = fixture();

describe.skipIf(!f)("Textregeln der RPC send_message", () => {
  const fx = f ?? SKIPPED;

  it.each(fixtures.cases)("$name", async (c) => {
    const client = userClient(fx, fx.users.a);
    const { data, error } = await client.rpc("send_message", { p_conversation_id: fx.ids.conversation, p_body: c.body });
    if (!c.valid) {
      expect(error?.code).toBe("22023");
      expect(error?.hint).toBe("body");
      return;
    }
    expect(error).toBeNull();
    const stored = await client.from("messages").select("body").eq("id", data as string).single();
    expect(stored.data?.body).toBe(c.normalized);
  });
});
