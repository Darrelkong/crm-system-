export type StageCatalogStatus = "active" | "legacy" | "custom";

export type TagCatalogStatus = "active" | "custom";

export type StageCatalogItem = {
  key: string;
  customerCount: number;
  sortOrder: number | null;
  status: StageCatalogStatus;
};

export type TagCatalogItem = {
  key: string;
  customerCount: number;
  status: TagCatalogStatus;
};

export type TagsStagesOverview = {
  stages: StageCatalogItem[];
  /** Customer sources used as classification labels (no dedicated tags table). */
  tags: TagCatalogItem[];
};
