import { and, eq } from "drizzle-orm";
import { schema, type Database } from "@/lib/db";
import { normalizeMailEmailAddress } from "@/lib/mail/normalize-email-address";
import { LocalMailVerifyFixtureGuardError } from "@/lib/mail/local-verification-fixture/guard";

export async function assertFixtureAddressesDoNotCollideWithCrmContacts(
  db: Database,
  addresses: string[],
): Promise<void> {
  for (const rawAddress of addresses) {
    let normalized: string;
    try {
      normalized = normalizeMailEmailAddress(rawAddress);
    } catch {
      continue;
    }

    const [row] = await db
      .select({ id: schema.customerContactIdentifiers.id })
      .from(schema.customerContactIdentifiers)
      .where(
        and(
          eq(schema.customerContactIdentifiers.contactType, "email"),
          eq(schema.customerContactIdentifiers.normalizedValue, normalized),
        ),
      )
      .limit(1);

    if (row) {
      throw new LocalMailVerifyFixtureGuardError(
        "CRM_CONTACT_COLLISION",
        `Fixture address collides with CRM customer contact identifier: ${normalized}`,
      );
    }
  }
}
