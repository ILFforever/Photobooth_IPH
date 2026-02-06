const API_BASE = 'http://localhost:58321';

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
export async function triggerCapture(): Promise<CaptureResponse> {
  console.log('[CameraCapture] Sending capture request to', `${API_BASE}/api/capture`);
  try {
    const response = await fetch(`${API_BASE}/api/capture`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });

    console.log('[CameraCapture] Response status:', response.status, response.statusText);

    if (!response.ok) {
      throw new Error(`Capture failed: ${response.statusText}`);
    }

    const data = await response.json() as CaptureResponse;
    console.log('[CameraCapture] Response data:', data);
    return data;
  } catch (error) {
    console.error('[CameraCapture] Failed to trigger capture:', error);
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
  console.log('[CameraCapture] Fetching photo:', filename);
  try {
    const response = await fetch(`${API_BASE}/api/photo/${encodeURIComponent(filename)}`, {
      method: 'GET',
    });

    console.log('[CameraCapture] Fetch photo response status:', response.status, response.statusText);

    if (!response.ok) {
      throw new Error(`Failed to fetch photo: ${response.statusText}`);
    }

    const data = await response.arrayBuffer();
    console.log('[CameraCapture] Photo fetched, size:', data.byteLength, 'bytes');
    return {
      success: true,
      data,
    };
  } catch (error) {
    console.error('[CameraCapture] Failed to fetch photo:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}
