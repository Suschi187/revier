import { afterAll, describe, expect, it } from "vitest";
import { fixture, SKIPPED } from "./context";
import { anonClient, deleteUsers, serviceClient, uniqueEmail } from "./helpers";

// Mailvorlagen (supabase/templates, ADR 010) über die echte Auth-API und Mailpit: Werte aus
// user_metadata und RedirectTo kommen nie unkodiert in den Link oder das HTML (Review M2, Architekt 1).

const f = fixture();
const created: string[] = [];
const MAILPIT = process.env.MAILPIT_URL ?? "http://127.0.0.1:54324";
const SITE_URL = "http://localhost:3000";

afterAll(async () => {
  if (f) await deleteUsers(f, created);
});

async function mailHtml(to: string): Promise<string> {
  for (let attempt = 0; attempt < 30; attempt++) {
    const search = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`);
    const { messages } = (await search.json()) as { messages: { ID: string }[] };
    if (messages.length > 0) {
      const detail = (await (await fetch(`${MAILPIT}/api/v1/message/${messages[0].ID}`)).json()) as { HTML: string };
      return detail.HTML;
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`Keine Mail an ${to}`);
}

async function rememberUser(email: string): Promise<void> {
  const { data } = await serviceClient(f!).auth.admin.listUsers({ perPage: 1000 });
  const user = data.users.find((candidate) => candidate.email === email);
  if (user) created.push(user.id);
}

describe.skipIf(!f)("Mailvorlagen", () => {
  const fx = f ?? SKIPPED;

  it("Manipulierte Sprache und Rücksprungadresse landen nicht unkodiert im Link", async () => {
    const email = uniqueEmail("mail");
    const evilNext = `/de/account"><img src=x onerror=alert(1)>`;
    const redirect = new URL("/de/auth/confirm", SITE_URL);
    redirect.searchParams.set("next", evilNext);
    const { error } = await anonClient(fx).auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: true,
        emailRedirectTo: `${redirect.toString()}&x="><script>alert(1)</script>`,
        data: { preferred_language: `de/../../evil.example/"><script>alert(1)</script>` },
      },
    });
    expect(error).toBeNull();
    await rememberUser(email);

    const html = await mailHtml(email);
    expect(html).not.toMatch(/<script|<img|onerror=alert/i);
    const hrefs = [...html.matchAll(/href="([^"]*)"/g)].map((match) => match[1].replaceAll("&amp;", "&"));
    expect(hrefs).toHaveLength(1);
    // Unbekannte Sprache: fester Zweig de, der Pfad hängt nie vom Metadatenwert ab.
    expect(hrefs[0].startsWith(`${SITE_URL}/de/auth/confirm?token_hash=`)).toBe(true);
    const link = new URL(hrefs[0]);
    expect(link.origin).toBe(SITE_URL);
    expect(link.pathname).toBe("/de/auth/confirm");
    expect([...link.searchParams.keys()].sort()).toEqual(["redirect_to", "token_hash", "type"]);
  });

  it("Bekannte Sprachen wählen ihren festen Pfad", async () => {
    const email = uniqueEmail("mail-cs");
    const { error } = await anonClient(fx).auth.signInWithOtp({
      email,
      options: { shouldCreateUser: true, data: { preferred_language: "cs" } },
    });
    expect(error).toBeNull();
    await rememberUser(email);
    expect(await mailHtml(email)).toContain(`href="${SITE_URL}/cs/auth/confirm?token_hash=`);
  });
});
