import { createContext, useContext, useState, useCallback, ReactNode } from "react";
import { useToast } from './ToastContext';
import { invoke } from '@tauri-apps/api/core';
import { usePhotoboothSettings } from './PhotoboothSettingsContext';
import { useCollage } from './CollageContext';
import { usePhotobooth } from './PhotoboothContext';

interface PrintSettingsContextType {
  // Print operation
  printCollage: () => Promise<void>;
  isPrinting: boolean;
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
  const [pendingPrintAction, setPendingPrintAction] = useState<(() => void) | null>(null);

  // Print the current collage using Windows Photo Printing Wizard
  const printCollage = useCallback(async () => {
    try {
      // Check if another operation is already generating
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
        // Store the pending print action and show prompt
        setPendingPrintAction(() => async () => {
          await performPrint();
        });
        setShowRegeneratePrompt(true);
        setIsPrinting(false);
        return;
      }

      // Proceed with normal print flow
      await performPrint();
    } catch (error) {
      console.error('Print failed:', error);
      showToast('Print failed', 'error', 5000, String(error));
      setIsPrinting(false);
      setIsGeneratingCollage(false);
    }
  }, [showToast, workingFolder, currentSession, sessions, finalizeViewMode, currentCollageFilename, collageIsDirty, isGeneratingCollage]);

  // Actual print execution (extracted for reuse)
  const performPrint = useCallback(async () => {
    if (!currentSession || !workingFolder) {
      showToast('No active session', 'error', 3000, 'Please create or select a session first');
      return;
    }

    const folder = sessions.find((s: any) => s.id === currentSession.id)?.folderName || currentSession.id;
    let filename: string;

    if (finalizeViewMode === 'finalize' && currentCollageFilename && !collageIsDirty) {
      // Collage already saved to disk — skip re-export
      filename = currentCollageFilename;
      showToast('Using cached collage', 'success', 2000, currentCollageFilename);
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

      const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
      const randomStr = Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
      filename = `Collage_${randomStr}.png`;
      setCurrentCollageFilename(filename);
      resetCollageDirtyState();

      // Save to session folder
      await invoke('save_file_to_session_folder', {
        folderPath: workingFolder,
        sessionId: folder,
        filename,
        fileData: Array.from(exportResult.bytes),
      });

      // Clear generating state after save
      setIsGeneratingCollage(false);

      showToast('Saved to session folder', 'success', 2000, `Saved as ${filename}`);
    }

    // Open Windows Photo Printing Wizard
    const fullPath = `${workingFolder}\\${folder}\\${filename}`;
    showToast('Opening Windows print dialog...', 'success', 2000);
    try {
      await invoke('print_image_with_windows_dialog', { filePath: fullPath });
    } catch (error) {
      console.error('Failed to open Windows print dialog:', error);
      showToast('Print dialog failed', 'error', 5000, String(error));
    }

    setIsPrinting(false);
  }, [finalizeViewMode, currentCollageFilename, collageIsDirty, exportPhotoboothCanvasAsPNG, exportCanvasAsPNG, setCurrentCollageFilename, resetCollageDirtyState, setIsGeneratingCollage, showToast, workingFolder, sessions, currentSession]);

  const confirmRegenerate = useCallback(() => {
    setShowRegeneratePrompt(false);
    if (pendingPrintAction) {
      setIsPrinting(true);
      pendingPrintAction();
      setPendingPrintAction(null);
    }
  }, [pendingPrintAction]);

  const cancelRegenerate = useCallback(() => {
    setShowRegeneratePrompt(false);
    setPendingPrintAction(null);
    setIsPrinting(false);
  }, []);

  const value: PrintSettingsContextType = {
    printCollage,
    isPrinting,
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
