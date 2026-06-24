import { prisma } from "@/lib/db";
import { auth } from "@/lib/auth";
import { createContact, deleteContact } from "@/app/actions/crm";
import { Button } from "@/components/ui/button";
import { Card, EmptyState, PageHeader } from "@/components/ui/card";
import { Field, Input, Label, Select } from "@/components/ui/form";

export default async function ContactsPage() {
  const session = await auth();
  const userId = session!.user!.id;

  const [contacts, companies] = await Promise.all([
    prisma.contact.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      include: { company: true },
    }),
    prisma.company.findMany({
      where: { userId },
      orderBy: { name: "asc" },
    }),
  ]);

  return (
    <div>
      <PageHeader title="聯絡人管理" description="管理客戶聯絡人資訊" />

      <div className="grid gap-8 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <h2 className="mb-4 text-lg font-semibold">新增聯絡人</h2>
          <form action={createContact}>
            <Field>
              <Label htmlFor="firstName">名字 *</Label>
              <Input id="firstName" name="firstName" required />
            </Field>
            <Field>
              <Label htmlFor="lastName">姓氏 *</Label>
              <Input id="lastName" name="lastName" required />
            </Field>
            <Field>
              <Label htmlFor="email">Email</Label>
              <Input id="email" name="email" type="email" />
            </Field>
            <Field>
              <Label htmlFor="phone">電話</Label>
              <Input id="phone" name="phone" />
            </Field>
            <Field>
              <Label htmlFor="title">職稱</Label>
              <Input id="title" name="title" />
            </Field>
            <Field>
              <Label htmlFor="companyId">所屬公司</Label>
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

        <div className="lg:col-span-2">
          {contacts.length === 0 ? (
            <EmptyState message="尚無聯絡人，請新增第一筆" />
          ) : (
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-slate-500">
                  <tr>
                    <th className="px-4 py-3 font-medium">姓名</th>
                    <th className="px-4 py-3 font-medium">Email</th>
                    <th className="px-4 py-3 font-medium">電話</th>
                    <th className="px-4 py-3 font-medium">公司</th>
                    <th className="px-4 py-3 font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {contacts.map((contact) => (
                    <tr
                      key={contact.id}
                      className="border-t border-slate-100"
                    >
                      <td className="px-4 py-3 font-medium text-slate-900">
                        {contact.firstName} {contact.lastName}
                        {contact.title && (
                          <span className="ml-1 text-slate-400">
                            ({contact.title})
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {contact.email || "—"}
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {contact.phone || "—"}
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {contact.company?.name || "—"}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <form
                          action={deleteContact.bind(null, contact.id)}
                        >
                          <Button type="submit" variant="ghost" size="sm">
                            刪除
                          </Button>
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
