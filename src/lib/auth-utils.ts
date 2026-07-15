// A simple server-side utility for checking permissions.

/**
 * Checks if a set of permissions contains a specific permission.
 * This is a helper to avoid repeating the `.has()` logic.
 * @param {Set<string>} permissionsSet - The user's effective permissions.
 * @param {string} requiredPermission - The permission to check for.
 * @returns {boolean} - True if the user has the permission.
 */
export function hasPermission(
  permissionsSet: Set<string>,
  requiredPermission: string,
): boolean {
  return permissionsSet.has(requiredPermission);
}

/**
 * Checks if a set of permissions contains at least one of the provided permissions.
 * @param {Set<string>} permissionsSet - The user's effective permissions.
 * @param {string[]} requiredPermissions - An array of permissions to check against.
 * @returns {boolean} - True if the user has at least one of the permissions.
 */
export function hasAnyPermission(
  permissionsSet: Set<string>,
  requiredPermissions: string[],
): boolean {
  return requiredPermissions.some((p) => permissionsSet.has(p));
}

// Defines the mapping from URL path prefixes to the required permission.
// The middleware will use this to protect routes.
// Keys should be ordered from more specific to less specific.
export const PERMISSION_MAP: Record<string, string> = {
  "/admin/settings/user-registration": "settings:user_registration:manage",
  "/admin/settings/user-management": "settings:user_management:view",
  "/admin/settings/role-management": "settings:role_management:view",
  "/admin/settings/agreement-template": "settings:agreement_templates:manage",
  "/admin/settings/bill-date-configuration":
    "settings:application_settings:manage",
  // Allow the settings hub to render and decide client-side which cards to show.
  // Route-level auth is enforced on each sub-page.
  "/admin/settings": "",
  "/admin/audit-log": "audit:view",
  "/admin/import": "import:manage",
  "/admin/buildings": "building:view",
  "/admin/spaces": "space:view",
  "/admin/tenants": "tenant:view",
  "/admin/agreements": "agreement:view",
  "/admin/building-utilities": "building_utility:view",
  "/admin/billing": "billing:view",
  "/admin/payments-overview": "payment_overview:view",
  "/admin/dashboard": "dashboard:view",
};
