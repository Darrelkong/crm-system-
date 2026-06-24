export async function readCsvFromRequest(
  request: Request,
): Promise<{ csvText: string; fileName: string | null }> {
  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("multipart/form-data")) {
    const formData = await request.formData();
    const file = formData.get("file");
    if (file instanceof File) {
      return { csvText: await file.text(), fileName: file.name };
    }
    const csvText = formData.get("csvText");
    if (typeof csvText === "string") {
      const fileName = formData.get("fileName");
      return {
        csvText,
        fileName: typeof fileName === "string" ? fileName : null,
      };
    }
    throw new Error("请上传 CSV 文件或提供 csvText");
  }

  const body = (await request.json()) as {
    csvText?: string;
    fileName?: string;
    jobId?: string;
    skipWarnings?: boolean;
  };

  if (!body.csvText || typeof body.csvText !== "string") {
    throw new Error("缺少 csvText");
  }

  return {
    csvText: body.csvText,
    fileName: typeof body.fileName === "string" ? body.fileName : null,
  };
}

export async function readCommitBody(request: Request): Promise<{
  csvText: string;
  fileName: string | null;
  jobId: string | null;
}> {
  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("multipart/form-data")) {
    const formData = await request.formData();
    const file = formData.get("file");
    let csvText: string;
    let fileName: string | null = null;

    if (file instanceof File) {
      csvText = await file.text();
      fileName = file.name;
    } else {
      const text = formData.get("csvText");
      if (typeof text !== "string") {
        throw new Error("请上传 CSV 文件或提供 csvText");
      }
      csvText = text;
      const fn = formData.get("fileName");
      fileName = typeof fn === "string" ? fn : null;
    }

    const jobId = formData.get("jobId");
    return {
      csvText,
      fileName,
      jobId: typeof jobId === "string" ? jobId : null,
    };
  }

  const body = (await request.json()) as {
    csvText?: string;
    fileName?: string;
    jobId?: string;
  };

  if (!body.csvText || typeof body.csvText !== "string") {
    throw new Error("缺少 csvText");
  }

  return {
    csvText: body.csvText,
    fileName: typeof body.fileName === "string" ? body.fileName : null,
    jobId: typeof body.jobId === "string" ? body.jobId : null,
  };
}
