import { useState, useRef } from 'react';
import { useDrag } from 'react-dnd';
import { invoke, convertFileSrc } from '@tauri-apps/api/core';
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

  const [{ isDragging }, drag] = useDrag({
    type: 'IMAGE',
    item: { path: img.path, thumbnail: img.thumbnail || img.path, dimensions: img.dimensions },
    collect: (monitor) => ({
      isDragging: monitor.isDragging(),
    }),
  });

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

export function WorkingFolderGallery() {
  const { folderPath, setFolderPath, images, setImages, loading, setLoading, selectedImage, setSelectedImage } = useWorkingFolder();
  const [searchTerm, setSearchTerm] = useState('');

  const handleSelectFolder = async () => {
    try {
      setLoading(true);
      const result = await invoke<{ path: string; images: WorkingImage[] }>('select_working_folder');
      setFolderPath(result.path);
      setImages(result.images);
    } catch (error) {
      console.error('Failed to select working folder:', error);
      alert(`Failed to select folder: ${error}`);
    } finally {
      setLoading(false);
    }
  };

  const filteredImages = images.filter(img =>
    img.filename.toLowerCase().includes(searchTerm.toLowerCase())
  );

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

      {images.length > 0 && (
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
        {loading ? (
          <div className="loading-state">
            <div className="spinner"></div>
            <p>Scanning folder...</p>
          </div>
        ) : filteredImages.length > 0 ? (
          <div className="images-grid">
            {filteredImages.map((img) => (
              <DraggableImage
                key={img.path}
                img={img}
                isSelected={selectedImage === img.path}
                onSelect={() => setSelectedImage(img.path)}
              />
            ))}
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
