import { useState, useRef, useCallback, useEffect } from "react";
import { Printer, QrCode, Image as ImageIcon } from "lucide-react";
import { open } from '@tauri-apps/plugin-dialog';
import { CameraSection } from "./CameraSection";
import { LiveViewSection } from "./LiveViewSection";
import { ImageQuality } from "./ImageQuality";
import { FocusSettings } from "./FocusSettings";
import ConnectionLostModal from "../../Modals/ConnectionLostModal";
import ConfirmDialog from "../../Modals/ConfirmDialog";
import FolderPickerModal from "../../Modals/FolderPickerModal";
import { useCamera } from "../../../contexts/CameraContext";
import { useVM } from "../../../contexts/VMContext";
import { usePhotoboothSettings } from "../../../contexts/PhotoboothSettingsContext";
import { useToast } from "../../../contexts/ToastContext";
import { usePhotobooth } from "../../../contexts/PhotoboothContext";
import { usePrintSettings } from "../../../contexts/PrintSettingsContext";
import { useAuth } from "../../../contexts/AuthContext";
import { useDriveFolderPicker } from "../../../hooks/useDriveFolderPicker";
import { useVmLogs } from "../../../hooks/useVmLogs";
import { useCameraSettings } from "../../../hooks/useCameraSettings";
import { useCustomSets } from "../../../hooks/useCustomSets";
import type { ConnectionState } from "../../../types/connection";
import {
  EditTabContent,
  VmLogsModal,
  CustomSetsSection,
  WorkingFolderSection,
  NamingSchemeSection,
  PhotoboothSettingsSection,
  QrSettingsSection,
  QrInfoModal,
  PrintTabContent,
  QrTabContent,
} from "./components";
import "./PhotoboothSidebar.css";

interface PhotoboothSidebarProps {
  shutterSpeeds?: string[];
  apertureValues?: string[];
  isoValues?: string[];
}

type PhotoboothTab = 'camera' | 'photobooth' | 'print' | 'qr' | 'edit';
type CollapsibleSection = 'camera' | 'liveview' | 'folder' | 'photobooth' | 'frame' | 'session' | 'naming' | 'qr';
type SettingType = 'shutter' | 'aperture' | 'iso' | 'ev' | 'wb' | 'metering' | 'folder' | 'mode' | null;

export default function PhotoboothSidebar(props: PhotoboothSidebarProps) {
  const {
    isCameraConnected,
    connectionState,
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
  const {
    autoCount, setAutoCount,
    timerDelay, setTimerDelay,
    delayBetweenPhotos, setDelayBetweenPhotos,
    photoReviewTime, setPhotoReviewTime,
    workingFolder, setWorkingFolder,
    photoNamingScheme, setPhotoNamingScheme,
    qrUploadAllImages, setQrUploadAllImages,
  } = usePhotoboothSettings();

  const { printCollage, isPrinting } = usePrintSettings();

  // Local state
  const [activeTab, setActiveTab] = useState<PhotoboothTab>('camera');
  const [expandedSections, setExpandedSections] = useState<Record<CollapsibleSection, boolean>>({
    camera: false,
    liveview: false,
    folder: false,
    photobooth: false,
    frame: false,
    session: false,
    naming: false,
    qr: false,
  });
  const [activeSetting, setActiveSetting] = useState<SettingType>(null);
  const [hasSelectedCamera, setHasSelectedCamera] = useState(false);
  const [imageQualityExpanded, setImageQualityExpanded] = useState(false);
  const [focusSettingsExpanded, setFocusSettingsExpanded] = useState(false);
  const [showQrInfoModal, setShowQrInfoModal] = useState(false);

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

  // Auto-switch to Edit tab when a zone is clicked in finalize mode
  useEffect(() => {
    if (viewMode === 'finalize' && editingZoneId) {
      setActiveTab('edit');
    }
  }, [viewMode, editingZoneId]);

  // Clear editing zone when switching away from Edit tab
  useEffect(() => {
    if (viewMode === 'finalize' && activeTab !== 'edit' && editingZoneId) {
      setFinalizeEditingZoneId(null);
    }
  }, [viewMode, activeTab, editingZoneId, setFinalizeEditingZoneId]);

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

  const handleConnectionChange = useCallback((isConnected: boolean, hasSelected: boolean) => {
    console.log('[PhotoboothSidebar] Connection change:', isConnected, hasSelected);
    setHasSelectedCamera(hasSelected);
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
      console.error('Failed to open folder dialog:', error);
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
      console.error('Failed to open folder picker:', error);
      showToast('Error', 'error', 3000, 'Failed to load Drive folders');
    } finally {
      setIsLoadingDriveFolder(false);
    }
  };

  const handleShowQrInfo = () => {
    setShowQrInfoModal(true);
  };

  return (
    <>
      <div className="photobooth-sidebar">
        <div className="sidebar">
          <div className="sidebar-title-row">
            <h2 className="sidebar-title">Control Center</h2>
            <div
              className={`vm-status-led ${isVmOnline ? 'online' : 'offline'}`}
              title={`Linux VM is ${isVmOnline ? 'online (click for logs)' : 'offline (click for logs)'}`}
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
                    className={`photobooth-tab ${activeTab === 'edit' ? 'active' : ''}`}
                    onClick={() => setActiveTab('edit')}
                  >
                    Edit
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
                  qrUploadAllImages={qrUploadAllImages}
                  setQrUploadAllImages={setQrUploadAllImages}
                  onShowInfo={handleShowQrInfo}
                />
              </div>

              {/* Finalize Mode Tabs */}
              <div className="tab-panel" style={{ display: viewMode === 'finalize' ? 'flex' : 'none' }}>
                {activeTab === 'print' && (
                  <PrintTabContent
                    isPrinting={isPrinting}
                    onPrint={printCollage}
                  />
                )}

                {activeTab === 'qr' && (
                  <QrTabContent />
                )}

                {activeTab === 'edit' && (
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
                )}
              </div>
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

      <QrInfoModal
        show={showQrInfoModal}
        onClose={() => setShowQrInfoModal(false)}
      />
    </>
  );
}
