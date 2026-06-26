import { TagsStagesClient } from "@/components/tags-stages/tags-stages-client";
import { getTagsStagesOverview } from "@/lib/tags-stages/queries";
import { getDb } from "@/lib/db";

export async function TagsStagesView() {
  const db = getDb();
  const data = await getTagsStagesOverview(db);

  return <TagsStagesClient data={data} />;
}
