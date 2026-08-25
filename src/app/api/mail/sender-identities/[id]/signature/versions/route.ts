export const dynamic = "force-dynamic";

import { MAIL_API_MAX_JSON_BYTES } from "@/lib/mail/constants";
import { mailErrorResponse } from "@/lib/mail/errors";
import {
  parseJsonRecord,
  readStringField,
  requireMailActor,
} from "@/lib/mail/api-helpers";
import {
  createSignatureVersion,
  listSignatureVersions,
  type SignatureVersionAssetInput,
} from "@/lib/mail/signature-service";
import { readLimitedJsonBody } from "@/lib/http/read-limited-json-body";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext) {
  try {
    const { actor, db } = await requireMailActor(request);
    const { id } = await context.params;
    const items = await listSignatureVersions(db, actor, id);
    return Response.json({ items });
  } catch (error) {
    return mailErrorResponse(error);
  }
}

function parseAssets(value: unknown): SignatureVersionAssetInput[] {
  if (!Array.isArray(value)) return [];
  const assets: SignatureVersionAssetInput[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const record = entry as Record<string, unknown>;
    const storedFileId = readStringField(record, "storedFileId");
    const contentHash = readStringField(record, "contentHash");
    const assetRef = readStringField(record, "assetRef");
    const mimeType = readStringField(record, "mimeType");
    const sizeBytes =
      typeof record.sizeBytes === "number" ? record.sizeBytes : undefined;
    if (!storedFileId || !contentHash || !assetRef || !mimeType || !sizeBytes) {
      continue;
    }
    assets.push({
      storedFileId,
      contentHash,
      assetRef,
      mimeType,
      sizeBytes,
      sortOrder:
        typeof record.sortOrder === "number" ? record.sortOrder : undefined,
    });
  }
  return assets;
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const { actor, db } = await requireMailActor(request);
    const { id } = await context.params;
    const bodyResult = await readLimitedJsonBody(
      request,
      MAIL_API_MAX_JSON_BYTES,
    );
    if (!bodyResult.ok) {
      return Response.json(
        { error: bodyResult.message, errorCode: bodyResult.errorCode },
        { status: bodyResult.httpStatus },
      );
    }
    const body = parseJsonRecord(bodyResult.value);
    const item = await createSignatureVersion(db, actor, {
      senderIdentityId: id,
      bodyText: readStringField(body, "bodyText"),
      bodyHtml: readStringField(body, "bodyHtml"),
      assets: parseAssets(body.assets),
    });
    return Response.json({ item }, { status: 201 });
  } catch (error) {
    return mailErrorResponse(error);
  }
}
