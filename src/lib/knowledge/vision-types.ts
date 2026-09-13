export type KnowledgeVisionWarningCode =
  | "BLURRY_IMAGE"
  | "CROPPED_CONTENT"
  | "UNREADABLE_TEXT"
  | "UNREADABLE_NUMBER"
  | "HANDWRITING_DETECTED"
  | "OTHER";

export type KnowledgeVisionWarning = {
  code: KnowledgeVisionWarningCode;
  message: string | null;
};

export type KnowledgeVisionExtractResult = {
  text: string;
  quality: "high" | "medium" | "low";
  warnings: KnowledgeVisionWarning[];
  model: string;
};
