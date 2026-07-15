import { prisma } from "@/lib/prisma";
import {
  applyOwnershipWhere,
  getDataAccessScope,
  shouldRestrictToOwnData,
} from "@/lib/data-access-scope";
import { addMonths, startOfDay } from "date-fns";
import { revalidatePath } from "next/cache";
import type {
  Prisma,
  Building,
  Space,
  Tenant,
  Agreement,
  Bill,
  BuildingMonthlyUtilities,
  PenaltyTier,
  User,
  Role,
  AgreementTemplate,
  AuditLog,
} from "@prisma/client";

export class DatabaseService {
  private async assertScopedRecordAccess(
    modelName:
      | "User"
      | "Building"
      | "Space"
      | "Tenant"
      | "Agreement"
      | "Bill"
      | "BuildingMonthlyUtilities"
      | "AgreementTemplate"
      | "ChangeRequest",
    id: string,
  ) {
    if (!shouldRestrictToOwnData(getDataAccessScope())) {
      return;
    }

    let record: { id: string } | null = null;

    switch (modelName) {
      case "User":
        record = await prisma.user.findFirst({
          where: applyOwnershipWhere("User", {
            id,
          }) as Prisma.UserWhereInput,
          select: { id: true },
        });
        break;
      case "Building":
        record = await prisma.building.findFirst({
          where: applyOwnershipWhere("Building", {
            id,
          }) as Prisma.BuildingWhereInput,
          select: { id: true },
        });
        break;
      case "Space":
        record = await prisma.space.findFirst({
          where: applyOwnershipWhere("Space", {
            id,
          }) as Prisma.SpaceWhereInput,
          select: { id: true },
        });
        break;
      case "Tenant":
        record = await prisma.tenant.findFirst({
          where: applyOwnershipWhere("Tenant", {
            id,
          }) as Prisma.TenantWhereInput,
          select: { id: true },
        });
        break;
      case "Agreement":
        record = await prisma.agreement.findFirst({
          where: applyOwnershipWhere("Agreement", {
            id,
          }) as Prisma.AgreementWhereInput,
          select: { id: true },
        });
        break;
      case "Bill":
        record = await prisma.bill.findFirst({
          where: applyOwnershipWhere("Bill", {
            id,
          }) as Prisma.BillWhereInput,
          select: { id: true },
        });
        break;
      case "BuildingMonthlyUtilities":
        record = await prisma.buildingMonthlyUtilities.findFirst({
          where: applyOwnershipWhere("BuildingMonthlyUtilities", {
            id,
          }) as Prisma.BuildingMonthlyUtilitiesWhereInput,
          select: { id: true },
        });
        break;
      case "AgreementTemplate":
        record = await prisma.agreementTemplate.findFirst({
          where: applyOwnershipWhere("AgreementTemplate", {
            id,
          }) as Prisma.AgreementTemplateWhereInput,
          select: { id: true },
        });
        break;
      case "ChangeRequest":
        record = await prisma.changeRequest.findFirst({
          where: applyOwnershipWhere("ChangeRequest", {
            id,
          }) as Prisma.ChangeRequestWhereInput,
          select: { id: true },
        });
        break;
    }

    if (!record) {
      throw new Error("Permission denied.");
    }
  }

  // --- Building ---
  async createBuilding(data: Prisma.BuildingCreateInput): Promise<Building> {
    if (process.env.NODE_ENV === "development") {
    }
    return prisma.building.create({ data });
  }

  async getBuildingById(
    id: string,
    include?: Prisma.BuildingInclude,
  ): Promise<Building | null> {
    return prisma.building.findUnique({ where: { id }, include });
  }

  async getAllBuildings(params?: {
    skip?: number;
    take?: number;
    cursor?: Prisma.BuildingWhereUniqueInput;
    where?: Prisma.BuildingWhereInput;
    orderBy?:
      | Prisma.BuildingOrderByWithRelationInput
      | Prisma.BuildingOrderByWithRelationInput[];
    include?: Prisma.BuildingInclude;
  }): Promise<Building[]> {
    return prisma.building.findMany(params);
  }

  async updateBuilding(
    id: string,
    data: Prisma.BuildingUpdateInput,
  ): Promise<Building> {
    await this.assertScopedRecordAccess("Building", id);
    return prisma.building.update({ where: { id }, data });
  }

  async deleteBuilding(id: string): Promise<Building> {
    await this.assertScopedRecordAccess("Building", id);
    // Before deleting a building, we need to manually disconnect it from any users who manage it.
    await prisma.building.update({
      where: { id },
      data: {
        managers: {
          set: [],
        },
      },
    });
    return prisma.building.delete({ where: { id } });
  }

  // --- Space ---
  async createSpace(data: Prisma.SpaceCreateArgs["data"]): Promise<Space> {
    return prisma.space.create({ data });
  }

  async getSpaceById(
    id: string,
    include?: Prisma.SpaceInclude,
  ): Promise<Space | null> {
    return prisma.space.findUnique({ where: { id }, include });
  }

  async getAllSpaces(params?: {
    skip?: number;
    take?: number;
    cursor?: Prisma.SpaceWhereUniqueInput;
    where?: Prisma.SpaceWhereInput;
    orderBy?:
      | Prisma.SpaceOrderByWithRelationInput
      | Prisma.SpaceOrderByWithRelationInput[];
    include?: Prisma.SpaceInclude;
  }): Promise<Space[]> {
    return prisma.space.findMany(params);
  }

  async updateSpace(
    id: string,
    data: Prisma.SpaceUpdateArgs["data"],
  ): Promise<Space> {
    await this.assertScopedRecordAccess("Space", id);
    return prisma.space.update({ where: { id }, data });
  }

  async deleteSpace(id: string): Promise<Space> {
    await this.assertScopedRecordAccess("Space", id);
    return prisma.space.delete({ where: { id } });
  }

  // --- Tenant ---
  async createTenant(data: Prisma.TenantCreateInput): Promise<Tenant> {
    return prisma.tenant.create({ data });
  }

  async findTenantByEmail(email: string): Promise<Tenant | null> {
    if (!email) return null;
    return prisma.tenant.findFirst({
      where: {
        email: {
          equals: email,
          mode: "insensitive", // case-insensitive match
        },
      },
    });
  }

  async findTenantByEmailOrPhone(
    email: string | null,
    phone: string | null,
  ): Promise<Tenant | null> {
    if (!email && !phone) return null;

    const whereClauses: Prisma.TenantWhereInput[] = [];
    if (email) {
      whereClauses.push({
        email: { equals: email, mode: "insensitive" as const },
      });
    }
    if (phone) {
      whereClauses.push({ phone: { equals: phone } });
      whereClauses.push({ alternativePhone: { equals: phone } });
    }

    if (whereClauses.length === 0) {
      return null;
    }

    return prisma.tenant.findFirst({
      where: {
        OR: whereClauses,
      },
    });
  }

  async getTenantById(
    id: string,
    include?: Prisma.TenantInclude,
  ): Promise<Tenant | null> {
    return prisma.tenant.findUnique({ where: { id }, include });
  }

  async getAllTenants(params?: Prisma.TenantFindManyArgs): Promise<Tenant[]> {
    return prisma.tenant.findMany(params);
  }

  async updateTenant(
    id: string,
    data: Prisma.TenantUpdateInput,
  ): Promise<Tenant> {
    await this.assertScopedRecordAccess("Tenant", id);
    return prisma.tenant.update({ where: { id }, data });
  }

  async deleteTenant(id: string): Promise<Tenant> {
    await this.assertScopedRecordAccess("Tenant", id);
    return prisma.tenant.delete({ where: { id } });
  }

  // --- Agreement ---
  async createAgreement(data: Prisma.AgreementCreateInput): Promise<Agreement> {
    // Normalize any date-only string values to UTC-midnight Date objects
    // so stored values preserve the calendar date regardless of server TZ.
    const normalizeDateInput = (v: any): string | undefined => {
      if (!v && v !== 0) return undefined;
      const toDateOnlyString = (d: Date) =>
        `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(
          2,
          "0",
        )}-${String(d.getUTCDate()).padStart(2, "0")}`;

      if (typeof v === "string") {
        const s = v.trim();
        const dateOnlyMatch = /^\d{4}-\d{1,2}-\d{1,2}$/.test(s);
        if (dateOnlyMatch) {
          // Keep as normalized date-only string
          const [y, m, d] = s.split("-").map(Number);
          return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(
            2,
            "0",
          )}`;
        }
        // Fallback: parse and convert to date-only string (use UTC components)
        const parsed = new Date(s);
        return toDateOnlyString(parsed);
      }
      if (v instanceof Date) return toDateOnlyString(v);
      return undefined;
    };

    const normalized: any = { ...data };
    if ((normalized as any).startDate)
      (normalized as any).startDate = normalizeDateInput(
        (normalized as any).startDate,
      );
    if ((normalized as any).nextPaymentDueDate)
      (normalized as any).nextPaymentDueDate = normalizeDateInput(
        (normalized as any).nextPaymentDueDate,
      );
    if ((normalized as any).initialPaymentDate)
      (normalized as any).initialPaymentDate = normalizeDateInput(
        (normalized as any).initialPaymentDate,
      );
    if ((normalized as any).endDate)
      (normalized as any).endDate = normalizeDateInput(
        (normalized as any).endDate,
      );

    return prisma.agreement.create({ data: normalized });
  }

  async getAgreementById(id?: string | null): Promise<Agreement | null>;
  async getAgreementById<TInclude extends Prisma.AgreementInclude>(
    id: string | null | undefined,
    include: TInclude,
  ): Promise<Prisma.AgreementGetPayload<{ include: TInclude }> | null>;
  async getAgreementById(
    id?: string | null,
    include?: Prisma.AgreementInclude,
  ): Promise<any> {
    if (!id) return null;
    return prisma.agreement.findUnique({ where: { id }, include });
  }

  async getAllAgreements(): Promise<Agreement[]>;
  async getAllAgreements<TInclude extends Prisma.AgreementInclude>(params: {
    skip?: number;
    take?: number;
    cursor?: Prisma.AgreementWhereUniqueInput;
    where?: Prisma.AgreementWhereInput;
    orderBy?:
      | Prisma.AgreementOrderByWithRelationInput
      | Prisma.AgreementOrderByWithRelationInput[];
    include: TInclude;
  }): Promise<Prisma.AgreementGetPayload<{ include: TInclude }>[]>;
  async getAllAgreements(params?: {
    skip?: number;
    take?: number;
    cursor?: Prisma.AgreementWhereUniqueInput;
    where?: Prisma.AgreementWhereInput;
    orderBy?:
      | Prisma.AgreementOrderByWithRelationInput
      | Prisma.AgreementOrderByWithRelationInput[];
    include?: Prisma.AgreementInclude;
  }): Promise<any> {
    return prisma.agreement.findMany(params);
  }

  async updateAgreement(
    id: string,
    data: Prisma.AgreementUpdateInput,
  ): Promise<Agreement> {
    await this.assertScopedRecordAccess("Agreement", id);
    return prisma.agreement.update({ where: { id }, data });
  }

  async deleteAgreement(id: string): Promise<Agreement> {
    await this.assertScopedRecordAccess("Agreement", id);
    return prisma.agreement.delete({ where: { id } });
  }

  // --- Bill ---
  async createBill(data: Prisma.BillCreateInput): Promise<Bill> {
    const created = await prisma.bill.create({ data });

    // After creating a bill, check whether the agreement is fully covered
    // with non-prepaid bills up to its end date. If so, expire the
    // agreement and free the space/tenant link.
    try {
      const agreement = await prisma.agreement.findUnique({
        where: { id: created.agreementId },
        select: {
          id: true,
          startDate: true,
          nextPaymentDueDate: true,
          endDate: true,
          status: true,
          spaceId: true,
          tenantId: true,
        },
      });

      if (agreement && agreement.endDate) {
        const nextDue = agreement.nextPaymentDueDate || agreement.startDate;

        const nextDueMonthStart = new Date(
          Date.UTC(nextDue.getUTCFullYear(), nextDue.getUTCMonth(), 1),
        );
        const agreementEndMonthStart = new Date(
          Date.UTC(
            agreement.endDate.getUTCFullYear(),
            agreement.endDate.getUTCMonth(),
            1,
          ),
        );
        const agreementEndMonthExclusive = new Date(
          Date.UTC(
            agreementEndMonthStart.getUTCFullYear(),
            agreementEndMonthStart.getUTCMonth() + 1,
            1,
          ),
        );

        let cursor = nextDueMonthStart;
        let allCovered = true;
        while (cursor < agreementEndMonthExclusive) {
          const monthStart = cursor;
          const monthEnd = new Date(
            Date.UTC(
              monthStart.getUTCFullYear(),
              monthStart.getUTCMonth() + 1,
              1,
            ),
          );
          const count = await prisma.bill.count({
            where: {
              agreementId: agreement.id,
              billDate: { gte: monthStart, lt: monthEnd },
              AND: [{ isPrepaid: { not: true } }],
            },
          });
          if (count === 0) {
            allCovered = false;
            break;
          }
          cursor = new Date(
            Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1),
          );
        }

        if (allCovered) {
          // expire agreement and free space/tenant
          if (
            agreement.status === "Active" ||
            agreement.status === "Inactive"
          ) {
            await prisma.agreement.update({
              where: { id: agreement.id },
              data: { status: "Expired" },
            });
          }
          if (agreement.spaceId) {
            try {
              await prisma.space.update({
                where: { id: agreement.spaceId },
                data: { isOccupied: false },
              });
            } catch (e) {
              /* ignore */
            }
          }
          if (agreement.tenantId) {
            try {
              await prisma.tenant.update({
                where: { id: agreement.tenantId },
                data: { rentedSpaceId: null },
              });
            } catch (e) {
              /* ignore */
            }
          }
          // Revalidate admin pages so the UI reflects the expired status and freed space
          try {
            revalidatePath("/admin/agreements");
            revalidatePath("/admin/spaces");
            revalidatePath("/admin/billing");
          } catch (e) {
            /* ignore in non-Next server contexts */
          }
        }
      }
    } catch (e) {
      // non-fatal; just log in development
      if (process.env.NODE_ENV === "development") console.error(e);
    }

    return created;
  }

  async getBillById(
    id: string,
    include?: Prisma.BillInclude,
  ): Promise<Bill | null> {
    return prisma.bill.findUnique({ where: { id }, include });
  }

  async getAllBills(params?: {
    skip?: number;
    take?: number;
    cursor?: Prisma.BillWhereUniqueInput;
    where?: Prisma.BillWhereInput;
    orderBy?:
      | Prisma.BillOrderByWithRelationInput
      | Prisma.BillOrderByWithRelationInput[];
    include?: Prisma.BillInclude;
  }): Promise<Bill[]> {
    return prisma.bill.findMany(params);
  }

  async updateBill(id: string, data: Prisma.BillUpdateInput): Promise<Bill> {
    await this.assertScopedRecordAccess("Bill", id);
    return prisma.bill.update({ where: { id }, data });
  }

  async deleteBill(id: string): Promise<Bill> {
    await this.assertScopedRecordAccess("Bill", id);
    return prisma.bill.delete({ where: { id } });
  }

  // --- BuildingMonthlyUtilities ---
  async createBuildingMonthlyUtilities(
    data: Prisma.BuildingMonthlyUtilitiesCreateInput,
  ): Promise<BuildingMonthlyUtilities> {
    return prisma.buildingMonthlyUtilities.create({ data });
  }

  async getBuildingMonthlyUtilitiesById(
    id: string,
    include?: Prisma.BuildingMonthlyUtilitiesInclude,
  ): Promise<BuildingMonthlyUtilities | null> {
    return prisma.buildingMonthlyUtilities.findUnique({
      where: { id },
      include,
    });
  }

  async getBuildingMonthlyUtilitiesByBuildingMonthYear(
    buildingId: string,
    month: number,
    year: number,
    include?: Prisma.BuildingMonthlyUtilitiesInclude,
  ): Promise<(BuildingMonthlyUtilities & { utilities: any[] }) | null> {
    return prisma.buildingMonthlyUtilities.findFirst({
      where: { buildingId, month, year },
      include,
    });
  }

  async getAllBuildingMonthlyUtilities(params?: {
    skip?: number;
    take?: number;
    cursor?: Prisma.BuildingMonthlyUtilitiesWhereUniqueInput;
    where?: Prisma.BuildingMonthlyUtilitiesWhereInput;
    orderBy?:
      | Prisma.BuildingMonthlyUtilitiesOrderByWithRelationInput
      | Prisma.BuildingMonthlyUtilitiesOrderByWithRelationInput[];
    include?: Prisma.BuildingMonthlyUtilitiesInclude;
  }): Promise<BuildingMonthlyUtilities[]> {
    return prisma.buildingMonthlyUtilities.findMany(params);
  }

  async upsertBuildingMonthlyUtilities(
    where: Prisma.BuildingMonthlyUtilitiesWhereUniqueInput,
    create: Prisma.BuildingMonthlyUtilitiesCreateInput,
    update: Prisma.BuildingMonthlyUtilitiesUpdateInput,
    include?: Prisma.BuildingMonthlyUtilitiesInclude,
  ): Promise<BuildingMonthlyUtilities> {
    return prisma.buildingMonthlyUtilities.upsert({
      where,
      create,
      update,
      include,
    });
  }

  async deleteBuildingMonthlyUtilities(
    id: string,
  ): Promise<BuildingMonthlyUtilities> {
    await this.assertScopedRecordAccess("BuildingMonthlyUtilities", id);
    return prisma.buildingMonthlyUtilities.delete({ where: { id } });
  }

  // --- PenaltyTier ---
  async createPenaltyTier(
    data: Prisma.PenaltyTierCreateInput,
  ): Promise<PenaltyTier> {
    return prisma.penaltyTier.create({ data });
  }

  async getPenaltyTierById(id: string): Promise<PenaltyTier | null> {
    return prisma.penaltyTier.findUnique({ where: { id } });
  }

  async getAllPenaltyTiers(params?: {
    skip?: number;
    take?: number;
    cursor?: Prisma.PenaltyTierWhereUniqueInput;
    where?: Prisma.PenaltyTierWhereInput;
    orderBy?:
      | Prisma.PenaltyTierOrderByWithRelationInput
      | Prisma.PenaltyTierOrderByWithRelationInput[];
    include?: Prisma.PenaltyTierInclude;
  }): Promise<PenaltyTier[]> {
    return prisma.penaltyTier.findMany(params);
  }

  async updatePenaltyTier(
    id: string,
    data: Prisma.PenaltyTierUpdateInput,
  ): Promise<PenaltyTier> {
    return prisma.penaltyTier.update({ where: { id }, data });
  }

  async deletePenaltyTier(id: string): Promise<PenaltyTier> {
    return prisma.penaltyTier.delete({ where: { id } });
  }

  async deletePenaltyTiersByBuildingId(
    buildingId: string,
  ): Promise<Prisma.BatchPayload> {
    return prisma.penaltyTier.deleteMany({ where: { buildingId } });
  }

  // --- User ---
  async createUser(data: Prisma.UserCreateInput): Promise<User> {
    return prisma.user.create({ data });
  }

  async getUserById(id: string): Promise<User | null>;
  async getUserById<TInclude extends Prisma.UserInclude>(
    id: string,
    include: TInclude,
  ): Promise<Prisma.UserGetPayload<{ include: TInclude }> | null>;
  async getUserById(id: string, include?: Prisma.UserInclude): Promise<any> {
    return prisma.user.findUnique({ where: { id }, include });
  }

  // --- UserSession ---
  async createUserSession(jti: string, userId: string): Promise<void> {
    await prisma.userSession.create({ data: { jti, userId } });
  }

  async getUserSessionByJti(jti: string) {
    return prisma.userSession.findUnique({ where: { jti } });
  }

  async revokeUserSessionByJti(jti: string) {
    return prisma.userSession.updateMany({
      where: { jti },
      data: { revoked: true, revokedAt: new Date() },
    });
  }

  async revokeUserSessionsByUserId(userId: string) {
    return prisma.userSession.updateMany({
      where: { userId, revoked: false },
      data: { revoked: true, revokedAt: new Date() },
    });
  }

  async updateUserSessionLastActive(jti: string) {
    return prisma.userSession.updateMany({
      where: { jti },
      data: { lastActive: new Date() },
    });
  }

  async findUserByPhoneNumber(
    phoneNumber: string,
    include?: Prisma.UserInclude,
  ): Promise<User | null> {
    if (!phoneNumber) return null;
    return prisma.user.findFirst({
      where: { phoneNumber: phoneNumber },
      include,
    });
  }

  async findUserByEmailOrPhone(
    email: string | null,
    phone: string | null,
  ): Promise<User | null> {
    if (!email && !phone) return null;
    const whereClauses: Prisma.UserWhereInput[] = [];
    if (email)
      whereClauses.push({ email: { equals: email, mode: "insensitive" } });
    if (phone) whereClauses.push({ phoneNumber: phone });
    return prisma.user.findFirst({ where: { OR: whereClauses } });
  }

  async getAllUsers(params?: {
    skip?: number;
    take?: number;
    cursor?: Prisma.UserWhereUniqueInput;
    where?: Prisma.UserWhereInput;
    orderBy?:
      | Prisma.UserOrderByWithRelationInput
      | Prisma.UserOrderByWithRelationInput[];
    include?: Prisma.UserInclude;
  }): Promise<User[]> {
    return prisma.user.findMany(params);
  }

  async updateUser(id: string, data: Prisma.UserUpdateInput): Promise<User> {
    await this.assertScopedRecordAccess("User", id);
    return prisma.user.update({ where: { id }, data });
  }

  async deleteUser(id: string): Promise<User> {
    await this.assertScopedRecordAccess("User", id);
    // Manually handle disconnecting relations before deleting the user.
    await prisma.user.update({
      where: { id },
      data: {
        managedBuildings: { set: [] },
        createdRoles: {
          updateMany: {
            where: { createdById: id },
            data: { createdById: null },
          },
        },
        createdTenants: {
          updateMany: {
            where: { createdById: id },
            data: { createdById: null },
          },
        },
        createdUsers: {
          updateMany: {
            where: { createdById: id },
            data: { createdById: null },
          },
        },
      },
    });
    return prisma.user.delete({ where: { id } });
  }

  // --- Application Settings ---
  async getApplicationSetting(id = "global") {
    return prisma.applicationSetting.findUnique({
      where: { id },
    });
  }

  async getApplicationSettings(ids: string[]) {
    return prisma.applicationSetting.findMany({
      where: { id: { in: ids } },
    });
  }

  async upsertApplicationSetting(
    id: string,
    data: Prisma.ApplicationSettingUpdateInput,
  ) {
    return prisma.applicationSetting.upsert({
      where: { id },
      create: {
        id,
        ...(data as Prisma.ApplicationSettingCreateInput),
      },
      update: data,
    });
  }

  // --- Role ---
  async createRole(data: Prisma.RoleCreateInput): Promise<Role> {
    return prisma.role.create({ data });
  }

  async getRoleById(id: string): Promise<Role | null> {
    return prisma.role.findUnique({ where: { id } });
  }

  async getRoleByName(name: string): Promise<Role | null> {
    return prisma.role.findFirst({ where: { name } });
  }

  async getRoleByNameAndCreator(
    name: string,
    createdById?: string | null,
  ): Promise<Role | null> {
    const where: Prisma.RoleWhereInput = { name };
    // If createdById is explicitly null, it's a system role check.
    // If undefined, we don't filter by creator (might not be desired).
    // If a string, it's a user-created role check.
    if (createdById === null) {
      where.createdById = null;
    } else if (createdById) {
      where.createdById = createdById;
    }
    return prisma.role.findFirst({ where });
  }

  async getAllRoles(params?: {
    skip?: number;
    take?: number;
    cursor?: Prisma.RoleWhereUniqueInput;
    where?: Prisma.RoleWhereInput;
    orderBy?:
      | Prisma.RoleOrderByWithRelationInput
      | Prisma.RoleOrderByWithRelationInput[];
    include?: Prisma.RoleInclude;
  }): Promise<Role[]> {
    return prisma.role.findMany(params);
  }

  async updateRole(id: string, data: Prisma.RoleUpdateInput): Promise<Role> {
    return prisma.role.update({ where: { id }, data });
  }

  async deleteRole(id: string): Promise<Role> {
    // Optional: Check if role is in use before deleting
    const roleWithUsers = await prisma.role.findUnique({
      where: { id },
      select: { _count: { select: { users: true } } },
    });

    if ((roleWithUsers?._count.users ?? 0) > 0) {
      throw new Error(
        "Cannot delete role as it is currently assigned to one or more users.",
      );
    }
    return prisma.role.delete({ where: { id } });
  }

  // --- AgreementTemplate ---
  async createAgreementTemplate(
    data: Prisma.AgreementTemplateCreateInput,
  ): Promise<AgreementTemplate> {
    return prisma.agreementTemplate.create({ data });
  }

  async getAgreementTemplateById(
    id: string,
  ): Promise<AgreementTemplate | null> {
    return prisma.agreementTemplate.findUnique({ where: { id } });
  }

  async getAllAgreementTemplates(params?: {
    where?: Prisma.AgreementTemplateWhereInput;
    orderBy?:
      | Prisma.AgreementTemplateOrderByWithRelationInput
      | Prisma.AgreementTemplateOrderByWithRelationInput[];
    select?: Prisma.AgreementTemplateSelect;
  }): Promise<any[]> {
    return prisma.agreementTemplate.findMany(params as any);
  }

  async updateAgreementTemplate(
    id: string,
    data: Prisma.AgreementTemplateUpdateInput,
  ): Promise<AgreementTemplate> {
    await this.assertScopedRecordAccess("AgreementTemplate", id);
    return prisma.agreementTemplate.update({ where: { id }, data });
  }

  async deleteAgreementTemplate(id: string): Promise<AgreementTemplate> {
    await this.assertScopedRecordAccess("AgreementTemplate", id);
    return prisma.agreementTemplate.delete({ where: { id } });
  }

  // --- AuditLog ---
  async createAuditLog(data: Prisma.AuditLogCreateInput): Promise<AuditLog> {
    return prisma.auditLog.create({ data });
  }

  async getAllAuditLogs(
    params?: Prisma.AuditLogFindManyArgs,
  ): Promise<AuditLog[]> {
    return prisma.auditLog.findMany(params);
  }

  // --- ChangeRequest ---
  async createChangeRequest(
    data: Prisma.ChangeRequestCreateInput,
  ): Promise<any> {
    return prisma.changeRequest.create({ data } as any);
  }

  async getChangeRequestById(id: string): Promise<any | null> {
    return prisma.changeRequest.findUnique({ where: { id } as any });
  }

  async listChangeRequests(params?: {
    where?: Prisma.ChangeRequestWhereInput;
    orderBy?: Prisma.ChangeRequestOrderByWithRelationInput | null;
    take?: number;
    skip?: number;
  }): Promise<any[]> {
    return prisma.changeRequest.findMany(params as any);
  }

  async updateChangeRequest(
    id: string,
    data: Prisma.ChangeRequestUpdateInput,
  ): Promise<any> {
    await this.assertScopedRecordAccess("ChangeRequest", id);
    return prisma.changeRequest.update({ where: { id } as any, data } as any);
  }
}

export const databaseService = new DatabaseService();
