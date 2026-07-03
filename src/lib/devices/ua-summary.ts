/** Best-effort UA label for admin display only — not used for authorization. */
export function summarizeUserAgent(userAgent: string | null | undefined): string {
  if (!userAgent?.trim()) {
    return "未知設備";
  }

  const ua = userAgent;
  let os = "未知系統";
  if (/iPhone|iPad|iPod/i.test(ua)) {
    os = "iOS";
  } else if (/Android/i.test(ua)) {
    os = "Android";
  } else if (/Windows/i.test(ua)) {
    os = "Windows";
  } else if (/Mac OS X|Macintosh/i.test(ua)) {
    os = "macOS";
  } else if (/Linux/i.test(ua)) {
    os = "Linux";
  }

  let browser = "瀏覽器";
  if (/Edg\//i.test(ua)) {
    browser = "Edge";
  } else if (/Chrome\//i.test(ua) && !/Edg\//i.test(ua)) {
    browser = "Chrome";
  } else if (/Safari\//i.test(ua) && !/Chrome\//i.test(ua)) {
    browser = "Safari";
  } else if (/Firefox\//i.test(ua)) {
    browser = "Firefox";
  }

  return `${browser} · ${os}`;
}

export function defaultDeviceName(userAgent: string | null | undefined): string {
  return summarizeUserAgent(userAgent);
}
