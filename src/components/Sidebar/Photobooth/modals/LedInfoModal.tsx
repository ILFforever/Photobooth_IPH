import { motion, AnimatePresence } from "framer-motion";
import { HelpCircle, Wifi, WifiOff, Download, Camera, Radio, X } from "lucide-react";

interface LedInfoModalProps {
  show: boolean;
  onClose: () => void;
}

function LedDot({ color, animation }: { color: string; animation: 'solid' | 'pulse' | 'fast-pulse' }) {
  const baseStyle: React.CSSProperties = {
    width: '12px',
    height: '12px',
    borderRadius: '50%',
    background: color,
    flexShrink: 0,
    boxShadow: `0 0 8px ${color}80, 0 0 16px ${color}40`,
  };

  if (animation === 'solid') {
    return <div style={baseStyle} />;
  }

  return (
    <motion.div
      style={baseStyle}
      animate={{
        opacity: [1, 0.3, 1],
        boxShadow: [
          `0 0 8px ${color}80, 0 0 16px ${color}40`,
          `0 0 2px ${color}30, 0 0 4px ${color}10`,
          `0 0 8px ${color}80, 0 0 16px ${color}40`,
        ],
      }}
      transition={{
        duration: animation === 'fast-pulse' ? 0.8 : 2,
        repeat: Infinity,
        ease: 'easeInOut',
      }}
    />
  );
}

export function LedInfoModal({ show, onClose }: LedInfoModalProps) {
  if (!show) return null;

  const ledStates = [
    {
      name: 'Offline',
      color: '#ef4444',
      icon: <WifiOff size={14} />,
      animation: 'solid' as const,
      pattern: 'Solid Red',
      description: 'VM is not running or unreachable. Click the LED to view logs.',
    },
    {
      name: 'Idle',
      color: '#22c55e',
      icon: <Wifi size={14} />,
      animation: 'solid' as const,
      pattern: 'Solid Green',
      description: 'VM is online, no camera connected.',
    },
    {
      name: 'Connecting',
      color: '#eab308',
      icon: <Radio size={14} />,
      animation: 'solid' as const,
      pattern: 'Solid Yellow',
      description: 'Establishing camera connection. Takes a few seconds.',
    },
    {
      name: 'Ready',
      color: '#22c55e',
      icon: <Camera size={14} />,
      animation: 'pulse' as const,
      pattern: 'Pulsing Green',
      description: 'Camera connected and ready to shoot.',
    },
    {
      name: 'Downloading',
      color: '#3b82f6',
      icon: <Download size={14} />,
      animation: 'fast-pulse' as const,
      pattern: 'Fast Pulsing Blue',
      description: 'Transferring photo from camera. Wait before shooting again.',
    },
  ];

  return (
    <AnimatePresence>
      <motion.div
        className="modal-backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      >
        <motion.div
          className="modal"
          initial={{ opacity: 0, scale: 0.95, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 10 }}
          transition={{ type: 'spring', duration: 0.4, bounce: 0.15 }}
          onClick={(e) => e.stopPropagation()}
          style={{ maxWidth: '380px', padding: 0, overflow: 'hidden' }}
        >
          {/* Header */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '16px 20px',
            borderBottom: '1px solid var(--border-color)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <HelpCircle size={16} style={{ color: 'var(--text-muted)' }} />
              <span style={{ fontWeight: 600, fontSize: '14px', color: 'var(--text-primary)' }}>
                LED Status Guide
              </span>
            </div>
            <button
              onClick={onClose}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--text-muted)',
                cursor: 'pointer',
                padding: '4px',
                borderRadius: '4px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'color 0.15s',
              }}
              onMouseEnter={(e) => e.currentTarget.style.color = 'var(--text-primary)'}
              onMouseLeave={(e) => e.currentTarget.style.color = 'var(--text-muted)'}
            >
              <X size={16} />
            </button>
          </div>

          {/* Body */}
          <div style={{ padding: '12px 16px' }}>
            {ledStates.map((state, i) => (
              <motion.div
                key={state.name}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.05, duration: 0.25 }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  padding: '10px 8px',
                  borderRadius: '6px',
                  transition: 'background 0.15s',
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-hover, rgba(255,255,255,0.03))'}
                onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
              >
                {/* Animated LED */}
                <div style={{
                  width: '28px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}>
                  <LedDot color={state.color} animation={state.animation} />
                </div>

                {/* Info */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                  }}>
                    <span style={{
                      color: 'var(--text-muted)',
                      display: 'flex',
                      alignItems: 'center',
                    }}>
                      {state.icon}
                    </span>
                    <span style={{
                      fontWeight: 600,
                      fontSize: '12px',
                      color: 'var(--text-primary)',
                    }}>
                      {state.name}
                    </span>
                    <span style={{
                      fontSize: '10px',
                      color: 'var(--text-muted)',
                      opacity: 0.7,
                      marginLeft: '2px',
                    }}>
                      {state.pattern}
                    </span>
                  </div>
                  <p style={{
                    margin: '2px 0 0 0',
                    fontSize: '11px',
                    lineHeight: 1.4,
                    color: 'var(--text-secondary)',
                    opacity: 0.8,
                  }}>
                    {state.description}
                  </p>
                </div>
              </motion.div>
            ))}
          </div>

          {/* Footer hint */}
          <div style={{
            padding: '10px 20px',
            borderTop: '1px solid var(--border-color)',
            fontSize: '11px',
            color: 'var(--text-muted)',
            textAlign: 'center',
            opacity: 0.7,
          }}>
            Click the LED in the sidebar to open VM logs
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
