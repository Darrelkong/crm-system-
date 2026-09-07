import {
  getPlatformProxy,
  type GetPlatformProxyOptions,
  type PlatformProxy,
} from "wrangler";

type HttpD1Operation = "all" | "raw" | "run";
type HttpD1StatementPayload = {
  sql: string;
  params: unknown[];
};

class HttpD1Client {
  constructor(private readonly endpoint: string) {}

  async execute(
    operation: HttpD1Operation,
    statement: HttpD1StatementPayload,
  ): Promise<unknown> {
    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
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
      headers: { "content-type": "application/json" },
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

  constructor(endpoint: string) {
    this.client = new HttpD1Client(endpoint);
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
 * Test-only wrapper for isolating Wrangler's local persistence per child process.
 * Without CRM_TEST_D1_PERSIST_PATH, it preserves Wrangler's normal default.
 */
export function getTestD1PlatformProxy<Env = Record<string, unknown>>(
  options: GetPlatformProxyOptions = {},
): Promise<PlatformProxy<Env>> {
  const endpoint = process.env.CRM_TEST_D1_HTTP_URL;
  if (endpoint) {
    return Promise.resolve({
      env: { DB: new HttpD1Database(endpoint) },
      dispose: async () => {},
    } as unknown as PlatformProxy<Env>);
  }

  const persistPath = process.env.CRM_TEST_D1_PERSIST_PATH;
  const configPath =
    process.env.CRM_TEST_D1_CONFIG_PATH ?? options.configPath;
  return getPlatformProxy<Env>({
    ...options,
    ...(configPath ? { configPath } : {}),
    remoteBindings: options.remoteBindings ?? false,
    ...(persistPath ? { persist: { path: persistPath } } : {}),
  });
}
