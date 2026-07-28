import {
  getRequestedProjectItem,
  isRequestedProjectCode,
  isRequestedProjectOtherCode,
  REQUESTED_PROJECT_OTHER_CODE,
} from "@/lib/constants/requested-projects";

export type ResolvedRequestedProject = {
  requestedProjectCode: string | null;
  requestedProjectName: string | null;
};

/** Local copy to avoid circular import with validation.ts */
function hasSubstantiveContent(value: string, minLength: number): boolean {
  const trimmed = value.trim();
  if (trimmed.length < minLength) return false;
  const substantive = trimmed.replace(/[^A-Za-z0-9\u4e00-\u9fff]/g, "");
  return substantive.length >= minLength;
}

export type ResolveRequestedProjectResult =
  | { ok: true; value: ResolvedRequestedProject }
  | {
      ok: false;
      fieldErrors: Array<{ field: string; message: string; code: string }>;
    };

function normalizeOptionalString(
  value: string | null | undefined,
): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function isForbiddenOtherOnlyName(name: string): boolean {
  const trimmed = name.trim();
  const lower = trimmed.toLowerCase();
  return (
    trimmed === "其他" ||
    trimmed === "其它" ||
    lower === "other"
  );
}

/**
 * Resolve requested project for create/update persist.
 * Standard codes: name is always catalog canonicalZhHans (ignore client name).
 * other: code=other + trimmed manual name (substantive length).
 * Legacy update: code null keeps raw requestedProjectName.
 */
export function resolveRequestedProjectForPersist(params: {
  requestedProjectCode: string | null | undefined;
  requestedProjectName: string | null | undefined;
  mode: "create" | "update";
  existingCode?: string | null;
  existingName?: string | null;
}): ResolveRequestedProjectResult {
  const { mode, existingCode = null, existingName = null } = params;
  const codeRaw = params.requestedProjectCode;
  const nameRaw = params.requestedProjectName;

  // Update without project fields → keep existing pair.
  if (
    mode === "update" &&
    codeRaw === undefined &&
    nameRaw === undefined
  ) {
    return {
      ok: true,
      value: {
        requestedProjectCode: existingCode,
        requestedProjectName: existingName,
      },
    };
  }

  // Legacy update: explicit null / empty code → free-text name, code stays null.
  const codeTrimmed =
    typeof codeRaw === "string" ? codeRaw.trim() : codeRaw;
  if (
    mode === "update" &&
    (codeTrimmed === null || codeTrimmed === "") &&
    existingCode === null
  ) {
    const name = normalizeOptionalString(
      nameRaw !== undefined ? nameRaw : existingName,
    );
    if (!name) {
      return {
        ok: false,
        fieldErrors: [
          {
            field: "requestedProjectName",
            message: "客户需要的项目名称必填",
            code: "REQUESTED_PROJECT_NAME_REQUIRED",
          },
        ],
      };
    }
    if (!hasSubstantiveContent(name, 4)) {
      return {
        ok: false,
        fieldErrors: [
          {
            field: "requestedProjectName",
            message: "项目名称至少 4 个字，且不能只填符号",
            code: "INVALID_REQUESTED_PROJECT_NAME",
          },
        ],
      };
    }
    return {
      ok: true,
      value: {
        requestedProjectCode: null,
        requestedProjectName: name,
      },
    };
  }

  if (!codeTrimmed || typeof codeTrimmed !== "string") {
    return {
      ok: false,
      fieldErrors: [
        {
          field: "requestedProjectCode",
          message: "请选择客户需要的项目",
          code: "REQUESTED_PROJECT_CODE_REQUIRED",
        },
      ],
    };
  }

  if (!isRequestedProjectCode(codeTrimmed)) {
    return {
      ok: false,
      fieldErrors: [
        {
          field: "requestedProjectCode",
          message: "无效的项目选项",
          code: "INVALID_REQUESTED_PROJECT_CODE",
        },
      ],
    };
  }

  if (isRequestedProjectOtherCode(codeTrimmed)) {
    const name = normalizeOptionalString(nameRaw);
    if (!name) {
      return {
        ok: false,
        fieldErrors: [
          {
            field: "requestedProjectName",
            message: "客户需要的项目名称必填",
            code: "REQUESTED_PROJECT_NAME_REQUIRED",
          },
        ],
      };
    }
    if (!hasSubstantiveContent(name, 4)) {
      return {
        ok: false,
        fieldErrors: [
          {
            field: "requestedProjectName",
            message: "项目名称至少 4 个字，且不能只填符号",
            code: "INVALID_REQUESTED_PROJECT_NAME",
          },
        ],
      };
    }
    if (isForbiddenOtherOnlyName(name)) {
      return {
        ok: false,
        fieldErrors: [
          {
            field: "requestedProjectName",
            message: "请输入具体的其他项目名称",
            code: "INVALID_REQUESTED_PROJECT_OTHER_NAME",
          },
        ],
      };
    }
    return {
      ok: true,
      value: {
        requestedProjectCode: REQUESTED_PROJECT_OTHER_CODE,
        requestedProjectName: name,
      },
    };
  }

  const item = getRequestedProjectItem(codeTrimmed)!;
  return {
    ok: true,
    value: {
      requestedProjectCode: item.code,
      requestedProjectName: item.canonicalZhHans,
    },
  };
}
