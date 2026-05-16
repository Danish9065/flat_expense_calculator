# Feature Inventory

This file documents the current user-facing behavior. Use it as the acceptance checklist when changing only the UI.

## Authentication

### Login

File: `src/pages/Login.tsx`

User can:

- Enter email and password.
- Submit only when both fields are present.
- Navigate to signup.
- Navigate to forgot password.

Behavior:

- Calls `signIn(email, password)` from `AuthContext`.
- Shows success toast on success.
- Shows invalid credentials toast on failure.
- `AuthContext.signIn` stores user, role, access token, and refresh token in `splitmate-user`.
- Admin users are redirected to `/admin`; members are redirected to `/dashboard`.

### Signup

File: `src/pages/Signup.tsx`

User can:

- Enter invite key, full name, email, password, and confirm password.
- Receive invite key from URL query param `?key=...`.
- Toggle password visibility.
- See password strength.
- Submit only when all validation passes.
- Navigate back to login.

Behavior:

- Validates invite key against `invite_keys` where `is_used=false`.
- Rejects expired invite keys.
- Calls `insforge.auth.signUp({ email, password })`.
- Treats "already exists" auth response as non-fatal.
- Navigates to `/verify-otp` with `email`, `fullName`, and `inviteKey` in route state.

### Email OTP Verification

File: `src/pages/auth/VerifyOtp.tsx`

User can:

- Enter a six-digit OTP using six separate inputs.
- Paste a six-digit OTP.
- Resend OTP.

Behavior:

- Redirects to `/signup` if route state has no email.
- Calls `insforge.auth.verifyEmail({ email, otp })`.
- Upserts a member row into `users`.
- Calls RPC `consume_invite_key` with `key_code_param` and `target_user_id`.
- Navigates to `/login` after successful verification.

### Forgot Password

File: `src/pages/ForgotPassword.tsx`

User can:

- Enter email.
- Request reset OTP.
- Return to login.

Behavior:

- Calls `insforge.auth.sendResetPasswordEmail({ email })`.
- Navigates to `/verify-password-otp` with email in route state.

### Password OTP Verification

File: `src/pages/auth/VerifyPasswordOTP.tsx`

User can:

- Enter or paste six-digit OTP.
- Resend reset OTP.
- Return to forgot password.

Behavior:

- Redirects to `/forgot-password` if route state has no email.
- Calls `insforge.auth.exchangeResetPasswordToken({ email, code })`.
- Navigates to `/reset-password` with `resetToken` and `email`.

### Reset Password

File: `src/pages/auth/ResetPassword.tsx`

User can:

- Enter new password and confirmation.
- Toggle visibility for both fields.
- Return to login.

Behavior:

- Redirects to `/forgot-password` if no reset token exists.
- Requires password length of at least 6.
- Requires matching passwords.
- Calls `insforge.auth.resetPassword({ newPassword, otp: resetToken })`.
- Navigates to `/login` after success.

## Navigation And Shell

### Top Navbar

File: `src/components/TopNavbar.tsx`

Visible only when authenticated.

Includes:

- SplitMate logo linking to `/dashboard`.
- Desktop nav links for Dashboard, Balance, Group, Settings, and Admin for admins.
- Notification bell with unread indicator.
- User avatar or initial.
- First name and role on large screens.
- Sign out button.
- Activity drawer trigger.

Behavior:

- Polls unread notifications every 10 seconds.
- Opens `ActivityDrawer`.
- Calls `signOut`.

### Bottom Navigation

File: `src/components/BottomNav.tsx`

Visible only when authenticated and on mobile.

Includes:

- Dashboard
- Balance
- Group
- Settings
- Admin for admins

Behavior:

- Uses current route to show active state.

### Activity Drawer

File: `src/components/ActivityDrawer.tsx`

User can:

- Open live feed from the notification bell.
- View notifications grouped as feed cards.
- See unread styling.
- Delete individual notifications.
- Close drawer by backdrop or close button.

Behavior:

- Polls notifications every 10 seconds.
- Marks unread notifications as read when opened.
- Uses `notifications` table.
- Displays type-specific icons for expense insert/update/delete and settlement events.

## Dashboard

File: `src/pages/Dashboard.tsx`

Purpose: primary expense feed and quick monthly/balance summary.

User can:

- See greeting based on local time.
- See active group name.
- See total expenses this month.
- See exact current user's share this month.
- See net balance, with positive and negative states.
- Filter expenses by category.
- View recent activity.
- Expand an expense card for note and receipt link.
- Edit own expenses.
- Delete own expenses.
- Add a new expense with the floating add button.

Behavior:

- Loads expenses for active group ordered by newest first.
- Loads payer name and split rows.
- Loads current user's balance through `SettlementService.calculateBalance`.
- Calculates current month totals in the client.
- Calculates current user's exact share from `expense_splits`.
- Deletes receipt file from `receipts` bucket before deleting an expense when a receipt URL exists.
- Deletes expense row by id.
- Notifies other clients through `notifyGroupDataChanged(groupId)`.
- Refetches silently on realtime `data-changed`.
- Refetches balance after `settle-complete` event.

Empty/loading states:

- Skeleton cards while loading.
- "No expenses yet" empty state.
- "Updating..." indicator during silent refresh.

## Expense Modal

File: `src/components/ExpenseModal.tsx`

Used by Dashboard for add and edit flows.

User can:

- Enter amount.
- Choose category.
- Enter item name.
- Add an optional note up to 200 characters.
- Upload receipt image.
- Mark expense recurring.
- Choose weekly or monthly recurrence when recurring.
- Select members included in split.
- See equal split preview.
- Save new expense or save changes.
- Close modal.

Behavior:

- On new expense, defaults split members to all group members.
- On edit, populates fields from existing expense and loads splits from `expense_splits`.
- Prevents unselecting the last split member.
- Compresses receipt images before upload.
- Rejects receipt files over 5 MB.
- Uploads receipts to `receipts` bucket.
- Calls `ExpenseService.addExpense` or `ExpenseService.editExpense`.
- Loading states progress through `compressing`, `uploading`, and `saving`.

Important: recurring data is stored as `is_recurring` and `recur_type`, but there is no visible recurring automation engine in the current client code.

## Balances

File: `src/pages/Balance.tsx`

Purpose: chart payments, show category totals, and record settlements.

User can:

- View "Who paid what" donut chart.
- View category breakdown.
- Filter balance data by category.
- View minimized settlement suggestions.
- View full balance breakdown.
- Record a full settlement if they are the creditor.
- Record a partial settlement by changing the payment amount.
- See pending payment text if they are the debtor.

Behavior:

- Loads expenses for the active group and selected category.
- Aggregates payer totals for chart.
- Aggregates category totals for category breakdown.
- Calls `SettlementService.calculateGroupSettlements(groupId, members, category)`.
- Uses the same settlement array for minimized and full breakdown in current implementation.
- Only the creditor (`user.id === s.to`) can open the settle flow.
- Partial payment is detected when entered amount is more than one cent below full amount.
- Full settlements call `SettlementService.settleUp`.
- Partial settlements call `SettlementService.settleUpPartial` with cents.
- On successful settlement, shows toast, publishes realtime event, dispatches `settle-complete`, and refetches.
- Refetches silently on realtime `data-changed`.

Empty/loading states:

- Full-page spinner while initial balance data loads.
- "Join a group first" state when no active group exists.
- "No expenses yet" chart placeholder.
- "All settled up!" settlement empty states.
- "Updating..." indicator during silent refresh.

## Group Management

File: `src/pages/Group.tsx`

User can:

- View current group details.
- Switch active group when they belong to multiple groups.
- Copy invite code.
- Admins can regenerate invite code after typing confirmation word `RESET`.
- View group members and roles.
- Export expenses and settlements to CSV.
- Members can join another group with invite code.
- Admins can create another group.
- Users without a group can join using invite code.

Behavior:

- Member join flow finds group by `invite_code`, upserts current user into `users`, inserts into `group_members`, switches active group, and refreshes state.
- Admin create group flow creates a `groups` row with random `SPLIT-XXXX` invite code, upserts admin user, adds admin to `group_members`, and refreshes groups.
- Regenerate invite code writes a new uppercase random string to `groups.invite_code`.
- CSV export includes expense rows and settlement rows, newest settlements first, then expenses.
- CSV fields: Date, Item, Category, Amount, Paid By, For (Members), Each Share, Note.

CSV export depends on:

- Expenses with joined payer and split rows.
- `settlements` table using `paid_by`, `paid_to`, `amount`, and `settled_at`.
- Member context for resolving names.

## Settings

File: `src/pages/Settings.tsx`

User can:

- Edit full name.
- Upload/replace avatar image.
- Select default currency from INR, USD, EUR, GBP.
- Save profile.
- Sign out.

Behavior:

- Initializes fields from `AuthContext.user`.
- Rejects avatar files over 5 MB.
- Deletes old avatar from `avatars` bucket when old URL points to that bucket.
- Uploads new avatar with `uploadAuto`.
- Updates `users` row with `full_name`, `avatar_url`, and `currency`.
- Attempts `insforge.auth.setProfile` for legacy auth profile metadata.
- Shows success toast and reloads the page after one second to refresh auth context.

Note: current app displays rupee symbols in most expense/balance UI regardless of saved currency. Do not claim full multi-currency display support unless implementing it separately.

## Admin Panel

File: `src/pages/Admin.tsx`

Admin can:

- Generate invite keys.
- Optionally assign invite key to a person's name.
- View invite keys and statuses: active, used, expired.
- See who used a key when joined data is available.
- View all users.
- Delete users except self.
- Wipe all expenses and settlements for active group.

Behavior:

- Non-admin users see Access Denied.
- Invite key generation uses `generateInviteKey()` from `src/utils/invite.ts`.
- New keys are inserted into `invite_keys` with `key_code`, `created_by`, and optional `assigned_to`.
- User deletion deletes from `users`; app comments indicate backend cascade/set-null rules handle related rows.
- Wipe deletes from `expenses` and `settlements` for current `groupId`.

Danger-zone operations use `ConfirmModal`.

## Shared Components

### ConfirmModal

File: `src/components/ConfirmModal.tsx`

Features:

- Backdrop close.
- Close button.
- Cancel and confirm buttons.
- Loading spinner while `onConfirm` runs.
- Optional required typed word to enable confirm.

Current uses:

- Dashboard delete expense.
- Group regenerate invite code with required word `RESET`.
- Admin delete user.
- Admin wipe data.

### Toasts

File: `src/context/ToastContext.tsx`

Types:

- success
- error
- warning
- info

Each toast includes icon, message, close button, and auto-dismisses after 3 seconds.

### ErrorBoundary

File: `src/components/ErrorBoundary.tsx`

Shows a fallback page with error message and Reload App button when React throws.

### InstallPrompt

File: `src/components/InstallPrompt.tsx`

Shows browser PWA install prompt when available and not dismissed. Dismissal is stored as `pwa_dismissed`.

### NotFound

File: `src/pages/NotFound.tsx`

Shows 404 page and links back to `/dashboard`.

## Categories

File: `src/constants/categories.ts`

Categories:

- General
- Home
- Kitchen
- Groceries
- Utilities
- Rent

`CATEGORY_MAP` provides icon and color classes for category display. `CATEGORIES` provides ordered category names for the expense form.

## Notifications

Notifications are shown in the Activity Drawer and counted in the Top Navbar.

Client behavior:

- `TopNavbar` polls unread notification count for current user every 10 seconds.
- `ActivityDrawer` polls full feed every 10 seconds.
- Opening drawer marks unread notifications as read.
- User can delete their own notifications.

Backend expectation from `sql_script.sql`:

- Expense insert/update/delete triggers insert notifications for other group members.
- Settlement trigger is intended to notify creditors, but current SQL column names should be checked against the app's `settlements` schema.

## Realtime Sync

Realtime is used for cross-client refetches, not as the source of truth.

When writing data:

- Dashboard add/edit/delete notifies group members.
- Balance settlement notifies group members.

When listening:

- Dashboard refetches expenses and balance.
- Balance refetches chart, category totals, and settlements.

Also:

- Window focus triggers refetch for subscribed pages.

## Storage

Receipts:

- Uploaded from `ExpenseModal`.
- Compressed before upload.
- Stored in `receipts` bucket.
- Deleted when the owning expense is deleted and `receipt_url` exists.

Avatars:

- Uploaded from `Settings`.
- Stored in `avatars` bucket.
- Old avatar is deleted when replacing and old URL includes `/avatars/`.

## Local Storage Keys

Do not rename these in UI-only work:

- `splitmate-user`: cached auth/session data.
- `activeGroupId`: active group selection.
- `pwa_dismissed`: PWA install prompt dismissal.

## Window Events

Do not rename these in UI-only work:

- `auth:logout`: clears auth state globally.
- `settle-complete`: Dashboard refreshes balance after Balance settlement.

## Known Current Constraints

- Currency setting is saved but most displays still hardcode rupee symbols.
- Recurring expenses are stored but no scheduling or recurring creation engine appears in the client.
- Activity feed polling says "real-time" in text, but it uses 10-second polling for notifications.
- `Balance.tsx` labels one section "Full Balance Breakdown", but currently both minimized and full sections use the same calculated settlement list.
- `sql_script.sql` settlement notification trigger may be out of sync with app settlement column names.

