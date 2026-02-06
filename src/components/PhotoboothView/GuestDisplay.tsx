import { useState, useEffect } from "react";
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { emit } from '@tauri-apps/api/event';
import DisplayContent from "./DisplayContent";

export type { UnlistenFn };

type DisplayMode = 'single' | 'center' | 'canvas';

interface CurrentSetPhoto {
  id: string;
  thumbnailUrl: string;
  timestamp: string;
}

interface PhotoState {
  currentSetPhotos: CurrentSetPhoto[];
  selectedPhotoIndex: number | null;
  displayMode: DisplayMode;
}

interface GuestDisplayProps {
  isSecondScreen?: boolean;
}

export default function GuestDisplay({ isSecondScreen = false }: GuestDisplayProps) {
  const [photoState, setPhotoState] = useState<PhotoState>({
    currentSetPhotos: [],
    selectedPhotoIndex: null,
    displayMode: 'center'
  });

  // Listen for state updates from main window
  useEffect(() => {
    let unlisteners: UnlistenFn[] = [];

    // Setup all listeners
    const setupListeners = async () => {
      const [unlisten1, unlisten2, unlisten3, unlisten4] = await Promise.all([
        listen('guest-display:update', (event: { payload: Partial<PhotoState> }) => {
          setPhotoState(prev => ({ ...prev, ...event.payload }));
        }),
        listen('guest-display:mode', (event: { payload: DisplayMode }) => {
          setPhotoState(prev => ({ ...prev, displayMode: event.payload }));
        }),
        listen('guest-display:select-photo', (event: { payload: number | null }) => {
          setPhotoState(prev => ({ ...prev, selectedPhotoIndex: event.payload }));
        }),
        listen('guest-display:add-photo', (event: { payload: CurrentSetPhoto }) => {
          setPhotoState(prev => ({ ...prev, currentSetPhotos: [...prev.currentSetPhotos, event.payload] }));
        }),
      ]);
      unlisteners = [unlisten1, unlisten2, unlisten3, unlisten4];
    };

    setupListeners();

    return () => {
      unlisteners.forEach(u => u());
    };
  }, []);

  const { currentSetPhotos, selectedPhotoIndex, displayMode } = photoState;

  // Handle keyboard navigation for fullscreen mode
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // ESC to exit fullscreen - notify main window
      if (e.key === 'Escape' && selectedPhotoIndex !== null && displayMode === 'canvas') {
        emit('guest-display:escape');
      }

      // Arrow key navigation in fullscreen mode
      if (selectedPhotoIndex !== null && displayMode === 'canvas') {
        const photoCount = currentSetPhotos.length || 6;
        let newIndex = selectedPhotoIndex;

        if (e.key === 'ArrowLeft') {
          e.preventDefault();
          newIndex = Math.max(0, selectedPhotoIndex - 1);
        } else if (e.key === 'ArrowRight') {
          e.preventDefault();
          newIndex = Math.min(photoCount - 1, selectedPhotoIndex + 1);
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          newIndex = Math.max(0, selectedPhotoIndex - 3);
        } else if (e.key === 'ArrowDown') {
          e.preventDefault();
          newIndex = Math.min(photoCount - 1, selectedPhotoIndex + 3);
        }

        if (newIndex !== selectedPhotoIndex) {
          emit('guest-display:select-photo', newIndex);
          setPhotoState(prev => ({ ...prev, selectedPhotoIndex: newIndex }));
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedPhotoIndex, displayMode, currentSetPhotos.length]);

  // Handle double-click on photo to enter fullscreen
  const handlePhotoDoubleClick = (index: number) => {
    setPhotoState(prev => ({ ...prev, selectedPhotoIndex: index }));
    emit('guest-display:select-photo', index);
  };

  // Handle double-click to exit fullscreen
  const handleExitFullscreen = () => {
    setPhotoState(prev => ({ ...prev, selectedPhotoIndex: null }));
    emit('guest-display:escape');
  };

  // Handle arrow navigation clicks
  const handleNavClick = (direction: 'prev' | 'next') => {
    if (selectedPhotoIndex === null) return;

    const totalPhotos = currentSetPhotos.length || 6;
    const newIndex = direction === 'prev'
      ? Math.max(0, selectedPhotoIndex - 1)
      : Math.min(totalPhotos - 1, selectedPhotoIndex + 1);

    setPhotoState(prev => ({ ...prev, selectedPhotoIndex: newIndex }));
    emit('guest-display:select-photo', newIndex);
  };

  return (
    <div className="guest-display">
      {/* Drag handle for moving the window */}
      <div data-tauri-drag-region className="guest-display-drag-handle" />
      <div className="preview-frame">
        <div className="preview-content">
          <DisplayContent
            displayMode={displayMode}
            currentSetPhotos={currentSetPhotos}
            selectedPhotoIndex={selectedPhotoIndex}
            onPhotoDoubleClick={handlePhotoDoubleClick}
            onExitFullscreen={handleExitFullscreen}
            onNavClick={handleNavClick}
          />
        </div>
      </div>
    </div>
  );
}
