import { motion, AnimatePresence } from "framer-motion";
import { useState, useEffect, useRef } from "react";
import { useAuth } from "../../contexts";
import Icon from "@mdi/react";
import "../../styles/AccountDropdown.css";
import {
  mdiLockOutline,
  mdiClose,
  mdiAccountOutline,
  mdiChevronDown,
  mdiCamera,
  mdiImageMultiple,
  mdiQrcode,
  mdiMonitor,
  mdiInformationOutline,
  mdiPower,
  mdiOpenInNew,
  mdiLogoutVariant,
  mdiCog,
} from "@mdi/js";
import iphLogo from "../../assets/images/IPH W.png";
import { openAuthUrl } from "../../utils/googleAuth";

type AppMode = 'photobooth' | 'collage' | 'qr' | 'display';

const modeConfig: Record<AppMode, { label: string; icon: string }> = {
  photobooth: { label: 'Photobooth', icon: mdiCamera },
  collage: { label: 'Collage Creator', icon: mdiImageMultiple },
  display: { label: 'Guest Display', icon: mdiMonitor },
  qr: { label: 'QR Generator', icon: mdiQrcode },
};

const modeOrder: AppMode[] = ['photobooth', 'collage', 'qr', 'display'];

interface HeaderProps {
  showAccountMenu: boolean;
  setShowAccountMenu: (show: boolean) => void;
  showAppMenu: boolean;
  setShowAppMenu: (show: boolean) => void;
  onShowAbout: () => void;
  onShowSettings: () => void;
  onLogout: () => void;
  onLogin: () => void;
  onCancelLogin: () => void;
  onExit: () => void;
  mode: AppMode;
  setMode: (mode: AppMode) => void;
}

export default function Header({
  showAccountMenu,
  setShowAccountMenu,
  showAppMenu,
  setShowAppMenu,
  onShowAbout,
  onShowSettings,
  onLogout,
  onLogin,
  onCancelLogin,
  onExit,
  mode,
  setMode,
}: HeaderProps) {
  const { account, loggingIn } = useAuth();
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null);
  const menuContainerRef = useRef<HTMLDivElement>(null);
  const focusedIndexRef = useRef<number | null>(null);

  // All navigable items: modes + settings + about + exit
  const allMenuItems = [
    ...modeOrder.map((key) => ({
      type: 'mode' as const,
      key,
      action: () => { setMode(key); setShowAppMenu(false); },
    })),
    { type: 'settings' as const, key: 'settings', action: () => { onShowSettings(); setShowAppMenu(false); } },
    { type: 'about' as const, key: 'about', action: () => { onShowAbout(); setShowAppMenu(false); } },
    { type: 'exit' as const, key: 'exit', action: () => { onExit(); setShowAppMenu(false); } },
  ];
  const totalItems = allMenuItems.length;

  focusedIndexRef.current = focusedIndex;

  useEffect(() => {
    if (!showAppMenu) {
      setFocusedIndex(null);
      return;
    }

    const currentIndex = modeOrder.indexOf(mode);
    setFocusedIndex(currentIndex >= 0 ? currentIndex : 0);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowAppMenu(false);
        return;
      }

      if (['1', '2', '3', '4'].includes(e.key)) {
        e.preventDefault();
        const modeIndex = parseInt(e.key) - 1;
        if (modeIndex >= 0 && modeIndex < modeOrder.length) {
          allMenuItems[modeIndex]?.action();
        }
        return;
      }

      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault();
        const current = focusedIndexRef.current;
        setFocusedIndex((prev) => {
          const startIndex = prev ?? current ?? 0;
          const direction = e.key === 'ArrowRight' ? 1 : -1;
          return (startIndex + direction + totalItems) % totalItems;
        });
      }

      if (e.key === 'Enter') {
        e.preventDefault();
        const current = focusedIndexRef.current;
        if (current !== null) {
          allMenuItems[current]?.action();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showAppMenu, mode, setMode, setShowAppMenu]);

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
            title="Menu"
          >
            <img src={iphLogo} alt="IPH" className="app-icon-img" />
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
                ref={menuContainerRef}
              >
                {modeOrder.map((key, index) => {
                  const cfg = modeConfig[key];
                  const isFocused = focusedIndex === index;
                  return (
                    <button
                      key={key}
                      className={`app-menu-item ${mode === key ? 'active' : ''} ${isFocused ? 'focused' : ''}`}
                      onClick={() => {
                        setMode(key);
                        setShowAppMenu(false);
                      }}
                      onMouseEnter={() => setFocusedIndex(index)}
                    >
                      <Icon path={cfg.icon} size={0.6} />
                      <span>{cfg.label}</span>
                    </button>
                  );
                })}
                <div className="app-menu-divider" />
                <button
                  className={`app-menu-item ${focusedIndex === modeOrder.length ? 'focused' : ''}`}
                  onClick={() => { onShowSettings(); setShowAppMenu(false); }}
                  onMouseEnter={() => setFocusedIndex(modeOrder.length)}
                >
                  <Icon path={mdiCog} size={0.6} />
                  <span>Settings</span>
                </button>
                <button
                  className={`app-menu-item ${focusedIndex === modeOrder.length + 1 ? 'focused' : ''}`}
                  onClick={() => { onShowAbout(); setShowAppMenu(false); }}
                  onMouseEnter={() => setFocusedIndex(modeOrder.length + 1)}
                >
                  <Icon path={mdiInformationOutline} size={0.6} />
                  <span>About</span>
                </button>
                <button
                  className={`app-menu-item ${focusedIndex === modeOrder.length + 2 ? 'focused' : ''}`}
                  onClick={() => { onExit(); setShowAppMenu(false); }}
                  onMouseEnter={() => setFocusedIndex(modeOrder.length + 2)}
                  style={{ color: '#ff99a4' }}
                >
                  <Icon path={mdiPower} size={0.6} />
                  <span>Exit</span>
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Current Mode - Center */}
      <div className="header-center">
        <span className="header-mode-label">{modeConfig[mode].label}</span>
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
                <span className="account-icon"><Icon path={mdiAccountOutline} size={1} /></span>
                <span className="account-label">Account</span>
              </>
            )}
            <span className="dropdown-arrow"><Icon path={mdiChevronDown} size={0.7} /></span>
          </button>

          <AnimatePresence>
            {showAccountMenu && (
              <motion.div
                initial={{ opacity: 0, scale: 0.97, y: -6 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.97, y: -6 }}
                transition={{ type: "spring", duration: 0.25, bounce: 0.1 }}
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
                    <div className="account-menu-divider" />
                    <button className="account-menu-item account-menu-item--danger" onClick={onLogout}>
                      <Icon path={mdiLogoutVariant} size={0.75} />
                      <span>Sign out</span>
                    </button>
                  </>
                ) : loggingIn ? (
                  <>
                    <div className="account-menu-signing-in">
                      <div className="account-menu-signing-row">
                        <motion.div
                          className="account-menu-spinner"
                          animate={{ rotate: 360 }}
                          transition={{ duration: 0.9, repeat: Infinity, ease: "linear" }}
                        />
                        <div>
                          <div className="account-menu-signing-title">Signing in…</div>
                          <div className="account-menu-signing-desc">Complete sign-in in your browser</div>
                        </div>
                      </div>
                      <button
                        className="account-menu-open-browser-btn"
                        onClick={() => openAuthUrl().catch(() => {})}
                      >
                        <Icon path={mdiOpenInNew} size={0.72} />
                        Open browser
                      </button>
                    </div>
                    <div className="account-menu-divider" />
                    <button
                      className="account-menu-item account-menu-item--muted"
                      onClick={onCancelLogin}
                    >
                      <Icon path={mdiClose} size={0.72} />
                      <span>Cancel</span>
                    </button>
                  </>
                ) : (
                  <>
                    <div className="account-menu-sign-in-section">
                      <div className="account-menu-sign-in-icon">
                        <Icon path={mdiAccountOutline} size={1.1} />
                      </div>
                      <div className="account-menu-sign-in-title">Connect Google Account</div>
                      <div className="account-menu-sign-in-desc">
                        Sign in to upload photos to Google Drive automatically.
                      </div>
                      <button className="account-menu-sign-in-btn" onClick={onLogin}>
                        <Icon path={mdiLockOutline} size={0.8} />
                        Sign in with Google
                      </button>
                    </div>
                    <div className="account-menu-permission-notice">
                      Requests access to see and manage your Google Drive files
                    </div>
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
