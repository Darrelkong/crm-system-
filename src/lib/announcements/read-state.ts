const READ_ANNOUNCEMENTS_KEY = "crm_read_announcement_ids";

function readIds(): Set<string> {
  if (typeof window === "undefined") {
    return new Set();
  }
  try {
    const raw = localStorage.getItem(READ_ANNOUNCEMENTS_KEY);
    if (!raw) {
      return new Set();
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return new Set();
    }
    return new Set(parsed.filter((id): id is string => typeof id === "string"));
  } catch {
    return new Set();
  }
}

function writeIds(ids: Set<string>): void {
  try {
    localStorage.setItem(READ_ANNOUNCEMENTS_KEY, JSON.stringify([...ids]));
  } catch {
    // ignore storage failures
  }
}

export function isAnnouncementReadLocally(id: string): boolean {
  return readIds().has(id);
}

export function markAnnouncementReadLocally(id: string): void {
  const ids = readIds();
  ids.add(id);
  writeIds(ids);
}

export function getReadAnnouncementIds(): string[] {
  return [...readIds()];
}
