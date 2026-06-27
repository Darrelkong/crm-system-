import {
  getClientIpFromRequest,
  hasDisallowedIpEmailRestrictionStatusQuery,
  IP_EMAIL_RESTRICTION_STATUS_CACHE_HEADERS,
  readIpEmailRestrictionStatus,
} from "@/lib/auth/ip-email-restriction";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  if (hasDisallowedIpEmailRestrictionStatusQuery(url.searchParams)) {
    return Response.json(
      { error: "Invalid request" },
      {
        status: 400,
        headers: IP_EMAIL_RESTRICTION_STATUS_CACHE_HEADERS,
      },
    );
  }

  const ipAddress = getClientIpFromRequest(request);
  const status = await readIpEmailRestrictionStatus(ipAddress);

  return Response.json(status, {
    headers: IP_EMAIL_RESTRICTION_STATUS_CACHE_HEADERS,
  });
}
