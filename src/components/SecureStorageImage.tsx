import { useEffect, useState, type ImgHTMLAttributes } from 'react';
import { getSignedStorageUrl } from '../lib/storage';

interface SecureStorageImageProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'> {
  source?: string | null;
  fallback?: string;
}

export default function SecureStorageImage({ source, fallback, ...props }: SecureStorageImageProps) {
  const [resolved, setResolved] = useState<{ source: string; url: string } | null>(null);

  useEffect(() => {
    let active = true;
    if (!source) return () => { active = false; };
    void getSignedStorageUrl(source)
      .then((url) => { if (active) setResolved({ source, url }); })
      .catch(() => { if (active) setResolved({ source, url: fallback || '' }); });
    return () => { active = false; };
  }, [fallback, source]);

  const resolvedSource = source && resolved?.source === source ? resolved.url : fallback || '';
  if (!resolvedSource) return null;
  return <img {...props} src={resolvedSource} />;
}
