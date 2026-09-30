/** Wire contract shared with the app; no Worker runtime dependencies. */
const text = (maxLength: number, nullable = false, nonempty = false) => ({
  type: nullable ? ["string", "null"] : "string",
  maxLength,
  ...(nonempty ? { minLength: 1 } : {}),

});
const confidence = { type: "number", minimum: 0, maximum: 1 };
const diffItem = {
  type: "object", additionalProperties: false,
  required: ["id", "topic", "existingValue", "incomingValue", "explanation", "confidence", "sourceExcerpt", "existingExcerpt"],
  properties: {
    id: text(40, false, true), topic: text(160, false, true),
    existingValue: text(1000, true), incomingValue: text(1000, true),
    explanation: text(600, false, true), confidence,
    sourceExcerpt: text(500, true), existingExcerpt: text(500, true),
  },
};
const suggestedUpdate = {
  type: "object", additionalProperties: false,
  required: ["topic", "suggestion", "rationale", "confidence"],
  properties: {
    topic: text(160, false, true), suggestion: text(600, false, true),
    rationale: text(600, false, true), confidence,
  },
};
const diffItems = { type: "array", maxItems: 20, items: diffItem };
export const KNOWLEDGE_COMPARE_JSON_SCHEMA = {
  type: "object", additionalProperties: false,
  required: ["relationship", "matchedCandidateKey", "matchConfidence", "newFacts", "changedFacts", "conflicts", "uncertainties", "suggestedUpdates"],
  properties: {
    relationship: { type: "string", enum: ["update_existing", "new_article", "ambiguous"] },
    matchedCandidateKey: { type: ["string", "null"], enum: ["C1", "C2", "C3", null] },
    matchConfidence: confidence,
    newFacts: diffItems, changedFacts: diffItems, conflicts: diffItems, uncertainties: diffItems,
    suggestedUpdates: { type: "array", maxItems: 20, items: suggestedUpdate },
  },
  anyOf: [
    { properties: { relationship: { enum: ["new_article", "ambiguous"] } } },
    { properties: { relationship: { const: "update_existing" }, matchedCandidateKey: { enum: ["C1", "C2", "C3"] } } },
  ],
} as const;
