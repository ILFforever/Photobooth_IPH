import { motion, AnimatePresence } from "framer-motion";
import { useAuth } from "../../contexts/AuthContext";

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
