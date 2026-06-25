import { eq, sql } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { schema } from "@/lib/db";

const CUSTOMER_CODE_PREFIX = "EF";
const CUSTOMER_CODE_WIDTH = 6;

export function formatCustomerCode(sequenceNumber: number): string {
  return `${CUSTOMER_CODE_PREFIX}${String(sequenceNumber).padStart(CUSTOMER_CODE_WIDTH, "0")}`;
}

/**
 * Atomically increments the shared counter and returns the next customer code.
 * Retries if a rare race produces a duplicate code.
 */
export async function allocateCustomerCode(
  db: Database,
  maxAttempts = 5,
): Promise<string> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const rows = await db
      .update(schema.customerCodeCounter)
      .set({
        lastNumber: sql`${schema.customerCodeCounter.lastNumber} + 1`,
      })
      .where(eq(schema.customerCodeCounter.id, 1))
      .returning({ lastNumber: schema.customerCodeCounter.lastNumber });

    const lastNumber = rows[0]?.lastNumber;
    if (lastNumber == null) {
      throw new Error("Customer code counter is not initialized");
    }

    const code = formatCustomerCode(lastNumber);

    const existing = await db
      .select({ id: schema.customers.id })
      .from(schema.customers)
      .where(eq(schema.customers.customerCode, code))
      .limit(1);

    if (existing.length === 0) {
      return code;
    }
  }

  throw new Error("Failed to allocate a unique customer code");
}
