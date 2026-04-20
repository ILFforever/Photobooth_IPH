/*
 * camera_preview.c - PTP streaming functionality extracted from gphoto2-controller
 *
 * Contains:
 * - stream_preview_frame: Stream preview frame in MJPEG format to pipe
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <fcntl.h>
#include <errno.h>
#include <time.h>
#include <gphoto2/gphoto2.h>
#include <sys/time.h>
#include <signal.h>
#include <stdarg.h>

#include "camera_preview.h"

/* Pipe paths for streaming and status */
#define STREAM_PIPE "/tmp/camera_stream"
#define STATUS_PIPE "/tmp/camera_status"

/* Global streaming state - defined in gphoto2-controller.c */
extern volatile sig_atomic_t g_streaming_active;
extern volatile sig_atomic_t g_streaming_paused;
extern int g_stream_fd;
extern int g_status_fd;
extern volatile sig_atomic_t g_running;

/* Timestamped logging function from controller */
extern void log_timestamped(const char *format, ...);
#define log_ts(...) log_timestamped(__VA_ARGS__)

/*
 * Stream a single preview frame to the stream pipe (MJPEG format)
 *
 * This function captures a preview frame and writes it to the stream pipe
 * with MJPEG boundary markers. The pipe is opened lazily on first call.
 * Supports pause state and automatic pipe reconnection on error.
 *
 * @param camera  The gphoto2 camera instance
 * @param context The gphoto2 context
 * @return GP_OK on success, error code on failure
 */
int stream_preview_frame(Camera *camera, GPContext *context) {
    CameraFile *file = NULL;
    const char *data = NULL;
    unsigned long size = 0;
    int ret;

    /* Check if paused */
    if (g_streaming_paused) {
        return GP_OK;  /* Skip this frame */
    }

    /* Lazy open stream pipe if not already open */
    if (g_stream_fd < 0 && g_streaming_active) {
        g_stream_fd = open(STREAM_PIPE, O_WRONLY | O_NONBLOCK);
        if (g_stream_fd < 0) {
            /* Pipe not ready yet (no reader), will retry next frame */
            return GP_OK;
        }
        log_ts("controller: Stream pipe opened for writing\n");

        /* Increase pipe buffer to 1MB for better throughput (default is 64KB) */
        #ifndef F_SETPIPE_SZ
        #define F_SETPIPE_SZ 1031  /* Linux-specific fcntl command */
        #endif
        int pipe_size = 1024 * 1024;  /* 1MB */
        if (fcntl(g_stream_fd, F_SETPIPE_SZ, pipe_size) < 0) {
            log_ts("controller: Warning - failed to set pipe buffer size: %s\n", strerror(errno));
        } else {
            log_ts("controller: Set stream pipe buffer to 1MB (was 64KB)\n");
        }
    }

    ret = gp_file_new(&file);
    if (ret < GP_OK) {
        log_ts("stream: Failed to create file: %s\n", gp_result_as_string(ret));
        return ret;
    }

    static int frame_count = 0;
    if (frame_count++ % 30 == 0) {
        log_ts("stream: Capturing preview frame #%d...\n", frame_count);
    }

    ret = gp_camera_capture_preview(camera, file, context);
    if (ret < GP_OK) {
        log_ts("stream: Failed to capture preview: %s\n", gp_result_as_string(ret));
        gp_file_free(file);
        return ret;
    }

    ret = gp_file_get_data_and_size(file, &data, &size);
    if (ret < GP_OK || !data || size == 0) {
        log_ts("stream: Failed to get file data: %s\n", gp_result_as_string(ret));
        gp_file_free(file);
        return ret;
    }

    /* Output frame with MJPEG boundary marker */
    if (g_stream_fd >= 0) {
        char header[256];
        int header_len = snprintf(header, sizeof(header),
                                 "--FRAME\r\nContent-Type: image/jpeg\r\nContent-Length: %lu\r\n\r\n", size);

        ssize_t written = write(g_stream_fd, header, header_len);
        if (written < 0) {
            /* Stream pipe closed or error - close and retry next frame */
            close(g_stream_fd);
            g_stream_fd = -1;
            gp_file_free(file);
            return GP_OK;
        }

        written = write(g_stream_fd, data, size);
        if (written < 0) {
            /* Stream pipe closed or error - close and retry next frame */
            close(g_stream_fd);
            g_stream_fd = -1;
            gp_file_free(file);
            return GP_OK;
        }
    }

    gp_file_free(file);
    return GP_OK;
}
