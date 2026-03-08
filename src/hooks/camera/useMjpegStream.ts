import { useState, useEffect, useRef } from 'react';

/**
 * Circular buffer for blob URLs — keeps at most `capacity` URLs alive,
 * revoking the oldest when a new one is pushed.  Ensures bounded memory
 * even when multiple JPEG frames arrive in a single chunk.
 */
class BlobUrlRing {
  private urls: (string | null)[];
  private head = 0;
  private size = 0;

  constructor(private capacity: number) {
    this.urls = new Array(capacity).fill(null);
  }

  /** Add a new URL, revoking the oldest if the ring is full. */
  push(url: string): void {
    if (this.size === this.capacity) {
      const oldest = this.urls[this.head];
      if (oldest) URL.revokeObjectURL(oldest);
    } else {
      this.size++;
    }
    this.urls[this.head] = url;
    this.head = (this.head + 1) % this.capacity;
  }

  /** Revoke every URL still in the ring (used on cleanup). */
  revokeAll(): void {
    for (let i = 0; i < this.capacity; i++) {
      if (this.urls[i]) {
        URL.revokeObjectURL(this.urls[i]!);
        this.urls[i] = null;
      }
    }
    this.head = 0;
    this.size = 0;
  }
}

/** Callback fired for every decoded JPEG frame. */
export type MjpegFrameCallback = (frameUrl: string, frameData: Uint8Array) => void;

export interface MjpegStreamResult {
  isStreaming: boolean;
  error: string | null;
}

/**
 * Callback-driven MJPEG stream decoder.
 *
 * Fetches a multipart/x-mixed-replace stream and extracts individual JPEG
 * frames.  Instead of pushing every frame through React state (which causes
 * re-renders on every frame), it calls `onFrame` directly from the parser.
 *
 * The stream is always consumed — frames are parsed and old blob URLs are
 * revoked regardless of whether any UI is currently displaying them.  This
 * prevents backlog buildup and keeps memory bounded via BlobUrlRing.
 */
export function useMjpegStream(
  streamUrl: string | null,
  onFrame?: MjpegFrameCallback,
): MjpegStreamResult {
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const blobRingRef = useRef(new BlobUrlRing(3));

  // Keep callback in a ref so the stream loop always sees the latest version
  // without needing to restart the effect.
  const onFrameRef = useRef(onFrame);
  onFrameRef.current = onFrame;

  useEffect(() => {
    if (!streamUrl) {
      setIsStreaming(false);
      return;
    }

    const startStreaming = async () => {
      try {
        setError(null);
        setIsStreaming(true);

        abortControllerRef.current = new AbortController();

        const response = await fetch(streamUrl, {
          signal: abortControllerRef.current.signal,
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        if (!response.body) {
          throw new Error('No response body');
        }

        const reader = response.body.getReader();
        let buffer = new Uint8Array();

        // Pre-encode constants once (avoid per-frame TextEncoder allocations)
        const boundaryBytes = new TextEncoder().encode('--FRAME\r\n');
        const headersEndMarker = new TextEncoder().encode('\r\n\r\n');

        const readChunk = async () => {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            // Append new data to buffer
            const newBuffer = new Uint8Array(buffer.length + value.length);
            newBuffer.set(buffer);
            newBuffer.set(value, buffer.length);
            buffer = newBuffer;

            // Parse all complete frames from buffer
            buffer = parseFrames(buffer);
          }
        };

        const parseFrames = (buf: Uint8Array): Uint8Array => {
          let latestFrameUrl: string | null = null;
          let latestFrameData: Uint8Array | null = null;

          while (true) {
            const boundaryIndex = findBytes(buf, boundaryBytes);
            if (boundaryIndex === -1) break;

            if (boundaryIndex > 0) {
              buf = buf.slice(boundaryIndex);
              continue;
            }

            const headersStart = boundaryBytes.length;
            const headersEndIndex = findBytes(buf, headersEndMarker, headersStart);
            if (headersEndIndex === -1) break;

            const headersText = new TextDecoder().decode(buf.slice(headersStart, headersEndIndex));
            const contentLengthMatch = headersText.match(/Content-Length:\s*(\d+)/i);
            if (!contentLengthMatch) {
              buf = buf.slice(headersEndIndex + headersEndMarker.length);
              continue;
            }

            const contentLength = parseInt(contentLengthMatch[1], 10);
            const jpegStart = headersEndIndex + headersEndMarker.length;
            const jpegEnd = jpegStart + contentLength;

            if (buf.length < jpegEnd) break;

            const jpegData = new Uint8Array(contentLength);
            jpegData.set(buf.slice(jpegStart, jpegEnd));

            const blob = new Blob([jpegData], { type: 'image/jpeg' });
            const frameUrl = URL.createObjectURL(blob);
            blobRingRef.current.push(frameUrl);

            latestFrameUrl = frameUrl;
            latestFrameData = jpegData;

            buf = buf.slice(jpegEnd);
          }

          // Fire callback with only the latest frame (skip intermediates)
          if (latestFrameUrl && latestFrameData) {
            onFrameRef.current?.(latestFrameUrl, latestFrameData);
          }

          return buf;
        };

        await readChunk();
      } catch (err) {
        if (err instanceof Error && err.name !== 'AbortError') {
          setError(err.message);
        }
      } finally {
        setIsStreaming(false);
      }
    };

    startStreaming();

    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      blobRingRef.current.revokeAll();
    };
  }, [streamUrl]);

  return { isStreaming, error };
}

/** Find `needle` in `haystack` starting at `start`. Returns index or -1. */
function findBytes(haystack: Uint8Array, needle: Uint8Array, start = 0): number {
  for (let i = start; i <= haystack.length - needle.length; i++) {
    let found = true;
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) {
        found = false;
        break;
      }
    }
    if (found) return i;
  }
  return -1;
}
