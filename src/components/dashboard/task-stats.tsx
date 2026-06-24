import { countTaskStatsForUser } from "@/lib/tasks/service";
import type { User } from "../../../drizzle/schema/users";

export async function DashboardTaskStats({ user }: { user: User }) {
  const stats = await countTaskStatsForUser(user);

  return (
    <div className="mb-6 grid gap-4 sm:grid-cols-2">
      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
          待办任务
        </p>
        <p className="mt-1 text-2xl font-semibold text-slate-900">{stats.open}</p>
        <p className="mt-1 text-xs text-slate-500">
          {user.role === "admin" ? "全部未完成跟进任务" : "我的未完成跟进任务"}
        </p>
      </div>
      <div className="rounded-lg border border-red-200 bg-red-50 p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-red-600">
          超期任务
        </p>
        <p className="mt-1 text-2xl font-semibold text-red-700">{stats.overdue}</p>
        <p className="mt-1 text-xs text-red-600">已超过计划跟进时间</p>
      </div>
    </div>
  );
}
