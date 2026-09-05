import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(path: string): string {
  return readFileSync(path, "utf8");
}

describe("customer collaboration phase 3 wiring", () => {
  it("uses the exact-email direct flow for existing customer management", () => {
    const component = source(
      "src/components/customers/manage-assignees-modal.tsx",
    );
    const detail = source(
      "src/app/(dashboard)/customers/[id]/customer-detail-client.tsx",
    );

    assert.match(component, /\/collaborators\/verify/);
    assert.match(component, /method: "POST"/);
    assert.match(component, /method: "DELETE"/);
    assert.match(component, /removeCollaboratorConfirmTitle/);
    assert.doesNotMatch(component, /\/api\/users\/staff/);
    assert.match(detail, /primaryOwner/);
    assert.match(detail, /collaborators/);
    assert.doesNotMatch(detail, /RequestAssigneesButton/);
  });

  it("wires server-derived list relationships and relationship filters", () => {
    const rows = source("src/lib/customers/list-rows.ts");
    const queries = source("src/lib/customers/queries.ts");
    const list = source(
      "src/app/(dashboard)/customers/customers-list-client.tsx",
    );

    assert.match(rows, /viewerRelationship/);
    assert.match(rows, /role === "collaborator"/);
    assert.match(queries, /relationship\?: "owner" \| "collaborator"/);
    assert.match(queries, /ca\.role = 'collaborator'/);
    assert.match(list, /relationshipCollaborator/);
    assert.match(list, /collaboratorBadge/);
    assert.match(list, /noCollaborativeCustomers/);
  });
});
