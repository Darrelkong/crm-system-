"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/card";
import { Input, Label, Select } from "@/components/ui/form";
import { PageIntro } from "@/components/ui/page-intro";
import { formatHongKongDateTime } from "@/lib/timezone";
import { useTranslation } from "@/i18n/provider";

type AnnouncementItem = {
  id: string;
  title: string;
  content: string;
  status: "draft" | "published" | "archived";
  audience: "all" | "admin" | "staff";
  published_at: string | null;
  created_at: string;
};

function sortAdminAnnouncements(items: AnnouncementItem[]): AnnouncementItem[] {
  const statusOrder = { published: 0, draft: 1, archived: 2 };
  return [...items].sort((a, b) => {
    const statusDiff = statusOrder[a.status] - statusOrder[b.status];
    if (statusDiff !== 0) {
      return statusDiff;
    }
    const aTime = a.published_at ?? a.created_at;
    const bTime = b.published_at ?? b.created_at;
    return new Date(bTime).getTime() - new Date(aTime).getTime();
  });
}

function statusBadgeVariant(
  status: AnnouncementItem["status"],
): "default" | "success" | "warning" {
  switch (status) {
    case "published":
      return "success";
    case "draft":
      return "warning";
    default:
      return "default";
  }
}

export function AdminAnnouncementsClient() {
  const { t } = useTranslation();
  const [items, setItems] = useState<AnnouncementItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({
    title: "",
    content: "",
    audience: "all" as "all" | "admin" | "staff",
  });

  const sortedItems = useMemo(() => sortAdminAnnouncements(items), [items]);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/admin/announcements");
    const data = (await res.json()) as {
      items?: AnnouncementItem[];
      error?: string;
    };
    if (!res.ok) {
      setMessage(data.error ?? t("announcements.admin.loadFailed"));
      setLoading(false);
      return;
    }
    setItems(data.items ?? []);
    setLoading(false);
  }, [t]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on mount
    void load();
  }, [load]);

  function resetForm() {
    setForm({ title: "", content: "", audience: "all" });
    setEditingId(null);
    setShowCreate(false);
  }

  async function create() {
    setMessage(null);
    const res = await fetch("/api/admin/announcements", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const data = (await res.json()) as { error?: string };
    if (!res.ok) {
      setMessage(data.error ?? t("announcements.admin.createFailed"));
      return;
    }
    resetForm();
    setMessage(t("announcements.admin.draftCreated"));
    await load();
  }

  async function saveEdit() {
    if (!editingId) return;
    setMessage(null);
    const res = await fetch(`/api/admin/announcements/${editingId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const data = (await res.json()) as { error?: string };
    if (!res.ok) {
      setMessage(data.error ?? t("announcements.admin.saveFailed"));
      return;
    }
    resetForm();
    setMessage(t("announcements.admin.updated"));
    await load();
  }

  async function publish(id: string) {
    setMessage(null);
    const res = await fetch(`/api/admin/announcements/${id}/publish`, {
      method: "POST",
    });
    const data = (await res.json()) as { error?: string };
    if (!res.ok) {
      setMessage(data.error ?? t("announcements.admin.publishFailed"));
      return;
    }
    setMessage(t("announcements.admin.published"));
    await load();
  }

  async function archive(id: string) {
    setMessage(null);
    const res = await fetch(`/api/admin/announcements/${id}/archive`, {
      method: "POST",
    });
    const data = (await res.json()) as { error?: string };
    if (!res.ok) {
      setMessage(data.error ?? t("announcements.admin.archiveFailed"));
      return;
    }
    setMessage(t("announcements.admin.archived"));
    await load();
  }

  function startEdit(item: AnnouncementItem) {
    setEditingId(item.id);
    setShowCreate(false);
    setForm({
      title: item.title,
      content: item.content,
      audience: item.audience,
    });
  }

  return (
    <div>
      <PageIntro
        title={t("announcements.admin.title")}
        description={t("announcements.admin.subtitle")}
      />

      <div className="mt-6 space-y-6">
        <div className="surface-card p-4 sm:p-6">
          <Button
            onClick={() => {
              resetForm();
              setShowCreate(true);
            }}
          >
            {t("announcements.admin.createNew")}
          </Button>
          {message && <p className="mt-3 text-sm text-[#172033]">{message}</p>}
        </div>

        {(showCreate || editingId) && (
          <div className="surface-card p-4 sm:p-6">
            <h3 className="font-medium text-[#172033]">
              {editingId
                ? t("announcements.admin.editTitle")
                : t("announcements.admin.createTitle")}
            </h3>
            <div className="mt-4 grid max-w-xl gap-3">
              <div>
                <Label htmlFor="ann-title">{t("announcements.admin.fieldTitle")}</Label>
                <Input
                  id="ann-title"
                  className="mt-1"
                  value={form.title}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, title: e.target.value }))
                  }
                />
              </div>
              <div>
                <Label htmlFor="ann-content">
                  {t("announcements.admin.fieldContent")}
                </Label>
                <textarea
                  id="ann-content"
                  className="surface-input mt-1 min-h-40 w-full px-3 py-2 text-sm"
                  rows={6}
                  value={form.content}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, content: e.target.value }))
                  }
                />
              </div>
              <div>
                <Label htmlFor="ann-audience">
                  {t("announcements.admin.fieldAudience")}
                </Label>
                <Select
                  id="ann-audience"
                  className="mt-1"
                  value={form.audience}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      audience: e.target.value as typeof f.audience,
                    }))
                  }
                >
                  <option value="all">{t("announcements.audience.all")}</option>
                  <option value="admin">{t("announcements.audience.admin")}</option>
                  <option value="staff">{t("announcements.audience.staff")}</option>
                </Select>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => void (editingId ? saveEdit() : create())}>
                  {editingId
                    ? t("announcements.admin.save")
                    : t("announcements.admin.createDraft")}
                </Button>
                <Button variant="secondary" onClick={resetForm}>
                  {t("common.cancel")}
                </Button>
              </div>
            </div>
          </div>
        )}

        {loading ? (
          <p className="text-sm text-[#6B7890]">{t("common.loading")}</p>
        ) : sortedItems.length === 0 ? (
          <div className="surface-card p-6 text-sm text-[#6B7890]">
            {t("announcements.admin.empty")}
          </div>
        ) : (
          <div className="surface-card overflow-x-auto p-0">
            <table className="min-w-full text-sm">
              <thead className="table-head text-left text-[#6B7890]">
                <tr>
                  <th className="px-4 py-3 font-medium">
                    {t("announcements.admin.colTitle")}
                  </th>
                  <th className="px-4 py-3 font-medium">
                    {t("announcements.admin.colStatus")}
                  </th>
                  <th className="px-4 py-3 font-medium">
                    {t("announcements.admin.colAudience")}
                  </th>
                  <th className="px-4 py-3 font-medium">
                    {t("announcements.admin.colPublishedAt")}
                  </th>
                  <th className="px-4 py-3 font-medium">
                    {t("common.actions")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {sortedItems.map((item) => (
                  <tr key={item.id} className="table-row border-b border-[#EEF3F8]">
                    <td className="px-4 py-3 font-medium text-[#172033]">
                      {item.title}
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={statusBadgeVariant(item.status)}>
                        {t(`announcements.status.${item.status}`)}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant="accent">
                        {t(`announcements.audience.${item.audience}`)}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-[#6B7890]">
                      {item.published_at
                        ? formatHongKongDateTime(item.published_at)
                        : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-2">
                        {item.status === "draft" && (
                          <>
                            <Button
                              variant="secondary"
                              className="text-xs"
                              onClick={() => startEdit(item)}
                            >
                              {t("common.edit")}
                            </Button>
                            <Button
                              className="text-xs"
                              onClick={() => void publish(item.id)}
                            >
                              {t("announcements.admin.publish")}
                            </Button>
                          </>
                        )}
                        {item.status === "published" && (
                          <Button
                            variant="secondary"
                            className="text-xs"
                            onClick={() => void archive(item.id)}
                          >
                            {t("announcements.admin.archive")}
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
