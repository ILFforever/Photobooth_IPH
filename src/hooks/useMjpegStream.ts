import { useState, useEffect, useRef } from 'react';

/**
 * Custom MJPEG stream decoder hook
 * Fetches multipart/x-mixed-replace stream and extracts individual JPEG frames
 */
export function useMjpegStream(streamUrl: string | null) {
  const [currentFrame, setCurrentFrame] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const rafIdRef = useRef<number | null>(null);
  const pendingFrameRef = useRef<string | null>(null);

  useEffect(() => {
    if (!streamUrl) {
      setCurrentFrame(null);
      setIsStreaming(false);
      return;
    }

    const startStreaming = async () => {
      try {
        setError(null);
        setIsStreaming(true);

        // Create abort controller for cleanup
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

        const readChunk = async () => {
          while (true) {
            const { done, value } = await reader.read();

            if (done) {
              break;
            }

            // Append new data to buffer
            const newBuffer = new Uint8Array(buffer.length + value.length);
            newBuffer.set(buffer);
            newBuffer.set(value, buffer.length);
            buffer = newBuffer;

            // Parse MJPEG frames from buffer
            parseFrames();
          }
        };

        const parseFrames = () => {
          let latestFrameUrl: string | null = null;
          let foundFrame = false;

          while (true) {
            // Look for frame boundary: --FRAME\r\n
            const boundaryText = '--FRAME\r\n';
            const boundaryBytes = new TextEncoder().encode(boundaryText);
            const boundaryIndex = findBytesInBuffer(buffer, boundaryBytes);

            if (boundaryIndex === -1) {
              // No complete boundary yet
              break;
            }

            // If boundary is not at start, we joined mid-stream - discard garbage data
            if (boundaryIndex > 0) {
              buffer = buffer.slice(boundaryIndex);
              continue; // Re-parse with cleaned buffer
            }

            // Parse headers after boundary (boundary is now at position 0)
            const headersStart = boundaryBytes.length;
            const headersEndMarker = new TextEncoder().encode('\r\n\r\n');
            const headersEndIndex = findBytesInBuffer(buffer, headersEndMarker, headersStart);

            if (headersEndIndex === -1) {
              // Headers incomplete, wait for more data
              break;
            }

            // Extract and parse headers
            const headersData = buffer.slice(headersStart, headersEndIndex);
            const headersText = new TextDecoder().decode(headersData);

            // Parse Content-Length
            const contentLengthMatch = headersText.match(/Content-Length:\s*(\d+)/i);
            if (!contentLengthMatch) {
              // No Content-Length, skip this frame
              buffer = buffer.slice(headersEndIndex + headersEndMarker.length);
              continue;
            }

            const contentLength = parseInt(contentLengthMatch[1], 10);
            const jpegStart = headersEndIndex + headersEndMarker.length;
            const jpegEnd = jpegStart + contentLength;

            // Check if we have the complete JPEG data
            if (buffer.length < jpegEnd) {
              // JPEG data incomplete, wait for more data
              break;
            }

            // Extract JPEG data using a proper copy
            const jpegData = new Uint8Array(contentLength);
            jpegData.set(buffer.slice(jpegStart, jpegEnd));

            // Create blob URL for the JPEG frame
            const blob = new Blob([jpegData], { type: 'image/jpeg' });
            const frameUrl = URL.createObjectURL(blob);

            // Store as latest frame - consumer (usePtpStream) handles cleanup
            latestFrameUrl = frameUrl;
            foundFrame = true;

            // Remove processed frame from buffer
            buffer = buffer.slice(jpegEnd);
          }

          // Schedule state update using requestAnimationFrame to prevent excessive updates
          // This ensures setState is called in sync with browser's paint cycle
          if (foundFrame && latestFrameUrl) {
            // Store the latest frame
            pendingFrameRef.current = latestFrameUrl;

            // Cancel any pending RAF update
            if (rafIdRef.current !== null) {
              cancelAnimationFrame(rafIdRef.current);
            }

            // Schedule a single state update on the next animation frame
            rafIdRef.current = requestAnimationFrame(() => {
              if (pendingFrameRef.current) {
                setCurrentFrame(pendingFrameRef.current);
                rafIdRef.current = null;
              }
            });
          }
        };

        const findBytesInBuffer = (
          haystack: Uint8Array,
          needle: Uint8Array,
          start = 0
        ): number => {
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
        };

        await readChunk();
      } catch (err) {
        if (err instanceof Error) {
          if (err.name !== 'AbortError') {
            setError(err.message);
          }
        }
      } finally {
        setIsStreaming(false);
      }
    };

    startStreaming();

    // Cleanup
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      // Cancel any pending RAF updates
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
      // Note: Consumer (usePtpStream) handles blob URL cleanup
      setCurrentFrame(null);
    };
  }, [streamUrl]);

  return { currentFrame, isStreaming, error };
}
