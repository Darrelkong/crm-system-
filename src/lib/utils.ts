import { formatHongKongDate } from "@/lib/timezone";

export function formatDate(date: Date | string | null | undefined) {
  return formatHongKongDate(date);
}

export const taskStatusLabels: Record<string, string> = {
  pending: "待处理",
  in_progress: "进行中",
  done: "已完成",
  cancelled: "已取消",
};

export const taskPriorityLabels: Record<string, string> = {
  low: "低",
  medium: "中",
  high: "高",
};
