import type { DeviceListItem } from "@/lib/devices/types";

/** Canonical human-readable device label shared by pending and replacement UI. */
export function getDeviceDisplayLabel(
  device: Pick<DeviceListItem, "device_name" | "user_agent_summary">,
): string {
  return device.device_name ?? device.user_agent_summary ?? "未知设备";
}

export function getDeviceNetworkAddress(
  device: Pick<DeviceListItem, "last_seen_ip" | "ip_address">,
): string {
  return device.last_seen_ip ?? device.ip_address ?? "—";
}
