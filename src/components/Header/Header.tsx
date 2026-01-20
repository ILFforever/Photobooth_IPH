import { motion, AnimatePresence } from "framer-motion";
import { useAuth } from "../../contexts/AuthContext";
import { useRef, useLayoutEffect, useState } from "react";

type AppMode = 'photobooth' | 'collage' | 'qr';

interface HeaderProps {
  showAccountMenu: boolean;
  setShowAccountMenu: (show: boolean) => void;
  showAppMenu: boolean;
  setShowAppMenu: (show: boolean) => void;
  onShowHistory: () => void;
  onShowAbout: () => void;
  onLogout: () => void;
  onLogin: () => void;
  onCancelLogin: () => void;
  mode: AppMode;
  setMode: (mode: AppMode) => void;
}

export default function Header({
  showAccountMenu,
  setShowAccountMenu,
  showAppMenu,
  setShowAppMenu,
  onShowHistory,
  onShowAbout,
  onLogout,
  onLogin,
  onCancelLogin,
  mode,
  setMode,
}: HeaderProps) {
  const { account, loggingIn } = useAuth();

  // Refs for measuring button widths
  const photoboothRef = useRef<HTMLButtonElement>(null);
  const collageRef = useRef<HTMLButtonElement>(null);
  const qrRef = useRef<HTMLButtonElement>(null);

  const [indicatorStyle, setIndicatorStyle] = useState({ x: 0, width: 0 });

  // Calculate indicator position and width based on active button
  useLayoutEffect(() => {
    const updateIndicator = () => {
      let activeRef = null;

      if (mode === 'photobooth') activeRef = photoboothRef.current;
      else if (mode === 'collage') activeRef = collageRef.current;
      else if (mode === 'qr') activeRef = qrRef.current;

      if (activeRef) {
        const rect = activeRef.getBoundingClientRect();
        const parentRect = activeRef.parentElement?.getBoundingClientRect();

        if (parentRect) {
          const x = rect.left - parentRect.left;
          const width = rect.width;
          setIndicatorStyle({ x, width });
        }
      }
    };

    updateIndicator();
    window.addEventListener('resize', updateIndicator);
    return () => window.removeEventListener('resize', updateIndicator);
  }, [mode]);

  return (
    <header className="app-header">
      <div className="header-left">
        <div className="app-menu-container">
          <button
            className="app-icon-button"
            onClick={(e) => {
              e.stopPropagation();
              setShowAppMenu(!showAppMenu);
            }}
            title="PhotoBooth QR Generator"
          >
            <span className="app-icon">📸</span>
          </button>

          <AnimatePresence>
            {showAppMenu && (
              <motion.div
                initial={{ opacity: 0, x: -20, y: "-50%" }}
                animate={{ opacity: 1, x: 8, y: "-50%" }}
                exit={{ opacity: 0, x: -20, y: "-50%" }}
                transition={{ type: "spring", stiffness: 300, damping: 30 }}
                className="app-menu"
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  className="app-menu-item"
                  onClick={() => {
                    onShowHistory();
                    setShowAppMenu(false);
                  }}
                >
                  <span>History</span>
                </button>
                <div className="app-menu-divider"></div>
                <button
                  className="app-menu-item"
                  onClick={() => {
                    onShowAbout();
                    setShowAppMenu(false);
                  }}
                >
                  <span>About</span>
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Mode Selector - Center */}
      <div className="header-center">
        <div className="mode-selector">
          {/* Sliding active indicator */}
          <motion.div
            className="mode-active-indicator"
            animate={{
              x: indicatorStyle.x,
              width: indicatorStyle.width
            }}
            transition={{ type: "spring", stiffness: 400, damping: 30 }}
          />

          <button
            ref={photoboothRef}
            className={`mode-segment ${mode === 'photobooth' ? 'active' : ''}`}
            onClick={() => setMode('photobooth')}
            title="Auto-Photobooth: Watch folder and auto-place photos"
          >
            <span className="mode-label">Photobooth</span>
          </button>
          <button
            ref={collageRef}
            className={`mode-segment ${mode === 'collage' ? 'active' : ''}`}
            onClick={() => setMode('collage')}
            title="Collage: Manual drag and drop mode"
          >
            <span className="mode-label">Collage Creator</span>
          </button>
          <button
            ref={qrRef}
            className={`mode-segment ${mode === 'qr' ? 'active' : ''}`}
            onClick={() => setMode('qr')}
            title="QR: Generate QR codes for photos"
          >
            <span className="mode-label">QR Generator</span>
          </button>
        </div>
      </div>

      <div className="header-right">
        <div className="account-dropdown-container">
          <button
            className="account-dropdown-button"
            onClick={(e) => {
              e.stopPropagation();
              setShowAccountMenu(!showAccountMenu);
            }}
          >
            {account ? (
              <>
                <div className="account-avatar">
                  {account.picture ? (
                    <img src={account.picture} alt={account.name} referrerPolicy="no-referrer" crossOrigin="anonymous" />
                  ) : (
                    <span>{account.name.charAt(0).toUpperCase()}</span>
                  )}
                </div>
                <span className="account-label">Account</span>
              </>
            ) : (
              <>
                <span className="account-icon">👤</span>
                <span className="account-label">Account</span>
              </>
            )}
            <span className="dropdown-arrow">▼</span>
          </button>

          <AnimatePresence>
            {showAccountMenu && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="account-menu"
                onClick={(e) => e.stopPropagation()}
              >
                {account ? (
                  <>
                    <div className="account-menu-header">
                      <div className="account-menu-avatar">
                        {account.picture ? (
                          <img src={account.picture} alt={account.name} referrerPolicy="no-referrer" crossOrigin="anonymous" />
                        ) : (
                          <span>{account.name.charAt(0).toUpperCase()}</span>
                        )}
                      </div>
                      <div className="account-menu-info">
                        <div className="account-menu-name">{account.name}</div>
                        <div className="account-menu-email">{account.email}</div>
                      </div>
                    </div>
                    <div className="account-menu-divider"></div>
                    <button className="account-menu-item" onClick={onLogout}>
                      <span>Sign out</span>
                    </button>
                  </>
                ) : (
                  <>
                    {loggingIn ? (
                      <>
                        <div style={{
                          padding: '24px 16px',
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          gap: '12px',
                          background: 'var(--bg-primary)',
                          textAlign: 'center'
                        }}>
                          <motion.div
                            animate={{ rotate: 360 }}
                            transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                            style={{
                              fontSize: '32px',
                              color: 'var(--accent-blue)'
                            }}
                          >
                            ⟳
                          </motion.div>
                          <div style={{
                            fontSize: '14px',
                            fontWeight: '600',
                            color: 'var(--text-primary)'
                          }}>
                            Signing in...
                          </div>
                          <div style={{
                            fontSize: '12px',
                            color: 'var(--text-secondary)',
                            lineHeight: '1.4',
                            maxWidth: '240px'
                          }}>
                            Please complete the sign-in process in your browser
                          </div>
                        </div>
                        <div className="account-menu-divider"></div>
                        <button
                          className="account-menu-item"
                          onClick={onCancelLogin}
                          style={{ color: 'var(--text-secondary)' }}
                        >
                          <span>✕</span>
                          <span>Cancel</span>
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          className="account-menu-item sign-in-item"
                          onClick={onLogin}
                        >
                          <span>🔐</span>
                          <span>Sign in with Google</span>
                        </button>
                        <div className="account-menu-permission-notice">
                          Will request permission to see and download your Google Drive files
                        </div>
                      </>
                    )}
                  </>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </header>
  );
}
