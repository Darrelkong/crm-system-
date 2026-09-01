/**
 * Guards destructive disable confirmation against same-click activation when a
 * nested modal opens directly under the triggering pointer event.
 */
export function shouldAllowDisableConfirmAction({
  armed,
  busy,
}: {
  armed: boolean;
  busy: boolean;
}): boolean {
  return armed && !busy;
}

export function scheduleDisableConfirmArm(onArm: () => void): () => void {
  if (typeof requestAnimationFrame === "function") {
    const frameId = requestAnimationFrame(() => {
      onArm();
    });
    return () => cancelAnimationFrame(frameId);
  }

  const timeoutId = setTimeout(onArm, 0);
  return () => clearTimeout(timeoutId);
}
