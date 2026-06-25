/** Cloudflare Access logout — clears Access session cookie (production only). */
export const CLOUDFLARE_ACCESS_LOGOUT_PATH = "/cdn-cgi/access/logout";

/** Local dev fallback when Access is not in front of the app. */
export const LOCAL_LOGOUT_PATH = "/login";

/**
 * After CRM session ends (manual logout, idle timeout, Access window expired).
 * - development → /login (localhost has no /cdn-cgi/access/logout)
 * - production → Cloudflare Access logout
 */
export function getPostLogoutRedirectPath(): string {
  if (process.env.NODE_ENV === "development") {
    return LOCAL_LOGOUT_PATH;
  }
  return CLOUDFLARE_ACCESS_LOGOUT_PATH;
}
