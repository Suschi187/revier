import { describe, expect, it } from "vitest";
import fixtures from "../../../supabase/tests/fixtures/chat_rules.json";
import { contactHints } from "./contact-hints";

describe("Hinweise vor dem Senden (gemeinsame Fixture)", () => {
  it.each(fixtures.hints)("$text", (c) => {
    expect(contactHints(c.text)).toEqual({ contact: c.contact, location: c.location });
  });
});
