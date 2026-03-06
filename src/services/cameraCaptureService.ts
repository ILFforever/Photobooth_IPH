const API_BASE = 'http://localhost:58321';

import { createLogger } from '../utils/logger';
const logger = createLogger('cameraCaptureService');

export interface CaptureResponse {
  success: boolean;
  message?: string;
  error?: string;
}

export interface FetchPhotoResponse {
  success: boolean;
  data?: ArrayBuffer;
  error?: string;
}

/**
 * Trigger a camera capture via the daemon
 */
export async function triggerCapture(onCaptureStart?: () => void): Promise<CaptureResponse> {
  logger.debug('[CameraCapture] Sending capture request to', `${API_BASE}/api/capture`);
  onCaptureStart?.(); // Call callback when capture request is sent
  try {
    const response = await fetch(`${API_BASE}/api/capture`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });

    logger.debug('[CameraCapture] Response status:', response.status, response.statusText);

    if (!response.ok) {
      throw new Error(`Capture failed: ${response.statusText}`);
    }

    const data = await response.json() as CaptureResponse;
    logger.debug('[CameraCapture] Response data:', data);
    return data;
  } catch (error) {
    logger.error('[CameraCapture] Failed to trigger capture:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * Fetch a photo from the daemon by filename
 * The daemon serves photos at GET /api/photo/{filename}
 */
export async function fetchPhoto(filename: string): Promise<FetchPhotoResponse> {
  logger.debug('[CameraCapture] Fetching photo:', filename);
  try {
    const response = await fetch(`${API_BASE}/api/photo/${encodeURIComponent(filename)}`, {
      method: 'GET',
    });

    logger.debug('[CameraCapture] Fetch photo response status:', response.status, response.statusText);

    if (!response.ok) {
      throw new Error(`Failed to fetch photo: ${response.statusText}`);
    }

    const data = await response.arrayBuffer();
    logger.debug('[CameraCapture] Photo fetched, size:', data.byteLength, 'bytes');
    return {
      success: true,
      data,
    };
  } catch (error) {
    logger.error('[CameraCapture] Failed to fetch photo:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}
