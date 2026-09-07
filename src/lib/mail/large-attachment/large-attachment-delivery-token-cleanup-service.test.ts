import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  expireDueLargeAttachmentDeliveryTokens,
} from "./large-attachment-delivery-token-cleanup-service";
import type { Database } from "@/lib/db";

type FakeToken = {
  id: string;
  state: "prepared" | "armed" | "confirmed" | "revoked" | "expired";
};

function fakeDatabase(tokens: FakeToken[]): Database {
  return {
    select() {
      return {
        from() {
          return {
            where() {
              return {
                orderBy() {
                  return {
                    limit: async () =>
                      tokens
                        .filter((token) =>
                          ["prepared", "armed", "confirmed"].includes(token.state),
                        )
                        .map(({ id }) => ({ id })),
                  };
                },
              };
            },
          };
        },
      };
    },
    update() {
      return {
        set() {
          return {
            where() {
              return {
                returning: async () => {
                  const token = tokens.find(
                    (candidate) =>
                      ["prepared", "armed", "confirmed"].includes(
                        candidate.state,
                      ),
                  );
                  if (!token) return [];
                  token.state = "expired";
                  return [{ id: token.id }];
                },
              };
            },
          };
        },
      };
    },
  } as unknown as Database;
}

describe("large attachment delivery-token cleanup", () => {
  it("expires due active states but never changes revoked or rerun state", async () => {
    const tokens: FakeToken[] = [
      { id: "prepared", state: "prepared" },
      { id: "armed", state: "armed" },
      { id: "confirmed", state: "confirmed" },
      { id: "revoked", state: "revoked" },
    ];
    const db = fakeDatabase(tokens);

    const first = await expireDueLargeAttachmentDeliveryTokens(db, {
      trustNow: "2026-09-14T00:00:00.000Z",
      limit: 10,
    });
    assert.equal(first.selected, 3);
    assert.equal(first.expired, 3);
    assert.equal(tokens.find((token) => token.id === "revoked")?.state, "revoked");

    const second = await expireDueLargeAttachmentDeliveryTokens(db, {
      trustNow: "2026-09-14T00:00:00.000Z",
      limit: 10,
    });
    assert.deepEqual(second, { selected: 0, expired: 0, skipped: 0 });
  });
});
