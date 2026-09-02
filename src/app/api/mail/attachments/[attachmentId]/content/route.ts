export const dynamic = "force-dynamic";

import {
  handleGetMailAttachmentContent,
  type MailAttachmentDownloadRouteDeps,
} from "@/app/api/mail/attachments/[attachmentId]/download/route";

type RouteContext = { params: Promise<{ attachmentId: string }> };

export async function handleGetMailAttachmentContentRoute(
  request: Request,
  attachmentId: string,
  deps?: MailAttachmentDownloadRouteDeps,
): Promise<Response> {
  return handleGetMailAttachmentContent(request, attachmentId, deps);
}

export async function GET(request: Request, context: RouteContext) {
  const { attachmentId } = await context.params;
  return handleGetMailAttachmentContentRoute(request, attachmentId);
}
