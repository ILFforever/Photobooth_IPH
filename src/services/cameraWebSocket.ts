/**
 * Singleton WebSocket manager for camera daemon communication.
 * Lives outside React lifecycle — no useEffect, no state dependencies.
 * No auto-reconnect — UI shows a modal for the user to reconnect manually.
 */

import { createLogger } from '../utils/logger';
const logger = createLogger('cameraWebSocket');

export interface CameraStatus {
  mode?: string;
  shootingmode?: string;
  battery?: string;
  iso?: string;
  aperture?: string;
  shutter?: string;
  ev?: string;
  wb?: string;
  metering?: string; // Metering mode (e.g., "Multi", "Spot", "Average", "Center" for Fuji)
  lens?: string; // Lens name from camera
}

export interface PhotoDownloadedEvent {
  type: 'photo_downloaded';
  file_path: string;
  camera_path: string;
}

export interface CaptureErrorEvent {
  type: 'capture_error';
  error: string;
}

export interface CameraDisconnectedEvent {
  type: 'camera_disconnected';
}

export interface CameraSwitchedEvent {
  type: 'camera_switched';
  camera_index: number;
}

export interface PollingPausedEvent {
  type: 'polling_paused';
}

export interface PollingResumedEvent {
  type: 'polling_resumed';
}

type EventType = 'status' | 'photo_downloaded' | 'capture_error' | 'camera_disconnected' | 'camera_switched' | 'camera_connecting' | 'camera_connect_failed' | 'camera_connected' | 'connected' | 'disconnected' | 'polling_paused' | 'polling_resumed';
type Listener = (data: any) => void;

const WS_URL = 'ws://localhost:58321/ws';

class CameraWebSocketManager {
  private static instance: CameraWebSocketManager | null = null;

  private ws: WebSocket | null = null;
  private listeners: Map<EventType, Set<Listener>> = new Map();
  private intentionalDisconnect: boolean = false; // Track intentional disconnects across all windows

  private constructor() {
    for (const event of ['status', 'photo_downloaded', 'capture_error', 'camera_disconnected', 'camera_switched', 'camera_connecting', 'camera_connect_failed', 'camera_connected', 'connected', 'disconnected', 'polling_paused', 'polling_resumed'] as EventType[]) {
      this.listeners.set(event, new Set());
    }
  }

  static getInstance(): CameraWebSocketManager {
    if (!CameraWebSocketManager.instance) {
      CameraWebSocketManager.instance = new CameraWebSocketManager();
    }
    return CameraWebSocketManager.instance;
  }

  connect(): void {
    this.createConnection();
  }

  disconnect(): void {
    this.intentionalDisconnect = true;
    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onmessage = null;
      this.ws.onerror = null;
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
    this.emit('disconnected', { intentional: true });
    setTimeout(() => {
      this.intentionalDisconnect = false;
    }, 2000);
  }

  // Check if this is an intentional disconnect (used by camera_disconnected handler)
  isIntentionalDisconnect(): boolean {
    return this.intentionalDisconnect;
  }

  // Clear the intentional flag (called when connecting)
  clearIntentionalFlag(): void {
    this.intentionalDisconnect = false;
  }

  on(event: EventType, callback: Listener): void {
    this.listeners.get(event)?.add(callback);
  }

  off(event: EventType, callback: Listener): void {
    this.listeners.get(event)?.delete(callback);
  }

  private emit(event: EventType, data?: any): void {
    this.listeners.get(event)?.forEach(cb => {
      try {
        cb(data);
      } catch (e) {
        logger.error(`[WS Manager] Error in ${event} listener:`, e);
      }
    });
  }

  private createConnection(): void {
    if (this.ws) {
      const state = this.ws.readyState;
      if (state === WebSocket.OPEN || state === WebSocket.CONNECTING) {
        return;
      }
      this.ws.onopen = null;
      this.ws.onmessage = null;
      this.ws.onerror = null;
      this.ws.onclose = null;
      this.ws = null;
    }

    let ws: WebSocket;
    try {
      ws = new WebSocket(WS_URL);
    } catch (err) {
      logger.error('[WS Manager] Failed to create WebSocket:', err);
      this.emit('disconnected');
      return;
    }

    ws.onopen = () => {
      this.emit('connected');
    };

    ws.onmessage = (event) => {
      const rawData = event.data as string;

      if (!rawData || !rawData.trim().startsWith('{')) {
        return;
      }

      const messages = rawData.includes('}{')
        ? rawData.split(/(?<=\})(?=\{)/)
        : [rawData];

      for (const msg of messages) {
        try {
          const data = JSON.parse(msg);

          if (data.type === 'photo_downloaded') {
            this.emit('photo_downloaded', data as PhotoDownloadedEvent);
          } else if (data.type === 'capture_error') {
            logger.error('[WS Manager] Capture error:', data.error);
            this.emit('capture_error', data as CaptureErrorEvent);
          } else if (data.type === 'camera_disconnected') {
            this.emit('camera_disconnected', data as CameraDisconnectedEvent);
          } else if (data.type === 'camera_switched') {
            this.emit('camera_switched', data as CameraSwitchedEvent);
          } else if (data.type === 'camera_connecting') {
            this.emit('camera_connecting', data);
          } else if (data.type === 'camera_connect_failed') {
            logger.error('[WS Manager] Camera connect failed:', data.error);
            this.emit('camera_connect_failed', data);
          } else if (data.type === 'camera_connected') {
            this.emit('camera_connected', data);
          } else if (data.type === 'polling_paused') {
            this.emit('polling_paused', data as PollingPausedEvent);
          } else if (data.type === 'polling_resumed') {
            this.emit('polling_resumed', data as PollingResumedEvent);
          } else {
            this.emit('status', data as CameraStatus);
          }
        } catch (error) {
          // Silently ignore parsing errors for malformed messages
        }
      }
    };

    ws.onerror = (error) => {
      logger.error('[WS Manager] Error:', error);
    };

    ws.onclose = () => {
      if (this.ws === ws) {
        this.ws = null;
        this.emit('disconnected', { intentional: false });
      }
    };

    this.ws = ws;
  }
}

export default CameraWebSocketManager;
