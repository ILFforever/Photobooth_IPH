/*
 * widget_ops.h - Camera widget operations (shared between wrapper and controller)
 */

#ifndef WIDGET_OPS_H
#define WIDGET_OPS_H

#include <gphoto2/gphoto2.h>

/* Find a widget by name recursively starting from root */
CameraWidget* find_widget_by_name(CameraWidget *root, const char *name);

/* Get the value of a widget as a string */
const char* get_widget_value(CameraWidget *widget);

/* Get a config value by setting name from camera */
char* get_config_value_by_name(Camera *camera, GPContext *context, const char *setting_name);

/* List all widgets recursively (for debugging) */
void list_all_widgets(Camera *camera, GPContext *context, void (*log_fn)(const char *, ...));

/* JSON escape a string and write to buffer */
int json_escape_append(char *buf, size_t max, const char *str);

/* Get widget value as a string for JSON output */
const char* widget_value_to_string(CameraWidget *widget);

#endif /* WIDGET_OPS_H */
