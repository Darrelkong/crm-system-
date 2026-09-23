import { getRequestedProjectItem } from "@/lib/constants/requested-projects";

export type KnowledgeCategoryListItemLike = {
  id: string;
  name: string;
  isActive: boolean;
};

/** Map CRM requested project code to an existing Knowledge category by canonical zh-Hans name. */
export function resolveKnowledgeCategoryIdForRequestedProject(
  categories: readonly KnowledgeCategoryListItemLike[],
  requestedProjectCode: string | null | undefined,
): string | null {
  const item = getRequestedProjectItem(requestedProjectCode);
  if (!item) return null;
  const match = categories.find(
    (category) => category.isActive && category.name === item.canonicalZhHans,
  );
  return match?.id ?? null;
}
