/*
 * wrapper_open.c - Camera opening functions
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <gphoto2/gphoto2.h>
#include "wrapper_open.h"

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

GPContext* create_context(void) {
    GPContext *ctx = gp_context_new();
    if (ctx) {
        gp_context_set_error_func(ctx, ctx_error_func, NULL);
        gp_context_set_status_func(ctx, ctx_status_func, NULL);
        gp_context_set_message_func(ctx, ctx_message_func, NULL);
    }
    return ctx;
}

Camera* open_camera_by_index(int camera_index, GPContext *context, int *ret_out) {
    Camera *camera = NULL;
    CameraList *list = NULL;
    GPPortInfoList *port_info_list = NULL;
    CameraAbilitiesList *abilities_list = NULL;
    GPPortInfo port_info;
    CameraAbilities abilities;
    const char *model_name = NULL;
    const char *port_name = NULL;
    int ret, count;

    if (ret_out) *ret_out = GP_OK;

    /* Create camera object */
    ret = gp_camera_new(&camera);
    if (ret < GP_OK) {
        fprintf(stderr, "open_camera: Failed to create camera: %s\n", gp_result_as_string(ret));
        if (ret_out) *ret_out = ret;
        return NULL;
    }

    /* Create and load lists */
    ret = gp_list_new(&list);
    if (ret < GP_OK) {
        fprintf(stderr, "open_camera: Failed to create list: %s\n", gp_result_as_string(ret));
        if (ret_out) *ret_out = ret;
        gp_camera_free(camera);
        return NULL;
    }

    ret = gp_port_info_list_new(&port_info_list);
    if (ret < GP_OK) {
        fprintf(stderr, "open_camera: Failed to create port info list: %s\n", gp_result_as_string(ret));
        gp_list_free(list);
        if (ret_out) *ret_out = ret;
        gp_camera_free(camera);
        return NULL;
    }

    ret = gp_port_info_list_load(port_info_list);
    if (ret < GP_OK) {
        fprintf(stderr, "open_camera: Failed to load port info: %s\n", gp_result_as_string(ret));
        gp_port_info_list_free(port_info_list);
        gp_list_free(list);
        if (ret_out) *ret_out = ret;
        gp_camera_free(camera);
        return NULL;
    }

    ret = gp_abilities_list_new(&abilities_list);
    if (ret < GP_OK) {
        fprintf(stderr, "open_camera: Failed to create abilities list: %s\n", gp_result_as_string(ret));
        gp_port_info_list_free(port_info_list);
        gp_list_free(list);
        if (ret_out) *ret_out = ret;
        gp_camera_free(camera);
        return NULL;
    }

    ret = gp_abilities_list_load(abilities_list, context);
    if (ret < GP_OK) {
        fprintf(stderr, "open_camera: Failed to load abilities: %s\n", gp_result_as_string(ret));
        gp_abilities_list_free(abilities_list);
        gp_port_info_list_free(port_info_list);
        gp_list_free(list);
        if (ret_out) *ret_out = ret;
        gp_camera_free(camera);
        return NULL;
    }

    /* Detect cameras */
    ret = gp_abilities_list_detect(abilities_list, port_info_list, list, context);
    if (ret < GP_OK) {
        fprintf(stderr, "open_camera: Failed to detect cameras: %s\n", gp_result_as_string(ret));
        gp_abilities_list_free(abilities_list);
        gp_port_info_list_free(port_info_list);
        gp_list_free(list);
        if (ret_out) *ret_out = ret;
        gp_camera_free(camera);
        return NULL;
    }

    /* Check camera index is valid */
    count = gp_list_count(list);
    if (camera_index < 0 || camera_index >= count) {
        fprintf(stderr, "open_camera: Camera index %d out of range (0-%d)\n", camera_index, count - 1);
        gp_abilities_list_free(abilities_list);
        gp_port_info_list_free(port_info_list);
        gp_list_free(list);
        if (ret_out) *ret_out = GP_ERROR_BAD_PARAMETERS;
        gp_camera_free(camera);
        return NULL;
    }

    /* Get model and port for the selected camera */
    gp_list_get_name(list, camera_index, &model_name);
    gp_list_get_value(list, camera_index, &port_name);
    fprintf(stderr, "open_camera: Opening camera %d: %s at %s\n", camera_index, model_name, port_name);

    /* Lookup abilities */
    int model_index = gp_abilities_list_lookup_model(abilities_list, model_name);
    if (model_index < GP_OK) {
        fprintf(stderr, "open_camera: Failed to lookup model: %s\n", gp_result_as_string(model_index));
        gp_abilities_list_free(abilities_list);
        gp_port_info_list_free(port_info_list);
        gp_list_free(list);
        if (ret_out) *ret_out = model_index;
        gp_camera_free(camera);
        return NULL;
    }

    ret = gp_abilities_list_get_abilities(abilities_list, model_index, &abilities);
    if (ret < GP_OK) {
        fprintf(stderr, "open_camera: Failed to get abilities: %s\n", gp_result_as_string(ret));
        gp_abilities_list_free(abilities_list);
        gp_port_info_list_free(port_info_list);
        gp_list_free(list);
        if (ret_out) *ret_out = ret;
        gp_camera_free(camera);
        return NULL;
    }

    /* Lookup port */
    int port_index = gp_port_info_list_lookup_path(port_info_list, port_name);
    if (port_index < GP_OK) {
        fprintf(stderr, "open_camera: Failed to lookup port: %s\n", gp_result_as_string(port_index));
        gp_abilities_list_free(abilities_list);
        gp_port_info_list_free(port_info_list);
        gp_list_free(list);
        if (ret_out) *ret_out = port_index;
        gp_camera_free(camera);
        return NULL;
    }

    ret = gp_port_info_list_get_info(port_info_list, port_index, &port_info);
    if (ret < GP_OK) {
        fprintf(stderr, "open_camera: Failed to get port info: %s\n", gp_result_as_string(ret));
        gp_abilities_list_free(abilities_list);
        gp_port_info_list_free(port_info_list);
        gp_list_free(list);
        if (ret_out) *ret_out = ret;
        gp_camera_free(camera);
        return NULL;
    }

    /* Set abilities and port on camera */
    ret = gp_camera_set_abilities(camera, abilities);
    if (ret < GP_OK) {
        fprintf(stderr, "open_camera: Failed to set abilities: %s\n", gp_result_as_string(ret));
        gp_abilities_list_free(abilities_list);
        gp_port_info_list_free(port_info_list);
        gp_list_free(list);
        if (ret_out) *ret_out = ret;
        gp_camera_free(camera);
        return NULL;
    }

    ret = gp_camera_set_port_info(camera, port_info);
    if (ret < GP_OK) {
        fprintf(stderr, "open_camera: Failed to set port info: %s\n", gp_result_as_string(ret));
        gp_abilities_list_free(abilities_list);
        gp_port_info_list_free(port_info_list);
        gp_list_free(list);
        if (ret_out) *ret_out = ret;
        gp_camera_free(camera);
        return NULL;
    }

    /* Initialize the camera */
    ret = gp_camera_init(camera, context);
    if (ret < GP_OK) {
        fprintf(stderr, "open_camera: Failed to init camera: %s\n", gp_result_as_string(ret));
        gp_abilities_list_free(abilities_list);
        gp_port_info_list_free(port_info_list);
        gp_list_free(list);
        if (ret_out) *ret_out = ret;
        gp_camera_free(camera);
        return NULL;
    }

    /* Cleanup */
    gp_abilities_list_free(abilities_list);
    gp_port_info_list_free(port_info_list);
    gp_list_free(list);

    fprintf(stderr, "open_camera: Successfully opened camera %d\n", camera_index);
    return camera;
}
