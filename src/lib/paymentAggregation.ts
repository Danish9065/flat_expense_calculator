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
 * Combines the existing per-group settlement output for display and payment.
 * It intentionally does not net opposite directions or modify the underlying
 * group calculation, so every rupee remains traceable to its original group.
 */
export function aggregateUserPayments(sources: GroupSettlementSource[], userId: string) {
  const buckets = new Map<string, ConsolidatedPayment>();

  for (const source of sources) {
    for (const settlement of source.settlements) {
      if (settlement.amount <= 0 || (settlement.from !== userId && settlement.to !== userId)) continue;

      const direction = settlement.from === userId ? 'pay' : 'receive';
      const counterpartyId = direction === 'pay' ? settlement.to : settlement.from;
      const key = `${direction}:${counterpartyId}`;
      const allocation: PaymentAllocation = {
        groupId: source.groupId,
        groupName: source.groupName,
        debtorId: settlement.from,
        creditorId: settlement.to,
        amount: Math.round(settlement.amount * 100) / 100,
      };

      const existing = buckets.get(key);
      if (existing) {
        existing.allocations.push(allocation);
        existing.total = Math.round((existing.total + allocation.amount) * 100) / 100;
      } else {
        buckets.set(key, { key, direction, counterpartyId, total: allocation.amount, allocations: [allocation] });
      }
    }
  }

  return Array.from(buckets.values())
    .map((payment) => ({
      ...payment,
      allocations: [...payment.allocations].sort((a, b) => b.amount - a.amount),
    }))
    .sort((a, b) => {
      if (a.direction !== b.direction) return a.direction === 'pay' ? -1 : 1;
      return b.total - a.total;
    });
}
