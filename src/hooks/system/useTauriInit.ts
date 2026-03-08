import { useState, useEffect } from "react";
import { listen } from '@tauri-apps/api/event';
import type { GoogleAccount } from "../../types/qr";
import type { DriveFolder } from "../../types/qr";
import type { UploadProgress } from "../../types/qr";
import { getAccount } from "../../utils/googleAuth";
import { getRootFolder } from "../../utils/driveFolder";
import { createLogger } from '../../utils/logger';
const logger = createLogger('useTauriInit');

interface UseTauriInitOptions {
  setAccount: (account: GoogleAccount | null) => void;
  setRootFolder: (folder: DriveFolder | null) => void;
}

export function useTauriInit({
  setAccount,
  setRootFolder,
}: UseTauriInitOptions) {
  const [tauriReady, setTauriReady] = useState(false);

  // App initialization log (dev only)
  useEffect(() => {
    if (import.meta.env.DEV) {
      logger.debug("App initialized:", new Date().toISOString());
    }
  }, []);

  // Wait for Tauri to be ready
  useEffect(() => {
    const initTauri = async () => {
      // Wait for window.__TAURI_INTERNALS__ to be available
      let attempts = 0;
      const maxAttempts = 50; // 5 seconds max

      while (attempts < maxAttempts) {
        if (typeof window !== 'undefined' && (window as any).__TAURI_INTERNALS__) {
          setTauriReady(true);
          return;
        }
        await new Promise(resolve => setTimeout(resolve, 100));
        attempts++;
      }

      logger.error("Tauri initialization timeout");
    };
    initTauri();
  }, []);

  // Check if user is already logged in on mount
  useEffect(() => {
    if (!tauriReady) return;

    const checkExistingSession = async () => {
      try {
        const savedAccount = await getAccount();
        if (savedAccount) {
          setAccount(savedAccount);

          const savedFolder = await getRootFolder();
          if (savedFolder) {
            setRootFolder(savedFolder);
          }
        }
      } catch (e) {
        logger.error("Failed to check account:", e);
      }
    };
    checkExistingSession();
  }, [tauriReady, setAccount, setRootFolder]);

  return { tauriReady };
}

interface UseTauriEventsOptions {
  tauriReady: boolean;
  setUploadProgress: (progress: UploadProgress | null) => void;
}

export function useTauriEvents({
  tauriReady,
  setUploadProgress,
}: UseTauriEventsOptions) {
  // Listen for upload progress events
  useEffect(() => {
    if (!tauriReady) return;

    const unlisten = listen<{step: string; current: number; total: number; message: string}>(
      'upload-progress',
      (event) => {
        if (import.meta.env.DEV) {
          logger.debug('Upload progress:', event.payload);
        }
        setUploadProgress(event.payload);
      }
    );

    return () => {
      unlisten.then(fn => fn());
    };
  }, [tauriReady, setUploadProgress]);
}
