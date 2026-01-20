import { useState } from "react";
import {
  fetchDriveFolders,
  createDriveFolder,
  deleteDriveFolder,
  setRootFolder as setRootFolderApi,
  getParentId,
  createFolderFromPath,
} from "../utils/driveFolder";
import type { DriveFolder } from "../types/qr";

interface FolderPathItem {
  id: string;
  name: string;
}

export function useDriveFolderPicker(
  setRootFolder: (folder: DriveFolder | null) => void
) {
  const [showFolderPicker, setShowFolderPicker] = useState(false);
  const [driveFolders, setDriveFolders] = useState<DriveFolder[]>([]);
  const [folderPath, setFolderPath] = useState<FolderPathItem[]>([]);
  const [loadingFolders, setLoadingFolders] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [folderToDelete, setFolderToDelete] = useState<DriveFolder | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");

  const fetchFolders = async (parentId: string | null) => {
    setLoadingFolders(true);
    setError("");
    try {
      const folders = await fetchDriveFolders(parentId);
      setDriveFolders(folders);
    } catch (e) {
      console.error("Failed to list folders:", e);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingFolders(false);
    }
  };

  const handleNavigateFolder = async (folder: DriveFolder) => {
    setFolderPath([...folderPath, { id: folder.id, name: folder.name }]);
    await fetchFolders(folder.id);
  };

  const handleNavigateUp = async () => {
    if (folderPath.length === 0) return;
    const newPath = folderPath.slice(0, -1);
    setFolderPath(newPath);
    await fetchFolders(getParentId(newPath));
  };

  const handleConfirmSelection = async (folder: DriveFolder) => {
    try {
      await setRootFolderApi(folder);
      setRootFolder(folder);
      setShowFolderPicker(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleSelectCurrentDir = async () => {
    if (folderPath.length === 0) {
      setError("Please select a specific folder");
      return;
    }
    const folder = createFolderFromPath(folderPath[folderPath.length - 1]);
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
      const parentId = getParentId(folderPath);
      await createDriveFolder(newFolderName, parentId);
      await fetchFolders(parentId);
      setNewFolderName("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreatingFolder(false);
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
      await deleteDriveFolder(folderToDelete.id);
      await fetchFolders(getParentId(folderPath));
      setShowDeleteConfirm(false);
      setFolderToDelete(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDeleting(false);
    }
  };

  const cancelDelete = () => {
    setShowDeleteConfirm(false);
    setFolderToDelete(null);
  };

  const openFolderPicker = async () => {
    setFolderPath([]);
    await fetchFolders(null);
    setShowFolderPicker(true);
  };

  return {
    // State
    showFolderPicker,
    driveFolders,
    folderPath,
    loadingFolders,
    newFolderName,
    creatingFolder,
    showDeleteConfirm,
    folderToDelete,
    deleting,
    error,
    // Setters
    setShowFolderPicker,
    setNewFolderName,
    setError,
    // Handlers
    fetchFolders,
    handleNavigateFolder,
    handleNavigateUp,
    handleConfirmSelection,
    handleSelectCurrentDir,
    handleCreateFolder,
    handleDeleteFolder,
    confirmDeleteFolder,
    cancelDelete,
    openFolderPicker,
  };
}
