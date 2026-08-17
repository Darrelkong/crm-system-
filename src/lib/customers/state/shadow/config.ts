/**
 * Customer State Engine V2 shadow configuration (C3).
 *
 * Fail-closed: shadow runs only when CRM_STATE_SHADOW=1.
 */

export function isStateV2ShadowGloballyEnabled(): boolean {
  return process.env.CRM_STATE_SHADOW === "1";
}
