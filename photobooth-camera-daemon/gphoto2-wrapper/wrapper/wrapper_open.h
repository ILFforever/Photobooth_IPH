/*
 * wrapper_open.h - Camera opening functions
 *
 * Functions for opening and initializing gphoto2 cameras
 */

#ifndef WRAPPER_OPEN_H
#define WRAPPER_OPEN_H

#include <gphoto2/gphoto2.h>

/*
 * Create a GPContext with error/status/message callbacks
 * Returns a newly allocated context that must be freed with gp_context_unref()
 */
GPContext* create_context(void);

/*
 * Open a specific camera by index (0-based)
 *
 * Parameters:
 *   camera_index - Index of camera to open (0 = first camera)
 *   context - GPContext for operations
 *   ret_out - Optional output parameter for error code
 *
 * Returns:
 *   Camera* on success, NULL on failure
 *   If ret_out is provided, error code is stored there
 */
Camera* open_camera_by_index(int camera_index, GPContext *context, int *ret_out);

#endif /* WRAPPER_OPEN_H */
