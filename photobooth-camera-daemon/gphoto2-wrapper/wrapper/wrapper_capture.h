/*
 * wrapper_capture.h - Capture functions
 *
 * Functions for capturing images and managing captured files
 */

#ifndef WRAPPER_CAPTURE_H
#define WRAPPER_CAPTURE_H

#include <gphoto2/gphoto2.h>

/* Maximum number of files that can be captured in a single shot */
#define MAX_CAPTURED_FILES 10

/*
 * Structure representing a captured file
 */
typedef struct {
    char folder[128];
    char name[128];
    char local_path[512];
} CapturedFile;

/*
 * Capture an image from the camera
 *
 * Handles Fuji camera quirks where gp_camera_capture may fail but
 * the photo is still taken. Supports RAW+JPEG mode (multiple files).
 *
 * Parameters:
 *   camera_index - Index of camera to use
 *
 * Outputs JSON:
 *   {"success":true,"files":[{"file_path":"/tmp/...","camera_path":"..."}]}
 *   or {"success":false,"error":"..."}
 */
void capture_image(int camera_index);

#endif /* WRAPPER_CAPTURE_H */
