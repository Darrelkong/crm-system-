export type AssigneeValidationFieldError = {
  field: string;
  message: string;
  code?: string;
};

export const ASSIGNEE_UPDATE_ACTION = "set_collaborators" as const;

export type AssigneeUpdatePayload = {
  action: typeof ASSIGNEE_UPDATE_ACTION;
  requestedCollaboratorIds: string[];
  currentCollaboratorIds?: string[];
  addedUserIds?: string[];
  removedUserIds?: string[];
};

export function validateCollaboratorUserIds(
  input: unknown,
):
  | { ok: true; value: string[] }
  | { ok: false; errors: AssigneeValidationFieldError[] } {
  if (!Array.isArray(input)) {
    return {
      ok: false,
      errors: [
        {
          field: "requestedCollaboratorIds",
          message: "必须是数组",
          code: "INVALID_COLLABORATOR_IDS",
        },
      ],
    };
  }

  const seen = new Set<string>();
  const value: string[] = [];

  for (const item of input) {
    if (typeof item !== "string") {
      return {
        ok: false,
        errors: [
          {
            field: "requestedCollaboratorIds",
            message: "用户 ID 必须是字符串",
            code: "INVALID_COLLABORATOR_IDS",
          },
        ],
      };
    }

    const trimmed = item.trim();
    if (!trimmed) {
      return {
        ok: false,
        errors: [
          {
            field: "requestedCollaboratorIds",
            message: "用户 ID 不能为空",
            code: "INVALID_COLLABORATOR_IDS",
          },
        ],
      };
    }

    if (!seen.has(trimmed)) {
      seen.add(trimmed);
      value.push(trimmed);
    }
  }

  return { ok: true, value };
}

function validateOptionalUserIdArray(
  input: unknown,
  field: string,
):
  | { ok: true; value: string[] | undefined }
  | { ok: false; errors: AssigneeValidationFieldError[] } {
  if (input === undefined) {
    return { ok: true, value: undefined };
  }

  const result = validateCollaboratorUserIds(input);
  if (!result.ok) {
    return {
      ok: false,
      errors: result.errors.map((error) => ({ ...error, field })),
    };
  }

  return { ok: true, value: result.value };
}

export function validateAssigneeUpdatePayload(
  input: unknown,
):
  | { ok: true; value: AssigneeUpdatePayload }
  | { ok: false; errors: AssigneeValidationFieldError[] } {
  if (!input || typeof input !== "object") {
    return {
      ok: false,
      errors: [
        { field: "payload", message: "无效的申请数据", code: "INVALID_PAYLOAD" },
      ],
    };
  }

  const record = input as Record<string, unknown>;

  if (record.action !== ASSIGNEE_UPDATE_ACTION) {
    return {
      ok: false,
      errors: [
        { field: "action", message: "无效的操作类型", code: "INVALID_ACTION" },
      ],
    };
  }

  if (!("requestedCollaboratorIds" in record)) {
    return {
      ok: false,
      errors: [
        {
          field: "requestedCollaboratorIds",
          message: "缺少 requestedCollaboratorIds",
          code: "MISSING_REQUESTED_COLLABORATORS",
        },
      ],
    };
  }

  const requested = validateCollaboratorUserIds(record.requestedCollaboratorIds);
  if (!requested.ok) {
    return requested;
  }

  const current = validateOptionalUserIdArray(
    record.currentCollaboratorIds,
    "currentCollaboratorIds",
  );
  if (!current.ok) {
    return current;
  }

  const added = validateOptionalUserIdArray(record.addedUserIds, "addedUserIds");
  if (!added.ok) {
    return added;
  }

  const removed = validateOptionalUserIdArray(
    record.removedUserIds,
    "removedUserIds",
  );
  if (!removed.ok) {
    return removed;
  }

  return {
    ok: true,
    value: {
      action: ASSIGNEE_UPDATE_ACTION,
      requestedCollaboratorIds: requested.value,
      ...(current.value !== undefined
        ? { currentCollaboratorIds: current.value }
        : {}),
      ...(added.value !== undefined ? { addedUserIds: added.value } : {}),
      ...(removed.value !== undefined ? { removedUserIds: removed.value } : {}),
    },
  };
}
