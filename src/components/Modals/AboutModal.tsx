import { motion, AnimatePresence } from "framer-motion";
import { useState } from "react";

interface AboutModalProps {
  show: boolean;
  onClose: () => void;
}

export default function AboutModal({ show, onClose }: AboutModalProps) {
  const [aboutTab, setAboutTab] = useState<'features' | 'modes' | 'contact'>('features');

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
          style={{ maxWidth: '500px' }}
          onClick={(e) => e.stopPropagation()}
        >
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '64px', marginBottom: '1rem' }}>📸</div>
            <h2 style={{ marginBottom: '0.5rem' }}>PhotoBooth QR Generator</h2>
            <p style={{ color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>Version 3.11</p>
            <p style={{ color: 'var(--text-secondary)', marginBottom: '1.25rem' }}>Developed by ILFforever for Intania Production House</p>
          </div>

          <div style={{ marginBottom: '1.5rem', lineHeight: '1.6', color: 'var(--text-secondary)' }}>
            <p style={{ marginBottom: '0.5rem', fontSize: '13px' }}>
              Upload your photobooth images to Google Drive and generate shareable QR codes and links instantly.
            </p>

            <div style={{ background: 'var(--bg-primary)', padding: '0.75rem', borderRadius: '8px', marginTop: '0.5rem'}}>
              <div style={{ display: 'flex', gap: '1.5rem', borderBottom: '1px solid var(--border-color)', marginBottom: '0.75rem', position: 'relative', paddingBottom: '0.5rem' }}>
                <button
                  onClick={() => setAboutTab('features')}
                  style={{
                    background: 'none',
                    border: 'none',
                    padding: '0 0 0.5rem 0',
                    fontSize: '13px',
                    fontWeight: '600',
                    color: aboutTab === 'features' ? 'var(--accent-blue)' : 'var(--text-secondary)',
                    cursor: 'pointer',
                    position: 'relative',
                    transition: 'color 0.2s ease'
                  }}
                >
                  Features
                  {aboutTab === 'features' && (
                    <motion.div
                      layoutId="aboutUnderline"
                      style={{
                        position: 'absolute',
                        bottom: '-1px',
                        left: 0,
                        right: 0,
                        height: '2px',
                        background: 'var(--accent-blue)',
                        zIndex: 1
                      }}
                    />
                  )}
                </button>
                <button
                  onClick={() => setAboutTab('modes')}
                  style={{
                    background: 'none',
                    border: 'none',
                    padding: '0 0 0.5rem 0',
                    fontSize: '13px',
                    fontWeight: '600',
                    color: aboutTab === 'modes' ? 'var(--accent-blue)' : 'var(--text-secondary)',
                    cursor: 'pointer',
                    position: 'relative',
                    transition: 'color 0.2s ease'
                  }}
                >
                  Modes
                  {aboutTab === 'modes' && (
                    <motion.div
                      layoutId="aboutUnderline"
                      style={{
                        position: 'absolute',
                        bottom: '-1px',
                        left: 0,
                        right: 0,
                        height: '2px',
                        background: 'var(--accent-blue)',
                        zIndex: 1
                      }}
                    />
                  )}
                </button>
                <button
                  onClick={() => setAboutTab('contact')}
                  style={{
                    background: 'none',
                    border: 'none',
                    padding: '0 0 0.5rem 0',
                    fontSize: '13px',
                    fontWeight: '600',
                    color: aboutTab === 'contact' ? 'var(--accent-blue)' : 'var(--text-secondary)',
                    cursor: 'pointer',
                    position: 'relative',
                    transition: 'color 0.2s ease'
                  }}
                >
                  Contact
                  {aboutTab === 'contact' && (
                    <motion.div
                      layoutId="aboutUnderline"
                      style={{
                        position: 'absolute',
                        bottom: '-1px',
                        left: 0,
                        right: 0,
                        height: '2px',
                        background: 'var(--accent-blue)',
                        zIndex: 1
                      }}
                    />
                  )}
                </button>
              </div>

              {aboutTab === 'features' ? (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.2 }}
                >
                  <ul style={{ fontSize: '13px', paddingLeft: '1.5rem', margin: 0 }}>
                    <li style={{ marginBottom: '0.5rem' }}>Drag & drop or browse to add photos (JPG, PNG, RAW)</li>
                    <li style={{ marginBottom: '0.5rem' }}>Upload directly to Google Drive with organized folders</li>
                    <li style={{ marginBottom: '0.5rem' }}>Generate shareable QR codes automatically</li>
                    <li style={{ marginBottom: '0.5rem' }}>Support for RAW image formats (CR2, NEF, ARW, etc.)</li>
                    <li>View upload history and manage previous sessions</li>
                  </ul>
                </motion.div>
              ) : aboutTab === 'modes' ? (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.2 }}
                >
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.5rem', background: 'var(--bg-secondary)', borderRadius: '6px' }}>
                      <span style={{ fontSize: '20px' }}>🎞️</span>
                      <div>
                        <div style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text-primary)' }}>Photobooth</div>
                        <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>Watch folder and auto-place photos into strips</div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.5rem', background: 'var(--bg-secondary)', borderRadius: '6px' }}>
                      <span style={{ fontSize: '20px' }}>🎨</span>
                      <div>
                        <div style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text-primary)' }}>Collage Creator</div>
                        <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>Manual drag & drop with custom frames</div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.5rem', background: 'var(--bg-secondary)', borderRadius: '6px' }}>
                      <span style={{ fontSize: '20px' }}>📱</span>
                      <div>
                        <div style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text-primary)' }}>QR Generator</div>
                        <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>Upload photos and generate shareable QR codes</div>
                      </div>
                    </div>
                  </div>
                </motion.div>
              ) : (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.2 }}
                >
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                    <a
                      href="https://github.com/ILFforever"
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.75rem',
                        color: 'var(--text-primary)',
                        textDecoration: 'none',
                        padding: '0.5rem',
                        borderRadius: '6px',
                        background: 'var(--bg-secondary)',
                        transition: 'background 0.2s ease'
                      }}
                    >
                      <span style={{ fontSize: '18px' }}>🐙</span>
                      <div>
                        <div style={{ fontSize: '13px', fontWeight: '600' }}>GitHub</div>
                        <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>@ILFforever</div>
                      </div>
                    </a>
                    <a
                      href="mailto:intania.productions@gmail.com"
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.75rem',
                        color: 'var(--text-primary)',
                        textDecoration: 'none',
                        padding: '0.5rem',
                        borderRadius: '6px',
                        background: 'var(--bg-secondary)',
                        transition: 'background 0.2s ease'
                      }}
                    >
                      <span style={{ fontSize: '18px' }}>📧</span>
                      <div>
                        <div style={{ fontSize: '13px', fontWeight: '600' }}>Email</div>
                        <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>intania.productions@gmail.com</div>
                      </div>
                    </a>
                  </div>
                </motion.div>
              )}
            </div>
          </div>

          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={onClose}
            className="btn-primary"
            style={{ width: '100%' }}
          >
            Close
          </motion.button>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
