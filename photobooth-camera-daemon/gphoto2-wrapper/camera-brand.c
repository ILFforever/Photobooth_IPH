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
 * Canon uses hex values like "0001" for ISO 100, "0002" for ISO 200, etc.
 * gphoto2 sometimes returns these as "Unknown value XXXX".
 */
const char* map_canon_iso_value(const char *raw_value) {
    if (!raw_value) return NULL;

    /* Check if it's an "Unknown value" format from gphoto2 */
    if (strncmp(raw_value, "Unknown value ", 14) == 0) {
        const char *hex_str = raw_value + 14;

        /* Parse hex value */
        unsigned int hex_val = 0;
        if (sscanf(hex_str, "%x", &hex_val) == 1) {
            /* Canon ISO mapping (hex to ISO) */
            switch (hex_val) {
                case 0x0000: return "Auto";
                case 0x0001: return "100";
                case 0x0002: return "200";
                case 0x0003: return "400";
                case 0x0004: return "400";
                case 0x0005: return "800";
                case 0x0006: return "800";
                case 0x0007: return "1600";
                case 0x0008: return "1600";
                case 0x0009: return "3200";
                case 0x000A: return "3200";
                case 0x000B: return "6400";
                case 0x000C: return "6400";
                case 0x000D: return "12800";
                case 0x000E: return "12800";
                case 0x000F: return "25600";
                case 0x0010: return "25600";
                case 0x0011: return "51200";
                case 0x0012: return "51200";
                case 0x0013: return "102400";
                case 0x0014: return "102400";
                case 0x0015: return "204800";
                case 0x0016: return "204800";
                case 0x0017: return "409600";
                case 0x0018: return "409600";
            }
        }
    }

    /* If not an unknown value or not mapped, return as-is */
    return raw_value;
}
