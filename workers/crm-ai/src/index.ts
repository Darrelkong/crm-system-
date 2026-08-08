/// <reference path="./env.d.ts" />

import {
  handleCrmAiRequest,
  parseCrmAiRequestBody,
} from "./service";
import type { CrmAiEnv } from "./types";

/**
 * Isolated Cloudflare Workers AI service.
 * Intended for Service Binding access from crm-system (Task 10B).
 * No public routes or custom domains in production.
 */
export default {
  async fetch(request: Request, env: CrmAiEnv): Promise<Response> {
    if (request.method !== "POST") {
      return Response.json(
        { ok: false, error: "internal_error" },
        { status: 405 },
      );
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json(
        { ok: false, error: "invalid_output" },
        { status: 400 },
      );
    }

    const parsed = parseCrmAiRequestBody(body);
    if (!parsed) {
      return Response.json(
        { ok: false, error: "invalid_output" },
        { status: 400 },
      );
    }

    const result = await handleCrmAiRequest(env, parsed);
    const status = result.ok ? 200 : 503;
    return Response.json(result, { status });
  },
} satisfies ExportedHandler<CrmAiEnv>;
