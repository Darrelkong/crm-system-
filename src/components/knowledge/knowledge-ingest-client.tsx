"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "@/i18n/provider";
import { Badge, Card, EmptyState } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { KnowledgeRole } from "../../../drizzle/schema/knowledge-user-roles";
import type { KnowledgeCategoryListItem } from "@/lib/knowledge/core-service";
import type {
  KnowledgeSourceDetail,
  KnowledgeSourceListItem,
} from "@/lib/knowledge/source-service";

function statusLabel(
  t: (key: string, params?: Record<string, string>) => string,
  status: KnowledgeSourceListItem["status"],
) {
  return t(`knowledge.ingest.sourceStatuses.${status}`);
}

export function KnowledgeIngestClient({
  initialCategories,
  initialSources,
  role,
}: {
  initialCategories: KnowledgeCategoryListItem[];
  initialSources: KnowledgeSourceListItem[];
  role: KnowledgeRole | null;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const [tab, setTab] = useState<"paste" | "file">("paste");
  const [sourceTitle, setSourceTitle] = useState("");
  const [rawText, setRawText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [sources, setSources] = useState(initialSources);
  const [selected, setSelected] = useState<KnowledgeSourceDetail | null>(null);
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [body, setBody] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  function applyOrganization(source: KnowledgeSourceDetail) {
    const organization = source.organization;
    if (!organization || organization.status !== "completed") return;
    setTitle(organization.proposedTitle ?? "");
    setSummary(organization.proposedSummary ?? "");
    setBody(organization.proposedBody ?? "");
    const suggested = organization.proposedCategory?.toLocaleLowerCase();
    const match = initialCategories.find(
      (category) =>
        category.name.toLocaleLowerCase() === suggested ||
        category.slug.toLocaleLowerCase() === suggested,
    );
    setCategoryId(match?.id ?? "");
  }

  async function loadSource(sourceId: string) {
    setError(null);
    const response = await fetch(`/api/knowledge/sources/${sourceId}`, {
      cache: "no-store",
    });
    const payload = (await response.json()) as {
      source?: KnowledgeSourceDetail;
      error?: string;
    };
    if (!response.ok || !payload.source) {
      throw new Error(payload.error ?? t("knowledge.ingest.failure"));
    }
    setSelected(payload.source);
    applyOrganization(payload.source);
    setSaved(false);
  }

  async function createSource(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      let response: Response;
      if (tab === "file") {
        if (!file) throw new Error(t("knowledge.ingest.chooseFile"));
        const form = new FormData();
        form.set("file", file);
        response = await fetch("/api/knowledge/sources", {
          method: "POST",
          body: form,
        });
      } else {
        response = await fetch("/api/knowledge/sources", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sourceTitle, rawText }),
        });
      }
      const payload = (await response.json()) as {
        source?: KnowledgeSourceDetail;
        error?: string;
      };
      if (!response.ok || !payload.source) {
        throw new Error(payload.error ?? t("knowledge.ingest.failure"));
      }
      setSources((current) => [payload.source!, ...current]);
      setSelected(payload.source);
      setSourceTitle("");
      setRawText("");
      setFile(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("knowledge.ingest.failure"));
    } finally {
      setBusy(false);
    }
  }

  async function organize() {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/knowledge/sources/${selected.id}/organize`,
        { method: "POST" },
      );
      const payload = (await response.json()) as {
        source?: KnowledgeSourceDetail;
        error?: string;
      };
      if (!response.ok || !payload.source) {
        throw new Error(payload.error ?? t("knowledge.ingest.failure"));
      }
      setSelected(payload.source);
      applyOrganization(payload.source);
      setSources((current) =>
        current.map((source) =>
          source.id === payload.source!.id ? payload.source! : source,
        ),
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("knowledge.ingest.failure"));
    } finally {
      setBusy(false);
    }
  }

  async function saveDraft(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const response = await fetch(
        `/api/knowledge/sources/${selected.id}/convert`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title,
            summary,
            body,
            categoryId,
            visibility: "team",
            changeNote: t("knowledge.article.ingestChangeNote"),
          }),
        },
      );
      const payload = (await response.json()) as {
        article?: { id: string };
        error?: string;
      };
      if (!response.ok || !payload.article) {
        throw new Error(payload.error ?? t("knowledge.ingest.failure"));
      }
      setSaved(true);
      router.push(`/knowledge/articles/${payload.article.id}`);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("knowledge.ingest.failure"));
    } finally {
      setBusy(false);
    }
  }

  const canIngest =
    role === "contributor" ||
    role === "knowledge_admin";
  const organizationReady = selected?.organization?.status === "completed";

  if (!canIngest) {
    return (
      <Card>
        <p className="crm-text-secondary">{t("common.insufficientPermission")}</p>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card className="border-amber-200 bg-amber-50">
        <p className="text-sm leading-6 text-amber-950">{t("knowledge.ingest.notice")}</p>
      </Card>

      <div className="grid gap-6 lg:grid-cols-[minmax(14rem,20rem)_minmax(0,1fr)]">
        <aside className="space-y-4">
          <Card className="p-4">
            <h2 className="font-semibold crm-text">{t("knowledge.ingest.sourceList")}</h2>
            <div className="mt-3 space-y-2">
              {sources.length === 0 ? (
                <p className="text-sm crm-text-secondary">
                  {t("knowledge.ingest.noSources")}
                </p>
              ) : (
                sources.map((source) => (
                  <button
                    key={source.id}
                    type="button"
                    onClick={() => void loadSource(source.id)}
                    className="w-full rounded-xl border border-slate-200 p-3 text-left hover:bg-slate-50"
                  >
                    <span className="block truncate text-sm font-medium crm-text">
                      {source.sourceTitle ?? source.originalFilename ?? source.id.slice(0, 8)}
                    </span>
                    <span className="mt-1 block text-xs crm-text-secondary">
                      {statusLabel(t, source.status)}
                    </span>
                  </button>
                ))
              )}
            </div>
          </Card>
        </aside>

        <main className="min-w-0 space-y-4">
          <Card>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant={tab === "paste" ? "primary" : "secondary"}
                onClick={() => setTab("paste")}
              >
                {t("knowledge.ingest.pasteTab")}
              </Button>
              <Button
                type="button"
                size="sm"
                variant={tab === "file" ? "primary" : "secondary"}
                onClick={() => setTab("file")}
              >
                {t("knowledge.ingest.fileTab")}
              </Button>
            </div>
            <form className="mt-5 space-y-4" onSubmit={createSource}>
              {tab === "paste" ? (
                <>
                  <label className="block text-sm font-medium crm-text">
                    {t("knowledge.ingest.sourceTitle")}
                    <input
                      value={sourceTitle}
                      onChange={(event) => setSourceTitle(event.target.value)}
                      className="mt-1 min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3"
                      maxLength={200}
                    />
                  </label>
                  <label className="block text-sm font-medium crm-text">
                    {t("knowledge.ingest.rawText")}
                    <textarea
                      required
                      value={rawText}
                      onChange={(event) => setRawText(event.target.value)}
                      className="mt-1 min-h-48 w-full rounded-xl border border-slate-200 bg-white p-3 text-sm"
                      maxLength={100_000}
                    />
                  </label>
                </>
              ) : (
                <label className="block text-sm font-medium crm-text">
                  {t("knowledge.ingest.chooseFile")}
                  <input
                    required
                    type="file"
                    accept=".txt,.md,.pdf,.docx"
                    onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                    className="mt-2 block min-h-11 w-full text-sm"
                  />
                </label>
              )}
              <Button type="submit" disabled={busy}>
                {busy ? t("knowledge.ingest.creatingSource") : t("knowledge.ingest.createSource")}
              </Button>
            </form>
          </Card>

          {selected && (
            <Card>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold crm-text">
                    {t("knowledge.ingest.sourcePreview")}
                  </h2>
                  <p className="mt-1 text-sm crm-text-secondary">
                    {selected.originalFilename ?? selected.sourceTitle ?? selected.sourceType}
                  </p>
                </div>
                <Badge
                  variant={selected.status === "failed" ? "danger" : "accent"}
                >
                  {statusLabel(t, selected.status)}
                </Badge>
              </div>
              <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
                <div>
                  <dt className="crm-text-secondary">{t("knowledge.ingest.sourceType")}</dt>
                  <dd className="crm-text">{selected.sourceType}</dd>
                </div>
                <div>
                  <dt className="crm-text-secondary">{t("knowledge.ingest.extraction")}</dt>
                  <dd className="crm-text">
                    {selected.rawText
                      ? t("knowledge.ingest.extractionReady")
                      : t("knowledge.ingest.extractionFailed")}
                  </dd>
                </div>
                <div>
                  <dt className="crm-text-secondary">{t("common.createdAt")}</dt>
                  <dd className="crm-text">
                    {new Date(selected.createdAt).toLocaleString()}
                  </dd>
                </div>
              </dl>
              {selected.rawText ? (
                <pre className="mt-5 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-slate-50 p-4 text-sm leading-6 crm-text">
                  {selected.rawText}
                </pre>
              ) : (
                <p className="mt-5 rounded-xl bg-red-50 p-4 text-sm text-red-700">
                  {selected.failureCode === "TEXT_EXTRACTION_UNAVAILABLE"
                    ? t("knowledge.ingest.unsupportedExtraction")
                    : t("knowledge.ingest.failure")}
                </p>
              )}
              {selected.rawText &&
                selected.status !== "converted" &&
                !organizationReady && (
                  <div className="mt-5">
                    <Button
                      type="button"
                      onClick={() => void organize()}
                      disabled={busy || selected.status === "organizing"}
                    >
                      {busy
                        ? t("knowledge.ingest.organizing")
                        : t("knowledge.ingest.organize")}
                    </Button>
                  </div>
                )}
            </Card>
          )}

          {organizationReady && selected && (
            <Card>
              <div className="rounded-xl border border-blue-200 bg-blue-50 p-4">
                <p className="font-semibold text-blue-950">
                  {t("knowledge.ingest.aiLabel")}
                </p>
                <p className="mt-1 text-sm text-blue-900">
                  {t("knowledge.ingest.warning")}
                </p>
              </div>
              {selected.organization?.warnings.map((warning) => (
                <p key={warning} className="mt-3 text-sm text-amber-700">
                  ⚠ {warning}
                </p>
              ))}
              <form className="mt-5 space-y-4" onSubmit={saveDraft}>
                <label className="block text-sm font-medium crm-text">
                  {t("knowledge.ingest.title")}
                  <input
                    required
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                    className="mt-1 min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3"
                  />
                </label>
                <label className="block text-sm font-medium crm-text">
                  {t("knowledge.ingest.summary")}
                  <textarea
                    value={summary}
                    onChange={(event) => setSummary(event.target.value)}
                    className="mt-1 min-h-24 w-full rounded-xl border border-slate-200 bg-white p-3"
                  />
                </label>
                <label className="block text-sm font-medium crm-text">
                  {t("knowledge.ingest.body")}
                  <textarea
                    required
                    value={body}
                    onChange={(event) => setBody(event.target.value)}
                    className="mt-1 min-h-64 w-full rounded-xl border border-slate-200 bg-white p-3"
                  />
                </label>
                <label className="block text-sm font-medium crm-text">
                  {t("knowledge.ingest.category")}
                  <select
                    required
                    value={categoryId}
                    onChange={(event) => setCategoryId(event.target.value)}
                    className="mt-1 min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3"
                  >
                    <option value="">{t("knowledge.ingest.noCategory")}</option>
                    {initialCategories
                      .filter((category) => category.isActive)
                      .map((category) => (
                        <option key={category.id} value={category.id}>
                          {category.name}
                        </option>
                      ))}
                  </select>
                </label>
                <Button type="submit" disabled={busy || selected.status === "converted"}>
                  {busy
                    ? t("knowledge.ingest.savingDraft")
                    : saved
                      ? t("knowledge.ingest.savedDraft")
                      : t("knowledge.ingest.saveDraft")}
                </Button>
              </form>
            </Card>
          )}

          {error && (
            <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-700">
              {error}
            </p>
          )}
          {!selected && sources.length === 0 && (
            <EmptyState message={t("knowledge.ingest.noSources")} />
          )}
        </main>
      </div>
    </div>
  );
}
