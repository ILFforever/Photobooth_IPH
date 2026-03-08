/*
 * streaming.h - Live view and PTP streaming operations
 */

#ifndef STREAMING_H
#define STREAMING_H

#include <gphoto2/gphoto2.h>
#include <signal.h>

/* Global streaming state */
extern volatile sig_atomic_t g_streaming_active;
extern volatile sig_atomic_t g_streaming_paused;
extern volatile sig_atomic_t g_liveview_active;

/* Stream output file descriptors */
extern int g_stream_fd;  /* MJPEG stream pipe */
extern int g_status_fd;  /* Status pipe */

/* Initialize streaming state */
void init_streaming_state(void);

/* Capture a single preview frame (base64 JPEG) */
int capture_preview_frame(Camera *camera, GPContext *context, int status_fd);

/* Stream preview frames continuously (MJPEG) */
int stream_preview_frames(Camera *camera, GPContext *context, int stream_fd, int target_fps);

/* Drain camera events (timeout in ms) */
void drain_camera_events(Camera *camera, GPContext *context, int timeout_ms);

#endif /* STREAMING_H */
