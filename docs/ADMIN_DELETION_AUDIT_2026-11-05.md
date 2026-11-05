# Admin deletion audit — 5 November 2026

## Cause of the screenshot error

The error text, `Former member expense amounts and shares are read-only`, comes from `private.protect_expense_history` in migration `20261104075039_preserve_former_member_ledgers.sql`. Before this fix, the trigger rejected DELETE whenever the expense payer or any assigned participant was no longer an active member of that expense's group. That check also applied to administrators. It explains the reported Kitchen group reset failure; membership in another group does not make someone an active member of Kitchen.

A second trigger independently blocks deletion of settlements involving former members. Merely fixing expense deletion would therefore leave the reset broken for groups with former-member payments.

The old admin reset performed two independent HTTP requests: expenses first, settlements second. If the second failed after the first committed, the group could retain payments with no matching expenses. The original first-request failure is atomic within that request, but the two-request reset is not atomic overall.

This investigation reproduced the behavior using synthetic records and the actual migrations. It did not query the live Kitchen group's private financial records or replay the failed operation against production.

## Implemented changes

- Added versioned migration `20261105172557_atomic_admin_group_reset.sql`.
- Added `reset_group_expenses(group_id)`: requires a database-backed administrator role, validates the group, acquires the group transaction lock, and deletes its settlements and expenses in one transaction. Shares cascade through expense IDs. A failure rolls back the entire operation.
- Added `delete_group_expense(group_id, expense_id)`: requires authentication, keeps caller row-level security active, matches both IDs, and rejects missing, mismatched, or unauthorized targets instead of silently reporting success.
- Administrators can explicitly delete former-member expenses and settlements. Amount edits, payer changes, share redistribution, standalone removal of frozen shares, and new former-member charges remain protected.
- Both new API functions use SECURITY INVOKER, an empty search path, explicit schema names, and explicit authenticated-only EXECUTE grants. No service key or client-controlled protection bypass was added. Existing RLS remains in force.
- The admin reset now uses one RPC and sends a group refresh notification after success. Confirmation names and captures the selected group, and requires RESET.
- Admins can access single-expense deletion even when the payer differs or former members are involved. The original server error is shown on failure.
- Removed the obsolete account-delete control. It directly deleted a shared public user profile, did not delete the Supabase Auth identity, and conflicted with the history-preservation design. The legacy complete-deletion RPC was already disabled. Group removal remains available and preserves historical financial records.
- Member removal verifies that exactly one membership was removed and refuses confirmation if the selected group changed.
- Single and bulk expense deletion retain private receipt objects. An object may be referenced by another expense; automatically deleting it could break another group's receipt.
- Updated the historical migration tests to apply only migrations older than the migration being tested, so future migrations cannot accidentally run before their prerequisites.

## Balance and group isolation behavior

| Action | Selected group | Other groups containing the same people |
| --- | --- | --- |
| Delete one expense | Removes that expense and its shares; recalculates balances; preserves actual recorded payments | Records, memberships, payments and calculated balances unchanged |
| Reset group expenses | Removes all expenses, shares and recorded settlements; balances become zero | Records, memberships, payments and calculated balances unchanged |
| Remove a member | Revokes membership; retains the person's name, expenses, shares and payments | Membership and financial history remain unchanged |
| Delete account | No longer offered by the admin UI | Shared identity is preserved |

Single deletion does not undo an actual payment. Example: A paid a ₹100 expense split equally with B, and B already paid A ₹20. Removing the expense leaves A owing B a ₹20 refund. This is correct accounting. For a former participant, the refund remains historical/read-only under the existing former-member policy. A full group reset intentionally removes both the charges and recorded payments, so no residual balance remains.

The combined Payment Center can change because the deleted group's contribution has changed. That is expected; the other group's own ledger and balance do not change. Category-filtered explanations continue to show expense shares before payments; the All view includes recorded payments.

## Verification

`npm run build` passed: TypeScript checking, all **110 tests**, and the Vite production build. `npm run lint` and `git diff --check` also passed. Ten new regression tests were added (seven database tests and three service tests).

Database tests execute the real SQL migrations, triggers, grants and RLS using PGlite PostgreSQL with minimal Supabase Auth/Storage infrastructure fixtures. New scenarios include:

- Admin reset with former-member expenses and payments, plus the same users in another group.
- Exact preservation of the other group's expenses, shares, payments, active/former memberships and calculated ledger.
- Zero balances and no remaining payment suggestions after reset.
- Preservation of user profiles and private storage objects during reset.
- Anonymous, non-admin owner, regular member and outsider reset denial.
- Null/missing group rejection and repeat reset of an empty group.
- Injected failure after an earlier expense deletion, proving expenses, shares and already-deleted payments all roll back.
- Single admin deletion with former shares; preserved recorded payments and correct refund balance.
- Wrong-group, missing-expense, anonymous and unauthorized single-delete rejection.
- Continued protection of former-member amounts and standalone shares.
- Active owner's single-expense deletion with cascading shares and preserved payments.
- Client calls one group-scoped reset RPC; single deletion supplies both IDs; database errors propagate without automatic destructive retries.

Existing tests also cover invitation/role boundaries, membership archival and rejoining, disabled account-deletion RPC, storage access control, settlement amount validation, combined payments, stale confirmations, pagination, paise rounding, former-member balance separation and balance checksum validation.

## Limits and rollout

- These changes are local and have not been deployed. No production data was deleted or changed.
- Apply the migration before deploying the updated frontend; the new UI depends on the new RPCs. Review live migration state, trigger definitions and RLS using read-only queries before deployment, as required by AGENTS.md.
- Live admin/browser deletion and concurrent multi-connection behavior were not exercised. Transaction failure, authorization, and group isolation were verified locally; group advisory-lock behavior was reviewed in SQL.
- `supabase db advisors --local --type security --level warn` could not run: CLI 2.84.2 rejects the existing configuration key `local_smtp` before connecting. No advisor success is claimed, and unrelated configuration was left unchanged.
- Vite reported a large bundle warning; the build succeeded. Bundle splitting is outside this deletion fix.

The implementation follows the official [Supabase database function guidance](https://supabase.com/docs/guides/database/functions) on caller privileges, search paths and function grants, and [Supabase RLS documentation](https://supabase.com/docs/guides/database/postgres/row-level-security). The current [breaking-change index](https://supabase.com/changelog?types=breaking-change) was also reviewed.
