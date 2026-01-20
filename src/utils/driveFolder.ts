import { invoke } from "@tauri-apps/api/core";
import type { DriveFolder } from "../types/qr";

/**
 * Fetches folders from Google Drive
 */
export async function fetchDriveFolders(parentId: string | null): Promise<DriveFolder[]> {
  return invoke<DriveFolder[]>("list_drive_folders", { parentId });
}

/**
 * Creates a new folder in Google Drive
 */
export async function createDriveFolder(
  folderName: string,
  parentId: string | null
): Promise<DriveFolder> {
  return invoke<DriveFolder>("create_drive_folder", {
    folderName: folderName.trim(),
    parentId,
  });
}

/**
 * Deletes a folder from Google Drive
 */
export async function deleteDriveFolder(folderId: string): Promise<void> {
  await invoke("delete_drive_folder", { folderId });
}

/**
 * Sets the root folder for uploads
 */
export async function setRootFolder(folder: DriveFolder): Promise<void> {
  await invoke("set_root_folder", { folder });
}

/**
 * Gets the currently saved root folder
 */
export async function getRootFolder(): Promise<DriveFolder | null> {
  return invoke<DriveFolder | null>("get_root_folder");
}

/**
 * Gets the parent folder ID from a folder path array
 */
export function getParentId(folderPath: { id: string; name: string }[]): string | null {
  return folderPath.length > 0 ? folderPath[folderPath.length - 1].id : null;
}

/**
 * Creates a DriveFolder object from path info
 */
export function createFolderFromPath(
  pathItem: { id: string; name: string }
): DriveFolder {
  return {
    id: pathItem.id,
    name: pathItem.name,
    is_shared_drive: false,
  };
}
