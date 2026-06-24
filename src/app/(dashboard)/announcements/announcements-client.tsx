"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

type AnnouncementItem = {
  id: string;
  title: string;
  content: string;
  audience: string;
  published_at: string;
};

export function AnnouncementsClient() {
  const [items, setItems] = useState<AnnouncementItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/announcements");
    const data = (await res.json()) as {
      items?: AnnouncementItem[];
      error?: string;
    };
    if (!res.ok) {
      setError(data.error ?? "加载失败");
      setLoading(false);
      return;
    }
    setItems(data.items ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return <p className="text-sm text-slate-500">加载中…</p>;
  }

  if (error) {
    return <p className="text-sm text-red-600">{error}</p>;
  }

  if (items.length === 0) {
    return <p className="text-sm text-slate-500">暂无已发布公告</p>;
  }

  return (
    <ul className="space-y-4">
      {items.map((item) => (
        <li
          key={item.id}
          className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm"
        >
          <h3 className="text-lg font-semibold text-slate-900">{item.title}</h3>
          <p className="mt-1 text-xs text-slate-500">
            发布于 {item.published_at.slice(0, 16).replace("T", " ")}
          </p>
          <div className="mt-4 whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
            {item.content}
          </div>
        </li>
      ))}
    </ul>
  );
}
