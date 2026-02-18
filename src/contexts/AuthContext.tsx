import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { getRootFolder } from '../utils/driveFolder';
import type { GoogleAccount, DriveFolder } from '../types/qr';

export type { GoogleAccount, DriveFolder };

interface AuthContextType {
  account: GoogleAccount | null;
  setAccount: (account: GoogleAccount | null) => void;
  rootFolder: DriveFolder | null;
  setRootFolder: (folder: DriveFolder | null) => void;
  loggingIn: boolean;
  setLoggingIn: (loading: boolean) => void;
  cachedAccount: GoogleAccount | null;
  setCachedAccount: (account: GoogleAccount | null) => void;
  showCachedAccountConfirm: boolean;
  setShowCachedAccountConfirm: (show: boolean) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [account, setAccount] = useState<GoogleAccount | null>(null);
  const [rootFolder, setRootFolder] = useState<DriveFolder | null>(null);
  const [loggingIn, setLoggingIn] = useState(false);
  const [cachedAccount, setCachedAccount] = useState<GoogleAccount | null>(null);
  const [showCachedAccountConfirm, setShowCachedAccountConfirm] = useState(false);

  // Load persisted root folder on mount
  useEffect(() => {
    getRootFolder()
      .then((folder) => {
        if (folder) {
          setRootFolder(folder);
        }
      })
      .catch((error) => {
        console.error('Failed to load root folder:', error);
      });
  }, []);

  return (
    <AuthContext.Provider
      value={{
        account,
        setAccount,
        rootFolder,
        setRootFolder,
        loggingIn,
        setLoggingIn,
        cachedAccount,
        setCachedAccount,
        showCachedAccountConfirm,
        setShowCachedAccountConfirm,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
