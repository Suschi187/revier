"use client";

import { useTranslations } from "next-intl";
import { useActionState, useRef, useState } from "react";
import type { ComposerState } from "@/app/[locale]/account/messages/actions";
import { errorParam, isErrorParam } from "@/lib/chat/errors";
import { bodyLength, MAX_BODY } from "@/lib/chat/rules";

// Eingabe (ADR 017): funktioniert ohne JavaScript als Formular (PRG). Mit JavaScript: Zeichenzähler und
// Strg/Cmd+Enter. Enter allein macht eine neue Zeile.

type Props = {
  action: (state: ComposerState, form: FormData) => Promise<ComposerState>;
  id: string;
  locale: string;
  /** Fehlercode aus der URL nach einem Senden ohne JavaScript. */
  initialError?: string;
};

export function Composer({ action, id, locale, initialError }: Props) {
  const t = useTranslations("Chat");
  const [state, formAction, pending] = useActionState(action, { error: null, draft: "" });
  const shown = state.error ? errorParam(state.error) : isErrorParam(initialError) ? initialError : null;
  const [length, setLength] = useState(bodyLength(state.draft));
  const form = useRef<HTMLFormElement>(null);

  return (
    <form ref={form} action={formAction} className="mt-6 grid gap-2" aria-describedby="composer-shortcut">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="locale" value={locale} />
      <label htmlFor="composer-body" className="font-medium">{t("composer.label")}</label>
      <textarea
        id="composer-body"
        name="body"
        rows={4}
        required
        defaultValue={state.draft}
        key={state.draft}
        aria-invalid={shown === "body" || undefined}
        aria-describedby={shown ? "composer-error composer-count" : "composer-count"}
        className="w-full rounded border border-stone-400 px-2 py-1.5 whitespace-pre-wrap"
        onChange={(event) => setLength(bodyLength(event.target.value))}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            form.current?.requestSubmit();
          }
        }}
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p id="composer-count" className={`text-sm ${length > MAX_BODY ? "text-red-800" : "text-stone-700"}`}>
          {t("composer.count", { count: length, max: MAX_BODY })}
        </p>
        <button type="submit" disabled={pending} className="rounded bg-stone-900 px-4 py-2 text-white disabled:opacity-60">
          {pending ? t("composer.sending") : t("composer.send")}
        </button>
      </div>
      <p id="composer-shortcut" className="text-sm text-stone-700">{t("composer.shortcut")}</p>
      {shown && (
        <p id="composer-error" role="alert" className="text-red-800">
          {t(`errors.${shown}`)}
        </p>
      )}
    </form>
  );
}
