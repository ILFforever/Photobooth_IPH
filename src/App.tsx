import { useState, useEffect } from "react";
import { AnimatePresence } from "framer-motion";
import { useAuth } from "./contexts/AuthContext";
import { useQR } from "./contexts/QRContext";
import { formatFileSize, formatDate } from "./utils/format";
import { useGalleryState } from "./hooks/useGalleryState";
import { useTauriInit, useTauriEvents } from "./hooks/useTauriInit";
import { useAuthHandlers } from "./hooks/useAuthHandlers";
import { useDriveFolderPicker } from "./hooks/useDriveFolderPicker";
import { useQRUpload } from "./hooks/useQRUpload";
import Header from "./components/Header/Header";
import HistoryModal from "./components/Modals/HistoryModal";
import AboutModal from "./components/Modals/AboutModal";
import FolderPickerModal from "./components/Modals/FolderPickerModal";
import AddPhotosModal from "./components/Modals/AddPhotosModal";
import CachedAccountModal from "./components/Modals/CachedAccountModal";
import DeleteFolderModal from "./components/Modals/DeleteFolderModal";
import CollageWorkspace from "./components/Canvas/CollageWorkspace";
import Sidebar from "./components/Sidebar/Sidebar";
import QRSidebar from "./components/Sidebar/QRSidebar";
import QRView from "./components/QRView/QRView";
import "./App.css";

type AppMode = 'photobooth' | 'collage' | 'qr';

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
    setHistory: setHistoryItems,
    showHistoryModal, setShowHistoryModal,
    uploadProgress, setUploadProgress
  } = useQR();

  // Gallery state hook (handles images, thumbnails, drag-drop)
  const gallery = useGalleryState();

  // App mode state
  const [appMode, setAppMode] = useState<AppMode>('collage');

  // UI state
  const [showAccountMenu, setShowAccountMenu] = useState(false);
  const [showAppMenu, setShowAppMenu] = useState(false);
  const [showAboutModal, setShowAboutModal] = useState(false);
  const [showAddMenu, setShowAddMenu] = useState(false);

  // Tauri initialization hooks
  const { tauriReady } = useTauriInit({
    setAccount,
    setRootFolder,
  });

  useTauriEvents({
    tauriReady,
    setHistory: setHistoryItems,
    showHistoryModal,
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

  return (
    <div className="app-window">
      {/* Header */}
      <Header
        showAccountMenu={showAccountMenu}
        setShowAccountMenu={setShowAccountMenu}
        showAppMenu={showAppMenu}
        setShowAppMenu={setShowAppMenu}
        onShowHistory={() => setShowHistoryModal(true)}
        onShowAbout={() => setShowAboutModal(true)}
        onLogout={handleLogout}
        onLogin={handleLogin}
        onCancelLogin={handleCancelLogin}
        mode={appMode}
        setMode={setAppMode}
      />

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

      {/* History Modal */}
      <AnimatePresence>
        {showHistoryModal && (
          <HistoryModal
            show={showHistoryModal}
            onClose={() => setShowHistoryModal(false)}
            formatDate={formatDate}
          />
        )}
      </AnimatePresence>
 
       {/* About Modal */}
      <AnimatePresence>
        {showAboutModal && (
          <AboutModal
            show={showAboutModal}
            onClose={() => setShowAboutModal(false)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

export default App;
