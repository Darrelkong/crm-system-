import Link from "next/link";
import { Building2, CheckSquare, StickyNote, Users } from "lucide-react";
import { prisma } from "@/lib/db";
import { auth } from "@/lib/auth";
import { Card, PageHeader } from "@/components/ui/card";
import {
  formatDate,
  taskPriorityLabels,
  taskStatusLabels,
} from "@/lib/utils";

export default async function DashboardPage() {
  const session = await auth();
  const userId = session!.user!.id;

  const [contactCount, companyCount, taskCount, noteCount, recentTasks, recentNotes] =
    await Promise.all([
      prisma.contact.count({ where: { userId } }),
      prisma.company.count({ where: { userId } }),
      prisma.task.count({ where: { userId } }),
      prisma.note.count({ where: { userId } }),
      prisma.task.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        take: 5,
        include: { contact: true, company: true },
      }),
      prisma.note.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        take: 5,
        include: { contact: true, company: true },
      }),
    ]);

  const pendingTasks = await prisma.task.count({
    where: { userId, status: { not: "done" } },
  });

  const stats = [
    {
      label: "聯絡人",
      value: contactCount,
      icon: Users,
      href: "/contacts",
      color: "text-indigo-600 bg-indigo-50",
    },
    {
      label: "公司",
      value: companyCount,
      icon: Building2,
      href: "/companies",
      color: "text-emerald-600 bg-emerald-50",
    },
    {
      label: "待辦事項",
      value: taskCount,
      sub: `${pendingTasks} 待完成`,
      icon: CheckSquare,
      href: "/tasks",
      color: "text-amber-600 bg-amber-50",
    },
    {
      label: "備註紀錄",
      value: noteCount,
      icon: StickyNote,
      href: "/notes",
      color: "text-purple-600 bg-purple-50",
    },
  ];

  return (
    <div>
      <PageHeader
        title={`你好，${session?.user?.name}`}
        description="這是你的 CRM 概覽"
      />

      <div className="mb-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map(({ label, value, sub, icon: Icon, href, color }) => (
          <Link key={label} href={href}>
            <Card className="transition-shadow hover:shadow-md">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm text-slate-500">{label}</p>
                  <p className="mt-2 text-3xl font-semibold text-slate-900">
                    {value}
                  </p>
                  {sub && (
                    <p className="mt-1 text-xs text-slate-400">{sub}</p>
                  )}
                </div>
                <div className={`rounded-lg p-2.5 ${color}`}>
                  <Icon className="h-5 w-5" />
                </div>
              </div>
            </Card>
          </Link>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <h2 className="mb-4 text-lg font-semibold text-slate-900">
            最近待辦
          </h2>
          {recentTasks.length === 0 ? (
            <p className="text-sm text-slate-500">尚無待辦事項</p>
          ) : (
            <ul className="space-y-3">
              {recentTasks.map((task) => (
                <li
                  key={task.id}
                  className="flex items-center justify-between border-b border-slate-100 pb-3 last:border-0 last:pb-0"
                >
                  <div>
                    <p className="text-sm font-medium text-slate-900">
                      {task.title}
                    </p>
                    <p className="text-xs text-slate-500">
                      {taskStatusLabels[task.status]} ·{" "}
                      {taskPriorityLabels[task.priority]}
                      {task.dueDate && ` · 截止 ${formatDate(task.dueDate)}`}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <h2 className="mb-4 text-lg font-semibold text-slate-900">
            最近備註
          </h2>
          {recentNotes.length === 0 ? (
            <p className="text-sm text-slate-500">尚無備註紀錄</p>
          ) : (
            <ul className="space-y-3">
              {recentNotes.map((note) => (
                <li
                  key={note.id}
                  className="border-b border-slate-100 pb-3 last:border-0 last:pb-0"
                >
                  <p className="line-clamp-2 text-sm text-slate-700">
                    {note.content}
                  </p>
                  <p className="mt-1 text-xs text-slate-400">
                    {formatDate(note.createdAt)}
                    {note.contact &&
                      ` · ${note.contact.firstName} ${note.contact.lastName}`}
                    {note.company && ` · ${note.company.name}`}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
