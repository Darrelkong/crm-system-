"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label, Field } from "@/components/ui/form";
import { useTranslation } from "@/i18n/provider";
import type { TagCatalogItem } from "@/lib/tags-stages/types";

function StatusBadge({
  label,
  variant,
}: {
  label: string;
  variant: "default" | "warning" | "accent";
}) {
  const styles = {
    default: "bg-[#E8F1FA] text-[#2F6FB3]",
    warning: "bg-amber-50 text-amber-800",
    accent: "bg-[#EEF3F8] text-[#6B7890]",
  };

  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${styles[variant]}`}
    >
      {label}
    </span>
  );
}

export function CustomerTagsAdmin({ tags }: { tags: TagCatalogItem[] }) {
  const router = useRouter();
  const { t } = useTranslation();
  const [items, setItems] = useState(tags);
  const [newLabel, setNewLabel] = useState("");
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const tagStatusLabel = (item: TagCatalogItem) => {
    if (item.isSystem) return t("tagsStagesPage.systemTag");
    if (item.status === "active") return t("tagsStagesPage.statusActive");
    if (item.status === "inactive") return t("tagsStagesPage.statusInactive");
    return t("tagsStagesPage.statusCustom");
  };

  const tagStatusVariant = (item: TagCatalogItem) => {
    if (item.isSystem) return "warning" as const;
    if (item.status === "active") return "default" as const;
    return "accent" as const;
  };

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/customer-tags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: newLabel }),
      });
      const data = (await res.json()) as {
        item?: { id: string; tagKey: string; label: string };
        error?: string;
      };
      if (!res.ok || !data.item) {
        setError(data.error ?? t("common.saveFailed"));
        return;
      }
      setItems((prev) => [
        ...prev,
        {
          id: data.item!.id,
          key: data.item!.tagKey,
          label: data.item!.label,
          customerCount: 0,
          status: "active" as const,
          isSystem: false,
        },
      ]);
      setNewLabel("");
      router.refresh();
    } catch {
      setError(t("common.networkError"));
    } finally {
      setCreating(false);
    }
  }

  async function handleSaveEdit(id: string) {
    setSavingId(id);
    setError(null);
    try {
      const res = await fetch(`/api/admin/customer-tags/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: editLabel }),
      });
      const data = (await res.json()) as {
        item?: { id: string; label: string };
        error?: string;
      };
      if (!res.ok || !data.item) {
        setError(data.error ?? t("common.saveFailed"));
        return;
      }
      setItems((prev) =>
        prev.map((item) =>
          item.id === id ? { ...item, label: data.item!.label } : item,
        ),
      );
      setEditingId(null);
      router.refresh();
    } catch {
      setError(t("common.networkError"));
    } finally {
      setSavingId(null);
    }
  }

  async function handleDelete(id: string) {
    setDeletingId(id);
    setError(null);
    try {
      const res = await fetch(`/api/admin/customer-tags/${id}`, {
        method: "DELETE",
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        setError(data.error ?? t("common.deleteFailed"));
        return;
      }
      setItems((prev) => prev.filter((item) => item.id !== id));
      setConfirmDeleteId(null);
      router.refresh();
    } catch {
      setError(t("common.networkError"));
    } finally {
      setDeletingId(null);
    }
  }

  function renderActions(item: TagCatalogItem) {
    if (!item.id || item.isSystem) {
      return null;
    }

    if (confirmDeleteId === item.id) {
      const hasCustomers = item.customerCount > 0;
      return (
        <div className="mt-3 space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
          <p className="text-xs text-amber-900">
            {hasCustomers
              ? t("tagsStagesPage.deleteTagReassignWarning")
              : t("tagsStagesPage.deleteTagConfirm")}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              className="text-xs"
              disabled={deletingId === item.id}
              onClick={() => setConfirmDeleteId(null)}
            >
              {t("common.cancel")}
            </Button>
            <Button
              type="button"
              className="bg-red-600 text-xs hover:bg-red-700"
              disabled={deletingId === item.id}
              onClick={() => handleDelete(item.id!)}
            >
              {deletingId === item.id
                ? t("customers.saving")
                : t("tagsStagesPage.deleteTag")}
            </Button>
          </div>
        </div>
      );
    }

    if (editingId === item.id) {
      return (
        <div className="mt-3 space-y-2">
          <Input
            value={editLabel}
            onChange={(e) => setEditLabel(e.target.value)}
            aria-label={t("tagsStagesPage.tagName")}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              className="text-xs"
              disabled={savingId === item.id}
              onClick={() => setEditingId(null)}
            >
              {t("common.cancel")}
            </Button>
            <Button
              type="button"
              className="text-xs"
              disabled={savingId === item.id}
              onClick={() => handleSaveEdit(item.id!)}
            >
              {savingId === item.id ? t("customers.saving") : t("common.save")}
            </Button>
          </div>
        </div>
      );
    }

    return (
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          type="button"
          variant="secondary"
          className="text-xs"
          onClick={() => {
            setEditingId(item.id!);
            setEditLabel(item.label);
            setConfirmDeleteId(null);
          }}
        >
          {t("tagsStagesPage.editTag")}
        </Button>
        <Button
          type="button"
          variant="secondary"
          className="text-xs text-red-700"
          onClick={() => {
            setConfirmDeleteId(item.id!);
            setEditingId(null);
          }}
        >
          {t("tagsStagesPage.deleteTag")}
        </Button>
      </div>
    );
  }

  return (
    <div>
      <form
        onSubmit={handleCreate}
        className="mt-4 rounded-xl border border-[#E3E8F0] bg-[#F8FBFF] p-4"
      >
        <h3 className="text-sm font-semibold text-[#172033]">
          {t("tagsStagesPage.addTag")}
        </h3>
        <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end">
          <Field>
            <div className="flex-1">
              <Label htmlFor="newTagLabel">{t("tagsStagesPage.tagName")}</Label>
              <Input
                id="newTagLabel"
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                placeholder={t("tagsStagesPage.tagNamePlaceholder")}
              />
            </div>
          </Field>
          <Button type="submit" disabled={creating || !newLabel.trim()}>
            {creating ? t("customers.saving") : t("tagsStagesPage.addTag")}
          </Button>
        </div>
      </form>

      {error && (
        <p className="mt-3 text-sm text-red-600" role="alert">
          {error}
        </p>
      )}

      <div className="mt-4 space-y-3 md:hidden">
        {items.map((item) => (
          <div
            key={item.key}
            className="rounded-xl border border-[#E3E8F0] bg-white p-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium text-[#172033]">{item.label}</span>
              <StatusBadge
                label={tagStatusLabel(item)}
                variant={tagStatusVariant(item)}
              />
            </div>
            <p className="mt-1 font-mono text-xs text-[#6B7890]">{item.key}</p>
            <p className="mt-2 text-sm text-[#172033]">
              {t("tagsStagesPage.customerCount")}: {item.customerCount}
            </p>
            {renderActions(item)}
          </div>
        ))}
      </div>

      <div className="mt-4 hidden overflow-x-auto md:block">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="border-b border-[#E3E8F0] text-left text-[#6B7890]">
              <th className="pb-2.5 pr-3 text-xs font-semibold uppercase tracking-wide">
                {t("tagsStagesPage.tagName")}
              </th>
              <th className="pb-2.5 pr-3 text-xs font-semibold uppercase tracking-wide">
                Key
              </th>
              <th className="pb-2.5 pr-3 text-xs font-semibold uppercase tracking-wide">
                {t("tagsStagesPage.status")}
              </th>
              <th className="pb-2.5 pr-3 text-xs font-semibold uppercase tracking-wide">
                {t("tagsStagesPage.customerCount")}
              </th>
              <th className="pb-2.5 text-xs font-semibold uppercase tracking-wide">
                {t("common.actions")}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#EEF3F8]">
            {items.map((item) => (
              <tr key={item.key} className="align-top hover:bg-[#E8F1FA]">
                <td className="py-3 pr-3 font-medium text-[#172033]">
                  {editingId === item.id ? (
                    <Input
                      value={editLabel}
                      onChange={(e) => setEditLabel(e.target.value)}
                      aria-label={t("tagsStagesPage.tagName")}
                    />
                  ) : (
                    item.label
                  )}
                </td>
                <td className="py-3 pr-3 font-mono text-xs text-[#6B7890]">
                  {item.key}
                </td>
                <td className="py-3 pr-3">
                  <StatusBadge
                    label={tagStatusLabel(item)}
                    variant={tagStatusVariant(item)}
                  />
                </td>
                <td className="py-3 pr-3 font-semibold text-[#172033]">
                  {item.customerCount}
                </td>
                <td className="py-3">
                  {!item.id || item.isSystem ? (
                    <span className="text-xs text-[#6B7890]">—</span>
                  ) : confirmDeleteId === item.id ? (
                    <div className="space-y-2">
                      <p className="max-w-xs text-xs text-amber-900">
                        {item.customerCount > 0
                          ? t("tagsStagesPage.deleteTagReassignWarning")
                          : t("tagsStagesPage.deleteTagConfirm")}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          variant="secondary"
                          className="text-xs"
                          disabled={deletingId === item.id}
                          onClick={() => setConfirmDeleteId(null)}
                        >
                          {t("common.cancel")}
                        </Button>
                        <Button
                          type="button"
                          className="bg-red-600 text-xs hover:bg-red-700"
                          disabled={deletingId === item.id}
                          onClick={() => handleDelete(item.id!)}
                        >
                          {deletingId === item.id
                            ? t("customers.saving")
                            : t("tagsStagesPage.deleteTag")}
                        </Button>
                      </div>
                    </div>
                  ) : editingId === item.id ? (
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="secondary"
                        className="text-xs"
                        disabled={savingId === item.id}
                        onClick={() => setEditingId(null)}
                      >
                        {t("common.cancel")}
                      </Button>
                      <Button
                        type="button"
                        className="text-xs"
                        disabled={savingId === item.id}
                        onClick={() => handleSaveEdit(item.id!)}
                      >
                        {savingId === item.id
                          ? t("customers.saving")
                          : t("common.save")}
                      </Button>
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="secondary"
                        className="text-xs"
                        onClick={() => {
                          setEditingId(item.id!);
                          setEditLabel(item.label);
                          setConfirmDeleteId(null);
                        }}
                      >
                        {t("tagsStagesPage.editTag")}
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        className="text-xs text-red-700"
                        onClick={() => setConfirmDeleteId(item.id!)}
                      >
                        {t("tagsStagesPage.deleteTag")}
                      </Button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
