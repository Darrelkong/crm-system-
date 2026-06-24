export {
  getCurrentUser,
  requireAuth,
  requireAdmin,
  requireStaff,
  authErrorResponse,
  getRoleDashboardPath,
  AuthError,
} from "./auth";

export {
  isPublicPoolCustomer,
  getCustomerAccessLevel,
  assertCanAccessCustomer,
  assertCanViewCustomerFullDetails,
  assertCanEditCustomer,
  maskCustomerForStaff,
  formatCustomerForUser,
  toCustomerFullView,
  getCustomerListScope,
  PermissionError,
  type CustomerAccessLevel,
  type CustomerView,
} from "./customers";

export { logPermissionDenied } from "./audit";
