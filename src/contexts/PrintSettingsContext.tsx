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
}

// State for duplicate file dialog
interface DuplicateFileDialog {
  show: boolean;
  baseFilename: string;
  sessionFolder: string;
  bytes: Uint8Array;
  sessionId: string;
}

const PrintSettingsContext = createContext<PrintSettingsContextType | undefined>(undefined);

export function PrintSettingsProvider({ children }: { children: ReactNode }) {
  const { showToast } = useToast();
  const { workingFolder, currentSession, sessions } = usePhotoboothSettings();
  const { exportCanvasAsPNG } = useCollage();
  const { exportPhotoboothCanvasAsPNG, finalizeViewMode } = usePhotobooth();

  // Print operation state
  const [isPrinting, setIsPrinting] = useState(false);

  // Duplicate file dialog state
  const [duplicateDialog, setDuplicateDialog] = useState<DuplicateFileDialog>({
    show: false,
    baseFilename: '',
    sessionFolder: '',
    bytes: new Uint8Array(),
    sessionId: '',
  });

  // Helper: Check if file exists in session folder
  const checkFileExists = useCallback(async (filename: string, sessionId: string): Promise<boolean> => {
    try {
      return await invoke('file_exists_in_session', {
        folderPath: workingFolder,
        sessionId,
        filename,
      });
    } catch {
      return false;
    }
  }, [workingFolder]);

  // Helper: Check if file exists and get next available number
  const getAvailableFilename = useCallback(async (baseFilename: string, sessionId: string): Promise<string> => {
    // Extract base name without extension
    const nameWithoutExt = baseFilename.replace('.png', '');
    let counter = 1;
    let filename = baseFilename;

    // Check if filename exists by checking filesystem
    while (await checkFileExists(filename, sessionId)) {
      filename = `${nameWithoutExt}_${counter}.png`;
      counter++;
      if (counter > 100) break; // Safety limit
    }

    return filename;
  }, [checkFileExists]);

  // Helper: Save file and print using Windows Photo Printing Wizard
  const saveAndPrint = useCallback(async (filename: string, bytes: Uint8Array, sessionId: string, sessionFolder: string) => {
    const fileData = Array.from(bytes);

    // Use save_file_to_session_folder to avoid adding collages to the photo list
    await invoke('save_file_to_session_folder', {
      folderPath: workingFolder,
      sessionId,
      filename,
      fileData,
    });

    console.log('Photo saved successfully to session folder');
    showToast('Saved to session folder', 'success', 2000, `Saved as ${filename}`);

    // Build the full file path for printing
    const fullPath = `${workingFolder}\\${sessionId}\\${filename}`;

    // Now invoke the Windows Photo Printing Wizard
    showToast('Opening Windows print dialog...', 'success', 2000);
    try {
      await invoke('print_image_with_windows_dialog', {
        filePath: fullPath,
      });
    } catch (error) {
      console.error('Failed to open Windows print dialog:', error);
      showToast('Print dialog failed', 'error', 5000, String(error));
    }
  }, [showToast, workingFolder]);

  // Handle replacing existing file
  const handleReplace = useCallback(async () => {
    const { baseFilename, bytes, sessionId, sessionFolder } = duplicateDialog;
    setDuplicateDialog(prev => ({ ...prev, show: false }));
    await saveAndPrint(baseFilename, bytes, sessionId, sessionFolder);
    setIsPrinting(false);
  }, [duplicateDialog, saveAndPrint]);

  // Handle creating new file with number
  const handleAppend = useCallback(async () => {
    const { baseFilename, bytes, sessionId } = duplicateDialog;
    const sessionFolder = sessions.find(s => s.id === sessionId)?.folderName || sessionId;
    const newFilename = await getAvailableFilename(baseFilename, sessionId);
    setDuplicateDialog(prev => ({ ...prev, show: false }));
    await saveAndPrint(newFilename, bytes, sessionId, sessionFolder);
    setIsPrinting(false);
  }, [duplicateDialog, getAvailableFilename, saveAndPrint, sessions]);

  // Handle cancel
  const handleCancel = useCallback(() => {
    setDuplicateDialog(prev => ({ ...prev, show: false }));
    setIsPrinting(false);
  }, []);

  // Print the current collage using browser print API
  const printCollage = useCallback(async () => {
    try {
      setIsPrinting(true);

      // First check if we have required context
      if (!workingFolder || !currentSession) {
        showToast('No active session', 'error', 3000, 'Please create or select a session first');
        setIsPrinting(false);
        return;
      }

      console.log('=== Print Debug Info ===');
      console.log('Working Folder:', workingFolder);
      console.log('Current Session:', currentSession);

      // Export the canvas first - use photobooth export when in finalize mode, otherwise use collage export
      const exportResult = finalizeViewMode === 'finalize'
        ? await exportPhotoboothCanvasAsPNG()
        : await exportCanvasAsPNG();

      if (!exportResult) {
        showToast('Canvas not found', 'error', 3000, 'Could not find the collage canvas');
        setIsPrinting(false);
        return;
      }

      const { bytes } = exportResult;

      const sessionName = currentSession.name || 'Unknown Session';
      const sessionFolder = sessions.find(s => s.id === currentSession.id)?.folderName || currentSession.id;
      const baseFilename = `${sessionName}_collage.png`;

      // Check if file already exists in filesystem
      const fileExists = await checkFileExists(baseFilename, currentSession.id);

      if (fileExists) {
        // Show duplicate file dialog
        setDuplicateDialog({
          show: true,
          baseFilename,
          sessionFolder,
          bytes,
          sessionId: currentSession.id,
        });
        // Don't setIsPrinting(false) here - waiting for user choice
        return;
      }

      // File doesn't exist, save and print directly
      await saveAndPrint(baseFilename, bytes, currentSession.id, sessionFolder);
      setIsPrinting(false);

    } catch (error) {
      console.error('Print failed:', error);
      showToast('Print failed', 'error', 5000, String(error));
      setIsPrinting(false);
    }
  }, [showToast, workingFolder, currentSession, exportCanvasAsPNG, exportPhotoboothCanvasAsPNG, finalizeViewMode, sessions, saveAndPrint, checkFileExists]);

  const value: PrintSettingsContextType = {
    printCollage,
    isPrinting,
  };

  return (
    <PrintSettingsContext.Provider value={value}>
      {children}
      {/* Duplicate File Dialog */}
      {duplicateDialog.show && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 9999,
        }}>
          <div style={{
            backgroundColor: 'var(--bg-primary)',
            border: '1px solid var(--border-color)',
            borderRadius: '8px',
            padding: '24px',
            maxWidth: '400px',
            width: '90%',
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
          }}>
            <h3 style={{
              margin: '0 0 16px 0',
              fontSize: '16px',
              fontWeight: '600',
              color: 'var(--text-primary)',
            }}>
              File Already Exists
            </h3>
            <p style={{
              margin: '0 0 24px 0',
              fontSize: '14px',
              color: 'var(--text-secondary)',
              lineHeight: '1.5',
            }}>
              The file "<strong style={{ color: 'var(--text-primary)' }}>{duplicateDialog.baseFilename}</strong>" already exists in this session. What would you like to do?
            </p>
            <div style={{
              display: 'flex',
              gap: '12px',
              justifyContent: 'flex-end',
            }}>
              <button
                onClick={handleCancel}
                style={{
                  padding: '10px 16px',
                  background: 'var(--bg-tertiary)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '4px',
                  color: 'var(--text-primary)',
                  fontSize: '14px',
                  fontWeight: '500',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
                onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-secondary)'}
                onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-tertiary)'}
              >
                Cancel
              </button>
              <button
                onClick={handleReplace}
                style={{
                  padding: '10px 16px',
                  background: '#ef4444',
                  border: 'none',
                  borderRadius: '4px',
                  color: 'white',
                  fontSize: '14px',
                  fontWeight: '500',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = '#dc2626'}
                onMouseLeave={(e) => e.currentTarget.style.background = '#ef4444'}
              >
                Replace
              </button>
              <button
                onClick={handleAppend}
                style={{
                  padding: '10px 16px',
                  background: 'var(--accent-blue)',
                  border: 'none',
                  borderRadius: '4px',
                  color: 'white',
                  fontSize: '14px',
                  fontWeight: '500',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = 'var(--accent-blue-hover)'}
                onMouseLeave={(e) => e.currentTarget.style.background = 'var(--accent-blue)'}
              >
                Create New
              </button>
            </div>
          </div>
        </div>
      )}
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
