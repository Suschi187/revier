"use client";

import { useFormatter, useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useId, useState, useSyncExternalStore } from "react";
import { finishVerification, startVerification } from "@/app/[locale]/account/verification/actions";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { checkDocumentFile, DOCUMENT_MIME_TYPES, type DocumentType } from "@/lib/verification";

type ErrorKey =
  | "fileType" | "fileSize" | "fileEmpty" | "open" | "rateLimited" | "legal" | "type" | "notAllowed" | "upload" | "missingFile"
  | "submitted" | "notFound" | "failed";
type Status = { kind: "idle" } | { kind: "working" } | { kind: "error"; error: ErrorKey; retryAfter?: string | null };

const noSubscription = () => () => {};

/**
 * Dokument wählen, im Browser vorprüfen (Typ nach den ersten Bytes, Größe), Antrag beginnen, auf den Serverpfad
 * hochladen und einreichen (ADR 020). Ohne JavaScript bleibt das Formular gesperrt; den Grund nennt <noscript>.
 */
export function VerificationUpload({ types }: { types: readonly DocumentType[] }) {
  const t = useTranslations("Verification");
  const format = useFormatter();
  const locale = useLocale();
  const router = useRouter();
  const typeId = useId();
  const fileId = useId();
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const ready = useSyncExternalStore(noSubscription, () => true, () => false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const file = form.get("file");
    const type = String(form.get("type") ?? "");
    if (!(file instanceof File) || file.size === 0) return setStatus({ kind: "error", error: "fileEmpty" });
    const check = checkDocumentFile(file, new Uint8Array(await file.slice(0, 16).arrayBuffer()));
    if (!check.ok) return setStatus({ kind: "error", error: check.problem });

    setStatus({ kind: "working" });
    const begun = await startVerification(locale, type);
    if (!begun.ok) return setStatus({ kind: "error", error: begun.error, retryAfter: begun.error === "rateLimited" ? begun.retryAfter : null });

    const bucket = getSupabaseBrowserClient().storage.from("verification-docs");
    let upload = await bucket.upload(begun.path, file, { contentType: check.mime, upsert: false });
    // Datei eines abgebrochenen Versuchs liegt schon dort: vor der Einreichung darf der Besitzer sie löschen.
    if (upload.error) {
      await bucket.remove([begun.path]);
      upload = await bucket.upload(begun.path, file, { contentType: check.mime, upsert: false });
    }
    if (upload.error) return setStatus({ kind: "error", error: "upload" });

    const submitted = await finishVerification(locale, begun.id);
    if (!submitted.ok) return setStatus({ kind: "error", error: submitted.error });
    router.push("?notice=submitted");
    router.refresh();
  }

  const error = status.kind === "error" ? status : null;
  const retry = error?.retryAfter && !Number.isNaN(Date.parse(error.retryAfter)) ? new Date(error.retryAfter) : null;

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4 rounded border border-stone-400 p-4" aria-busy={status.kind === "working"}>
      <h2 className="text-xl font-semibold">{t("newRequest")}</h2>
      <div>
        <label htmlFor={typeId} className="font-medium">
          {t("documentType")}
        </label>
        <select id={typeId} name="type" required disabled={!ready} className="mt-1 w-full rounded border border-stone-400 px-3 py-2">
          {types.map((type) => (
            <option key={type} value={type}>
              {t(`documentTypes.${type}`)}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor={fileId} className="font-medium">
          {t("file")}
        </label>
        <input
          id={fileId}
          name="file"
          type="file"
          required
          disabled={!ready}
          accept={DOCUMENT_MIME_TYPES.join(",")}
          aria-describedby={`${fileId}-hint${error ? ` ${fileId}-error` : ""}`}
          aria-invalid={error && error.error.startsWith("file") ? true : undefined}
          className="mt-1 block w-full"
        />
        <p id={`${fileId}-hint`} className="text-sm text-stone-700">
          {t("fileHint")}
        </p>
      </div>
      {error && (
        <p id={`${fileId}-error`} role="alert" className="text-red-700">
          {retry ? t("errors.rateLimitedUntil", { time: format.dateTime(retry, { dateStyle: "medium", timeStyle: "short" }) }) : t(`errors.${error.error}`)}
        </p>
      )}
      {status.kind === "working" && <p role="status">{t("working")}</p>}
      <button type="submit" disabled={!ready || status.kind === "working"} className="self-start rounded bg-emerald-800 px-4 py-2 font-medium text-white disabled:opacity-60">
        {t("submit")}
      </button>
    </form>
  );
}
