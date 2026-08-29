import { fetchComposeContext } from "@/lib/mail/client/api";
import type { ComposeContextOption } from "@/lib/mail/client/draft-management";

let cachedOptions: ComposeContextOption[] | null = null;
let inflight: Promise<ComposeContextOption[] | null> | null = null;

export function getCachedComposeContext(): ComposeContextOption[] | null {
  return cachedOptions;
}

export function setCachedComposeContext(options: ComposeContextOption[]): void {
  cachedOptions = options;
}

export function prefetchComposeContext(): Promise<ComposeContextOption[] | null> {
  if (cachedOptions) {
    return Promise.resolve(cachedOptions);
  }
  if (inflight) {
    return inflight;
  }

  inflight = fetchComposeContext()
    .then((result) => {
      if (!result.ok) {
        return null;
      }
      cachedOptions = result.items;
      return result.items;
    })
    .finally(() => {
      inflight = null;
    });

  return inflight;
}

export function clearComposeContextCache(): void {
  cachedOptions = null;
  inflight = null;
}
