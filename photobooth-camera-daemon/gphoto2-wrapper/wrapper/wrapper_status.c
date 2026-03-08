/*
 * wrapper_status.c - Status functions
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <gphoto2/gphoto2.h>
#include "wrapper_status.h"
#include "wrapper_open.h"
#include "wrapper_widgets.h"

/* Get camera status using gp_camera_get_single_config for fast queries */
void get_camera_status(int camera_index) {
    Camera *camera = NULL;
    GPContext *context = NULL;
    CameraWidget *widget = NULL;
    int ret;
    int first = 1;

    context = create_context();
    if (!context) {
        printf("{\"error\":\"Failed to create context\"}\n");
        return;
    }

    fprintf(stderr, "status: Opening camera %d...\n", camera_index);
    camera = open_camera_by_index(camera_index, context, &ret);
    if (!camera) {
        printf("{\"error\":\"Failed to open camera %d: %s\"}\n",
               camera_index, gp_result_as_string(ret));
        gp_context_unref(context);
        return;
    }

    /* List of widgets to query - common camera settings */
    const char *widget_names[] = {
        "d36b",                  /* Battery level (Fuji specific) */
        "batterylevel",          /* Generic battery level */
        "iso",                   /* ISO speed */
        "shutterspeed",          /* Shutter speed */
        "aperture",              /* Aperture */
        "exposurecompensation",  /* Exposure compensation */
        "focusmode",             /* Focus mode */
        "whitebalance",          /* White balance */
        "imageformat",           /* Image format (RAW/JPEG) */
        "imagesize",             /* Image size/resolution */
        "drange",                /* Dynamic range (Fuji) */
        "filmrecmode",           /* Film simulation mode (Fuji) */
        NULL
    };

    printf("{\"status\":{");

    for (int i = 0; widget_names[i] != NULL; i++) {
        const char *name = widget_names[i];

        ret = gp_camera_get_single_config(camera, name, &widget, context);
        if (ret == GP_OK && widget != NULL) {
            const char *label = NULL;
            const char *val = NULL;

            gp_widget_get_label(widget, &label);
            val = get_widget_value(widget);

            if (val != NULL && val[0] != '\0') {
                if (!first) printf(",");
                first = 0;

                /* Sanitize value for JSON */
                char sanitized[256];
                int j = 0;
                for (const char *p = val; *p && j < 255; p++) {
                    if (*p == '"') {
                        sanitized[j++] = '\\';
                        sanitized[j++] = '"';
                    } else if (*p == '\\') {
                        sanitized[j++] = '\\';
                        sanitized[j++] = '\\';
                    } else if (*p == '\n') {
                        sanitized[j++] = '\\';
                        sanitized[j++] = 'n';
                    } else if (*p == '\r') {
                        sanitized[j++] = '\\';
                        sanitized[j++] = 'r';
                    } else if (*p == '\t') {
                        sanitized[j++] = '\\';
                        sanitized[j++] = 't';
                    } else if (*p >= ' ' && *p <= '~') {
                        sanitized[j++] = *p;
                    }
                }
                sanitized[j] = '\0';

                printf("\"%s\":\"%s\"", name, sanitized);
            }

            gp_widget_free(widget);
            widget = NULL;
        }
    }

    printf("}}\n");

    gp_camera_exit(camera, context);
    gp_camera_free(camera);
    gp_context_unref(context);
}
