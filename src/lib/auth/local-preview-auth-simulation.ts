export const LOCAL_AUTH_SIMULATION_FLAG =
  "CRM_LOCAL_PREVIEW_AUTH_SIMULATION_ENABLED";

export function isLocalAuthSimulationEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return (
    env.NODE_ENV !== "production" &&
    env[LOCAL_AUTH_SIMULATION_FLAG] === "true"
  );
}
