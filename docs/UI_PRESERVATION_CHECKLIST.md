# UI Preservation Checklist

Use this as a quick "do not break" checklist before and after a UI-only redesign.

## Keep These Files Logic-Stable

Avoid logic edits in these files unless the task explicitly asks for behavior changes:

- `src/lib/db.ts`
- `src/context/AuthContext.jsx`
- `src/context/GroupContext.tsx`
- `src/services/expenseService.ts`
- `src/services/settlementService.ts`
- `src/hooks/useRealtimeSync.ts`
- `src/utils/invite.ts`

UI edits are most appropriate in:

- `src/pages/*`
- `src/pages/auth/*`
- `src/components/*`
- `src/index.css`
- `tailwind.config.js`

Even in UI files, preserve handlers and state transitions.

## Public APIs To Preserve

### Auth Context

Must continue exposing:

- `user`
- `role`
- `loading`
- `signIn(email, password)`
- `signOut()`

### Group Context

Must continue exposing:

- `groupId`
- `groupName`
- `inviteCode`
- `currentGroup`
- `groups`
- `switchGroup(newId)`
- `members`
- `fetchMembers(gId)`
- `refreshGroup()`

### Toast Context

Must continue exposing:

- `addToast(message, type)`
- `success(message)`
- `error(message)`
- `warning(message)`
- `info(message)`

### Expense Service

Must continue exposing:

- `getExpenses(groupId)`
- `addExpense(expenseData)`
- `editExpense(expenseId, updates)`

### Settlement Service

Must continue exposing:

- `calculateBalance(groupId, userId)`
- `settleUp(groupId, debtorId, creditorId, amount)`
- `settleUpPartial(groupId, debtorId, creditorId, partialAmountCents)`
- `calculateGroupSettlements(groupId, members, categoryFilter)`
- `calculateMinimizedSettlements(rawNetBalances)`

## Form Behavior To Preserve

### Login

- Submit prevents default.
- Disabled unless email and password exist.
- Shows spinner while loading.
- Failed login resets loading.

### Signup

- Invite key uppercases on input.
- Password strength updates live.
- Password must be at least 6 characters for form validity.
- Confirm password must match.
- Submit disabled until valid.

### OTP Inputs

- Numeric-only characters.
- One digit per field.
- Auto-focus next on entry.
- Backspace focuses previous empty input.
- Six-digit paste fills fields.

### Expense Modal

- Amount requires minimum `0.01` and step `0.01`.
- Note max length is `200`.
- Receipt accepts `image/jpeg`, `image/png`, and `image/webp`.
- File over 5 MB shows error and clears input.
- At least one split member must remain selected.
- Submit disabled while loading or missing amount/description.

### Settlement Editor

- Amount accepts up to two decimals.
- Minimum valid amount is `1`.
- Maximum valid amount is full owed amount.
- Partial/full hint updates from entered amount.
- Confirm disabled while invalid or settling.

### Settings

- Avatar accepts `image/jpeg`, `image/png`, and `image/webp`.
- File over 5 MB shows error and clears input.
- Save reloads page after success.

## Conditions To Preserve

- Navbar and bottom nav render only when `user` exists.
- Admin nav item renders only when `role === 'admin'`.
- Admin page denies access when `role !== 'admin'`.
- Expense edit/delete controls render only when current user added the expense.
- Add expense floating button renders only when `groupId` exists.
- Group reset invite button renders only for admins.
- Join Another Group section renders only for non-admins.
- Create Another Group section renders only for admins.
- Settlement button renders only for creditor.
- Pending payment text renders for debtor.
- Current user cannot delete themselves in Admin UI.

## Identifiers And Strings To Preserve

LocalStorage:

- `splitmate-user`
- `activeGroupId`
- `pwa_dismissed`

Window events:

- `auth:logout`
- `settle-complete`

Realtime:

- Channel: `group-data:{groupId}`
- Event: `data-changed`

Storage buckets:

- `receipts`
- `avatars`

RPC:

- `consume_invite_key`

Settlement element ids:

- `settle-btn-minimized-{from}__{to}`
- `settle-btn-full-{from}__{to}`
- `partial-input-{from}__{to}`
- `cancel-settle-{from}__{to}`
- `confirm-settle-{from}__{to}`

PWA element ids:

- `pwa-install-btn`
- `pwa-dismiss-btn`

## Visual QA

Check at mobile and desktop widths:

- Auth cards do not overflow.
- OTP six inputs fit on small phones.
- Dashboard summary cards fit amounts without overlap.
- Category tabs scroll horizontally.
- Expense cards keep amount visible.
- Expanded expense details do not hide edit/delete actions.
- Floating add button does not cover bottom nav.
- Expense modal scrolls within viewport.
- Split member rows are tappable.
- Balance chart is visible and not clipped.
- Settlement cards fit two avatars, arrow, amount, and action.
- Inline payment editor fits inside settlement card.
- Group invite code does not overflow.
- Member email/id truncates properly.
- Admin invite key row fits status badge.
- Toasts do not cover essential mobile navigation for too long.
- Activity drawer covers full screen on mobile and right side on desktop.

## Build And Smoke Test

Run:

```bash
npm run build
```

Then manually smoke test:

1. Log in.
2. Switch group if multiple groups exist.
3. Add expense with all members.
4. Add expense with selected members only.
5. Edit amount and split members.
6. Delete expense.
7. Record partial settlement.
8. Record full settlement.
9. Export CSV.
10. Update profile.
11. Open activity drawer.
12. Sign out.

