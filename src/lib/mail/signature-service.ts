import { and, desc, eq, isNull } from "drizzle-orm";
import { sql } from "drizzle-orm";
import type { MailSignatureVersion } from "../../../drizzle/schema/mail-signature-versions";
import { buildInsertAuditLogSelectStatement } from "@/lib/audit/audit-log";
import { schema, type Database } from "@/lib/db";
import type { MailActorContext } from "@/lib/mail/actor-context";
import { MAIL_AUDIT_ACTIONS } from "@/lib/mail/constants";
import {
  assertBatchUpdateChanged,
  isMailPostStateGuardError,
  runMailBatch,
} from "@/lib/mail/guarded-batch";
import { MailServiceError } from "@/lib/mail/errors";
import { findActiveSenderIdentityGrant } from "@/lib/mail/sender-identity-grant-service";
import { findSenderIdentityById } from "@/lib/mail/sender-identity-service";
import {
  toSafeSignatureVersionAssetView,
  toSafeSignatureVersionView,
  type SafeEffectiveSignatureView,
  type SafeSignatureVersionView,
} from "@/lib/mail/signature-serialization";
import {
  assertSignatureAssetMimeType,
} from "@/lib/mail/signature-html-policy";
import { sanitizeOptionalSignatureHtml } from "@/lib/mail/signature-html-sanitizer";
import {
  assertMailAccessEnabled,
  assertMailSenderIdentityManagement,
  assertMailSignatureTemplateManagement,
  hasAnyMailAdminGrant,
} from "@/lib/permissions/mail";

export type SignatureVersionAssetInput = {
  storedFileId: string;
  contentHash: string;
  assetRef: string;
  mimeType: string;
  sizeBytes: number;
  sortOrder?: number;
};

function buildSignatureAuditInsert(
  db: Database,
  actor: MailActorContext,
  input: {
    auditId: string;
    now: string;
    action: string;
    entityId: string;
    metadata: Record<string, unknown>;
  },
) {
  const metadataJson = JSON.stringify(input.metadata);
  return buildInsertAuditLogSelectStatement(
    db,
    sql`
      SELECT
        ${input.auditId} AS id,
        ${actor.userId} AS user_id,
        ${input.action} AS action,
        ${"mail_signature_version"} AS entity_type,
        ${input.entityId} AS entity_id,
        ${actor.audit.ipAddress ?? null} AS ip_address,
        ${actor.audit.userAgent ?? null} AS user_agent,
        ${metadataJson} AS metadata,
        ${input.now} AS created_at
    `,
  );
}

async function requireSenderIdentityExists(
  db: Database,
  senderIdentityId: string,
) {
  const identity = await findSenderIdentityById(db, senderIdentityId);
  if (!identity) {
    throw MailServiceError.notFound("Sender identity not found");
  }
  return identity;
}

async function findSignatureVersionById(
  db: Database,
  versionId: string,
): Promise<MailSignatureVersion | null> {
  const [row] = await db
    .select()
    .from(schema.mailSignatureVersions)
    .where(eq(schema.mailSignatureVersions.id, versionId))
    .limit(1);
  return row ?? null;
}

async function findActiveSignatureVersion(
  db: Database,
  senderIdentityId: string,
): Promise<MailSignatureVersion | null> {
  const [row] = await db
    .select()
    .from(schema.mailSignatureVersions)
    .where(
      and(
        eq(schema.mailSignatureVersions.senderIdentityId, senderIdentityId),
        eq(schema.mailSignatureVersions.isActive, 1),
      ),
    )
    .limit(1);
  return row ?? null;
}

async function nextSignatureVersionNumber(
  db: Database,
  senderIdentityId: string,
): Promise<number> {
  const [row] = await db
    .select({ versionNumber: schema.mailSignatureVersions.versionNumber })
    .from(schema.mailSignatureVersions)
    .where(eq(schema.mailSignatureVersions.senderIdentityId, senderIdentityId))
    .orderBy(desc(schema.mailSignatureVersions.versionNumber))
    .limit(1);
  return (row?.versionNumber ?? 0) + 1;
}

async function validateStoredFileForSignatureAsset(
  db: Database,
  input: SignatureVersionAssetInput,
): Promise<void> {
  assertSignatureAssetMimeType(input.mimeType);

  const [storedFile] = await db
    .select()
    .from(schema.mailStoredFiles)
    .where(
      and(
        eq(schema.mailStoredFiles.id, input.storedFileId),
        eq(schema.mailStoredFiles.contentHash, input.contentHash),
      ),
    )
    .limit(1);
  if (!storedFile) {
    throw MailServiceError.notFound("Stored file not found for asset reference");
  }
  if (storedFile.securityScanStatus === "blocked") {
    throw MailServiceError.validation("Stored file is blocked for signature use");
  }
  if (storedFile.mimeType.toLowerCase() !== input.mimeType.toLowerCase()) {
    throw MailServiceError.validation("Asset MIME type does not match stored file");
  }
  if (storedFile.sizeBytes !== input.sizeBytes) {
    throw MailServiceError.validation("Asset size does not match stored file");
  }
}

function assertMayReadSignatureForIdentity(
  actor: MailActorContext,
  senderIdentityId: string,
  hasGrant: boolean,
): void {
  assertMailAccessEnabled(actor);
  const isSignatureAdmin = hasAnyMailAdminGrant(actor, [
    "super_admin",
    "signature_template",
  ]);
  const isIdentityAdmin = hasAnyMailAdminGrant(actor, [
    "super_admin",
    "address_assignment",
  ]);
  if (!isSignatureAdmin && !isIdentityAdmin && !hasGrant) {
    throw MailServiceError.forbidden(
      "Sender identity grant or signature admin permission required",
    );
  }
}

export async function listSignatureVersions(
  db: Database,
  actor: MailActorContext,
  senderIdentityId: string,
): Promise<SafeSignatureVersionView[]> {
  assertMailSignatureTemplateManagement(actor);
  await requireSenderIdentityExists(db, senderIdentityId);
  const rows = await db
    .select()
    .from(schema.mailSignatureVersions)
    .where(eq(schema.mailSignatureVersions.senderIdentityId, senderIdentityId))
    .orderBy(desc(schema.mailSignatureVersions.versionNumber));
  return rows.map(toSafeSignatureVersionView);
}

export async function getCurrentSignatureForIdentity(
  db: Database,
  actor: MailActorContext,
  senderIdentityId: string,
): Promise<SafeEffectiveSignatureView | null> {
  assertMailSignatureTemplateManagement(actor);
  await requireSenderIdentityExists(db, senderIdentityId);
  const active = await findActiveSignatureVersion(db, senderIdentityId);
  if (!active) return null;
  return loadEffectiveSignatureView(db, active);
}

export async function getEffectiveSignatureForAuthorizedSender(
  db: Database,
  actor: MailActorContext,
  senderIdentityId: string,
): Promise<SafeEffectiveSignatureView | null> {
  const grant = await findActiveSenderIdentityGrant(
    db,
    senderIdentityId,
    actor.userId,
  );
  assertMayReadSignatureForIdentity(actor, senderIdentityId, Boolean(grant));
  await requireSenderIdentityExists(db, senderIdentityId);
  const active = await findActiveSignatureVersion(db, senderIdentityId);
  if (!active) return null;
  return loadEffectiveSignatureView(db, active);
}

async function loadEffectiveSignatureView(
  db: Database,
  version: MailSignatureVersion,
): Promise<SafeEffectiveSignatureView> {
  const assets = await db
    .select()
    .from(schema.mailSignatureVersionAssets)
    .where(eq(schema.mailSignatureVersionAssets.signatureVersionId, version.id))
    .orderBy(schema.mailSignatureVersionAssets.sortOrder);
  return {
    ...toSafeSignatureVersionView(version),
    assets: assets.map(toSafeSignatureVersionAssetView),
  };
}

export async function createSignatureVersion(
  db: Database,
  actor: MailActorContext,
  input: {
    senderIdentityId: string;
    bodyText?: string;
    bodyHtml?: string | null;
    assets?: SignatureVersionAssetInput[];
  },
): Promise<SafeSignatureVersionView> {
  assertMailSignatureTemplateManagement(actor);
  await requireSenderIdentityExists(db, input.senderIdentityId);

  const bodyHtmlSanitized = sanitizeOptionalSignatureHtml(input.bodyHtml);

  const bodyText = input.bodyText?.trim() ?? "";
  if (!bodyText && !bodyHtmlSanitized) {
    throw MailServiceError.validation(
      "bodyText or bodyHtml with safe content is required",
    );
  }
  const assets = input.assets ?? [];
  for (const asset of assets) {
    await validateStoredFileForSignatureAsset(db, asset);
  }

  const now = new Date().toISOString();
  const versionId = crypto.randomUUID();
  const versionNumber = await nextSignatureVersionNumber(
    db,
    input.senderIdentityId,
  );
  const auditId = crypto.randomUUID();

  type BatchStatement = Parameters<Database["batch"]>[0][number];
  const statements: BatchStatement[] = [
    db.insert(schema.mailSignatureVersions).values({
      id: versionId,
      senderIdentityId: input.senderIdentityId,
      versionNumber,
      bodyText,
      bodyHtmlSanitized,
      assetRefsJson: null,
      isActive: 0,
      createdByUserId: actor.userId,
      createdAt: now,
    }),
    buildSignatureAuditInsert(db, actor, {
      auditId,
      now,
      action: MAIL_AUDIT_ACTIONS.signatureVersionCreated,
      entityId: versionId,
      metadata: {
        senderIdentityId: input.senderIdentityId,
        signatureVersionId: versionId,
        versionNumber,
        actorUserId: actor.userId,
      },
    }),
  ];

  for (const [index, asset] of assets.entries()) {
    statements.push(
      db.insert(schema.mailSignatureVersionAssets).values({
        id: crypto.randomUUID(),
        signatureVersionId: versionId,
        storedFileId: asset.storedFileId,
        contentHash: asset.contentHash,
        assetRef: asset.assetRef,
        mimeType: asset.mimeType.toLowerCase(),
        sizeBytes: asset.sizeBytes,
        sortOrder: asset.sortOrder ?? index,
        createdAt: now,
      }),
    );
  }

  try {
    await runMailBatch(db, statements);
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw MailServiceError.conflict("Signature version conflict");
    }
    throw error;
  }

  const version = await findSignatureVersionById(db, versionId);
  if (!version) {
    throw MailServiceError.integrityConflict("Signature version creation failed");
  }
  return toSafeSignatureVersionView(version);
}

export async function activateSignatureVersion(
  db: Database,
  actor: MailActorContext,
  versionId: string,
): Promise<SafeSignatureVersionView> {
  assertMailSignatureTemplateManagement(actor);

  const version = await findSignatureVersionById(db, versionId);
  if (!version) {
    throw MailServiceError.notFound("Signature version not found");
  }
  if (version.isActive === 1) {
    return toSafeSignatureVersionView(version);
  }
  if (version.retiredAt) {
    throw MailServiceError.conflict("Retired signature version cannot be activated");
  }

  const currentActive = await findActiveSignatureVersion(
    db,
    version.senderIdentityId,
  );
  const now = new Date().toISOString();
  const auditId = crypto.randomUUID();

  const statements = [];
  if (currentActive && currentActive.id !== version.id) {
    statements.push(
      db
        .update(schema.mailSignatureVersions)
        .set({ isActive: 0 })
        .where(
          and(
            eq(schema.mailSignatureVersions.id, currentActive.id),
            eq(schema.mailSignatureVersions.isActive, 1),
          ),
        ),
    );
  }

  statements.push(
    db
      .update(schema.mailSignatureVersions)
      .set({ isActive: 1 })
      .where(
        and(
          eq(schema.mailSignatureVersions.id, version.id),
          eq(schema.mailSignatureVersions.isActive, 0),
          isNull(schema.mailSignatureVersions.retiredAt),
        ),
      ),
    buildSignatureAuditInsert(db, actor, {
      auditId,
      now,
      action: MAIL_AUDIT_ACTIONS.signatureVersionActivated,
      entityId: version.id,
      metadata: {
        senderIdentityId: version.senderIdentityId,
        signatureVersionId: version.id,
        versionNumber: version.versionNumber,
        previousActiveVersionId: currentActive?.id ?? null,
        actorUserId: actor.userId,
      },
    }),
  );

  try {
    const results = await runMailBatch(db, statements);
    const activateIndex = currentActive && currentActive.id !== version.id ? 1 : 0;
    assertBatchUpdateChanged(
      results,
      activateIndex,
      "Signature version activate conflict",
    );
  } catch (error) {
    if (isMailPostStateGuardError(error)) {
      throw MailServiceError.staleVersion("Signature version activate conflict");
    }
    if (isUniqueConstraintError(error)) {
      throw MailServiceError.conflict("Only one active signature version allowed");
    }
    throw error;
  }

  const activated = await findSignatureVersionById(db, version.id);
  if (!activated || activated.isActive !== 1) {
    throw MailServiceError.integrityConflict("Signature version activation failed");
  }
  return toSafeSignatureVersionView(activated);
}

function isUniqueConstraintError(error: unknown): boolean {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";
  return /UNIQUE constraint failed/i.test(message);
}
