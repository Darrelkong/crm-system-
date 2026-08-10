export const CRM_APPLE_STARTUP_UNIVERSAL_IMAGE =
  "/startup/iphone-portrait-1284x2778-light.png";

export const CRM_APPLE_STARTUP_IMAGE_1170 =
  "/startup/iphone-portrait-1170x2532-light.png";

export const CRM_APPLE_STARTUP_IMAGE_1284 =
  "/startup/iphone-portrait-1284x2778-light.png";

export const CRM_APPLE_STARTUP_IMAGE_1320 =
  "/startup/iphone-portrait-1320x2868-light.png";

export const CRM_APPLE_STARTUP_IMAGE_1170_MEDIA =
  "(device-width: 390px) and (device-height: 844px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)";

export const CRM_APPLE_STARTUP_IMAGE_1284_MEDIA =
  "(device-width: 428px) and (device-height: 926px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)";

export const CRM_APPLE_STARTUP_IMAGE_1320_MEDIA =
  "(device-width: 440px) and (device-height: 956px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)";

export type CrmAppleStartupImage = {
  url: string;
  media?: string;
};

export const CRM_APPLE_STARTUP_IMAGES: CrmAppleStartupImage[] = [
  {
    url: CRM_APPLE_STARTUP_UNIVERSAL_IMAGE,
  },
  {
    url: CRM_APPLE_STARTUP_IMAGE_1170,
    media: CRM_APPLE_STARTUP_IMAGE_1170_MEDIA,
  },
  {
    url: CRM_APPLE_STARTUP_IMAGE_1284,
    media: CRM_APPLE_STARTUP_IMAGE_1284_MEDIA,
  },
  {
    url: CRM_APPLE_STARTUP_IMAGE_1320,
    media: CRM_APPLE_STARTUP_IMAGE_1320_MEDIA,
  },
];
