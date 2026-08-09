import type { MetadataRoute } from "next";
import { CRM_THEME_COLOR_LIGHT } from "@/lib/theme/crm-theme-bootstrap";

export const CRM_PWA_MANIFEST_ID = "https://crm.echfronthk.com/";
export const CRM_PWA_NAME = "ECHFRONT CRM";
export const CRM_PWA_SHORT_NAME = "ECHFRONT";
export const CRM_PWA_START_URL = "/";
export const CRM_PWA_DISPLAY = "standalone" as const;

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: CRM_PWA_MANIFEST_ID,
    name: CRM_PWA_NAME,
    short_name: CRM_PWA_SHORT_NAME,
    description: "ECHFRONT CRM — internal client management",
    start_url: CRM_PWA_START_URL,
    scope: "/",
    display: CRM_PWA_DISPLAY,
    background_color: CRM_THEME_COLOR_LIGHT,
    theme_color: CRM_THEME_COLOR_LIGHT,
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/apple-touch-icon.png",
        sizes: "180x180",
        type: "image/png",
        purpose: "any",
      },
    ],
  };
}
