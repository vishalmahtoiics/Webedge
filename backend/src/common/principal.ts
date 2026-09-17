import { Realm } from '@prisma/client';

/**
 * The authenticated caller, derived only from the verified session.
 *
 * `customerId` is the tenant scope for every customer query and it lives here —
 * never read from a route parameter, query string or body. That is the whole
 * defence against one customer addressing another's resources.
 */
export type AdminPrincipal = {
  realm: typeof Realm.ADMIN;
  userId: string;
  email: string;
  roleId: string;
  roleName: string;
  permissions: ReadonlySet<string>;
  /** Set only while a staff member is viewing the portal as a customer. */
  impersonating?: { customerId: string; readOnly: boolean };
};

export type CustomerPrincipal = {
  realm: typeof Realm.CUSTOMER;
  userId: string;
  customerId: string;
  email: string;
  roleId: string;
  roleName: string;
  permissions: ReadonlySet<string>;
};

export type Principal = AdminPrincipal | CustomerPrincipal;

export const isAdmin = (p: Principal): p is AdminPrincipal => p.realm === Realm.ADMIN;
export const isCustomer = (p: Principal): p is CustomerPrincipal => p.realm === Realm.CUSTOMER;

/** Express request carrying a verified principal. */
export type AuthenticatedRequest = {
  principal?: Principal;
  requestId?: string;
  headers: Record<string, string | string[] | undefined>;
  cookies?: Record<string, string | undefined>;
  ip?: string;
  socket?: { remoteAddress?: string };
};
