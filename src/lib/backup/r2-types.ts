/** Minimal R2 binding surface used by backup storage. */
export type R2PutBinding = {
  put(
    key: string,
    value: string,
    options?: { httpMetadata?: { contentType?: string } },
  ): Promise<unknown>;
};
