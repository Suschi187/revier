import { describe, expect, it } from "vitest";
import fixtures from "../../../supabase/tests/fixtures/chat_rules.json";
import { bodySchema, bodyValid, normalizeBody } from "./rules";

describe("Textregeln (gemeinsame Fixture mit der DB)", () => {
  it.each(fixtures.cases)("$name", (c) => {
    expect(bodyValid(c.body)).toBe(c.valid);
    if (c.valid) {
      expect(normalizeBody(c.body)).toBe(c.normalized);
      expect(bodySchema.parse(c.body)).toBe(c.normalized);
    } else {
      expect(bodySchema.safeParse(c.body).success).toBe(false);
    }
  });
});
