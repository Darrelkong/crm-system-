import {
  getPlatformProxy,
  type GetPlatformProxyOptions,
  type PlatformProxy,
} from "wrangler";

/**
 * Test-only wrapper for isolating Wrangler's local persistence per child process.
 * Without CRM_TEST_D1_PERSIST_PATH, it preserves Wrangler's normal default.
 */
export function getTestD1PlatformProxy<Env = Record<string, unknown>>(
  options: GetPlatformProxyOptions = {},
): Promise<PlatformProxy<Env>> {
  const persistPath = process.env.CRM_TEST_D1_PERSIST_PATH;
  return getPlatformProxy<Env>({
    ...options,
    ...(persistPath ? { persist: { path: persistPath } } : {}),
  });
}
