/*
 * gphoto2-common.h - Shared definitions for gphoto2 wrapper and controller
 */

#ifndef GPHOTO2_COMMON_H
#define GPHOTO2_COMMON_H

#include <gphoto2/gphoto2.h>
#include <time.h>
#include <stdarg.h>

/* Timestamped logging - adds HH:MM:SS prefix to all stderr output */
static void log_timestamped(const char *format, ...) {
    va_list args;
    char timestamp[32];
    struct timespec ts;
    struct tm tm_info;

    clock_gettime(CLOCK_REALTIME, &ts);
    localtime_r(&ts.tv_sec, &tm_info);
    snprintf(timestamp, sizeof(timestamp), "[%02d:%02d:%02d.%03ld] ",
             tm_info.tm_hour, tm_info.tm_min, tm_info.tm_sec, ts.tv_nsec / 1000000);

    fprintf(stderr, "%s", timestamp);
    va_start(args, format);
    vfprintf(stderr, format, args);
    va_end(args);
}

#define log_ts(...) log_timestamped(__VA_ARGS__)

/* Context error/status/message callbacks for verbose logging */
static void ctx_error_func(GPContext *context, const char *msg, void *data) {
    (void)context; (void)data;
    fprintf(stderr, "gphoto2 ERROR: %s\n", msg);
}

static void ctx_status_func(GPContext *context, const char *msg, void *data) {
    (void)context; (void)data;
    fprintf(stderr, "gphoto2 status: %s\n", msg);
}

static void ctx_message_func(GPContext *context, const char *msg, void *data) {
    (void)context; (void)data;
    fprintf(stderr, "gphoto2 message: %s\n", msg);
}

/* Create a gphoto2 context with standard callbacks */
static GPContext* create_context(void) {
    GPContext *ctx = gp_context_new();
    if (ctx) {
        gp_context_set_error_func(ctx, ctx_error_func, NULL);
        gp_context_set_status_func(ctx, ctx_status_func, NULL);
        gp_context_set_message_func(ctx, ctx_message_func, NULL);
    }
    return ctx;
}

#endif /* GPHOTO2_COMMON_H */
