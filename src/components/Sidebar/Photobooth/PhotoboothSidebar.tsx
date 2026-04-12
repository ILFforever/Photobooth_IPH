import { useState, useRef, useCallback, useEffect } from "react";
import { Printer, QrCode, Film, Image as ImageIcon } from "lucide-react";
import { open } from '@tauri-apps/plugin-dialog';
import { CameraSection } from "./CameraSection";
import { LiveViewSection } from "./LiveViewSection";
import { ImageQuality } from "./ImageQuality";
import { FocusSettings } from "./FocusSettings";
import { ConnectionLostModal } from "../../Modals";
import { ConfirmDialog } from "../../Modals";
import { FolderPickerModal, DeleteFolderModal } from "../../Modals";
import { useCamera, useVM, useCaptureTiming, useWorkspaceSettings, useToast } from "../../../contexts";
import { usePhotobooth } from "../../../contexts/";
import { usePrintSettings } from "../../../contexts/";
import { useAuth } from "../../../contexts/";
import { useDriveFolderPicker } from "../../../hooks/";
import { useVmLogs } from "../../../hooks/";
import { useCameraSettings } from "../../../hooks/";
import { useCustomSets } from "../../../hooks/";
import type { ConnectionState } from "../../../types/connection";
import {
  EditTabContent,
  GifSettingsSection,
  GifTabContent,
  PrintTabContent,
  QrSettingsSection,
  QrTabContent,
} from "./tabs";
import {
  ConnectionInfoSection,
  CustomSetsSection,
  NamingSchemeSection,
  PhotoboothSettingsSection,
  PrintSettingsSection,
  WorkingFolderSection,
} from "./sections";
import {
  LedInfoModal,
  QrInfoModal,
  VmLogsModal,
} from "./modals";
import "./PhotoboothSidebar.css";
import { createLogger } from '../../../utils/logger';
const logger = createLogger('PhotoboothSidebar');

interface PhotoboothSidebarProps {
  shutterSpeeds?: string[];
  apertureValues?: string[];
  isoValues?: string[];
}

type PhotoboothTab = 'camera' | 'photobooth' | 'print' | 'qr' | 'gif' | 'edit';
type CollapsibleSection = 'camera' | 'liveview' | 'connection' | 'polling' | 'folder' | 'photobooth' | 'frame' | 'session' | 'naming' | 'qr' | 'gif' | 'print';
type SettingType = 'shutter' | 'aperture' | 'iso' | 'ev' | 'wb' | 'metering' | 'folder' | 'mode' | null;

export default function PhotoboothSidebar(props: PhotoboothSidebarProps) {
  const {
    isCameraConnected,
    connectionState,
    isConnecting,
    isDownloading,
    setDownloading,
    reconnect,
    disconnect,
  } = useCamera();
  const { isVmOnline } = useVM();
  const { showToast } = useToast();
  const { account, rootFolder: sessionDriveRootFolder, setRootFolder: setSessionDriveRootFolder } = useAuth();
  const {
    finalizeViewMode: viewMode,
    finalizeEditingZoneId: editingZoneId,
    setFinalizeEditingZoneId,
    placedImages,
    updatePlacedImage,
  } = usePhotobooth();

  // Extracted hooks
  const vmLogs = useVmLogs();
  const cameraSettings = useCameraSettings(props.shutterSpeeds);
  const customSetsHook = useCustomSets();

  // Photobooth settings
  const { autoCount, setAutoCount, timerDelay, setTimerDelay, delayBetweenPhotos, setDelayBetweenPhotos, photoReviewTime, setPhotoReviewTime } = useCaptureTiming();
  const { workingFolder, setWorkingFolder, photoNamingScheme, setPhotoNamingScheme, qrUploadEnabled, setQrUploadEnabled, qrUploadAllImages, setQrUploadAllImages, autoGifEnabled, setAutoGifEnabled, autoGifFormat, setAutoGifFormat, autoGifPhotoSource, setAutoGifPhotoSource } = useWorkspaceSettings();

  const { printCollage, isPrinting } = usePrintSettings();

  // Local state
  const [activeTab, setActiveTab] = useState<PhotoboothTab>('camera');
  const [expandedSections, setExpandedSections] = useState<Record<CollapsibleSection, boolean>>({
    camera: false,
    liveview: false,
    connection: false,
    polling: false,
    folder: false,
    photobooth: false,
    frame: false,
    session: false,
    naming: false,
    qr: false,
    gif: false,
    print: false,
  });
  const [activeSetting, setActiveSetting] = useState<SettingType>(null);
  const [hasSelectedCamera, setHasSelectedCamera] = useState(false);
  const [cameraInfo, setCameraInfo] = useState<{ id: string; manufacturer: string; model: string; port: string; usb_version?: string; serial_number?: string; firmware?: string } | null>(null);
  const [lensInfo, setLensInfo] = useState<string | null>(null);
  const [imageQualityExpanded, setImageQualityExpanded] = useState(false);
  const [focusSettingsExpanded, setFocusSettingsExpanded] = useState(false);
  const [showQrInfoModal, setShowQrInfoModal] = useState(false);
  const [showLedInfoModal, setShowLedInfoModal] = useState(false);

  // Google Drive folder state
  const [isLoadingDriveFolder, setIsLoadingDriveFolder] = useState(false);
  const driveFolderPicker = useDriveFolderPicker(setSessionDriveRootFolder);

  // Switch tabs when viewMode changes
  useEffect(() => {
    if (viewMode === 'finalize') {
      setActiveTab('qr');
    } else {
      setActiveTab('camera');
    }
  }, [viewMode]);

  // Track whether editingZoneId was just set (to avoid race with tab-clearing effect)
  const editingZoneJustSetRef = useRef(false);

  // Auto-switch to Edit tab when a zone is clicked in finalize mode
  useEffect(() => {
    if (viewMode === 'finalize' && editingZoneId) {
      editingZoneJustSetRef.current = true;
      setActiveTab('edit');
    }
  }, [viewMode, editingZoneId]);

  // Clear editing zone when switching away from Edit tab
  useEffect(() => {
    if (viewMode === 'finalize' && activeTab !== 'edit' && editingZoneId) {
      // Skip if editingZoneId was just set — the tab switch hasn't happened yet
      if (editingZoneJustSetRef.current) {
        editingZoneJustSetRef.current = false;
        return;
      }
      setFinalizeEditingZoneId(null);
    }
  }, [viewMode, activeTab, editingZoneId, setFinalizeEditingZoneId]);

  // Auto-switch back from Edit tab when zone is deselected
  useEffect(() => {
    if (viewMode === 'finalize' && !editingZoneId && activeTab === 'edit') {
      setActiveTab('qr');
    }
  }, [viewMode, editingZoneId, activeTab]);

  // Show toast on reconnection success
  const previousConnectionStateRef = useRef<ConnectionState>('NC');
  useEffect(() => {
    if (connectionState !== previousConnectionStateRef.current) {
      if (connectionState === 'Connected' && previousConnectionStateRef.current === 'Reconnecting') {
        showToast('Reconnected successfully', 'success', 3000, 'Camera is ready');
      }
      previousConnectionStateRef.current = connectionState;
    }
  }, [connectionState, showToast]);

  // Handlers
  const toggleSection = (section: CollapsibleSection) => {
    setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }));
  };

  const toggleSetting = (setting: SettingType) => {
    setActiveSetting(prev => prev === setting ? null : setting);
  };

  const handleConnectionChange = useCallback((isConnected: boolean, hasSelected: boolean, camera?: { id: string; manufacturer: string; model: string; port: string; usb_version?: string; serial_number?: string; firmware?: string }, lens?: string | null) => {
    logger.debug('[PhotoboothSidebar] Connection change:', isConnected, hasSelected, camera, lens);
    setHasSelectedCamera(hasSelected);
    if (camera) {
      setCameraInfo(camera);
    } else if (!isConnected) {
      setCameraInfo(null);
    }
    if (lens !== undefined) {
      setLensInfo(lens);
    }
  }, []);

  const handleBrowseFolder = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: 'Select Working Folder'
      });
      if (selected && typeof selected === 'string') {
        setWorkingFolder(selected);
      }
    } catch (error) {
      logger.error('Failed to open folder dialog:', error);
    }
  };

  const handleOpenDriveFolderPicker = async () => {
    if (!account) {
      showToast('Google Account Required', 'warning', 5000, 'Please login to Google Drive first before selecting a folder');
      return;
    }

    setIsLoadingDriveFolder(true);
    try {
      await driveFolderPicker.openFolderPicker();
    } catch (error) {
      logger.error('Failed to open folder picker:', error);
      showToast('Error', 'error', 3000, 'Failed to load Drive folders');
    } finally {
      setIsLoadingDriveFolder(false);
    }
  };

  const handleShowQrInfo = () => {
    setShowQrInfoModal(true);
  };

  // Compute LED state:
  // - offline: VM is offline (solid red)
  // - idle: VM online, no camera connected (solid green)
  // - connecting: trying to connect to camera (solid yellow)
  // - camera-connected: camera connected and running (pulsing green)
  // - downloading: downloading photo from camera (fast pulsing blue)
  const getLedState = (): 'offline' | 'idle' | 'connecting' | 'camera-connected' | 'downloading' => {
    if (!isVmOnline) return 'offline';
    if (isDownloading) return 'downloading';
    if (isConnecting) return 'connecting';
    if (isCameraConnected) return 'camera-connected';
    return 'idle';
  };

  const ledState = getLedState();

  const getLedTitle = () => {
    switch (ledState) {
      case 'offline': return 'Linux VM is offline (click for logs)';
      case 'idle': return 'Linux VM is online - No camera connected (click for logs)';
      case 'connecting': return 'Connecting to camera... (click for logs)';
      case 'camera-connected': return 'Camera connected and running (click for logs)';
      case 'downloading': return 'Downloading photo... (click for logs)';
    }
  };

  return (
    <>
      <div className="photobooth-sidebar">
        <div className="sidebar">
          <div className="sidebar-title-row">
            <h2 className="sidebar-title">Control Center</h2>
            <div
              className={`vm-status-led ${ledState}`}
              title={getLedTitle()}
              onClick={vmLogs.handleOpenVmLogs}
            >
              <div className="vm-status-led-inner" />
            </div>
          </div>

          <div className="sidebar-divider" />

          <div className="photobooth-sidebar-content">
            <div className="photobooth-tab-selector">
              {viewMode === 'capture' ? (
                <>
                  <button
                    className={`photobooth-tab ${activeTab === 'camera' ? 'active' : ''}`}
                    onClick={() => setActiveTab('camera')}
                  >
                    Camera
                  </button>
                  <button
                    className={`photobooth-tab ${activeTab === 'photobooth' ? 'active' : ''}`}
                    onClick={() => setActiveTab('photobooth')}
                  >
                    Photobooth
                  </button>
                </>
              ) : (
                <>
                  <button
                    className={`photobooth-tab ${activeTab === 'qr' ? 'active' : ''}`}
                    onClick={() => setActiveTab('qr')}
                  >
                    <QrCode size={14} />
                    QR
                  </button>
                  <button
                    className={`photobooth-tab ${activeTab === 'print' ? 'active' : ''}`}
                    onClick={() => setActiveTab('print')}
                  >
                    <Printer size={14} />
                    Print
                  </button>
                  <button
                    className={`photobooth-tab ${activeTab === 'gif' ? 'active' : ''}`}
                    onClick={() => setActiveTab('gif')}
                  >
                    <Film size={14} />
                    GIF
                  </button>
                </>
              )}
            </div>

            <div className="photobooth-tab-content">
              {/* Camera Tab */}
              <div className="tab-panel" style={{ display: activeTab === 'camera' ? 'flex' : 'none' }}>
                <CameraSection
                  expandedSections={expandedSections}
                  toggleSection={toggleSection}
                  shutterSpeeds={cameraSettings.shutterSpeeds}
                  apertureOptions={cameraSettings.apertureOptions}
                  isoOptions={cameraSettings.isoOptions}
                  evOptions={cameraSettings.evOptions}
                  shutterValue={cameraSettings.shutterValue}
                  apertureIndex={cameraSettings.apertureIndex}
                  isoIndex={cameraSettings.isoIndex}
                  evIndex={cameraSettings.evIndex}
                  wbValue={cameraSettings.wbValue}
                  meteringValue={cameraSettings.meteringValue}
                  activeSetting={activeSetting}
                  onToggleSetting={toggleSetting}
                  onSetShutterValue={cameraSettings.setShutterValue}
                  onSetApertureIndex={cameraSettings.setApertureIndex}
                  onSetIsoIndex={cameraSettings.setIsoIndex}
                  onSetEvIndex={cameraSettings.setEvIndex}
                  onSetWbValue={cameraSettings.setWbValue}
                  onSetMeteringValue={cameraSettings.setMeteringValue}
                  onSetActiveSetting={setActiveSetting}
                  onCameraOptionsLoaded={cameraSettings.onCameraOptionsLoaded}
                  pendingSettings={cameraSettings.pendingSettings}
                  onConnectionChange={handleConnectionChange}
                  onConfigValuesLoaded={cameraSettings.onConfigValuesLoaded}
                />

                {hasSelectedCamera && isCameraConnected && (
                  <>
                    <LiveViewSection
                      expandedSections={expandedSections}
                      toggleSection={toggleSection}
                    />

                    {import.meta.env.DEV && (
                      <>
                        <ImageQuality
                          isExpanded={imageQualityExpanded}
                          onToggle={() => setImageQualityExpanded(!imageQualityExpanded)}
                          cameraConnected={isCameraConnected}
                        />

                        <FocusSettings
                          isExpanded={focusSettingsExpanded}
                          onToggle={() => setFocusSettingsExpanded(!focusSettingsExpanded)}
                          cameraConnected={isCameraConnected}
                        />
                      </>
                    )}

                    <ConnectionInfoSection
                      expandedSections={expandedSections}
                      toggleSection={toggleSection}
                      selectedCamera={cameraInfo}
                      lensInfo={lensInfo}
                    />
                  </>
                )}
              </div>

              {/* Photobooth Settings Tab */}
              <div className="tab-panel" style={{ display: activeTab === 'photobooth' ? 'flex' : 'none' }}>
                <WorkingFolderSection
                  expanded={expandedSections.folder}
                  onToggle={() => toggleSection('folder')}
                  workingFolder={workingFolder}
                  onBrowseFolder={handleBrowseFolder}
                />

                <CustomSetsSection
                  expanded={expandedSections.frame}
                  onToggle={() => toggleSection('frame')}
                  customSets={customSetsHook.customSets}
                  loadingSets={customSetsHook.loadingSets}
                  selectedCustomSetId={customSetsHook.selectedCustomSetId}
                  expandedSetIds={customSetsHook.expandedSetIds}
                  onToggleSetExpanded={customSetsHook.toggleSetExpanded}
                  onLoadSet={customSetsHook.handleLoadSet}
                />

                <PhotoboothSettingsSection
                  expanded={expandedSections.photobooth}
                  onToggle={() => toggleSection('photobooth')}
                  autoCount={autoCount}
                  timerDelay={timerDelay}
                  delayBetweenPhotos={delayBetweenPhotos}
                  photoReviewTime={photoReviewTime}
                  onAutoCountChange={setAutoCount}
                  onTimerDelayChange={setTimerDelay}
                  onDelayBetweenPhotosChange={setDelayBetweenPhotos}
                  onPhotoReviewTimeChange={setPhotoReviewTime}
                />

                <NamingSchemeSection
                  expanded={expandedSections.naming}
                  onToggle={() => toggleSection('naming')}
                  photoNamingScheme={photoNamingScheme}
                  onPhotoNamingSchemeChange={setPhotoNamingScheme}
                />

                <QrSettingsSection
                  expanded={expandedSections.qr}
                  onToggle={() => toggleSection('qr')}
                  sessionDriveRootFolder={sessionDriveRootFolder}
                  isLoadingDriveFolder={isLoadingDriveFolder}
                  onOpenDriveFolderPicker={handleOpenDriveFolderPicker}
                  qrUploadEnabled={qrUploadEnabled}
                  setQrUploadEnabled={setQrUploadEnabled}
                  qrUploadAllImages={qrUploadAllImages}
                  setQrUploadAllImages={setQrUploadAllImages}
                  onShowInfo={handleShowQrInfo}
                />

                <GifSettingsSection
                  expanded={expandedSections.gif}
                  onToggle={() => toggleSection('gif')}
                  autoGifEnabled={autoGifEnabled}
                  setAutoGifEnabled={setAutoGifEnabled}
                  autoGifFormat={autoGifFormat}
                  setAutoGifFormat={setAutoGifFormat}
                  autoGifPhotoSource={autoGifPhotoSource}
                  setAutoGifPhotoSource={setAutoGifPhotoSource}
                />

                <PrintSettingsSection
                  expanded={expandedSections.print}
                  onToggle={() => toggleSection('print')}
                />
              </div>

              {/* Finalize Mode Tabs */}
              {viewMode === 'finalize' && (
                <>
                  <div className="tab-panel" style={{ display: activeTab === 'print' ? 'flex' : 'none' }}>
                    <PrintTabContent
                      isPrinting={isPrinting}
                      onPrint={printCollage}
                    />
                  </div>

                  <div className="tab-panel" style={{ display: activeTab === 'qr' ? 'flex' : 'none' }}>
                    <QrTabContent />
                  </div>

                  <div className="tab-panel" style={{ display: activeTab === 'gif' ? 'flex' : 'none' }}>
                    <GifTabContent />
                  </div>

                  <div className="tab-panel" style={{ display: activeTab === 'edit' ? 'flex' : 'none' }}>
                    <div className="finalize-tab-content">
                      {!editingZoneId || !placedImages.has(editingZoneId) ? (
                        <div className="print-settings-container">
                          <div className="print-section">
                            <div className="print-section-header">
                              <ImageIcon size={16} />
                              <span className="print-section-title">Edit Photo</span>
                            </div>
                            <div className="print-info-content">
                              <p>Click a photo in the collage to adjust its position, zoom, rotation, and flip settings.</p>
                              <p className="print-hint">Drag photos to reposition them within their frames.</p>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <EditTabContent
                          zoneId={editingZoneId}
                          placedImage={placedImages.get(editingZoneId)!}
                          onUpdate={updatePlacedImage}
                        />
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Modals */}
      <ConnectionLostModal
        show={connectionState === 'Reconnecting'}
        onReconnect={reconnect}
        onDisconnect={disconnect}
      />

      <VmLogsModal
        show={vmLogs.showVmLogs}
        isVmOnline={isVmOnline}
        vmLogs={vmLogs.vmLogs}
        isLoadingLogs={vmLogs.isLoadingLogs}
        logsError={vmLogs.logsError}
        isRestartingVm={vmLogs.isRestartingVm}
        onClose={() => vmLogs.setShowVmLogs(false)}
        onRefresh={vmLogs.fetchVmLogs}
        onRestart={vmLogs.handleRestartVm}
        onShowLedInfo={() => {
          vmLogs.setShowVmLogs(false);
          setShowLedInfoModal(true);
        }}
      />

      <LedInfoModal
        show={showLedInfoModal}
        onClose={() => {
          setShowLedInfoModal(false);
          vmLogs.setShowVmLogs(true);
        }}
      />

      <div className="restart-vm-confirm-modal">
        <ConfirmDialog
          show={vmLogs.showRestartConfirm}
          title="Restart Virtual Machine"
          message="Are you sure you want to restart the VM? This will temporarily disconnect the camera."
          confirmText="Restart VM"
          cancelText="Cancel"
          onConfirm={vmLogs.confirmRestartVm}
          onCancel={vmLogs.cancelRestartVm}
          isLoading={vmLogs.isRestartingVm}
        />
      </div>

      <FolderPickerModal
        show={driveFolderPicker.showFolderPicker}
        onClose={driveFolderPicker.closeFolderPicker}
        driveFolders={driveFolderPicker.driveFolders}
        loadingFolders={driveFolderPicker.loadingFolders}
        folderPath={driveFolderPicker.folderPath}
        newFolderName={driveFolderPicker.newFolderName}
        creatingFolder={driveFolderPicker.creatingFolder}
        onSetNewFolderName={driveFolderPicker.setNewFolderName}
        onFetchFolders={driveFolderPicker.fetchFolders}
        onNavigateFolder={driveFolderPicker.handleNavigateFolder}
        onNavigateUp={driveFolderPicker.handleNavigateUp}
        onNavigateToRoot={driveFolderPicker.handleNavigateToRoot}
        onNavigateToBreadcrumb={driveFolderPicker.handleNavigateToBreadcrumb}
        onConfirmSelection={driveFolderPicker.handleConfirmSelection}
        onSelectCurrentDir={driveFolderPicker.handleSelectCurrentDir}
        onCreateFolder={driveFolderPicker.handleCreateFolder}
        onDeleteFolder={driveFolderPicker.handleDeleteFolder}
      />

      <DeleteFolderModal
        show={driveFolderPicker.showDeleteConfirm}
        folderToDelete={driveFolderPicker.folderToDelete}
        deleting={driveFolderPicker.deleting}
        onCancel={driveFolderPicker.cancelDelete}
        onConfirm={driveFolderPicker.confirmDeleteFolder}
      />

      <QrInfoModal
        show={showQrInfoModal}
        onClose={() => setShowQrInfoModal(false)}
      />
    </>
  );
}
