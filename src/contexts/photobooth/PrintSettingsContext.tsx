import { createContext, useContext, useState, useCallback, useEffect, useRef, ReactNode } from "react";
import { useToast } from "../system";
import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { useWorkspaceSettings } from './PhotoboothWorkspaceSettingsContext';
import { usePhotoboothSession } from './PhotoboothSessionContext';
import { useCollage } from "../collage";
import { usePhotobooth } from './PhotoboothContext';
import { createLogger } from '../../utils/logger';
import * as fs from '@tauri-apps/plugin-fs';

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
  const { workingFolder } = useWorkspaceSettings();
  const { currentSession, sessions } = usePhotoboothSession();
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
  // Cache the actual bytes to avoid disk read + decode for double page creation
  const cachedCollageBytesRef = useRef<Uint8Array | null>(null);
  const cachedDoubleBytesRef = useRef<Uint8Array | null>(null);

  const setDoublePageMode = useCallback((value: boolean) => {
    doublePageModeRef.current = value;
    setDoublePageModeRaw(value);
  }, []);

  // Fast file save using Tauri FS plugin (bypasses Rust IPC for direct write)
  const saveFileDirect = useCallback(async (
    folderPath: string,
    sessionId: string,
    filename: string,
    bytes: Uint8Array
  ): Promise<void> => {
    const start = performance.now();
    const sessionPath = `${folderPath}/${sessionId}`;

    // Ensure directory exists
    await fs.mkdir(sessionPath, { recursive: true });

    // Write file directly (no IPC data transfer - much faster)
    const filePath = `${sessionPath}/${filename}`;
    await fs.writeFile(filePath, bytes);

  }, []);

  // When the single-page cache is cleared (e.g. back navigation), clear the double cache too
  useEffect(() => {
    if (currentCollageFilename === null) {
      setCurrentDoubleCollageFilename(null);
      cachedCollageBytesRef.current = null;
      cachedDoubleBytesRef.current = null;
    }
  }, [currentCollageFilename]);

  // Creates a side-by-side doubled image (2× wide) from PNG bytes (optimized with ImageBitmap)
  const doubleImageSideBySide = useCallback(async (bytes: Uint8Array): Promise<Uint8Array> => {
    const blob = new Blob([bytes as unknown as BlobPart], { type: 'image/png' });
    const bitmap = await createImageBitmap(blob);

    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width * 2;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('Canvas context unavailable');

    ctx.drawImage(bitmap, 0, 0);
    ctx.drawImage(bitmap, bitmap.width, 0);
    bitmap.close();

    const resultBlob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((b) => b ? resolve(b) : reject(new Error('toBlob failed')), 'image/png');
    });

    const buffer = await resultBlob.arrayBuffer();
    return new Uint8Array(buffer);
  }, []);

  // Actual print execution (extracted for reuse)
  const performPrint = useCallback(async (forceOldVersion = false) => {
    const totalStart = performance.now();

    if (!currentSession || !workingFolder) {
      showToast('No active session', 'error', 3000, 'Please create or select a session first');
      return;
    }

    const folder = sessions.find((s: any) => s.id === currentSession.id)?.folderName || currentSession.id;
    let filename: string;

    const isDoublePage = doublePageModeRef.current;

    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    const randomId = () => Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');

    // Use cached version if not dirty OR if user explicitly chose to use old version
    if (currentCollageFilename && (!collageIsDirty || forceOldVersion)) {
      if (isDoublePage) {
        if (currentDoubleCollageFilename && (!collageIsDirty || forceOldVersion) && cachedDoubleBytesRef.current) {
          // Doubled version already cached — use it directly
          filename = currentDoubleCollageFilename;
          showToast('Using existing collage', 'success', 2000, currentDoubleCollageFilename);
        } else if (cachedCollageBytesRef.current) {
          // Use cached bytes to double without disk read + decode
          const printBytes = await doubleImageSideBySide(cachedCollageBytesRef.current);
          filename = `Collage_${randomId()}_2x.png`;

          await saveFileDirect(workingFolder, folder, filename, printBytes);

          setCurrentDoubleCollageFilename(filename);
          cachedDoubleBytesRef.current = printBytes;
        } else {
          // Fallback: Load the cached single-page file and double it
          const loadStart = performance.now();
          const cachedPath = `${workingFolder}\\${folder}\\${currentCollageFilename}`;
          const response = await fetch(convertFileSrc(cachedPath));
          const arrayBuffer = await response.arrayBuffer();

          const printBytes = await doubleImageSideBySide(new Uint8Array(arrayBuffer));
          filename = `Collage_${randomId()}_2x.png`;

          await saveFileDirect(workingFolder, folder, filename, printBytes);
          setCurrentDoubleCollageFilename(filename);
          cachedDoubleBytesRef.current = printBytes;
        }
      } else {
        // Use single-page file as-is
        filename = currentCollageFilename;
        showToast('Using existing collage', 'success', 2000, currentCollageFilename);
      }
    } else {
      // Set generating state to block other operations
      setIsGeneratingCollage(true);

      // Export the canvas - use photobooth export when in finalize mode, otherwise use collage export
      const exportStart = performance.now();
      const exportResult = finalizeViewMode === 'finalize'
        ? await exportPhotoboothCanvasAsPNG()
        : await exportCanvasAsPNG();
      logger.debug(`[performPrint] Canvas export: ${(performance.now() - exportStart).toFixed(0)}ms`);

      if (!exportResult) {
        showToast('Not ready yet', 'warning', 2000, 'Please wait for photos to load and try again');
        setIsPrinting(false);
        setIsGeneratingCollage(false);
        return;
      }

      filename = `Collage_${randomId()}.png`;
      setCurrentCollageFilename(filename);
      setCurrentDoubleCollageFilename(null);
      cachedCollageBytesRef.current = exportResult.bytes;
      cachedDoubleBytesRef.current = null;
      resetCollageDirtyState();

      // Save the single-page version as the canonical cached file
      const saveStart = performance.now();
      await saveFileDirect(workingFolder, folder, filename, exportResult.bytes);

      logger.debug(`[performPrint] File save (${(exportResult.bytes.length / 1024 / 1024).toFixed(1)}MB): ${(performance.now() - saveStart).toFixed(0)}ms`);

      setIsGeneratingCollage(false);

      // If double page mode is on, produce and cache the doubled file
      if (isDoublePage) {
        const doubleStart = performance.now();
        const printBytes = await doubleImageSideBySide(exportResult.bytes);

        const doubledFilename = `Collage_${randomId()}_2x.png`;
        await saveFileDirect(workingFolder, folder, doubledFilename, printBytes);

        setCurrentDoubleCollageFilename(doubledFilename);
        cachedDoubleBytesRef.current = printBytes;
        filename = doubledFilename;
      }

      showToast('Saved to session folder', 'success', 2000, `Saved as ${filename}`);
    }

    // Open Windows Photo Printing Wizard
    const fullPath = `${workingFolder}\\${folder}\\${filename}`;
    showToast('Opening Windows print dialog...', 'success', 2000);
    const dialogStart = performance.now();
    try {
      await invoke('print_image_with_windows_dialog', { filePath: fullPath });
    } catch (error) {
      logger.error('Failed to open Windows print dialog:', error);
      showToast('Print dialog failed', 'error', 5000, String(error));
    }

    setIsPrinting(false);
  }, [finalizeViewMode, currentCollageFilename, currentDoubleCollageFilename, collageIsDirty, exportPhotoboothCanvasAsPNG, exportCanvasAsPNG, setCurrentCollageFilename, resetCollageDirtyState, setIsGeneratingCollage, showToast, workingFolder, sessions, currentSession, doubleImageSideBySide, saveFileDirect]);

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
