import { expect } from "@playwright/test";

const MAILPIT = process.env.MAILPIT_URL ?? "http://127.0.0.1:54324";

type Mail = { html: string; code: string; link: string };

/** Wartet auf die neueste Mail an `to`, die nach `since` eingegangen ist, und liest Code und Link. */
export async function latestMail(to: string, since: Date): Promise<Mail> {
  let found: Mail | undefined;
  await expect
    .poll(
      async () => {
        const search = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`);
        const { messages } = (await search.json()) as { messages: { ID: string; Created: string }[] };
        const fresh = messages.find((message) => new Date(message.Created) >= since);
        if (!fresh) return false;
        const detail = (await (await fetch(`${MAILPIT}/api/v1/message/${fresh.ID}`)).json()) as { HTML: string };
        const html = detail.HTML;
        const code = html.match(/>(\d{6})</)?.[1];
        const href = html.match(/href="([^"]*\/auth\/confirm[^"]*)"/)?.[1];
        if (!code || !href) return false;
        found = { html, code, link: href.replaceAll("&amp;", "&") };
        return true;
      },
      { timeout: 15_000, message: `Mail an ${to}` },
    )
    .toBe(true);
  return found!;
}

export function uniqueEmail(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.local`;
}
