export const COMPOSE_VIEWPORT_MARGIN_PX = 24;
export const COMPOSE_MAIL_HEADER_OFFSET_PX = 72;
export const COMPOSE_COLLAPSED_MIN_WIDTH_PX = 540;
export const COMPOSE_COLLAPSED_MAX_WIDTH_PX = 620;
export const COMPOSE_COLLAPSED_WIDTH_RATIO = 0.36;
export const COMPOSE_COLLAPSED_MIN_HEIGHT_PX = 500;
export const COMPOSE_COLLAPSED_MAX_HEIGHT_PX = 580;
export const COMPOSE_COLLAPSED_HEIGHT_RATIO = 0.62;
export const COMPOSE_EXPANDED_MARGIN_PX = 28;
export const COMPOSE_EXPANDED_MAX_WIDTH_PX = 1040;
export const COMPOSE_DEFAULT_CONTENT_LEFT_PX = 280;

export type ComposeFloatingLayoutStyle = {
  position: "fixed";
  top?: number;
  right: number;
  bottom: number;
  left?: number;
  width?: number;
  height?: number;
  maxHeight?: number;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function computeCollapsedFloatingComposeLayout(input: {
  contentLeft: number;
  viewportWidth: number;
  viewportHeight: number;
}): ComposeFloatingLayoutStyle {
  const margin = COMPOSE_VIEWPORT_MARGIN_PX;
  const availableWidth = input.viewportWidth - input.contentLeft - margin * 2;
  const width = clamp(
    Math.min(
      input.viewportWidth * COMPOSE_COLLAPSED_WIDTH_RATIO,
      availableWidth,
    ),
    COMPOSE_COLLAPSED_MIN_WIDTH_PX,
    Math.min(COMPOSE_COLLAPSED_MAX_WIDTH_PX, availableWidth),
  );
  const maxHeight = clamp(
    Math.min(
      input.viewportHeight * COMPOSE_COLLAPSED_HEIGHT_RATIO,
      input.viewportHeight - COMPOSE_MAIL_HEADER_OFFSET_PX - margin * 2,
    ),
    COMPOSE_COLLAPSED_MIN_HEIGHT_PX,
    COMPOSE_COLLAPSED_MAX_HEIGHT_PX,
  );

  return {
    position: "fixed",
    right: margin,
    bottom: margin,
    width,
    height: maxHeight,
    maxHeight,
  };
}

export function computeExpandedFloatingComposeLayout(input: {
  contentLeft: number;
  viewportHeight: number;
}): ComposeFloatingLayoutStyle {
  const margin = COMPOSE_EXPANDED_MARGIN_PX;
  return {
    position: "fixed",
    top: COMPOSE_MAIL_HEADER_OFFSET_PX + margin,
    bottom: margin,
    left: input.contentLeft + margin,
    right: margin,
    maxHeight:
      input.viewportHeight - COMPOSE_MAIL_HEADER_OFFSET_PX - margin * 2,
  };
}
