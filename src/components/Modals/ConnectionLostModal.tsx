import { useState } from 'react';
import { Unplug, Cable, Power, Usb, RefreshCw, Server } from 'lucide-react';
import './ConnectionLostModal.css';

interface ConnectionLostModalProps {
  show: boolean;
  onReconnect: () => void;
  onDisconnect: () => void;
}

export default function ConnectionLostModal({ show, onReconnect, onDisconnect }: ConnectionLostModalProps) {
  const [isReconnecting, setIsReconnecting] = useState(false);

  if (!show) return null;

  const handleReconnect = () => {
    setIsReconnecting(true);
    onReconnect();
    // Reset after a short delay so the button becomes clickable again
    // (the modal will close once connectionState changes away from 'Reconnecting')
    setTimeout(() => setIsReconnecting(false), 3000);
  };

  return (
    <div className="conn-lost-overlay">
      <div className="conn-lost-modal">
        <div className="conn-lost-header">
          <div className="conn-lost-icon">
            <Unplug size={22} />
          </div>
          <div>
            <div className="conn-lost-title">Connection Lost</div>
            <div className="conn-lost-subtitle">The camera daemon connection was interrupted</div>
          </div>
        </div>

        <div className="conn-lost-checklist">
          <div className="conn-lost-check-item">
            <Cable size={15} className="conn-lost-check-icon" />
            <span>Check the USB cable is securely connected</span>
          </div>
          <div className="conn-lost-check-item">
            <Power size={15} className="conn-lost-check-icon" />
            <span>Make sure the camera is powered on</span>
          </div>
          <div className="conn-lost-check-item">
            <Usb size={15} className="conn-lost-check-icon" />
            <span>Verify the camera is in PTP/MTP USB mode</span>
          </div>
          <div className="conn-lost-check-item">
            <Server size={15} className="conn-lost-check-icon" />
            <span>Check that the camera daemon is running</span>
          </div>
        </div>

        <div className="conn-lost-footer">
          <button className="conn-lost-btn conn-lost-btn-disconnect" onClick={onDisconnect}>
            <Unplug size={15} />
            Disconnect
          </button>
          <button
            className="conn-lost-btn conn-lost-btn-reconnect"
            onClick={handleReconnect}
            disabled={isReconnecting}
          >
            <RefreshCw size={15} className={isReconnecting ? 'spinning' : ''} />
            {isReconnecting ? 'Connecting...' : 'Reconnect'}
          </button>
        </div>
      </div>
    </div>
  );
}
