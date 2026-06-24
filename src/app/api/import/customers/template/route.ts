export const dynamic = "force-dynamic";

import { buildCustomerImportTemplateCsv } from "@/lib/import/customers/template";
import { requireImportAdmin } from "@/lib/permissions/import";
import { authErrorResponse } from "@/lib/permissions/auth";

export async function GET(request: Request) {
  try {
    await requireImportAdmin(request);
    const csv = buildCustomerImportTemplateCsv();
    return new Response(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition":
          'attachment; filename="customer-import-template.csv"',
      },
    });
  } catch (error) {
    return authErrorResponse(error);
  }
}
