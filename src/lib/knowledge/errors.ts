export type KnowledgeServiceErrorDetails = Record<string, unknown>;

export class KnowledgeServiceError extends Error {
  constructor(
    public readonly errorCode: string,
    message: string,
    public readonly httpStatus = 400,
    public readonly details?: KnowledgeServiceErrorDetails,
  ) {
    super(message);
    this.name = "KnowledgeServiceError";
  }
}
