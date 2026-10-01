# Calculation contract

- All payment actions use `SettlementService.calculateGroupSettlements`, the same minimized plan as `getCalculationExplanation().suggestedPayments`. Payment Center aggregates this plan without netting opposite directions across different groups.
- Direct debts remain available for reference only. Never offer payment confirmation on both direct and simplified lists.
- Member net = expense spending minus assigned shares plus payments made minus payments received. Amounts are calculated in integer paise.
- Every expense must match its own assigned shares. Duplicate shares and incomplete ledgers block recommended payments; a zero group checksum alone is insufficient.
- Read all ledger pages with stable ordering and exact counts. Failed reads must show unavailable/retry, never “settled.”
- Monthly spending uses saved entry dates in Asia/Kolkata. The dashboard month selector changes spending and personal share only; net balance and payment plans include all dates. Category filters are not month filters and exclude unallocated group payments.
- Confirmations recheck current amounts and prevent concurrent writes in the same client. Existing database RLS and the batch RPC continue to authorize recipients and group membership. This client guard is not a cross-device transaction lock; database-level idempotency would be a separate schema change.
- No historical shares or settlements are rewritten by this release. Existing legacy remainder allocations are respected.

## Verification

`npm run build` runs TypeScript, every test, and the production bundle. GitHub checks also run lint. Regression coverage includes opposite split errors, duplicate shares, pagination above 1,000 rows, page failures, IST month boundaries, group isolation, previous payments, stale confirmations and consistency across dashboard/report/payment service.

Before a calculation change, independently reconcile saved rows and compare the same date scope and settlement plan. A fixture passing is not proof of current production data.
