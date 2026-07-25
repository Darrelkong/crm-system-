/**
 * Framework-free Phase 5D-3 component feedback client.
 * Used by the React hook and runtime interaction tests.
 */

import type { AiInsightFeedbackRatingCode } from "@/lib/ai/customer-insights/feedback-contract";
import {
  assertExactPutBodyKeys,
  buildComponentFeedbackPutBody,
  draftsDifferFromSaved,
  eligibilityForTarget,
  targetToFeedbackKey,
  toggleDraftTag,
  type ComponentFeedbackApiResponse,
  type ComponentFeedbackUiTarget,
} from "@/components/customers/ai-insight-component-feedback";

export type FeedbackHydrationStatus =
  | "idle"
  | "loading"
  | "ready"
  | "unavailable"
  | "error";

export type TargetFeedbackUiState = {
  rating: AiInsightFeedbackRatingCode | null;
  savedTags: string[];
  draftTags: string[];
  saving: boolean;
  statusMessage: string | null;
  error: string | null;
  generationMismatch: boolean;
};

export type TargetsState = Record<ComponentFeedbackUiTarget, TargetFeedbackUiState>;

export type ComponentFeedbackClientSnapshot = {
  hydration: FeedbackHydrationStatus;
  eligibility: ComponentFeedbackApiResponse["eligibility"] | null;
  targets: TargetsState;
  loadError: string | null;
  /** Exposed only for tests — never render/log this. */
  hasGeneration: boolean;
};

export type ComponentFeedbackClientMessages = {
  unavailable: string;
  saveFailed: string;
  generationMismatch: string;
  saved: string;
  updated: string;
};

export type ComponentFeedbackFetch = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

const EMPTY_TARGET: TargetFeedbackUiState = {
  rating: null,
  savedTags: [],
  draftTags: [],
  saving: false,
  statusMessage: null,
  error: null,
  generationMismatch: false,
};

export function emptyTargets(): TargetsState {
  return {
    base_deep: { ...EMPTY_TARGET },
    phase2: { ...EMPTY_TARGET },
    suggested_message: { ...EMPTY_TARGET },
  };
}

function itemToTargetState(
  item: ComponentFeedbackApiResponse["feedback"]["baseDeep"],
): TargetFeedbackUiState {
  if (!item) return { ...EMPTY_TARGET };
  return {
    rating: item.rating,
    savedTags: [...item.tags],
    draftTags: [...item.tags],
    saving: false,
    statusMessage: null,
    error: null,
    generationMismatch: false,
  };
}

function applyHydratedFeedback(data: ComponentFeedbackApiResponse): TargetsState {
  return {
    base_deep: itemToTargetState(data.feedback.baseDeep),
    phase2: itemToTargetState(data.feedback.phase2),
    suggested_message: itemToTargetState(data.feedback.suggestedMessage),
  };
}

export function shouldShowComponentFeedbackControl(args: {
  sectionVisible: boolean;
  hydration: FeedbackHydrationStatus;
  eligibility: ComponentFeedbackApiResponse["eligibility"] | null;
  target: ComponentFeedbackUiTarget;
}): boolean {
  if (!args.sectionVisible) return false;
  if (args.hydration === "idle" || args.hydration === "loading") return false;
  if (args.hydration === "unavailable" || args.hydration === "error") return false;
  return eligibilityForTarget(args.eligibility, args.target);
}

function componentsUrl(customerId: string): string {
  return `/api/customers/${customerId}/ai-insight-feedback/components`;
}

export class AiInsightComponentFeedbackClient {
  private customerId = "";
  private hydration: FeedbackHydrationStatus = "idle";
  private eligibility: ComponentFeedbackApiResponse["eligibility"] | null =
    null;
  private targets: TargetsState = emptyTargets();
  private loadError: string | null = null;
  private generation: {
    insightGeneratedAt: string;
    sourceHash: string;
  } | null = null;
  private loadSeq = 0;
  private putSeq: Record<ComponentFeedbackUiTarget, number> = {
    base_deep: 0,
    phase2: 0,
    suggested_message: 0,
  };
  private disposed = false;
  private listeners = new Set<() => void>();
  /** Stable snapshot reference until the next emit (required by useSyncExternalStore). */
  private cachedSnapshot: ComponentFeedbackClientSnapshot;

  constructor(
    private readonly messages: ComponentFeedbackClientMessages,
    private readonly fetchImpl: ComponentFeedbackFetch = fetch,
  ) {
    this.cachedSnapshot = this.buildSnapshot();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getSnapshot(): ComponentFeedbackClientSnapshot {
    return this.cachedSnapshot;
  }

  /** Test-only: read in-memory generation without exposing via snapshot fields for UI. */
  peekGenerationForTests(): {
    insightGeneratedAt: string;
    sourceHash: string;
  } | null {
    return this.generation
      ? {
          insightGeneratedAt: this.generation.insightGeneratedAt,
          sourceHash: this.generation.sourceHash,
        }
      : null;
  }

  dispose(): void {
    this.disposed = true;
    this.loadSeq += 1;
    this.listeners.clear();
  }

  reset(): void {
    this.generation = null;
    this.eligibility = null;
    this.targets = emptyTargets();
    this.loadError = null;
    this.hydration = "idle";
    this.emit();
  }

  clearGenerationMismatch(): void {
    this.reset();
  }

  /**
   * Start (or restart) hydration for a customer/generation.
   * Bumps loadSeq so in-flight responses from prior sessions are ignored.
   */
  async load(args: {
    customerId: string;
    insightReady: boolean;
    insightGeneratedAt: string | null;
    insightSourceHash: string | null;
  }): Promise<void> {
    this.customerId = args.customerId;
    const seq = ++this.loadSeq;

    if (
      !args.insightReady ||
      !args.insightGeneratedAt ||
      !args.insightSourceHash
    ) {
      this.reset();
      return;
    }

    this.hydration = "loading";
    this.loadError = null;
    this.emit();

    try {
      const response = await this.fetchImpl(componentsUrl(args.customerId));
      if (!this.isLoadCurrent(seq, args.customerId)) return;

      if (response.status === 403 || response.status === 404) {
        this.generation = null;
        this.eligibility = null;
        this.targets = emptyTargets();
        this.loadError = null;
        this.hydration = "unavailable";
        this.emit();
        return;
      }

      if (!response.ok) {
        throw new Error("load_failed");
      }

      const data = (await response.json()) as ComponentFeedbackApiResponse;
      if (!this.isLoadCurrent(seq, args.customerId)) return;

      if (!data.ok || !data.generation) {
        this.generation = null;
        this.eligibility = data.eligibility ?? null;
        this.targets = emptyTargets();
        this.hydration = "unavailable";
        this.emit();
        return;
      }

      this.generation = {
        insightGeneratedAt: data.generation.insightGeneratedAt,
        sourceHash: data.generation.sourceHash,
      };
      this.eligibility = data.eligibility;
      this.targets = applyHydratedFeedback(data);
      this.hydration = "ready";
      this.loadError = null;
      this.emit();
    } catch {
      if (!this.isLoadCurrent(seq, args.customerId)) return;
      this.generation = null;
      this.eligibility = null;
      this.targets = emptyTargets();
      this.loadError = this.messages.unavailable;
      this.hydration = "error";
      this.emit();
    }
  }

  retryLoad(args: {
    customerId: string;
    insightReady: boolean;
    insightGeneratedAt: string | null;
    insightSourceHash: string | null;
  }): Promise<void> {
    return this.load(args);
  }

  submitRating(
    target: ComponentFeedbackUiTarget,
    rating: AiInsightFeedbackRatingCode,
  ): void {
    const current = this.targets[target];
    if (current.saving) return;
    if (!eligibilityForTarget(this.eligibility, target)) return;
    // Same rating: do not re-PUT (tag drafts need explicit save).
    if (current.rating === rating) return;

    const statusKey: "saved" | "updated" =
      current.rating == null ? "saved" : "updated";

    this.patchTarget(target, {
      rating,
      draftTags: [],
      statusMessage: null,
      error: null,
      generationMismatch: false,
    });

    void this.putFeedback(target, rating, [], statusKey);
  }

  toggleTag(target: ComponentFeedbackUiTarget, tag: string): void {
    const current = this.targets[target];
    if (current.saving || !current.rating) return;
    this.patchTarget(target, {
      draftTags: toggleDraftTag(current.draftTags, tag),
      statusMessage: null,
      error: null,
    });
  }

  saveTags(target: ComponentFeedbackUiTarget): void {
    const current = this.targets[target];
    if (current.saving || !current.rating) return;
    if (!draftsDifferFromSaved(current.draftTags, current.savedTags)) return;
    void this.putFeedback(
      target,
      current.rating,
      current.draftTags,
      "updated",
    );
  }

  hasUnsavedTags(target: ComponentFeedbackUiTarget): boolean {
    const current = this.targets[target];
    return draftsDifferFromSaved(current.draftTags, current.savedTags);
  }

  private async putFeedback(
    target: ComponentFeedbackUiTarget,
    rating: AiInsightFeedbackRatingCode,
    tags: readonly string[],
    statusKey: "saved" | "updated",
  ): Promise<void> {
    const customerId = this.customerId;
    const generation = this.generation;
    if (!generation) {
      this.patchTarget(target, {
        error: this.messages.saveFailed,
        saving: false,
      });
      return;
    }

    const seq = ++this.putSeq[target];
    this.patchTarget(target, {
      saving: true,
      error: null,
      statusMessage: null,
      generationMismatch: false,
    });

    const body = buildComponentFeedbackPutBody({
      insightGeneratedAt: generation.insightGeneratedAt,
      sourceHash: generation.sourceHash,
      target,
      rating,
      tags,
    });
    assertExactPutBodyKeys(body as unknown as Record<string, unknown>);

    try {
      const response = await this.fetchImpl(componentsUrl(customerId), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await response.json()) as ComponentFeedbackApiResponse & {
        errorCode?: string;
        ok?: boolean;
      };

      if (!this.isPutCurrent(target, seq, customerId)) return;

      if (
        response.status === 409 &&
        data.errorCode === "AI_FEEDBACK_GENERATION_MISMATCH"
      ) {
        // Drop stale generation so it cannot be submitted again.
        this.generation = null;
        this.patchTarget(target, {
          saving: false,
          generationMismatch: true,
          error: this.messages.generationMismatch,
          statusMessage: null,
        });
        return;
      }

      if (
        response.status === 422 &&
        data.errorCode === "AI_FEEDBACK_TARGET_NOT_ELIGIBLE"
      ) {
        if (this.eligibility) {
          this.eligibility = {
            ...this.eligibility,
            [targetToFeedbackKey(target)]: false,
          };
        }
        this.targets = {
          ...this.targets,
          [target]: { ...EMPTY_TARGET },
        };
        this.emit();
        return;
      }

      if (!response.ok || !data.ok) {
        this.patchTarget(target, {
          saving: false,
          error: this.messages.saveFailed,
        });
        return;
      }

      const key = targetToFeedbackKey(target);
      const item = data.feedback?.[key];
      if (data.generation) {
        this.generation = {
          insightGeneratedAt: data.generation.insightGeneratedAt,
          sourceHash: data.generation.sourceHash,
        };
      }
      if (data.eligibility) {
        this.eligibility = data.eligibility;
      }
      this.targets = {
        ...this.targets,
        [target]: {
          rating: item?.rating ?? rating,
          savedTags: item ? [...item.tags] : [...tags],
          draftTags: item ? [...item.tags] : [...tags],
          saving: false,
          statusMessage:
            statusKey === "saved"
              ? this.messages.saved
              : this.messages.updated,
          error: null,
          generationMismatch: false,
        },
      };
      this.emit();
    } catch {
      if (!this.isPutCurrent(target, seq, customerId)) return;
      this.patchTarget(target, {
        saving: false,
        error: this.messages.saveFailed,
      });
    }
  }

  private patchTarget(
    target: ComponentFeedbackUiTarget,
    patch: Partial<TargetFeedbackUiState>,
  ): void {
    this.targets = {
      ...this.targets,
      [target]: {
        ...this.targets[target],
        ...patch,
      },
    };
    this.emit();
  }

  private cloneTargets(): TargetsState {
    return {
      base_deep: { ...this.targets.base_deep, savedTags: [...this.targets.base_deep.savedTags], draftTags: [...this.targets.base_deep.draftTags] },
      phase2: { ...this.targets.phase2, savedTags: [...this.targets.phase2.savedTags], draftTags: [...this.targets.phase2.draftTags] },
      suggested_message: {
        ...this.targets.suggested_message,
        savedTags: [...this.targets.suggested_message.savedTags],
        draftTags: [...this.targets.suggested_message.draftTags],
      },
    };
  }

  private isLoadCurrent(seq: number, customerId: string): boolean {
    return (
      !this.disposed &&
      seq === this.loadSeq &&
      customerId === this.customerId
    );
  }

  private isPutCurrent(
    target: ComponentFeedbackUiTarget,
    seq: number,
    customerId: string,
  ): boolean {
    return (
      !this.disposed &&
      seq === this.putSeq[target] &&
      customerId === this.customerId
    );
  }

  private buildSnapshot(): ComponentFeedbackClientSnapshot {
    return {
      hydration: this.hydration,
      eligibility: this.eligibility,
      targets: this.cloneTargets(),
      loadError: this.loadError,
      hasGeneration: this.generation != null,
    };
  }

  private emit(): void {
    this.cachedSnapshot = this.buildSnapshot();
    for (const listener of this.listeners) {
      listener();
    }
  }
}
