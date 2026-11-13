"use client";

import { useTranslations } from "next-intl";
import { useActionState, useRef, useState } from "react";
import type { ComposerState } from "@/app/[locale]/account/messages/actions";
import { Icon } from "@/components/ui/Icon";
import { ui } from "@/components/ui/styles";
import { errorParam, isErrorParam } from "@/lib/chat/errors";
import { contactHints } from "@/lib/chat/contact-hints";
import { bodyLength, MAX_BODY } from "@/lib/chat/rules";

// Eingabe (ADR 017): funktioniert ohne JavaScript als Formular (PRG). Mit JavaScript: Zeichenzähler und
// Strg/Cmd+Enter. Enter allein macht eine neue Zeile.

type Props = {
  action: (state: ComposerState, form: FormData) => Promise<ComposerState>;
  id: string;
  locale: string;
  /** Fehlercode aus der URL nach einem Senden ohne JavaScript. */
  initialError?: string;
  /** Besitzer der Anzeige: Hinweis, wenn die Nachricht eine genaue Lage enthält (ADR 016 „Lage im Chat geteilt“). */
  owner?: boolean;
};

export function Composer({ action, id, locale, initialError, owner = false }: Props) {
  const t = useTranslations("Chat");
  const [state, formAction, pending] = useActionState(action, { error: null, draft: "" });
  const shown = state.error ? errorParam(state.error) : isErrorParam(initialError) ? initialError : null;
  const [text, setText] = useState(state.draft);
  const length = bodyLength(text);
  const hints = contactHints(text);
  const form = useRef<HTMLFormElement>(null);

  return (
    <form ref={form} action={formAction} className="mt-4 grid gap-2 rounded-card border border-sand bg-surface p-4" aria-describedby="composer-shortcut">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="locale" value={locale} />
      <label htmlFor="composer-body" className="font-semibold">{t("composer.label")}</label>
      <textarea
        id="composer-body"
        name="body"
        rows={4}
        required
        defaultValue={state.draft}
        key={state.draft}
        aria-invalid={shown === "body" || undefined}
        aria-describedby={shown ? "composer-error composer-count" : "composer-count"}
        className={`${ui.input} whitespace-pre-wrap`}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            form.current?.requestSubmit();
          }
        }}
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p id="composer-count" className={`text-sm ${length > MAX_BODY ? "text-error" : "text-muted"}`}>
          {t("composer.count", { count: length, max: MAX_BODY })}
        </p>
        <button type="submit" disabled={pending} className={ui.btnPrimaryText}>
          <Icon name="message" size={18} />
          {pending ? t("composer.sending") : t("composer.send")}
        </button>
      </div>
      <p id="composer-shortcut" className="text-sm text-muted">{t("composer.shortcut")}</p>
      {/* Nur Hinweise, Senden bleibt möglich (SPEC 7.8). Ohne JavaScript gilt der feste Sicherheitshinweis. */}
      <div aria-live="polite" className="grid gap-2">
        {hints.contact && <p className="rounded-btn border border-notice bg-notice-soft p-2 text-sm text-notice">{t("hints.contact")}</p>}
        {owner && hints.location && <p className="rounded-btn border border-notice bg-notice-soft p-2 text-sm text-notice">{t("hints.location")}</p>}
      </div>
      {shown && (
        <p id="composer-error" role="alert" className="text-error">
          {t(`errors.${shown}`)}
        </p>
      )}
    </form>
  );
}
