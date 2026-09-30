import { RATING_REQUIRED_OUTCOMES, type CustomerRating } from "@/lib/customers/rating/domain";
import { authorizedRatingCustomer, ratingConflict } from "@/lib/customers/rating/persistence";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { assertCanAddFollowUp, PermissionError, resolveCustomerAccessOptions, } from "@/lib/permissions/customers";
import { logPermissionDenied } from "@/lib/permissions/audit";
import { getCustomerById } from "@/lib/customers/queries";
import { blockPendingOnHoldCreateCustomer } from "@/lib/customers/pending-on-hold-api";
import { writeAuditLog } from "@/lib/audit/audit-log";
import { normalizeNextFollowUpAt, validateFollowUpInput, } from "@/lib/follow-ups/validation";
import { listFollowUpsByCustomerId } from "@/lib/follow-ups/queries";
import { evaluateDuplicateFollowUpContent, } from "@/lib/follow-ups/duplicate-content";
import { syncReclamationWorkItems } from "@/lib/reclamation/work-items-sync";
import { commitFollowUpCreate } from "./create-transaction";
import { isValidFollowUpOutcome } from "@/lib/constants/follow-up-outcomes";
import { getRequestMeta } from "@/lib/auth/cookies";
import type { FollowUpOutcome } from "@/lib/constants/follow-up-outcomes";
import { enforceFirstContactFollowUpGate, FIRST_CONTACT_REQUIRED_ERROR_CODE, } from "@/lib/follow-ups/first-contact-gate";
import type { User } from "../../../drizzle/schema/users";
export async function createCustomerFollowUp(request: Request, id: string, user: User): Promise<Response> {
    const { ipAddress, userAgent } = getRequestMeta(request);
    const customer = await getCustomerById(id);
    if (!customer) {
        return Response.json({ error: "客户不存在", errorCode: "CUSTOMER_NOT_FOUND" }, { status: 404 });
    }
    const db = getDb();
    const pendingBlock = await blockPendingOnHoldCreateCustomer(db, id);
    if (pendingBlock) {
        return pendingBlock;
    }
    const accessOptions = await resolveCustomerAccessOptions(db, user, id);
    try {
        assertCanAddFollowUp(user, customer, accessOptions);
    }
    catch (err) {
        if (err instanceof PermissionError) {
            await logPermissionDenied(request, {
                action: "follow_up.create_failed.permission_denied",
                userId: user.id,
                entityType: "customer",
                entityId: id,
                metadata: { reason: err.message },
            });
        }
        throw err;
    }
    const body = (await request.json()) as Record<string, unknown>;
    const input = {
        followUpTime: typeof body.followUpTime === "string" ? body.followUpTime : undefined,
        channel: typeof body.channel === "string" ? body.channel : "",
        outcome: typeof body.outcome === "string" ? body.outcome : "",
        summary: typeof body.summary === "string" ? body.summary : "",
        customerRating: body.customerRating,
        expectedCustomerRatingRevision: body.expectedCustomerRatingRevision,
        customerIntent: typeof body.customerIntent === "string" ? body.customerIntent : null,
        nextFollowUpAt: typeof body.nextFollowUpAt === "string" ? body.nextFollowUpAt : null,
        nextAction: typeof body.nextAction === "string" ? body.nextAction : null,
    };
    const submissionId = body.submissionId;
    if (typeof submissionId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(submissionId)) {
        return Response.json({ error: "提交标识无效，请重新打开表单", errorCode: "VALIDATION_FAILED" }, { status: 400 });
    }
    const followUpId = submissionId.toLowerCase();
    const requiresRating = RATING_REQUIRED_OUTCOMES.includes(input.outcome as FollowUpOutcome);
    const recover = async (): Promise<Response | null> => {
        const row = (await db.select().from(schema.followUps).where(eq(schema.followUps.id, followUpId)).limit(1))[0];
        if (!row)
            return null;
        const event = (await db.select().from(schema.customerRatingHistory).where(eq(schema.customerRatingHistory.followUpId, followUpId)).limit(1))[0];
        const ratingMatches = requiresRating ? !!event && event.actorUserId === user.id && event.customerId === id
            && event.action === "follow_up_confirmed" && event.ratingAfter === input.customerRating
            && event.revisionBefore === input.expectedCustomerRatingRevision : !event;
        const matches = ratingMatches && row.customerId === id && row.userId === user.id &&
            row.channel === input.channel && row.outcome === input.outcome && row.summary === input.summary.trim() &&
            row.customerIntent === (input.customerIntent?.trim() || null) && row.nextAction === (input.nextAction?.trim() || null) &&
            row.nextFollowUpAt === normalizeNextFollowUpAt(input.nextFollowUpAt) &&
            (!input.followUpTime?.trim() || row.followUpTime === input.followUpTime.trim());
        if (!matches)
            return Response.json({ error: "该提交已保存且内容不同，请重新打开表单", errorCode: "FOLLOW_UP_SUBMISSION_CONFLICT" }, { status: 409 });
        const audit = (await db.select().from(schema.auditLogs).where(and(eq(schema.auditLogs.entityId, followUpId), eq(schema.auditLogs.action, "follow_up.created"))).limit(1))[0];
        if (!audit)
            throw new Error("Follow-up receipt unavailable");
        const metadata = JSON.parse(audit.metadata ?? "{}");
        return Response.json({ ok: true, id: row.id, followUpId: row.id,
            ...(event ? { customerRating: event.ratingAfter, customerRatingRevision: event.revisionAfter } : {}),
            ratingEventId: event?.id ?? null, isValidFollowUp: row.isValidFollowUp === 1,
            taskId: typeof metadata.taskId === "string" ? metadata.taskId : null }, { status: 201 });
    };
    const canonical = await recover();
    if (canonical)
        return canonical;
    const fieldErrors = validateFollowUpInput(input);
    if (fieldErrors.length > 0) {
        await writeAuditLog({
            userId: user.id,
            action: "follow_up.create_failed.validation",
            entityType: "customer",
            entityId: id,
            ipAddress,
            userAgent,
            metadata: { fieldErrors },
        });
        return Response.json({ error: "输入校验失败", errorCode: "VALIDATION_FAILED", fieldErrors }, { status: 400 });
    }
    if (requiresRating) {
        await authorizedRatingCustomer(db, id, user);
        const stale = await ratingConflict(db, id, user, input.expectedCustomerRatingRevision as number);
        if (stale) return (await recover()) ?? stale;
    }
    const confirmDuplicateFollowUp = body.confirmDuplicateFollowUp === true ||
        body.confirmDuplicateFollowUp === "true";
    const existingFollowUps = await listFollowUpsByCustomerId(id);
    const latestByUser = existingFollowUps.find((row) => row.userId === user.id);
    const duplicateCheck = evaluateDuplicateFollowUpContent({
        newSummary: input.summary,
        previousSummary: latestByUser?.summary ?? null,
        previousFollowUpTime: latestByUser?.followUpTime ?? null,
        now: new Date(),
        confirmed: confirmDuplicateFollowUp,
    });
    if (duplicateCheck.kind === "duplicate_requires_confirm") {
        const concurrentCanonical = await recover();
        if (concurrentCanonical)
            return concurrentCanonical;
        return Response.json({
            error: "本次跟进内容与最近一次记录相同，请确认是否继续提交。",
            errorCode: "FOLLOW_UP_DUPLICATE_CONTENT",
            requiresConfirm: true,
        }, { status: 409 });
    }
    const followUpTime = input.followUpTime?.trim() || new Date().toISOString();
    const outcome = input.outcome as FollowUpOutcome;
    const isValid = isValidFollowUpOutcome(outcome) ? 1 : 0;
    const nextFollowUpAt = normalizeNextFollowUpAt(input.nextFollowUpAt);
    const now = new Date().toISOString();
    const firstContactGate = await enforceFirstContactFollowUpGate({
        db,
        customer,
        actor: user,
        now,
    });
    if (!firstContactGate.allowed) {
        await writeAuditLog({
            userId: user.id,
            action: "follow_up.create_failed.first_contact_required",
            entityType: "customer",
            entityId: id,
            ipAddress,
            userAgent,
            metadata: {
                firstContactTaskId: firstContactGate.firstContactTaskId,
            },
        });
        return Response.json({
            error: "请先完成首次联系，再提交首次跟进。",
            errorCode: FIRST_CONTACT_REQUIRED_ERROR_CODE,
            firstContactTaskId: firstContactGate.firstContactTaskId,
        }, { status: 403 });
    }
    try {
        await commitFollowUpCreate(db, { rating: requiresRating ? {
                eventId: crypto.randomUUID(), customerId: id, followUpId, actor: user,
                rating: input.customerRating as CustomerRating, expectedRevision: input.expectedCustomerRatingRevision as number,
                action: "follow_up_confirmed", reason: null, now, ipAddress, userAgent,
            } : undefined, customer, confirmed: confirmDuplicateFollowUp, ipAddress, userAgent, row: {
                id: followUpId,
                customerId: id,
                userId: user.id,
                followUpTime,
                channel: input.channel,
                outcome: input.outcome,
                summary: input.summary.trim(),
                customerIntent: input.customerIntent?.trim() || null,
                nextFollowUpAt,
                nextAction: input.nextAction!.trim(),
                isValidFollowUp: isValid,
                content: input.summary.trim(),
                createdAt: now,
            } });
    }
    catch (error) {
        // Handles both a losing PK race and a committed batch whose response was lost.
        const committed = await recover();
        if (committed)
            return committed;
        if (requiresRating) {
            const stale = await ratingConflict(db, id, user, input.expectedCustomerRatingRevision as number);
            if (stale) return (await recover()) ?? stale;
        }
        throw error;
    }
    if (isValid === 1 && customer.ownerId === user.id) {
        // Derived summary reconciliation only; business completion/reset is already atomic.
        // Replays never repeat it. The existing reclamation engine also refreshes summaries.
        try {
            await syncReclamationWorkItems(db);
        }
        catch {
            console.warn("follow_up.reclamation_summary_refresh_failed", { followUpId });
        }
    }
    const committed = await recover();
    if (!committed)
        throw new Error("Follow-up commit unavailable");
    return committed;
}
