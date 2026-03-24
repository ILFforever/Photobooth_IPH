import { motion, AnimatePresence } from "framer-motion";
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
  mdiInformationOutline,
  mdiPower,
  mdiOpenInNew,
  mdiLogoutVariant,
  mdiCog,
} from "@mdi/js";
import iphLogo from "../../assets/images/IPH W.png";
import { openAuthUrl } from "../../utils/googleAuth";

type AppMode = 'photobooth' | 'collage' | 'qr';

const modeConfig: Record<AppMode, { label: string; icon: string }> = {
  photobooth: { label: 'Photobooth', icon: mdiCamera },
  collage: { label: 'Collage Creator', icon: mdiImageMultiple },
  qr: { label: 'QR Generator', icon: mdiQrcode },
};

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
              >
                {(Object.entries(modeConfig) as [AppMode, typeof modeConfig[AppMode]][]).map(([key, cfg]) => (
                  <button
                    key={key}
                    className={`app-menu-item ${mode === key ? 'active' : ''}`}
                    onClick={() => {
                      setMode(key);
                      setShowAppMenu(false);
                    }}
                  >
                    <Icon path={cfg.icon} size={0.6} />
                    <span>{cfg.label}</span>
                  </button>
                ))}
                <div className="app-menu-divider" />
                <button
                  className="app-menu-item"
                  onClick={() => {
                    onShowSettings();
                    setShowAppMenu(false);
                  }}
                >
                  <Icon path={mdiCog} size={0.6} />
                  <span>Settings</span>
                </button>
                <button
                  className="app-menu-item"
                  onClick={() => {
                    onShowAbout();
                    setShowAppMenu(false);
                  }}
                >
                  <Icon path={mdiInformationOutline} size={0.6} />
                  <span>About</span>
                </button>
                <button
                  className="app-menu-item"
                  onClick={() => {
                    onExit();
                    setShowAppMenu(false);
                  }}
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
