import { prisma } from "@/lib/db";
import { auth } from "@/lib/auth";
import { createCompany, deleteCompany } from "@/app/actions/crm";
import { Button } from "@/components/ui/button";
import { Card, EmptyState, PageHeader } from "@/components/ui/card";
import { Field, Input, Label } from "@/components/ui/form";

export default async function CompaniesPage() {
  const session = await auth();
  const companies = await prisma.company.findMany({
    where: { userId: session!.user!.id },
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { contacts: true, tasks: true } } },
  });

  return (
    <div>
      <PageHeader title="公司管理" description="管理客戶公司資訊" />

      <div className="grid gap-8 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <h2 className="mb-4 text-lg font-semibold">新增公司</h2>
          <form action={createCompany}>
            <Field>
              <Label htmlFor="name">公司名稱 *</Label>
              <Input id="name" name="name" required />
            </Field>
            <Field>
              <Label htmlFor="industry">產業</Label>
              <Input id="industry" name="industry" />
            </Field>
            <Field>
              <Label htmlFor="website">網站</Label>
              <Input id="website" name="website" type="url" />
            </Field>
            <Field>
              <Label htmlFor="phone">電話</Label>
              <Input id="phone" name="phone" />
            </Field>
            <Field>
              <Label htmlFor="address">地址</Label>
              <Input id="address" name="address" />
            </Field>
            <Button type="submit" className="w-full">
              新增
            </Button>
          </form>
        </Card>

        <div className="lg:col-span-2">
          {companies.length === 0 ? (
            <EmptyState message="尚無公司資料，請新增第一筆" />
          ) : (
            <div className="space-y-4">
              {companies.map((company) => (
                <Card key={company.id}>
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h3 className="text-lg font-semibold text-slate-900">
                        {company.name}
                      </h3>
                      <div className="mt-2 space-y-1 text-sm text-slate-500">
                        {company.industry && <p>產業：{company.industry}</p>}
                        {company.website && <p>網站：{company.website}</p>}
                        {company.phone && <p>電話：{company.phone}</p>}
                        {company.address && <p>地址：{company.address}</p>}
                        <p>
                          {company._count.contacts} 位聯絡人 ·{" "}
                          {company._count.tasks} 項待辦
                        </p>
                      </div>
                    </div>
                    <form action={deleteCompany.bind(null, company.id)}>
                      <Button type="submit" variant="danger" size="sm">
                        刪除
                      </Button>
                    </form>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
