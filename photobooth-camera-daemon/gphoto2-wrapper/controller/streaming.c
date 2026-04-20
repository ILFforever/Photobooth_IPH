/*
 * streaming.c - Live view and PTP streaming implementation
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <fcntl.h>
#include <errno.h>
#include <time.h>
#include <gphoto2/gphoto2.h>
#include "streaming.h"

#define STREAM_PIPE "/tmp/camera_stream"
#define STATUS_PIPE "/tmp/camera_status"

/* Global streaming state */
volatile sig_atomic_t g_streaming_active = 0;
volatile sig_atomic_t g_streaming_paused = 0;
int g_stream_fd = -1;
int g_status_fd = -1;

/* External running flag (set by main controller) */
extern volatile sig_atomic_t g_running;

/* Logging function pointer */
static void (*log_fn_ptr)(const char *, ...) = NULL;

#define LOG(...) if (log_fn_ptr) log_fn_ptr(__VA_ARGS__); else fprintf(stderr, __VA_ARGS__)

void init_streaming_state(void) {
    g_streaming_active = 0;
    g_streaming_paused = 0;
    g_stream_fd = -1;
    g_status_fd = -1;
}

void drain_camera_events(Camera *camera, GPContext *context, int timeout_ms) {
    CameraEventType event_type;
    void *event_data = NULL;

    while (g_running) {
        event_data = NULL;
        int ret = gp_camera_wait_for_event(camera, timeout_ms, &event_type, &event_data, context);
        if (ret < GP_OK) {
            if (event_data) free(event_data);
            break;
        }

        if (event_type == GP_EVENT_TIMEOUT) {
            if (event_data) free(event_data);
            break;
        }

        /* Handle file added events here if needed */
        if (event_data) free(event_data);
    }
}

/* Capture preview frame and send as base64 JSON */
int capture_preview_frame(Camera *camera, GPContext *context, int status_fd) {
    CameraFile *file = NULL;
    const char *data = NULL;
    unsigned long size = 0;
    int ret;
    char base64_buf[2 * 1024 * 1024];  // Buffer for base64 output
    static const char base64_table[] =
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

    LOG("Capturing preview frame...\n");

    ret = gp_file_new(&file);
    if (ret < GP_OK) {
        LOG("Failed to create file: %s\n", gp_result_as_string(ret));
        return ret;
    }

    ret = gp_camera_capture_preview(camera, file, context);
    if (ret < GP_OK) {
        LOG("Preview capture failed: %s\n", gp_result_as_string(ret));
        gp_file_free(file);
        gp_camera_exit(camera, context);
        return ret;
    }

    ret = gp_file_get_data_and_size(file, &data, &size);
    if (ret < GP_OK) {
        LOG("Failed to get preview data: %s\n", gp_result_as_string(ret));
        gp_file_free(file);
        return ret;
    }

    /* Encode to base64 */
    unsigned long triad;
    int i;
    for (i = 0; i < (int)size - 2; i += 3) {
        triad = ((unsigned long)data[i]) << 16;
        triad += ((unsigned long)data[i + 1]) << 8;
        triad += ((unsigned long)data[i + 2]);

        if (i / 3 * 4 >= (int)sizeof(base64_buf) - 4) break;

        base64_buf[i / 3 * 4] = base64_table[(triad >> 18) & 0x3F];
        base64_buf[i / 3 * 4 + 1] = base64_table[(triad >> 12) & 0x3F];
        base64_buf[i / 3 * 4 + 2] = base64_table[(triad >> 6) & 0x3F];
        base64_buf[i / 3 * 4 + 3] = base64_table[triad & 0x3F];
    }

    /* Handle remaining bytes */
    int mod = size % 3;
    int base64_len = (size / 3) * 4;

    if (mod == 1) {
        triad = ((unsigned long)data[size - 1]) << 16;
        base64_buf[base64_len] = base64_table[(triad >> 18) & 0x3F];
        base64_buf[base64_len + 1] = base64_table[(triad >> 12) & 0x3F];
        base64_buf[base64_len + 2] = '=';
        base64_buf[base64_len + 3] = '=';
        base64_len += 4;
    } else if (mod == 2) {
        triad = ((unsigned long)data[size - 2]) << 16;
        triad += ((unsigned long)data[size - 1]) << 8;
        base64_buf[base64_len] = base64_table[(triad >> 18) & 0x3F];
        base64_buf[base64_len + 1] = base64_table[(triad >> 12) & 0x3F];
        base64_buf[base64_len + 2] = base64_table[(triad >> 6) & 0x3F];
        base64_buf[base64_len + 3] = '=';
        base64_len += 4;
    }

    base64_buf[base64_len] = '\0';

    /* Write JSON response to status pipe */
    if (status_fd >= 0) {
        char response[base64_len + 256];
        snprintf(response, sizeof(response),
                "{\"type\":\"liveview_frame\",\"data\":\"%.*s\",\"size\":%lu}\n",
                base64_len, base64_buf, size);
        ssize_t written = write(status_fd, response, strlen(response));
        if (written < 0) {
            LOG("Failed to write preview frame: %s\n", strerror(errno));
        } else {
            LOG("Sent preview frame (%lu bytes, %d base64)\n", size, base64_len);
        }
    }

    gp_file_free(file);
    return GP_OK;
}

/* Stream preview frame in MJPEG format */
int stream_preview_frame(Camera *camera, GPContext *context, int stream_fd, int target_fps) {
    CameraFile *file = NULL;
    const char *data = NULL;
    unsigned long size = 0;
    int ret;

    if (g_streaming_paused) {
        return GP_OK;
    }

    /* Lazy open stream pipe if not already open */
    if (stream_fd < 0 && g_streaming_active) {
        stream_fd = open(STREAM_PIPE, O_WRONLY | O_NONBLOCK);
        if (stream_fd < 0) {
            return GP_OK;
        }
        LOG("Stream pipe opened for writing\n");

        /* Increase pipe buffer to 1MB */
#ifndef F_SETPIPE_SZ
#define F_SETPIPE_SZ 1031
#endif
        int pipe_size = 1024 * 1024;
        if (fcntl(stream_fd, F_SETPIPE_SZ, pipe_size) < 0) {
            LOG("Warning - failed to set pipe buffer size: %s\n", strerror(errno));
        }
    }

    ret = gp_file_new(&file);
    if (ret < GP_OK) {
        LOG("Failed to create file: %s\n", gp_result_as_string(ret));
        return ret;
    }

    static int frame_count = 0;
    if (++frame_count % 30 == 0) {
        LOG("Stream frame #%d...\n", frame_count);
    }

    ret = gp_camera_capture_preview(camera, file, context);
    if (ret < GP_OK) {
        LOG("Failed to capture preview: %s\n", gp_result_as_string(ret));
        gp_file_free(file);
        return ret;
    }

    ret = gp_file_get_data_and_size(file, &data, &size);
    if (ret < GP_OK) {
        LOG("Failed to get preview data: %s\n", gp_result_as_string(ret));
        gp_file_free(file);
        return ret;
    }

    /* Write MJPEG frame boundary and data */
    char header[128];
    snprintf(header, sizeof(header), "--FRAME\nContent-Length: %lu\n\n", size);

    write(stream_fd, header, strlen(header));
    write(stream_fd, data, size);

    gp_file_free(file);
    return GP_OK;
}

/* Continuous streaming loop */
int stream_preview_frames(Camera *camera, GPContext *context, int stream_fd, int target_fps) {
    while (g_streaming_active && g_running) {
        if (stream_preview_frame(camera, context, stream_fd, target_fps) != GP_OK) {
            break;
        }

        /* Throttle to target FPS */
        if (target_fps > 0) {
            usleep(1000000 / target_fps);
        } else {
            usleep(40000);  // Default ~25 FPS
        }
    }

    return GP_OK;
}
