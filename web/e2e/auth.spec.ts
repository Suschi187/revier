import { expect, test, type Page } from "@playwright/test";
import { latestMail, uniqueEmail } from "./mailpit";

// Akzeptanz M2: Registrieren, ausloggen, wieder einloggen; Profil bearbeiten;
// geschützte Seiten leiten auf Login um (SPEC 6).

// Jeder Ablauf läuft unter der CSP (ADR 010); Verstöße im Browser lassen den Test scheitern.
let cspViolations: string[] = [];
test.beforeEach(({ page }) => {
  cspViolations = [];
  page.on("console", (message) => {
    if (message.type() === "error" && /Content Security Policy/i.test(message.text())) cspViolations.push(message.text());
  });
});
test.afterEach(() => {
  expect(cspViolations).toEqual([]);
});

async function requestMail(page: Page, email: string) {
  const since = new Date(Date.now() - 1000);
  await page.getByLabel("E-Mail-Adresse").fill(email);
  await page.getByRole("button", { name: "Anmelde-E-Mail senden" }).click();
  await expect(page.getByRole("heading", { name: "Sieh in dein Postfach" })).toBeVisible();
  return latestMail(email, since);
}

// Browser-Validierung aus, damit die serverseitige Prüfung greift. Next hält frühere Seiten
// versteckt im DOM (Activity), deshalb nur das sichtbare Formular mit dem passenden Button.
async function disableBrowserValidation(page: Page, button: string) {
  await page
    .locator("form")
    .filter({ visible: true })
    .filter({ has: page.getByRole("button", { name: button, exact: true }) })
    .evaluate((form: HTMLFormElement) => (form.noValidate = true));
}

async function completeWelcome(page: Page, name: string) {
  await expect(page).toHaveURL(/\/de\/welcome/);
  await page.getByLabel("Anzeigename").fill(name);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Speichern und weiter" }).click();
}

test("Registrieren per Link, Profil bearbeiten, ausloggen, per Code wieder einloggen", async ({ page, request }) => {
  const email = uniqueEmail("register");

  // Geschützte Seite leitet auf Login um und merkt sich das Ziel.
  await page.goto("/de/account");
  await expect(page).toHaveURL("/de/login?next=%2Fde%2Faccount");

  const signup = await requestMail(page, email);
  expect(signup.html).toContain("Willkommen bei Revier");

  // Mail-Scanner: Ein GET auf den Link verbraucht das Token nicht.
  expect((await request.get(signup.link)).status()).toBe(200);
  await page.goto(signup.link);
  await page.getByRole("button", { name: "Anmeldung bestätigen" }).click();

  // Ohne Zustimmung zur aktuellen Version zuerst das Onboarding.
  await expect(page).toHaveURL(/\/de\/welcome/);
  await disableBrowserValidation(page, "Speichern und weiter");
  await page.getByRole("button", { name: "Speichern und weiter" }).click();
  await expect(page.getByText("Bitte stimme den Nutzungsbedingungen zu")).toBeVisible();
  await completeWelcome(page, "Erika Jäger");

  await expect(page).toHaveURL("/de/account");
  await expect(page.getByText(`Angemeldet als ${email}`)).toBeVisible();
  await expect(page.getByText("Erika Jäger")).toBeVisible();

  // Profil bearbeiten: gewerblich verlangt einen Firmennamen.
  await page.getByRole("link", { name: "Profil bearbeiten" }).click();
  await page.getByLabel("Gewerblich").check();
  await page.getByLabel("Firmenname").fill("   ");
  await disableBrowserValidation(page, "Speichern");
  await page.getByRole("button", { name: "Speichern" }).click();
  await expect(page.getByText("Bitte fülle dieses Feld aus.")).toBeVisible();
  await page.getByLabel("Firmenname").fill("Forstbetrieb Jäger");
  await page.getByLabel("Land").selectOption("AT");
  await page.getByRole("button", { name: "Speichern" }).click();
  await expect(page.getByText("Dein Profil wurde gespeichert.")).toBeVisible();
  await page.getByRole("link", { name: "Zurück zu Mein Konto" }).click();
  await expect(page.getByText("Gewerblich (Forstbetrieb Jäger)")).toBeVisible();

  // Ausloggen
  await page.getByRole("button", { name: "Abmelden" }).click();
  await expect(page).toHaveURL("/de");
  await expect(page.getByRole("link", { name: "Anmelden" })).toBeVisible();
  await page.goto("/de/account/profile");
  await expect(page).toHaveURL("/de/login?next=%2Fde%2Faccount%2Fprofile");

  // Wieder einloggen per Code (Bestandsnutzer bekommt die Login-Vorlage).
  const login = await requestMail(page, email);
  expect(login.html).toContain("Du möchtest dich bei Revier anmelden");
  await page.getByLabel("Anmeldecode").fill("000000");
  await page.getByRole("button", { name: "Anmelden", exact: true }).click();
  await expect(page.getByText("Der Code ist ungültig oder abgelaufen.")).toBeVisible();
  await page.getByLabel("Anmeldecode").fill(login.code);
  await page.getByRole("button", { name: "Anmelden", exact: true }).click();
  await expect(page).toHaveURL("/de/account/profile");
  await expect(page.getByLabel("Firmenname")).toHaveValue("Forstbetrieb Jäger");
});

test("Registrieren per Code, wieder einloggen per Link", async ({ page }) => {
  const email = uniqueEmail("code");
  await page.goto("/de/login");
  const signup = await requestMail(page, email);
  await page.getByLabel("Anmeldecode").fill(signup.code);
  await page.getByRole("button", { name: "Anmelden", exact: true }).click();
  await completeWelcome(page, "Code Nutzer");
  await expect(page).toHaveURL("/de/account");

  await page.getByRole("button", { name: "Abmelden" }).click();
  await expect(page).toHaveURL("/de");

  await page.goto("/de/login?next=/de/account/profile");
  const login = await requestMail(page, email);
  await page.goto(login.link);
  await page.getByRole("button", { name: "Anmeldung bestätigen" }).click();
  await expect(page).toHaveURL("/de/account/profile");
});

test("Sicherheits-Header: CSP, kein Einbetten", async ({ request }) => {
  const response = await request.get("/de/login");
  const csp = response.headers()["content-security-policy"] ?? "";
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).toContain("object-src 'none'");
  expect(response.headers()["x-frame-options"]).toBe("DENY");
});

test("Verbrauchter oder ungültiger Link zeigt den Ausweg über den Code", async ({ page }) => {
  await page.goto("/de/auth/confirm?token_hash=0123456789abcdef0123&type=email");
  await page.getByRole("button", { name: "Anmeldung bestätigen" }).click();
  await expect(page.getByText("Dieser Link ist ungültig oder abgelaufen.")).toBeVisible();
});

test("Fremde Rücksprungziele werden ignoriert", async ({ page }) => {
  const email = uniqueEmail("redirect");
  await page.goto("/de/login?next=https://evil.example/");
  const signup = await requestMail(page, email);
  await page.getByLabel("Anmeldecode").fill(signup.code);
  await page.getByRole("button", { name: "Anmelden", exact: true }).click();
  await completeWelcome(page, "Sicher");
  await expect(page).toHaveURL("/de/account");
});

// ADR 010 / Review M2 (Architekt 3): Läuft das Access-Token ab, erneuert der Proxy die Session
// und überträgt die rotierten Cookies auch auf Redirects. Sonst ginge die Session verloren,
// weil der alte Refresh-Token nach der Rotation nicht mehr gilt.
test("Abgelaufene Session wird im Proxy erneuert, auch auf einem Redirect", async ({ page }) => {
  const email = uniqueEmail("refresh");
  await page.goto("/de/login");
  const signup = await requestMail(page, email);
  await page.getByLabel("Anmeldecode").fill(signup.code);
  await page.getByRole("button", { name: "Anmelden", exact: true }).click();
  await completeWelcome(page, "Refresh");
  await expect(page).toHaveURL("/de/account");

  // Session-Cookie so verändern, dass das Access-Token als abgelaufen gilt.
  const context = page.context();
  const authCookies = (await context.cookies()).filter((cookie) => /^sb-.*-auth-token(\.\d+)?$/.test(cookie.name));
  expect(authCookies.length).toBeGreaterThan(0);
  const raw = authCookies
    .sort((a, b) => a.name.localeCompare(b.name, "en", { numeric: true }))
    .map((cookie) => cookie.value)
    .join("");
  const session = JSON.parse(Buffer.from(raw.replace(/^base64-/, ""), "base64url").toString()) as {
    expires_at: number;
    refresh_token: string;
  };
  const oldRefreshToken = session.refresh_token;
  const baseName = authCookies[0].name.replace(/\.\d+$/, "");
  await context.clearCookies({ name: new RegExp(`^${baseName}`) });
  await context.addCookies([
    {
      ...authCookies[0],
      name: baseName,
      value: `base64-${Buffer.from(JSON.stringify({ ...session, expires_at: Math.floor(Date.now() / 1000) - 60 })).toString("base64url")}`,
    },
  ]);

  // /account ohne Sprache antwortet mit einem Redirect; schon dieser trägt die neuen Cookies.
  const redirect = await context.request.get("/account", { maxRedirects: 0 });
  expect(redirect.status()).toBe(307);
  const setCookies = redirect.headersArray().filter((header) => header.name.toLowerCase() === "set-cookie");
  expect(setCookies.some((header) => header.value.startsWith(baseName))).toBe(true);
  expect(redirect.headers()["cache-control"]).toBe("private, no-store");

  // Mit den rotierten Cookies bleibt man angemeldet, der alte Refresh-Token ist verbraucht.
  await page.goto("/de/account");
  await expect(page.getByText(`Angemeldet als ${email}`)).toBeVisible();
  const rotatedRaw = (await context.cookies())
    .filter((cookie) => cookie.name.startsWith(baseName))
    .sort((a, b) => a.name.localeCompare(b.name, "en", { numeric: true }))
    .map((cookie) => cookie.value)
    .join("");
  const rotated = JSON.parse(Buffer.from(rotatedRaw.replace(/^base64-/, ""), "base64url").toString()) as {
    refresh_token: string;
  };
  expect(rotated.refresh_token).not.toBe(oldRefreshToken);
});
