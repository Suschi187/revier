"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { Constants } from "@/lib/supabase/database.types";
import type { ProfileFieldErrors } from "@/lib/validation/profile";

export type ProfileValues = {
  displayName: string;
  accountType: string;
  businessName: string;
  country: string;
  preferredLanguage: string;
};

const { account_type, country_code, language_code } = Constants.public.Enums;
const inputClass = "rounded border border-neutral-400 px-3 py-2";

function FieldError({ id, code }: { id: string; code?: string }) {
  const t = useTranslations("Profile.errors");
  if (!code) return null;
  return (
    <p id={id} className="text-sm text-red-700">
      {t(code as "required" | "tooLong" | "invalid")}
    </p>
  );
}

export function ProfileFields({ values, errors }: { values: ProfileValues; errors: ProfileFieldErrors }) {
  const t = useTranslations("Profile");
  const tLanguage = useTranslations("LocaleSwitcher.names");
  const [accountType, setAccountType] = useState(values.accountType || "private");
  const describedBy = (field: keyof ProfileFieldErrors) => (errors[field] ? `${field}-error` : undefined);

  return (
    <>
      <div className="flex flex-col gap-1">
        <label htmlFor="displayName" className="font-medium">
          {t("displayName")}
        </label>
        <input
          id="displayName"
          name="displayName"
          required
          maxLength={60}
          autoComplete="nickname"
          defaultValue={values.displayName}
          aria-invalid={errors.displayName ? true : undefined}
          aria-describedby={describedBy("displayName") ?? "displayName-hint"}
          className={inputClass}
        />
        <p id="displayName-hint" className="text-sm text-neutral-600">
          {t("displayNameHint")}
        </p>
        <FieldError id="displayName-error" code={errors.displayName} />
      </div>

      <fieldset className="flex flex-col gap-1">
        <legend className="font-medium">{t("accountType")}</legend>
        {account_type.map((type) => (
          <label key={type} className="flex items-center gap-2">
            <input
              type="radio"
              name="accountType"
              value={type}
              checked={accountType === type}
              onChange={() => setAccountType(type)}
            />
            {t(`accountTypes.${type}`)}
          </label>
        ))}
        <FieldError id="accountType-error" code={errors.accountType} />
      </fieldset>

      {accountType === "business" && (
        <div className="flex flex-col gap-1">
          <label htmlFor="businessName" className="font-medium">
            {t("businessName")}
          </label>
          <input
            id="businessName"
            name="businessName"
            required
            maxLength={120}
            autoComplete="organization"
            defaultValue={values.businessName}
            aria-invalid={errors.businessName ? true : undefined}
            aria-describedby={describedBy("businessName")}
            className={inputClass}
          />
          <FieldError id="businessName-error" code={errors.businessName} />
        </div>
      )}

      <div className="flex flex-col gap-1">
        <label htmlFor="country" className="font-medium">
          {t("country")}
        </label>
        <select
          id="country"
          name="country"
          defaultValue={values.country}
          aria-describedby={describedBy("country")}
          className={inputClass}
        >
          {country_code.map((code) => (
            <option key={code} value={code}>
              {t(`countries.${code}`)}
            </option>
          ))}
        </select>
        <FieldError id="country-error" code={errors.country} />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="preferredLanguage" className="font-medium">
          {t("preferredLanguage")}
        </label>
        <select
          id="preferredLanguage"
          name="preferredLanguage"
          defaultValue={values.preferredLanguage}
          aria-describedby={describedBy("preferredLanguage") ?? "preferredLanguage-hint"}
          className={inputClass}
        >
          {language_code.map((code) => (
            <option key={code} value={code} lang={code}>
              {tLanguage(code)}
            </option>
          ))}
        </select>
        <p id="preferredLanguage-hint" className="text-sm text-neutral-600">
          {t("preferredLanguageHint")}
        </p>
        <FieldError id="preferredLanguage-error" code={errors.preferredLanguage} />
      </div>
    </>
  );
}
