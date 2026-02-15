import { useState, useCallback, useRef, useEffect } from 'react';
import { emit } from '@tauri-apps/api/event';
import { useMjpegStream } from './useMjpegStream';

const DAEMON_URL = 'http://localhost:58321';

export interface PtpStreamState {
  isStreaming: boolean;
  frameUrl: string | null;
  error: string | null;
  startStream: () => Promise<void>;
  stopStream: () => Promise<void>;
}

/**
 * Hook for managing PTP (USB-C) live streaming from camera daemon
 *
 * This hook:
 * - Manages PTP stream lifecycle (start/stop)
 * - Decodes MJPEG stream into individual frames
 * - Emits frames as Tauri events for multi-window support (guest display)
 * - Handles memory cleanup of blob URLs
 *
 * Similar to useHdmiCapture but for PTP streaming over USB-C
 */
export function usePtpStream(): PtpStreamState {
  const [isStreaming, setIsStreaming] = useState(false);
  const [frameUrl, setFrameUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [streamUrl, setStreamUrl] = useState<string | null>(null);

  const streamingRef = useRef(false);
  const prevUrlRef = useRef<string | null>(null);
  const frameCountRef = useRef(0);
  const emitIntervalRef = useRef(0);

  // Use MJPEG decoder to get individual frames
  const { currentFrame, error: streamError } = useMjpegStream(streamUrl);

  // Handle stream errors
  useEffect(() => {
    if (streamError) {
      console.error('[usePtpStream] Stream error:', streamError);
      setError(streamError);
    }
  }, [streamError]);

  // When a new frame arrives, emit it as a Tauri event for guest display
  // and update local state
  useEffect(() => {
    if (!currentFrame || !streamingRef.current) return;

    // Capture the current frame URL to avoid closure issues
    const thisFrameUrl = currentFrame;

    frameCountRef.current++;

    // Log first frame
    if (frameCountRef.current === 1) {
      console.log('[usePtpStream] ✓ First PTP frame received');
    }

    // Update local state for main window FIRST
    setFrameUrl(thisFrameUrl);

    // Store the previous frame URL that we'll revoke later
    const prevFrameUrl = prevUrlRef.current;
    prevUrlRef.current = thisFrameUrl;

    // Emit frame as Tauri event for guest display
    // Convert blob URL to base64 for transmission BEFORE revoking
    fetch(thisFrameUrl)
      .then(res => res.blob())
      .then(blob => blob.arrayBuffer())
      .then(buffer => {
        const base64 = btoa(
          new Uint8Array(buffer).reduce((data, byte) => data + String.fromCharCode(byte), '')
        );

        // Throttle emissions - only emit every 2nd frame to reduce IPC overhead
        // (15 FPS becomes 7.5 FPS for guest display, still smooth)
        emitIntervalRef.current++;
        if (emitIntervalRef.current % 2 === 0) {
          emit('ptp-frame', base64).catch(err => {
            console.error('[usePtpStream] Failed to emit frame event:', err);
          });
        }

        // Cleanup PREVIOUS frame URL after conversion is complete
        // Safe to revoke now because we've finished using it
        if (prevFrameUrl && prevFrameUrl !== thisFrameUrl) {
          URL.revokeObjectURL(prevFrameUrl);
        }
      })
      .catch(err => {
        console.error('[usePtpStream] Failed to convert frame for emission:', err);

        // Still cleanup previous frame even if conversion fails
        if (prevFrameUrl && prevFrameUrl !== thisFrameUrl) {
          URL.revokeObjectURL(prevFrameUrl);
        }
      });
  }, [currentFrame]);

  // Start PTP streaming
  const startStream = useCallback(async () => {
    if (streamingRef.current) {
      return;
    }

    setError(null);
    streamingRef.current = true;
    setIsStreaming(true);
    frameCountRef.current = 0;
    emitIntervalRef.current = 0;

    try {
      // Request daemon to start streaming
      const response = await fetch(`${DAEMON_URL}/api/liveview/ptp-stream/start`, {
        method: 'POST',
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || 'Failed to start PTP streaming');
      }

      // Set stream URL with cache-busting timestamp
      // This triggers useMjpegStream to start decoding
      setStreamUrl(`${DAEMON_URL}/api/liveview/ptp-stream?t=${Date.now()}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[usePtpStream] Failed to start streaming:', msg);
      setError(`Failed to start streaming: ${msg}`);
      streamingRef.current = false;
      setIsStreaming(false);
      setStreamUrl(null);
    }
  }, []);

  // Stop PTP streaming
  const stopStream = useCallback(async () => {
    if (!streamingRef.current) {
      return;
    }

    streamingRef.current = false;
    setIsStreaming(false);
    setStreamUrl(null);

    // Cleanup current frame URL
    if (prevUrlRef.current) {
      URL.revokeObjectURL(prevUrlRef.current);
      prevUrlRef.current = null;
    }
    setFrameUrl(null);

    try {
      // Request daemon to stop streaming
      const response = await fetch(`${DAEMON_URL}/api/liveview/ptp-stream/stop`, {
        method: 'POST',
      });

      if (!response.ok) {
        console.warn('[usePtpStream] Failed to stop streaming on daemon');
      } else {
        const data = await response.json();
        if (!data.success) {
          console.warn('[usePtpStream] Daemon error stopping stream:', data.error);
        }
      }
    } catch (err) {
      console.error('[usePtpStream] Error stopping streaming:', err);
      // Continue cleanup even if daemon stop fails
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (streamingRef.current) {
        streamingRef.current = false;
        setStreamUrl(null);

        // Cleanup blob URL
        if (prevUrlRef.current) {
          URL.revokeObjectURL(prevUrlRef.current);
          prevUrlRef.current = null;
        }

        // Best effort stop on daemon (fire and forget)
        fetch(`${DAEMON_URL}/api/liveview/ptp-stream/stop`, { method: 'POST' })
          .catch(() => {/* ignore cleanup errors */});
      }
    };
  }, []);

  return {
    isStreaming,
    frameUrl,
    error,
    startStream,
    stopStream,
  };
}
