/**
 * Provider Phase 2 contract mode selection (server-side only).
 * Never trust client input for this value.
 */
import type { AiProviderKind } from "@/lib/settings/ai-keys";

export type AiProviderPhase2ContractMode = "none" | "rich" | "gemini_flat";

/**
 * Maps resolved provider kind → Phase 2 extraction contract.
 * - google_gemini → Flat `phase2SignalRows` (5C-G2)
 * - openai_compatible → rich `phase2Signals`
 * - mock / others → none (Base only; no fabricated Phase 2)
 */
export function resolveAiProviderPhase2ContractMode(
  providerKind: AiProviderKind | string,
): AiProviderPhase2ContractMode {
  if (providerKind === "google_gemini") {
    return "gemini_flat";
  }
  if (providerKind === "openai_compatible") {
    return "rich";
  }
  return "none";
}
