/**
 * Singleton WebSocket manager for camera daemon communication.
 * Lives outside React lifecycle — no useEffect, no state dependencies.
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
}

export interface PhotoDownloadedEvent {
  type: 'photo_downloaded';
  file_path: string;
  camera_path: string;
}

type EventType = 'status' | 'photo_downloaded' | 'connected' | 'disconnected';
type Listener = (data: any) => void;

const WS_URL = 'ws://localhost:58321/ws';
const RECONNECT_BASE_MS = 2000;
const RECONNECT_MAX_MS = 30000;

class CameraWebSocketManager {
  private static instance: CameraWebSocketManager | null = null;

  private ws: WebSocket | null = null;
  private listeners: Map<EventType, Set<Listener>> = new Map();
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private shouldConnect = false;

  private constructor() {
    // Initialize listener sets
    for (const event of ['status', 'photo_downloaded', 'connected', 'disconnected'] as EventType[]) {
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
    this.shouldConnect = true;
    this.createConnection();
  }

  disconnect(): void {
    this.shouldConnect = false;
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    if (this.ws) {
      this.ws.onclose = null; // Prevent reconnect on intentional close
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
      // Already have a connection or connecting
      if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
        return;
      }
    }

    console.log('[WS Manager] Connecting...');
    const ws = new WebSocket(WS_URL);

    ws.onopen = () => {
      console.log('[WS Manager] Connected');
      this.reconnectAttempt = 0;
      this.emit('connected');
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        if (data.type === 'photo_downloaded') {
          this.emit('photo_downloaded', data as PhotoDownloadedEvent);
        } else {
          this.emit('status', data as CameraStatus);
        }
      } catch (error) {
        console.error('[WS Manager] Error parsing message:', error);
      }
    };

    ws.onerror = (error) => {
      console.error('[WS Manager] Error:', error);
    };

    ws.onclose = () => {
      console.log('[WS Manager] Disconnected');
      this.ws = null;
      this.emit('disconnected');
      this.scheduleReconnect();
    };

    this.ws = ws;
  }

  private scheduleReconnect(): void {
    if (!this.shouldConnect) return;

    const delay = Math.min(
      RECONNECT_BASE_MS * Math.pow(1.5, this.reconnectAttempt),
      RECONNECT_MAX_MS
    );
    this.reconnectAttempt++;

    console.log(`[WS Manager] Reconnecting in ${Math.round(delay)}ms (attempt ${this.reconnectAttempt})`);
    this.reconnectTimeout = setTimeout(() => {
      this.reconnectTimeout = null;
      this.createConnection();
    }, delay);
  }
}

export default CameraWebSocketManager;
