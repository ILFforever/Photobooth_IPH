/*
 * camera_preview.h - PTP streaming functionality interface
 *
 * This module contains functions for streaming camera preview frames.
 * Extracted from gphoto2-controller.c for better code organization.
 */

#ifndef CAMERA_PREVIEW_H
#define CAMERA_PREVIEW_H

#include <gphoto2/gphoto2.h>
#include <signal.h>

/* Pipe paths for streaming and status */
#define STREAM_PIPE "/tmp/camera_stream"
#define STATUS_PIPE "/tmp/camera_status"

/* Global streaming state - accessed from controller and this module */
extern volatile sig_atomic_t g_streaming_active;  /* Flag for continuous streaming */
extern volatile sig_atomic_t g_streaming_paused;   /* Flag for pause during operations */
extern int g_stream_fd;                            /* MJPEG stream pipe file descriptor */
extern int g_status_fd;                            /* Status pipe file descriptor */

/*
 * Stream a single preview frame in MJPEG format
 *
 * Captures a preview frame and writes it to the stream pipe with
 * MJPEG boundary markers. The pipe is opened lazily on first call.
 * Supports pause state and automatic pipe reconnection on error.
 *
 * @param camera  The gphoto2 camera instance
 * @param context The gphoto2 context
 * @return GP_OK on success, error code on failure
 */
int stream_preview_frame(Camera *camera, GPContext *context);

#endif /* CAMERA_PREVIEW_H */
