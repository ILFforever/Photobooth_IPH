/**
 * Singleton WebSocket manager for camera daemon communication.
 * Lives outside React lifecycle — no useEffect, no state dependencies.
 * No auto-reconnect — UI shows a modal for the user to reconnect manually.
 */

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

type EventType = 'status' | 'photo_downloaded' | 'capture_error' | 'camera_disconnected' | 'camera_switched' | 'connected' | 'disconnected';
type Listener = (data: any) => void;

const WS_URL = 'ws://localhost:58321/ws';

class CameraWebSocketManager {
  private static instance: CameraWebSocketManager | null = null;

  private ws: WebSocket | null = null;
  private listeners: Map<EventType, Set<Listener>> = new Map();

  private constructor() {
    for (const event of ['status', 'photo_downloaded', 'capture_error', 'camera_disconnected', 'camera_switched', 'connected', 'disconnected'] as EventType[]) {
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
    if (this.ws) {
      this.ws.onclose = null; // Prevent emitting 'disconnected' on intentional close
      this.ws.onopen = null;
      this.ws.onmessage = null;
      this.ws.onerror = null;
      this.ws.close();
      this.ws = null;
    }
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
        console.error(`[WS Manager] Error in ${event} listener:`, e);
      }
    });
  }

  private createConnection(): void {
    if (this.ws) {
      const state = this.ws.readyState;
      if (state === WebSocket.OPEN || state === WebSocket.CONNECTING) {
        return;
      }
      // CLOSING or CLOSED — detach handlers so the old onclose
      // doesn't interfere with our new connection
      this.ws.onopen = null;
      this.ws.onmessage = null;
      this.ws.onerror = null;
      this.ws.onclose = null;
      this.ws = null;
    }

    console.log('[WS Manager] Connecting...');

    let ws: WebSocket;
    try {
      ws = new WebSocket(WS_URL);
    } catch (err) {
      console.error('[WS Manager] Failed to create WebSocket:', err);
      this.emit('disconnected');
      return;
    }

    ws.onopen = () => {
      console.log('[WS Manager] Connected');
      this.emit('connected');
    };

    ws.onmessage = (event) => {
      const rawData = event.data as string;

      if (!rawData || !rawData.trim().startsWith('{')) {
        if (rawData && rawData.trim().length > 0) {
          console.debug('[WS Manager] Ignoring non-JSON message:', rawData.substring(0, 50));
        }
        return;
      }

      const messages = rawData.includes('}{')
        ? rawData.split(/(?<=\})(?=\{)/)
        : [rawData];

      for (const msg of messages) {
        try {
          const data = JSON.parse(msg);

          if (data.type === 'photo_downloaded') {
            console.log('[WS Manager::onmessage] photo_downloaded event received:', data);
            this.emit('photo_downloaded', data as PhotoDownloadedEvent);
          } else if (data.type === 'capture_error') {
            console.error('[WS Manager] Capture error:', data.error);
            this.emit('capture_error', data as CaptureErrorEvent);
          } else if (data.type === 'camera_disconnected') {
            console.warn('[WS Manager] Camera disconnected');
            this.emit('camera_disconnected', data as CameraDisconnectedEvent);
          } else if (data.type === 'camera_switched') {
            console.log('[WS Manager] Camera switched to index:', data.camera_index);
            this.emit('camera_switched', data as CameraSwitchedEvent);
          } else {
            this.emit('status', data as CameraStatus);
          }
        } catch (error) {
          console.warn('[WS Manager] Error parsing message:', error, 'Raw:', msg.substring(0, 100));
        }
      }
    };

    ws.onerror = (error) => {
      console.error('[WS Manager] Error:', error);
    };

    ws.onclose = () => {
      console.log('[WS Manager] Disconnected');
      if (this.ws === ws) {
        this.ws = null;
        this.emit('disconnected');
        // No auto-reconnect — UI will show a modal for the user
      }
    };

    this.ws = ws;
  }
}

export default CameraWebSocketManager;
