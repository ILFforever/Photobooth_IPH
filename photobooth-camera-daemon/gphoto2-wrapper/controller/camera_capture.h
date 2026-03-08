/*
 * camera_capture.h - Camera capture and file download functions
 *
 * Declares functions extracted from gphoto2-controller.c
 */

#ifndef CAMERA_CAPTURE_H
#define CAMERA_CAPTURE_H

#include <gphoto2/gphoto2.h>
#include <time.h>
#include <sys/types.h>

/*
 * Extract number from filename like DSCF0042.JPG
 *
 * @param filename The filename to parse
 * @return The extracted file number, or 0 if none found
 */
int extract_file_number(const char *filename);

/*
 * Find highest numbered file in folder
 *
 * @param camera The camera handle
 * @param context The gphoto2 context
 * @param folder The folder path to search
 * @param out_name Buffer to store the highest filename (optional)
 * @param out_size Size of the output buffer
 * @return The highest file number found, or -1 on error
 */
int find_highest_file(Camera *camera, GPContext *context,
                      const char *folder, char *out_name, size_t out_size);

/*
 * Scan folder for all files and download any that don't exist locally
 * Handles failed download retries and cleanup of already-downloaded files
 *
 * @param camera The camera handle
 * @param context The gphoto2 context
 * @return The highest file number found, or 0 if none
 */
int check_and_download_all_files(Camera *camera, GPContext *context);

/*
 * Download a single file from the camera by folder + name
 * Saves to /tmp/<name> and emits a status event
 *
 * @param camera The camera handle
 * @param context The gphoto2 context
 * @param folder The folder path on camera
 * @param name The filename to download
 * @return 0 on success, -1 on failure
 */
int download_file(Camera *camera, GPContext *context,
                  const char *folder, const char *name);

/*
 * Wait for camera events using gp_camera_wait_for_event()
 * Non-blocking to camera - USB bus stays idle between events
 * Downloads files when FILE_ADDED events arrive
 *
 * @param camera The camera handle
 * @param context The gphoto2 context
 * @param timeout_ms Timeout in milliseconds for event wait
 */
void drain_camera_events(Camera *camera, GPContext *context, int timeout_ms);

/*
 * Execute software capture and download the resulting files
 *
 * @param camera The camera handle
 * @param context The gphoto2 context
 * @return GP_OK on success, error code on failure
 */
int do_capture(Camera *camera, GPContext *context);

#endif /* CAMERA_CAPTURE_H */
