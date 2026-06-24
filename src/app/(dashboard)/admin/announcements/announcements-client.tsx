"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/form";
import {
  ANNOUNCEMENT_AUDIENCE_LABELS,
  ANNOUNCEMENT_STATUS_LABELS,
} from "@/lib/announcements/constants";

type AnnouncementItem = {
  id: string;
  title: string;
  content: string;
  status: "draft" | "published" | "archived";
  audience: "all" | "admin" | "staff";
  published_at: string | null;
  created_at: string;
};

export function AdminAnnouncementsClient() {
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

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/admin/announcements");
    const data = (await res.json()) as {
      items?: AnnouncementItem[];
      error?: string;
    };
    if (!res.ok) {
      setMessage(data.error ?? "加载失败");
      setLoading(false);
      return;
    }
    setItems(data.items ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
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
      setMessage(data.error ?? "创建失败");
      return;
    }
    resetForm();
    setMessage("公告草稿已创建");
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
      setMessage(data.error ?? "保存失败");
      return;
    }
    resetForm();
    setMessage("公告已更新");
    await load();
  }

  async function publish(id: string) {
    setMessage(null);
    const res = await fetch(`/api/admin/announcements/${id}/publish`, {
      method: "POST",
    });
    const data = (await res.json()) as { error?: string };
    if (!res.ok) {
      setMessage(data.error ?? "发布失败");
      return;
    }
    setMessage("公告已发布");
    await load();
  }

  async function archive(id: string) {
    setMessage(null);
    const res = await fetch(`/api/admin/announcements/${id}/archive`, {
      method: "POST",
    });
    const data = (await res.json()) as { error?: string };
    if (!res.ok) {
      setMessage(data.error ?? "归档失败");
      return;
    }
    setMessage("公告已归档");
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
    <div className="space-y-6">
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <Button
          onClick={() => {
            resetForm();
            setShowCreate(true);
          }}
        >
          新建公告
        </Button>
        {message && <p className="mt-3 text-sm text-slate-700">{message}</p>}
      </div>

      {(showCreate || editingId) && (
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h3 className="font-medium text-slate-900">
            {editingId ? "编辑公告" : "新建公告"}
          </h3>
          <div className="mt-4 grid max-w-xl gap-3">
            <div>
              <Label htmlFor="ann-title">标题</Label>
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
              <Label htmlFor="ann-content">内容</Label>
              <textarea
                id="ann-content"
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                rows={6}
                value={form.content}
                onChange={(e) =>
                  setForm((f) => ({ ...f, content: e.target.value }))
                }
              />
            </div>
            <div>
              <Label htmlFor="ann-audience">受众</Label>
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
                <option value="all">所有人</option>
                <option value="admin">仅管理员</option>
                <option value="staff">仅员工</option>
              </Select>
            </div>
            <div className="flex gap-2">
              <Button onClick={() => void (editingId ? saveEdit() : create())}>
                {editingId ? "保存" : "创建草稿"}
              </Button>
              <Button variant="secondary" onClick={resetForm}>
                取消
              </Button>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-slate-500">加载中…</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-left text-slate-600">
              <tr>
                <th className="px-4 py-3 font-medium">标题</th>
                <th className="px-4 py-3 font-medium">状态</th>
                <th className="px-4 py-3 font-medium">受众</th>
                <th className="px-4 py-3 font-medium">发布时间</th>
                <th className="px-4 py-3 font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className="border-b border-slate-100">
                  <td className="px-4 py-3 font-medium text-slate-900">
                    {item.title}
                  </td>
                  <td className="px-4 py-3">
                    {ANNOUNCEMENT_STATUS_LABELS[item.status]}
                  </td>
                  <td className="px-4 py-3">
                    {ANNOUNCEMENT_AUDIENCE_LABELS[item.audience]}
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {item.published_at
                      ? item.published_at.slice(0, 16).replace("T", " ")
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
                            编辑
                          </Button>
                          <Button
                            className="text-xs"
                            onClick={() => void publish(item.id)}
                          >
                            发布
                          </Button>
                        </>
                      )}
                      {item.status === "published" && (
                        <Button
                          variant="secondary"
                          className="text-xs"
                          onClick={() => void archive(item.id)}
                        >
                          归档
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
  );
}
