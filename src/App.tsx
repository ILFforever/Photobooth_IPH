import { useState, useEffect } from "react";
import { AnimatePresence } from "framer-motion";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { useAuth } from "./contexts/AuthContext";
import { listen } from '@tauri-apps/api/event';
import { useQR } from "./contexts/QRContext";
import Header from "./components/Header/Header";
import HistoryModal from "./components/Modals/HistoryModal";
import AboutModal from "./components/Modals/AboutModal";
import FolderPickerModal from "./components/Modals/FolderPickerModal";
import AddPhotosModal from "./components/Modals/AddPhotosModal";
import CachedAccountModal from "./components/Modals/CachedAccountModal";
import DeleteFolderModal from "./components/Modals/DeleteFolderModal";
import CollageWorkspace from "./components/Canvas/CollageWorkspace";
import Sidebar from "./components/Sidebar/Sidebar";
import "./App.css";

interface Result {
  folder_name: string;
  link: string;
  qr_data: string;
}

interface GoogleAccount {
  email: string;
  name: string;
  picture?: string;
}

interface DriveFolder {
  id: string;
  name: string;
  is_shared_drive: boolean;
}

interface HistoryItem {
  timestamp: string;
  folder_name: string;
  link: string;
  qr_data: string;
}

function App() {
  // Context hooks - using contexts for auth, QR, etc.
  const {
    account, setAccount,
    rootFolder, setRootFolder,
    setLoggingIn,
    cachedAccount, setCachedAccount,
    showCachedAccountConfirm, setShowCachedAccountConfirm
  } = useAuth();

  const {
    setHistory: setHistoryItems,
    showHistoryModal, setShowHistoryModal,
    uploadProgress, setUploadProgress
  } = useQR();

  // Local component state (QR-specific, will stay here for now)
  const [photos_path, setPhotosPath] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState("");
  const [showAccountMenu, setShowAccountMenu] = useState(false);
  const [selectingFolder, setSelectingFolder] = useState(false);
  const [showFolderPicker, setShowFolderPicker] = useState(false);
  const [driveFolders, setDriveFolders] = useState<DriveFolder[]>([]);
  const [newFolderName, setNewFolderName] = useState("");
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [tauriReady, setTauriReady] = useState(false);

  // Navigation state
  const [folderPath, setFolderPath] = useState<{id: string, name: string}[]>([]);
  const [loadingFolders, setLoadingFolders] = useState(false);

  // Delete confirmation state
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [folderToDelete, setFolderToDelete] = useState<DriveFolder | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Gallery state
  const [selectedImages, setSelectedImages] = useState<string[]>([]);
  const [loadedImages, setLoadedImages] = useState<Record<string, boolean>>({});
  const [isDragging, setIsDragging] = useState(false);
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [processingImages, setProcessingImages] = useState<string[]>([]);
  const [failedImages, setFailedImages] = useState<{filename: string, type: string, isRaw?: boolean, size?: number}[]>([]);

  // Upload condition checking state
  const [uploadConditionsMet, setUploadConditionsMet] = useState(false);

  // Store actual file paths for uploaded images
  const [imagePaths, setImagePaths] = useState<string[]>([]);

  // Map asset URLs to original file paths (for folder-loaded images)
  const [assetUrlToFilePath, setAssetUrlToFilePath] = useState<Record<string, string>>({});

  // Map thumbnails to actual filenames for deletion
  const [thumbnailToFilename, setThumbnailToFilename] = useState<Record<string, string>>({});

  // Upload cancellation state
  const [uploadCancelled, setUploadCancelled] = useState(false);

  // App menu state
  const [showAppMenu, setShowAppMenu] = useState(false);
  const [showAboutModal, setShowAboutModal] = useState(false);

  // Always in collage mode now
  // const [viewMode, setViewMode] = useState<'qr' | 'collage'>('collage');

  // Debug version log
  useEffect(() => {
    console.log("=== APP VERSION: v1.0.7 (Structured Nav) ===");
    console.log("Timestamp:", new Date().toISOString());
    console.log("Invoke function type:", typeof invoke);
    console.log("Invoke function:", invoke);
    console.log("Window __TAURI_INTERNALS__:", (window as any).__TAURI_INTERNALS__);
    console.log("Window __TAURI__:", (window as any).__TAURI__);
  }, []);

  // Listen for upload progress events
  useEffect(() => {
    if (!tauriReady) return;

    const unlisten = listen<{step: string; current: number; total: number; message: string}>(
      'upload-progress',
      (event) => {
        console.log('Upload progress:', event.payload);
        setUploadProgress(event.payload);
      }
    );

    return () => {
      unlisten.then(fn => fn());
    };
  }, [tauriReady]);

  // Load history when modal opens
  useEffect(() => {
    if (showHistoryModal) {
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
  }, [showHistoryModal]);

  const formatDate = (timestamp: string) => {
    try {
      // timestamp is unix seconds string
      const date = new Date(parseInt(timestamp) * 1000);
      return new Intl.DateTimeFormat('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: 'numeric',
        hour12: true
      }).format(date);
    } catch (e) {
      return timestamp;
    }
  };

  // Poll upload conditions every 250ms (debugging disabled)
  useEffect(() => {
    const checkUploadConditions = () => {
      const hasImages = selectedImages.length > 0;
      const isLoggedIn = account !== null;
      const hasRootFolder = rootFolder !== null;
      const hasPhotoPath = photos_path !== "";

      const allConditionsMet = hasImages && isLoggedIn && hasRootFolder && hasPhotoPath;

      // Only log when conditions change
      if (allConditionsMet && !uploadConditionsMet) {
        console.log("✅✅✅ ALL UPLOAD CONDITIONS MET! Ready to upload!");
        setUploadConditionsMet(true);
      } else if (!allConditionsMet && uploadConditionsMet) {
        console.log("⚠️ Upload conditions no longer met");
        setUploadConditionsMet(false);
      }
    };

    // Check immediately
    checkUploadConditions();

    // Then check every 250ms
    const interval = setInterval(checkUploadConditions, 250);

    return () => clearInterval(interval);
  }, [selectedImages, account, rootFolder, photos_path, uploadConditionsMet]);

  // Wait for Tauri to be ready
  useEffect(() => {
    const initTauri = async () => {
      console.log("Initializing Tauri...");

      // Wait for window.__TAURI_INTERNALS__ to be available
      let attempts = 0;
      const maxAttempts = 50; // 5 seconds max

      while (attempts < maxAttempts) {
        if (typeof window !== 'undefined' && (window as any).__TAURI_INTERNALS__) {
          console.log("Tauri internals found after", attempts * 100, "ms");
          setTauriReady(true);
          return;
        }
        await new Promise(resolve => setTimeout(resolve, 100));
        attempts++;
      }

      console.error("Tauri internals not found after 5 seconds");
    };
    initTauri();
  }, []);

  // Check if user is already logged in on mount
  useEffect(() => {
    if (!tauriReady) return;

    const checkAccount = async () => {
      try {
        const savedAccount = await invoke<GoogleAccount | null>("get_account");
        if (savedAccount) {
          setAccount(savedAccount);

          // Also check for root folder
          const savedFolder = await invoke<DriveFolder | null>("get_root_folder");
          if (savedFolder) {
            setRootFolder(savedFolder);
          }
        }
      } catch (e) {
        console.error("Failed to check account:", e);
      }
    };
    checkAccount();
  }, [tauriReady]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = () => {
      if (showAccountMenu) {
        setShowAccountMenu(false);
      }
      if (showAppMenu) {
        setShowAppMenu(false);
      }
    };

    if (showAccountMenu || showAppMenu) {
      document.addEventListener('click', handleClickOutside);
      return () => document.removeEventListener('click', handleClickOutside);
    }
  }, [showAccountMenu, showAppMenu]);

  const fetchFolders = async (parentId: string | null) => {
    setLoadingFolders(true);
    setError("");
    try {
      const folders = await invoke<DriveFolder[]>("list_drive_folders", { parentId });
      console.log("Received folders:", folders);
      setDriveFolders(folders);
    } catch (e) {
      console.error("Error listing folders:", e);
      setError(String(e));
    } finally {
      setLoadingFolders(false);
    }
  };

  const handleSelectDriveFolder = async () => {
    console.log("=== handleSelectDriveFolder called ===");
    console.log("Account:", account);

    if (!account) {
      console.log("No account, showing error");
      setError("Please sign in with Google first");
      return;
    }

    setSelectingFolder(true);
    setFolderPath([]); // Reset to root
    
    await fetchFolders(null);
    
    setShowFolderPicker(true);
    setSelectingFolder(false);
  };

  const handleNavigateFolder = async (folder: DriveFolder) => {
    setFolderPath([...folderPath, { id: folder.id, name: folder.name }]);
    await fetchFolders(folder.id);
  };

  const handleNavigateUp = async () => {
    if (folderPath.length === 0) return;
    const newPath = folderPath.slice(0, -1);
    setFolderPath(newPath);
    const parentId = newPath.length > 0 ? newPath[newPath.length - 1].id : null;
    await fetchFolders(parentId);
  };

  const handleConfirmSelection = async (folder: DriveFolder) => {
    try {
      await invoke("set_root_folder", { folder });
      setRootFolder(folder);
      setShowFolderPicker(false);
    } catch (e) {
      setError(String(e));
    }
  };

  // Allows selecting the current directory (if valid, usually mostly for subfolders)
  const handleSelectCurrentDir = async () => {
    if (folderPath.length === 0) {
       setError("Please select a specific folder");
       return;
    }
    const current = folderPath[folderPath.length - 1];
    const folder: DriveFolder = {
        id: current.id,
        name: current.name,
        is_shared_drive: false 
    };
    handleConfirmSelection(folder);
  };

  const handleCreateFolder = async () => {
    if (!newFolderName.trim()) {
      setError("Please enter a folder name");
      return;
    }

    setCreatingFolder(true);
    setError("");
    try {
      const parentId = folderPath.length > 0 ? folderPath[folderPath.length - 1].id : null;
      await invoke<DriveFolder>("create_drive_folder", {
        folderName: newFolderName.trim(),
        parentId
      });
      // Refresh the folder list to show the new folder
      await fetchFolders(parentId);
      setNewFolderName("");
    } catch (e) {
      setError(String(e));
    } finally {
      setCreatingFolder(false);
    }
  };

  const handleGenerate = async () => {
    console.log("=== handleGenerate called ===");
    console.log("photos_path:", photos_path);
    console.log("selectedImages.length:", selectedImages.length);
    console.log("rootFolder:", rootFolder);

    if (!photos_path && selectedImages.length === 0) {
      console.log("❌ Validation failed: No photos selected");
      setError("Please add photos first");
      return;
    }

    if (!rootFolder) {
      console.log("❌ Validation failed: No root folder");
      setError("Please select a Drive root folder first");
      return;
    }

    // If we have selected images but no folder path, we need a folder path for the backend
    if (!photos_path && selectedImages.length > 0) {
      console.log("❌ Validation failed: Images selected but no folder path");
      setError("Please use 'Browse > From Folder' to select a folder of images to upload");
      return;
    }

    // Build the file list for upload
    const fileList: string[] = [];

    // Add files from imagePaths (dropped/single images from temp folder)
    fileList.push(...imagePaths);

    // Add files from assetUrlToFilePath (folder-loaded images)
    for (const assetUrl of selectedImages) {
      const originalPath = assetUrlToFilePath[assetUrl];
      if (originalPath && !fileList.includes(originalPath)) {
        fileList.push(originalPath);
      }
    }

    // Add RAW files from failedImages
    for (const failedImg of failedImages) {
      // Construct the full path using photos_path and filename
      const fullPath = `${photos_path}${photos_path.endsWith('\\') || photos_path.endsWith('/') ? '' : '\\'}${failedImg.filename}`;
      if (!fileList.includes(fullPath)) {
        fileList.push(fullPath);
      }
    }

    console.log("✅ Validation passed, starting upload...");
    console.log("Upload parameters:", {
      photosPath: photos_path,
      fileList: fileList,
      fileCount: fileList.length,
      rootFolderId: rootFolder.id,
      rootFolderName: rootFolder.name
    });

    setLoading(true);
    setError("");
    setResult(null);
    setUploadCancelled(false);
    setUploadProgress(null);

    try {
      console.log("🔄 Invoking process_photos...");
      const startTime = Date.now();

      const res = await invoke<Result>("process_photos", {
        photosPath: photos_path,
        fileList: fileList.length > 0 ? fileList : null,
      });

      const endTime = Date.now();
      const duration = ((endTime - startTime) / 1000).toFixed(2);

      // Check if upload was cancelled
      if (uploadCancelled) {
        console.log("⚠️ Upload was cancelled by user");
        setError("Upload cancelled");
        return;
      }

      console.log(`✅ process_photos completed in ${duration}s`);
      console.log("Result:", res);

      setResult(res);
    } catch (e) {
      console.error("❌ process_photos failed:", e);
      console.error("Error type:", typeof e);
      console.error("Error details:", {
        message: e instanceof Error ? e.message : String(e),
        stack: e instanceof Error ? e.stack : undefined
      });
      setError(String(e));
    } finally {
      setLoading(false);
      setUploadCancelled(false);
      console.log("=== handleGenerate finished ===");
    }
  };

  const handleCancelUpload = () => {
    console.log("⚠️ User cancelled upload");
    setUploadCancelled(true);
    setLoading(false);
    setError("Upload cancelled by user");
  };

  const handleNew = async () => {
    console.log("🔄 Starting new session");

    // Clear temp images from backend
    try {
      await invoke("clear_temp_images");
      console.log("✅ Cleared temp images");
    } catch (e) {
      console.error("Failed to clear temp images:", e);
    }

    setResult(null);
    setSelectedImages([]);
    setLoadedImages({});
    setImagePaths([]);
    setPhotosPath("");
    setProcessingImages([]);
    setFailedImages([]);
    setError("");
    setUploadCancelled(false);
    setThumbnailToFilename({});
    setAssetUrlToFilePath({});
  };

  const handleCopyLink = () => {
    if (result?.link) {
      navigator.clipboard.writeText(result.link);
    }
  };

  const handleLogin = async (e?: React.MouseEvent, forceFresh: boolean = false) => {
    e?.stopPropagation();

    // Check for cached account first
    if (!forceFresh) {
      try {
        const cached = await invoke<GoogleAccount | null>("check_cached_account");
        if (cached) {
          console.log("Found cached account:", cached);
          setCachedAccount(cached);
          setShowCachedAccountConfirm(true);
          setShowAccountMenu(false);
          return;
        }
      } catch (e) {
        console.log("No cached account or error checking:", e);
      }
    }

    setLoggingIn(true);
    setError("");
    try {
      console.log("Attempting to invoke google_login...");
      const accountData = await invoke<GoogleAccount>("google_login");
      console.log("Login successful:", accountData);
      setAccount(accountData);
      setShowAccountMenu(false);
    } catch (e) {
      console.error("Login error details:", {
        error: e,
        type: typeof e,
        message: e instanceof Error ? e.message : String(e),
        stack: e instanceof Error ? e.stack : undefined
      });
      const errorMsg = e instanceof Error ? e.message : String(e);
      setError(errorMsg);
    } finally {
      setLoggingIn(false);
    }
  };

  const handleConfirmCachedAccount = async () => {
    if (cachedAccount) {
      setShowCachedAccountConfirm(false);
      setLoggingIn(true);
      setError("");

      try {
        // Call google_login to restore backend auth state from cache
        console.log("Restoring cached session...");
        const accountData = await invoke<GoogleAccount>("google_login");
        console.log("Session restored:", accountData);
        setAccount(accountData);
      } catch (e) {
        console.error("Failed to restore session:", e);
        const errorMsg = e instanceof Error ? e.message : String(e);
        setError(errorMsg);
        // Fallback to cached account data
        setAccount(cachedAccount);
      } finally {
        setLoggingIn(false);
        setCachedAccount(null);
      }
    }
  };

  const handleUseDifferentAccount = async () => {
    setShowCachedAccountConfirm(false);
    setCachedAccount(null);

    // Delete the cache first
    try {
      await invoke("google_logout");
      console.log("Cache deleted successfully");
    } catch (e) {
      console.error("Failed to delete cache:", e);
    }

    // Force a fresh login
    await handleLogin(undefined, true);
  };

  const handleCancelLogin = () => {
    console.log("User cancelled login");
    setLoggingIn(false);
    setShowAccountMenu(false);
  };

  const handleLogout = async (e?: React.MouseEvent) => {
    e?.stopPropagation();
    try {
      await invoke("google_logout");
      setAccount(null);
      setRootFolder(null);
      setShowAccountMenu(false);
      setResult(null); // Clear results when logging out
    } catch (e) {
      console.error("Logout failed:", e);
    }
  };

  const handleDeleteFolder = (folder: DriveFolder) => {
    setFolderToDelete(folder);
    setShowDeleteConfirm(true);
  };

  const confirmDeleteFolder = async () => {
    if (!folderToDelete) return;

    setDeleting(true);
    setError("");
    try {
      await invoke("delete_drive_folder", { folderId: folderToDelete.id });
      // Refresh the folder list
      const parentId = folderPath.length > 0 ? folderPath[folderPath.length - 1].id : null;
      await fetchFolders(parentId);
      setShowDeleteConfirm(false);
      setFolderToDelete(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setDeleting(false);
    }
  };

  const cancelDelete = () => {
    setShowDeleteConfirm(false);
    setFolderToDelete(null);
  };

  // Helper function to create thumbnail from data URL
  const createThumbnailFromDataUrl = async (dataUrl: string, maxWidth = 800, maxHeight = 800): Promise<string> => {
    return new Promise((resolve, reject) => {
      const img = new Image();

      img.onload = () => {
        try {
          // Calculate new dimensions while maintaining aspect ratio
          let width = img.width;
          let height = img.height;

          if (width > maxWidth || height > maxHeight) {
            const aspectRatio = width / height;
            if (width > height) {
              width = maxWidth;
              height = width / aspectRatio;
            } else {
              height = maxHeight;
              width = height * aspectRatio;
            }
          }

          // Create canvas and draw resized image
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');

          if (!ctx) {
            reject(new Error('Failed to get canvas context'));
            return;
          }

          ctx.drawImage(img, 0, 0, width, height);

          // Convert to data URL with quality optimization
          const thumbnailDataUrl = canvas.toDataURL('image/jpeg', 0.85);
          resolve(thumbnailDataUrl);
        } catch (err) {
          reject(err);
        }
      };

      img.onerror = (err) => {
        reject(new Error(`Failed to load image: ${err}`));
      };

      // Use the data URL directly - no CORS issues
      img.src = dataUrl;
    });
  };

  // Gallery handlers
  const handleRemoveImage = async (imagePath: string) => {
    // Get the filename from the mapping (for dropped images)
    const filename = thumbnailToFilename[imagePath];
    if (filename) {
      // Delete the file from temp storage (for dropped/single images)
      try {
        await invoke("remove_temp_image", { filename });
        console.log(`Deleted temp image: ${filename}`);
      } catch (e) {
        console.error("Failed to delete temp image:", e);
      }
      // Remove from mapping
      setThumbnailToFilename(prev => {
        const next = { ...prev };
        delete next[imagePath];
        return next;
      });
      // Remove from image paths
      setImagePaths(prev => prev.filter(path => !path.endsWith(filename)));
    }

    // For images loaded from folder, remove from the asset URL mapping
    if (assetUrlToFilePath[imagePath]) {
      setAssetUrlToFilePath(prev => {
        const next = { ...prev };
        delete next[imagePath];
        return next;
      });
    }

    setSelectedImages(prev => prev.filter(img => img !== imagePath));
    setLoadedImages(prev => {
      const next = { ...prev };
      delete next[imagePath];
      return next;
    });
  };

  const handleRemoveFailedImage = async (filename: string) => {
    // Delete the file from temp storage
    try {
      await invoke("remove_temp_image", { filename });
      console.log(`Deleted temp image: ${filename}`);
    } catch (e) {
      console.error("Failed to delete temp image:", e);
    }

    // Remove from failed images list
    setFailedImages(prev => prev.filter(img => img.filename !== filename));
    // Remove from image paths
    setImagePaths(prev => prev.filter(path => !path.endsWith(filename)));
  };

  const handleImageLoaded = (path: string) => {
    setLoadedImages(prev => ({ ...prev, [path]: true }));
  };

  // Drag over handlers for visual feedback only (actual drop handled by Tauri)
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    const files = Array.from(e.dataTransfer.files);
    console.log("Total files dropped:", files.length);

    const imageFiles = files.filter(file =>
      file.type.startsWith('image/') ||
      /\.(jpg|jpeg|png|raw|raf)$/i.test(file.name)
    );

    console.log(`Filtered to ${imageFiles.length} image files`);

    // Add all files to processing queue immediately to show skeletons
    setProcessingImages(prev => [...prev, ...imageFiles.map(f => f.name)]);

    for (const file of imageFiles) {
      try {
        console.log(`Processing ${file.name}...`);

        // Check if file is a RAW format
        const fileExt = file.name.split('.').pop()?.toLowerCase() || '';
        const isRawFile = ['raw', 'raf', 'cr2', 'nef', 'arw', 'dng', 'orf', 'rw2', 'pef', 'srw'].includes(fileExt);

        if (isRawFile) {
          console.log(`⚠️ RAW file detected: ${file.name} - skipping thumbnail generation`);
          const fileExtUpper = fileExt.toUpperCase();
          setFailedImages(prev => [...prev, { filename: file.name, type: fileExtUpper, isRaw: true, size: file.size }]);

          // Still save the file for upload
          const dataUrl = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(file);
          });

          const savedPath = await invoke<string>("save_dropped_image", {
            imageData: dataUrl,
            filename: file.name
          });
          console.log(`✓ RAW file saved to: ${savedPath}`);

          // Store the saved file path
          setImagePaths(prev => {
            const newPaths = [...prev, savedPath];
            if (newPaths.length > 0) {
              const firstPath = newPaths[0];
              const parentDir = firstPath.substring(0, firstPath.lastIndexOf('\\') || firstPath.lastIndexOf('/'));
              setPhotosPath(parentDir);
            }
            return newPaths;
          });

          continue; // Skip thumbnail generation
        }

        // Read file as data URL
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });

        // Generate thumbnail from the data URL before saving
        console.log(`Generating thumbnail for ${file.name}...`);
        let thumbnail: string;
        try {
          thumbnail = await createThumbnailFromDataUrl(dataUrl, 800, 800);
          console.log(`✓ Thumbnail generated (${thumbnail.length} bytes)`);
        } catch (thumbErr) {
          console.error(`Failed to generate thumbnail for ${file.name}:`, thumbErr);
          // Add to failed images with file metadata
          const fileExtUpper = file.name.split('.').pop()?.toUpperCase() || 'FILE';
          setFailedImages(prev => [...prev, { filename: file.name, type: fileExtUpper, isRaw: false, size: file.size }]);
          throw thumbErr; // Re-throw to skip the rest of processing
        }

        // Save the image to app's temp folder and get file path
        console.log(`Saving ${file.name} to temp folder...`);
        const savedPath = await invoke<string>("save_dropped_image", {
          imageData: dataUrl,
          filename: file.name
        });
        console.log(`✓ Saved to: ${savedPath}`);

        // Store the saved file path
        setImagePaths(prev => {
          const newPaths = [...prev, savedPath];

          // Extract common parent directory
          if (newPaths.length > 0) {
            const firstPath = newPaths[0];
            const parentDir = firstPath.substring(0, firstPath.lastIndexOf('\\') || firstPath.lastIndexOf('/'));
            console.log("Setting photos_path to:", parentDir);
            setPhotosPath(parentDir);
          }

          return newPaths;
        });

        // Add thumbnail to display and map it to filename
        setSelectedImages(prev => {
          if (!prev.includes(thumbnail)) {
            console.log(`✓ Added thumbnail for ${file.name}`);
            // Map thumbnail to filename for deletion
            setThumbnailToFilename(mapping => ({ ...mapping, [thumbnail]: file.name }));
            return [...prev, thumbnail];
          }
          console.log(`⚠ Thumbnail already exists for ${file.name}`);
          return prev;
        });

      } catch (err) {
        console.error(`Failed to process ${file.name}:`, err);
        // Don't show error message for thumbnail failures (already tracked in failedImages)
      } finally {
        // Remove from processing queue
        setProcessingImages(prev => prev.filter(name => name !== file.name));
      }
    }

    console.log("✓ All dropped images processed");
  };

  const handleClearGallery = async () => {
    console.log("🗑️ Clearing gallery");

    // Clear temp images from backend
    try {
      await invoke("clear_temp_images");
      console.log("✅ Cleared temp images");
    } catch (e) {
      console.error("Failed to clear temp images:", e);
    }

    setSelectedImages([]);
    setLoadedImages({});
    setImagePaths([]);
    setPhotosPath("");
    setProcessingImages([]);
    setFailedImages([]);
    setThumbnailToFilename({});
    setAssetUrlToFilePath({});
  };

  const handleAddPhotos = () => {
    setShowAddMenu(true);
  };

  const handleAddSingleImage = async () => {
    try {
      console.log("Requesting single file selection...");
      const selected = await invoke<string>("select_file");
      if (selected) {
        console.log("Selected file:", selected);
        console.log("File type:", typeof selected);

        // Extract filename and parent directory
        const filename = selected.split(/[\\/]/).pop() || "image";
        const parentDir = selected.substring(0, selected.lastIndexOf('\\') || selected.lastIndexOf('/'));

        // Set photos_path to the parent directory
        setPhotosPath(parentDir);

        // Check if file is a RAW format
        const fileExt = filename.split('.').pop()?.toLowerCase() || '';
        const isRawFile = ['raw', 'raf', 'cr2', 'nef', 'arw', 'dng', 'orf', 'rw2', 'pef', 'srw'].includes(fileExt);

        if (isRawFile) {
          console.log(`⚠️ RAW file detected: ${filename} - adding to failed images`);
          const fileExtUpper = fileExt.toUpperCase();

          // Get file size
          try {
            const fileInfo = await invoke<{ size: number }>("get_file_info", { filePath: selected });
            setFailedImages(prev => [...prev, {
              filename,
              type: fileExtUpper,
              isRaw: true,
              size: fileInfo.size
            }]);
          } catch (e) {
            console.error("Failed to get file info:", e);
            setFailedImages(prev => [...prev, {
              filename,
              type: fileExtUpper,
              isRaw: true
            }]);
          }

          // Store the file path for upload
          setImagePaths(prev => [...prev, selected]);
          setShowAddMenu(false);
          return;
        }

        setProcessingImages(prev => [...prev, filename]);

        try {
          // Convert path to asset URL
          const assetUrl = convertFileSrc(selected);
          console.log(`Converted ${selected} -> ${assetUrl}`);
          console.log("Asset URL type:", typeof assetUrl);

          // Test if the URL is accessible
          await new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = resolve;
            img.onerror = reject;
            img.src = assetUrl;
          });
          console.log("✓ Image loaded successfully!");

          // Create mapping from asset URL to original file path
          setAssetUrlToFilePath(prev => ({ ...prev, [assetUrl]: selected }));

          setSelectedImages(prev => {
            if (prev.includes(assetUrl)) {
              console.log("Image already exists, skipping");
              return prev;
            }
            return [...prev, assetUrl];
          });
          console.log("Added to selectedImages array");
        } catch (e) {
          console.error("Error processing image:", e);
          // Add to failed images if thumbnail generation fails
          const fileExtUpper = fileExt.toUpperCase() || 'FILE';
          setFailedImages(prev => [...prev, { filename, type: fileExtUpper, isRaw: false }]);
        } finally {
          setProcessingImages(prev => prev.filter(name => name !== filename));
        }
      }
    } catch (e) {
      console.error("Error selecting file:", e);
    }
    setShowAddMenu(false);
  };

  const handleAddFromFolder = async () => {
    try {
      console.log("Requesting folder selection...");
      const selected = await invoke<string>("select_folder");
      if (selected) {
        // Clear previous temp images and state
        try {
          await invoke("clear_temp_images");
          console.log("✅ Cleared previous temp images");
        } catch (e) {
          console.error("Failed to clear temp images:", e);
        }

        setSelectedImages([]);
        setLoadedImages({});
        setImagePaths([]);
        setFailedImages([]);
        setThumbnailToFilename({});
        setAssetUrlToFilePath({});
        setPhotosPath(selected);
        setResult(null);

        // Fetch images with metadata from the selected folder
        console.log("Fetching images from:", selected);
        const imageFiles = await invoke<{path: string, size: number, extension: string}[]>("get_images_with_metadata", { folderPath: selected });
        console.log("Images found:", imageFiles);

        // Separate RAW files from regular images
        const rawFiles = imageFiles.filter(img =>
          ['raw', 'raf', 'cr2', 'nef', 'arw', 'dng', 'orf', 'rw2', 'pef', 'srw'].includes(img.extension)
        );
        const regularImages = imageFiles.filter(img =>
          !['raw', 'raf', 'cr2', 'nef', 'arw', 'dng', 'orf', 'rw2', 'pef', 'srw'].includes(img.extension)
        );

        // Add RAW files to failedImages
        const rawFileFailed = rawFiles.map(img => ({
          filename: img.path.split(/[\\/]/).pop() || "image",
          type: img.extension.toUpperCase(),
          isRaw: true,
          size: img.size
        }));
        setFailedImages(rawFileFailed);

        // Show loading skeletons for regular images
        const filenames = regularImages.map(img => img.path.split(/[\\/]/).pop() || "image");
        setProcessingImages(filenames);

        // Convert regular image paths to asset URLs and create mapping
        const assetUrlMapping: Record<string, string> = {};
        const assetUrls = regularImages.map(img => {
            const src = convertFileSrc(img.path);
            assetUrlMapping[src] = img.path; // Map asset URL to original file path
            console.log(`Converting ${img.path} -> ${src}`);
            return src;
        });
        setAssetUrlToFilePath(assetUrlMapping);

        // Add regular images
        setSelectedImages(assetUrls);

        // Clear processing state after a short delay to allow shimmer to show
        setTimeout(() => {
          setProcessingImages([]);
        }, 100);
      }
    } catch (e) {
      console.error("Error selecting folder or fetching images:", e);
    }
    setShowAddMenu(false);
  };

  return (
    <div className="app-window">
      {/* Header */}
      <Header
        showAccountMenu={showAccountMenu}
        setShowAccountMenu={setShowAccountMenu}
        showAppMenu={showAppMenu}
        setShowAppMenu={setShowAppMenu}
        onShowHistory={() => setShowHistoryModal(true)}
        onShowAbout={() => setShowAboutModal(true)}
        onLogout={handleLogout}
        onLogin={handleLogin}
        onCancelLogin={handleCancelLogin}
      />

      {/* Main Content */}
      <div className="app-content">
        <Sidebar />

        <div className="main-panel">
          {/* Main Content Area - Always Collage Mode */}
          <div className="tab-content">
            <CollageWorkspace />
          </div>
        </div>
      </div>

      {/* Folder Picker Modal */}
      <AnimatePresence>
        {showFolderPicker && (
          <FolderPickerModal
            show={showFolderPicker}
            onClose={() => setShowFolderPicker(false)}
            driveFolders={driveFolders}
            loadingFolders={loadingFolders}
            folderPath={folderPath}
            newFolderName={newFolderName}
            creatingFolder={creatingFolder}
            onSetNewFolderName={setNewFolderName}
            onFetchFolders={fetchFolders}
            onNavigateFolder={handleNavigateFolder}
            onNavigateUp={handleNavigateUp}
            onConfirmSelection={handleConfirmSelection}
            onSelectCurrentDir={handleSelectCurrentDir}
            onCreateFolder={handleCreateFolder}
            onDeleteFolder={handleDeleteFolder}
          />
        )}
      </AnimatePresence>

      {/* Add Photos Modal */}
      <AnimatePresence>
        {showAddMenu && (
          <AddPhotosModal
            show={showAddMenu}
            onClose={() => setShowAddMenu(false)}
            onAddSingleImage={handleAddSingleImage}
            onAddFromFolder={handleAddFromFolder}
          />
        )}
      </AnimatePresence>

      {/* Delete Confirmation Modal */}
      <AnimatePresence>
        {showDeleteConfirm && folderToDelete && (
          <DeleteFolderModal
            show={showDeleteConfirm}
            folderToDelete={folderToDelete}
            deleting={deleting}
            onCancel={cancelDelete}
            onConfirm={confirmDeleteFolder}
          />
        )}
      </AnimatePresence>

      {/* Cached Account Confirmation Modal */}
      <AnimatePresence>
        {showCachedAccountConfirm && cachedAccount && (
          <CachedAccountModal
            show={showCachedAccountConfirm}
            cachedAccount={cachedAccount}
            onClose={() => {
              setShowCachedAccountConfirm(false);
              setCachedAccount(null);
            }}
            onConfirm={handleConfirmCachedAccount}
            onUseDifferent={handleUseDifferentAccount}
          />
        )}
      </AnimatePresence>

      {/* History Modal */}
      <AnimatePresence>
        {showHistoryModal && (
          <HistoryModal
            show={showHistoryModal}
            onClose={() => setShowHistoryModal(false)}
            formatDate={formatDate}
          />
        )}
      </AnimatePresence>

      {/* About Modal */}
      <AnimatePresence>
        {showAboutModal && (
          <AboutModal
            show={showAboutModal}
            onClose={() => setShowAboutModal(false)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

export default App;