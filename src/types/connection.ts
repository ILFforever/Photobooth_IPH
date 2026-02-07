/**
 * Connection state types for the Control Center
 */
export type ConnectionState =
  | 'NC'           // Not connected - initial state or after user disconnect/timeout
  | 'Connecting'   // User clicked connect, waiting for initial connection
  | 'Connected'    // Successfully connected to VM and camera is responding
  | 'Reconnecting'; // Lost connection (WS or camera), attempting to reconnect

/**
 * Helper function to get display text for connection state
 */
export function getConnectionStateText(state: ConnectionState): string {
  switch (state) {
    case 'NC':
      return 'Not connected';
    case 'Connecting':
      return 'Connecting...';
    case 'Connected':
      return 'Connected';
    case 'Reconnecting':
      return 'Reconnecting...';
    default:
      return 'Unknown';
  }
}
