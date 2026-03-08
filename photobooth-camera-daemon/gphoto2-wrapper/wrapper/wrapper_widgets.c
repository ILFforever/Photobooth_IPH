/*
 * wrapper_widgets.c - Widget functions
 *
 * These are wrapper-specific widget functions for JSON output
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <gphoto2/gphoto2.h>
#include "wrapper_widgets.h"
#include "wrapper_open.h"

/* Helper to escape string for JSON output */
static void print_json_escaped(const char *str) {
    if (!str) return;
    for (const char *p = str; *p; p++) {
        if (*p == '"') printf("\\\"");
        else if (*p == '\\') printf("\\\\");
        else if (*p == '\n') printf("\\n");
        else if (*p == '\r') printf("\\r");
        else if (*p == '\t') printf("\\t");
        else if (*p >= 32 && *p <= 126) putchar(*p);
        else printf("\\u%04x", (unsigned char)*p);
    }
}

/* Recursive helper to list all widgets */
static void list_widgets_recursive(CameraWidget *widget, int depth, int reset_first) {
    const char *name = NULL;
    const char *label = NULL;
    CameraWidgetType type;
    int count, i;
    static int first = 1;

    /* Reset first flag when starting a new children array */
    if (reset_first) {
        first = 1;
    }

    gp_widget_get_name(widget, &name);
    gp_widget_get_label(widget, &label);
    gp_widget_get_type(widget, &type);

    if (!first) printf(",");
    first = 0;

    printf("{\"name\":\"");
    print_json_escaped(name ? name : "");
    printf("\",\"label\":\"");
    print_json_escaped(label ? label : "");
    printf("\",\"type\":%d", type);

    count = gp_widget_count_children(widget);
    if (count > 0) {
        printf(",\"children\":[");
        for (i = 0; i < count; i++) {
            CameraWidget *child = NULL;
            gp_widget_get_child(widget, i, &child);
            if (child) {
                /* Only reset first flag for the first child in this array */
                list_widgets_recursive(child, depth + 1, (i == 0));
            }
        }
        printf("]");
    }
    printf("}");
}

/* Wrapper-specific version that outputs JSON format */
void list_all_widgets_json(int camera_index) {
    Camera *camera = NULL;
    GPContext *context = NULL;
    CameraWidget *config = NULL;
    int ret;

    context = create_context();
    if (!context) {
        printf("{\"error\":\"Failed to create context\"}\n");
        return;
    }

    fprintf(stderr, "widgets: Opening camera %d...\n", camera_index);
    camera = open_camera_by_index(camera_index, context, &ret);
    if (!camera) {
        printf("{\"error\":\"Failed to open camera %d: %s\"}\n",
               camera_index, gp_result_as_string(ret));
        gp_context_unref(context);
        return;
    }

    ret = gp_camera_get_config(camera, &config, context);
    if (ret < GP_OK) {
        printf("{\"error\":\"Failed to get config: %s\"}\n", gp_result_as_string(ret));
        gp_camera_exit(camera, context);
        gp_camera_free(camera);
        gp_context_unref(context);
        return;
    }

    printf("{\"widgets\":[");
    list_widgets_recursive(config, 0, 0);
    printf("]}\n");

    gp_widget_free(config);
    gp_camera_exit(camera, context);
    gp_camera_free(camera);
    gp_context_unref(context);
}
