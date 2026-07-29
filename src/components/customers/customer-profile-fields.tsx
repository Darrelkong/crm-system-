"use client";

import type { ReactNode } from "react";
import { Input, Textarea, Select, Label, Field } from "@/components/ui/form";
import {
  CUSTOMER_AGE_RANGES,
  CUSTOMER_GENDERS,
  CUSTOMER_PREFERRED_CONTACT_METHODS,
  CUSTOMER_PREFERRED_LANGUAGES,
  type CustomerProfileFormFields,
} from "@/lib/customers/customer-profile";
import { cn } from "@/lib/cn";

type TFn = (key: string, params?: Record<string, string>) => string;

function ProfileCell({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={cn("min-w-0", className)}>{children}</div>;
}

export function CustomerProfileFields({
  values,
  fieldErrors,
  onChange,
  t,
  idPrefix = "profile",
}: {
  values: CustomerProfileFormFields;
  fieldErrors: Record<string, string>;
  onChange: (field: keyof CustomerProfileFormFields, value: string) => void;
  t: TFn;
  idPrefix?: string;
}) {
  function enumOptions(
    valuesList: readonly string[],
    i18nPrefix: string,
  ): ReactNode {
    return valuesList.map((value) => (
      <option key={value} value={value}>
        {t(`${i18nPrefix}.${value}`)}
      </option>
    ));
  }

  const selectClassName = "max-w-full min-w-0";

  return (
    <div className="grid grid-cols-2 gap-x-2.5 gap-y-0 md:grid-cols-2 md:gap-x-4 lg:grid-cols-3">
      <ProfileCell>
        <Field>
          <Label htmlFor={`${idPrefix}-preferredName`}>
            {t("customers.preferredName")}
          </Label>
          <Input
            id={`${idPrefix}-preferredName`}
            value={values.preferredName}
            onChange={(e) => onChange("preferredName", e.target.value)}
            placeholder={t("customers.preferredNamePlaceholder")}
            maxLength={40}
          />
          {fieldErrors.preferredName && (
            <p className="mt-1 text-xs text-red-600">
              {fieldErrors.preferredName}
            </p>
          )}
        </Field>
      </ProfileCell>

      <ProfileCell>
        <Field>
          <Label htmlFor={`${idPrefix}-gender`}>{t("customers.gender")}</Label>
          <Select
            id={`${idPrefix}-gender`}
            value={values.gender}
            onChange={(e) => onChange("gender", e.target.value)}
            className={selectClassName}
          >
            <option value="">{t("customers.profilePleaseSelect")}</option>
            {enumOptions(CUSTOMER_GENDERS, "customerProfileEnums.gender")}
          </Select>
          {fieldErrors.gender && (
            <p className="mt-1 text-xs text-red-600">{fieldErrors.gender}</p>
          )}
        </Field>
      </ProfileCell>

      <ProfileCell>
        <Field>
          <Label htmlFor={`${idPrefix}-ageRange`}>
            {t("customers.ageRange")}
          </Label>
          <Select
            id={`${idPrefix}-ageRange`}
            value={values.ageRange}
            onChange={(e) => onChange("ageRange", e.target.value)}
            className={selectClassName}
          >
            <option value="">{t("customers.profilePleaseSelect")}</option>
            {enumOptions(CUSTOMER_AGE_RANGES, "customerProfileEnums.ageRange")}
          </Select>
          {fieldErrors.ageRange && (
            <p className="mt-1 text-xs text-red-600">{fieldErrors.ageRange}</p>
          )}
        </Field>
      </ProfileCell>

      <ProfileCell>
        <Field>
          <Label htmlFor={`${idPrefix}-preferredLanguage`}>
            {t("customers.preferredLanguage")}
          </Label>
          <Select
            id={`${idPrefix}-preferredLanguage`}
            value={values.preferredLanguage}
            onChange={(e) => onChange("preferredLanguage", e.target.value)}
            className={selectClassName}
          >
            <option value="">{t("customers.profilePleaseSelect")}</option>
            {enumOptions(
              CUSTOMER_PREFERRED_LANGUAGES,
              "customerProfileEnums.preferredLanguage",
            )}
          </Select>
          {fieldErrors.preferredLanguage && (
            <p className="mt-1 text-xs text-red-600">
              {fieldErrors.preferredLanguage}
            </p>
          )}
        </Field>
      </ProfileCell>

      <ProfileCell>
        <Field>
          <Label htmlFor={`${idPrefix}-preferredContactMethod`}>
            {t("customers.preferredContactMethod")}
          </Label>
          <Select
            id={`${idPrefix}-preferredContactMethod`}
            value={values.preferredContactMethod}
            onChange={(e) => onChange("preferredContactMethod", e.target.value)}
            className={selectClassName}
          >
            <option value="">{t("customers.profilePleaseSelect")}</option>
            {enumOptions(
              CUSTOMER_PREFERRED_CONTACT_METHODS,
              "customerProfileEnums.preferredContactMethod",
            )}
          </Select>
          {fieldErrors.preferredContactMethod && (
            <p className="mt-1 text-xs text-red-600">
              {fieldErrors.preferredContactMethod}
            </p>
          )}
        </Field>
      </ProfileCell>

      <ProfileCell>
        <Field>
          <Label htmlFor={`${idPrefix}-occupation`}>
            {t("customers.occupation")}
          </Label>
          <Input
            id={`${idPrefix}-occupation`}
            value={values.occupation}
            onChange={(e) => onChange("occupation", e.target.value)}
            placeholder={t("customers.occupationPlaceholder")}
            maxLength={60}
          />
          {fieldErrors.occupation && (
            <p className="mt-1 text-xs text-red-600">{fieldErrors.occupation}</p>
          )}
        </Field>
      </ProfileCell>

      <ProfileCell className="col-span-2 md:col-span-1">
        <Field>
          <Label htmlFor={`${idPrefix}-companyName`}>
            {t("customers.companyName")}
          </Label>
          <Input
            id={`${idPrefix}-companyName`}
            value={values.companyName}
            onChange={(e) => onChange("companyName", e.target.value)}
            placeholder={t("customers.companyNamePlaceholder")}
            maxLength={120}
          />
          {fieldErrors.companyName && (
            <p className="mt-1 text-xs text-red-600">{fieldErrors.companyName}</p>
          )}
        </Field>
      </ProfileCell>

      <ProfileCell>
        <Field>
          <Label htmlFor={`${idPrefix}-jobTitle`}>
            {t("customers.jobTitle")}
          </Label>
          <Input
            id={`${idPrefix}-jobTitle`}
            value={values.jobTitle}
            onChange={(e) => onChange("jobTitle", e.target.value)}
            placeholder={t("customers.jobTitlePlaceholder")}
            maxLength={80}
          />
          {fieldErrors.jobTitle && (
            <p className="mt-1 text-xs text-red-600">{fieldErrors.jobTitle}</p>
          )}
        </Field>
      </ProfileCell>

      <ProfileCell>
        <Field>
          <Label htmlFor={`${idPrefix}-targetCountryOrRegion`}>
            {t("customers.targetCountryOrRegion")}
          </Label>
          <Input
            id={`${idPrefix}-targetCountryOrRegion`}
            value={values.targetCountryOrRegion}
            onChange={(e) => onChange("targetCountryOrRegion", e.target.value)}
            placeholder={t("customers.targetCountryOrRegionPlaceholder")}
            maxLength={80}
          />
          {fieldErrors.targetCountryOrRegion && (
            <p className="mt-1 text-xs text-red-600">
              {fieldErrors.targetCountryOrRegion}
            </p>
          )}
        </Field>
      </ProfileCell>

      <ProfileCell className="col-span-2 lg:col-span-3">
        <Field>
          <Label htmlFor={`${idPrefix}-primaryConcern`}>
            {t("customers.primaryConcern")}
          </Label>
          <Textarea
            id={`${idPrefix}-primaryConcern`}
            rows={3}
            value={values.primaryConcern}
            onChange={(e) => onChange("primaryConcern", e.target.value)}
            placeholder={t("customers.primaryConcernPlaceholder")}
            maxLength={200}
          />
          {fieldErrors.primaryConcern && (
            <p className="mt-1 text-xs text-red-600">
              {fieldErrors.primaryConcern}
            </p>
          )}
        </Field>
      </ProfileCell>
    </div>
  );
}
