# WhatsApp reminders and UPI payment handoff

## User flow

- New users may provide an optional WhatsApp number and UPI ID during sign-up.
- Existing users manage both values in **Me**.
- A person who is owed money can open a prefilled WhatsApp reminder addressed to the debtor.
- A person who owes money can open the creditor's UPI payment request with payee, amount, note, and INR prefilled.
- On desktop, where a UPI app usually cannot handle the intent, the creditor's UPI ID is copied instead.
- Opening a UPI app does not create a settlement. The existing creditor confirmation flow remains responsible for recording receipt.
- The Payment Center combines amounts owed to the same person across every group and keeps an expandable group-by-group allocation.
- A creditor can confirm a combined receipt once; the database records its source-group settlements atomically.

## Privacy model

Payment identifiers live in `user_payment_profiles`, not the general `users` row. Row-level security allows a user to manage their own record and allows reads only when the viewer and profile owner share an expense group. WhatsApp numbers are normalized to international digits-only form. UPI IDs are normalized to lowercase. The application never requests or stores a UPI PIN.

## Deployment order

1. Apply [`migrations/20260819_add_payment_profiles.sql`](../migrations/20260819_add_payment_profiles.sql) to the InsForge/Postgres database.
2. Apply [`migrations/20260819_add_bulk_settlement_rpc.sql`](../migrations/20260819_add_bulk_settlement_rpc.sql).
3. Deploy the frontend branch.
4. Test with two accounts across at least two groups: add a UPI ID to the creditor, add a WhatsApp number to the debtor, and verify combined payment and confirmation from Payment Center.

The frontend gracefully keeps ordinary group and balance screens working if the migration has not yet been applied, but payment-profile saving will remain unavailable until it is installed.

## Technical constraints

The UPI handoff uses the generic `upi://pay` URI with `pa`, `pn`, `am`, `cu`, `tn`, and a numeric `tr`. UPI authorization and transaction status happen in the selected UPI application. A browser redirect is not proof that a bank transfer succeeded, so SplitMate intentionally does not auto-settle on launch.

WhatsApp uses a `wa.me` click-to-chat URL with an encoded, editable reminder. When the debtor has not supplied a number, WhatsApp opens its share/chat chooser rather than exposing or guessing a phone number.

## Research references

- [NPCI UPI deep-linking parameter guidance](https://www.npci.org.in/PDF/npci/upi/circular/2017/Circular18_BankCompliances_to_enbaleUPIMerchantecosystem_0.pdf)
- [Google Pay generic UPI intent implementation](https://developers.google.com/pay/india/api/android/in-app-payments)
- [NPCI UPI product and safety information](https://www.npci.org.in/product/upi)
