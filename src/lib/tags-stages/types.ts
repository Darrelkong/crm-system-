export type StageCatalogStatus = "active" | "legacy" | "custom";

export type TagCatalogStatus = "active" | "custom" | "inactive";

export type StageCatalogItem = {
  key: string;
  customerCount: number;
  sortOrder: number | null;
  status: StageCatalogStatus;
};

export type TagCatalogItem = {
  id?: string;
  key: string;
  label: string;
  customerCount: number;
  status: TagCatalogStatus;
  isSystem: boolean;
};

export type TagsStagesOverview = {
  stages: StageCatalogItem[];
  tags: TagCatalogItem[];
};
