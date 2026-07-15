// This file defines shared data structures, especially for client-side representations
// where Date objects from Prisma are typically serialized to strings (ISO format).

export interface PenaltyTier {
  id?: string;
  fromDay: number;
  toDay?: number | null;
  penaltyType: "Fixed" | "Percentage";
  feeValue: number;
  scope: "Building" | "Floor" | "SpecificSpaces";
  applicableFloor?: string | null;
  applicableSpaceIdNames?: string[] | null;
  buildingId?: string;
  frequency: "OneTime" | "Daily";
}

export interface Building {
  id: string;
  name: string;
  address?: string | null;
  status: "Active" | "Inactive"; // Added status
  penaltyPolicyTiers: PenaltyTier[];
  createdAt: string; // ISO Date String
  updatedAt?: string | null; // ISO Date String
  spaces?: Space[];
  buildingMonthlyUtilities?: BuildingMonthlyUtilities[];
}

export interface Space {
  id: string;
  buildingId: string;
  buildingName: string;
  spaceIdName: string;
  area: number;
  floor: string;
  utilityProrationShare: number;
  monthlyRentalPrice: number;
  isOccupied: boolean;
  tenantId?: string | null;
  createdAt: string; // ISO Date String
  updatedAt?: string | null; // ISO Date String
  tenant?: Tenant | null;
  building?: Building;
  agreements?: Agreement[];
}

export interface Tenant {
  id: string;
  name: string;
  email: string;
  phone?: string | null;
  alternativePhone?: string | null;
  nationalId?: string | null;
  representativeName?: string | null;
  representativePhone?: string | null;
  rentedSpaceId?: string | null;
  createdAt: string; // ISO Date String
  updatedAt?: string | null; // ISO Date String
  rentedSpace?: Space | null;
  agreements?: Agreement[];
  bills?: Bill[];
}

export interface Agreement {
  id: string;
  tenantId: string;
  spaceId: string;
  agreementText: string;
  startDate: string; // ISO Date String
  monthlyRentalPrice: number;
  additionalTerms?: string | null;
  createdAt: string; // ISO Date String
  updatedAt?: string | null; // ISO Date String
  paymentTermMonths: number;
  initialPaymentMonths: number;
  nextPaymentDueDate: string; // ISO Date String
  status: "Active" | "Canceled";

  initialPaymentAmount?: number | null;
  initialPaymentMethod?: string | null;
  initialPaymentReference?: string | null;
  initialPaymentBankOrWalletName?: string | null;
  initialPaymentDate?: string | null; // ISO Date String
  endDate?: string | null; // ISO Date String (calculated if needed)

  tenant?: Tenant; // Optional on base type, usually included where needed
  space?: Space; // Optional on base type, usually included where needed
  bills?: Bill[];
}

export interface UtilityBreakdownItem {
  id?: string; // Present if from DB
  name: string;
  amount: number;
  billId?: string;
}

export interface BuildingUtilityItem {
  id?: string;
  name: string;
  totalCost: number;
  appliesToScope: "Building" | "Floor" | "SpecificSpaces";
  applicableFloor?: string | null;
  applicableSpaceIdNames?: string[] | null;
  monthlyUtilitiesId?: string | null;
}

export interface BuildingMonthlyUtilities {
  id: string;
  buildingId: string;
  buildingName: string;
  year: number;
  month: number;
  utilities: BuildingUtilityItem[];
  createdAt: string; // ISO Date String
  updatedAt?: string | null; // ISO Date String
  building?: Building;
}

export interface Bill {
  id: string;
  agreementId: string;
  tenantId: string;
  billDate: string; // ISO Date String
  dueDate: string; // ISO Date String
  rentAmount: number;
  utilityBreakdown: UtilityBreakdownItem[];
  penaltyAmount?: number | null;
  totalAmount: number;
  status: "Pending" | "Paid" | "Overdue" | "PendingVerification";
  paymentDate?: string | null; // ISO Date String
  paymentMethod?: string | null;
  paymentReference?: string | null;
  bankOrWalletName?: string | null;
  paymentProofUrl?: string | null;
  paymentProofDataUri?: string | null; // For tenant uploads
  adminVerifiedPayment?: boolean | null;
  tenantPaymentNotes?: string | null;
  adminVerificationNotes?: string | null;
  createdAt: string; // ISO Date String
  updatedAt?: string | null; // ISO Date String

  agreement?: Agreement; // Optional on base type, usually included where needed
}

// --- RBAC Types ---
export interface UserRole {
  id: string;
  name: string;
  permissions: string[];
}

export interface CurrentUser {
  id: string;
  email: string;
  name: string;
  firstName?: string | null;
  lastName?: string | null;
  phoneNumber?: string | null;
  nibBranch?: string | null;
  roles: UserRole[];
  // Calculated effective permissions from all assigned roles
  effectivePermissions: string[];
  managedBuildingIds?: string[];
  canSeeSuperAdminRoles?: boolean;
  canAssignBuildings?: boolean;
  showAllBuildings?: boolean;
  showAllUsers?: boolean;
  status?: "Active" | "Inactive";
}

// Defines a single permission
export interface PermissionItem {
  id: string; // e.g., "building:view"
  label: string; // e.g., "View"
}

// Defines a resource and its associated permissions
export interface ResourcePermissionGroup {
  resourceId: string; // e.g., "building"
  resourceLabel: string; // e.g., "Buildings"
  permissions: PermissionItem[]; // Array of specific permissions for this resource
}

// New structured permissions list
export const ALL_RESOURCE_PERMISSIONS: ResourcePermissionGroup[] = [
  {
    resourceId: "dashboard",
    resourceLabel: "Dashboard",
    permissions: [{ id: "dashboard:view", label: "View" }],
  },
  {
    resourceId: "building",
    resourceLabel: "Buildings",
    permissions: [
      { id: "building:view", label: "View" },
      { id: "building:export", label: "Export" },
      { id: "building:create", label: "Create" },
      { id: "building:approve", label: "Approve" },
      { id: "building:edit", label: "Edit" },
      { id: "building:status", label: "Change Status" },
    ],
  },
  {
    resourceId: "space",
    resourceLabel: "Spaces",
    permissions: [
      { id: "space:view", label: "View" },
      { id: "space:create", label: "Create" },
      { id: "space:edit", label: "Edit" },
      { id: "space:delete", label: "Delete" },
    ],
  },
  {
    resourceId: "tenant",
    resourceLabel: "Tenants",
    permissions: [
      { id: "tenant:view", label: "View" },
      { id: "tenant:create", label: "Create" },
      { id: "tenant:edit", label: "Edit" },
      { id: "tenant:status", label: "Change Status" },
    ],
  },
  {
    resourceId: "agreement",
    resourceLabel: "Agreements",
    permissions: [
      { id: "agreement:view", label: "View" },
      { id: "agreement:create", label: "Create" },
      { id: "agreement:edit", label: "Edit" },
      { id: "agreement:cancel", label: "Cancel" },
      { id: "agreement:download", label: "Download" },
    ],
  },
  {
    resourceId: "building_utility",
    resourceLabel: "Building Utilities",
    permissions: [
      { id: "building_utility:view", label: "View" },
      { id: "building_utility:create", label: "Create" },
      { id: "building_utility:approve", label: "Approve" },
      { id: "building_utility:edit", label: "Edit" },
      { id: "building_utility:delete", label: "Delete" },
    ],
  },
  {
    resourceId: "billing",
    resourceLabel: "Billing",
    permissions: [
      { id: "billing:view", label: "View" },
      { id: "billing:generate", label: "Generate" },
      { id: "billing:manage_payments", label: "Manage Payments" },
    ],
  },
  {
    resourceId: "payment_overview",
    resourceLabel: "Payments Overview",
    permissions: [{ id: "payment_overview:view", label: "View" }],
  },
  {
    resourceId: "audit",
    resourceLabel: "Audit Log",
    permissions: [{ id: "audit:view", label: "View" }],
  },
  {
    resourceId: "settings:user_registration",
    resourceLabel: "Settings: User Registration",
    permissions: [{ id: "settings:user_registration:manage", label: "Manage" }],
  },
  {
    resourceId: "settings:user_management",
    resourceLabel: "Settings: User Management",
    permissions: [
      { id: "settings:user_management:view", label: "View" },
      {
        id: "settings:user_management:assign",
        label: "Assign Roles/Buildings",
      },
    ],
  },
  {
    resourceId: "settings:role_management",
    resourceLabel: "Settings: Role Management",
    permissions: [
      { id: "settings:role_management:view", label: "View" },
      { id: "settings:role_management:manage", label: "Manage" },
    ],
  },
  {
    resourceId: "settings:application_settings",
    resourceLabel: "Settings: Bill Date Configuration",
    permissions: [
      { id: "settings:application_settings:manage", label: "Manage" },
    ],
  },
  {
    resourceId: "settings:agreement_templates",
    resourceLabel: "Settings: Agreement Templates",
    permissions: [
      { id: "settings:agreement_templates:manage", label: "Manage" },
    ],
  },
  {
    resourceId: "import",
    resourceLabel: "Data Import",
    permissions: [{ id: "import:manage", label: "Manage" }],
  },
  {
    resourceId: "portal",
    resourceLabel: "Tenant Portal",
    permissions: [{ id: "portal:view", label: "View Tenant Portal" }],
  },
];

// Flattened list for convenience
export const AVAILABLE_PERMISSIONS: PermissionItem[] =
  ALL_RESOURCE_PERMISSIONS.flatMap((group) => group.permissions);
export type PermissionId = (typeof AVAILABLE_PERMISSIONS)[number]["id"];
