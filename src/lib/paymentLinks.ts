const UPI_ID_PATTERN = /^[A-Z0-9._-]{2,256}@[A-Z0-9.-]{2,64}$/i;
const WHATSAPP_NUMBER_PATTERN = /^[1-9][0-9]{7,14}$/;

export interface PaymentReminderInput {
  amount: number;
  creditorName: string;
  debtorName: string;
  groupName: string;
  whatsappNumber?: string | null;
  upiId?: string | null;
  appUrl?: string;
}

export interface UpiPaymentInput {
  amount: number;
  payeeName: string;
  upiId: string;
  groupName: string;
  reference?: string;
}

export function normalizeWhatsAppNumber(value: string) {
  const trimmed = value.trim();
  const withoutInternationalPrefix = trimmed.startsWith('00') ? trimmed.slice(2) : trimmed;
  const digits = withoutInternationalPrefix.replace(/\D/g, '');
  return WHATSAPP_NUMBER_PATTERN.test(digits) ? digits : null;
}

export function isValidWhatsAppNumber(value: string) {
  return normalizeWhatsAppNumber(value) !== null;
}

export function normalizeUpiId(value: string) {
  return value.trim().toLowerCase();
}

export function isValidUpiId(value: string) {
  const normalized = normalizeUpiId(value);
  return normalized.length <= 320 && UPI_ID_PATTERN.test(normalized);
}

function formatAmount(amount: number) {
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('Payment amount must be greater than zero');
  return amount.toFixed(2);
}

export function buildUpiPaymentUri(input: UpiPaymentInput) {
  const upiId = normalizeUpiId(input.upiId);
  if (!isValidUpiId(upiId)) throw new Error('A valid payee UPI ID is required');

  const params = new URLSearchParams({
    pa: upiId,
    pn: input.payeeName.trim() || 'SplitMate member',
    am: formatAmount(input.amount),
    cu: 'INR',
    tn: `SplitMate settlement for ${input.groupName.trim() || 'shared expenses'}`,
    tr: (input.reference || Date.now().toString()).replace(/\D/g, '').slice(0, 35),
  });

  return `upi://pay?${params.toString()}`;
}

export function buildPaymentReminderMessage(input: PaymentReminderInput) {
  const amount = formatAmount(input.amount);
  const group = input.groupName.trim() || 'our shared expenses';
  const lines = [
    `Hi ${input.debtorName.trim() || 'there'},`,
    '',
    `This is a friendly SplitMate reminder that ₹${amount} is pending to ${input.creditorName.trim() || 'a group member'} for ${group}.`,
  ];

  if (input.upiId && isValidUpiId(input.upiId)) {
    lines.push(`UPI ID: ${normalizeUpiId(input.upiId)}`);
  }
  if (input.appUrl) lines.push(`View the balance: ${input.appUrl}`);
  lines.push('', 'Please ignore this reminder if you have already paid. Thank you!');
  return lines.join('\n');
}

export function buildWhatsAppReminderUrl(input: PaymentReminderInput) {
  const number = input.whatsappNumber ? normalizeWhatsAppNumber(input.whatsappNumber) : null;
  const path = number ? `/${number}` : '/';
  const params = new URLSearchParams({ text: buildPaymentReminderMessage(input) });
  return `https://wa.me${path}?${params.toString()}`;
}
