export const dynamic = "force-dynamic";

import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getDb } from "@/lib/db";
import {
  CRM_SYSTEM_GATEWAY_SECRET_HEADER,
} from "@/lib/mail/large-attachment/large-attachment-download-authorization";
import {
  authorizeLargeAttachmentPublicDownload,
  createLargeAttachmentGatewayAuthorizationRepository,
  recordLargeAttachmentPublicDownload,
  type LargeAttachmentGatewayAuthorizationRepository,
} from "@/lib/mail/large-attachment/large-attachment-download-authorization-service";

type GatewayRpcBody =
  | {
      action: "authorize";
      tokenHash: string;
      trustNowIso: string;
    }
  | {
      action: "record";
      lifecycleId: string;
      tokenHash: string;
      downloadedAt: string;
    };

export type LargeAttachmentGatewayRpcDependencies = {
  gatewaySecret: string;
  repository: LargeAttachmentGatewayAuthorizationRepository;
};

function constantTimeSecretEqual(left: string, right: string): boolean {
  if (!left || left.length !== right.length) {
    return false;
  }
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

function internalNotFound(): Response {
  return Response.json({ authorized: false }, { status: 404 });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseRpcBody(value: unknown): GatewayRpcBody | null {
  if (!isRecord(value) || typeof value.action !== "string") {
    return null;
  }
  if (
    value.action === "authorize" &&
    typeof value.tokenHash === "string" &&
    typeof value.trustNowIso === "string"
  ) {
    return {
      action: "authorize",
      tokenHash: value.tokenHash,
      trustNowIso: value.trustNowIso,
    };
  }
  if (
    value.action === "record" &&
    typeof value.lifecycleId === "string" &&
    typeof value.tokenHash === "string" &&
    typeof value.downloadedAt === "string"
  ) {
    return {
      action: "record",
      lifecycleId: value.lifecycleId,
      tokenHash: value.tokenHash,
      downloadedAt: value.downloadedAt,
    };
  }
  return null;
}

export async function handleLargeAttachmentGatewayRpc(
  request: Request,
  dependencies: LargeAttachmentGatewayRpcDependencies,
): Promise<Response> {
  const suppliedSecret = request.headers.get(CRM_SYSTEM_GATEWAY_SECRET_HEADER) ?? "";
  if (!constantTimeSecretEqual(suppliedSecret, dependencies.gatewaySecret)) {
    return internalNotFound();
  }

  let body: GatewayRpcBody | null;
  try {
    body = parseRpcBody(await request.json());
  } catch {
    body = null;
  }
  if (!body) {
    return internalNotFound();
  }

  try {
    if (body.action === "authorize") {
      const result = await authorizeLargeAttachmentPublicDownload(
        dependencies.repository,
        body,
      );
      return Response.json(result);
    }

    const result = await recordLargeAttachmentPublicDownload(
      dependencies.repository,
      body,
    );
    return Response.json(result);
  } catch (error) {
    console.error(
      "[large-attachment-gateway-rpc] failed",
      error instanceof Error ? error.message : "unknown error",
    );
    return new Response(null, { status: 500 });
  }
}

export async function POST(request: Request): Promise<Response> {
  const { env } = getCloudflareContext();
  const gatewaySecret = env.CRM_SYSTEM_GATEWAY_SECRET;
  if (!gatewaySecret) {
    return internalNotFound();
  }

  return handleLargeAttachmentGatewayRpc(request, {
    gatewaySecret,
    repository: createLargeAttachmentGatewayAuthorizationRepository(getDb()),
  });
}
