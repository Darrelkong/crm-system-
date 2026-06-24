import type { CustomerInput } from "./validation";

export function parseCustomerBody(body: Record<string, unknown>): CustomerInput {
  return {
    customerName:
      typeof body.customerName === "string" ? body.customerName : "",
    customerType:
      typeof body.customerType === "string" ? body.customerType : "individual",
    phoneCountryCode:
      typeof body.phoneCountryCode === "string" ? body.phoneCountryCode : "+86",
    phone: typeof body.phone === "string" ? body.phone : null,
    wechatId: typeof body.wechatId === "string" ? body.wechatId : null,
    email: typeof body.email === "string" ? body.email : null,
    source: typeof body.source === "string" ? body.source : "",
    sourceRemark:
      typeof body.sourceRemark === "string" ? body.sourceRemark : null,
    notes: typeof body.notes === "string" ? body.notes : null,
    salesStage:
      typeof body.salesStage === "string" ? body.salesStage : "new_lead",
    status: typeof body.status === "string" ? body.status : "active",
  };
}
