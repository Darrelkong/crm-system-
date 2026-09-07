interface Env {
  DB: D1Database;
  MAIL_TEST_HARNESS_ENABLED?: string;
  MAIL_TEST_HARNESS_TOKEN?: string;
  NODE_ENV?: string;
}

type QueryRequest =
  | { operation: "all" | "raw" | "run"; sql: string; params: unknown[] }
  | {
      operation: "batch";
      statements: Array<{ sql: string; params: unknown[] }>;
    };

function notFound(): Response {
  return new Response("Not Found", { status: 404 });
}

function isSafeTestRequest(env: Env): boolean {
  return (
    env.NODE_ENV !== "production" &&
    env.MAIL_TEST_HARNESS_ENABLED === "true" &&
    typeof env.MAIL_TEST_HARNESS_TOKEN === "string" &&
    env.MAIL_TEST_HARNESS_TOKEN.length > 0
  );
}

function isAuthorized(request: Request, env: Env): boolean {
  return (
    request.headers.get("authorization") ===
    `Bearer ${env.MAIL_TEST_HARNESS_TOKEN}`
  );
}

async function executeStatement(
  env: Env,
  statement: { sql: string; params: unknown[] },
  operation: "all" | "raw" | "run",
) {
  const prepared = env.DB.prepare(statement.sql).bind(...statement.params);
  if (operation === "run") return prepared.run();
  if (operation === "raw") return prepared.raw();
  return prepared.all();
}

const mailTestD1Gateway = {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (!isSafeTestRequest(env) || !isAuthorized(request, env)) {
      return notFound();
    }

    const pathname = new URL(request.url).pathname;
    if (pathname === "/__test/healthz" && request.method === "GET") {
      return Response.json({ ok: true });
    }
    if (pathname !== "/__test/d1" || request.method !== "POST") {
      return notFound();
    }

    try {
      const body = (await request.json()) as QueryRequest;
      if (body.operation === "batch") {
        const statements = body.statements.map((statement) =>
          env.DB.prepare(statement.sql).bind(...statement.params),
        );
        return Response.json(await env.DB.batch(statements));
      }

      if (
        (body.operation !== "all" &&
          body.operation !== "raw" &&
          body.operation !== "run") ||
        typeof body.sql !== "string" ||
        !Array.isArray(body.params)
      ) {
        return Response.json({ error: "Invalid test D1 request" }, { status: 400 });
      }

      return Response.json(
        await executeStatement(env, body, body.operation),
      );
    } catch (error) {
      return Response.json(
        {
          error: error instanceof Error ? error.message : String(error),
        },
        { status: 500 },
      );
    }
  },
};

export default mailTestD1Gateway;
