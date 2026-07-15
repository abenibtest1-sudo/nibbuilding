"use server";

import { revalidatePath } from "next/cache";
import { databaseService } from "@/lib/services/databaseService";
import {
  Prisma,
  type User as PrismaUser,
  type Role as PrismaRole,
  TenantStatus,
  AgreementStatus,
} from "@prisma/client";
import { addMonths, isAfter } from "date-fns";
import { prisma } from "@/lib/prisma";
import { GENERIC_NEUTRAL_ERROR } from "@/lib/security/messages";
import { sendEmail } from "@/lib/services/emailService";
import {
  getUserAndPermissions,
  getUserAndManagedIds,
} from "@/lib/actions/server-helpers";
import bcrypt from "bcryptjs";

function generateTempPassword(length = 12): string {
  const upper = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const lower = "abcdefghijklmnopqrstuvwxyz";
  const numbers = "0123456789";
  const symbols = "!@#$%^&*()_+-=[]{}|;:,.<>?";
  const allChars = upper + lower + numbers + symbols;

  let password = "";
  const randomValues = new Uint32Array(length);
  crypto.getRandomValues(randomValues);

  // Ensure at least one of each character type
  password += upper[randomValues[0] % upper.length];
  password += lower[randomValues[1] % lower.length];
  password += numbers[randomValues[2] % numbers.length];
  password += symbols[randomValues[3] % symbols.length];

  // Fill the rest of the password
  for (let i = 4; i < length; i++) {
    password += allChars[randomValues[i] % allChars.length];
  }

  // Shuffle the password to avoid predictable patterns
  return password
    .split("")
    .sort(
      () => 0.5 - crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296,
    )
    .join("");
}

export async function createTenantAction(data: {
  name: string;
  email: string;
  phone: string;
  alternativePhone?: string;
  nationalId?: string;
  representativeName?: string;
  representativePhone?: string;
}) {
  try {
    const { currentUser: adminUser } = await getUserAndPermissions();
    if (!adminUser) {
      return { success: false, error: GENERIC_NEUTRAL_ERROR };
    }

    const existingTenant = await databaseService.findTenantByEmailOrPhone(
      data.email,
      data.phone,
    );

    if (existingTenant) {
      return {
        success: false,
        error: GENERIC_NEUTRAL_ERROR,
      };
    }

    const existingUser = await databaseService.findUserByEmailOrPhone(
      data.email,
      data.phone,
    );

    let userForTenant: PrismaUser;
    let tempPassword: string | undefined = undefined;

    if (existingUser) {
      if (existingUser.createdById !== adminUser.id) {
        return {
          success: false,
          error: GENERIC_NEUTRAL_ERROR,
        };
      }

      userForTenant = existingUser;
    } else {
      tempPassword = generateTempPassword();

      const tenantRole = await databaseService.getRoleByName("TENANT");
      if (!tenantRole)
        return {
          success: false,
          error: GENERIC_NEUTRAL_ERROR,
        };

      userForTenant = await databaseService.createUser({
        email: data.email,
        name: data.name,
        firstName: data.name.split(" ")[0] || data.name,
        lastName: data.name.split(" ").slice(1).join(" ") || "Tenant",
        phoneNumber: data.phone,
        password: null, // Set main password to null
        tempPassword: tempPassword, // Store temp password
        createdBy: { connect: { id: adminUser.id } },
        roles: { connect: { id: tenantRole.id } },
      });

      const emailHtml = `
          <h1>Welcome to Nib Building Management!</h1>
          <p>Hello ${data.name},</p>
          <p>A new tenant portal account has been created for you. You can use these credentials to log in and manage your lease.</p>
          <p>You can access the portal here: <a href="${process.env.NEXTAUTH_URL}/login">${process.env.NEXTAUTH_URL}/login</a></p>
          <p><strong>Phone Number:</strong> ${data.phone}</p>
          <p><strong>Temporary Password:</strong> ${tempPassword}</p>
          <p>For your security, you will be required to change this password upon your first login.</p>
          <p>Thank you,</p>
          <p>The Management Team</p>
        `;
      await sendEmail({
        to: data.email,
        subject: "Your New Tenant Portal Account Credentials",
        html: emailHtml,
      });
    }

    const newTenant = await databaseService.createTenant({
      name: data.name,
      email: data.email,
      phone: data.phone,
      alternativePhone: data.alternativePhone,
      nationalId: data.nationalId,
      representativeName: data.representativeName,
      representativePhone: data.representativePhone,
      user: { connect: { id: userForTenant.id } },
      createdBy: { connect: { id: adminUser.id } },
    });

    revalidatePath("/admin/tenants");
    return { success: true, tenant: newTenant, tempPassword: tempPassword };
  } catch (error: any) {
    return {
      success: false,
      error: GENERIC_NEUTRAL_ERROR,
    };
  }
}

export async function updateTenantAction(
  tenantId: string,
  data: Prisma.TenantUpdateInput,
) {
  try {
    await getUserAndPermissions();
    const updatedTenant = await databaseService.updateTenant(tenantId, data);
    revalidatePath("/admin/tenants");
    return { success: true, tenant: updatedTenant };
  } catch (error: any) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2002") {
        const target = (error.meta?.target as string[]) || [];
        const fieldName = target.join(", ");
        return {
          success: false,
          error: `Failed to update tenant. A tenant with the same ${fieldName} already exists.`,
        };
      }
      if (error.code === "P2025") {
        return {
          success: false,
          error: "Failed to update tenant. Record not found.",
        };
      }
    }
    return {
      success: false,
      error: error.message || "Failed to update tenant.",
    };
  }
}

export async function findUserByPhoneAction(phone: string): Promise<{
  success: boolean;
  user?: { name: string; email: string; nationalId?: string | null };
  error?: string;
}> {
  const { currentUser } = await getUserAndPermissions();

  if (!phone) {
    return { success: false, error: GENERIC_NEUTRAL_ERROR };
  }
  try {
    const user = await databaseService.findUserByPhoneNumber(phone, {
      roles: true,
    });

    if (user) {
      const tenant = await databaseService.findTenantByEmailOrPhone(
        null,
        phone,
      );
      const canAccessUser =
        user.createdById === currentUser.id ||
        !!tenant?.userId ||
        tenant?.phone === phone ||
        tenant?.alternativePhone === phone;

      if (!canAccessUser) {
        return { success: false, error: GENERIC_NEUTRAL_ERROR };
      }

      // `user.roles` may be omitted in the Prisma type here; guard access safely
      const rolesArr = (user as any).roles || [];
      const hasOtherRoles =
        Array.isArray(rolesArr) &&
        rolesArr.some((role: any) => role?.name !== "TENANT");

      if (hasOtherRoles) {
        return { success: false, error: GENERIC_NEUTRAL_ERROR };
      }

      // Return tenant details when available so the client can switch to edit mode
      if (tenant) {
        return {
          success: true,
          user: {
            name: user.name || `${user.firstName} ${user.lastName}`,
            email: user.email,
            nationalId: tenant.nationalId,
          },
          // @ts-ignore - dynamic return shape for convenience in client
          tenant: {
            id: tenant.id,
            name: tenant.name,
            email: tenant.email,
            phone: tenant.phone,
            alternativePhone: tenant.alternativePhone,
            nationalId: tenant.nationalId,
            representativeName: tenant.representativeName,
            representativePhone: tenant.representativePhone,
            createdAt: tenant.createdAt,
            updatedAt: tenant.updatedAt,
            status: tenant.status,
          },
        };
      }

      return {
        success: true,
        user: {
          name: user.name || `${user.firstName} ${user.lastName}`,
          email: user.email,
          nationalId: (tenant as any)?.nationalId,
        },
      };
    }
    return { success: false, error: GENERIC_NEUTRAL_ERROR };
  } catch (error: any) {
    return { success: false, error: GENERIC_NEUTRAL_ERROR };
  }
}

export async function toggleTenantStatusAction(
  tenantId: string,
  isActive: boolean,
  buildingId?: string,
): Promise<{ success: boolean; tenant?: any; error?: string }> {
  try {
    const { isSuperAdmin, permissions, managedBuildingIds } =
      await getUserAndManagedIds();

    if (!isSuperAdmin && !permissions.has("tenant:status")) {
      return { success: false, error: "Access Denied" };
    }

    // If a buildingId is provided or the user manages buildings, perform a
    // building-scoped deactivation/reactivation. Otherwise, fall back to the
    // previous global behavior (super-admin global toggle).
    const scopeBuildingId =
      buildingId || (managedBuildingIds && managedBuildingIds[0]);

    if (!isActive) {
      // Deactivating
      if (scopeBuildingId) {
        // Scoped: do not change tenant.status globally — only affect
        // agreements, bills, and occupied space in the target building.
        await prisma.$transaction(async (tx) => {
          // Mark active agreements in this building as Inactive
          await tx.agreement.updateMany({
            where: {
              tenantId: tenantId,
              space: { buildingId: scopeBuildingId },
              status: AgreementStatus.Active,
            },
            data: { status: AgreementStatus.Inactive },
          });

          // Delete unpaid bills for agreements in this building
          await tx.bill.deleteMany({
            where: {
              tenantId: tenantId,
              status: { not: "Paid" },
              agreement: { space: { buildingId: scopeBuildingId } },
            },
          });

          // If tenant's rentedSpace is in this building, free it and clear rentedSpaceId
          const tenantRecord = await tx.tenant.findUnique({
            where: { id: tenantId },
          });
          if (tenantRecord && tenantRecord.rentedSpaceId) {
            const spaceRec = await tx.space.findUnique({
              where: { id: tenantRecord.rentedSpaceId },
              select: { buildingId: true },
            });
            if (spaceRec && spaceRec.buildingId === scopeBuildingId) {
              try {
                await tx.space.update({
                  where: { id: tenantRecord.rentedSpaceId },
                  data: { isOccupied: false },
                });
                await tx.tenant.update({
                  where: { id: tenantId },
                  data: { rentedSpaceId: null } as any,
                });
              } catch (e) {
                // ignore individual errors
              }
            }
          }
          // Upsert per-building tenant status to Inactive
          const existingStatus = await tx.tenantBuildingStatus.findFirst({
            where: { tenantId: tenantId, buildingId: scopeBuildingId },
          });
          if (existingStatus) {
            await tx.tenantBuildingStatus.update({
              where: { id: existingStatus.id },
              data: { status: TenantStatus.Inactive },
            });
          } else {
            await tx.tenantBuildingStatus.create({
              data: {
                tenantId: tenantId,
                buildingId: scopeBuildingId,
                status: TenantStatus.Inactive,
              },
            });
          }
        });
      } else {
        // Global fallback (existing behavior)
        await prisma.$transaction(async (tx) => {
          await tx.tenant.update({
            where: { id: tenantId },
            data: { status: TenantStatus.Inactive },
          });

          await tx.agreement.updateMany({
            where: { tenantId: tenantId, status: AgreementStatus.Active },
            data: { status: AgreementStatus.Inactive },
          });

          await tx.bill.deleteMany({
            where: { tenantId: tenantId, status: { not: "Paid" } },
          });

          // Mark all per-building tenant statuses as Inactive as well
          await tx.tenantBuildingStatus.updateMany({
            where: { tenantId: tenantId },
            data: { status: TenantStatus.Inactive },
          });

          const tenantRecord = await tx.tenant.findUnique({
            where: { id: tenantId },
          });
          if (tenantRecord && tenantRecord.rentedSpaceId) {
            try {
              await tx.space.update({
                where: { id: tenantRecord.rentedSpaceId },
                data: { isOccupied: false },
              });
            } catch (e) {
              /* ignore */
            }
          }
        });
      }
    } else {
      // Reactivating
      if (scopeBuildingId) {
        await prisma.$transaction(async (tx) => {
          // Re-activate agreements in this building that were set to Inactive
          await tx.agreement.updateMany({
            where: {
              tenantId: tenantId,
              space: { buildingId: scopeBuildingId },
              status: AgreementStatus.Inactive,
            },
            data: { status: AgreementStatus.Active },
          });

          // If tenant's rentedSpace is in this building, mark it occupied
          const tenantRecord = await tx.tenant.findUnique({
            where: { id: tenantId },
          });
          if (tenantRecord && tenantRecord.rentedSpaceId) {
            const spaceRec = await tx.space.findUnique({
              where: { id: tenantRecord.rentedSpaceId },
              select: { buildingId: true },
            });
            if (spaceRec && spaceRec.buildingId === scopeBuildingId) {
              try {
                await tx.space.update({
                  where: { id: tenantRecord.rentedSpaceId },
                  data: { isOccupied: true },
                });
              } catch (e) {
                // ignore
              }
            }
          }
          // Ensure spaces for newly re-activated agreements are marked occupied
          const activeAgreements = await tx.agreement.findMany({
            where: {
              tenantId: tenantId,
              space: { buildingId: scopeBuildingId },
              status: AgreementStatus.Active,
            },
            select: { id: true, spaceId: true },
          });

          for (const ag of activeAgreements) {
            if (ag.spaceId) {
              try {
                await tx.space.update({
                  where: { id: ag.spaceId },
                  data: { isOccupied: true },
                });
              } catch (e) {
                /* ignore individual errors */
              }
            }
          }

          // If tenant.rentedSpaceId is not set, set it to first active agreement's spaceId (if any)
          if (activeAgreements.length > 0) {
            const tenantRec = await tx.tenant.findUnique({
              where: { id: tenantId },
              select: { rentedSpaceId: true },
            });
            if (tenantRec && !tenantRec.rentedSpaceId) {
              const firstSpace = activeAgreements.find(
                (a) => a.spaceId,
              )?.spaceId;
              if (firstSpace) {
                try {
                  await tx.tenant.update({
                    where: { id: tenantId },
                    data: { rentedSpaceId: firstSpace } as any,
                  });
                } catch (e) {
                  /* ignore */
                }
              }
            }
          }
          // Upsert per-building tenant status to Active
          const existingStatus = await tx.tenantBuildingStatus.findFirst({
            where: { tenantId: tenantId, buildingId: scopeBuildingId },
          });
          if (existingStatus) {
            await tx.tenantBuildingStatus.update({
              where: { id: existingStatus.id },
              data: { status: TenantStatus.Active },
            });
          } else {
            await tx.tenantBuildingStatus.create({
              data: {
                tenantId: tenantId,
                buildingId: scopeBuildingId,
                status: TenantStatus.Active,
              },
            });
          }
        });
      } else {
        // Global fallback (existing behavior)
        await prisma.$transaction(async (tx) => {
          await tx.tenant.update({
            where: { id: tenantId },
            data: { status: TenantStatus.Active },
          });

          await tx.agreement.updateMany({
            where: { tenantId: tenantId, status: AgreementStatus.Inactive },
            data: { status: AgreementStatus.Active },
          });

          // Mark all per-building tenant statuses as Active as well
          await tx.tenantBuildingStatus.updateMany({
            where: { tenantId: tenantId },
            data: { status: TenantStatus.Active },
          });

          const tenantRecord = await tx.tenant.findUnique({
            where: { id: tenantId },
          });
          if (tenantRecord && tenantRecord.rentedSpaceId) {
            try {
              await tx.space.update({
                where: { id: tenantRecord.rentedSpaceId },
                data: { isOccupied: true },
              });
            } catch (e) {
              /* ignore */
            }
          }
        });
      }
    }

    revalidatePath("/admin/tenants");
    revalidatePath("/admin/agreements");
    revalidatePath("/admin/billing");

    // Fetch the updated tenant with buildingStatuses and rentedSpace to return to the client
    const updatedTenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      include: { buildingStatuses: true, rentedSpace: true },
    });

    return { success: true, tenant: updatedTenant };
  } catch (error: any) {
    console.error("Error toggling tenant status:", error);
    return {
      success: false,
      error: error.message || "Failed to toggle tenant status.",
    };
  }
}

export async function attachTenantToCurrentUserAction(
  tenantId: string,
): Promise<{ success: boolean; tenant?: any; error?: string }> {
  try {
    const { currentUser, permissions, isSuperAdmin, managedBuildingIds } =
      await getUserAndManagedIds();

    // Require at least tenant:create or tenant:edit permission, or superadmin
    if (
      !isSuperAdmin &&
      !(permissions.has("tenant:create") || permissions.has("tenant:edit"))
    ) {
      return { success: false, error: "Access Denied" };
    }

    // Ensure the user manages at least one building to attach the tenant to
    if (!managedBuildingIds || managedBuildingIds.length === 0) {
      return {
        success: false,
        error: "You do not manage any building to attach this tenant to.",
      };
    }

    const targetBuildingId = managedBuildingIds[0];

    const updated = await databaseService.updateTenant(tenantId, {
      building: { connect: { id: targetBuildingId } },
    } as any);

    revalidatePath("/admin/tenants");
    return { success: true, tenant: updated };
  } catch (error: any) {
    console.error("Error attaching tenant to building:", error);
    return {
      success: false,
      error: error?.message || "Failed to attach tenant.",
    };
  }
}
