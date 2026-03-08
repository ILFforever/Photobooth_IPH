/*
 * camera_config.h - Camera configuration operations interface
 *
 * Public interface for getting/setting camera configuration values.
 */

#ifndef CAMERA_CONFIG_H
#define CAMERA_CONFIG_H

#include <gphoto2/gphoto2.h>
#include <stddef.h>
#include "camera-brand.h"

/*
 * Get a single camera config value by name
 * Returns the value as a string (must be freed by caller) or NULL on error
 *
 * First tries gp_camera_get_single_config (fast path), then falls back to
 * full config tree search (slow path) for widgets not accessible via single config.
 */
char *get_single_config_value(Camera *camera, GPContext *context, const char *setting_name);

/*
 * Get camera settings (ISO, aperture, shutter, etc.) as JSON
 * Returns 0 on success with status_json populated, -1 on error
 *
 * Parameters:
 *   camera - gphoto2 camera handle
 *   context - gphoto2 context
 *   status_json - output buffer for JSON result
 *   max_size - size of status_json buffer
 *   current_brand - detected camera brand for widget name mapping
 */
int get_camera_status_json(Camera *camera, GPContext *context, char *status_json, size_t max_size, CameraBrand current_brand);

/*
 * Write full camera config JSON to CONFIG_RESPONSE_FILE
 * Output format: {"iso":{"value":"800","label":"ISO Speed","type":"radio","choices":[...]}, ...}
 *
 * Uses atomic write (temp file + rename) to avoid partial reads.
 * Returns 0 on success, -1 on error.
 *
 * Parameters:
 *   camera - gphoto2 camera handle
 *   context - gphoto2 context
 *   current_brand - detected camera brand (unused internally but kept for API consistency)
 */
int write_full_config_json(Camera *camera, GPContext *context, CameraBrand current_brand);

/*
 * Set a single camera config value and write result to CONFIG_RESPONSE_FILE
 * json_input format: {"setting":"iso","value":"800"}
 *
 * Returns 0 on success, -1 on error.
 *
 * Parameters:
 *   camera - gphoto2 camera handle
 *   context - gphoto2 context
 *   json_input - JSON string containing "setting" and "value" keys
 */
int set_config_and_write_response(Camera *camera, GPContext *context, const char *json_input);

#endif /* CAMERA_CONFIG_H */
