export interface GroupSettlementSource {
  groupId: string;
  groupName: string;
  settlements: Array<{ from: string; to: string; amount: number }>;
}

export interface PaymentAllocation {
  groupId: string;
  groupName: string;
  debtorId: string;
  creditorId: string;
  amount: number;
}

export interface ConsolidatedPayment {
  key: string;
  direction: 'pay' | 'receive';
  counterpartyId: string;
  total: number;
  allocations: PaymentAllocation[];
}

/**
 * Combines direct per-person balances across groups for display and payment.
 * Opposite directions remain separate so each source group can be confirmed
 * accurately without inventing a cross-group settlement record.
 */
export function aggregateUserPayments(sources: GroupSettlementSource[], userId: string) {
  const buckets = new Map<string, ConsolidatedPayment & { totalCents: number }>();

  for (const source of sources) {
    for (const settlement of source.settlements) {
      if (
        settlement.from === settlement.to ||
        settlement.amount <= 0 ||
        (settlement.from !== userId && settlement.to !== userId)
      ) continue;

      const direction = settlement.from === userId ? 'pay' : 'receive';
      const counterpartyId = direction === 'pay' ? settlement.to : settlement.from;
      const key = `${direction}:${counterpartyId}`;
      const amountCents = Math.round(settlement.amount * 100);
      if (!Number.isSafeInteger(amountCents) || amountCents <= 0) continue;
      const allocation: PaymentAllocation = {
        groupId: source.groupId,
        groupName: source.groupName,
        debtorId: settlement.from,
        creditorId: settlement.to,
        amount: amountCents / 100,
      };

      const existing = buckets.get(key);
      if (existing) {
        existing.allocations.push(allocation);
        existing.totalCents += amountCents;
        existing.total = existing.totalCents / 100;
      } else {
        buckets.set(key, {
          key,
          direction,
          counterpartyId,
          total: allocation.amount,
          totalCents: amountCents,
          allocations: [allocation],
        });
      }
    }
  }

  return Array.from(buckets.values())
    .map((payment) => ({
      key: payment.key,
      direction: payment.direction,
      counterpartyId: payment.counterpartyId,
      total: payment.total,
      allocations: [...payment.allocations].sort((a, b) => b.amount - a.amount),
    }))
    .sort((a, b) => {
      if (a.direction !== b.direction) return a.direction === 'pay' ? -1 : 1;
      return b.total - a.total;
    });
}
