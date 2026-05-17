import { useEffect, useState } from 'react';
import { Bell, Download, Smartphone, X, Zap } from 'lucide-react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const DISMISSED_KEY = 'pwa_dismissed';

export default function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Don't show if already running as installed PWA
    if (window.matchMedia('(display-mode: standalone)').matches) return;

    // Don't show if user previously dismissed
    if (localStorage.getItem(DISMISSED_KEY)) return;

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setVisible(true);
    };

    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted' || outcome === 'dismissed') {
      localStorage.setItem(DISMISSED_KEY, 'true');
    }
    setDeferredPrompt(null);
    setVisible(false);
  };

  const handleDismiss = () => {
    localStorage.setItem(DISMISSED_KEY, 'true');
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={handleDismiss}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.72)',
          backdropFilter: 'blur(10px)',
          zIndex: 9998,
          animation: 'ip-fade-in 0.25s ease',
        }}
      />

      {/* Modal Card */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Install SplitMate"
        style={{
          position: 'fixed',
          bottom: '24px',
          left: '50%',
          transform: 'translateX(-50%)',
          width: 'min(420px, calc(100vw - 32px))',
          background: 'linear-gradient(160deg, #141414 0%, #0D0D0D 52%, #080808 100%)',
          border: '1px solid rgba(255,255,255,0.10)',
          borderRadius: '20px',
          padding: '30px 24px 24px',
          boxShadow: '0 28px 80px rgba(0,0,0,0.55), 0 18px 45px rgba(255,86,86,0.10)',
          zIndex: 9999,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '12px',
          animation: 'ip-slide-up 0.35s cubic-bezier(0.34,1.56,0.64,1)',
          fontFamily: 'Inter, sans-serif',
        }}
      >
        {/* Close button */}
        <button
          onClick={handleDismiss}
          aria-label="Close install prompt"
          style={{
            position: 'absolute',
            top: '14px',
            right: '14px',
            background: 'rgba(255,255,255,0.05)',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: '50%',
            width: '32px',
            height: '32px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            color: '#A3A3A3',
            transition: 'background 0.2s',
          }}
          onMouseEnter={e => {
            e.currentTarget.style.background = 'rgba(255,86,86,0.14)';
            e.currentTarget.style.color = '#FFFFFF';
          }}
          onMouseLeave={e => {
            e.currentTarget.style.background = 'rgba(255,255,255,0.05)';
            e.currentTarget.style.color = '#A3A3A3';
          }}
        >
          <X size={16} strokeWidth={2.4} />
        </button>

        {/* App Icon */}
        <div
          style={{
            width: '72px',
            height: '72px',
            borderRadius: '20px',
            background: 'linear-gradient(135deg, #1E1E1E 0%, #080808 100%)',
            border: '1px solid rgba(255,86,86,0.34)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 16px 40px rgba(255,86,86,0.18)',
            marginBottom: '4px',
          }}
        >
          <img
            src="/icon-192.png"
            alt="SplitMate"
            style={{ width: '54px', height: '54px', borderRadius: '14px', objectFit: 'cover' }}
            onError={e => {
              (e.currentTarget as HTMLImageElement).style.display = 'none';
              const parent = e.currentTarget.parentElement;
              if (parent) {
                const span = document.createElement('span');
                span.textContent = 'SM';
                span.style.fontSize = '18px';
                span.style.fontWeight = '700';
                span.style.color = '#FF5656';
                parent.appendChild(span);
              }
            }}
          />
        </div>

        {/* Text */}
        <div style={{ textAlign: 'center' }}>
          <h2
            style={{
              margin: 0,
              fontSize: '20px',
              fontWeight: 600,
              color: '#FFFFFF',
              letterSpacing: '0',
            }}
          >
            Install SplitMate
          </h2>
          <p
            style={{
              margin: '6px 0 0',
              fontSize: '14px',
              color: '#A3A3A3',
              fontWeight: 400,
            }}
          >
            Use offline anytime — fast, lightweight&nbsp;&amp;&nbsp;always ready.
          </p>
        </div>

        {/* Feature pills */}
        <div
          style={{
            display: 'flex',
            gap: '8px',
            flexWrap: 'wrap',
            justifyContent: 'center',
            margin: '4px 0',
          }}
        >
          {[
            { label: 'Works offline', icon: Zap },
            { label: 'Home screen', icon: Smartphone },
            { label: 'Notifications', icon: Bell },
          ].map(({ label, icon: Icon }) => (
            <span
              key={label}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
                background: 'rgba(255,255,255,0.05)',
                color: '#D4D4D4',
                border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: '100px',
                padding: '5px 10px',
                fontSize: '12px',
                fontWeight: 500,
              }}
            >
              <Icon size={13} color="#FF5656" />
              {label}
            </span>
          ))}
        </div>

        {/* Install button */}
        <button
          id="pwa-install-btn"
          onClick={handleInstall}
          style={{
            width: '100%',
            padding: '14px',
            background: '#FF5656',
            color: '#fff',
            border: 'none',
            borderRadius: '12px',
            fontSize: '16px',
            fontWeight: 600,
            cursor: 'pointer',
            letterSpacing: '0',
            boxShadow: '0 14px 34px rgba(255,86,86,0.28)',
            transition: 'transform 0.15s ease, box-shadow 0.15s ease',
            marginTop: '4px',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
          }}
          onMouseEnter={e => {
            e.currentTarget.style.transform = 'translateY(-1px)';
            e.currentTarget.style.boxShadow = '0 18px 40px rgba(255,86,86,0.36)';
          }}
          onMouseLeave={e => {
            e.currentTarget.style.transform = 'translateY(0)';
            e.currentTarget.style.boxShadow = '0 14px 34px rgba(255,86,86,0.28)';
          }}
        >
          <Download size={18} strokeWidth={2.3} />
          Install App
        </button>

        {/* Dismiss link */}
        <button
          id="pwa-dismiss-btn"
          onClick={handleDismiss}
          style={{
            background: 'none',
            border: 'none',
            color: '#A3A3A3',
            fontSize: '13px',
            cursor: 'pointer',
            padding: '4px 8px',
            borderRadius: '6px',
            transition: 'color 0.2s',
            fontFamily: 'inherit',
          }}
          onMouseEnter={e => (e.currentTarget.style.color = '#FFFFFF')}
          onMouseLeave={e => (e.currentTarget.style.color = '#A3A3A3')}
        >
          Continue without installing
        </button>
      </div>

      {/* Keyframe animations injected inline */}
      <style>{`
        @keyframes ip-fade-in {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @keyframes ip-slide-up {
          from { opacity: 0; transform: translateX(-50%) translateY(40px); }
          to   { opacity: 1; transform: translateX(-50%) translateY(0); }
        }
      `}</style>
    </>
  );
}
