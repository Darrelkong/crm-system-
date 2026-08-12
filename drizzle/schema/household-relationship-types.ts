/**
 * Controlled family relationship vocabulary (direct pairs only).
 * Inverse labels are presentation-only — never inferred transitive kinship.
 */
export const HOUSEHOLD_RELATIONSHIP_TYPES = [
  "father",
  "mother",
  "spouse",
  "son",
  "daughter",
  "child",
  "brother",
  "sister",
  "sibling",
  "grandfather",
  "grandmother",
  "grandparent",
  "grandson",
  "granddaughter",
  "grandchild",
  "other_relative",
] as const;

export type HouseholdRelationshipType =
  (typeof HOUSEHOLD_RELATIONSHIP_TYPES)[number];

/** Presentation-only inverse label; may include values not stored as relationship_type. */
export type HouseholdRelationshipInverseLabel =
  | HouseholdRelationshipType
  | "parent";

/** Deterministic inverse for UI display — not stored in DB. */
export const HOUSEHOLD_RELATIONSHIP_INVERSE: Record<
  HouseholdRelationshipType,
  HouseholdRelationshipInverseLabel
> = {
  father: "child",
  mother: "child",
  spouse: "spouse",
  son: "parent",
  daughter: "parent",
  child: "parent",
  brother: "sibling",
  sister: "sibling",
  sibling: "sibling",
  grandfather: "grandchild",
  grandmother: "grandchild",
  grandparent: "grandchild",
  grandson: "grandparent",
  granddaughter: "grandparent",
  grandchild: "grandparent",
  other_relative: "other_relative",
};
