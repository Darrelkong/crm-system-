export type SecurityPolicyItem = {
  id: string;
  titleKey: string;
  descriptionKey: string;
};

export type SecurityPolicySection = {
  id: string;
  titleKey: string;
  policies: SecurityPolicyItem[];
};

export const SECURITY_POLICY_SECTIONS: SecurityPolicySection[] = [
  {
    id: "login",
    titleKey: "securityPolicies.sections.login.title",
    policies: [
      {
        id: "login-lockout",
        titleKey: "securityPolicies.policies.loginLockout.title",
        descriptionKey: "securityPolicies.policies.loginLockout.description",
      },
      {
        id: "login-locked-blocked",
        titleKey: "securityPolicies.policies.loginLockedBlocked.title",
        descriptionKey: "securityPolicies.policies.loginLockedBlocked.description",
      },
      {
        id: "login-admin-exempt",
        titleKey: "securityPolicies.policies.loginAdminExempt.title",
        descriptionKey: "securityPolicies.policies.loginAdminExempt.description",
      },
      {
        id: "login-admin-unlock",
        titleKey: "securityPolicies.policies.loginAdminUnlock.title",
        descriptionKey: "securityPolicies.policies.loginAdminUnlock.description",
      },
      {
        id: "login-password-reset",
        titleKey: "securityPolicies.policies.loginPasswordReset.title",
        descriptionKey: "securityPolicies.policies.loginPasswordReset.description",
      },
    ],
  },
  {
    id: "session",
    titleKey: "securityPolicies.sections.session.title",
    policies: [
      {
        id: "session-inactivity",
        titleKey: "securityPolicies.policies.sessionInactivity.title",
        descriptionKey: "securityPolicies.policies.sessionInactivity.description",
      },
      {
        id: "session-single-login",
        titleKey: "securityPolicies.policies.sessionSingleLogin.title",
        descriptionKey: "securityPolicies.policies.sessionSingleLogin.description",
      },
      {
        id: "session-deleted-revoked",
        titleKey: "securityPolicies.policies.sessionDeletedRevoked.title",
        descriptionKey: "securityPolicies.policies.sessionDeletedRevoked.description",
      },
      {
        id: "session-locked-revoked",
        titleKey: "securityPolicies.policies.sessionLockedRevoked.title",
        descriptionKey: "securityPolicies.policies.sessionLockedRevoked.description",
      },
    ],
  },
  {
    id: "user",
    titleKey: "securityPolicies.sections.user.title",
    policies: [
      {
        id: "user-admin-self-delete",
        titleKey: "securityPolicies.policies.userAdminSelfDelete.title",
        descriptionKey: "securityPolicies.policies.userAdminSelfDelete.description",
      },
      {
        id: "user-last-admin",
        titleKey: "securityPolicies.policies.userLastAdmin.title",
        descriptionKey: "securityPolicies.policies.userLastAdmin.description",
      },
      {
        id: "user-deleted-login",
        titleKey: "securityPolicies.policies.userDeletedLogin.title",
        descriptionKey: "securityPolicies.policies.userDeletedLogin.description",
      },
      {
        id: "user-customer-transfer",
        titleKey: "securityPolicies.policies.userCustomerTransfer.title",
        descriptionKey: "securityPolicies.policies.userCustomerTransfer.description",
      },
    ],
  },
  {
    id: "customer",
    titleKey: "securityPolicies.sections.customer.title",
    policies: [
      {
        id: "customer-recycle-bin",
        titleKey: "securityPolicies.policies.customerRecycleBin.title",
        descriptionKey: "securityPolicies.policies.customerRecycleBin.description",
      },
      {
        id: "customer-retention",
        titleKey: "securityPolicies.policies.customerRetention.title",
        descriptionKey: "securityPolicies.policies.customerRetention.description",
      },
      {
        id: "customer-restore",
        titleKey: "securityPolicies.policies.customerRestore.title",
        descriptionKey: "securityPolicies.policies.customerRestore.description",
      },
      {
        id: "customer-purge",
        titleKey: "securityPolicies.policies.customerPurge.title",
        descriptionKey: "securityPolicies.policies.customerPurge.description",
      },
    ],
  },
];
