/*
 * wrapper_status.h - Status functions
 *
 * Functions for getting quick camera status information
 */

#ifndef WRAPPER_STATUS_H
#define WRAPPER_STATUS_H

#include <gphoto2/gphoto2.h>

/*
 * Get camera status using gp_camera_get_single_config for fast queries
 *
 * Retrieves common camera status information like battery level,
 * ISO, shutter speed, aperture, focus mode, white balance, etc.
 *
 * Parameters:
 *   camera_index - Index of camera to use
 *
 * Outputs JSON with all found status values
 */
void get_camera_status(int camera_index);

#endif /* WRAPPER_STATUS_H */
