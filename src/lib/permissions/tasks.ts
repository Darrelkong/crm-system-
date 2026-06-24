import type { Task } from "../../../drizzle/schema/tasks";
import type { User } from "../../../drizzle/schema/users";
import { PermissionError } from "@/lib/permissions/customers";

export function assertCanCompleteTask(user: User, task: Task): void {
  if (user.role === "admin") return;

  if (task.assignedTo !== user.id) {
    throw new PermissionError(
      403,
      "无权完成该任务",
      "permission.denied.task_access",
    );
  }
}
