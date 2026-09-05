import type { DeviceListItem } from "@/lib/devices/types";

function replacementSortTimestamp(device: DeviceListItem): string {
  return device.last_seen_at ?? device.approved_at ?? device.created_at;
}

/** Least recently used first, with a stable device-id tie-breaker. */
export function sortReplacementCandidates(
  devices: DeviceListItem[],
): DeviceListItem[] {
  return [...devices].sort((a, b) => {
    const timestampOrder = replacementSortTimestamp(a).localeCompare(
      replacementSortTimestamp(b),
    );
    return timestampOrder !== 0 ? timestampOrder : a.id.localeCompare(b.id);
  });
}
