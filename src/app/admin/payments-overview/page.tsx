export const dynamic = "force-dynamic";

import React, { Suspense } from "react"; // React is needed for Suspense
import { Loader2 } from "lucide-react";
import type { Space as SpacePrisma } from "@prisma/client";
import {
  getPaymentsOverviewDataAction,
  type PaymentsOverviewAgreement,
  type PaymentsOverviewData,
  type PaymentsOverviewBill,
} from "./actions";
import {
  PaymentsOverviewClientPage,
  type ClientBill,
  type ClientSpaceForPotentialRevenue,
  type ClientPenaltyTier,
  type ClientBuilding,
  type ClientSpaceForAgreement,
  type ClientTenant,
  type ClientAgreementForBill,
  type ClientUtilityBreakdownItem,
} from "./client-page"; // Import client page and its types

const EPOCH_ISO_STRING = new Date(0).toISOString();

// Helper function to serialize a single bill with deep relations
const serializeAgreement = (
  agreement: PaymentsOverviewAgreement | null | undefined,
): ClientAgreementForBill => {
  const tenant = agreement?.tenant;
  const space = agreement?.space;
  const building = space?.building;

  return agreement
    ? {
        ...agreement,
        monthlyRentalPrice: Number(agreement.monthlyRentalPrice),
        initialPaymentAmount: agreement.initialPaymentAmount
          ? Number(agreement.initialPaymentAmount)
          : null,
        createdAt: agreement.createdAt?.toISOString() || EPOCH_ISO_STRING,
        updatedAt:
          agreement.updatedAt?.toISOString() ||
          agreement.createdAt?.toISOString() ||
          EPOCH_ISO_STRING,
        startDate: agreement.startDate?.toISOString() || EPOCH_ISO_STRING,
        nextPaymentDueDate:
          agreement.nextPaymentDueDate?.toISOString() || EPOCH_ISO_STRING,
        initialPaymentDate: agreement.initialPaymentDate?.toISOString() || null,
        endDate: agreement.endDate?.toISOString() || null,
        tenant: tenant
          ? {
              ...tenant,
              createdAt: tenant.createdAt?.toISOString() || EPOCH_ISO_STRING,
              updatedAt:
                tenant.updatedAt?.toISOString() ||
                tenant.createdAt?.toISOString() ||
                EPOCH_ISO_STRING,
            }
          : ({} as ClientTenant),
        space: space
          ? {
              ...space,
              area: Number(space.area),
              utilityProrationShare: Number(space.utilityProrationShare),
              monthlyRentalPrice: Number(space.monthlyRentalPrice),
              createdAt: space.createdAt?.toISOString() || EPOCH_ISO_STRING,
              updatedAt:
                space.updatedAt?.toISOString() ||
                space.createdAt?.toISOString() ||
                EPOCH_ISO_STRING,
              building: building
                ? {
                    ...building,
                    createdAt:
                      building.createdAt?.toISOString() || EPOCH_ISO_STRING,
                    updatedAt:
                      building.updatedAt?.toISOString() ||
                      building.createdAt?.toISOString() ||
                      EPOCH_ISO_STRING,
                    penaltyPolicyTiers:
                      building.penaltyPolicyTiers?.map((pt) => ({
                        ...pt,
                        feeValue: Number(pt.feeValue),
                      })) || [],
                  }
                : ({} as ClientBuilding),
            }
          : ({} as ClientSpaceForAgreement),
      }
    : ({} as ClientAgreementForBill);
};

const derivePenaltyAmount = (
  bill: PaymentsOverviewBill,
  utilityBreakdown: ClientUtilityBreakdownItem[],
) => {
  const explicitPenalty =
    bill.penaltyAmount !== null && bill.penaltyAmount !== undefined
      ? Number(bill.penaltyAmount)
      : null;
  if (explicitPenalty !== null && explicitPenalty > 0) {
    return explicitPenalty;
  }

  const utilityTotal = utilityBreakdown.reduce(
    (sum, item) => sum + Number(item.amount),
    0,
  );
  const computedPenalty =
    Number(bill.totalAmount) - Number(bill.rentAmount) - utilityTotal;
  return computedPenalty > 0 ? parseFloat(computedPenalty.toFixed(2)) : 0;
};

const serializeBill = (bill: PaymentsOverviewBill): ClientBill => {
  const agreement = bill.agreement;
  const tenant = agreement?.tenant;
  const space = agreement?.space;
  const building = space?.building;

  const utilityBreakdown =
    bill.utilityBreakdown?.map((ub) => ({
      ...ub,
      amount: Number(ub.amount),
    })) || [];

  return {
    ...bill,
    rentAmount: Number(bill.rentAmount),
    penaltyAmount:
      derivePenaltyAmount(bill, utilityBreakdown) > 0
        ? derivePenaltyAmount(bill, utilityBreakdown)
        : null,
    totalAmount: Number(bill.totalAmount),
    createdAt: bill.createdAt?.toISOString() || EPOCH_ISO_STRING,
    updatedAt:
      bill.updatedAt?.toISOString() ||
      bill.createdAt?.toISOString() ||
      EPOCH_ISO_STRING,
    billDate: bill.billDate?.toISOString() || EPOCH_ISO_STRING,
    dueDate: bill.dueDate?.toISOString() || EPOCH_ISO_STRING,
    paymentDate: bill.paymentDate?.toISOString() || null,
    agreement: serializeAgreement(agreement),
    utilityBreakdown: utilityBreakdown,
  };
};

// Helper function to serialize a single space
const serializeSpace = (space: SpacePrisma): ClientSpaceForPotentialRevenue => {
  return {
    ...space,
    area: Number(space.area),
    utilityProrationShare: Number(space.utilityProrationShare),
    monthlyRentalPrice: Number(space.monthlyRentalPrice),
    createdAt: space.createdAt?.toISOString() || EPOCH_ISO_STRING,
    updatedAt:
      space.updatedAt?.toISOString() ||
      space.createdAt?.toISOString() ||
      EPOCH_ISO_STRING,
  };
};

async function PaymentsOverviewDataFetcher() {
  const data: PaymentsOverviewData = await getPaymentsOverviewDataAction();

  const serializedBills: ClientBill[] = data.bills.map(serializeBill);
  const serializedSpaces: ClientSpaceForPotentialRevenue[] =
    data.spaces.map(serializeSpace);
  const serializedAgreements: ClientAgreementForBill[] =
    data.agreements.map(serializeAgreement);

  return (
    <PaymentsOverviewClientPage
      initialBills={serializedBills}
      initialSpaces={serializedSpaces}
      initialAgreements={serializedAgreements}
    />
  );
}

export default function PaymentsOverviewServerPage() {
  return (
    <Suspense
      fallback={
        <div className="flex justify-center items-center h-screen">
          <Loader2 className="h-12 w-12 animate-spin text-primary" />
        </div>
      }
    >
      <PaymentsOverviewDataFetcher />
    </Suspense>
  );
}
