import { useState, useEffect, useRef, useCallback } from 'react';
import { createLogger } from '../utils/logger';
const logger = createLogger('useLiveViewManager');

export interface CaptureDevice {
  id: string;
  name: string;
}

export interface LiveViewManagerState {
  stream: MediaStream | null;
  isStreamActive: boolean;
  streamError: string | null;
  isRecovering: boolean;

  devices: CaptureDevice[];
  selectedDeviceId: string;
  isLoadingDevices: boolean;
  permissionError: string | null;

  startStream: (deviceId: string) => Promise<void>;
  stopStream: () => void;
  restartStream: () => Promise<void>;
  setSelectedDevice: (deviceId: string) => void;
  reloadDevices: () => Promise<void>;
}

// Recovery configuration
const RECOVERY = {
  MAX_ATTEMPTS: 8,
  BASE_DELAY_MS: 1200,
  MAX_DELAY_MS: 10_000,
  BACKOFF_FACTOR: 1.5,
  MUTE_GRACE_MS: 2000,
  DEVICE_POLL_INTERVAL_MS: 800, // how often to check if device is back
} as const;

/**
 * Centralized LiveView Manager
 *
 * Handles all MediaStream lifecycle, device enumeration, and automatic recovery.
 * Recovery uses device-availability polling + exponential backoff to avoid
 * wasting getUserMedia calls on a device that's still re-enumerating.
 */
export function useLiveViewManager(): LiveViewManagerState {
  // --- State ---
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [isStreamActive, setIsStreamActive] = useState(false);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [isRecovering, setIsRecovering] = useState(false);

  const [devices, setDevices] = useState<CaptureDevice[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState('');
  const [isLoadingDevices, setIsLoadingDevices] = useState(true);
  const [permissionError, setPermissionError] = useState<string | null>(null);

  // --- Refs ---
  const mountedRef = useRef(true);
  const streamRef = useRef<MediaStream | null>(null);
  const activeDeviceIdRef = useRef<string>('');
  const lastDeviceIdRef = useRef<string>('');
  const lastDeviceNameRef = useRef<string>(''); // remember name for re-enumeration matching
  const streamStartingRef = useRef(false);
  const permissionGrantedRef = useRef(false);

  // Recovery refs
  const recoveryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recoveryAttemptRef = useRef(0);
  const isRecoveringRef = useRef(false);
  const muteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Device change debounce
  const deviceChangeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // --- Helpers ---

  const cancelRecovery = useCallback(() => {
    if (recoveryTimerRef.current) {
      clearTimeout(recoveryTimerRef.current);
      recoveryTimerRef.current = null;
    }
    if (muteTimerRef.current) {
      clearTimeout(muteTimerRef.current);
      muteTimerRef.current = null;
    }
    recoveryAttemptRef.current = 0;
    isRecoveringRef.current = false;
    setIsRecovering(false);
  }, []);

  const detachTrackListeners = (track: MediaStreamTrack) => {
    track.onended = null;
    track.onmute = null;
    track.onunmute = null;
  };

  /**
   * Tear down a MediaStream safely.
   * If `gentle` is true, only detach listeners and null the ref — do NOT
   * call track.stop(). This avoids triggering a USB device reset on capture
   * cards when the track has already ended.
   */
  const teardownStream = useCallback((gentle = false) => {
    const s = streamRef.current;
    if (s) {
      s.getTracks().forEach(track => {
        detachTrackListeners(track);
        if (!gentle && track.readyState === 'live') {
          track.stop();
        }
        // If the track already ended, do NOT call stop() — on some UVC
        // capture cards this sends a USB SET_CUR release that triggers a
        // full device re-enumeration / reset (~5 s downtime).
      });
      streamRef.current = null;
    }
    activeDeviceIdRef.current = '';
  }, []);

  // --- Core: loadDevices ---

  const loadDevices = useCallback(async () => {
    if (!mountedRef.current) return;

    setIsLoadingDevices(true);
    setPermissionError(null);

    try {
      if (!navigator.mediaDevices?.enumerateDevices) {
        throw new Error('MediaDevices API not supported');
      }

      if (!permissionGrantedRef.current) {
        logger.debug('[LiveViewManager] Requesting initial media permission...');
        const permissionStream = await navigator.mediaDevices.getUserMedia({ video: true });
        permissionStream.getTracks().forEach(track => track.stop());
        permissionGrantedRef.current = true;
        logger.debug('[LiveViewManager] Permission granted');
      }

      const allDevices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = allDevices
        .filter(d => d.kind === 'videoinput')
        .map(d => ({
          id: d.deviceId,
          name: d.label || `Camera ${d.deviceId.slice(0, 8)}`,
        }));

      if (!mountedRef.current) return;

      //logger.debug('[LiveViewManager] Devices found:', videoDevices.length);
      setDevices(videoDevices);

      if (videoDevices.length === 0) {
        setPermissionError('No video devices found');
      }
    } catch (error) {
      if (!mountedRef.current) return;
      logger.error('[LiveViewManager] Device enumeration error:', error);
      setPermissionError(error instanceof Error ? error.message : 'Failed to access camera devices');
    } finally {
      if (mountedRef.current) {
        setIsLoadingDevices(false);
      }
    }
  }, []);

  // --- Core: startStream ---

  const startStream = useCallback(async (deviceId: string) => {
    // Guard: already streaming from this exact device with a live track
    if (
      activeDeviceIdRef.current === deviceId &&
      streamRef.current &&
      streamRef.current.getVideoTracks().some(t => t.readyState === 'live')
    ) {
      return;
    }

    // Guard: another start is in-flight
    if (streamStartingRef.current) {
      logger.debug('[LiveViewManager] Start already in progress, queued device:', deviceId);
      lastDeviceIdRef.current = deviceId;
      return;
    }

    streamStartingRef.current = true;

    // Tear down any existing stream (stop live tracks only)
    if (streamRef.current) {
      logger.debug('[LiveViewManager] Tearing down previous stream');
      teardownStream(false);
      if (mountedRef.current) {
        setStream(null);
        setIsStreamActive(false);
      }
    }

    try {
      logger.debug('[LiveViewManager] getUserMedia for device:', deviceId);

      const newStream = await navigator.mediaDevices.getUserMedia({
        video: { deviceId: { exact: deviceId } },
      });

      if (!mountedRef.current) {
        newStream.getTracks().forEach(t => t.stop());
        return;
      }

      const videoTrack = newStream.getVideoTracks()[0];
      if (!videoTrack || videoTrack.readyState !== 'live') {
        newStream.getTracks().forEach(t => t.stop());
        throw new Error('Video track not live after getUserMedia');
      }

      // Store device name for recovery matching
      const settings = videoTrack.getSettings();
      if (settings.deviceId) {
        lastDeviceNameRef.current =
          videoTrack.label || `Camera ${settings.deviceId.slice(0, 8)}`;
      }

      // --- Attach unified recovery handlers ---
      videoTrack.onended = () => {
        logger.warn('[LiveViewManager] Track ended — scheduling recovery');
        scheduleRecovery(deviceId);
      };

      videoTrack.onmute = () => {
        logger.warn('[LiveViewManager] Track muted — waiting grace period');
        if (muteTimerRef.current) clearTimeout(muteTimerRef.current);
        muteTimerRef.current = setTimeout(() => {
          muteTimerRef.current = null;
          if (
            mountedRef.current &&
            streamRef.current === newStream &&
            videoTrack.muted &&
            videoTrack.readyState === 'live'
          ) {
            logger.warn('[LiveViewManager] Track still muted after grace — scheduling recovery');
            scheduleRecovery(deviceId);
          }
        }, RECOVERY.MUTE_GRACE_MS);
      };

      videoTrack.onunmute = () => {
        if (muteTimerRef.current) {
          clearTimeout(muteTimerRef.current);
          muteTimerRef.current = null;
        }
        if (mountedRef.current) setStreamError(null);
      };

      // --- Commit state ---
      streamRef.current = newStream;
      activeDeviceIdRef.current = deviceId;
      lastDeviceIdRef.current = deviceId;

      if (mountedRef.current) {
        setStream(newStream);
        setIsStreamActive(true);
        setStreamError(null);
        setSelectedDeviceId(deviceId);
        cancelRecovery();
      }

      logger.debug('[LiveViewManager] Stream started successfully');
    } catch (error) {
      logger.error('[LiveViewManager] getUserMedia failed:', error);
      streamRef.current = null;
      activeDeviceIdRef.current = '';

      if (mountedRef.current) {
        setStream(null);
        setIsStreamActive(false);
      }

      throw error;
    } finally {
      streamStartingRef.current = false;
    }
  }, [teardownStream, cancelRecovery]);

  // --- Recovery ---

  /**
   * Check if a device (by ID or by name) is currently visible to the browser.
   * Returns the matching device ID (which may differ from originalId if the
   * device re-enumerated with a new ID), or null if not found.
   */
  const findAvailableDevice = useCallback(async (
    originalId: string,
    deviceName: string,
  ): Promise<string | null> => {
    try {
      const allDevices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = allDevices.filter(d => d.kind === 'videoinput');

      // First: exact ID match
      const exactMatch = videoDevices.find(d => d.deviceId === originalId);
      if (exactMatch) return exactMatch.deviceId;

      // Second: name match (device may have re-enumerated with a new ID)
      if (deviceName) {
        const nameMatch = videoDevices.find(d => d.label === deviceName);
        if (nameMatch) {
          logger.debug('[LiveViewManager] Device found by name with new ID:', nameMatch.deviceId);
          return nameMatch.deviceId;
        }
      }

      return null;
    } catch {
      return null;
    }
  }, []);

  /**
   * Unified recovery entry point.
   * 1. Gentle teardown (no track.stop on ended tracks to avoid USB reset)
   * 2. Poll enumerateDevices until the device is visible again
   * 3. Then call getUserMedia
   */
  const scheduleRecovery = useCallback((deviceId: string) => {
    if (!mountedRef.current) return;

    // Deduplicate: cancel any pending recovery timer
    if (recoveryTimerRef.current) {
      clearTimeout(recoveryTimerRef.current);
      recoveryTimerRef.current = null;
    }

    // GENTLE teardown: don't call stop() on ended tracks — this avoids
    // triggering a USB device reset on the capture card.
    teardownStream(true);
    if (mountedRef.current) {
      setStream(null);
      setIsStreamActive(false);
    }

    isRecoveringRef.current = true;
    if (mountedRef.current) setIsRecovering(true);

    const attempt = recoveryAttemptRef.current;

    if (attempt >= RECOVERY.MAX_ATTEMPTS) {
      logger.error('[LiveViewManager] Recovery exhausted after', attempt, 'attempts');
      isRecoveringRef.current = false;
      if (mountedRef.current) {
        setIsRecovering(false);
        setStreamError('Live view connection lost. Please re-select the device.');
      }
      recoveryAttemptRef.current = 0;
      return;
    }

    const delay = Math.min(
      RECOVERY.BASE_DELAY_MS * Math.pow(RECOVERY.BACKOFF_FACTOR, attempt),
      RECOVERY.MAX_DELAY_MS,
    );

    logger.debug(
      `[LiveViewManager] Recovery attempt ${attempt + 1}/${RECOVERY.MAX_ATTEMPTS} in ${Math.round(delay)}ms`,
    );
    recoveryAttemptRef.current = attempt + 1;

    recoveryTimerRef.current = setTimeout(async () => {
      recoveryTimerRef.current = null;
      if (!mountedRef.current) return;

      // Step 1: Check if the device is visible before wasting a getUserMedia call
      const resolvedId = await findAvailableDevice(deviceId, lastDeviceNameRef.current);

      if (!mountedRef.current) return;

      if (!resolvedId) {
        logger.debug('[LiveViewManager] Device not visible yet, will retry');
        scheduleRecovery(deviceId);
        return;
      }

      // Step 2: Device is visible — try to acquire the stream
      try {
        await startStream(resolvedId);
        logger.debug('[LiveViewManager] Recovery succeeded on attempt', attempt + 1);
        // Update the device ID if it changed after re-enumeration
        if (resolvedId !== deviceId) {
          lastDeviceIdRef.current = resolvedId;
          if (mountedRef.current) setSelectedDeviceId(resolvedId);
        }
      } catch {
        logger.warn('[LiveViewManager] Recovery attempt', attempt + 1, 'failed (getUserMedia)');
        scheduleRecovery(deviceId);
      }
    }, delay);
  }, [teardownStream, startStream, cancelRecovery, findAvailableDevice]);

  // --- stopStream (user-initiated) ---

  const stopStream = useCallback(() => {
    logger.debug('[LiveViewManager] stopStream (user-initiated)');
    cancelRecovery();
    teardownStream(false); // user-initiated: do a full stop

    if (mountedRef.current) {
      setStream(null);
      setIsStreamActive(false);
      setStreamError(null);
    }
  }, [cancelRecovery, teardownStream]);

  // --- restartStream ---

  const restartStream = useCallback(async () => {
    const deviceId = lastDeviceIdRef.current;
    if (!deviceId) {
      logger.warn('[LiveViewManager] No device to restart');
      return;
    }
    logger.debug('[LiveViewManager] restartStream for device:', deviceId);
    cancelRecovery();
    teardownStream(false);

    if (mountedRef.current) {
      setStream(null);
      setIsStreamActive(false);
    }

    await new Promise(r => setTimeout(r, 300));
    if (!mountedRef.current) return;

    await startStream(deviceId);
  }, [cancelRecovery, teardownStream, startStream]);

  // --- Device change handler ---

  const handleDeviceChange = useCallback(() => {
    if (deviceChangeTimerRef.current) {
      clearTimeout(deviceChangeTimerRef.current);
    }

    deviceChangeTimerRef.current = setTimeout(() => {
      deviceChangeTimerRef.current = null;
      if (!mountedRef.current) return;

      if (isRecoveringRef.current || streamRef.current) {
        logger.debug('[LiveViewManager] Device change ignored (recovery/stream active)');
        return;
      }

      logger.debug('[LiveViewManager] Device change — reloading devices');
      loadDevices();
    }, 500);
  }, [loadDevices]);

  // --- Mount / Unmount ---

  useEffect(() => {
    mountedRef.current = true;
    loadDevices();
    navigator.mediaDevices?.addEventListener('devicechange', handleDeviceChange);

    return () => {
      logger.debug('[LiveViewManager] Unmounting — full cleanup');
      mountedRef.current = false;

      navigator.mediaDevices?.removeEventListener('devicechange', handleDeviceChange);

      if (deviceChangeTimerRef.current) clearTimeout(deviceChangeTimerRef.current);
      if (recoveryTimerRef.current) clearTimeout(recoveryTimerRef.current);
      if (muteTimerRef.current) clearTimeout(muteTimerRef.current);

      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => {
          t.onended = null;
          t.onmute = null;
          t.onunmute = null;
          t.stop();
        });
        streamRef.current = null;
      }
    };
  }, [loadDevices, handleDeviceChange]);

  return {
    stream,
    isStreamActive,
    streamError,
    isRecovering,

    devices,
    selectedDeviceId,
    isLoadingDevices,
    permissionError,

    startStream,
    stopStream,
    restartStream,
    setSelectedDevice: setSelectedDeviceId,
    reloadDevices: loadDevices,
  };
}
