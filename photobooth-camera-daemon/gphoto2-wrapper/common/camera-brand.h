#ifndef CAMERA_BRAND_H
#define CAMERA_BRAND_H

/* Camera brand enumeration */
typedef enum {
    BRAND_UNKNOWN,
    BRAND_FUJI,
    BRAND_CANON,
    BRAND_NIKON,
    BRAND_SONY,
    BRAND_PANASONIC,
    BRAND_OLYMPUS,
} CameraBrand;

/* Brand-specific widget names */
typedef struct {
    const char *aperture;
    const char *shutter;
    const char *iso;
    const char *ev;
    const char *wb;
    const char *focus;
    const char *metering;
    const char *mode;
    const char *battery;
    const char *serial;
    const char *deviceversion;
    const char *lens;
} BrandWidgets;

/* Detect camera brand from a string (model name or manufacturer) */
CameraBrand detect_camera_brand(const char *str);

/* Get widget names for a given brand */
const BrandWidgets* get_widgets_for_brand(CameraBrand brand);

/* Map Canon raw ISO values to display values */
const char* map_canon_iso_value(const char *raw_value);

#endif /* CAMERA_BRAND_H */
