/*
 * camera_open.h - Camera opening and caching
 */

#ifndef CAMERA_OPEN_H
#define CAMERA_OPEN_H

#include <gphoto2/gphoto2.h>
#include <time.h>

/* Global cached data for camera detection */
extern GPPortInfoList *g_cached_port_info_list;
extern CameraAbilitiesList *g_cached_abilities_list;
extern int g_cached_camera_index;
extern int g_detection_valid;

/* Camera brand detection state */
extern CameraBrand g_current_brand;

/* Last known USB port for reset */
extern char g_last_camera_port[128];

/* Create a gphoto2 context with error callback */
GPContext* create_context(void);

/* Open camera with optional timeout (in seconds) */
Camera* open_camera_with_timeout(int camera_index, int *ret_out, int timeout_sec);

/* Simple wrapper without timeout */
Camera* open_camera(int camera_index, int *ret_out);

/* Free cached detection data */
void free_camera_detection_cache(void);

#endif /* CAMERA_OPEN_H */
