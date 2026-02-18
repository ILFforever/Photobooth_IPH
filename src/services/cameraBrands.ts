/**
 * Camera Brand Quirks Framework
 *
 * Different camera brands have different naming conventions and behaviors.
 * This framework normalizes these differences.
 */

export type StandardMode = 'P' | 'A' | 'S' | 'M';

// Standard setting names - can be extended as needed
export type StandardSetting = 'shutter' | 'aperture' | 'iso' | 'ev' | 'wb' | 'metering' | 'mode' | 'focusmode';

export interface CameraBrand {
  id: string;
  name: string;
  // Map brand-specific mode names to standard mode names
  modeMap: Record<string, StandardMode>;
  // Map brand-specific setting names to standard setting names
  settingMap: Record<string, StandardSetting>;
  // Which settings are adjustable in each mode (true = adjustable by user, false = camera controls)
  modeCapabilities: Record<StandardMode, Record<StandardSetting, boolean>>;
  // Any other brand-specific quirks
  quirks: {
    // Some brands use different setting names for the same thing
    apertureSetting?: string; // e.g., 'f-number' instead of 'aperture'
    // Some brands report shutter speed differently
    shutterSpeedFormat?: 'fraction' | 'decimal';
    // EV compensation setting name and value format
    evSetting?: string; // e.g., '5010' for Fuji PTP property (uses mapped EV values)
    // Metering mode setting name
    meteringSetting?: string;
    // Shooting mode setting name (gphoto2 widget name to write when changing mode)
    modeSetting?: string; // e.g., 'autoexposuremode' for Canon, 'expprogram' for Fuji
    // Available metering mode choices for this brand
    meteringChoices?: string[];
    // Available focus mode choices for this brand
    focusModeChoices?: string[];
    // White balance display label mappings (cameraValue -> displayLabel)
    // Used to rename camera-reported WB values to user-friendly labels
    whiteBalanceLabels?: Record<string, string>;
  };
}

// Fuji-specific quirks
const FUJI: CameraBrand = {
  id: 'fuji',
  name: 'Fujifilm',
  modeMap: {
    'Action': 'P',
    'Program': 'P',
    'P': 'P',
    'A': 'A',
    'Aperture': 'A',
    'S': 'S',
    'Shutter': 'S',
    'M': 'M',
    'Manual': 'M',
  },
  settingMap: {},
  modeCapabilities: {
    'P': { shutter: false, aperture: false, iso: true, ev: true, wb: true, metering: true, mode: true, focusmode: true },
    'A': { shutter: false, aperture: true, iso: true, ev: true, wb: true, metering: true, mode: true, focusmode: true },
    'S': { shutter: true, aperture: false, iso: true, ev: true, wb: true, metering: true, mode: true, focusmode: true },
    'M': { shutter: true, aperture: true, iso: true, ev: false, wb: true, metering: true, mode: true, focusmode: true },
  },
  quirks: {
    apertureSetting: 'f-number',
    evSetting: '5010', // Fuji uses PTP property 5010 for Exposure Bias Compensation (uses mapped EV values)
    meteringSetting: 'exposuremetermode',
    focusModeChoices: ['Manual', 'Single-Servo AF', 'Continuous-Servo AF'],
    whiteBalanceLabels: {
      'Unknown value 8020': 'White Priority',
      'Unknown value 8021': 'Ambient Priority',
      'Automatic': 'Auto',
      'Daylight': 'Daylight',
      'Shade': 'Shade',
      'Choose Color Temperature': 'K',
      'Fluorescent Lamp 1': 'Fluorescent 1',
      'Fluorescent Lamp 2': 'Fluorescent 2',
      'Fluorescent Lamp 3': 'Fluorescent 3',
      'Tungsten': 'Incandescent',
      'Unknown value 0008': 'Underwater',
      'Preset Custom 1': 'C1',
      'Preset Custom 2': 'C2',
      'Preset Custom 3': 'C3',
    },
  },
};

// Canon-specific quirks
const CANON: CameraBrand = {
  id: 'canon',
  name: 'Canon',
  modeMap: {
    // Standard PASM — use exact gphoto2 autoexposuremode strings as primary keys
    'P': 'P',
    'TV': 'S',               // Canon Shutter Priority (gphoto2 string: "TV")
    'AV': 'A',               // Canon Aperture Priority (gphoto2 string: "AV")
    'Manual': 'M',           // Canon Manual (gphoto2 string: "Manual")
    'Bulb': 'M',             // Bulb long-exposure maps to M
    // Flexible-priority (Canon EOS R/RP/R5/R6 etc.)
    'Fv': 'P',               // Flexible Value
    // Depth of field AE (older Canon bodies)
    'DEP': 'P',
    'A_DEP': 'P',
    // Custom / saved shooting modes
    'Custom': 'M',           // gphoto2: "Custom"
    'Lock': 'P',             // AE Lock mode
    // Fully-automatic and scene modes — all map to P
    'Green': 'P',            // Scene Intelligent Auto (green zone)
    'Auto': 'P',
    'CA': 'P',               // Creative Auto
    'SCN': 'P',              // Scene mode selector
    'Sports': 'P',
    'Portrait': 'P',
    'Landscape': 'P',
    'Closeup': 'P',          // gphoto2 string: "Closeup" (not "Close-Up")
    'Night Portrait': 'P',
    'Handheld Night Scene': 'P',
    'HDR Backlight Control': 'P',
    'Flash Off': 'P',        // gphoto2 string: "Flash Off" (not "FlashOff")
    'Hybrid Auto': 'P',
    'Self Portrait': 'P',
    'Food': 'P',
    'Panning': 'P',
    'Smooth skin': 'P',
    // Creative filters — map to P (camera controls everything)
    'Grainy B/W': 'P',
    'Soft focus': 'P',
    'Toy camera effect': 'P',
    'Fish-eye effect': 'P',
    'Water painting effect': 'P',
    'Miniature effect': 'P',
    'HDR art standard': 'P',
    'HDR art vivid': 'P',
    'HDR art bold': 'P',
    'HDR art embossed': 'P',
  },
  settingMap: {},
  modeCapabilities: {
    // P: camera selects shutter + aperture automatically (program shift exists but not settable per-value)
    'P': { shutter: false, aperture: false, iso: true, ev: true, wb: true, metering: true, mode: true, focusmode: true },
    'A': { shutter: false, aperture: true,  iso: true, ev: true, wb: true, metering: true, mode: true, focusmode: true },
    'S': { shutter: true,  aperture: false, iso: true, ev: true, wb: true, metering: true, mode: true, focusmode: true },
    'M': { shutter: true,  aperture: true,  iso: true, ev: false, wb: true, metering: true, mode: true, focusmode: true },
  },
  quirks: {
    apertureSetting: 'aperture',          // Canon uses 'aperture' (under capturesettings), not 'f-number'
    evSetting: 'exposurecompensation',
    meteringSetting: 'meteringmode',
    modeSetting: 'autoexposuremode',      // Canon mode widget (not 'expprogram' like Fuji)
    // gphoto2 Canon AF mode choices (exact strings from gphoto2 focusmode widget)
    focusModeChoices: ['One Shot', 'AI Servo', 'AI Focus'],
    // Canon white balance: cameraValue (gphoto2 string) -> display label
    whiteBalanceLabels: {
      'Auto': 'Auto',
      'AWB White': 'AWB White',
      'Daylight': 'Daylight',
      'Shadow': 'Shade',
      'Cloudy': 'Cloudy',
      'Tungsten': 'Tungsten',
      'Fluorescent': 'Fluorescent',
      'Flash': 'Flash',
      'Manual': 'Custom',          // Custom WB (grey card)
      'Manual2': 'Custom 2',
      'Manual3': 'Custom 3',
      'Color Temperature': 'K',    // Kelvin
    },
  },
};

// Nikon-specific quirks
const NIKON: CameraBrand = {
  id: 'nikon',
  name: 'Nikon',
  modeMap: {
    'P': 'P',
    'Program': 'P',
    'A': 'A',
    'Aperture': 'A',
    'S': 'S',
    'Shutter': 'S',
    'M': 'M',
    'Manual': 'M',
  },
  settingMap: {},
  modeCapabilities: {
    'P': { shutter: true, aperture: true, iso: true, ev: true, wb: true, metering: true, mode: true, focusmode: true },
    'A': { shutter: false, aperture: true, iso: true, ev: true, wb: true, metering: true, mode: true, focusmode: true },
    'S': { shutter: true, aperture: false, iso: true, ev: true, wb: true, metering: true, mode: true, focusmode: true },
    'M': { shutter: true, aperture: true, iso: true, ev: false, wb: true, metering: true, mode: true, focusmode: true },
  },
  quirks: {},
};

// Sony-specific quirks
const SONY: CameraBrand = {
  id: 'sony',
  name: 'Sony',
  modeMap: {
    'P': 'P',
    'Program': 'P',
    'A': 'A',
    'Aperture': 'A',
    'S': 'S',
    'Shutter': 'S',
    'M': 'M',
    'Manual': 'M',
  },
  settingMap: {},
  modeCapabilities: {
    'P': { shutter: true, aperture: true, iso: true, ev: true, wb: true, metering: true, mode: true, focusmode: true },
    'A': { shutter: false, aperture: true, iso: true, ev: true, wb: true, metering: true, mode: true, focusmode: true },
    'S': { shutter: true, aperture: false, iso: true, ev: true, wb: true, metering: true, mode: true, focusmode: true },
    'M': { shutter: true, aperture: true, iso: true, ev: false, wb: true, metering: true, mode: true, focusmode: true },
  },
  quirks: {},
};

// Panasonic-specific quirks
const PANASONIC: CameraBrand = {
  id: 'panasonic',
  name: 'Panasonic',
  modeMap: {
    'P': 'P',
    'Program': 'P',
    'A': 'A',
    'Aperture': 'A',
    'S': 'S',
    'Shutter': 'S',
    'M': 'M',
    'Manual': 'M',
  },
  settingMap: {},
  modeCapabilities: {
    'P': { shutter: true, aperture: true, iso: true, ev: true, wb: true, metering: true, mode: true, focusmode: true },
    'A': { shutter: false, aperture: true, iso: true, ev: true, wb: true, metering: true, mode: true, focusmode: true },
    'S': { shutter: true, aperture: false, iso: true, ev: true, wb: true, metering: true, mode: true, focusmode: true },
    'M': { shutter: true, aperture: true, iso: true, ev: false, wb: true, metering: true, mode: true, focusmode: true },
  },
  quirks: {},
};

// Olympus/OM System-specific quirks
const OLYMPUS: CameraBrand = {
  id: 'olympus',
  name: 'Olympus',
  modeMap: {
    'P': 'P',
    'Program': 'P',
    'A': 'A',
    'Aperture': 'A',
    'S': 'S',
    'Shutter': 'S',
    'M': 'M',
    'Manual': 'M',
  },
  settingMap: {},
  modeCapabilities: {
    'P': { shutter: true, aperture: true, iso: true, ev: true, wb: true, metering: true, mode: true, focusmode: true },
    'A': { shutter: false, aperture: true, iso: true, ev: true, wb: true, metering: true, mode: true, focusmode: true },
    'S': { shutter: true, aperture: false, iso: true, ev: true, wb: true, metering: true, mode: true, focusmode: true },
    'M': { shutter: true, aperture: true, iso: true, ev: false, wb: true, metering: true, mode: true, focusmode: true },
  },
  quirks: {},
};

// Leica-specific quirks
const LEICA: CameraBrand = {
  id: 'leica',
  name: 'Leica',
  modeMap: {
    'P': 'P',
    'Program': 'P',
    'A': 'A',
    'Aperture': 'A',
    'S': 'S',
    'Shutter': 'S',
    'M': 'M',
    'Manual': 'M',
  },
  settingMap: {},
  modeCapabilities: {
    'P': { shutter: true, aperture: true, iso: true, ev: true, wb: true, metering: true, mode: true, focusmode: true },
    'A': { shutter: false, aperture: true, iso: true, ev: true, wb: true, metering: true, mode: true, focusmode: true },
    'S': { shutter: true, aperture: false, iso: true, ev: true, wb: true, metering: true, mode: true, focusmode: true },
    'M': { shutter: true, aperture: true, iso: true, ev: false, wb: true, metering: true, mode: true, focusmode: true },
  },
  quirks: {},
};

// Pentax-specific quirks
const PENTAX: CameraBrand = {
  id: 'pentax',
  name: 'Pentax',
  modeMap: {
    'P': 'P',
    'Program': 'P',
    'Av': 'A', // Pentax also uses Av
    'Aperture Value': 'A',
    'Tv': 'S', // Pentax also uses Tv
    'Time Value': 'S',
    'M': 'M',
    'Manual': 'M',
    'B': 'M', // Bulb mode
    'X': 'M', // X-sync mode
  },
  settingMap: {},
  modeCapabilities: {
    'P': { shutter: true, aperture: true, iso: true, ev: true, wb: true, metering: true, mode: true, focusmode: true },
    'A': { shutter: false, aperture: true, iso: true, ev: true, wb: true, metering: true, mode: true, focusmode: true },
    'S': { shutter: true, aperture: false, iso: true, ev: true, wb: true, metering: true, mode: true, focusmode: true },
    'M': { shutter: true, aperture: true, iso: true, ev: false, wb: true, metering: true, mode: true, focusmode: true },
  },
  quirks: {},
};

// All supported brands
export const CAMERA_BRANDS: CameraBrand[] = [
  FUJI, CANON, NIKON, SONY, PANASONIC, OLYMPUS, LEICA, PENTAX,
];

// Brand lookup by ID
export const BRAND_BY_ID: Record<string, CameraBrand> = CAMERA_BRANDS.reduce(
  (acc, brand) => ({ ...acc, [brand.id]: brand }),
  {}
);

/**
 * Detect camera brand from camera info (manufacturer/model)
 */
export function detectBrand(manufacturer: string, model: string): CameraBrand {
  const lower = (manufacturer || model || '').toLowerCase();

  if (lower.includes('fuji') || lower.includes('fujifilm')) return FUJI;
  if (lower.includes('canon')) return CANON;
  if (lower.includes('nikon')) return NIKON;
  if (lower.includes('sony') || lower.includes('alpha')) return SONY;
  if (lower.includes('panasonic') || lower.includes('lumix')) return PANASONIC;
  if (lower.includes('olympus') || lower.includes('om system')) return OLYMPUS;
  if (lower.includes('leica')) return LEICA;
  if (lower.includes('pentax') || lower.includes('ricoh')) return PENTAX;

  // Default to Fuji as fallback (most common for this project)
  return FUJI;
}

/**
 * Normalize mode name to standard (P, A, S, M)
 */
export function normalizeMode(mode: string, brand: CameraBrand): StandardMode {
  return brand.modeMap[mode] || brand.modeMap[mode.toUpperCase()] || 'M';
}

/**
 * Get display mode name (what to show in UI)
 */
export function getDisplayMode(mode: string, brand: CameraBrand): string {
  return normalizeMode(mode, brand);
}

/**
 * Check if a setting is adjustable in the current mode
 */
export function isSettingAdjustable(
  mode: string,
  setting: StandardSetting | 'mode',
  brand: CameraBrand
): boolean {
  // Mode changes are always allowed (user can switch to any mode)
  if (setting === 'mode') return true;

  const normalizedMode = normalizeMode(mode, brand);
  return brand.modeCapabilities[normalizedMode]?.[setting] ?? true;
}

/**
 * Get the API setting name for aperture (some brands use 'f-number', others 'aperture')
 */
export function getApertureSettingName(brand: CameraBrand): string {
  return brand.quirks.apertureSetting || 'aperture';
}

/**
 * Map standard mode to brand-specific mode name for API calls
 * Returns the first matching mode name from the brand's modeMap
 */
export function getBrandModeName(standardMode: StandardMode, brand: CameraBrand): string {
  // Find the first brand-specific key that maps to this standard mode
  for (const [brandMode, mapped] of Object.entries(brand.modeMap)) {
    if (mapped === standardMode) {
      return brandMode;
    }
  }
  // Fallback to standard mode
  return standardMode;
}
