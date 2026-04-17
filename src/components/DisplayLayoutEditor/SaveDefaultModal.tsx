import { motion, AnimatePresence } from "framer-motion";
import Icon from '@mdi/react';
import { mdiShieldCheck, mdiContentCopy, mdiArrowRight } from '@mdi/js';

interface SaveDefaultModalProps {
  show: boolean;
  layoutName: string;
  onCreateCopy: () => void;
  onCancel: () => void;
  isLoading?: boolean;
}

export default function SaveDefaultModal({
  show,
  layoutName,
  onCreateCopy,
  onCancel,
  isLoading = false,
}: SaveDefaultModalProps) {
  if (!show) return null;

  return (
    <AnimatePresence>
      <motion.div
        className="modal-backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onCancel}
        style={{ backdropFilter: 'blur(4px)' }}
      >
        <motion.div
          className="modal"
          initial={{ opacity: 0, scale: 0.96, y: 8 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: 8 }}
          transition={{ duration: 0.2, ease: [0.25, 0.1, 0.25, 1] }}
          onClick={(e) => e.stopPropagation()}
          style={{
            maxWidth: 520,
            borderRadius: 8,
            overflow: 'hidden',
          }}
        >
          {/* Protected Header */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--spacing-lg)',
            padding: 'var(--spacing-xl)',
            borderBottom: '1px solid var(--border-color)',
            background: 'linear-gradient(180deg, var(--bg-secondary) 0%, var(--bg-primary) 100%)',
          }}>
            <div style={{
              width: 40,
              height: 40,
              borderRadius: 10,
              background: 'var(--accent-blue-light)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}>
              <Icon
                path={mdiShieldCheck}
                size={1}
                style={{ color: 'var(--accent-blue)' }}
              />
            </div>
            <div style={{ flex: 1 }}>
              <h2 style={{
                margin: 0,
                fontSize: 16,
                fontWeight: 600,
                color: 'var(--text-primary)',
                letterSpacing: '-0.01em',
              }}>
                Protected Layout
              </h2>
              <p style={{
                margin: 'var(--spacing-xs) 0 0 0',
                fontSize: 14,
                color: 'var(--text-secondary)',
                fontWeight: 500,
              }}>
                {layoutName} cannot be overwritten
              </p>
            </div>
          </div>

          {/* Body */}
          <div style={{
            padding: 'var(--spacing-xl)',
            background: 'var(--bg-primary)',
          }}>
            {/* Main Message */}
            <p style={{
              margin: '0 0 var(--spacing-lg) 0',
              fontSize: 14,
              lineHeight: 1.6,
              color: 'var(--text-primary)',
            }}>
              The default layout is protected to preserve the original design. Your changes will be lost if you continue without creating a copy.
            </p>

            {/* Solution Card */}
            <div style={{
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border-color-light)',
              borderRadius: 8,
              overflow: 'hidden',
            }}>
              {/* Card Header */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--spacing-md)',
                padding: 'var(--spacing-md) var(--spacing-lg)',
                background: 'linear-gradient(90deg, var(--accent-blue-light) 0%, transparent 100%)',
                borderBottom: '1px solid var(--border-color)',
              }}>
                <Icon
                  path={mdiContentCopy}
                  size={0.7}
                  style={{ color: 'var(--accent-blue)' }}
                />
                <span style={{
                  fontWeight: 600,
                  fontSize: 13,
                  color: 'var(--text-primary)',
                  letterSpacing: '-0.01em',
                }}>
                  Recommended: Create a Copy
                </span>
              </div>

              {/* Card Content */}
              <div style={{
                padding: 'var(--spacing-lg)',
              }}>
                <p style={{
                  margin: '0 0 var(--spacing-md) 0',
                  fontSize: 13,
                  color: 'var(--text-secondary)',
                  lineHeight: 1.5,
                }}>
                  Your changes will be preserved in a new layout:
                </p>
                <ul style={{
                  margin: 0,
                  padding: 0,
                  listStyle: 'none',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 'var(--spacing-sm)',
                }}>
                  {[
                    'All your modifications and edits',
                    'Original default layout remains untouched',
                    'Full editing and saving capabilities',
                  ].map((item, index) => (
                    <li
                      key={index}
                      style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: 'var(--spacing-sm)',
                        fontSize: 13,
                        color: 'var(--text-muted)',
                        lineHeight: 1.4,
                      }}
                    >
                      <span style={{
                        color: 'var(--accent-blue)',
                        fontWeight: 600,
                        flexShrink: 0,
                      }}>✓</span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div style={{
            display: 'flex',
            gap: 'var(--spacing-md)',
            padding: 'var(--spacing-lg) var(--spacing-xl)',
            borderTop: '1px solid var(--border-color)',
            background: 'var(--bg-secondary)',
          }}>
            <button
              onClick={onCancel}
              disabled={isLoading}
              style={{
                flex: 1,
                padding: '10px 16px',
                fontSize: 13,
                fontWeight: 500,
                color: 'var(--text-secondary)',
                background: 'transparent',
                border: '1px solid var(--border-color)',
                borderRadius: 6,
                cursor: isLoading ? 'not-allowed' : 'pointer',
                opacity: isLoading ? 0.5 : 1,
                transition: 'all 0.15s ease',
              }}
              onMouseEnter={(e) => {
                if (!isLoading) {
                  e.currentTarget.style.background = 'var(--bg-tertiary)';
                  e.currentTarget.style.borderColor = 'var(--border-color-light)';
                }
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent';
                e.currentTarget.style.borderColor = 'var(--border-color)';
              }}
            >
              Cancel
            </button>
            <button
              onClick={onCreateCopy}
              disabled={isLoading}
              style={{
                flex: 1,
                padding: '10px 16px',
                fontSize: 13,
                fontWeight: 600,
                color: '#ffffff',
                background: isLoading ? 'var(--accent-blue)' : 'var(--accent-blue)',
                border: 'none',
                borderRadius: 6,
                cursor: isLoading ? 'not-allowed' : 'pointer',
                opacity: isLoading ? 0.7 : 1,
                transition: 'all 0.15s ease',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 'var(--spacing-sm)',
              }}
              onMouseEnter={(e) => {
                if (!isLoading) {
                  e.currentTarget.style.background = 'var(--accent-blue-hover)';
                }
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'var(--accent-blue)';
              }}
            >
              {isLoading ? (
                'Creating Copy...'
              ) : (
                <>
                  Create Copy
                  <Icon path={mdiArrowRight} size={0.6} />
                </>
              )}
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
