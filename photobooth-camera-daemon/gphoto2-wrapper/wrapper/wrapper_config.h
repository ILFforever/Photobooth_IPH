/*
 * wrapper_config.h - Config functions
 *
 * Functions for getting and setting camera configuration
 */

#ifndef WRAPPER_CONFIG_H
#define WRAPPER_CONFIG_H

#include <gphoto2/gphoto2.h>

/*
 * Get camera configuration as JSON
 *
 * Retrieves common camera settings like ISO, aperture, shutter speed,
 * white balance, focus mode, etc.
 *
 * Parameters:
 *   camera_index - Index of camera to use
 *
 * Outputs JSON with all found settings and their values/labels/types
 */
void get_config(int camera_index);

/*
 * Set camera configuration from JSON
 *
 * Parameters:
 *   json_config - JSON string with "setting" and "value" keys
 *                 Example: {"setting":"iso","value":"800"}
 *   camera_index - Index of camera to use
 *
 * Outputs JSON indicating success or failure
 */
void set_config(const char *json_config, int camera_index);

#endif /* WRAPPER_CONFIG_H */
