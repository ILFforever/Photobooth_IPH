import { motion, AnimatePresence } from "framer-motion";

interface GoogleAccount {
  email: string;
  name: string;
  picture?: string;
}

interface CachedAccountModalProps {
  show: boolean;
  cachedAccount: GoogleAccount | null;
  onClose: () => void;
  onConfirm: () => void;
  onUseDifferent: () => void;
}

export default function CachedAccountModal({
  show,
  cachedAccount,
  onClose,
  onConfirm,
  onUseDifferent,
}: CachedAccountModalProps) {
  if (!show || !cachedAccount) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="modal-overlay"
        onClick={onClose}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          className="confirm-modal"
          onClick={(e) => e.stopPropagation()}
        >
          <h3>Continue as this user?</h3>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px', margin: '20px 0', padding: '16px', background: 'var(--bg-primary)', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
            <div className="account-menu-avatar" style={{ width: '48px', height: '48px', fontSize: '20px' }}>
              {cachedAccount.picture ? (
                <img src={cachedAccount.picture} alt={cachedAccount.name} />
              ) : (
                <span>{cachedAccount.name.charAt(0).toUpperCase()}</span>
              )}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '15px', fontWeight: '600', color: 'var(--text-primary)', marginBottom: '4px' }}>
                {cachedAccount.name}
              </div>
              <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                {cachedAccount.email}
              </div>
            </div>
          </div>
          <p style={{ marginBottom: '24px' }}>
            We found a saved session for this account. Would you like to continue as this user, or sign in with a different account?
          </p>
          <div className="confirm-modal-actions">
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={onUseDifferent}
              className="btn-secondary"
            >
              Use Different Account
            </motion.button>
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={onConfirm}
              className="btn-primary"
              style={{ width: 'auto' }}
            >
              Continue as {cachedAccount.name.split(' ')[0]}
            </motion.button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
