# Project Structure

This project is a React 19 + TypeScript + Vite expense sharing app named SplitMate. It uses Tailwind CSS 3.4, React Router, InsForge for backend services, Recharts for charts, lucide-react for icons, and browser-image-compression for receipt uploads.

Important rule for future UI work: change presentation only. Keep the routes, context values, service functions, database table usage, storage buckets, localStorage keys, event names, and user workflows unchanged unless a separate feature task explicitly asks for logic changes.

## Root Files

| Path | Purpose |
| --- | --- |
| `package.json` | Project scripts and dependencies. Tailwind is locked to v3.4.15 and should not be upgraded to v4. |
| `vite.config.ts` | Vite config with React plugin and root base path. |
| `tailwind.config.js` | Tailwind design tokens: `primary`, `success`, `danger`, `warning`, `background`, `card`, and Inter font. |
| `src/index.css` | Tailwind imports plus base body background/text styling. |
| `index.html` | Vite HTML entry. |
| `env.example` | Environment variable example file. |
| `vercel.json` | Deployment configuration. |
| `public/manifest.json` | PWA manifest for SplitMate. |
| `public/sw.js` | Service worker with network-first HTML caching and cache-first asset caching. Excludes InsForge/API requests. |
| `sql_script.sql` | SQL for notifications and database triggers. Note: the settlement trigger appears to reference `from_user_id`/`to_user_id`, while app code writes `paid_by`/`paid_to`; verify before applying it to a backend. |
| `test_*.js` / `recover_admin.mjs` | Local backend/test/debug helper scripts. |
| `AGENTS.md` | Project instructions for InsForge work. |

## Source Layout

```text
src/
  App.tsx
  main.tsx
  index.css
  components/
    ActivityDrawer.tsx
    BottomNav.tsx
    ConfirmModal.tsx
    ErrorBoundary.tsx
    ExpenseModal.tsx
    InstallPrompt.tsx
    TopNavbar.tsx
  constants/
    categories.ts
  context/
    AuthContext.jsx
    AuthContext.d.ts
    GroupContext.tsx
    ToastContext.tsx
  hooks/
    useBalance.ts
    useRealtimeSync.ts
  lib/
    db.ts
    insforge.ts
  pages/
    Admin.tsx
    Balance.tsx
    Dashboard.tsx
    ForgotPassword.tsx
    Group.tsx
    Login.tsx
    NotFound.tsx
    Settings.tsx
    Signup.tsx
    auth/
      ResetPassword.tsx
      VerifyOtp.tsx
      VerifyPasswordOTP.tsx
  services/
    expenseService.ts
    settlementService.ts
  utils/
    invite.ts
```

## Routing

Routes are defined in `src/App.tsx`.

| Route | Access | Component | Notes |
| --- | --- | --- | --- |
| `/` | Public | Redirect | Redirects to `/login`. |
| `/login` | Public | `Login` | Public auth route. Navbar offset is removed. |
| `/signup` | Public | `Signup` | Public auth route with invite key. |
| `/verify-otp` | Public | `VerifyOtp` | Email verification after signup. |
| `/forgot-password` | Public | `ForgotPassword` | Starts reset password OTP flow. |
| `/verify-password-otp` | Public | `VerifyPasswordOTP` | Verifies reset OTP and passes reset token. |
| `/reset-password` | Public | `ResetPassword` | Sets new password. |
| `/dashboard` | Protected | `Dashboard` | Expense feed and user summary. |
| `/balance` | Protected | `Balance` | Charts, category totals, settlements. |
| `/group` | Protected | `Group` | Invite code, members, group switch, CSV export. |
| `/settings` | Protected | `Settings` | Profile, avatar, currency, logout. |
| `/admin` | Protected admin-only | `Admin` | Invite keys, user management, data wipe. |
| `*` | Public fallback | `NotFound` | 404 page. |

`ProtectedRoute` waits for `AuthContext.loading` before redirecting. Preserve this behavior so page reloads with a cached session do not bounce users to login.

## Providers And Global Layout

`App.tsx` wraps the app in:

1. `ErrorBoundary`
2. `BrowserRouter`
3. `AuthProvider`
4. `GroupProvider`
5. `ToastProvider`

The global app shell includes:

- `TopNavbar` for authenticated desktop/mobile top controls.
- `BottomNav` for authenticated mobile tab navigation.
- `InstallPrompt` for PWA installation.
- A padded main area: top padding for fixed navbar and bottom padding for mobile nav.

Do not remove these wrappers during UI redesign. Many pages assume `useAuth`, `useGroup`, and `useToast` are available.

## Data And Backend Modules

### `src/lib/db.ts`

Creates the InsForge client using:

- `VITE_INSFORGE_URL`
- `VITE_INSFORGE_ANON_KEY`

Exports:

- `setAuthToken(token)`
- `dbQuery(table, params)`
- `dbInsert(table, body)`
- `dbUpdate(table, params, body)`
- `dbDelete(table, params)`
- default `insforge`

The helper layer parses PostgREST-like query strings and maps them to SDK calls. It also handles access token refresh, queues concurrent refresh subscribers, updates `splitmate-user` in localStorage, and dispatches `auth:logout` only when refresh is truly rejected.

Preserve:

- `splitmate-user` localStorage key.
- `auth:logout` window event.
- Refresh endpoint: `/api/auth/refresh?client_type=mobile`.
- Query helper behavior and return shapes.

### `src/lib/insforge.ts`

Re-exports the database client/helpers from `db.ts`. Keep this compatibility file if imports still reference it.

## Contexts

### `AuthContext.jsx`

Responsibilities:

- Optimistically loads cached user session from `localStorage.getItem('splitmate-user')`.
- Sets InsForge auth token synchronously when cached token exists.
- Silently refreshes expired JWTs on boot.
- Fetches fresh user profile fields from `users`.
- Provides `user`, `role`, `loading`, `signIn`, and `signOut`.
- Redirects successful login to `/admin` for admins or `/dashboard` for members.
- Clears cache/storage on `auth:logout`.

Do not change the provider API without updating every consumer.

### `GroupContext.tsx`

Responsibilities:

- Loads all groups for the current user from `group_members` and `groups`.
- Stores active group id in `localStorage` as `activeGroupId`.
- Falls back to the first available group when saved group is missing.
- Loads members for the active group.
- Provides `groupId`, `groupName`, `inviteCode`, `currentGroup`, `groups`, `switchGroup`, `members`, `fetchMembers`, and `refreshGroup`.

Preserve active group persistence. A UI redesign can change the group switcher display but must keep `switchGroup(newId)` wired.

### `ToastContext.tsx`

Provides `success`, `error`, `warning`, `info`, and `addToast`. Toasts auto-dismiss after 3 seconds and render globally.

UI can restyle the toast container and cards, but keep the context methods and message semantics.

## Hooks

### `useRealtimeSync(groupId, onDataChanged)`

Subscribes to an InsForge realtime channel named `group-data:{groupId}` and listens for `data-changed`. Also refetches when the browser window regains focus.

### `notifyGroupDataChanged(groupId)`

Publishes `data-changed` to `group-data:{groupId}` after writes.

Preserve channel names and event names, because Dashboard and Balance rely on them.

### `useBalance(groupId, userId, category)`

Calculates `totalPaid - totalOwed` using `expenses` and unsettled `expense_splits`. It is currently not the primary balance mechanism on the main pages, but should remain available.

## Services

### `ExpenseService`

Located at `src/services/expenseService.ts`.

Key behavior:

- `getExpenses(groupId)` loads expenses with payer names and expense split rows.
- `addExpense(expenseData)` inserts into `expenses`, then creates one `expense_splits` row per split member.
- `editExpense(expenseId, updates)` updates the expense and recalculates splits when amount or split membership changes.
- Split amounts are calculated in integer cents to avoid floating point drift.
- Remainder cents are assigned to the payer.
- If no split members are supplied, all group members are used.

Do not replace split math with display-only calculations. Balances depend on persisted `expense_splits`.

### `SettlementService`

Located at `src/services/settlementService.ts`.

Key behavior:

- `calculateBalance(groupId, userId)` computes a user's net balance from expenses, splits, and settlements.
- `settleUp(groupId, debtorId, creditorId, amount)` records a full settlement.
- `settleUpPartial(groupId, debtorId, creditorId, partialAmountCents)` records a partial settlement.
- `calculateGroupSettlements(groupId, members, categoryFilter)` computes minimized debtor-to-creditor transactions from net balances.
- `_minimizeNetBalances(net)` sorts creditors/debtors and produces minimum settlement transactions.
- Settlement rows use `paid_by`, `paid_to`, `amount`, `settled_at`, and `is_partial`.

Do not turn settlements into edits on expenses/splits. The app expects settlement history as separate rows.

## Styling System

The app currently uses utility-first Tailwind classes directly in components.

Current theme tokens:

- `primary`: `#6C63FF`
- `success`: `#22C55E`
- `danger`: `#EF4444`
- `warning`: `#F59E0B`
- `background`: `#F8F7FF`
- `card`: `#FFFFFF`
- `fontFamily.sans`: `Inter, sans-serif`

Dark mode is configured with `darkMode: 'class'`, and many components already include `dark:` classes. There is no visible dark mode toggle in the current UI.

## PWA Behavior

`InstallPrompt` listens for `beforeinstallprompt`, stores dismissal in `localStorage` as `pwa_dismissed`, and calls the browser install prompt when accepted.

`public/sw.js`:

- Uses cache name `splitmate-cache-v3`.
- Caches `/` and `/index.html` on install.
- Cleans old caches on activation.
- Excludes InsForge/API requests from caching.
- Uses network-first for navigation/HTML.
- Uses cache-first for static assets.

## Backend Tables Used By The App

Inferred from code:

- `users`: `id`, `email`, `full_name`, `role`, `avatar_url`, `currency`, `created_at`
- `groups`: `id`, `name`, `invite_code`, `created_by`
- `group_members`: `group_id`, `user_id`
- `invite_keys`: `id`, `key_code`, `created_by`, `assigned_to`, `is_used`, `used_by`, `expires_at`, `created_at`
- `expenses`: `id`, `group_id`, `category`, `item_name`, `amount`, `added_by`, `note`, `receipt_url`, `is_recurring`, `recur_type`, `created_at`, `updated_at`
- `expense_splits`: `expense_id`, `user_id`, `amount_owed`, `is_settled`
- `settlements`: `group_id`, `paid_by`, `paid_to`, `amount`, `settled_at`, `is_partial`
- `notifications`: `id`, `user_id`, `group_id`, `actor_id`, `type`, `message`, `is_read`, `created_at`

Storage buckets used:

- `receipts`
- `avatars`

RPC used:

- `consume_invite_key`

