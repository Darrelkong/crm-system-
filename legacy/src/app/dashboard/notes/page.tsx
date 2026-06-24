import { prisma } from "@/lib/db";
import { auth } from "@/lib/auth";
import { createNote, deleteNote } from "@/app/actions/crm";
import { Button } from "@/components/ui/button";
import { Card, EmptyState, PageHeader } from "@/components/ui/card";
import { Field, Label, Select, Textarea } from "@/components/ui/form";
import { formatDate } from "@/lib/utils";

export default async function NotesPage() {
  const session = await auth();
  const userId = session!.user!.id;

  const [notes, contacts, companies] = await Promise.all([
    prisma.note.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      include: { contact: true, company: true },
    }),
    prisma.contact.findMany({
      where: { userId },
      orderBy: { firstName: "asc" },
    }),
    prisma.company.findMany({
      where: { userId },
      orderBy: { name: "asc" },
    }),
  ]);

  return (
    <div>
      <PageHeader title="備註紀錄" description="記錄與客戶的互動與備忘" />

      <div className="grid gap-8 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <h2 className="mb-4 text-lg font-semibold">新增備註</h2>
          <form action={createNote}>
            <Field>
              <Label htmlFor="content">內容 *</Label>
              <Textarea
                id="content"
                name="content"
                rows={5}
                required
                placeholder="記錄通話、會議或跟進內容..."
              />
            </Field>
            <Field>
              <Label htmlFor="contactId">關聯聯絡人</Label>
              <Select id="contactId" name="contactId" defaultValue="">
                <option value="">— 無 —</option>
                {contacts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.firstName} {c.lastName}
                  </option>
                ))}
              </Select>
            </Field>
            <Field>
              <Label htmlFor="companyId">關聯公司</Label>
              <Select id="companyId" name="companyId" defaultValue="">
                <option value="">— 無 —</option>
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Button type="submit" className="w-full">
              新增
            </Button>
          </form>
        </Card>

        <div className="space-y-4 lg:col-span-2">
          {notes.length === 0 ? (
            <EmptyState message="尚無備註紀錄" />
          ) : (
            notes.map((note) => (
              <Card key={note.id}>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="whitespace-pre-wrap text-sm text-slate-700">
                      {note.content}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-3 text-xs text-slate-400">
                      <span>{formatDate(note.createdAt)}</span>
                      {note.contact && (
                        <span>
                          聯絡人：{note.contact.firstName}{" "}
                          {note.contact.lastName}
                        </span>
                      )}
                      {note.company && (
                        <span>公司：{note.company.name}</span>
                      )}
                    </div>
                  </div>
                  <form action={deleteNote.bind(null, note.id)}>
                    <Button type="submit" variant="ghost" size="sm">
                      刪除
                    </Button>
                  </form>
                </div>
              </Card>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
