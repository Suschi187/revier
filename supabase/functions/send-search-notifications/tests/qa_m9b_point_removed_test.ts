// QA M9b – Nachprüfung (docs/QA-REPORT.md): Moderations-Mail point_removed (F3) in 4 Sprachen mit Betreff, Grund,
// bereinigter Begründung, Frist zum Anfechten, markiertem Rechtsbehelf und ohne Link zur öffentlichen Seite.
import { LANGUAGES } from "../../_shared/mail/text.ts";
import { ACCOUNT_TEXTS } from "../account_texts.ts";
import { composeModerationMail, MODERATION_TEXTS } from "../texts.ts";

// Ohne neue Abhängigkeit (Lockfile frozen): kleine Prüfhelfer.
function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}
const assertEquals = (a: unknown, b: unknown, msg: string) => assert(a === b, `${msg}: ${String(a)} !== ${String(b)}`);
const assertStringIncludes = (text: string, part: string, msg: string) => assert(text.includes(part), `${msg}: fehlt ${part}`);

Deno.test("QA M9b F3: Mail point_removed in 4 Sprachen", () => {
  for (const lang of LANGUAGES) {
    const mail = composeModerationMail(lang, "https://revier.example", {
      decision: "point_removed",
      reject_code: "contact_in_text",
      reason: "Hochsitz‮exakt\nerkennbar",
      listing_id: "00000000-0000-4000-8000-000000000001",
      title: "Revier Süd",
      appeal_until: "2027-05-14T10:00:00Z",
    });
    assertEquals(mail.subject, MODERATION_TEXTS[lang].subject.point_removed, lang);
    assert(mail.subject.length > 10 && !mail.subject.includes("Revier Süd"), `${lang}: Betreff ohne Nutzertext`);
    assertStringIncludes(mail.text, "Revier Süd", lang);
    assertStringIncludes(mail.text, `${MODERATION_TEXTS[lang].reasonText} Hochsitz exakt erkennbar`, `${lang}: Begründung bereinigt`);
    assertStringIncludes(mail.text, MODERATION_TEXTS[lang].reasonLabel, `${lang}: Grund-Label`);
    assertStringIncludes(mail.text, `https://revier.example/${lang}/account/decisions`, `${lang}: Link zum Anfechten`);
    assertStringIncludes(mail.text, ACCOUNT_TEXTS[lang].remedies, `${lang}: Rechtsbehelf als Platzhalter`);
    assert(/^\[/.test(ACCOUNT_TEXTS[lang].remedies), `${lang}: Platzhalter markiert`);
    assert(!mail.text.includes("/anzeige/") && !mail.text.includes("00000000-0000-4000-8000-000000000001"), `${lang}: kein Link zur Anzeige`);
  }
});
