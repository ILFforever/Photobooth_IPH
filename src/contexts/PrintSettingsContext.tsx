import { createContext, useContext, useState, useCallback, useEffect, useRef, ReactNode } from "react";
import { useToast } from './ToastContext';
import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { usePhotoboothSettings } from './PhotoboothSettingsContext';
import { useCollage } from './CollageContext';
import { usePhotobooth } from './PhotoboothContext';
import { createLogger } from '../utils/logger';

const logger = createLogger('PrintSettings');

interface PrintSettingsContextType {
  // Print operation
  printCollage: () => Promise<void>;
  isPrinting: boolean;
  // Double page mode (side-by-side for Fuji 4x6 half-cut)
  doublePageMode: boolean;
  setDoublePageMode: (value: boolean) => void;
  // Prompt state for regenerating collage
  showRegeneratePrompt: boolean;
  confirmRegenerate: () => void;
  cancelRegenerate: () => void;
}

const PrintSettingsContext = createContext<PrintSettingsContextType | undefined>(undefined);

export function PrintSettingsProvider({ children }: { children: ReactNode }) {
  const { showToast } = useToast();
  const { workingFolder, currentSession, sessions } = usePhotoboothSettings();
  const { exportCanvasAsPNG } = useCollage();
  const { exportPhotoboothCanvasAsPNG, finalizeViewMode, currentCollageFilename, setCurrentCollageFilename, collageIsDirty, resetCollageDirtyState, isGeneratingCollage, setIsGeneratingCollage } = usePhotobooth();

  // Print operation state
  const [isPrinting, setIsPrinting] = useState(false);
  const [showRegeneratePrompt, setShowRegeneratePrompt] = useState(false);
  const [doublePageMode, setDoublePageModeRaw] = useState(false);
  // Ref so performPrint always reads the live value regardless of closure age
  const doublePageModeRef = useRef(false);
  // Cached doubled-page filename — invalidated by the same collageIsDirty flag as the single-page cache
  const [currentDoubleCollageFilename, setCurrentDoubleCollageFilename] = useState<string | null>(null);

  const setDoublePageMode = useCallback((value: boolean) => {
    doublePageModeRef.current = value;
    setDoublePageModeRaw(value);
    logger.debug(`Double page mode set to: ${value}`);
  }, []);

  // When the single-page cache is cleared (e.g. back navigation), clear the double cache too
  useEffect(() => {
    if (currentCollageFilename === null) {
      setCurrentDoubleCollageFilename(null);
      logger.debug('Single-page cache cleared — double cache invalidated');
    }
  }, [currentCollageFilename]);

  // Creates a side-by-side doubled image (2× wide) from PNG bytes
  const doubleImageSideBySide = useCallback(async (bytes: Uint8Array): Promise<Uint8Array> => {
    return new Promise((resolve, reject) => {
      const blob = new Blob([bytes], { type: 'image/png' });
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        const canvas = document.createElement('canvas');
        canvas.width = img.width * 2;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) { reject(new Error('Canvas context unavailable')); return; }
        ctx.drawImage(img, 0, 0);
        ctx.drawImage(img, img.width, 0);
        canvas.toBlob((resultBlob) => {
          if (!resultBlob) { reject(new Error('Canvas toBlob failed')); return; }
          resultBlob.arrayBuffer().then((buf) => resolve(new Uint8Array(buf))).catch(reject);
        }, 'image/png');
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Image load failed')); };
      img.src = url;
    });
  }, []);

  // Actual print execution (extracted for reuse)
  const performPrint = useCallback(async (forceOldVersion = false) => {
    if (!currentSession || !workingFolder) {
      showToast('No active session', 'error', 3000, 'Please create or select a session first');
      return;
    }

    const folder = sessions.find((s: any) => s.id === currentSession.id)?.folderName || currentSession.id;
    let filename: string;

    const isDoublePage = doublePageModeRef.current;
    logger.debug(`performPrint — doublePageMode (ref): ${isDoublePage}, cached1x: ${currentCollageFilename ?? 'none'}, cached2x: ${currentDoubleCollageFilename ?? 'none'}, dirty: ${collageIsDirty}, forceOld: ${forceOldVersion}`);

    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    const randomId = () => Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');

    // Use cached version if not dirty OR if user explicitly chose to use old version
    if (currentCollageFilename && (!collageIsDirty || forceOldVersion)) {
      if (isDoublePage) {
        if (currentDoubleCollageFilename && (!collageIsDirty || forceOldVersion)) {
          // Doubled version already cached — use it directly
          logger.debug(`Cache hit 2x — using ${currentDoubleCollageFilename} directly`);
          filename = currentDoubleCollageFilename;
          showToast('Using existing collage', 'success', 2000, currentDoubleCollageFilename);
        } else {
          // Load the cached single-page file and double it
          logger.debug(`Cache hit 1x + double page ON — loading ${currentCollageFilename} from disk to double`);
          const cachedPath = `${workingFolder}\\${folder}\\${currentCollageFilename}`;
          const response = await fetch(convertFileSrc(cachedPath));
          const printBytes = await doubleImageSideBySide(new Uint8Array(await response.arrayBuffer()));
          filename = `Collage_${randomId()}_2x.png`;
          await invoke('save_file_to_session_folder', {
            folderPath: workingFolder,
            sessionId: folder,
            filename,
            fileData: Array.from(printBytes),
          });
          setCurrentDoubleCollageFilename(filename);
          logger.debug(`Double page file saved and cached as: ${filename}`);
        }
      } else {
        // Use single-page file as-is
        logger.debug(`Cache hit 1x + double page OFF — using ${currentCollageFilename} directly`);
        filename = currentCollageFilename;
        showToast('Using existing collage', 'success', 2000, currentCollageFilename);
      }
    } else {
      // Set generating state to block other operations
      setIsGeneratingCollage(true);

      // Export the canvas - use photobooth export when in finalize mode, otherwise use collage export
      const exportResult = finalizeViewMode === 'finalize'
        ? await exportPhotoboothCanvasAsPNG()
        : await exportCanvasAsPNG();

      if (!exportResult) {
        showToast('Not ready yet', 'warning', 2000, 'Please wait for photos to load and try again');
        setIsPrinting(false);
        setIsGeneratingCollage(false);
        return;
      }

      filename = `Collage_${randomId()}.png`;
      setCurrentCollageFilename(filename);
      setCurrentDoubleCollageFilename(null); // single-page changed, invalidate double cache
      resetCollageDirtyState();

      // Save the single-page version as the canonical cached file
      await invoke('save_file_to_session_folder', {
        folderPath: workingFolder,
        sessionId: folder,
        filename,
        fileData: Array.from(exportResult.bytes),
      });

      setIsGeneratingCollage(false);

      // If double page mode is on, produce and cache the doubled file
      logger.debug(`Fresh export done — double page: ${isDoublePage}`);
      if (isDoublePage) {
        const printBytes = await doubleImageSideBySide(exportResult.bytes);
        const doubledFilename = `Collage_${randomId()}_2x.png`;
        await invoke('save_file_to_session_folder', {
          folderPath: workingFolder,
          sessionId: folder,
          filename: doubledFilename,
          fileData: Array.from(printBytes),
        });
        setCurrentDoubleCollageFilename(doubledFilename);
        filename = doubledFilename;
        logger.debug(`Double page file saved and cached as: ${doubledFilename}`);
      }

      showToast('Saved to session folder', 'success', 2000, `Saved as ${filename}`);
    }

    // Open Windows Photo Printing Wizard
    const fullPath = `${workingFolder}\\${folder}\\${filename}`;
    showToast('Opening Windows print dialog...', 'success', 2000);
    try {
      await invoke('print_image_with_windows_dialog', { filePath: fullPath });
    } catch (error) {
      logger.error('Failed to open Windows print dialog:', error);
      showToast('Print dialog failed', 'error', 5000, String(error));
    }

    setIsPrinting(false);
  }, [finalizeViewMode, currentCollageFilename, currentDoubleCollageFilename, collageIsDirty, exportPhotoboothCanvasAsPNG, exportCanvasAsPNG, setCurrentCollageFilename, resetCollageDirtyState, setIsGeneratingCollage, showToast, workingFolder, sessions, currentSession, doubleImageSideBySide]);

  // Print the current collage using Windows Photo Printing Wizard
  const printCollage = useCallback(async () => {
    try {
      if (isGeneratingCollage) {
        showToast('Please wait', 'warning', 2000, 'Collage is being generated...');
        return;
      }

      setIsPrinting(true);

      if (!workingFolder || !currentSession) {
        showToast('No active session', 'error', 3000, 'Please create or select a session first');
        setIsPrinting(false);
        return;
      }

      // Check if we need to prompt for regeneration
      if (finalizeViewMode === 'finalize' && currentCollageFilename && collageIsDirty) {
        setShowRegeneratePrompt(true);
        setIsPrinting(false);
        return;
      }

      await performPrint();
    } catch (error) {
      logger.error('Print failed:', error);
      showToast('Print failed', 'error', 5000, String(error));
      setIsPrinting(false);
      setIsGeneratingCollage(false);
    }
  }, [showToast, workingFolder, currentSession, finalizeViewMode, currentCollageFilename, collageIsDirty, isGeneratingCollage, performPrint]);

  const confirmRegenerate = useCallback(() => {
    setShowRegeneratePrompt(false);
    setIsPrinting(true);
    performPrint(false);
  }, [performPrint]);

  const cancelRegenerate = useCallback(() => {
    setShowRegeneratePrompt(false);
    setIsPrinting(true);
    performPrint(true);
  }, [performPrint]);

  const value: PrintSettingsContextType = {
    printCollage,
    isPrinting,
    doublePageMode,
    setDoublePageMode,
    showRegeneratePrompt,
    confirmRegenerate,
    cancelRegenerate,
  };

  return (
    <PrintSettingsContext.Provider value={value}>
      {children}
    </PrintSettingsContext.Provider>
  );
}

export function usePrintSettings() {
  const context = useContext(PrintSettingsContext);
  if (context === undefined) {
    throw new Error('usePrintSettings must be used within a PrintSettingsProvider');
  }
  return context;
}
