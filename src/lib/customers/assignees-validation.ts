export type AssigneeValidationFieldError = {
  field: string;
  message: string;
  code?: string;
};

export const ASSIGNEE_UPDATE_ACTION = "set_collaborators" as const;
export const ASSIGNEE_REASON_MIN_LENGTH = 8;

export type AssigneeUpdateApprovalPayload = AssigneeUpdatePayload & {
  reason?: string;
  currentCollaborators?: Array<{ id: string; name: string }>;
  requestedCollaborators?: Array<{ id: string; name: string }>;
  addedCollaborators?: Array<{ id: string; name: string }>;
  removedCollaborators?: Array<{ id: string; name: string }>;
};

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

export function validateAssigneeApprovalReason(
  input: unknown,
):
  | { ok: true; value: string }
  | { ok: false; errors: AssigneeValidationFieldError[] } {
  if (typeof input !== "string") {
    return {
      ok: false,
      errors: [
        {
          field: "reason",
          message: "请填写调整理由",
          code: "ASSIGNEE_REASON_REQUIRED",
        },
      ],
    };
  }

  const trimmed = input.trim();
  if (!trimmed) {
    return {
      ok: false,
      errors: [
        {
          field: "reason",
          message: "请填写调整理由",
          code: "ASSIGNEE_REASON_REQUIRED",
        },
      ],
    };
  }

  if (trimmed.length < ASSIGNEE_REASON_MIN_LENGTH) {
    return {
      ok: false,
      errors: [
        {
          field: "reason",
          message: `调整理由至少需要 ${ASSIGNEE_REASON_MIN_LENGTH} 个字`,
          code: "ASSIGNEE_REASON_TOO_SHORT",
        },
      ],
    };
  }

  return { ok: true, value: trimmed };
}

export function diffCollaboratorUserIds(
  currentCollaboratorIds: string[],
  requestedCollaboratorIds: string[],
): { addedUserIds: string[]; removedUserIds: string[] } {
  const current = new Set(currentCollaboratorIds);
  const requested = new Set(requestedCollaboratorIds);

  return {
    addedUserIds: requestedCollaboratorIds.filter((id) => !current.has(id)),
    removedUserIds: currentCollaboratorIds.filter((id) => !requested.has(id)),
  };
}

export function parseAssigneeUpdateApprovalPayload(
  payload: unknown,
): AssigneeUpdateApprovalPayload | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const validation = validateAssigneeUpdatePayload(payload);
  if (!validation.ok) {
    return null;
  }

  const record = payload as Record<string, unknown>;
  const reason =
    typeof record.reason === "string" ? record.reason.trim() : undefined;

  return {
    ...validation.value,
    ...(reason ? { reason } : {}),
    ...(Array.isArray(record.currentCollaborators)
      ? {
          currentCollaborators: record.currentCollaborators as Array<{
            id: string;
            name: string;
          }>,
        }
      : {}),
    ...(Array.isArray(record.requestedCollaborators)
      ? {
          requestedCollaborators: record.requestedCollaborators as Array<{
            id: string;
            name: string;
          }>,
        }
      : {}),
    ...(Array.isArray(record.addedCollaborators)
      ? {
          addedCollaborators: record.addedCollaborators as Array<{
            id: string;
            name: string;
          }>,
        }
      : {}),
    ...(Array.isArray(record.removedCollaborators)
      ? {
          removedCollaborators: record.removedCollaborators as Array<{
            id: string;
            name: string;
          }>,
        }
      : {}),
  };
}
