import type { CustomerInput } from "./validation";
import {
  isCustomerNameStatus,
  type CustomerNameStatus,
} from "./name-status";

export function parseCustomerBody(
  body: Record<string, unknown>,
  options?: { forCreate?: boolean },
): CustomerInput {
  let nameStatus: CustomerNameStatus | undefined;
  if (options?.forCreate) {
    if (body.nameStatus === undefined || body.nameStatus === null) {
      nameStatus = "confirmed";
    } else if (isCustomerNameStatus(body.nameStatus)) {
      nameStatus = body.nameStatus;
    } else {
      // Preserve illegal value so validateCustomerInput can reject it.
      nameStatus = body.nameStatus as CustomerNameStatus;
    }
  }

  return {
    customerName:
      typeof body.customerName === "string" ? body.customerName : "",
    ...(options?.forCreate ? { nameStatus } : {}),
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
    requestedProjectCode:
      body.requestedProjectCode === null
        ? null
        : typeof body.requestedProjectCode === "string"
          ? body.requestedProjectCode
          : undefined,
    requestedProjectName:
      typeof body.requestedProjectName === "string"
        ? body.requestedProjectName
        : null,
    notes: typeof body.notes === "string" ? body.notes : null,
    salesStage:
      typeof body.salesStage === "string"
        ? body.salesStage
        : options?.forCreate
          ? ""
          : "new_lead",
    status: typeof body.status === "string" ? body.status : "active",
  };
}
