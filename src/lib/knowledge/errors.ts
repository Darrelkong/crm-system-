export class KnowledgeServiceError extends Error {
  constructor(
    public readonly errorCode: string,
    message: string,
    public readonly httpStatus = 400,
  ) {
    super(message);
    this.name = "KnowledgeServiceError";
  }
}
