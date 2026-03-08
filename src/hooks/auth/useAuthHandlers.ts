import type { GoogleAccount, DriveFolder } from "../../types/qr";
import {
  checkCachedAccount,
  googleLogin,
  googleLogout,
} from "../../utils/googleAuth";
import { createLogger } from '../../utils/logger';
const logger = createLogger('useAuthHandlers');


interface AuthHandlersOptions {
  setAccount: (account: GoogleAccount | null) => void;
  setRootFolder: (folder: DriveFolder | null) => void;
  setLoggingIn: (loggingIn: boolean) => void;
  setCachedAccount: (account: GoogleAccount | null) => void;
  setShowCachedAccountConfirm: (show: boolean) => void;
  setShowAccountMenu: (show: boolean) => void;
  setError: (error: string) => void;
}

interface CachedAccountState {
  cachedAccount: GoogleAccount | null;
  setCachedAccount: (account: GoogleAccount | null) => void;
  showCachedAccountConfirm: boolean;
  setShowCachedAccountConfirm: (show: boolean) => void;
}

export function useAuthHandlers(options: AuthHandlersOptions) {
  const {
    setAccount,
    setRootFolder,
    setLoggingIn,
    setCachedAccount,
    setShowCachedAccountConfirm,
    setShowAccountMenu,
    setError,
  } = options;

  const handleLogin = async (e?: React.MouseEvent, forceFresh: boolean = false) => {
    e?.stopPropagation();

    // Check for cached account first
    if (!forceFresh) {
      try {
        const cached = await checkCachedAccount();
        if (cached) {
          setCachedAccount(cached);
          setShowCachedAccountConfirm(true);
          setShowAccountMenu(false);
          return;
        }
      } catch {
        // No cached account available
      }
    }

    setLoggingIn(true);
    setError("");
    try {
      const accountData = await googleLogin();
      setAccount(accountData);
      setShowAccountMenu(false);
    } catch (e) {
      logger.error("Login failed:", e);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoggingIn(false);
    }
  };

  const handleConfirmCachedAccount = async (
    cachedAccount: GoogleAccount | null
  ) => {
    if (!cachedAccount) return;

    setShowCachedAccountConfirm(false);
    setLoggingIn(true);
    setError("");

    try {
      const accountData = await googleLogin();
      setAccount(accountData);
    } catch (e) {
      logger.error("Failed to restore session:", e);
      setError(e instanceof Error ? e.message : String(e));
      setAccount(cachedAccount);
    } finally {
      setLoggingIn(false);
      setCachedAccount(null);
    }
  };

  const handleUseDifferentAccount = async () => {
    setShowCachedAccountConfirm(false);
    setCachedAccount(null);

    try {
      await googleLogout();
    } catch (e) {
      logger.error("Failed to clear cached account:", e);
    }

    await handleLogin(undefined, true);
  };

  const handleCancelLogin = () => {
    setLoggingIn(false);
    setShowAccountMenu(false);
  };

  const handleLogout = async (e?: React.MouseEvent) => {
    e?.stopPropagation();
    try {
      await googleLogout();
      setAccount(null);
      setRootFolder(null);
      setShowAccountMenu(false);
    } catch (e) {
      logger.error("Logout failed:", e);
    }
  };

  return {
    handleLogin,
    handleConfirmCachedAccount,
    handleUseDifferentAccount,
    handleCancelLogin,
    handleLogout,
  };
}
