import { auth } from "@/lib/auth";

export async function getSessionUser() {
  const session = await auth();
  if (!session?.user?.id) {
    throw new Error("未登入");
  }
  return session.user;
}

export function formatDate(date: Date | string | null | undefined) {
  if (!date) return "—";
  return new Date(date).toLocaleDateString("zh-TW", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export const taskStatusLabels: Record<string, string> = {
  todo: "待處理",
  in_progress: "進行中",
  done: "已完成",
};

export const taskPriorityLabels: Record<string, string> = {
  low: "低",
  medium: "中",
  high: "高",
};

export const taskStatusColors: Record<string, string> = {
  todo: "bg-slate-100 text-slate-700",
  in_progress: "bg-blue-100 text-blue-700",
  done: "bg-green-100 text-green-700",
};

export const taskPriorityColors: Record<string, string> = {
  low: "bg-gray-100 text-gray-600",
  medium: "bg-amber-100 text-amber-700",
  high: "bg-red-100 text-red-700",
};
