import { useEffect, useState } from 'react';

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
          background: 'rgba(0,0,0,0.45)',
          backdropFilter: 'blur(4px)',
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
          background: 'linear-gradient(145deg, #ffffff 0%, #f5f3ff 100%)',
          borderRadius: '24px',
          padding: '32px 28px 28px',
          boxShadow: '0 24px 60px rgba(108,99,255,0.25), 0 8px 24px rgba(0,0,0,0.12)',
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
            background: 'rgba(108,99,255,0.08)',
            border: 'none',
            borderRadius: '50%',
            width: '32px',
            height: '32px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            color: '#6C63FF',
            fontSize: '16px',
            lineHeight: 1,
            transition: 'background 0.2s',
          }}
          onMouseEnter={e => (e.currentTarget.style.background = 'rgba(108,99,255,0.16)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'rgba(108,99,255,0.08)')}
        >
          ✕
        </button>

        {/* App Icon */}
        <div
          style={{
            width: '72px',
            height: '72px',
            borderRadius: '18px',
            background: 'linear-gradient(135deg, #6C63FF 0%, #9D78FF 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 8px 24px rgba(108,99,255,0.35)',
            marginBottom: '4px',
          }}
        >
          <img
            src="/icon-192.png"
            alt="SplitMate"
            style={{ width: '52px', height: '52px', borderRadius: '12px', objectFit: 'cover' }}
            onError={e => {
              // Fallback emoji icon if image fails
              (e.currentTarget as HTMLImageElement).style.display = 'none';
              const parent = e.currentTarget.parentElement;
              if (parent) {
                const span = document.createElement('span');
                span.textContent = '💜';
                span.style.fontSize = '36px';
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
              fontWeight: 700,
              color: '#1a1340',
              letterSpacing: '-0.3px',
            }}
          >
            Install SplitMate
          </h2>
          <p
            style={{
              margin: '6px 0 0',
              fontSize: '14px',
              color: '#6b6b8a',
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
          {['⚡ Works offline', '📲 Home screen', '🔔 Notifications'].map(f => (
            <span
              key={f}
              style={{
                background: 'rgba(108,99,255,0.08)',
                color: '#6C63FF',
                borderRadius: '100px',
                padding: '4px 12px',
                fontSize: '12px',
                fontWeight: 500,
              }}
            >
              {f}
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
            background: 'linear-gradient(135deg, #6C63FF 0%, #9D78FF 100%)',
            color: '#fff',
            border: 'none',
            borderRadius: '14px',
            fontSize: '16px',
            fontWeight: 600,
            cursor: 'pointer',
            letterSpacing: '0.2px',
            boxShadow: '0 6px 20px rgba(108,99,255,0.4)',
            transition: 'transform 0.15s ease, box-shadow 0.15s ease',
            marginTop: '4px',
          }}
          onMouseEnter={e => {
            e.currentTarget.style.transform = 'translateY(-1px)';
            e.currentTarget.style.boxShadow = '0 10px 28px rgba(108,99,255,0.5)';
          }}
          onMouseLeave={e => {
            e.currentTarget.style.transform = 'translateY(0)';
            e.currentTarget.style.boxShadow = '0 6px 20px rgba(108,99,255,0.4)';
          }}
        >
          Install App
        </button>

        {/* Dismiss link */}
        <button
          id="pwa-dismiss-btn"
          onClick={handleDismiss}
          style={{
            background: 'none',
            border: 'none',
            color: '#9d9db5',
            fontSize: '13px',
            cursor: 'pointer',
            padding: '4px 8px',
            borderRadius: '6px',
            transition: 'color 0.2s',
            fontFamily: 'inherit',
          }}
          onMouseEnter={e => (e.currentTarget.style.color = '#6C63FF')}
          onMouseLeave={e => (e.currentTarget.style.color = '#9d9db5')}
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
