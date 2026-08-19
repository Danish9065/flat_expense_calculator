import { useState, type MouseEvent } from 'react';
import { ArrowUpRight, Loader2 } from 'lucide-react';
import { getSignedStorageUrl } from '../lib/storage';
import { useToast } from '../context/ToastContext';

export default function SecureStorageLink({ reference }: { reference: string }) {
  const [loading, setLoading] = useState(false);
  const { error: showError } = useToast();

  const handleOpen = async (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    setLoading(true);
    try {
      const url = await getSignedStorageUrl(reference, 300);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (error) {
      console.error('Unable to open the private attachment', error);
      showError('Unable to open this attachment. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <button type="button" onClick={handleOpen} disabled={loading} className="text-sm text-primary hover:underline flex items-center w-fit disabled:opacity-60">
      {loading ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
      View Attachment <ArrowUpRight className="w-3 h-3 ml-1" />
    </button>
  );
}
