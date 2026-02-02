/**
 * Camera Settings Service
 *
 * Centralized service for all camera setting changes.
 * Handles brand-specific mode names, setting names, and API calls.
 */

import type { CameraBrand, StandardMode, StandardSetting } from './cameraBrands';
import { detectBrand, normalizeMode, getBrandModeName, isSettingAdjustable } from './cameraBrands';

const API_BASE = 'http://localhost:58321';

export type ShutterSpeedValue = string; // e.g., "1/125", "0.5s"
export type ApertureValue = string; // e.g., "f/2.8", "2.8"
export type IsoValue = string; // e.g., "100", "800"
export type EvValue = string; // e.g., "-1.0", "+2.0"
export type WbValue = string; // e.g., "Auto", "Daylight"
export type MeteringValue = 'Evaluative' | 'Partial' | 'Spot' | 'Center-Weighted';
export type ModeValue = 'P' | 'A' | 'S' | 'M';
export type FocusModeValue = 'AF-S' | 'AF-C' | 'MF';

interface CameraSettingsServiceConfig {
  cameraId?: string;
  brand?: CameraBrand;
  onSettingChange?: (setting: StandardSetting, value: string) => void;
}

class CameraSettingsService {
  private cameraId: string | null = null;
  private brand: CameraBrand;
  private onSettingChangeCallback?: ((setting: StandardSetting, value: string) => void) | null;

  constructor(config?: CameraSettingsServiceConfig) {
    this.cameraId = config?.cameraId || null;
    this.brand = config?.brand || detectBrand('', '');
    this.onSettingChangeCallback = config?.onSettingChange;
  }

  /**
   * Update the camera this service is controlling
   */
  setCamera(cameraId: string, manufacturer: string, model: string): void {
    this.cameraId = cameraId;
    this.brand = detectBrand(manufacturer, model);
    console.log(`[CameraSettingsService] Camera set to ${manufacturer} ${model}, brand: ${this.brand.name}`);
  }

  /**
   * Get the current detected brand
   */
  getBrand(): CameraBrand {
    return this.brand;
  }

  /**
   * Normalize a mode from the camera to standard form (P, A, S, M)
   */
  normalizeMode(cameraMode: string): StandardMode {
    return normalizeMode(cameraMode, this.brand);
  }

  /**
   * Convert standard mode to camera-specific mode name for API
   */
  getCameraModeName(standardMode: StandardMode): string {
    return getBrandModeName(standardMode, this.brand);
  }

  /**
   * Generic method to send any setting to the camera
   */
  private async sendSetting(setting: string, value: string): Promise<boolean> {
    if (!this.cameraId) {
      console.warn('[CameraSettingsService] No camera connected');
      return false;
    }

    try {
      console.log(`[CameraSettingsService] Setting ${setting} to ${value}`);
      const response = await fetch(`${API_BASE}/api/camera/config${this.cameraId !== '0' ? `?camera=${this.cameraId}` : ''}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ setting, value }),
      });

      if (!response.ok) {
        console.error(`[CameraSettingsService] Failed to set ${setting}:`, response.statusText);
        return false;
      }

      return true;
    } catch (error) {
      console.error(`[CameraSettingsService] Error setting ${setting}:`, error);
      return false;
    }
  }

  /**
   * Set shooting mode (P, A, S, M)
   * Automatically maps to brand-specific mode name (e.g., P -> "Action" for Fuji)
   */
  async setMode(mode: ModeValue): Promise<boolean> {
    const cameraMode = this.getCameraModeName(mode);
    console.log(`[CameraSettingsService] setMode: ${mode} -> camera mode: "${cameraMode}"`);

    const result = await this.sendSetting('expprogram', cameraMode);

    if (result && this.onSettingChangeCallback) {
      this.onSettingChangeCallback('mode', mode);
    }

    return result;
  }

  /**
   * Set shutter speed
   */
  async setShutterSpeed(value: ShutterSpeedValue): Promise<boolean> {
    console.log(`[CameraSettingsService] setShutterSpeed: ${value}`);

    // The setting name is typically 'shutterspeed' for most cameras
    const result = await this.sendSetting('shutterspeed', value);

    if (result && this.onSettingChangeCallback) {
      this.onSettingChangeCallback('shutter', value);
    }

    return result;
  }

  /**
   * Set aperture (f-number)
   */
  async setAperture(value: ApertureValue): Promise<boolean> {
    console.log(`[CameraSettingsService] setAperture: ${value}`);

    // Most cameras use 'f-number' for aperture setting
    const settingName = this.brand.quirks.apertureSetting || 'f-number';

    // Normalize value - remove 'f/' prefix if present for some cameras
    const normalizedValue = value.startsWith('f/') ? value : `f/${value}`;

    const result = await this.sendSetting(settingName, normalizedValue);

    if (result && this.onSettingChangeCallback) {
      this.onSettingChangeCallback('aperture', value);
    }

    return result;
  }

  /**
   * Set ISO
   */
  async setIso(value: IsoValue): Promise<boolean> {
    console.log(`[CameraSettingsService] setIso: ${value}`);

    const result = await this.sendSetting('iso', value);

    if (result && this.onSettingChangeCallback) {
      this.onSettingChangeCallback('iso', value);
    }

    return result;
  }

  /**
   * Set exposure compensation (EV)
   * For Fuji cameras, uses widget "5010" with value multiplier (×1000)
   */
  async setEv(value: EvValue): Promise<boolean> {
    console.log(`[CameraSettingsService] setEv: ${value}`);

    // Check if brand uses a special EV setting (e.g., Fuji with "5010")
    const evSetting = this.brand.quirks.evSetting || 'exposurecompensation';
    let sendValue = value;

    // Convert value if brand uses a multiplier (e.g., Fuji: "1.0" -> "1000")
    const multiplier = this.brand.quirks.evValueMultiplier;
    if (multiplier) {
      // Parse the EV value (e.g., "+1.0", "-0.333", "0")
      const numericValue = parseFloat(value.replace('+', ''));
      const convertedValue = Math.round(numericValue * multiplier);
      sendValue = convertedValue.toString();
      console.log(`[CameraSettingsService] EV conversion: ${value} -> ${sendValue} (×${multiplier})`);
    }

    const result = await this.sendSetting(evSetting, sendValue);

    if (result && this.onSettingChangeCallback) {
      this.onSettingChangeCallback('ev', value);
    }

    return result;
  }

  /**
   * Set white balance
   */
  async setWhiteBalance(value: WbValue): Promise<boolean> {
    console.log(`[CameraSettingsService] setWhiteBalance: ${value}`);

    const result = await this.sendSetting('whitebalance', value);

    if (result && this.onSettingChangeCallback) {
      this.onSettingChangeCallback('wb', value);
    }

    return result;
  }

  /**
   * Set metering mode
   */
  async setMetering(value: MeteringValue): Promise<boolean> {
    console.log(`[CameraSettingsService] setMetering: ${value}`);

    // Map standard names to camera-specific metering modes
    // This varies by brand, so we might need to extend the brand quirks
    const meteringMap: Record<MeteringValue, string> = {
      'Evaluative': 'Evaluative',
      'Partial': 'Partial',
      'Spot': 'Spot',
      'Center-Weighted': 'Center',
    };

    const result = await this.sendSetting('meteringmode', meteringMap[value]);

    if (result && this.onSettingChangeCallback) {
      this.onSettingChangeCallback('metering', value);
    }

    return result;
  }

  /**
   * Set focus mode
   */
  async setFocusMode(value: FocusModeValue): Promise<boolean> {
    console.log(`[CameraSettingsService] setFocusMode: ${value}`);

    const focusModeMap: Record<FocusModeValue, string> = {
      'AF-S': 'AF-S',
      'AF-C': 'AF-C',
      'MF': 'Manual',
    };

    const result = await this.sendSetting('focusmode', focusModeMap[value]);

    if (result && this.onSettingChangeCallback) {
      this.onSettingChangeCallback('focusmode', value);
    }

    return result;
  }

  /**
   * Check if a setting is adjustable in the current mode
   * Uses the brand's modeCapabilities matrix from cameraBrands
   */
  isSettingAdjustable(mode: string, setting: StandardSetting): boolean {
    return isSettingAdjustable(mode, setting, this.brand);
  }
}

// Singleton instance for global access
let globalService: CameraSettingsService | null = null;

export function getCameraSettingsService(config?: CameraSettingsServiceConfig): CameraSettingsService {
  if (!globalService && !config) {
    globalService = new CameraSettingsService();
  }
  if (config) {
    globalService = new CameraSettingsService(config);
  }
  return globalService!;
}

export function resetCameraSettingsService(): void {
  globalService = null;
}

export default CameraSettingsService;
