import { ChevronDown, ChevronRight, Film } from 'lucide-react';
import { useAuth } from '../../../../contexts';

interface GifSettingsSectionProps {
  expanded: boolean;
  onToggle: () => void;
  autoGifEnabled: boolean;
  setAutoGifEnabled: (value: boolean) => void;
  autoGifFormat: 'gif' | 'both' | 'video';
  setAutoGifFormat: (value: 'gif' | 'both' | 'video') => void;
  autoGifPhotoSource: 'collage' | 'all';
  setAutoGifPhotoSource: (value: 'collage' | 'all') => void;
}

export function GifSettingsSection({
  expanded,
  onToggle,
  autoGifEnabled,
  setAutoGifEnabled,
  autoGifFormat,
  setAutoGifFormat,
  autoGifPhotoSource,
  setAutoGifPhotoSource,
}: GifSettingsSectionProps) {
  const { account } = useAuth();
  const isAuthenticated = !!account;

  return (
    <div className="collapsible-section gif-settings-section">
      <button
        className="collapsible-header"
        onClick={onToggle}
      >
        <div className="collapsible-header-left">
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          <span className="collapsible-title">GIF Generation</span>
        </div>
        {autoGifEnabled ? (
          <span className="collapsible-badge">
            On &middot; {autoGifFormat === 'both' ? 'GIF + MP4' : autoGifFormat === 'gif' ? 'GIF' : 'MP4'}
          </span>
        ) : (
          <span className="collapsible-badge badge-empty">Off</span>
        )}
      </button>
      {expanded && (
        <div className="collapsible-content">
          {/* Sign-in warning at the top */}
          {!isAuthenticated && (
            <div className="setting-notice notice-warning" style={{ marginBottom: '12px' }}>
              Sign in to Google Drive to enable auto generation
            </div>
          )}

          {/* Enable Toggle */}
          <div className="qr-upload-toggle-row">
            <div>
              <div className="setting-label-full">Auto Generate</div>
              <div className="setting-hint">
                Automatically create GIF/video when clicking Next
              </div>
            </div>
            <button
              className={`toggle-btn ${autoGifEnabled ? 'active' : ''}`}
              onClick={() => setAutoGifEnabled(!autoGifEnabled)}
            >
              <span className="toggle-slider" />
            </button>
          </div>

          {/* Status Notice (only when authenticated) */}
          {isAuthenticated && (
            <div className={`setting-notice ${autoGifEnabled ? 'notice-success' : 'notice-warning'}`}>
              {autoGifEnabled
                ? 'Ready to generate after finalizing'
                : 'Enable to auto-generate after finalizing'}
            </div>
          )}

          <div className="sidebar-divider" style={{ marginBottom: '16px' }} />

          <div className={`gif-settings-body ${!autoGifEnabled ? 'disabled' : ''}`}>
            <div className="setting-label-full" style={{ marginBottom: '8px' }}>
              Output Format
            </div>
            <div className="setting-hint" style={{ marginBottom: '12px' }}>
              Choose which format(s) to generate automatically.
            </div>

            {/* Format Selection */}
            <div className="gif-segmented-control">
              <div className="gif-segmented-option">
                <button
                  className={autoGifFormat === 'both' ? 'active' : ''}
                  onClick={() => setAutoGifFormat('both')}
                >
                  GIF + MP4
                </button>
              </div>
              <div className="gif-segmented-option">
                <button
                  className={autoGifFormat === 'gif' ? 'active' : ''}
                  onClick={() => setAutoGifFormat('gif')}
                >
                  GIF
                </button>
              </div>
              <div className="gif-segmented-option">
                <button
                  className={autoGifFormat === 'video' ? 'active' : ''}
                  onClick={() => setAutoGifFormat('video')}
                >
                  MP4
                </button>
              </div>
            </div>

            <div className="setting-label-full" style={{ marginBottom: '8px' }}>
              Photo Source
            </div>
            <div className="setting-hint" style={{ marginBottom: '12px' }}>
              Which photos to include in the slideshow.
            </div>

            {/* Photo Source Selection */}
            <div className="gif-segmented-control">
              <div className="gif-segmented-option">
                <button
                  className={autoGifPhotoSource === 'collage' ? 'active' : ''}
                  onClick={() => setAutoGifPhotoSource('collage')}
                >
                  Collage Only
                </button>
              </div>
              <div className="gif-segmented-option">
                <button
                  className={autoGifPhotoSource === 'all' ? 'active' : ''}
                  onClick={() => setAutoGifPhotoSource('all')}
                >
                  All Session Photos
                </button>
              </div>
            </div>

            {/* Info Notice */}
            <div className="setting-notice notice-info">
              GIF/Video will be generated after clicking Next and will be uploaded to Google Drive
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
