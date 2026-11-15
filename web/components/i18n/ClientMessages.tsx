import type { ReactNode } from "react";
import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "next-intl/server";
import { pickMessages, type Messages } from "@/lib/i18n/pick";

/**
 * Übersetzungen für Client-Komponenten darunter (M10a, Performance): Das Layout gibt nur die Sprachwahl an den
 * Browser, jede Server-Komponente mit übersetzter Client-Komponente legt diese Grenze mit deren Namensräumen darum.
 * Eine innere Grenze ersetzt die äußere (next-intl führt sie nicht zusammen), deshalb alle Namensräume des Teilbaums
 * nennen. `lib/i18n/client-messages.test.ts` prüft das.
 */
export async function ClientMessages({ namespaces, children }: { namespaces: readonly string[]; children: ReactNode }) {
  const messages = (await getMessages()) as Messages;
  return <NextIntlClientProvider messages={pickMessages(messages, namespaces)}>{children}</NextIntlClientProvider>;
}
