"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { prepareForUpload, uploadPhoto, type PhotoError } from "@/lib/photo-upload";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";

type Status = { kind: "idle" } | { kind: "working"; name: string } | { kind: "done"; count: number } | { kind: "error"; name: string; error: PhotoError };

/**
 * Fotos auswählen, im Browser verkleinern und nach JPEG wandeln, hochladen und verarbeiten lassen.
 * Freie Plätze (sort_order) kommen vom Server; mehr als frei sind, werden nicht hochgeladen.
 */
export function PhotoUploader({ listingId, freeSlots }: { listingId: string; freeSlots: number[] }) {
  const t = useTranslations("Listings.photos");
  const router = useRouter();
  const inputId = useId();
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  async function onChange(event: React.ChangeEvent<HTMLInputElement>) {
    const files = [...(event.target.files ?? [])];
    event.target.value = "";
    if (!files.length) return;
    if (files.length > freeSlots.length) {
      setStatus({ kind: "error", name: files[freeSlots.length]?.name ?? "", error: "limit" });
    }
    const supabase = getSupabaseBrowserClient();
    let count = 0;
    for (const [index, file] of files.slice(0, freeSlots.length).entries()) {
      setStatus({ kind: "working", name: file.name });
      const prepared = await prepareForUpload(file);
      if (!prepared.ok) {
        setStatus({ kind: "error", name: file.name, error: prepared.error });
        break;
      }
      const result = await uploadPhoto(supabase, listingId, freeSlots[index], prepared.blob);
      if (!result.ok) {
        setStatus({ kind: "error", name: file.name, error: result.error });
        break;
      }
      count += 1;
      setStatus({ kind: "done", count });
    }
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={inputId} className="font-medium">
        {t("choose")}
      </label>
      <input
        id={inputId}
        type="file"
        accept="image/jpeg,image/png,image/webp,.heic,.heif"
        multiple
        disabled={freeSlots.length === 0 || status.kind === "working"}
        onChange={onChange}
        aria-describedby={`${inputId}-hint`}
      />
      <p id={`${inputId}-hint`} className="text-sm text-stone-700">
        {freeSlots.length === 0 ? t("limit") : t("intro")}
      </p>
      <p role="status" aria-live="polite" className="text-sm">
        {status.kind === "working" && t("uploading", { name: status.name })}
        {status.kind === "done" && t("done", { count: status.count })}
      </p>
      {status.kind === "error" && (
        <p role="alert" className="text-sm text-red-800">
          {status.name ? `${status.name}: ` : ""}
          {t(`errors.${status.error}`)}
        </p>
      )}
    </div>
  );
}
