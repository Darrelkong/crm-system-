import { prisma } from "@/lib/db";
import { auth } from "@/lib/auth";
import {
  createTask,
  deleteTask,
  updateTaskStatus,
} from "@/app/actions/crm";
import { Button } from "@/components/ui/button";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui/card";
import { Field, Input, Label, Select, Textarea } from "@/components/ui/form";
import {
  formatDate,
  taskPriorityColors,
  taskPriorityLabels,
  taskStatusColors,
  taskStatusLabels,
} from "@/lib/utils";

export default async function TasksPage() {
  const session = await auth();
  const userId = session!.user!.id;

  const [tasks, contacts, companies] = await Promise.all([
    prisma.task.findMany({
      where: { userId },
      orderBy: [{ status: "asc" }, { dueDate: "asc" }],
      include: { contact: true, company: true },
    }),
    prisma.contact.findMany({
      where: { userId },
      orderBy: { firstName: "asc" },
    }),
    prisma.company.findMany({
      where: { userId },
      orderBy: { name: "asc" },
    }),
  ]);

  return (
    <div>
      <PageHeader title="待辦事項" description="追蹤客戶跟進與任務" />

      <div className="grid gap-8 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <h2 className="mb-4 text-lg font-semibold">新增待辦</h2>
          <form action={createTask}>
            <Field>
              <Label htmlFor="title">標題 *</Label>
              <Input id="title" name="title" required />
            </Field>
            <Field>
              <Label htmlFor="description">描述</Label>
              <Textarea id="description" name="description" rows={3} />
            </Field>
            <Field>
              <Label htmlFor="status">狀態</Label>
              <Select id="status" name="status" defaultValue="todo">
                <option value="todo">待處理</option>
                <option value="in_progress">進行中</option>
                <option value="done">已完成</option>
              </Select>
            </Field>
            <Field>
              <Label htmlFor="priority">優先級</Label>
              <Select id="priority" name="priority" defaultValue="medium">
                <option value="low">低</option>
                <option value="medium">中</option>
                <option value="high">高</option>
              </Select>
            </Field>
            <Field>
              <Label htmlFor="dueDate">截止日期</Label>
              <Input id="dueDate" name="dueDate" type="date" />
            </Field>
            <Field>
              <Label htmlFor="contactId">關聯聯絡人</Label>
              <Select id="contactId" name="contactId" defaultValue="">
                <option value="">— 無 —</option>
                {contacts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.firstName} {c.lastName}
                  </option>
                ))}
              </Select>
            </Field>
            <Field>
              <Label htmlFor="companyId">關聯公司</Label>
              <Select id="companyId" name="companyId" defaultValue="">
                <option value="">— 無 —</option>
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Button type="submit" className="w-full">
              新增
            </Button>
          </form>
        </Card>

        <div className="space-y-4 lg:col-span-2">
          {tasks.length === 0 ? (
            <EmptyState message="尚無待辦事項" />
          ) : (
            tasks.map((task) => (
              <Card key={task.id}>
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-base font-semibold text-slate-900">
                        {task.title}
                      </h3>
                      <Badge className={taskStatusColors[task.status]}>
                        {taskStatusLabels[task.status]}
                      </Badge>
                      <Badge className={taskPriorityColors[task.priority]}>
                        {taskPriorityLabels[task.priority]}
                      </Badge>
                    </div>
                    {task.description && (
                      <p className="mt-2 text-sm text-slate-600">
                        {task.description}
                      </p>
                    )}
                    <div className="mt-2 flex flex-wrap gap-3 text-xs text-slate-500">
                      {task.dueDate && (
                        <span>截止：{formatDate(task.dueDate)}</span>
                      )}
                      {task.contact && (
                        <span>
                          聯絡人：{task.contact.firstName}{" "}
                          {task.contact.lastName}
                        </span>
                      )}
                      {task.company && (
                        <span>公司：{task.company.name}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    {task.status !== "done" && (
                      <form
                        action={updateTaskStatus.bind(
                          null,
                          task.id,
                          task.status === "todo"
                            ? "in_progress"
                            : "done",
                        )}
                      >
                        <Button type="submit" variant="secondary" size="sm">
                          {task.status === "todo" ? "開始" : "完成"}
                        </Button>
                      </form>
                    )}
                    <form action={deleteTask.bind(null, task.id)}>
                      <Button type="submit" variant="ghost" size="sm">
                        刪除
                      </Button>
                    </form>
                  </div>
                </div>
              </Card>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
