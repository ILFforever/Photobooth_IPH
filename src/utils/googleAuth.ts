import { invoke } from "@tauri-apps/api/core";
import type { GoogleAccount } from "../types/qr";

/**
 * Checks for a cached Google account
 */
export async function checkCachedAccount(): Promise<GoogleAccount | null> {
  return invoke<GoogleAccount | null>("check_cached_account");
}

/**
 * Gets the current account from backend memory
 */
export async function getAccount(): Promise<GoogleAccount | null> {
  return invoke<GoogleAccount | null>("get_account");
}

/**
 * Initiates Google login flow
 */
export async function googleLogin(): Promise<GoogleAccount> {
  return invoke<GoogleAccount>("google_login");
}

/**
 * Logs out and clears cached credentials
 */
export async function googleLogout(): Promise<void> {
  await invoke("google_logout");
}
