import { motion, AnimatePresence } from "framer-motion";
import { useQR } from "../../contexts/QRContext";
import { invoke } from "@tauri-apps/api/core";
import { useState, useEffect } from "react";

interface HistoryItem {
  timestamp: string;
  folder_name: string;
  link: string;
  qr_data: string;
}

interface HistoryModalProps {
  show: boolean;
  onClose: () => void;
  formatDate: (timestamp: string) => string;
}

export default function HistoryModal({ show, onClose, formatDate }: HistoryModalProps) {
  const { history: historyItems, setHistory: setHistoryItems } = useQR();
  const [expandedHistoryItem, setExpandedHistoryItem] = useState<string | null>(null);

  // Load history when modal opens
  useEffect(() => {
    if (show) {
      const loadHistory = async () => {
        try {
          const items = await invoke<HistoryItem[]>("get_history");
          setHistoryItems(items);
        } catch (e) {
          console.error("Failed to load history:", e);
        }
      };
      loadHistory();
    }
  }, [show, setHistoryItems]);

  if (!show) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="modal-overlay"
        onClick={onClose}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          className="modal-content"
          style={{ maxWidth: '600px', maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}
          onClick={(e) => e.stopPropagation()}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
            <h2 style={{ margin: 0 }}>Upload History</h2>
            {historyItems.length > 0 && (
               <button
                 onClick={async () => {
                    try {
                      await invoke("clear_history");
                      setHistoryItems([]);
                    } catch (e) {
                      console.error("Failed to clear history", e);
                    }
                 }}
                 style={{
                   background: 'none',
                   border: 'none',
                   color: 'var(--text-secondary)',
                   fontSize: '12px',
                   cursor: 'pointer',
                   textDecoration: 'underline'
                 }}
               >
                 Clear History
               </button>
            )}
          </div>

          <div style={{ overflowY: 'auto', flex: 1, paddingRight: '4px' }}>
            {historyItems.length === 0 ? (
              <p style={{ color: 'var(--text-secondary)', textAlign: 'center', padding: '2rem' }}>
                No upload history yet. Your previous uploads will appear here.
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {historyItems.map((item, index) => (
                  <div
                    key={index}
                    style={{
                      background: 'var(--bg-primary)',
                      borderRadius: '8px',
                      border: '1px solid var(--border-color)',
                      overflow: 'hidden'
                    }}
                  >
                    <div
                      onClick={() => setExpandedHistoryItem(expandedHistoryItem === item.timestamp ? null : item.timestamp)}
                      style={{
                        padding: '12px 16px',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        background: expandedHistoryItem === item.timestamp ? 'var(--bg-tertiary)' : 'transparent',
                        transition: 'background 0.2s'
                      }}
                    >
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <div style={{ fontSize: '14px', fontWeight: '600', color: 'var(--text-primary)' }}>
                          {item.folder_name}
                        </div>
                        <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                          {formatDate(item.timestamp)}
                        </div>
                      </div>
                      <div style={{
                        transform: expandedHistoryItem === item.timestamp ? 'rotate(180deg)' : 'rotate(0deg)',
                        transition: 'transform 0.2s',
                        color: 'var(--text-secondary)'
                      }}>
                        ▼
                      </div>
                    </div>

                    <AnimatePresence>
                      {expandedHistoryItem === item.timestamp && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.2 }}
                          style={{ borderTop: '1px solid var(--border-color)' }}
                        >
                          <div style={{ padding: '16px', display: 'flex', gap: '20px', alignItems: 'start' }}>
                            <div style={{
                              background: 'white',
                              padding: '8px',
                              borderRadius: '8px',
                              width: '100px',
                              height: '100px',
                              flexShrink: 0
                            }}>
                              <img
                                src={`data:image/png;base64,${item.qr_data}`}
                                alt="QR Code"
                                style={{ width: '100%', height: '100%' }}
                              />
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ marginBottom: '12px' }}>
                                <label style={{ fontSize: '11px', color: 'var(--text-secondary)', textTransform: 'uppercase', fontWeight: '600', display: 'block', marginBottom: '4px' }}>
                                  Link
                                </label>
                                <div style={{ display: 'flex', gap: '8px' }}>
                                  <input
                                    type="text"
                                    value={item.link}
                                    readOnly
                                    style={{
                                      flex: 1,
                                      fontSize: '12px',
                                      padding: '6px 8px',
                                      background: 'var(--bg-secondary)',
                                      border: '1px solid var(--border-color)',
                                      borderRadius: '4px',
                                      color: 'var(--text-primary)',
                                      fontFamily: 'monospace'
                                    }}
                                  />
                                  <button
                                    onClick={() => navigator.clipboard.writeText(item.link)}
                                    className="btn-secondary"
                                    style={{ padding: '4px 12px', fontSize: '12px' }}
                                  >
                                    Copy
                                  </button>
                                </div>
                              </div>
                              <a
                                href={item.link}
                                target="_blank"
                                rel="noopener noreferrer"
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '6px',
                                  color: 'var(--accent-blue)',
                                  fontSize: '13px',
                                  textDecoration: 'none',
                                  fontWeight: '500'
                                }}
                              >
                                Open in Browser ↗
                              </a>
                            </div>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                ))}
              </div>
            )}
          </div>

          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={onClose}
            className="btn-primary"
            style={{ width: '100%', marginTop: '1.5rem' }}
          >
            Close
          </motion.button>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
