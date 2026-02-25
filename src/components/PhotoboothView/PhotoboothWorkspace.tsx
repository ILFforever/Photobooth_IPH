import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Image as ImageIcon, ExternalLink, Camera, Grid3x3, Layers, AlertTriangle, X, Plus, FolderOpen
} from "lucide-react";
import { usePhotoboothSettings, type PhotoboothSessionInfo } from "../../contexts/PhotoboothSettingsContext";
import { usePhotoboothSequence } from "../../hooks/usePhotoboothSequence";
import { useCamera } from "../../contexts/CameraContext";
import { useLiveView } from "../../contexts/LiveViewContext";
import { useCollage } from "../../contexts/CollageContext";
import { usePhotobooth } from "../../contexts/PhotoboothContext";
import { useToast } from "../../contexts/ToastContext";
import { useUploadQueue } from "../../contexts/UploadQueueContext";
import { useAuth } from "../../contexts/AuthContext";
import { PhotoboothControls } from "./PhotoboothControls";
import DisplayContent from "./DisplayContent";
import CurrentSetPhotoStrip from "./CurrentSetPhotoStrip";
import PhotoSessionsSidebar from "./PhotoSessionsSidebar";
import FinalizeView from "./FinalizeView";
import { type PhotoDownloadedEvent } from "../../services/cameraWebSocket";
import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { listen, emitTo, type UnlistenFn } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useSecondScreen } from "../../hooks/useSecondScreen";
import { imageCache } from "../../services/ImageCacheService";
import "./PhotoboothWorkspace.css";

const DAEMON_URL = 'http://localhost:58321';

// Display mode presets - arranged like Lightroom modules
type DisplayMode = 'single' | 'center' | 'canvas' | 'finalize';

interface DisplayPreset {
  id: DisplayMode;
  name: string;
  icon: React.ComponentType<{ size?: number }>;
  description: string;
}

const displayPresets: DisplayPreset[] = [
  { id: 'single', name: 'Single', icon: Layers, description: 'Single photo view' },
  { id: 'center', name: 'Center', icon: Camera, description: 'Centerstage with recent photos' },
  { id: 'canvas', name: 'Canvas', icon: Grid3x3, description: 'Grid showing all photos' },
];

// Mock data for current set photos (photos taken in the active session)
interface CurrentSetPhoto {
  id: string;
  thumbnailUrl: string;
  fullUrl?: string;
  timestamp: string;
}



// PtbSession type matching Rust struct
interface PtbSession {
  name: string;
  createdAt: string;
  lastUsedAt: string;
  shotCount: number;
  photos: Array<{
    filename: string;
    originalPath: string;
    cameraPath: string;
    capturedAt: string;
  }>;
  googleDriveMetadata?: {
    folderId?: string | null;
    folderName?: string | null;
    folderLink?: string | null;
    uploadedImages: Array<{
      filename: string;
      driveFileId: string;
      uploadedAt: string;
    }>;
  };
}

export default function PhotoboothWorkspace() {
  const {
    timerDelay,
    autoCount,
    delayBetweenPhotos,
    setDelayBetweenPhotos,
    photoReviewTime,
    workingFolder,
    photoNamingScheme,
    sessions,
    currentSession,
    loadSession,
    updateCurrentSessionFromDownload,
    createNewSession,
    qrUploadAllImages
  } = usePhotoboothSettings();
  const { captureError, clearCaptureError, isCameraConnected, hasEverConnected, isConnecting, addPhotoDownloadedListener, removePhotoDownloadedListener } = useCamera();
  const { stream: liveViewStream, hdmi, ptp } = useLiveView();
  const { showToast } = useToast();
  const { selectedCustomSetName } = useCollage();
  const { photoboothFrame, finalizeViewMode, setFinalizeViewMode, setFinalizeEditingZoneId, placedImages } = usePhotobooth();
  const { enqueuePhotos } = useUploadQueue();
  const { account, rootFolder } = useAuth();

  // Local view mode synced with context
  const viewMode = finalizeViewMode;

  // Debug: Log when selectedCustomSetName changes
  useEffect(() => {
    console.log('[PhotoboothWorkspace] selectedCustomSetName changed to:', selectedCustomSetName);
  }, [selectedCustomSetName]);

  const [selectedSetId, setSelectedSetId] = useState<string | null>(null);
  const [expandedSets, setExpandedSets] = useState<Set<string>>(new Set());
  const [displayMode, setDisplayMode] = useState<DisplayMode>('center');
  const [selectedPhotoIndex, setSelectedPhotoIndex] = useState<number | null>(null);
  const [centerBrowseIndex, setCenterBrowseIndex] = useState<number | null>(null);
  const [currentSetPhotos, setCurrentSetPhotos] = useState<CurrentSetPhoto[]>([]);

  // Slider for compact mode selector
  const [sliderStyles, setSliderStyles] = useState<{ left: number; width: number } | null>(null);
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const updateSliderPosition = useCallback((activeMode: DisplayMode) => {
    const activeTab = tabRefs.current[activeMode];
    if (activeTab) {
      setSliderStyles({
        left: activeTab.offsetLeft,
        width: activeTab.offsetWidth,
      });
    } else {
      setSliderStyles(null);
    }
  }, []);

  useEffect(() => {
    // Delay to ensure elements are rendered and measured correctly
    const timer = setTimeout(() => {
      updateSliderPosition(displayMode);
    }, 50); // Small delay
    return () => clearTimeout(timer);
  }, [displayMode, updateSliderPosition]);

  // Capture preview state for guest display
  const [showCapturePreview, setShowCapturePreview] = useState(false);
  const [capturedPhotoUrl, setCapturedPhotoUrl] = useState<string | null>(null);
  const previewTimerStartedRef = useRef(false); // Track if timer has been started

  // QR code data for finalize view (generated from session's Drive folder link)
  const [sessionQrData, setSessionQrData] = useState<string | null>(null);

  // Workflow state
  const [selectedPhotos, setSelectedPhotos] = useState<Set<string>>(new Set());
  // Calculate required photos from photobooth frame zones - 0 when no frame/set selected
  const requiredPhotos = photoboothFrame?.zones.length ?? 0;

  // Clear selected photos when session changes
  useEffect(() => {
    console.log('[PhotoboothWorkspace] Session changed, clearing selected photos');
    setSelectedPhotos(new Set());
    setSelectedPhotoIndex(null);
    setCenterBrowseIndex(null);
  }, [currentSession?.id]);

  const [ptbSession, setPtbSession] = useState<PtbSession | null>(null);

  // Modal state for session selection when loading a folder with existing sessions
  const [showSessionSelectModal, setShowSessionSelectModal] = useState(false);
  const [pendingSessionToLoad, setPendingSessionToLoad] = useState<PhotoboothSessionInfo | null>(null);

  // Auto-load latest session when working folder changes
  useEffect(() => {
    const loadLatestSession = async () => {
      if (!workingFolder || sessions.length === 0) return;

      // If no current session and we haven't auto-loaded yet for this folder
      if (!currentSession && sessions.length > 0 && !hasAutoLoadedRef.current) {
        // Skip modal if there's only one empty session (just auto-created by refreshSessions)
        if (sessions.length === 1 && sessions[0].shotCount === 0) {
          console.log('[PhotoboothWorkspace] Single empty session detected, auto-loading without modal');
          hasAutoLoadedRef.current = true;
          await loadSession(sessions[0].id);
          return;
        }

        const latestSession = [...sessions].sort((a, b) =>
          new Date(b.lastUsedAt).getTime() - new Date(a.lastUsedAt).getTime()
        )[0];

        console.log('[PhotoboothWorkspace] Found existing sessions, showing selection modal');
        hasAutoLoadedRef.current = true;
        setPendingSessionToLoad(latestSession);
        setShowSessionSelectModal(true);
      }
    };

    loadLatestSession();
  }, [workingFolder, sessions, currentSession]);

  // Reset auto-load flag when working folder changes
  useEffect(() => {
    hasAutoLoadedRef.current = false;
  }, [workingFolder]);

  // Second screen hook
  const { isSecondScreenOpen, openSecondScreen, closeSecondScreen, updateGuestDisplay, updateDisplayMode, selectPhoto, selectCenterPhoto, updateCountdown } = useSecondScreen();

  // Photobooth sequence hook - manages all timing state
  const sequence = usePhotoboothSequence({
    delayBeforeFirstPhoto: timerDelay,
    delayBetweenPhotos,
    photoReviewTime,
    autoCount,
    onPreviewLoaded: () => {
      // Called when entering waitingForPreview state
      console.log('[PhotoboothWorkspace] Entering waitingForPreview state');
    },
  });

  // Add photos to set when photosTaken changes (happens during capture phase)
  const lastPhotosTakenRef = useRef(0);
  const hasAutoLoadedRef = useRef(false);
  const prevSequenceStateRef = useRef<string>('idle');
  useEffect(() => {
    if (sequence.photosTaken > lastPhotosTakenRef.current) {
      const newPhoto: CurrentSetPhoto = {
        id: `photo-${Date.now()}`,
        thumbnailUrl: `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200" viewBox="0 0 300 200"><rect fill="%23333" width="300" height="200"/><text x="50%25" y="50%25" dominant-baseline="middle" text-anchor="middle" fill="%23666" font-family="monospace" font-size="24">Photo ${sequence.photosTaken}</text></svg>`)}`,
        timestamp: new Date().toLocaleTimeString(),
      };
      setCurrentSetPhotos(prev => [...prev, newPhoto]);
    }
    lastPhotosTakenRef.current = sequence.photosTaken;
  }, [sequence.photosTaken]);

  // Populate current set photos when loading an existing session
  const lastSessionIdRef = useRef<string | null>(null);
  const lastWorkingFolderRef = useRef<string | null>(null);
  const lastPhotoCountRef = useRef<number>(0);
  useEffect(() => {
    // Populate when session changes, when working folder changes, or when photo count changes
    const sessionChanged = currentSession && currentSession.id !== lastSessionIdRef.current;
    const folderChanged = workingFolder && workingFolder !== lastWorkingFolderRef.current;
    const photoCountChanged = currentSession && currentSession.photos.length !== lastPhotoCountRef.current;

    if (currentSession && (sessionChanged || folderChanged || photoCountChanged)) {
      if (sessionChanged) {
        lastSessionIdRef.current = currentSession.id;
      }
      if (workingFolder) {
        lastWorkingFolderRef.current = workingFolder;
      }
      lastPhotoCountRef.current = currentSession.photos.length;

      if (currentSession.photos && currentSession.photos.length > 0) {
        // Get the session folder name
        const sessionInfo = sessions.find(s => s.id === currentSession.id);
        const folderName = sessionInfo?.folderName || currentSession.id;

        // Convert session photos to current set photos
        // Note: Using full-res images directly instead of cached thumbnails to avoid cache collision issues
        // TODO: Implement proper thumbnail system with unique cache keys and sessions array refresh
        const loadedPhotos: CurrentSetPhoto[] = currentSession.photos.map((photo, idx) => {
          let fullUrl: string | undefined;
          if (workingFolder) {
            const filePath = `${workingFolder}/${folderName}/${photo.filename}`;
            fullUrl = convertFileSrc(filePath);
          }

          return {
            id: photo.filename || `photo-${idx}`,
            thumbnailUrl: fullUrl || '',
            fullUrl,
            timestamp: new Date(photo.capturedAt).toLocaleTimeString(),
          };
        });

        setCurrentSetPhotos(loadedPhotos);

        // Preload all images in background for better performance
        const imageUrls = loadedPhotos.map(p => p.thumbnailUrl).filter(Boolean);
        imageCache.preloadImages(imageUrls, 8).catch(err => {
          console.warn('[PhotoboothWorkspace] Some images failed to preload:', err);
        });
      } else {
        // Clear if new session has no photos
        setCurrentSetPhotos([]);
      }
    }
  }, [currentSession, workingFolder, sessions]);

  // Clear photos only on explicit stop/reset, not when starting a new sequence (append mode)
  // Removed the auto-clear on scramble to allow appending photos to existing set

  // Handle photo_downloaded events from WebSocket
  const handlePhotoDownloaded = useCallback(async (event: PhotoDownloadedEvent) => {
    console.log('[PhotoboothWorkspace::handlePhotoDownloaded] START');
    console.log('[PhotoboothWorkspace::handlePhotoDownloaded] event:', event);

    // Immediately advance the sequence state machine (adds placeholder + moves to review/next)
    // This decouples state progression from the slower download pipeline
    sequence.notifyCaptureComplete();

    const filename = event.file_path.split('/').pop() || event.file_path;
    console.log('[PhotoboothWorkspace::handlePhotoDownloaded] extracted filename:', filename);

    if (!workingFolder) {
      // Show warning toast if working folder is not set
      console.warn('[PhotoboothWorkspace::handlePhotoDownloaded] Working folder not set, cannot save photo');
      showToast('No Working Folder Set', 'warning', 5000, 'Select a folder in Photobooth settings');
      return;
    }

    try {
      let sessionId = currentSession?.id;
      console.log('[PhotoboothWorkspace::handlePhotoDownloaded] initial sessionId:', sessionId);

      // Auto-create session if none exists
      if (!sessionId) {
        console.log('[PhotoboothWorkspace::handlePhotoDownloaded] No active session - auto-creating new session');

        // Find the highest numbered session to increment (from folder names like "Test_004")
        let nextNumber = 1;
        if (sessions.length > 0) {
          const numbers = sessions
            .map(s => {
              const match = s.folderName.match(/_(\d+)$/);
              return match ? parseInt(match[1], 10) : 0;
            })
            .filter(n => n > 0);

          if (numbers.length > 0) {
            nextNumber = Math.max(...numbers) + 1;
          }
        }

        const sessionName = `Session ${nextNumber}`;
        console.log('[PhotoboothWorkspace] Creating session:', sessionName);

        // Create the new session using the backend command
        const newSession = await invoke<{ id: string; name: string; folderName: string }>('create_photobooth_session', {
          folderPath: workingFolder,
          sessionName,
        });

        sessionId = newSession.id;
        console.log('[PhotoboothWorkspace::handlePhotoDownloaded] Created session:', sessionId);

        // Load the newly created session as current
        await loadSession(sessionId);
        console.log('[PhotoboothWorkspace::handlePhotoDownloaded] Loaded new session');
      }

      console.log('[PhotoboothWorkspace::handlePhotoDownloaded] Calling download_photo_from_daemon with:', {
        daemonUrl: DAEMON_URL,
        filename,
        folderPath: workingFolder,
        sessionId,
        cameraPath: event.camera_path,
        originalDaemonPath: event.file_path,
      });

      // Download photo directly via Rust (bypasses slow JS ArrayBuffer → Array conversion)
      const updatedSession = await invoke<PtbSession>('download_photo_from_daemon', {
        daemonUrl: DAEMON_URL,
        filename,
        folderPath: workingFolder,
        sessionId,
        cameraPath: event.camera_path,
        originalDaemonPath: event.file_path,
        photoNamingScheme,
      });

      console.log('[PhotoboothWorkspace::handlePhotoDownloaded] Photo saved, session updated:', updatedSession);
      setPtbSession(updatedSession);

      // PRIORITY 1: Show full-res photo on guest display immediately (do this first!)
      const latestPhoto = updatedSession.photos[updatedSession.photos.length - 1];
      const customFilename = latestPhoto?.filename || filename;
      const sessionInfo = sessions.find(s => s.id === sessionId);
      const folderName = sessionInfo?.folderName || sessionId;
      const photoPath = `${workingFolder}/${folderName}/${customFilename}`;
      const photoUrl = convertFileSrc(photoPath);

      console.log('[PhotoboothWorkspace::handlePhotoDownloaded] Showing photo on guest display immediately');

      // Reset flag for new photo
      previewTimerStartedRef.current = false;

      // Update main workspace state first (for guest display sync)
      // NOTE: Timer will be started when onCapturePreviewLoad is called (after image loads)
      setCapturedPhotoUrl(photoUrl);
      setShowCapturePreview(true);

      // Send to guest display IMMEDIATELY - don't wait for anything else
      updateGuestDisplay({
        currentSetPhotos,
        selectedPhotoIndex,
        displayMode,
        showCapturePreview: true,
        capturedPhotoUrl: photoUrl,
      });

      // Start manual review mode if not in automatic sequence
      if (!sequence.isActive) {
        console.log('[PhotoboothWorkspace::handlePhotoDownloaded] Manual capture - starting manual review mode');
        sequence.startManualReview();
      }

      // Create new photo entry for current set
      const newPhoto: CurrentSetPhoto = {
        id: customFilename,
        thumbnailUrl: photoUrl, // Use full-res for display quality
        fullUrl: photoUrl,
        timestamp: new Date().toLocaleTimeString(),
      };

      // Update current set photos (main workspace display)
      setCurrentSetPhotos(prev => {
        const placeholderIndex = prev.findIndex(p => p.thumbnailUrl.startsWith('data:image/svg+xml'));
        if (placeholderIndex !== -1) {
          // Replace the placeholder with the real photo
          const updated = [...prev];
          updated[placeholderIndex] = newPhoto;
          console.log('[PhotoboothWorkspace::handlePhotoDownloaded] Replaced placeholder at index:', placeholderIndex);
          return updated;
        }
        // If no placeholder found, append the new photo
        console.log('[PhotoboothWorkspace::handlePhotoDownloaded] No placeholder found, appending photo');
        return [...prev, newPhoto];
      });

      // PRIORITY 2 (LOW): Update session state in background (non-blocking)
      // Don't await this - let it complete in background
      updateCurrentSessionFromDownload({
        id: sessionId!,
        name: updatedSession.name,
        createdAt: updatedSession.createdAt,
        lastUsedAt: updatedSession.lastUsedAt,
        shotCount: updatedSession.shotCount,
        photos: updatedSession.photos,
        googleDriveMetadata: updatedSession.googleDriveMetadata || { uploadedImages: [] },
      }, customFilename);
      console.log('[PhotoboothWorkspace::handlePhotoDownloaded] Session state updated directly');

      // PRIORITY 3: Auto-upload to Google Drive (non-blocking)
      // Only if user is logged in, Drive folder is configured, AND "Upload all images" is enabled
      if (account && updatedSession.googleDriveMetadata?.folderId && qrUploadAllImages) {
        const driveFolderId = updatedSession.googleDriveMetadata.folderId;
        console.log('[PhotoboothWorkspace::handlePhotoDownloaded] Auto-uploading to Drive folder:', driveFolderId);

        // Check if photo was already uploaded
        try {
          const alreadyUploaded = await invoke<boolean>('is_image_uploaded_to_drive', {
            folderPath: workingFolder,
            sessionId: sessionId!,
            filename: customFilename,
          });

          if (!alreadyUploaded) {
            // Queue single photo for upload immediately (don't await - let it process in background)
            enqueuePhotos(sessionId!, [{
              filename: customFilename,
              localPath: photoPath
            }], driveFolderId).catch(err => {
              console.error('[PhotoboothWorkspace::handlePhotoDownloaded] Upload queue error:', err);
            });
            console.log('[PhotoboothWorkspace::handlePhotoDownloaded] Photo queued for immediate upload:', customFilename);
          } else {
            console.log('[PhotoboothWorkspace::handlePhotoDownloaded] Photo already uploaded, skipping:', customFilename);
          }
        } catch (error) {
          console.error('[PhotoboothWorkspace::handlePhotoDownloaded] Upload check error:', error);
        }
      } else {
        if (!account) {
          console.log('[PhotoboothWorkspace::handlePhotoDownloaded] Skipping auto-upload - Not logged in to Google Drive');
        } else if (!updatedSession.googleDriveMetadata?.folderId) {
          console.log('[PhotoboothWorkspace::handlePhotoDownloaded] Skipping auto-upload - Drive folder not configured for this session');
        } else if (!qrUploadAllImages) {
          console.log('[PhotoboothWorkspace::handlePhotoDownloaded] Skipping auto-upload - "Selected Collage Photos Only" mode (will upload on finalize)');
        }
      }

      console.log('[PhotoboothWorkspace::handlePhotoDownloaded] END - photo displayed immediately');
    } catch (error) {
      console.error('[PhotoboothWorkspace::handlePhotoDownloaded] ERROR:', error);
    }
    console.log('[PhotoboothWorkspace::handlePhotoDownloaded] END');
  }, [workingFolder, currentSession, sessions, updateCurrentSessionFromDownload, loadSession, sequence.notifyCaptureComplete, photoReviewTime, updateGuestDisplay, currentSetPhotos, selectedPhotoIndex, displayMode, account, qrUploadAllImages, enqueuePhotos]);

  // Subscribe to photo_downloaded events
  useEffect(() => {
    addPhotoDownloadedListener(handlePhotoDownloaded);
    return () => {
      removePhotoDownloadedListener(handlePhotoDownloaded);
    };
  }, [handlePhotoDownloaded, addPhotoDownloadedListener, removePhotoDownloadedListener]);

  // Hide preview when sequence leaves review state (review countdown ended)
  useEffect(() => {
    const prevState = prevSequenceStateRef.current;
    const currentState = sequence.sequenceState;

    console.log('[PhotoboothWorkspace] Preview hide check - prevState:', prevState, 'currentState:', currentState, 'showCapturePreview:', showCapturePreview, 'reviewCountdown:', sequence.reviewCountdown);

    // Hide preview when leaving review/waitingForPreview, OR when sequence ends (complete/idle)
    const wasInReview = prevState === 'review' || prevState === 'waitingForPreview';
    const isNowInReview = currentState === 'review' || currentState === 'waitingForPreview';
    const sequenceEnded = (currentState === 'complete' || currentState === 'idle') && prevState !== currentState;

    if ((wasInReview && !isNowInReview || sequenceEnded) && showCapturePreview) {
      console.log('[PhotoboothWorkspace] Review ended, hiding preview');
      previewTimerStartedRef.current = false;
      setShowCapturePreview(false);
      setCapturedPhotoUrl(null);
      updateGuestDisplay({
        currentSetPhotos,
        selectedPhotoIndex,
        displayMode,
        showCapturePreview: false,
        capturedPhotoUrl: null,
      });
    }

    // Update ref for next check
    prevSequenceStateRef.current = currentState;
  }, [sequence.sequenceState, sequence.reviewCountdown, showCapturePreview, updateGuestDisplay, currentSetPhotos, selectedPhotoIndex, displayMode]);

  // Hide preview when manual capture review ends (manualPhase goes from review → idle)
  const prevManualPhaseRef = useRef<string>('idle');
  useEffect(() => {
    const prev = prevManualPhaseRef.current;
    const current = sequence.manualPhase;
    if ((prev === 'review' || prev === 'waiting') && current === 'idle' && showCapturePreview) {
      console.log('[PhotoboothWorkspace] Manual review ended, hiding preview');
      previewTimerStartedRef.current = false;
      setShowCapturePreview(false);
      setCapturedPhotoUrl(null);
      updateGuestDisplay({
        currentSetPhotos,
        selectedPhotoIndex,
        displayMode,
        showCapturePreview: false,
        capturedPhotoUrl: null,
      });
    }
    prevManualPhaseRef.current = current;
  }, [sequence.manualPhase, showCapturePreview, updateGuestDisplay, currentSetPhotos, selectedPhotoIndex, displayMode]);

  // Controls wrapper for UI compatibility
  const setAutoRunActive = (active: boolean) => {
    if (active) sequence.start();
    else sequence.stop();
  };

  // Show no camera warning toast
  const handleShowNoCameraWarning = () => {
    showToast('No Camera Connected', 'error', 3000, 'Connect a camera to capture photos');
  };

  // Show no working folder warning toast
  const handleShowNoWorkingFolderWarning = () => {
    showToast('No Working Folder Set', 'warning', 5000, 'Select a folder in Photobooth settings');
  };

  // Called when capture preview image has finished loading
  const handleCapturePreviewLoad = useCallback(() => {
    console.log('[PhotoboothWorkspace] handleCapturePreviewLoad called - sequenceState:', sequence.sequenceState, 'previewTimerStartedRef:', previewTimerStartedRef.current);

    // Only start timer once (either from main window or guest display, whoever loads first)
    if (previewTimerStartedRef.current) {
      console.log('[PhotoboothWorkspace] Preview timer already started, ignoring');
      return;
    }

    console.log('[PhotoboothWorkspace] Capture preview image loaded, starting review countdown');
    previewTimerStartedRef.current = true;

    // Both manual and automatic captures use the sequence state machine
    console.log('[PhotoboothWorkspace] Calling sequence.startReviewCountdown()');
    sequence.startReviewCountdown();
  }, [sequence.startReviewCountdown]);

  // Each digit stops at different tick for cascading finish sequence
  const getScrambledDigit = (offset: number, stopTick: number) =>
    sequence.scrambleTick < stopTick ? (sequence.scrambleTick + offset) % 10 : 0;

  const togglePhotoSelection = (photoId: string) => {
    // Completely lock photo selection when no set is selected
    if (requiredPhotos === 0) {
      showToast('No set selected', 'warning', 2000, 'Select a custom set in Control Center first');
      return;
    }

    setSelectedPhotos(prev => {
      const newSet = new Set(prev);
      if (newSet.has(photoId)) {
        newSet.delete(photoId);
      } else {
        // Limit selection to required photos from frame
        if (newSet.size < requiredPhotos) {
          newSet.add(photoId);
        }
      }
      return newSet;
    });
  };

  // Handler for creating next session
  const handleNextSession = async () => {
    if (!workingFolder) return;

    try {
      // Find the highest numbered session to increment (from folder names like "Test_004")
      let nextNumber = 1;
      if (sessions.length > 0) {
        const numbers = sessions
          .map(s => {
            const match = s.folderName.match(/_(\d+)$/);
            return match ? parseInt(match[1], 10) : 0;
          })
          .filter(n => n > 0);

        if (numbers.length > 0) {
          nextNumber = Math.max(...numbers) + 1;
        }
      }

      const sessionName = `Session ${nextNumber}`;
      console.log('[PhotoboothWorkspace] Creating next session:', sessionName);

      // Use createNewSession from context which includes Drive folder creation
      const newSession = await createNewSession(sessionName);

      console.log('[PhotoboothWorkspace] Created and switching to session:', newSession.id);

      // Load the new session
      await loadSession(newSession.id);

      // Clear current photos for the new session
      setCurrentSetPhotos([]);
    } catch (error) {
      console.error('[PhotoboothWorkspace] Error creating next session:', error);
    }
  };

  // Handler for finalizing current session — switch to finalize view
  const handleFinalizeSession = async () => {
    setFinalizeViewMode('finalize');

    // Generate QR code from session's Drive folder link if available
    const folderLink = currentSession?.googleDriveMetadata?.folderLink;
    if (folderLink) {
      try {
        const qrBase64 = await invoke<string>('generate_qr_code', { url: folderLink });
        setSessionQrData(qrBase64);
      } catch (err) {
        console.error('[PhotoboothWorkspace] Failed to generate QR code:', err);
        setSessionQrData(null);
      }
    } else {
      setSessionQrData(null);
    }

    // Upload photos to Google Drive if configured
    if (account && currentSession?.googleDriveMetadata?.folderId && workingFolder) {
      const driveFolderId = currentSession.googleDriveMetadata.folderId;

      try {
        let photoFilenames: string[] = [];

        if (qrUploadAllImages) {
          // Upload all photos from current session
          console.log('[PhotoboothWorkspace::handleFinalizeSession] Uploading all session photos to Drive');
          photoFilenames = currentSetPhotos.map(photo => photo.id);
        } else {
          // Upload only selected photos
          console.log('[PhotoboothWorkspace::handleFinalizeSession] Uploading selected photos to Drive');

          // Check if we have placed images (on finalize screen) or selected photos (on capture screen)
          if (placedImages.size > 0) {
            // Use placed images from collage
            photoFilenames = Array.from(placedImages.values())
              .map(img => {
                // Extract filename from source file path (handles both asset:// and file paths)
                const parts = img.sourceFile.split('/');
                return parts[parts.length - 1];
              })
              .filter(Boolean);
          } else if (selectedPhotos.size > 0) {
            // Use selected photos from photo strip
            const selectedPhotosList = currentSetPhotos.filter(p => selectedPhotos.has(p.id));
            photoFilenames = selectedPhotosList.map(photo => photo.id);
          }
        }

        if (photoFilenames.length === 0) {
          console.log('[PhotoboothWorkspace::handleFinalizeSession] No photos to upload');
          return;
        }

        console.log('[PhotoboothWorkspace::handleFinalizeSession] Found photos to upload:', photoFilenames);

        // Build full photo objects with local paths
        const photosToUpload = [];
        const sessionFolderName = sessions.find(s => s.id === currentSession.id)?.folderName || currentSession.id;

        for (const filename of photoFilenames) {
          // Check if already uploaded
          const alreadyUploaded = await invoke<boolean>('is_image_uploaded_to_drive', {
            folderPath: workingFolder,
            sessionId: currentSession.id,
            filename,
          });

          if (!alreadyUploaded) {
            const localPath = `${workingFolder}/${sessionFolderName}/${filename}`;
            photosToUpload.push({ filename, localPath });
          } else {
            console.log('[PhotoboothWorkspace::handleFinalizeSession] Already uploaded:', filename);
          }
        }

        if (photosToUpload.length > 0) {
          console.log(`[PhotoboothWorkspace::handleFinalizeSession] Queueing ${photosToUpload.length} photos for upload`);
          await enqueuePhotos(currentSession.id, photosToUpload, driveFolderId);
        } else {
          console.log('[PhotoboothWorkspace::handleFinalizeSession] All photos already uploaded');
        }
      } catch (error) {
        console.error('[PhotoboothWorkspace::handleFinalizeSession] Upload error:', error);
      }
    } else {
      console.log('[PhotoboothWorkspace::handleFinalizeSession] Skipping upload - Drive not configured');
    }
  };

  const handleBackToCapture = () => {
    setFinalizeViewMode('capture');
    setFinalizeEditingZoneId(null);
    setSessionQrData(null);
  };

  // Get selected photos in order (preserving capture order)
  const getSelectedPhotosOrdered = () => {
    return currentSetPhotos.filter(p => selectedPhotos.has(p.id));
  };

  // Derive session folder name for file paths
  const sessionFolderName = (() => {
    const sessionInfo = sessions.find(s => s.id === currentSession?.id);
    return sessionInfo?.folderName || currentSession?.id || '';
  })();

  const toggleSet = (setId: string) => {
    setExpandedSets(prev => {
      // If clicking on already expanded set, collapse it
      if (prev.has(setId)) {
        return new Set();
      }
      // Otherwise, only expand this one set (accordion behavior)
      return new Set([setId]);
    });
  };

  // Handler for continuing the last session
  const handleContinueSession = async () => {
    if (pendingSessionToLoad) {
      await loadSession(pendingSessionToLoad.id);
      setShowSessionSelectModal(false);
      setPendingSessionToLoad(null);
    }
  };

  // Handler for creating a new session
  const handleCreateNewSession = async () => {
    if (!workingFolder) return;

    try {
      // Find the highest numbered session to increment
      let nextNumber = 1;
      if (sessions.length > 0) {
        const numbers = sessions
          .map(s => {
            // Extract number from folder name like "Test_001"
            const match = s.folderName.match(/_(\d+)$/);
            return match ? parseInt(match[1], 10) : 0;
          })
          .filter(n => n > 0);

        if (numbers.length > 0) {
          nextNumber = Math.max(...numbers) + 1;
        }
      }

      const sessionName = `Session ${nextNumber}`;
      console.log('[PhotoboothWorkspace] Creating new session:', sessionName);

      const newSession = await createNewSession(sessionName);

      // Load the new session
      await loadSession(newSession.id);

      // Clear current photos for the new session
      setCurrentSetPhotos([]);

      setShowSessionSelectModal(false);
      setPendingSessionToLoad(null);
    } catch (error) {
      console.error('[PhotoboothWorkspace] Error creating new session:', error);
    }
  };

  const selectedSet = sessions.find(set => set.id === selectedSetId);
  const currentPreset = displayPresets.find(p => p.id === displayMode);
  const modeIndex = displayPresets.findIndex(p => p.id === displayMode);

  // Handle keyboard navigation for fullscreen mode
  useEffect(() => {
    const handleKeyDown = async (e: KeyboardEvent) => {
      // F11 to toggle window fullscreen
      if (e.key === 'F11') {
        e.preventDefault();
        const currentWindow = getCurrentWindow();
        const isFullscreen = await currentWindow.isFullscreen();
        await currentWindow.setFullscreen(!isFullscreen);
        return;
      }

      // ESC to exit fullscreen
      if (e.key === 'Escape' && selectedPhotoIndex !== null && displayMode === 'canvas') {
        setSelectedPhotoIndex(null);
        return;
      }

      // Arrow key navigation in fullscreen mode
      if (selectedPhotoIndex !== null && displayMode === 'canvas') {
        const photoCount = currentSetPhotos.length || 6; // Use actual photo count or fallback to 6
        if (e.key === 'ArrowLeft') {
          e.preventDefault();
          setSelectedPhotoIndex(prev => (prev !== null ? Math.max(0, prev - 1) : null));
        } else if (e.key === 'ArrowRight') {
          e.preventDefault();
          setSelectedPhotoIndex(prev => (prev !== null ? Math.min(photoCount - 1, prev + 1) : null));
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          setSelectedPhotoIndex(prev => (prev !== null ? Math.max(0, prev - 3) : null));
        } else if (e.key === 'ArrowDown') {
          e.preventDefault();
          setSelectedPhotoIndex(prev => (prev !== null ? Math.min(photoCount - 1, prev + 3) : null));
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedPhotoIndex, displayMode, currentSetPhotos.length]);

  // Sync display mode to guest display
  useEffect(() => {
    updateDisplayMode(displayMode);
  }, [displayMode, updateDisplayMode]);

  // Sync selected photo index to guest display
  useEffect(() => {
    selectPhoto(selectedPhotoIndex);
  }, [selectedPhotoIndex, selectPhoto]);

  // Sync center browse index to guest display
  useEffect(() => {
    selectCenterPhoto(centerBrowseIndex);
  }, [centerBrowseIndex, selectCenterPhoto]);

  // Sync full state to guest display when photos change
  useEffect(() => {
    updateGuestDisplay({
      currentSetPhotos,
      selectedPhotoIndex,
      displayMode,
    });
  }, [currentSetPhotos, selectedPhotoIndex, displayMode, updateGuestDisplay]);

  // Sync countdown state to guest display
  useEffect(() => {
    const isCountdownActive = sequence.sequenceState === 'countdown';
    updateCountdown({
      active: isCountdownActive,
      value: isCountdownActive ? sequence.currentCountdown : 0,
    });
  }, [sequence.sequenceState, sequence.currentCountdown, updateCountdown]);

  // Refs for guest-display:ready handler (avoids stale closures)
  const currentSetPhotosRef = useRef(currentSetPhotos);
  currentSetPhotosRef.current = currentSetPhotos;
  const selectedPhotoIndexRef = useRef(selectedPhotoIndex);
  selectedPhotoIndexRef.current = selectedPhotoIndex;
  const displayModeRef = useRef(displayMode);
  displayModeRef.current = displayMode;
  const centerBrowseIndexRef = useRef(centerBrowseIndex);
  centerBrowseIndexRef.current = centerBrowseIndex;

  // Listen for events from guest display
  useEffect(() => {
    let unlisteners: UnlistenFn[] = [];

    const setupListeners = async () => {
      const [unlisten1, unlisten2, unlisten3, unlisten4] = await Promise.all([
        listen('guest-display:escape', () => {
          setSelectedPhotoIndex(null);
        }),
        listen('guest-display:select-photo', (event: { payload: number | null }) => {
          setSelectedPhotoIndex(event.payload);
        }),
        listen('guest-display:preview-loaded', () => {
          // Guest display has finished loading the preview image, start countdown
          console.log('[PhotoboothWorkspace] Guest display preview loaded');
          handleCapturePreviewLoad();
        }),
        listen('guest-display:ready', () => {
          // Guest display listeners are ready — send full current state
          console.log('[PhotoboothWorkspace] Guest display ready, sending full state');
          emitTo('guest-display', 'guest-display:mode', displayModeRef.current);
          emitTo('guest-display', 'guest-display:update', {
            currentSetPhotos: currentSetPhotosRef.current,
            selectedPhotoIndex: selectedPhotoIndexRef.current,
            displayMode: displayModeRef.current,
          });
          emitTo('guest-display', 'guest-display:center-browse', centerBrowseIndexRef.current);
        }),
      ]);
      unlisteners = [unlisten1, unlisten2, unlisten3, unlisten4];
    };

    setupListeners();

    return () => {
      unlisteners.forEach(u => u());
    };
  }, [handleCapturePreviewLoad]);

  // Handle navigation clicks for DisplayContent
  const handleNavClick = (direction: 'prev' | 'next') => {
    if (selectedPhotoIndex === null) return;
    const totalPhotos = currentSetPhotos.length || 6;
    const newIndex = direction === 'prev'
      ? Math.max(0, selectedPhotoIndex - 1)
      : Math.min(totalPhotos - 1, selectedPhotoIndex + 1);
    setSelectedPhotoIndex(newIndex);
  };

  return (
    <div className="photobooth-workspace">
      {/* Capture Error Modal */}
      <AnimatePresence>
        {captureError && (
          <motion.div
            className="capture-error-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={clearCaptureError}
          >
            <motion.div
              className="capture-error-modal"
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="capture-error-header">
                <AlertTriangle size={24} className="capture-error-icon" />
                <span>Capture Error</span>
                <button className="capture-error-close" onClick={clearCaptureError}>
                  <X size={18} />
                </button>
              </div>
              <div className="capture-error-body">
                <p>{captureError}</p>
              </div>
              <div className="capture-error-footer">
                <button className="capture-error-btn" onClick={clearCaptureError}>
                  Dismiss
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="photobooth-slide-container">
        <AnimatePresence mode="sync">
          {viewMode === 'capture' ? (
            <motion.div
              key="capture"
              className="photobooth-container"
              initial={false}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ type: 'tween', duration: 0.35, ease: 'easeInOut' }}
              style={{ position: 'absolute', inset: 0 }}
            >
        {/* Main 16:9 Guest Display Area */}
        <div className="preview-area">
          <div className="preview-header">
            <div className="preview-title">
              <ImageIcon size={18} />
              <span>Guest Display</span>
            </div>
            <div className="preview-header-right">
              {/* Compact Mode Selector */}
              <div className="mode-selector-compact">
                {sliderStyles && (
                  <div
                    className="mode-selector-indicator"
                    style={{
                      left: sliderStyles.left,
                      width: sliderStyles.width,
                    }}
                  />
                )}
                {displayPresets.map((preset) => (
                  <button
                    key={preset.id}
                    ref={(el) => { tabRefs.current[preset.id] = el; }}
                    className={`mode-tab-compact ${displayMode === preset.id ? 'active' : ''}`}
                    onClick={() => {
                      setDisplayMode(preset.id);
                      setSelectedPhotoIndex(null);
                    }}
                    title={preset.description}
                  >
                    <preset.icon size={16} />
                  </button>
                ))}
              </div>
              <button
                className={`open-display-btn ${isSecondScreenOpen ? 'active' : ''}`}
                onClick={() => {
                  if (isSecondScreenOpen) {
                    closeSecondScreen();
                  } else {
                    openSecondScreen({
                      currentSetPhotos,
                      selectedPhotoIndex,
                      displayMode,
                      centerBrowseIndex,
                    });
                  }
                }}
                title={isSecondScreenOpen ? "Close second screen" : "Open on second screen"}
              >
                <ExternalLink size={16} />
                <span>{isSecondScreenOpen ? 'Close Second Screen' : 'Open on Second Screen'}</span>
              </button>
            </div>
          </div>

          <div className="preview-frame-wrapper">
            <div className="preview-frame">
              <div className="preview-content">
                <DisplayContent
                  displayMode={displayMode}
                  currentSetPhotos={currentSetPhotos}
                  selectedPhotoIndex={selectedPhotoIndex}
                  onPhotoDoubleClick={setSelectedPhotoIndex}
                  onExitFullscreen={() => setSelectedPhotoIndex(null)}
                  liveViewStream={liveViewStream}
                  hdmiStreamUrl={hdmi.frameUrl || ptp.frameUrl}
                  onNavClick={handleNavClick}
                  showGridOverlay={true}
                  showRecentPhotos={true}
                  showBackButton={true}
                  showCapturePreview={showCapturePreview}
                  capturedPhotoUrl={capturedPhotoUrl}
                  onCapturePreviewLoad={handleCapturePreviewLoad}
                  centerBrowseIndex={centerBrowseIndex}
                  onCenterPhotoClick={(index) => setCenterBrowseIndex(index)}
                  onCenterBack={() => setCenterBrowseIndex(null)}
                  onCenterNavClick={(direction) => {
                    setCenterBrowseIndex(prev => {
                      if (prev === null) return null;
                      if (direction === 'prev') return Math.max(0, prev - 1);
                      return Math.min(currentSetPhotos.length - 1, prev + 1);
                    });
                  }}
                />
              </div>
            </div>
          </div>

          {/* Current Set Photo Strip */}
          <CurrentSetPhotoStrip
            currentSetPhotos={currentSetPhotos}
            selectedPhotos={selectedPhotos}
            setName={currentSession?.name ?? ptbSession?.name ?? null}
            workingFolder={workingFolder}
            frameName={selectedCustomSetName ?? null}
            requiredPhotos={requiredPhotos}
            onPhotoSelect={togglePhotoSelection}
            onNextSession={handleNextSession}
            onFinalize={handleFinalizeSession}
          />

          {/* Photobooth Controls */}
          <PhotoboothControls
            sequenceState={sequence.sequenceState}
            currentCountdown={sequence.currentCountdown}
            reviewCountdown={sequence.reviewCountdown}
            photosTaken={sequence.photosTaken}
            scrambleTick={sequence.scrambleTick}
            isActive={sequence.isActive}
            isAutoRunning={sequence.isAutoRunning}
            isPaused={sequence.isPaused}
            manualPhase={sequence.manualPhase}
            manualReviewCountdown={sequence.manualReviewCountdown}
            delayBetweenPhotos={delayBetweenPhotos}
            autoCount={autoCount}
            isCameraConnected={isCameraConnected}
            hasWorkingFolder={!!workingFolder}
            setDelayBetweenPhotos={setDelayBetweenPhotos}
            onToggleActive={() => setAutoRunActive(!sequence.isAutoRunning)}
            onPause={sequence.togglePause}
            onStopIfActive={sequence.stopIfActive}
            onCaptureNow={sequence.captureNow}
            onShowNoCameraWarning={handleShowNoCameraWarning}
            onShowNoWorkingFolderWarning={handleShowNoWorkingFolderWarning}
            getScrambledDigit={getScrambledDigit}
          />
        </div>

        {/* Right Sidebar - Photo Sets Catalog */}
        <PhotoSessionsSidebar
          sessions={sessions}
          selectedSetId={selectedSetId}
          expandedSets={expandedSets}
          hasEverConnected={hasEverConnected}
          isCameraConnected={isCameraConnected}
          isConnecting={isConnecting}
          onSetSelect={setSelectedSetId}
          onToggleSet={toggleSet}
          onLoadSession={loadSession}
          currentSessionId={currentSession?.id}
        />
            </motion.div>
          ) : (
            <motion.div
              key="finalize"
              className="photobooth-container finalize-mode"
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'tween', duration: 0.8, ease: 'easeInOut' }}
              style={{ position: 'absolute', inset: 0 }}
            >
              <FinalizeView
                frame={photoboothFrame!}
                selectedPhotos={getSelectedPhotosOrdered()}
                workingFolder={workingFolder!}
                sessionFolderName={sessionFolderName}
                onBack={handleBackToCapture}
                updateGuestDisplay={updateGuestDisplay}
                isSecondScreenOpen={isSecondScreenOpen}
                openSecondScreen={openSecondScreen}
                qrData={sessionQrData}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Session Selection Modal */}
      <AnimatePresence>
        {showSessionSelectModal && pendingSessionToLoad && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="modal-overlay"
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: 'rgba(0, 0, 0, 0.75)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 1000,
            }}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="modal-content"
              style={{
                backgroundColor: '#1a1a1a',
                borderRadius: '12px',
                padding: '32px',
                minWidth: '480px',
                maxWidth: '560px',
                boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
              }}
            >
              <div style={{ marginBottom: '24px' }}>
                <h2 style={{
                  color: '#fff',
                  fontSize: '22px',
                  fontWeight: 600,
                  marginBottom: '12px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                }}>
                  <FolderOpen size={24} style={{ color: '#3b82f6' }} />
                  Existing Sessions Found
                </h2>
                <p style={{
                  color: '#999',
                  fontSize: '15px',
                  lineHeight: '1.5',
                  margin: 0,
                }}>
                  This folder has {sessions.length} existing session{sessions.length > 1 ? 's' : ''}. Would you like to continue the last session or create a new one?
                </p>
              </div>

              {/* Last session info */}
              {pendingSessionToLoad && (
                <div style={{
                  backgroundColor: '#252525',
                  borderRadius: '8px',
                  padding: '16px',
                  marginBottom: '24px',
                  border: '1px solid #333',
                }}>
                  <div style={{
                    color: '#666',
                    fontSize: '12px',
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                    marginBottom: '6px',
                  }}>Last Session</div>
                  <div style={{
                    color: '#fff',
                    fontSize: '16px',
                    fontWeight: 500,
                    marginBottom: '4px',
                  }}>{pendingSessionToLoad.name}</div>
                  <div style={{
                    color: '#888',
                    fontSize: '13px',
                    display: 'flex',
                    gap: '16px',
                  }}>
                    <span>{pendingSessionToLoad.shotCount} photos</span>
                    <span>•</span>
                    <span>{new Date(pendingSessionToLoad.lastUsedAt).toLocaleDateString()}</span>
                  </div>
                </div>
              )}

              {/* Action buttons */}
              <div style={{
                display: 'flex',
                gap: '12px',
              }}>
                <button
                  onClick={handleContinueSession}
                  style={{
                    flex: 1,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '8px',
                    padding: '14px 20px',
                    backgroundColor: '#252525',
                    color: '#fff',
                    border: '1px solid #444',
                    borderRadius: '8px',
                    fontSize: '15px',
                    fontWeight: 500,
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = '#333';
                    e.currentTarget.style.borderColor = '#555';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = '#252525';
                    e.currentTarget.style.borderColor = '#444';
                  }}
                >
                  <FolderOpen size={18} />
                  Continue Last
                </button>
                <button
                  onClick={handleCreateNewSession}
                  style={{
                    flex: 1,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '8px',
                    padding: '14px 20px',
                    backgroundColor: '#3b82f6',
                    color: '#fff',
                    border: 'none',
                    borderRadius: '8px',
                    fontSize: '15px',
                    fontWeight: 500,
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = '#2563eb';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = '#3b82f6';
                  }}
                >
                  <Plus size={18} />
                  Create New Session
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
