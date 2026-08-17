/**
 * Customer State Engine V2 shadow configuration (C3).
 *
 * Kill switch: set CRM_STATE_SHADOW=0 to disable. Set CRM_STATE_SHADOW=1 to
 * force enable outside production. When unset, shadow is enabled in production.
 */

export function isStateV2ShadowGloballyEnabled(): boolean {
  const flag = process.env.CRM_STATE_SHADOW;
  if (flag === "0" || flag === "false") return false;
  if (flag === "1" || flag === "true") return true;
  return process.env.NODE_ENV === "production";
}
