import { motion, AnimatePresence } from "framer-motion";
import { useAuth } from "../../contexts";
import Icon from "@mdi/react";
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
} from "@mdi/js";
import iphLogo from "../../assets/images/IPH W.png";

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
                          <span><Icon path={mdiClose} size={0.8} /></span>
                          <span>Cancel</span>
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          className="account-menu-item sign-in-item"
                          onClick={onLogin}
                        >
                          <span><Icon path={mdiLockOutline} size={0.9} /></span>
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
