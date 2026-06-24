import { and, desc, eq, or } from "drizzle-orm";
import type { Database } from "@/lib/db";
import { schema } from "@/lib/db";
import type {
  Announcement,
  AnnouncementAudience,
  AnnouncementStatus,
} from "../../../drizzle/schema/announcements";
import type { User } from "../../../drizzle/schema/users";

export type AnnouncementView = {
  id: string;
  title: string;
  content: string;
  status: AnnouncementStatus;
  audience: AnnouncementAudience;
  created_by: string;
  published_at: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};

export type PublishedAnnouncementView = {
  id: string;
  title: string;
  content: string;
  audience: AnnouncementAudience;
  published_at: string;
};

function toAdminView(row: Announcement): AnnouncementView {
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    status: row.status,
    audience: row.audience,
    created_by: row.createdBy,
    published_at: row.publishedAt,
    archived_at: row.archivedAt,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

function toPublishedView(row: Announcement): PublishedAnnouncementView {
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    audience: row.audience,
    published_at: row.publishedAt!,
  };
}

function audienceFilterForUser(role: User["role"]) {
  if (role === "admin") {
    return or(
      eq(schema.announcements.audience, "all"),
      eq(schema.announcements.audience, "admin"),
    );
  }
  return or(
    eq(schema.announcements.audience, "all"),
    eq(schema.announcements.audience, "staff"),
  );
}

export async function listAllAnnouncementsForAdmin(
  db: Database,
): Promise<AnnouncementView[]> {
  const rows = await db
    .select()
    .from(schema.announcements)
    .orderBy(desc(schema.announcements.createdAt));
  return rows.map(toAdminView);
}

export async function listPublishedAnnouncementsForUser(
  db: Database,
  user: User,
  limit = 50,
): Promise<PublishedAnnouncementView[]> {
  const rows = await db
    .select()
    .from(schema.announcements)
    .where(
      and(
        eq(schema.announcements.status, "published"),
        audienceFilterForUser(user.role),
      ),
    )
    .orderBy(desc(schema.announcements.publishedAt))
    .limit(Math.min(Math.max(limit, 1), 200));

  return rows
    .filter((row) => row.publishedAt)
    .map(toPublishedView);
}

export async function getAnnouncementById(
  db: Database,
  id: string,
): Promise<Announcement | null> {
  const rows = await db
    .select()
    .from(schema.announcements)
    .where(eq(schema.announcements.id, id))
    .limit(1);
  return rows[0] ?? null;
}

export class AnnouncementError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AnnouncementError";
  }
}

export async function createAnnouncement(
  db: Database,
  actor: User,
  input: { title: string; content: string; audience: AnnouncementAudience },
): Promise<AnnouncementView> {
  const title = input.title.trim();
  const content = input.content.trim();
  if (!title) {
    throw new AnnouncementError("标题不能为空");
  }
  if (!content) {
    throw new AnnouncementError("内容不能为空");
  }

  const now = new Date().toISOString();
  const id = crypto.randomUUID();

  await db.insert(schema.announcements).values({
    id,
    title,
    content,
    status: "draft",
    audience: input.audience,
    createdBy: actor.id,
    publishedAt: null,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
  });

  const row = await getAnnouncementById(db, id);
  if (!row) {
    throw new AnnouncementError("创建失败");
  }
  return toAdminView(row);
}

export async function updateAnnouncement(
  db: Database,
  id: string,
  input: {
    title?: string;
    content?: string;
    audience?: AnnouncementAudience;
  },
): Promise<AnnouncementView> {
  const existing = await getAnnouncementById(db, id);
  if (!existing) {
    throw new AnnouncementError("公告不存在");
  }
  if (existing.status !== "draft") {
    throw new AnnouncementError("仅草稿状态可编辑");
  }

  const title = input.title !== undefined ? input.title.trim() : existing.title;
  const content =
    input.content !== undefined ? input.content.trim() : existing.content;
  if (!title) {
    throw new AnnouncementError("标题不能为空");
  }
  if (!content) {
    throw new AnnouncementError("内容不能为空");
  }

  const now = new Date().toISOString();
  await db
    .update(schema.announcements)
    .set({
      title,
      content,
      audience: input.audience ?? existing.audience,
      updatedAt: now,
    })
    .where(eq(schema.announcements.id, id));

  const row = await getAnnouncementById(db, id);
  if (!row) {
    throw new AnnouncementError("更新失败");
  }
  return toAdminView(row);
}

export async function publishAnnouncement(
  db: Database,
  id: string,
): Promise<AnnouncementView> {
  const existing = await getAnnouncementById(db, id);
  if (!existing) {
    throw new AnnouncementError("公告不存在");
  }
  if (existing.status !== "draft") {
    throw new AnnouncementError("仅草稿可发布");
  }

  const now = new Date().toISOString();
  await db
    .update(schema.announcements)
    .set({
      status: "published",
      publishedAt: now,
      updatedAt: now,
    })
    .where(eq(schema.announcements.id, id));

  const row = await getAnnouncementById(db, id);
  if (!row) {
    throw new AnnouncementError("发布失败");
  }
  return toAdminView(row);
}

export async function archiveAnnouncement(
  db: Database,
  id: string,
): Promise<AnnouncementView> {
  const existing = await getAnnouncementById(db, id);
  if (!existing) {
    throw new AnnouncementError("公告不存在");
  }
  if (existing.status !== "published") {
    throw new AnnouncementError("仅已发布公告可归档");
  }

  const now = new Date().toISOString();
  await db
    .update(schema.announcements)
    .set({
      status: "archived",
      archivedAt: now,
      updatedAt: now,
    })
    .where(eq(schema.announcements.id, id));

  const row = await getAnnouncementById(db, id);
  if (!row) {
    throw new AnnouncementError("归档失败");
  }
  return toAdminView(row);
}
