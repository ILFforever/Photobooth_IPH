/*
 * wrapper_widgets.h - Widget functions
 *
 * Functions for working with camera configuration widgets
 */

#ifndef WRAPPER_WIDGETS_H
#define WRAPPER_WIDGETS_H

#include <gphoto2/gphoto2.h>
#include "common/widget_ops.h"

/*
 * List all widgets in the config tree as JSON
 *
 * Parameters:
 *   camera_index - Index of camera to use
 *
 * Outputs JSON array of all widgets with their properties
 */
void list_all_widgets_json(int camera_index);

#endif /* WRAPPER_WIDGETS_H */
