import type { GetPlatformProxyOptions, PlatformProxy } from "wrangler";

type HttpD1Operation = "all" | "raw" | "run";
type HttpD1StatementPayload = {
  sql: string;
  params: unknown[];
};

class HttpD1Client {
  constructor(
    private readonly endpoint: string,
    private readonly token: string,
  ) {}

  async execute(
    operation: HttpD1Operation,
    statement: HttpD1StatementPayload,
  ): Promise<unknown> {
    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ operation, ...statement }),
    });
    const payload = (await response.json()) as { error?: string };
    if (!response.ok) {
      throw new Error(payload.error ?? `Test D1 request failed: ${response.status}`);
    }
    return payload;
  }

  async batch(statements: HttpD1StatementPayload[]): Promise<unknown> {
    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ operation: "batch", statements }),
    });
    const payload = (await response.json()) as { error?: string };
    if (!response.ok) {
      throw new Error(payload.error ?? `Test D1 batch failed: ${response.status}`);
    }
    return payload;
  }
}

class HttpD1PreparedStatement {
  constructor(
    private readonly client: HttpD1Client,
    private readonly sql: string,
    private readonly params: unknown[] = [],
  ) {}

  bind(...params: unknown[]): HttpD1PreparedStatement {
    return new HttpD1PreparedStatement(this.client, this.sql, params);
  }

  all(): Promise<unknown> {
    return this.client.execute("all", { sql: this.sql, params: this.params });
  }

  raw(): Promise<unknown> {
    return this.client.execute("raw", { sql: this.sql, params: this.params });
  }

  run(): Promise<unknown> {
    return this.client.execute("run", { sql: this.sql, params: this.params });
  }

  async first(): Promise<unknown> {
    const result = (await this.all()) as { results?: unknown[] };
    return result.results?.[0];
  }

  toPayload(): HttpD1StatementPayload {
    return { sql: this.sql, params: this.params };
  }
}

class HttpD1Database {
  private readonly client: HttpD1Client;

  constructor(endpoint: string, token: string) {
    this.client = new HttpD1Client(endpoint, token);
  }

  prepare(sql: string): HttpD1PreparedStatement {
    return new HttpD1PreparedStatement(this.client, sql);
  }

  batch(
    statements: HttpD1PreparedStatement[],
  ): Promise<unknown> {
    return this.client.batch(statements.map((statement) => statement.toPayload()));
  }
}

/**
 * Test-only D1 binding backed by the guarded local Wrangler Worker.
 */
export function getTestD1PlatformProxy<Env = Record<string, unknown>>(
  _options: GetPlatformProxyOptions = {},
): Promise<PlatformProxy<Env>> {
  void _options;
  const endpoint = process.env.CRM_TEST_D1_HTTP_URL;
  const token = process.env.CRM_TEST_D1_HTTP_TOKEN;
  if (!endpoint || !token) {
    throw new Error(
      "CRM_TEST_D1_HTTP_URL and CRM_TEST_D1_HTTP_TOKEN are required; " +
        "start the isolated Wrangler D1 harness first",
    );
  }

  return Promise.resolve({
    env: { DB: new HttpD1Database(endpoint, token) },
    dispose: async () => {},
  } as unknown as PlatformProxy<Env>);
}
