"use client";

import { useCallback, useEffect, useState } from "react";
import { formatHongKongDateTime } from "@/lib/timezone";

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
    return <p className="text-sm text-[#6B7890]">加载中…</p>;
  }

  if (error) {
    return <p className="text-sm text-red-600">{error}</p>;
  }

  if (items.length === 0) {
    return <p className="text-sm text-[#6B7890]">暂无已发布公告</p>;
  }

  return (
    <ul className="space-y-4">
      {items.map((item) => (
        <li key={item.id} className="surface-card p-6">
          <h3 className="text-lg font-semibold text-[#172033]">{item.title}</h3>
          <p className="mt-1 text-xs text-[#6B7890]">
            发布于 {formatHongKongDateTime(item.published_at)}
          </p>
          <div className="mt-4 whitespace-pre-wrap text-sm leading-relaxed text-[#172033]">
            {item.content}
          </div>
        </li>
      ))}
    </ul>
  );
}
