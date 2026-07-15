import "server-only";

import { AsyncLocalStorage } from "async_hooks";

export interface DataAccessScope {
  userId: string;
  isSuperAdmin: boolean;
  managedBuildingIds?: string[] | null;
  showAllBuildings?: boolean;
  showAllUsers?: boolean;
}

const dataAccessScopeStorage = new AsyncLocalStorage<DataAccessScope>();

export function setDataAccessScope(scope: DataAccessScope) {
  dataAccessScopeStorage.enterWith(scope);
}

export function getDataAccessScope() {
  return dataAccessScopeStorage.getStore() ?? null;
}

export function shouldRestrictToOwnData(
  scope = getDataAccessScope(),
): scope is DataAccessScope {
  return !!scope && !scope.isSuperAdmin;
}

function mergeWhere(
  where: Record<string, unknown> | undefined,
  restriction: Record<string, unknown>,
) {
  if (!where || Object.keys(where).length === 0) {
    return restriction;
  }

  return {
    AND: [where, restriction],
  };
}

function hasUnrestrictedBuildingAccess(scope: DataAccessScope) {
  return (
    scope.isSuperAdmin ||
    !!scope.showAllBuildings ||
    scope.managedBuildingIds === null
  );
}

function getBuildingScopedWhere(modelName: string, scope: DataAccessScope) {
  if (hasUnrestrictedBuildingAccess(scope)) {
    return undefined;
  }

  const managedBuildingIds = scope.managedBuildingIds ?? [];

  if (managedBuildingIds.length === 0) {
    return undefined;
  }

  switch (modelName) {
    case "Building":
      return { id: { in: managedBuildingIds } };
    case "Space":
      return { buildingId: { in: managedBuildingIds } };
    case "Tenant":
      return {
        OR: [
          { buildingId: { in: managedBuildingIds } },
          {
            rentedSpace: {
              is: { buildingId: { in: managedBuildingIds } },
            },
          },
          {
            agreements: {
              some: {
                OR: [
                  { buildingId: { in: managedBuildingIds } },
                  { space: { buildingId: { in: managedBuildingIds } } },
                ],
              },
            },
          },
          {
            buildingStatuses: {
              some: { buildingId: { in: managedBuildingIds } },
            },
          },
        ],
      };
    case "Agreement":
      return {
        OR: [
          { buildingId: { in: managedBuildingIds } },
          { space: { buildingId: { in: managedBuildingIds } } },
        ],
      };
    case "Bill":
      return {
        OR: [
          { agreement: { buildingId: { in: managedBuildingIds } } },
          { agreement: { space: { buildingId: { in: managedBuildingIds } } } },
          { tenant: { buildingId: { in: managedBuildingIds } } },
        ],
      };
    case "BuildingMonthlyUtilities":
    case "AgreementTemplate":
    case "AuditLog":
    case "TenantMessage":
      return { buildingId: { in: managedBuildingIds } };
    case "ChangeRequest":
      return {
        AND: [
          { resourceType: "Building" },
          { resourceId: { in: managedBuildingIds } },
        ],
      };
    default:
      return undefined;
  }
}

function getOwnershipWhere(modelName: string, scope: DataAccessScope) {
  const { userId } = scope;
  const buildingScopedWhere = getBuildingScopedWhere(modelName, scope);

  switch (modelName) {
    case "User":
      if (scope.showAllUsers) {
        return {
          roles: {
            none: { name: "SUPER_ADMIN" },
          },
        };
      }

      return {
        OR: [{ id: userId }, { createdById: userId }],
      };
    case "Building":
    case "Space":
    case "Tenant":
    case "Agreement":
    case "BuildingMonthlyUtilities":
    case "AgreementTemplate":
      return buildingScopedWhere
        ? {
            OR: [buildingScopedWhere, { createdById: userId }],
          }
        : { createdById: userId };
    case "Bill":
      return buildingScopedWhere
        ? {
            OR: [buildingScopedWhere, { agreement: { createdById: userId } }],
          }
        : { agreement: { createdById: userId } };
    case "AuditLog":
      return buildingScopedWhere
        ? { OR: [buildingScopedWhere, { actorId: userId }] }
        : { actorId: userId };
    case "ChangeRequest":
      return buildingScopedWhere
        ? { OR: [buildingScopedWhere, { requestedById: userId }] }
        : { requestedById: userId };
    case "TenantMessage":
      return buildingScopedWhere
        ? { OR: [buildingScopedWhere, { building: { createdById: userId } }] }
        : { building: { createdById: userId } };
    default:
      return undefined;
  }
}

export function applyOwnershipWhere<T = Record<string, unknown>>(
  modelName: string,
  where?: T,
): T | undefined {
  const scope = getDataAccessScope();
  if (!shouldRestrictToOwnData(scope)) {
    return where;
  }

  const restriction = getOwnershipWhere(modelName, scope);
  if (!restriction) {
    return where;
  }

  return mergeWhere(
    where as Record<string, unknown> | undefined,
    restriction,
  ) as T;
}
