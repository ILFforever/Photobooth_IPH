#include "camera-brand.h"
#include <stdio.h>
#include <string.h>
#include <ctype.h>

/* Brand-specific widget names */
/* Note: For Canon, widgets are nested (e.g., "imgsettings.iso", "capturesettings.aperture") */
static const BrandWidgets fuji_widgets = {
    .aperture = "f-number",
    .shutter = "shutterspeed",
    .iso = "iso",
    .ev = "5010",
    .wb = "whitebalance",
    .focus = "focusmode",
    .metering = "exposuremetermode",
    .mode = "expprogram",
    .battery = "d36b",
};

/* Canon widgets: use simple names, not dotted paths.
 * The recursive widget search will find them anywhere in the tree. */
static const BrandWidgets canon_widgets = {
    .aperture = "aperture",      // Under capturesettings
    .shutter = "shutterspeed",   // Under capturesettings
    .iso = "iso",                // Under imgsettings
    .ev = "exposurecompensation", // Under capturesettings
    .wb = "whitebalance",        // Under imgsettings
    .focus = "focusmode",        // Under capturesettings
    .metering = "meteringmode",  // Under capturesettings
    .mode = "autoexposuremode",  // Under capturesettings
    .battery = "5001",           // Under other (PTP property)
};

static const BrandWidgets generic_widgets = {
    .aperture = "f-number",
    .shutter = "shutterspeed",
    .iso = "iso",
    .ev = "exposurecompensation",
    .wb = "whitebalance",
    .focus = "focusmode",
    .metering = "meteringmode",
    .mode = "expprogram",
    .battery = "batterylevel",
};

/* Detect camera brand from a string (model name or manufacturer) */
CameraBrand detect_camera_brand(const char *str) {
    if (!str) return BRAND_UNKNOWN;

    /* Convert to lowercase for case-insensitive matching */
    char lower[256];
    snprintf(lower, sizeof(lower), "%s", str);
    for (char *p = lower; *p; p++) {
        if (*p >= 'A' && *p <= 'Z') *p += 32;
    }

    /* Check for Fuji */
    if (strstr(lower, "fuji") || strstr(lower, "x-") ||
        strstr(lower, "gfx") || strstr(lower, "x-t") ||
        strstr(lower, "fujifilm")) {
        return BRAND_FUJI;
    }

    /* Check for Canon */
    if (strstr(lower, "canon") || strstr(lower, "eos") ||
        strstr(lower, "rebel") || strstr(lower, "powershot")) {
        return BRAND_CANON;
    }

    /* Check for Nikon */
    if (strstr(lower, "nikon") || strstr(lower, "coolpix")) {
        return BRAND_NIKON;
    }

    /* Check for Sony */
    if (strstr(lower, "sony") || strstr(lower, "alpha")) {
        return BRAND_SONY;
    }

    /* Check for Panasonic */
    if (strstr(lower, "panasonic") || strstr(lower, "lumix")) {
        return BRAND_PANASONIC;
    }

    /* Check for Olympus */
    if (strstr(lower, "olympus") || strstr(lower, "om-")) {
        return BRAND_OLYMPUS;
    }

    return BRAND_UNKNOWN;
}

/* Get widget names for a given brand */
const BrandWidgets* get_widgets_for_brand(CameraBrand brand) {
    switch (brand) {
        case BRAND_FUJI:     return &fuji_widgets;
        case BRAND_CANON:    return &canon_widgets;
        default:             return &generic_widgets;
    }
}

/*
 * Map Canon raw ISO values to display values.
 * Canon EOS cameras use PTP ISO speed codes over USB (EOS_ISOSpeed property).
 * gphoto2 may return these as "Unknown value XXXX" on unsupported models.
 *
 * Canon ISO PTP encoding (EOS_ISOSpeed, 0x9203):
 *   0x0000 = Auto
 *   0x0028 = ISO 6 (extended low)
 *   0x0030 = ISO 12
 *   0x0038 = ISO 25
 *   0x0040 = ISO 50
 *   0x0048 = ISO 100   (base value, each full stop adds 8)
 *   0x004B = ISO 125   (1/3 stop above 100)
 *   0x004F = ISO 160   (2/3 stop above 100)
 *   0x0050 = ISO 200
 *   0x0053 = ISO 250
 *   0x0057 = ISO 320
 *   0x0058 = ISO 400
 *   0x005B = ISO 500
 *   0x005F = ISO 640
 *   0x0060 = ISO 800
 *   0x0063 = ISO 1000
 *   0x0067 = ISO 1250
 *   0x0068 = ISO 1600
 *   0x006B = ISO 2000
 *   0x006F = ISO 2500
 *   0x0070 = ISO 3200
 *   0x0073 = ISO 4000
 *   0x0077 = ISO 5000
 *   0x0078 = ISO 6400
 *   0x0080 = ISO 12800
 *   0x0088 = ISO 25600
 *   0x0090 = ISO 51200
 *   0x0098 = ISO 102400
 *   0x00A0 = ISO 204800 (extended high, camera-dependent)
 *
 * Note: Most modern Canon cameras via gphoto2 return ISO as plain text
 * (e.g., "100", "800", "Auto") — this function handles the rare "Unknown
 * value XXXX" format seen on some older or partially-supported models.
 */
const char* map_canon_iso_value(const char *raw_value) {
    if (!raw_value) return NULL;

    /* Check if it's an "Unknown value" format from gphoto2 */
    if (strncmp(raw_value, "Unknown value ", 14) == 0) {
        const char *hex_str = raw_value + 14;

        /* Parse hex value */
        unsigned int hex_val = 0;
        if (sscanf(hex_str, "%x", &hex_val) == 1) {
            /* Canon EOS ISO PTP encoding */
            switch (hex_val) {
                case 0x0000: return "Auto";
                case 0x0028: return "6";
                case 0x0030: return "12";
                case 0x0038: return "25";
                case 0x0040: return "50";
                case 0x0048: return "100";
                case 0x004B: return "125";
                case 0x004F: return "160";
                case 0x0050: return "200";
                case 0x0053: return "250";
                case 0x0057: return "320";
                case 0x0058: return "400";
                case 0x005B: return "500";
                case 0x005F: return "640";
                case 0x0060: return "800";
                case 0x0063: return "1000";
                case 0x0067: return "1250";
                case 0x0068: return "1600";
                case 0x006B: return "2000";
                case 0x006F: return "2500";
                case 0x0070: return "3200";
                case 0x0073: return "4000";
                case 0x0077: return "5000";
                case 0x0078: return "6400";
                case 0x0080: return "12800";
                case 0x0088: return "25600";
                case 0x0090: return "51200";
                case 0x0098: return "102400";
                case 0x00A0: return "204800";
            }
        }
    }

    /* Not an "Unknown value" format or no mapping found — return as-is */
    return raw_value;
}
