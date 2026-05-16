# UI Redesign Guide

Goal: redesign the UI while keeping every feature, data flow, and code behavior the same.

## Non-Negotiables

Do not change:

- Routes in `src/App.tsx`.
- Provider order: `AuthProvider`, `GroupProvider`, then `ToastProvider`.
- Context public APIs.
- Service function names and behavior.
- Database table names, column names, bucket names, RPC names, and query semantics.
- `splitmate-user`, `activeGroupId`, and `pwa_dismissed` localStorage keys.
- `auth:logout` and `settle-complete` window events.
- Realtime channel format `group-data:{groupId}` and event `data-changed`.
- Form submit behavior, disabled states, validation rules, and loading states.
- The fact that only expense owners can edit/delete expenses.
- The fact that only creditors can confirm settlements.
- The split math that assigns remainder cents to the payer.
- Tailwind CSS 3.4. Do not upgrade to Tailwind v4.

## Safe UI-Only Change Areas

You can safely restyle:

- Layout spacing and responsive grid structure.
- Colors, shadows, borders, typography scale, and component density.
- Icons, as long as actions remain recognizable and accessible.
- Empty states and loading states, while preserving when they appear.
- Card composition for dashboard expense items.
- Balance chart container and settlement cards.
- Auth form visual design.
- Navigation visual treatment.
- Toast and modal presentation.
- Drawer animation and feed card styling.
- PWA install prompt look.

You can move markup around inside a component, but preserve the state, handlers, and conditionals that drive behavior.

## Suggested Visual Direction

This app is a daily-use flat expense calculator. A good redesign should feel:

- Fast and utility-first.
- Mobile-native, because expense entry is likely done from a phone.
- Clear about money owed vs money receivable.
- Calm enough for repeated use.
- Dense enough that users can scan expenses and balances quickly.

Recommended design style:

- Use a restrained, finance-friendly palette with clear semantic color.
- Reserve strong color for actions, balances, and status.
- Prefer compact list rows over oversized marketing-like cards.
- Keep add-expense prominent and reachable on mobile.
- Make settlement actions obvious but not alarming.
- Use consistent surfaces for forms, drawers, and modals.
- Keep INR/money values visually aligned and easy to compare.

Avoid:

- Removing labels from forms without accessible alternatives.
- Hiding critical actions behind unclear gestures.
- Making the first screen a landing page.
- Decorative UI that reduces scan speed.
- Changing route-level workflows during a visual redesign.
- Changing data logic inside service files when only UI is requested.

## Page-by-Page UI Requirements

### Login

Must keep:

- Email field.
- Password field.
- Forgot password link.
- Signup link.
- Disabled submit when missing email/password.
- Spinner while loading.

UI opportunity:

- Create a cleaner auth shell shared visually with signup and reset pages.
- Improve field hierarchy and mobile vertical rhythm.

### Signup

Must keep:

- Invite key field.
- Full name field.
- Email field.
- Password and confirm password fields.
- Password visibility toggle for password field.
- Password strength indicator.
- Password mismatch feedback.
- Disabled submit until `isFormValid`.
- Login link.

UI opportunity:

- Make invite key feel important, not like a secondary field.
- Compact the password strength UI so the form stays mobile-friendly.

### OTP Screens

Must keep:

- Six one-character inputs.
- Numeric-only input.
- Auto-advance.
- Backspace focus behavior.
- Paste handling.
- Resend action.
- Redirect behavior when route state is missing.

UI opportunity:

- Use one consistent OTP component style across email verification and password reset.

### Dashboard

Must keep:

- Greeting and active group name.
- Total This Month.
- Your share.
- Net Balance with positive/negative language.
- Category filter including All Expenses and every category in `CATEGORY_MAP`.
- Loading skeleton.
- Empty state.
- Updating indicator.
- Expense cards with expand/collapse.
- Paid by / for whom text.
- Date/time display.
- Amount display.
- Note display.
- Receipt link when present.
- Edit/delete only for owner.
- Floating add button when `groupId` exists.
- Expense modal and delete confirmation modal.

UI opportunity:

- Make the summary row clearer by using two compact metric panels.
- Make expenses more scannable by aligning icon, title, payer/split text, and amount.
- Consider a sticky category filter on mobile if it improves use.

### Expense Modal

Must keep:

- Bottom-sheet feel on mobile is acceptable, but modal must remain usable on desktop.
- Amount input with decimal support.
- Category select.
- Item name field.
- Optional note with 200 character max display.
- Receipt upload accepting JPEG/PNG/WebP.
- 5 MB rejection.
- Recurring toggle.
- Weekly/monthly choice when recurring.
- Split member checkboxes.
- At least one split member.
- Equal split preview.
- Loading messages: Compressing, Uploading, Saving.

UI opportunity:

- Group fields into sections: amount, details, receipt, recurrence, split.
- Make split member rows easier to tap.
- Show selected member count clearly.

### Balance

Must keep:

- Initial spinner.
- No-group state.
- Updating indicator.
- Donut chart with tooltip and legend.
- Category breakdown.
- Category filter.
- Minimized settlement section.
- Full balance breakdown section.
- Empty settled-up states.
- Avatar/name/amount layout.
- Settle button only for creditor.
- Pending payment text for debtor.
- Inline payment amount editor.
- Cancel and Confirm Payment buttons.
- Partial/full payment hints.
- Validation: amount >= 1 and <= full amount.

UI opportunity:

- Make the chart and category totals feel like analytics, but keep them compact.
- Make "How to Settle Up" the most actionable section.
- Visually distinguish "you owe" from "owed to you".

### Group

Must keep:

- No-group member join flow.
- Group switcher for multiple groups.
- Invite code display.
- Copy invite code.
- Admin-only reset invite code.
- Members list with avatar/initial, name, email/id fallback, and role badge.
- CSV export.
- Member-only Join Another Group form.
- Admin-only Create Another Group form.
- Confirm word `RESET` for invite reset.

UI opportunity:

- Make invite code easy to read and copy.
- Use a more compact members list for larger households.
- Put risky reset action visually below primary copy action.

### Settings

Must keep:

- Full name input.
- Avatar upload.
- Currency select.
- Save Profile button.
- Sign Out button.
- File size limit.
- Page reload after successful profile save.

UI opportunity:

- Add avatar preview if doing so without changing upload behavior.
- Separate destructive/logout action from profile form.

### Admin

Must keep:

- Access denied state for non-admins.
- Generate invite key action.
- Optional "assign to" input.
- Loading state.
- Empty invite key state.
- Key status badges for active, used, expired.
- Used by / assigned to details.
- Users list.
- Delete user except current user.
- Danger zone for wiping active group data.
- Confirm modals for user delete and data wipe.

UI opportunity:

- Make Invite Keys, Manage Users, and Danger Zone clearly separate.
- Improve status readability for keys.
- Keep Danger Zone visually serious and clearly separated.

### Navigation

Must keep:

- Top navbar hidden when unauthenticated.
- Bottom nav hidden when unauthenticated.
- Admin link only for admin users.
- Activity drawer from notification bell.
- Unread notification indicator.
- Sign out action in top navbar.
- Active route styling.

UI opportunity:

- Make mobile top bar less crowded.
- Use icon buttons with labels where helpful.

### Activity Drawer

Must keep:

- Backdrop close.
- Feed polling.
- Mark read on open.
- Delete notification.
- Empty feed state.
- Type-specific status styling.
- Relative time text.
- Group name display when available.

UI opportunity:

- Make notification cards more readable and less visually noisy.
- Keep unread state obvious.

### Toasts And Modals

Must keep:

- Toast auto-dismiss.
- Toast manual close.
- Success/error/warning/info variants.
- Confirm modal typed-word option.
- Loading disabled state in ConfirmModal.
- Backdrop click behavior.

UI opportunity:

- Use consistent surface tokens for modal/drawer/toast.
- Make destructive confirm actions unmistakable.

## Data Logic To Preserve During UI Refactor

### Expense Add/Edit Flow

1. Form collects fields.
2. Receipt image compresses if present.
3. Receipt uploads to `receipts`.
4. `ExpenseService.addExpense` or `ExpenseService.editExpense` writes expense.
5. Split rows are created/recreated.
6. Dashboard refetches.
7. Realtime `data-changed` is published.

### Expense Delete Flow

1. User opens confirm modal.
2. If receipt exists, delete file from `receipts`.
3. Delete expense row.
4. Show success toast.
5. Publish realtime `data-changed`.
6. Refetch dashboard data.

### Settlement Flow

1. Creditor opens settle editor.
2. Amount defaults to full amount.
3. User may enter partial amount.
4. Full amount calls `settleUp`.
5. Partial amount calls `settleUpPartial`.
6. App shows toast.
7. Closes editor.
8. Publishes realtime `data-changed`.
9. Dispatches `settle-complete`.
10. Refetches balance data.

### Group Join/Create Flow

Join:

1. User enters invite code.
2. App finds group by invite code.
3. App upserts current user.
4. App inserts group membership.
5. App switches active group.

Create:

1. Admin enters group name.
2. App creates group with invite code.
3. App upserts admin user.
4. App inserts admin membership.
5. App refreshes groups.

### Auth Session Flow

1. Cached session is read from `splitmate-user`.
2. Token is set before app finishes loading.
3. Expired token is refreshed using refresh token.
4. User profile and role are reloaded from `users`.
5. Failed non-fatal network refresh keeps session dormant.
6. Dead refresh token logs user out.

## Suggested Redesign Work Plan

1. Create or refine reusable visual primitives only if they reduce duplication without changing behavior.
2. Restyle shell navigation and global surfaces first.
3. Restyle auth pages as a consistent family.
4. Restyle Dashboard and ExpenseModal together, since they share the core expense flow.
5. Restyle Balance and settlement cards.
6. Restyle Group, Settings, and Admin.
7. Restyle ActivityDrawer, Toasts, ConfirmModal, ErrorBoundary, NotFound, and InstallPrompt.
8. Run `npm run build`.
9. Manually verify every acceptance item in this guide.

## Manual QA Checklist

Authentication:

- Login works for member and admin.
- Invalid login shows error toast.
- Signup requires invite key.
- Signup redirects to OTP.
- OTP accepts paste.
- Forgot password OTP flow reaches reset page.
- Reset password validates matching fields.
- Logout clears session and returns to login.

Dashboard:

- Expenses load for active group.
- Category filters work.
- Add expense creates split rows.
- Receipt upload works.
- Edit expense preserves/recalculates splits.
- Delete expense removes row and receipt when present.
- Only owner sees edit/delete.
- Realtime refetch indicator appears without breaking list.

Balance:

- Chart renders with expenses.
- Category filter changes chart and settlements.
- Creditor can settle full amount.
- Creditor can record partial payment.
- Debtor cannot confirm settlement.
- `settle-complete` refreshes Dashboard balance.

Group:

- Copy invite code works.
- Group switcher changes active group.
- Member can join another group.
- Admin can create another group.
- Admin can regenerate invite code only after typing `RESET`.
- CSV export downloads with expense and settlement rows.

Settings:

- Name saves.
- Avatar upload saves and reloads.
- Oversized avatar file shows error.
- Currency saves.

Admin:

- Non-admin cannot access.
- Admin generates invite key.
- Admin can delete another user.
- Admin cannot delete self from the UI.
- Admin can wipe group data after confirmation.

PWA and global UI:

- Install prompt can be dismissed.
- ErrorBoundary fallback still reloads app.
- Activity drawer marks notifications read.
- Toasts appear and dismiss.

## Implementation Notes For Future Agents

- If editing InsForge integration code, fetch current InsForge docs first as required by `AGENTS.md`.
- For UI-only edits, documentation fetch is not necessary unless backend SDK calls are changed.
- Prefer keeping handler names and JSX conditionals recognizable to reduce regression risk.
- When extracting components, pass existing handlers down rather than rewriting logic.
- Keep `id` attributes on settlement buttons/inputs if tests or browser automation might target them:
  - `settle-btn-minimized-{from}__{to}`
  - `settle-btn-full-{from}__{to}`
  - `partial-input-{from}__{to}`
  - `cancel-settle-{from}__{to}`
  - `confirm-settle-{from}__{to}`
  - `pwa-install-btn`
  - `pwa-dismiss-btn`

