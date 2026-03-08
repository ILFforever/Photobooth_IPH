import type { GoogleDriveMetadata } from '../contexts';
import type { GoogleAccount } from '../types/qr';

/**
 * Authentication state for a Drive folder
 */
export enum DriveAuthState {
  /** Folder exists and authenticated with the same account that created it */
  AUTHENTICATED_MATCHING = 'authenticated_matching',
  /** Folder exists but authenticated with a different account */
  AUTHENTICATED_MISMATCH = 'authenticated_mismatch',
  /** Folder exists but not authenticated (signed out) */
  NOT_AUTHENTICATED = 'not_authenticated',
  /** No folder exists */
  NO_FOLDER = 'no_folder',
}

/**
 * Get the authentication state for a session's Drive folder
 */
export function getDriveAuthState(
  driveMetadata: GoogleDriveMetadata | null | undefined,
  currentAccount: GoogleAccount | null
): { state: DriveAuthState; folderOwner?: string | null } {
  // No folder exists
  if (!driveMetadata?.folderId) {
    return { state: DriveAuthState.NO_FOLDER };
  }

  const folderOwner = driveMetadata.accountId || null;

  // Not authenticated
  if (!currentAccount) {
    return { state: DriveAuthState.NOT_AUTHENTICATED, folderOwner };
  }

  // Account mismatch
  if (folderOwner && folderOwner !== currentAccount.email) {
    return { state: DriveAuthState.AUTHENTICATED_MISMATCH, folderOwner };
  }

  // Authenticated with matching account (or folder owner unknown)
  return { state: DriveAuthState.AUTHENTICATED_MATCHING, folderOwner };
}

/**
 * Check if uploads are enabled for the given auth state
 */
export function areUploadsEnabled(authState: DriveAuthState): boolean {
  return authState === DriveAuthState.AUTHENTICATED_MATCHING;
}

/**
 * Get user-friendly status text for the auth state
 */
export function getAuthStateText(authState: DriveAuthState, folderOwner?: string | null, currentAccount?: GoogleAccount | null): {
  title: string;
  message: string;
  canViewLink: boolean;
} {
  switch (authState) {
    case DriveAuthState.AUTHENTICATED_MATCHING:
      return {
        title: 'Connected',
        message: currentAccount ? `Signed in as ${currentAccount.email}` : 'Connected to Google Drive',
        canViewLink: true,
      };

    case DriveAuthState.AUTHENTICATED_MISMATCH:
      return {
        title: 'Account Mismatch',
        message: `This folder was created by ${folderOwner || 'another account'}. You're signed in as ${currentAccount?.email || 'a different account'}.`,
        canViewLink: true, // Public link still works
      };

    case DriveAuthState.NOT_AUTHENTICATED:
      return {
        title: 'Not Signed In',
        message: folderOwner
          ? `This folder was created by ${folderOwner}. Sign in to manage uploads. The public link still works.`
          : 'Sign in to manage uploads. The public link still works.',
        canViewLink: true,
      };

    case DriveAuthState.NO_FOLDER:
      return {
        title: 'No Folder',
        message: 'Create a Google Drive folder to enable uploads.',
        canViewLink: false,
      };
  }
}
