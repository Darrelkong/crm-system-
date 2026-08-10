import {
  buildInstallPortalHtml,
  resolveInstallPortalLocale,
} from "@/lib/pwa/install-portal";

export function GET(request: Request) {
  const acceptLanguage = request.headers.get("accept-language");
  const html = buildInstallPortalHtml(resolveInstallPortalLocale(acceptLanguage));

  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=300",
    },
  });
}
