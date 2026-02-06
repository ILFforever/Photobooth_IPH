/**
 * Camera Settings Service
 *
 * Centralized service for all camera setting changes.
 * Handles brand-specific mode names, setting names, and API calls.
 */

import type { CameraBrand, StandardMode, StandardSetting } from './cameraBrands';
import { detectBrand, normalizeMode, getBrandModeName, isSettingAdjustable } from './cameraBrands';

const API_BASE = 'http://localhost:58321';

/**
 * Fuji EV value mapping (widget "5010" uses ×1000 format with 1/3 EV steps)
 * Maps display value (e.g., "-2.3") to camera value (e.g., "-2333")
 */
const FUJI_EV_MAP: Record<string, string> = {
  '-5.0': '-5000', '-4.7': '-4667', '-4.3': '-4333', '-4.0': '-4000',
  '-3.7': '-3667', '-3.3': '-3333', '-3.0': '-3000', '-2.7': '-2667',
  '-2.3': '-2333', '-2.0': '-2000', '-1.7': '-1667', '-1.3': '-1333',
  '-1.0': '-1000', '-0.7': '-667', '-0.3': '-333', '0.0': '0',
  '+0.3': '333', '+0.7': '667', '+1.0': '1000', '+1.3': '1333',
  '+1.7': '1667', '+2.0': '2000', '+2.3': '2333', '+2.7': '2667',
  '+3.0': '3000', '+3.3': '3333', '+3.7': '3667', '+4.0': '4000',
  '+4.3': '4333', '+4.7': '4667', '+5.0': '5000',
};

// Reverse map for converting camera values to display values
const FUJI_EV_REVERSE_MAP: Record<string, string> = Object.fromEntries(
  Object.entries(FUJI_EV_MAP).map(([display, camera]) => [camera, display])
);

/**
 * Fuji ISO value mapping
 * Maps display value (e.g., "Auto 1") to camera value (e.g., "-1")
 */
const FUJI_ISO_MAP: Record<string, string> = {
  'Auto 1': '-1',
  'Auto 2': '-2',
  'Auto 3': '-3',
};

// Reverse map for converting camera ISO values to display values
const FUJI_ISO_REVERSE_MAP: Record<string, string> = Object.fromEntries(
  Object.entries(FUJI_ISO_MAP).map(([display, camera]) => [camera, display])
);

export type ShutterSpeedValue = string; // e.g., "1/125", "0.5s"
export type ApertureValue = string; // e.g., "f/2.8", "2.8"
export type IsoValue = string; // e.g., "100", "800"
export type EvValue = string; // e.g., "-1.0", "+2.0"
export type WbValue = string; // e.g., "Auto", "Daylight"
export type MeteringValue = 'Evaluative' | 'Partial' | 'Spot' | 'Center-Weighted';
export type ModeValue = 'P' | 'A' | 'S' | 'M';
export type FocusModeValue = 'AF-S' | 'AF-C' | 'MF';

/** Export Fuji EV and ISO maps for use in UI components */
export { FUJI_EV_MAP, FUJI_EV_REVERSE_MAP, FUJI_ISO_MAP, FUJI_ISO_REVERSE_MAP };

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

    // Get brand-specific aperture setting name
    const settingName = this.brand.quirks.apertureSetting || 'f-number';

    // Normalize value based on brand
    // Canon uses plain numbers (e.g., "5.6"), Fuji/others use "f/5.6" format
    let normalizedValue: string;
    if (this.brand.id === 'canon') {
      // Canon: strip "f/" prefix if present, send plain number
      normalizedValue = value.startsWith('f/') ? value.slice(2) : value;
    } else {
      // Fuji and others: ensure "f/" prefix
      normalizedValue = value.startsWith('f/') ? value : `f/${value}`;
    }

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
   * For Fuji cameras, uses widget "5010" with mapped EV values
   * For Canon/others, uses standard exposurecompensation with direct values
   */
  async setEv(value: EvValue): Promise<boolean> {
    console.log(`[CameraSettingsService] setEv: ${value}`);

    const evSetting = this.brand.quirks.evSetting || 'exposurecompensation';
    let sendValue = value;

    // Only Fuji needs special EV value mapping (×1000 format)
    if (this.brand.id === 'fuji') {
      const mapped = FUJI_EV_MAP[value];
      if (mapped) {
        sendValue = mapped;
        console.log(`[CameraSettingsService] Fuji EV conversion: ${value} -> ${sendValue}`);
      } else {
        console.warn(`[CameraSettingsService] No Fuji EV map entry for ${value}, sending as-is`);
      }
    }
    // Canon and others use the value directly (e.g., "0", "-1", "+1")

    const result = await this.sendSetting(evSetting, sendValue);

    if (result && this.onSettingChangeCallback) {
      this.onSettingChangeCallback('ev', value);
    }

    return result;
  }

  /**
   * Set white balance
   * Maps display labels to camera-specific values
   */
  async setWhiteBalance(value: WbValue): Promise<boolean> {
    console.log(`[CameraSettingsService] setWhiteBalance: ${value}`);

    // Map display labels to camera-specific values (must match exact gphoto2 choices)
    let wbMap: Record<string, string>;

    switch (this.brand.id) {
      case 'fuji':
        // Fuji: Map display labels to camera values (reverse of whiteBalanceLabels)
        wbMap = {
          'White Priority': 'Unknown value 8020',
          'Auto': 'Automatic',
          'Ambient Priority': 'Unknown value 8021',
          'C1': 'Preset Custom 1',
          'C2': 'Preset Custom 2',
          'C3': 'Preset Custom 3',
          'K': 'Choose Color Temperature',
          'Daylight': 'Daylight',
          'Shade': 'Shade',
          'Fluorescent 1': 'Fluorescent Lamp 1',
          'Fluorescent 2': 'Fluorescent Lamp 2',
          'Fluorescent 3': 'Fluorescent Lamp 3',
          'Incandescent': 'Tungsten',
          'Underwater': 'Unknown value 0008',
        };
        break;
      case 'canon':
        wbMap = {
          'Auto': 'Auto',
          'Daylight': 'Daylight',
          'Shade': 'Shadow',
          'Cloudy': 'Cloudy',
          'Tungsten': 'Tungsten',
          'Fluorescent': 'Fluorescent',
          'Flash': 'Flash',
          'Custom': 'Manual',
          'K': 'Color Temperature',
          'AWB White': 'AWB White',
        };
        break;
      default:
        // Generic fallback: use value as-is
        wbMap = {};
        break;
    }

    // Map the display value to camera value, or use as-is if not in map
    const cameraValue = wbMap[value] || value;
    console.log(`[CameraSettingsService] WB mapping for ${this.brand.name}: "${value}" -> "${cameraValue}"`);

    const result = await this.sendSetting('whitebalance', cameraValue);

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

    // Get brand-specific metering setting name
    const meteringSetting = this.brand.quirks.meteringSetting || 'meteringmode';

    // Map standard names to camera-specific metering modes (must match exact gphoto2 choices)
    let meteringMap: Record<MeteringValue, string>;

    switch (this.brand.id) {
      case 'fuji':
        meteringMap = {
          'Evaluative': 'Multi Spot',
          'Partial': 'Center Spot',
          'Spot': 'Average',
          'Center-Weighted': 'Center Weighted',
        };
        break;
      case 'canon':
        meteringMap = {
          'Evaluative': 'Evaluative metering',
          'Partial': 'Partial metering',
          'Spot': 'Spot metering',
          'Center-Weighted': 'Center-weighted average',
        };
        break;
      default:
        // Generic fallback
        meteringMap = {
          'Evaluative': 'Evaluative',
          'Partial': 'Partial',
          'Spot': 'Spot',
          'Center-Weighted': 'Center-weighted',
        };
    }

    const result = await this.sendSetting(meteringSetting, meteringMap[value]);

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

    let focusModeMap: Record<FocusModeValue, string>;

    switch (this.brand.id) {
      case 'fuji':
        focusModeMap = {
          'AF-S': 'Single-Servo AF',
          'AF-C': 'Continuous-Servo AF',
          'MF': 'Manual',
        };
        break;
      case 'canon':
        focusModeMap = {
          'AF-S': 'One Shot',
          'AF-C': 'AI Servo',
          'MF': 'Manual',
        };
        break;
      default:
        focusModeMap = {
          'AF-S': 'AF-S',
          'AF-C': 'AF-C',
          'MF': 'Manual',
        };
    }

    const result = await this.sendSetting('focusmode', focusModeMap[value]);

    if (result && this.onSettingChangeCallback) {
      this.onSettingChangeCallback('focusmode', value);
    }

    return result;
  }

  /**
   * Convert camera focus mode value to standard display value
   */
  convertFocusModeToDisplay(cameraValue: string): FocusModeValue {
    if (this.brand.id === 'fuji') {
      const fujiMap: Record<string, FocusModeValue> = {
        'Single-Servo AF': 'AF-S',
        'Continuous-Servo AF': 'AF-C',
        'Manual': 'MF',
      };
      return fujiMap[cameraValue] || 'AF-S';
    }

    if (this.brand.id === 'canon') {
      const canonMap: Record<string, FocusModeValue> = {
        'One Shot': 'AF-S',
        'AI Servo': 'AF-C',
        'AI Focus': 'AF-C', // AI Focus is a hybrid, map to AF-C
        'Manual': 'MF',
      };
      return canonMap[cameraValue] || 'AF-S';
    }

    // Generic fallback
    const genericMap: Record<string, FocusModeValue> = {
      'AF-S': 'AF-S',
      'AF-C': 'AF-C',
      'MF': 'MF',
      'Manual': 'MF',
    };
    return genericMap[cameraValue] || 'AF-S';
  }

  /**
   * Check if a setting is adjustable in the current mode
   * Uses the brand's modeCapabilities matrix from cameraBrands
   */
  isSettingAdjustable(mode: string, setting: StandardSetting): boolean {
    return isSettingAdjustable(mode, setting, this.brand);
  }

  /**
   * Map a camera EV value to an index in the provided options array
   * Handles brand-specific EV conversions and finds closest match if needed
   *
   * @param cameraEv - The EV value from the camera (e.g., "-0.333", "-333", "0")
   * @param options - The available EV display options (e.g., ["-0.3", "0.0", "+0.3"])
   * @returns The index of the matching option, or -1 if no match found
   */
  mapEvToIndex(cameraEv: string, options: string[]): number {
    if (!cameraEv || options.length === 0) return -1;

    let displayEv: string;

    if (this.brand.id === 'fuji') {
      // Fuji: Normalize camera EV to integer key format (e.g., "-0.333" -> "-333")
      let evKey = cameraEv;
      if (cameraEv.includes('.') && !cameraEv.includes(':')) {
        const num = parseFloat(cameraEv);
        evKey = Math.round(num * 1000).toString();
      }
      // Convert to display value using Fuji map (e.g., "-333" -> "-0.3")
      displayEv = FUJI_EV_REVERSE_MAP[evKey] || cameraEv;
    } else {
      // Canon and others: EV values are already in display format (e.g., "0", "-1", "+1")
      displayEv = cameraEv;
    }

    // Find exact match in options
    const exactIdx = options.findIndex(opt => opt === displayEv);
    if (exactIdx !== -1) {
      return exactIdx;
    }

    // Fallback - find closest numeric match
    const cameraEvNum = parseFloat(cameraEv);
    if (!isNaN(cameraEvNum)) {
      let closestIdx = -1;
      let closestDiff = Infinity;

      for (let i = 0; i < options.length; i++) {
        const optNum = parseFloat(options[i].replace('+', ''));
        if (!isNaN(optNum)) {
          const diff = Math.abs(cameraEvNum - optNum);
          if (diff < closestDiff) {
            closestDiff = diff;
            closestIdx = i;
          }
        }
      }

      // Only return closest match if within reasonable tolerance (1/3 EV)
      if (closestIdx !== -1 && closestDiff < 0.4) {
        console.log(`[CameraSettingsService] EV closest match: ${cameraEv} -> ${options[closestIdx]} (diff: ${closestDiff.toFixed(3)})`);
        return closestIdx;
      }
    }

    console.warn(`[CameraSettingsService] EV value "${cameraEv}" could not be mapped to options`);
    return -1;
  }

  /**
   * Map an index from EV options back to the camera value
   * For sending EV commands to the camera
   */
  mapIndexToEv(index: number, options: string[]): string | null {
    if (index < 0 || index >= options.length) return null;

    const displayValue = options[index];

    if (this.brand.id === 'fuji') {
      // Fuji: Convert display value to ×1000 format
      return FUJI_EV_MAP[displayValue] || displayValue;
    }
    // Canon and others: Use display value directly
    return displayValue;
  }

  /**
   * Convert camera EV choices to display format
   * Fuji: converts from ×1000 format (e.g., "-5000" -> "-5.0")
   * Canon/others: returns values as-is (already in display format)
   */
  convertEvChoicesToDisplay(choices: string[]): string[] {
    if (this.brand.id === 'fuji') {
      return choices.map((v: string) => {
        // Use the shared map for accurate conversion
        const mapped = FUJI_EV_REVERSE_MAP[v];
        if (mapped) return mapped;
        // Fallback for unknown values: divide by 1000 and format
        const num = parseInt(v, 10);
        const ev = num / 1000;
        const formatted = ev > 0 ? `+${ev.toFixed(1)}` : ev.toFixed(1);
        return formatted;
      });
    }
    // Canon and others: EV choices are already in display format
    return choices;
  }

  /**
   * Set EV using brand-specific handling
   * Converts display value to camera format and uses the correct setting name
   */
  setEvFromDisplay(displayValue: string): Promise<boolean> {
    console.log(`[CameraSettingsService] setEvFromDisplay: ${displayValue}`);

    const evSetting = this.brand.quirks.evSetting || 'exposurecompensation';
    let mappedValue: string;

    if (this.brand.id === 'fuji') {
      // Fuji: Convert display value to ×1000 format
      mappedValue = FUJI_EV_MAP[displayValue] || displayValue;
      console.log(`[CameraSettingsService] Fuji EV conversion: ${displayValue} -> ${mappedValue} (setting: ${evSetting})`);
    } else {
      // Canon and others: Use display value directly
      mappedValue = displayValue;
      console.log(`[CameraSettingsService] Setting EV: ${displayValue} (setting: ${evSetting})`);
    }

    return this.sendSetting(evSetting, mappedValue);
  }

  /**
   * Get the EV setting name for the current brand
   */
  getEvSettingName(): string {
    return this.brand.quirks.evSetting || 'exposurecompensation';
  }

  /**
   * Convert camera ISO choices to display format
   * Fuji: converts "-1", "-2", "-3" to "Auto 1", "Auto 2", "Auto 3"
   * Canon/others: returns values as-is (already user-friendly)
   */
  convertIsoChoicesToDisplay(choices: string[]): string[] {
    if (this.brand.id === 'fuji') {
      return choices.map((v: string) => {
        // Use the Fuji ISO reverse map for Auto ISO values
        const mapped = FUJI_ISO_REVERSE_MAP[v];
        if (mapped) return mapped;
        // Return numeric values as-is
        return v;
      });
    }
    // Canon and others: ISO choices are already in display format ("Auto", "100", etc.)
    return choices;
  }

  /**
   * Convert display ISO value to camera value
   * For sending ISO commands to the camera
   */
  convertIsoToCamera(displayValue: string): string {
    if (this.brand.id === 'fuji') {
      // Fuji: Convert "Auto 1" etc. to "-1" etc.
      return FUJI_ISO_MAP[displayValue] || displayValue;
    }
    // Canon and others: Use display value directly
    return displayValue;
  }

  /**
   * Convert camera ISO value to display value
   */
  convertIsoToDisplay(cameraValue: string): string {
    if (this.brand.id === 'fuji') {
      return FUJI_ISO_REVERSE_MAP[cameraValue] || cameraValue;
    }
    // Canon and others: Camera value is already display-friendly
    return cameraValue;
  }

  /**
   * Convert camera metering value to display value
   * Handles brand-specific conversions
   */
  convertMeteringToDisplay(cameraValue: string): string {
    if (this.brand.id === 'fuji') {
      const fujiMeteringMap: Record<string, string> = {
        'Multi Spot': 'Evaluative',
        'Center Spot': 'Partial',
        'Average': 'Spot',
        'Center Weighted': 'Center-Weighted',
      };
      return fujiMeteringMap[cameraValue] || cameraValue;
    }

    if (this.brand.id === 'canon') {
      const canonMeteringMap: Record<string, string> = {
        'Evaluative metering': 'Evaluative',
        'Partial metering': 'Partial',
        'Spot metering': 'Spot',
        'Center-weighted average': 'Center-Weighted',
      };
      return canonMeteringMap[cameraValue] || cameraValue;
    }

    return cameraValue;
  }

  /**
   * Convert camera white balance value to display value
   * Handles brand-specific conversions using whiteBalanceLabels
   */
  convertWhiteBalanceToDisplay(cameraValue: string): string {
    const labelMap = this.brand.quirks.whiteBalanceLabels;
    if (labelMap && labelMap[cameraValue]) {
      return labelMap[cameraValue];
    }
    return cameraValue;
  }

  /**
   * Get the metering setting name for the current brand
   */
  getMeteringSettingName(): string {
    return this.brand.quirks.meteringSetting || 'meteringmode';
  }

  /**
   * Convert camera white balance choices to display labels
   * Uses brand-specific mappings from cameraBrands.ts
   */
  convertWbChoicesToDisplay(choices: string[]): string[] {
    const labelMap = this.brand.quirks.whiteBalanceLabels;
    if (!labelMap) {
      return choices;
    }
    return choices.map(v => labelMap[v] || v);
  }

  /**
   * Convert display white balance label back to camera value
   */
  convertWbToCamera(displayLabel: string): string {
    const labelMap = this.brand.quirks.whiteBalanceLabels;
    if (!labelMap) {
      return displayLabel;
    }
    // Find the camera value that maps to this display label
    for (const [cameraValue, label] of Object.entries(labelMap)) {
      if (label === displayLabel) {
        return cameraValue;
      }
    }
    return displayLabel;
  }

  /**
   * Convert camera white balance value to display label
   */
  convertWbToDisplay(cameraValue: string): string {
    const labelMap = this.brand.quirks.whiteBalanceLabels;
    if (!labelMap) {
      return cameraValue;
    }
    return labelMap[cameraValue] || cameraValue;
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
