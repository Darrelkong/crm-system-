/** Minimal Cloudflare Workers AI types for crm-ai (no external SDK). */
declare interface Ai {
  run(
    model: string,
    inputs: Record<string, unknown>,
    options?: Record<string, unknown>,
  ): Promise<unknown>;
}

type ExportedHandler<E> = {
  fetch?: (
    request: Request,
    env: E,
    ctx: ExecutionContext,
  ) => Response | Promise<Response>;
};
