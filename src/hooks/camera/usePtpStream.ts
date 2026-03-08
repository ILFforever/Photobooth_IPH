import { useState, useCallback, useRef, useEffect } from 'react';
import { emit } from '@tauri-apps/api/event';
import { useMjpegStream } from './useMjpegStream';
import { createLogger } from '../../utils/logger';
const logger = createLogger('usePtpStream');

const DAEMON_URL = 'http://localhost:58321';

export interface PtpStreamState {
  isStreaming: boolean;
  frameUrl: string | null;
  error: string | null;
  startStream: () => Promise<void>;
  stopStream: () => Promise<void>;
}

/**
 * Convert a Uint8Array to a base64 string efficiently.
 * Uses binary string + btoa which is much cheaper than Array.from()
 * (single string allocation vs N boxed numbers).
 */
function uint8ToBase64(data: Uint8Array): string {
  let binary = '';
  // Process in 8KB chunks to avoid call-stack limits on String.fromCharCode
  const chunkSize = 8192;
  for (let i = 0; i < data.length; i += chunkSize) {
    const slice = data.subarray(i, Math.min(i + chunkSize, data.length));
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}

/**
 * Hook for managing PTP (USB-C) live streaming from camera daemon.
 *
 * Architecture mirrors HDMI: a central callback always consumes the MJPEG
 * stream regardless of whether any UI is displaying the frames.  This
 * prevents frame backlog and keeps the stream pipeline healthy.
 *
 * Frame flow (callback-driven, no intermediate React state):
 *   MJPEG parser  ──onFrame──▶  setFrameUrl (single state update)
 *                              + emit('ptp-frame') to guest display
 */
export function usePtpStream(): PtpStreamState {
  const [isStreaming, setIsStreaming] = useState(false);
  const [frameUrl, setFrameUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [streamUrl, setStreamUrl] = useState<string | null>(null);

  const streamingRef = useRef(false);
  const frameCountRef = useRef(0);

  // Central frame callback — always runs, always consumes.
  // Updates React state (for main window display) and emits to guest display
  // in a single synchronous callback.  No useEffect chain, no extra renders.
  const handleFrame = useCallback((blobUrl: string, jpegData: Uint8Array) => {
    if (!streamingRef.current) return;

    frameCountRef.current++;
    if (frameCountRef.current === 1) {
      logger.debug('First PTP frame received');
    }

    // Single state update for the main window
    setFrameUrl(blobUrl);

    // Emit to guest display as base64 (same format as HDMI)
    // base64 is a single string — much cheaper than Array.from() which
    // creates N boxed number objects for every byte of JPEG data.
    const b64 = uint8ToBase64(jpegData);
    emit('ptp-frame-b64', b64).catch(err => {
      logger.error('Failed to emit frame event:', err);
    });
  }, []);

  // Use MJPEG decoder with callback — no React state in the hot path
  const { error: streamError, isStreaming: streamActive } = useMjpegStream(streamUrl, handleFrame);

  // Handle stream errors
  useEffect(() => {
    if (streamError) {
      logger.error('Stream error:', streamError);
      setError(streamError);
    }
  }, [streamError]);

  // Auto-reconnect when stream stops during capture
  useEffect(() => {
    if (streamingRef.current && !streamActive && streamUrl !== null && !error) {
      logger.debug('Stream interrupted, reconnecting in 400ms...');

      const reconnectTimer = setTimeout(() => {
        if (streamingRef.current && !error) {
          logger.debug('Reconnecting to stream...');
          setStreamUrl(`${DAEMON_URL}/api/liveview/ptp-stream?t=${Date.now()}`);
        } else {
          logger.debug('Reconnect cancelled (stopped or error)');
        }
      }, 400);

      return () => clearTimeout(reconnectTimer);
    }
  }, [streamActive, streamUrl, error]);

  // Start PTP streaming
  const startStream = useCallback(async () => {
    if (streamingRef.current) return;

    setError(null);
    streamingRef.current = true;
    setIsStreaming(true);
    frameCountRef.current = 0;

    try {
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

      setStreamUrl(`${DAEMON_URL}/api/liveview/ptp-stream?t=${Date.now()}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('Failed to start streaming:', msg);
      setError(`Failed to start streaming: ${msg}`);
      streamingRef.current = false;
      setIsStreaming(false);
      setStreamUrl(null);
    }
  }, []);

  // Stop PTP streaming
  const stopStream = useCallback(async () => {
    if (!streamingRef.current) return;

    streamingRef.current = false;
    setIsStreaming(false);
    setStreamUrl(null);
    setError(null);
    setFrameUrl(null);

    try {
      const response = await fetch(`${DAEMON_URL}/api/liveview/ptp-stream/stop`, {
        method: 'POST',
      });

      if (!response.ok) {
        logger.warn('Failed to stop streaming on daemon');
      } else {
        const data = await response.json();
        if (!data.success) {
          logger.warn('Daemon error stopping stream:', data.error);
        }
      }
    } catch (err) {
      logger.error('Error stopping streaming:', err);
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (streamingRef.current) {
        streamingRef.current = false;
        setStreamUrl(null);

        fetch(`${DAEMON_URL}/api/liveview/ptp-stream/stop`, { method: 'POST' })
          .catch((err) => logger.warn('Cleanup error stopping stream:', err));
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
