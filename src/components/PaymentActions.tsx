import { useState } from 'react';
import { CheckCircle2, Copy, ExternalLink, MessageCircle, Smartphone } from 'lucide-react';
import {
  buildUpiPaymentUri,
  buildWhatsAppReminderUrl,
  isValidUpiId,
  normalizeUpiId,
} from '../lib/paymentLinks';

interface PaymentActionsProps {
  amount: number;
  groupName: string;
  debtorName: string;
  debtorWhatsApp?: string | null;
  creditorName: string;
  creditorUpiId?: string | null;
  isDebtor: boolean;
  isCreditor: boolean;
  onInfo: (message: string) => void;
  onError: (message: string) => void;
}

const isMobileDevice = () => /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

export default function PaymentActions({
  amount,
  groupName,
  debtorName,
  debtorWhatsApp,
  creditorName,
  creditorUpiId,
  isDebtor,
  isCreditor,
  onInfo,
  onError,
}: PaymentActionsProps) {
  const [paymentOpened, setPaymentOpened] = useState(false);

  const openWhatsAppReminder = () => {
    const url = buildWhatsAppReminderUrl({
      amount,
      creditorName,
      debtorName,
      groupName,
      whatsappNumber: debtorWhatsApp,
      upiId: creditorUpiId,
      appUrl: `${window.location.origin}/balance`,
    });
    window.open(url, '_blank', 'noopener,noreferrer');
    if (!debtorWhatsApp) {
      onInfo(`${debtorName} has not added a WhatsApp number yet. Choose their chat in WhatsApp to share the reminder.`);
    }
  };

  const openUpiPayment = async () => {
    if (!creditorUpiId || !isValidUpiId(creditorUpiId)) {
      onError(`${creditorName} needs to add a valid UPI ID in Me before you can pay.`);
      return;
    }

    if (!isMobileDevice()) {
      try {
        await navigator.clipboard.writeText(normalizeUpiId(creditorUpiId));
        onInfo(`UPI ID copied. Open your UPI app and pay ₹${amount.toFixed(2)} to ${creditorName}.`);
      } catch {
        onError(`Pay ₹${amount.toFixed(2)} to ${normalizeUpiId(creditorUpiId)} in your UPI app.`);
      }
      return;
    }

    const uri = buildUpiPaymentUri({ amount, payeeName: creditorName, upiId: creditorUpiId, groupName });
    setPaymentOpened(true);
    window.location.assign(uri);
  };

  if (!isDebtor && !isCreditor) return null;

  return (
    <div className="mt-4 border-t border-white/10 pt-3">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {isCreditor ? (
          <button
            type="button"
            onClick={openWhatsAppReminder}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-[#25D366]/30 bg-[#25D366]/10 px-3 py-2 text-xs font-bold text-[#6ee7a0] transition-colors hover:bg-[#25D366]/20 focus:outline-none focus:ring-2 focus:ring-[#25D366]/60"
            aria-label={`Remind ${debtorName} on WhatsApp`}
          >
            <MessageCircle className="h-4 w-4" />
            Remind on WhatsApp
            <ExternalLink className="h-3.5 w-3.5 opacity-70" />
          </button>
        ) : null}

        {isDebtor ? (
          <button
            type="button"
            onClick={openUpiPayment}
            className="accent-button inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-3 py-2 text-xs font-bold focus:outline-none focus:ring-2 focus:ring-primary"
            aria-label={`Pay ${creditorName} via UPI`}
          >
            {isMobileDevice() ? <Smartphone className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            {isMobileDevice() ? 'Pay via any UPI app' : 'Copy UPI ID'}
          </button>
        ) : null}
      </div>

      {isDebtor && !creditorUpiId ? (
        <p className="mt-2 text-center text-[11px] leading-relaxed text-amber-300/90">
          {creditorName} has not added a UPI ID yet.
        </p>
      ) : null}

      {paymentOpened ? (
        <div className="mt-3 flex items-start gap-2 rounded-xl bg-emerald-500/10 p-3 text-[11px] leading-relaxed text-emerald-200" role="status">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          <span>After authorizing payment in your UPI app, return here. {creditorName} must confirm receipt before the balance changes.</span>
        </div>
      ) : null}
    </div>
  );
}
