import { useState, useEffect } from "react";
import { AnimatePresence } from "framer-motion";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useAuth } from "./contexts";
import { useQR } from "./contexts";
import { formatFileSize } from "./utils/format";
import { useGalleryState } from "./hooks";
import { useTauriInit, useTauriEvents } from "./hooks";
import { useAuthHandlers } from "./hooks";
import { useDriveFolderPicker } from "./hooks/";
import { useQRUpload } from "./hooks";
import { useUpdateCheck } from "./hooks";
import Header from "./components/Header/Header";
import { AboutModal } from "./components/Modals";
import {FolderPickerModal} from "./components/Modals";
import {AddPhotosModal} from "./components/Modals";
import {CachedAccountModal} from "./components/Modals";
import {DeleteFolderModal} from "./components/Modals";
import {RequirementsModal} from "./components/Modals";
import {CleanupModal} from "./components/Modals";
import {UpdateModal} from "./components/Modals";
import { CollageWorkspace } from "./components/Canvas";
import Sidebar from "./components/Sidebar/Sidebar";
import { QRSidebar } from "./components/Sidebar/QR";
import { PhotoboothSidebar } from "./components/Sidebar/Photobooth";
import QRView from "./components/QRView/QRView";
import PhotoboothWorkspace from "./components/PhotoboothView/PhotoboothWorkspace";
import { createLogger } from './utils/logger';
import "./App.css";

type AppMode = 'photobooth' | 'collage' | 'qr';

const logger = createLogger('App');


interface SystemRequirements {
  virtualbox_installed: boolean;
  virtualbox_version: string | null;
  bundled_installer_available: boolean;
  recommendations: string[];
}

interface RequirementCheck {
  passed: boolean;
  requirements: SystemRequirements;
}

function App() {
  // Context hooks - using contexts for auth, QR, etc.
  const {
    account, setAccount,
    rootFolder, setRootFolder,
    setLoggingIn,
    cachedAccount, setCachedAccount,
    showCachedAccountConfirm, setShowCachedAccountConfirm
  } = useAuth();

  const {
    uploadProgress, setUploadProgress
  } = useQR();

  // Update check hook - auto-checks for updates on startup
  const {
    versionStatus,
    showUpdateModal,
    setShowUpdateModal,
    updateTarget,
    setUpdateTarget,
    checkForUpdates,
    showUpdateFor,
  } = useUpdateCheck({ autoCheck: true });

  // Gallery state hook (handles images, thumbnails, drag-drop)
  const gallery = useGalleryState();

  // App mode state
  const [appMode, setAppMode] = useState<AppMode>('photobooth');

  // UI state
  const [showAccountMenu, setShowAccountMenu] = useState(false);
  const [showAppMenu, setShowAppMenu] = useState(false);
  const [showAboutModal, setShowAboutModal] = useState(false);
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [showRequirementsModal, setShowRequirementsModal] = useState(false);
  const [requirementsChecked, setRequirementsChecked] = useState(false);
  const [systemRequirements, setSystemRequirements] = useState<SystemRequirements | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showCleanup, setShowCleanup] = useState(false);

  // Track fullscreen state to disable drag region
  useEffect(() => {
    const appWindow = getCurrentWindow();
    const checkFullscreen = async () => {
      setIsFullscreen(await appWindow.isFullscreen());
    };
    const unlisten = appWindow.onResized(() => {
      checkFullscreen();
    });
    return () => { unlisten.then(fn => fn()); };
  }, []);

  // Disable right-click context menu globally
  useEffect(() => {
    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
    };
    document.addEventListener('contextmenu', handleContextMenu);
    return () => document.removeEventListener('contextmenu', handleContextMenu);
  }, []);

  // Disable Ctrl+R / F5 reload in production
  useEffect(() => {
    if (import.meta.env.DEV) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey && e.key === 'r') || e.key === 'F5') {
        e.preventDefault();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  // F11 to toggle fullscreen (global, works in all modes)
  useEffect(() => {
    const handleKeyDown = async (e: KeyboardEvent) => {
      if (e.key === 'F11') {
        e.preventDefault();
        const appWindow = getCurrentWindow();
        const fs = await appWindow.isFullscreen();
        await appWindow.setFullscreen(!fs);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Listen for window close event from backend to show cleanup modal
  useEffect(() => {
    const unlisten = listen('cleanup-requested', () => {
      setShowCleanup(true);
    });
    return () => { unlisten.then(fn => fn()); };
  }, []);

  // Check system requirements on mount
  useEffect(() => {
    const checkRequirements = async () => {
      try {
        const result: RequirementCheck = await invoke('get_system_requirements');
        setSystemRequirements(result.requirements);
        // Only show modal if VirtualBox is not installed
        if (!result.passed) {
          setShowRequirementsModal(true);
        }
      } catch (e) {
        logger.error('Failed to check system requirements:', e);
      }
      setRequirementsChecked(true);
    };
    checkRequirements();
  }, []);

  // Tauri initialization hooks
  const { tauriReady } = useTauriInit({
    setAccount,
    setRootFolder,
  });

  useTauriEvents({
    tauriReady,
    setUploadProgress,
  });

  // Auth handlers hook
  const {
    handleLogin,
    handleConfirmCachedAccount: handleConfirmCachedAccountAuth,
    handleUseDifferentAccount,
    handleCancelLogin,
    handleLogout,
  } = useAuthHandlers({
    setAccount,
    setRootFolder,
    setLoggingIn,
    setCachedAccount,
    setShowCachedAccountConfirm,
    setShowAccountMenu,
    setError: () => {},
  });

  // Drive folder picker hook
  const driveFolderPicker = useDriveFolderPicker(setRootFolder);

  // QR upload hook
  const qrUpload = useQRUpload({
    photosPath: gallery.photosPath,
    imagePaths: gallery.imagePaths,
    selectedImages: gallery.selectedImages,
    assetUrlToFilePath: gallery.assetUrlToFilePath,
    noPreviewImages: gallery.noPreviewImages,
    setUploadProgress,
  });

  // Cached account confirmation handlers
  const handleConfirmCachedAccount = async () => {
    await handleConfirmCachedAccountAuth(cachedAccount);
  };

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = () => {
      if (showAccountMenu) {
        setShowAccountMenu(false);
      }
      if (showAppMenu) {
        setShowAppMenu(false);
      }
    };

    if (showAccountMenu || showAppMenu) {
      document.addEventListener('click', handleClickOutside);
      return () => document.removeEventListener('click', handleClickOutside);
    }
  }, [showAccountMenu, showAppMenu]);

  // F1 toggles the logo/app menu
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F1') {
        e.preventDefault();
        setShowAppMenu(prev => !prev);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Wrapper handlers for gallery operations (close menu after)
  const handleAddSingleImage = async () => {
    await gallery.handleAddSingleImage();
    setShowAddMenu(false);
  };

  const handleAddFromFolder = async () => {
    await gallery.handleAddFromFolder();
    qrUpload.handleNew(); // Clear previous result when loading new folder
    setShowAddMenu(false);
  };

  // QR-specific helper functions
  const handleSelectDriveFolder = async () => {
    if (!account) {
      driveFolderPicker.setError("Please sign in with Google first");
      return;
    }
    await driveFolderPicker.openFolderPicker();
  };

  const handleAddPhotos = () => {
    setShowAddMenu(true);
  };

  const handleGenerate = async () => {
    await qrUpload.handleGenerate(rootFolder);
  };

  const handleExit = () => {
    setShowCleanup(true);
  };

  return (
    <div className={`app-window${isFullscreen ? ' is-fullscreen' : ''}`}>
      {/* Header */}
      <Header
        showAccountMenu={showAccountMenu}
        setShowAccountMenu={setShowAccountMenu}
        showAppMenu={showAppMenu}
        setShowAppMenu={setShowAppMenu}
        onShowAbout={() => setShowAboutModal(true)}
        onLogout={handleLogout}
        onLogin={handleLogin}
        onCancelLogin={handleCancelLogin}
        onExit={handleExit}
        mode={appMode}
        setMode={setAppMode}
      />

      {/* Photobooth Mode Divider */}
      {appMode === 'photobooth' && <div className="photobooth-page-divider" />}

      {/* Main Content */}
      <div className="app-content">
        {appMode === 'qr' ? (
          <QRSidebar
            account={account}
            rootFolder={rootFolder}
            selectedImages={gallery.selectedImages}
            noPreviewImages={gallery.noPreviewImages}
            loading={qrUpload.loading}
            error={qrUpload.error || driveFolderPicker.error}
            uploadProgress={uploadProgress}
            onSelectDriveFolder={handleSelectDriveFolder}
            onAddPhotos={handleAddPhotos}
            onGenerate={handleGenerate}
            onCancelUpload={qrUpload.handleCancelUpload}
          />
        ) : appMode === 'photobooth' ? (
          <PhotoboothSidebar />
        ) : (
          <Sidebar />
        )}

        <div className="main-panel">
          {/* Main Content Area - Mode-based rendering */}
          <div className="tab-content">
            {appMode === 'qr' ? (
              <QRView
                result={qrUpload.result}
                selectedImages={gallery.selectedImages}
                noPreviewImages={gallery.noPreviewImages}
                loadedImages={gallery.loadedImages}
                isDragging={gallery.isDragging}
                processingImages={gallery.processingImages}
                onCopyLink={qrUpload.handleCopyLink}
                onNew={async () => {
                  await gallery.clearGallery();
                  qrUpload.handleNew();
                }}
                onBack={qrUpload.handleNew}
                onRemoveImage={gallery.handleRemoveImage}
                onRemoveNoPreviewImage={gallery.handleRemoveNoPreviewImage}
                onImageLoaded={gallery.handleImageLoaded}
                onDragOver={gallery.handleDragOver}
                onDragLeave={gallery.handleDragLeave}
                onDrop={gallery.handleDrop}
                formatFileSize={formatFileSize}
              />
            ) : appMode === 'photobooth' ? (
              <PhotoboothWorkspace />
            ) : (
              <CollageWorkspace />
            )}
          </div>
        </div>
      </div>

      {/* Folder Picker Modal */}
      <AnimatePresence>
        {driveFolderPicker.showFolderPicker && (
          <FolderPickerModal
            show={driveFolderPicker.showFolderPicker}
            onClose={() => driveFolderPicker.setShowFolderPicker(false)}
            driveFolders={driveFolderPicker.driveFolders}
            loadingFolders={driveFolderPicker.loadingFolders}
            folderPath={driveFolderPicker.folderPath}
            newFolderName={driveFolderPicker.newFolderName}
            creatingFolder={driveFolderPicker.creatingFolder}
            onSetNewFolderName={driveFolderPicker.setNewFolderName}
            onFetchFolders={driveFolderPicker.fetchFolders}
            onNavigateFolder={driveFolderPicker.handleNavigateFolder}
            onNavigateUp={driveFolderPicker.handleNavigateUp}
            onConfirmSelection={driveFolderPicker.handleConfirmSelection}
            onSelectCurrentDir={driveFolderPicker.handleSelectCurrentDir}
            onCreateFolder={driveFolderPicker.handleCreateFolder}
            onDeleteFolder={driveFolderPicker.handleDeleteFolder}
          />
        )}
      </AnimatePresence>

      {/* Add Photos Modal */}
      <AnimatePresence>
        {showAddMenu && (
          <AddPhotosModal
            show={showAddMenu}
            onClose={() => setShowAddMenu(false)}
            onAddSingleImage={handleAddSingleImage}
            onAddFromFolder={handleAddFromFolder}
          />
        )}
      </AnimatePresence>

      {/* Delete Confirmation Modal */}
      <AnimatePresence>
        {driveFolderPicker.showDeleteConfirm && driveFolderPicker.folderToDelete && (
          <DeleteFolderModal
            show={driveFolderPicker.showDeleteConfirm}
            folderToDelete={driveFolderPicker.folderToDelete}
            deleting={driveFolderPicker.deleting}
            onCancel={driveFolderPicker.cancelDelete}
            onConfirm={driveFolderPicker.confirmDeleteFolder}
          />
        )}
      </AnimatePresence>

      {/* Cached Account Confirmation Modal */}
      <AnimatePresence>
        {showCachedAccountConfirm && cachedAccount && (
          <CachedAccountModal
            show={showCachedAccountConfirm}
            cachedAccount={cachedAccount}
            onClose={() => {
              setShowCachedAccountConfirm(false);
              setCachedAccount(null);
            }}
            onConfirm={handleConfirmCachedAccount}
            onUseDifferent={handleUseDifferentAccount}
          />
        )}
      </AnimatePresence>



       {/* About Modal */}
      <AnimatePresence>
        {showAboutModal && (
          <AboutModal
            show={showAboutModal}
            onClose={() => setShowAboutModal(false)}
            versionStatus={versionStatus}
            onCheckUpdates={checkForUpdates}
            onShowUpdate={showUpdateFor}
          />
        )}
      </AnimatePresence>

      {/* Update Modal */}
      <AnimatePresence>
        {showUpdateModal && versionStatus && (
          <UpdateModal
            show={showUpdateModal}
            onClose={() => setShowUpdateModal(false)}
            updateType={updateTarget}
            versionStatus={versionStatus}
          />
        )}
      </AnimatePresence>

      {/* System Requirements Modal */}
      <AnimatePresence>
        {showRequirementsModal && systemRequirements && (
          <RequirementsModal
            show={showRequirementsModal}
            onClose={() => setShowRequirementsModal(false)}
            virtualboxInstalled={systemRequirements.virtualbox_installed}
            virtualboxVersion={systemRequirements.virtualbox_version ?? undefined}
            bundledInstallerAvailable={systemRequirements.bundled_installer_available}
          />
        )}
      </AnimatePresence>

      {/* Cleanup Modal - shown when exiting */}
      <CleanupModal show={showCleanup} onCancel={() => setShowCleanup(false)} />
    </div>
  );
}

export default App;
