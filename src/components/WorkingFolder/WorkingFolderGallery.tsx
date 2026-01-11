import { useState, useRef, useEffect } from 'react';
import { useDrag } from 'react-dnd';
import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useWorkingFolder } from '../../contexts/WorkingFolderContext';
import { WorkingImage } from '../../types/assets';
import './WorkingFolderGallery.css';

interface DraggableImageProps {
  img: WorkingImage;
  isSelected: boolean;
  onSelect: () => void;
}

function DraggableImage({ img, isSelected, onSelect }: DraggableImageProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [imageLoaded, setImageLoaded] = useState(false);

  const dragItem = { path: img.path, thumbnail: img.thumbnail || img.path, dimensions: img.dimensions };

  const [{ isDragging }, drag] = useDrag({
    type: 'IMAGE',
    item: dragItem,
    collect: (monitor) => ({
      isDragging: monitor.isDragging(),
    }),
  });

  // Debug drag start
  if (isDragging) {
    console.log('=== DRAG START ===');
    console.log('Image filename:', img.filename);
    console.log('Drag item:', dragItem);
    console.log('==================');
  }

  drag(ref);

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const formatDimensions = (width: number, height: number) => {
    if (width >= 1920 || height >= 1920) {
      return `${(width / 1000).toFixed(1)}K × ${(height / 1000).toFixed(1)}K`;
    }
    return `${width} × ${height}`;
  };

  return (
    <div
      ref={ref}
      className={`image-item ${isSelected ? 'selected' : ''} ${isDragging ? 'dragging' : ''} ${imageLoaded ? 'loaded' : 'loading'}`}
      onClick={onSelect}
      style={{ opacity: isDragging ? 0.5 : 1, cursor: 'grab' }}
    >
      {img.thumbnail ? (
        <img
          src={convertFileSrc(img.thumbnail.replace('asset://', ''))}
          alt={img.filename}
          className="thumbnail"
          loading="lazy"
          onLoad={() => setImageLoaded(true)}
        />
      ) : (
        <div className="no-thumbnail">
          <span className="file-ext">{img.extension.toUpperCase()}</span>
        </div>
      )}

      {/* Quick Info Bar */}
      <div className="image-info">
        <div className="filename" title={img.filename}>
          {img.filename}
        </div>
        <div className="meta-row">
          <span className="filesize">{formatFileSize(img.size)}</span>
          {img.dimensions && (
            <>
              <span className="separator">•</span>
              <span className="dimensions">{formatDimensions(img.dimensions.width, img.dimensions.height)}</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// Skeleton loader component
function SkeletonImageCard() {
  return (
    <div className="image-item skeleton-loading">
      <div className="skeleton-thumbnail" />
      <div className="image-info">
        <div className="skeleton-text skeleton-filename" />
        <div className="skeleton-text skeleton-meta" />
      </div>
    </div>
  );
}

export function WorkingFolderGallery() {
  const { folderPath, setFolderPath, setImages, loading, setLoading, selectedImage, setSelectedImage } = useWorkingFolder();
  const [searchTerm, setSearchTerm] = useState('');
  const [skeletonCount, setSkeletonCount] = useState(0);
  const [loadedImagesMap, setLoadedImagesMap] = useState<Map<number, WorkingImage>>(new Map());

  // Set up event listeners for progressive loading
  useEffect(() => {
    const unlistenPromises = [
      // Listen for total count to set skeleton count
      listen<number>('thumbnail-total-count', (event) => {
        console.log('Total thumbnail count:', event.payload);
        setSkeletonCount(event.payload);
        setLoadedImagesMap(new Map()); // Clear previous images
      }),

      // Listen for each loaded image - use current as the position index
      listen<{ current: number; total: number; image: WorkingImage }>('thumbnail-loaded', (event) => {
        console.log(`Thumbnail loaded: ${event.payload.current}/${event.payload.total} - ${event.payload.image.filename}`);
        setLoadedImagesMap(prev => {
          const newMap = new Map(prev);
          // Use current (1-based) as 0-based index
          newMap.set(event.payload.current - 1, event.payload.image);
          return newMap;
        });
      }),
    ];

    // Cleanup listeners on unmount
    return () => {
      unlistenPromises.forEach(promise => {
        promise.then(unlisten => unlisten());
      });
    };
  }, []);

  const handleSelectFolder = async () => {
    try {
      setLoading(true);
      setImages([]);
      setLoadedImagesMap(new Map());
      setSkeletonCount(0);

      // Don't await - let it run in background while events update the UI
      invoke<{ path: string; images: WorkingImage[] }>('select_working_folder')
        .then(result => {
          setFolderPath(result.path);
          // Set final images from backend (in case any were missed)
          setImages(result.images);
          // Convert array to map with indices
          const finalMap = new Map<number, WorkingImage>();
          result.images.forEach((img, index) => finalMap.set(index, img));
          setLoadedImagesMap(finalMap);
        })
        .catch(error => {
          console.error('Failed to select working folder:', error);
          alert(`Failed to select folder: ${error}`);
        })
        .finally(() => {
          setLoading(false);
        });
    } catch (error) {
      console.error('Failed to select working folder:', error);
      alert(`Failed to select folder: ${error}`);
      setLoading(false);
    }
  };

  // Convert map to sorted array for filtering
  const loadedImages = Array.from(loadedImagesMap.entries())
    .sort(([a], [b]) => a - b)
    .map(([, img]) => img);

  const filteredImages = loadedImages.filter(img =>
    img.filename.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Create a stable array of items (images + skeletons) with fixed positions
  const displayItems = loading && skeletonCount > 0
    ? Array.from({ length: skeletonCount }, (_, index) => {
        const img = loadedImagesMap.get(index);
        return img ? { type: 'image', data: img, originalIndex: index } : { type: 'skeleton', index };
      })
    : filteredImages.map(img => ({ type: 'image', data: img }));

  // During loading, sort by original index (file order) - loaded images will naturally appear in correct order
  // Unloaded skeletons remain in their original positions
  const sortedDisplayItems = displayItems; // No extra sorting needed - displayItems is already in correct order

  return (
    <div className="working-folder-gallery">
      <div className="working-folder-header">
        <h3>Working Folder</h3>
        <button onClick={handleSelectFolder} disabled={loading} className="select-folder-btn">
          {loading ? 'Loading...' : folderPath ? 'Change Folder' : 'Select Folder'}
        </button>
      </div>

      {folderPath && (
        <div className="folder-path">
          <span className="path-label">Current:</span>
          <span className="path-value" title={folderPath}>
            {folderPath.split(/[/\\]/).pop() || folderPath}
          </span>
        </div>
      )}

      {loadedImages.length > 0 && (
        <div className="search-bar">
          <input
            type="text"
            placeholder="Search images..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="search-input"
          />
        </div>
      )}

      <div className="images-container">
        {sortedDisplayItems.length > 0 ? (
          // Progressive loading with stable positions
          <div className="images-grid">
            {sortedDisplayItems.map((item, index) =>
              item.type === 'image' && item.data ? (
                <DraggableImage
                  key={item.data.path}
                  img={item.data}
                  isSelected={selectedImage === item.data.path}
                  onSelect={() => setSelectedImage(item.data.path)}
                />
              ) : (
                <SkeletonImageCard key={`skeleton-${index}`} />
              )
            )}
          </div>
        ) : loading ? (
          // Initial loading state before we know the count
          <div className="empty-state">
            <p>Scanning folder...</p>
          </div>
        ) : folderPath ? (
          <div className="empty-state">
            <p>No images found in this folder</p>
            <small>Supported: JPG, PNG, RAW</small>
          </div>
        ) : (
          <div className="empty-state">
            <p>Select a working folder to begin</p>
            <small>All images in the folder will appear here</small>
          </div>
        )}
      </div>
    </div>
  );
}
