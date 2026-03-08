/*
 * camera_capture.c - Camera capture and file download functions
 *
 * Extracted from gphoto2-controller.c for modular organization
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <fcntl.h>
#include <errno.h>
#include <gphoto2/gphoto2.h>
#include <sys/statvfs.h>
#include <dirent.h>
#include <time.h>
#include <stdarg.h>
#include <signal.h>
#include <sys/stat.h>
#include <sys/types.h>

#include "camera_capture.h"

/* Constants */
#define MAX_FAILED_FILES 50
#define MAX_DOWNLOAD_RETRIES 3
#define FAILED_FILE_RESET_SEC 300

/* Failed file tracking */
typedef struct {
    char filename[128];
    int retry_count;
    time_t first_failure;
} FailedFile;

static FailedFile g_failed_files[MAX_FAILED_FILES];
static int g_failed_file_count = 0;

/* External globals (from main controller) */
extern int g_status_fd;
extern volatile sig_atomic_t g_running;

/* External logging function (from main controller) */
extern void log_timestamped(const char *format, ...);
#define log_ts(...) log_timestamped(__VA_ARGS__)

/*
 * Extract number from filename like DSCF0042.JPG
 */
int extract_file_number(const char *filename) {
    const char *p = filename;
    int number = 0;
    while (*p && !(*p >= '0' && *p <= '9')) p++;
    while (*p >= '0' && *p <= '9') {
        number = number * 10 + (*p - '0');
        p++;
    }
    return number;
}

/*
 * Check available disk space in bytes for a given path
 */
static unsigned long long get_available_space(const char *path) {
    struct statvfs stat;
    if (statvfs(path, &stat) != 0) {
        return 0;
    }
    return (unsigned long long)stat.f_bavail * stat.f_bsize;
}

/*
 * Helper to get file modification time
 */
static time_t get_file_mtime(const char *filepath) {
    struct stat st;
    if (stat(filepath, &st) == 0) {
        return st.st_mtime;
    }
    return 0;
}

/*
 * Clean up old photos to free space. Returns number of files deleted.
 */
static int cleanup_old_photos(unsigned long long target_free_bytes) {
    DIR *dir = opendir("/tmp");
    if (!dir) return 0;

    // Build list of image files with their mtimes
    struct {
        char path[512];
        time_t mtime;
        unsigned long size;
    } photos[1000];
    int photo_count = 0;

    struct dirent *entry;
    while ((entry = readdir(dir)) != NULL && photo_count < 1000) {
        if (entry->d_type != DT_REG) continue;

        // Check if it's an image file
        const char *ext = strrchr(entry->d_name, '.');
        if (!ext) continue;

        int is_image = 0;
        const char *image_exts[] = {".jpg", ".JPG", ".jpeg", ".JPEG", ".png", ".PNG", ".raf", ".RAF", ".arw", ".ARW", NULL};
        for (int i = 0; image_exts[i] != NULL; i++) {
            if (strcasecmp(ext, image_exts[i]) == 0) {
                is_image = 1;
                break;
            }
        }
        if (!is_image) continue;

        // Get file info
        char filepath[512];
        snprintf(filepath, sizeof(filepath), "/tmp/%s", entry->d_name);
        struct stat st;
        if (stat(filepath, &st) == 0) {
            strcpy(photos[photo_count].path, filepath);
            photos[photo_count].mtime = st.st_mtime;
            photos[photo_count].size = st.st_size;
            photo_count++;
        }
    }
    closedir(dir);

    if (photo_count == 0) return 0;

    // Sort by modification time (oldest first) - bubble sort
    for (int i = 0; i < photo_count - 1; i++) {
        for (int j = 0; j < photo_count - i - 1; j++) {
            if (photos[j].mtime > photos[j + 1].mtime) {
                // Swap
                char tmp_path[512];
                strcpy(tmp_path, photos[j].path);
                strcpy(photos[j].path, photos[j + 1].path);
                strcpy(photos[j + 1].path, tmp_path);

                time_t tmp_mtime = photos[j].mtime;
                photos[j].mtime = photos[j + 1].mtime;
                photos[j + 1].mtime = tmp_mtime;

                unsigned long tmp_size = photos[j].size;
                photos[j].size = photos[j + 1].size;
                photos[j + 1].size = tmp_size;
            }
        }
    }

    // Delete oldest files until we free enough space
    int deleted_count = 0;
    unsigned long long freed_space = 0;

    for (int i = 0; i < photo_count && freed_space < target_free_bytes; i++) {
        if (unlink(photos[i].path) == 0) {
            log_ts("controller: Deleted old photo: %s (%lu bytes)\n", photos[i].path, photos[i].size);
            freed_space += photos[i].size;
            deleted_count++;
        } else {
            log_ts("controller: Failed to delete %s: %s\n", photos[i].path, strerror(errno));
        }
    }

    return deleted_count;
}

/*
 * Ensure sufficient storage space before saving a file
 */
static void ensure_storage_space(unsigned long long file_size_estimate) {
    const unsigned long long MIN_FREE_MB = 50;
    const unsigned long long MIN_FREE_BYTES = MIN_FREE_MB * 1024 * 1024;
    const unsigned long long BUFFER_BYTES = 10 * 1024 * 1024; // 10MB buffer

    unsigned long long available = get_available_space("/tmp");
    unsigned long long available_mb = available / (1024 * 1024);

    // Check if we need cleanup (either below min free, or not enough for this file)
    unsigned long long needed = (file_size_estimate > 0) ? file_size_estimate + BUFFER_BYTES : 0;
    if (available < MIN_FREE_BYTES || available < needed) {
        unsigned long long target = (needed > MIN_FREE_BYTES) ? needed : (MIN_FREE_BYTES + BUFFER_BYTES);
        unsigned long long to_free = target - available;

        log_ts("controller: Low storage! Only %llu MB free, need %llu MB. Cleaning up...\n",
                available_mb, target / (1024 * 1024));

        int deleted = cleanup_old_photos(to_free);
        if (deleted > 0) {
            log_ts("controller: Cleaned up %d old photo(s) to free space\n", deleted);
        } else {
            log_ts("controller: WARNING: No photos to delete, but storage is low!\n");
        }
    }
}

/*
 * Reset old failed file entries (called periodically)
 */
static void reset_old_failed_files(void) {
    time_t now = time(NULL);
    int new_count = 0;

    for (int i = 0; i < g_failed_file_count; i++) {
        if (now - g_failed_files[i].first_failure < FAILED_FILE_RESET_SEC) {
            // Keep this entry
            if (new_count != i) {
                g_failed_files[new_count] = g_failed_files[i];
            }
            new_count++;
        } else {
            log_ts("controller: Reset failed file entry for %s (was %d retries)\n",
                    g_failed_files[i].filename, g_failed_files[i].retry_count);
        }
    }
    g_failed_file_count = new_count;
}

/*
 * Find a failed file entry, returns index or -1 if not found
 */
static int find_failed_file(const char *filename) {
    for (int i = 0; i < g_failed_file_count; i++) {
        if (strcmp(g_failed_files[i].filename, filename) == 0) {
            return i;
        }
    }
    return -1;
}

/*
 * Check if a file should be skipped due to too many failures
 */
static int should_skip_file(const char *filename) {
    int idx = find_failed_file(filename);
    if (idx < 0) return 0;
    return g_failed_files[idx].retry_count >= MAX_DOWNLOAD_RETRIES;
}

/*
 * Record a failed download attempt, returns new retry count
 */
static int record_failed_download(const char *filename) {
    int idx = find_failed_file(filename);

    if (idx >= 0) {
        // Existing entry
        g_failed_files[idx].retry_count++;
        return g_failed_files[idx].retry_count;
    }

    // New entry
    if (g_failed_file_count < MAX_FAILED_FILES) {
        strncpy(g_failed_files[g_failed_file_count].filename, filename,
                sizeof(g_failed_files[0].filename) - 1);
        g_failed_files[g_failed_file_count].filename[sizeof(g_failed_files[0].filename) - 1] = '\0';
        g_failed_files[g_failed_file_count].retry_count = 1;
        g_failed_files[g_failed_file_count].first_failure = time(NULL);
        g_failed_file_count++;
        return 1;
    }

    // Table full, just return 1
    log_ts("controller: Warning - failed files table full\n");
    return 1;
}

/*
 * Clear a file from failed list (on successful download)
 */
static void clear_failed_file(const char *filename) {
    int idx = find_failed_file(filename);
    if (idx < 0) return;

    // Shift remaining entries
    for (int i = idx; i < g_failed_file_count - 1; i++) {
        g_failed_files[i] = g_failed_files[i + 1];
    }
    g_failed_file_count--;
}

/*
 * Check if a file already exists locally in /tmp
 */
static int file_exists_locally(const char *filename) {
    char path[512];
    snprintf(path, sizeof(path), "/tmp/%s", filename);
    FILE *f = fopen(path, "rb");
    if (f) {
        fclose(f);
        return 1;
    }
    return 0;
}

/*
 * Find highest numbered file in folder
 */
int find_highest_file(Camera *camera, GPContext *context,
                      const char *folder, char *out_name, size_t out_size) {
    CameraList *file_list = NULL;
    int ret;
    int max_number = -1;
    char max_name_buf[128] = {0};

    ret = gp_list_new(&file_list);
    if (ret < GP_OK) return -1;

    ret = gp_camera_folder_list_files(camera, folder, file_list, context);
    if (ret < GP_OK) {
        gp_list_free(file_list);
        return -1;
    }

    int count = gp_list_count(file_list);
    for (int i = 0; i < count; i++) {
        const char *name;
        gp_list_get_name(file_list, i, &name);
        int num = extract_file_number(name);
        if (num > max_number) {
            max_number = num;
            strncpy(max_name_buf, name, sizeof(max_name_buf) - 1);
        }
    }

    gp_list_free(file_list);

    if (max_name_buf[0] && out_name) {
        strncpy(out_name, max_name_buf, out_size - 1);
        out_name[out_size - 1] = '\0';
    }

    return max_number;
}

/*
 * Scan folder for all files and download any that don't exist locally
 */
int check_and_download_all_files(Camera *camera, GPContext *context) {
    const char *folders[] = {"/store_10000001", "/DCIM/100_FUJI", "/DCIM", NULL};
    int total_downloaded = 0;
    int highest_number = 0;

    // Reset old failed file entries periodically
    reset_old_failed_files();

    for (int fi = 0; folders[fi] != NULL; fi++) {
        CameraList *file_list = NULL;
        int ret = gp_list_new(&file_list);
        if (ret < GP_OK) continue;

        ret = gp_camera_folder_list_files(camera, folders[fi], file_list, context);
        if (ret < GP_OK) {
            gp_list_free(file_list);
            continue;
        }

        int count = gp_list_count(file_list);
        //log_ts("controller: Scanning folder %s (%d files)\n", folders[fi], count);

        for (int i = 0; i < count; i++) {
            const char *name;
            gp_list_get_name(file_list, i, &name);

            // Check if we're interested in this file (image files)
            int is_image = 0;
            const char *ext = strrchr(name, '.');
            if (ext) {
                const char *image_exts[] = {".jpg", ".JPG", ".jpeg", ".JPEG", ".raf", ".RAF", NULL};
                for (int ei = 0; image_exts[ei] != NULL; ei++) {
                    if (strcasecmp(ext, image_exts[ei]) == 0) {
                        is_image = 1;
                        break;
                    }
                }
            }

            if (!is_image) continue;

            // Track highest file number
            int file_num = extract_file_number(name);
            if (file_num > highest_number) {
                highest_number = file_num;
            }

            // Check if file already exists locally
            if (file_exists_locally(name)) {
                log_ts("controller: File already exists locally: %s, deleting from camera...\n", name);
                // File exists locally but still on camera - clean it up!
                int delete_ret = gp_camera_file_delete(camera, folders[fi], name, context);
                if (delete_ret < GP_OK) {
                    log_ts("controller: Failed to delete existing file %s from camera: %s\n",
                            name, gp_result_as_string(delete_ret));
                } else {
                    log_ts("controller: Cleaned up existing file %s from camera\n", name);
                }
                clear_failed_file(name);  // Clear any failed download tracking
                continue;
            }

            // Check if file should be skipped due to repeated failures
            if (should_skip_file(name)) {
                // Only log once in a while to avoid spam
                static time_t last_skip_log = 0;
                time_t now = time(NULL);
                if (now - last_skip_log > 30) {
                    log_ts("controller: Skipping %s - exceeded max download retries (%d)\n",
                            name, MAX_DOWNLOAD_RETRIES);
                    last_skip_log = now;
                }
                continue;
            }

            // Download the file
            CameraFile *file = NULL;
            ret = gp_file_new(&file);
            if (ret < GP_OK) continue;

            ret = gp_camera_file_get(camera, folders[fi], name,
                                     GP_FILE_TYPE_NORMAL, file, context);
            if (ret >= GP_OK) {
                char output_path[512];
                snprintf(output_path, sizeof(output_path), "/tmp/%s", name);

                // Check file size received from camera
                const char *data;
                unsigned long size;
                gp_file_get_data_and_size(file, &data, &size);
                log_ts("controller: Received %lu bytes from camera for %s\n", size, name);

                // Ensure we have enough storage before saving
                ensure_storage_space(size);

                ret = gp_file_save(file, output_path);
                if (ret >= GP_OK) {
                    log_ts("controller: Downloaded %s/%s -> %s\n", folders[fi], name, output_path);
                    total_downloaded++;
                    clear_failed_file(name);  // Clear any previous failure tracking

                    // Emit event to status pipe
                    if (g_status_fd >= 0) {
                        char event[512];
                        snprintf(event, sizeof(event),
                                "{\"type\":\"photo_downloaded\",\"file_path\":\"%s\",\"camera_path\":\"%s/%s\"}\n",
                                output_path, folders[fi], name);
                        ssize_t written = write(g_status_fd, event, strlen(event));
                        if (written < 0) {
                            log_ts("controller: Failed to write to status pipe: %s\n", strerror(errno));
                        } else {
                            log_ts("controller: Emitted photo_downloaded event\n");
                        }
                    }

                    // Delete from camera after successful download
                    int delete_ret = gp_camera_file_delete(camera, folders[fi], name, context);
                    if (delete_ret < GP_OK) {
                        log_ts("controller: Warning - failed to delete %s from camera: %s\n",
                                name, gp_result_as_string(delete_ret));
                    } else {
                        log_ts("controller: Deleted %s from camera\n", name);
                    }
                } else {
                    int retries = record_failed_download(name);
                    log_ts("controller: Failed to save %s: error=%d (%s) [attempt %d/%d]\n",
                            name, ret, gp_result_as_string(ret), retries, MAX_DOWNLOAD_RETRIES);
                    log_ts("controller: Output path: %s, errno: %d (%s)\n", output_path, errno, strerror(errno));

                    // Check disk space
                    FILE *df = popen("df -h /tmp 2>/dev/null", "r");
                    if (df) {
                        char df_line[256];
                        while (fgets(df_line, sizeof(df_line), df)) {
                            log_ts("controller: %s", df_line);
                        }
                        pclose(df);
                    }
                }
            } else {
                int retries = record_failed_download(name);
                log_ts("controller: Failed to download %s: error=%d (%s) [attempt %d/%d]\n",
                        name, ret, gp_result_as_string(ret), retries, MAX_DOWNLOAD_RETRIES);
            }

            gp_file_free(file);
        }

        gp_list_free(file_list);
    }

    return highest_number;
}

/*
 * Download a single file from the camera by folder + name.
 * Saves to /tmp/<name> and emits a status event.
 * Returns 0 on success, -1 on failure.
 */
int download_file(Camera *camera, GPContext *context,
                  const char *folder, const char *name) {
    CameraFile *file = NULL;
    char output_path[512];
    int ret;

    ret = gp_file_new(&file);
    if (ret < GP_OK) return -1;

    ret = gp_camera_file_get(camera, folder, name,
                             GP_FILE_TYPE_NORMAL, file, context);
    if (ret < GP_OK) {
        gp_file_free(file);
        return -1;
    }

    snprintf(output_path, sizeof(output_path), "/tmp/%s", name);

    // Check file size received from camera
    const char *data;
    unsigned long size;
    gp_file_get_data_and_size(file, &data, &size);
    log_ts("controller: Received %lu bytes from camera for %s\n", size, name);

    // Ensure we have enough storage before saving
    ensure_storage_space(size);

    ret = gp_file_save(file, output_path);
    gp_file_free(file);

    if (ret < GP_OK) {
        log_ts("controller: Failed to save %s: error=%d (%s)\n", name, ret, gp_result_as_string(ret));
        log_ts("controller: Output path: %s, errno: %d (%s)\n", output_path, errno, strerror(errno));

        // Check disk space
        FILE *df = popen("df -h /tmp 2>/dev/null", "r");
        if (df) {
            char df_line[256];
            while (fgets(df_line, sizeof(df_line), df)) {
                log_ts("controller: %s", df_line);
            }
            pclose(df);
        }
        return -1;
    }

    log_ts("controller: Downloaded %s/%s -> %s\n", folder, name, output_path);

    /* Emit event to status pipe */
    if (g_status_fd >= 0) {
        char event[512];
        snprintf(event, sizeof(event),
                "{\"type\":\"photo_downloaded\",\"file_path\":\"%s\",\"camera_path\":\"%s/%s\"}\n",
                output_path, folder, name);
        ssize_t written = write(g_status_fd, event, strlen(event));
        if (written < 0) {
            log_ts("controller: Failed to write photo_downloaded event: %s\n", strerror(errno));
        } else {
            log_ts("controller: Emitted photo_downloaded event for %s\n", name);
        }
    }

    /* Delete from camera after successful download */
    int delete_ret = gp_camera_file_delete(camera, folder, name, context);
    if (delete_ret < GP_OK) {
        log_ts("controller: Warning - failed to delete %s from camera: %s\n",
                name, gp_result_as_string(delete_ret));
    } else {
        log_ts("controller: Deleted %s from camera\n", name);
    }

    return 0;
}

/*
 * Wait for camera events using gp_camera_wait_for_event().
 * This is non-blocking to the camera - the USB bus stays idle between events,
 * so the physical shutter button works normally.
 *
 * When a FILE_ADDED event arrives (physical shutter or after software capture),
 * we download the file. Returns after the timeout expires with no events.
 */
void drain_camera_events(Camera *camera, GPContext *context, int timeout_ms) {
    CameraEventType event_type;
    void *event_data = NULL;
    int ret;

    /* Keep draining events until we get a timeout (no more events) */
    while (g_running) {
        event_data = NULL;
        ret = gp_camera_wait_for_event(camera, timeout_ms, &event_type, &event_data, context);
        if (ret < GP_OK) {
            log_ts("controller: wait_for_event error: %s\n", gp_result_as_string(ret));
            if (event_data) free(event_data);
            break;
        }

        if (event_type == GP_EVENT_TIMEOUT) {
            /* No more events - camera is idle */
            if (event_data) free(event_data);
            break;
        }

        if (event_type == GP_EVENT_FILE_ADDED) {
            CameraFilePath *path = (CameraFilePath *)event_data;
            log_ts("controller: FILE_ADDED event: %s/%s\n", path->folder, path->name);
            download_file(camera, context, path->folder, path->name);
        } else if (event_type == GP_EVENT_FOLDER_ADDED) {
            CameraFilePath *path = (CameraFilePath *)event_data;
            log_ts("controller: FOLDER_ADDED event: %s/%s\n", path->folder, path->name);
        } else {
            log_ts("controller: Event type %d\n", event_type);
        }

        if (event_data) free(event_data);
    }
}

/*
 * Execute software capture and download the resulting files
 */
int do_capture(Camera *camera, GPContext *context) {
    CameraFilePath path;
    int ret;
    struct timespec t0, t1, t2;

    clock_gettime(CLOCK_MONOTONIC, &t0);
    log_ts("controller: Triggering capture...\n");
    ret = gp_camera_capture(camera, GP_CAPTURE_IMAGE, &path, context);
    clock_gettime(CLOCK_MONOTONIC, &t1);
    log_ts("controller: [TIMING] gp_camera_capture: %ldms\n",
            (t1.tv_sec - t0.tv_sec) * 1000 + (t1.tv_nsec - t0.tv_nsec) / 1000000);

    if (ret < GP_OK) {
        log_ts("controller: Capture failed: %s\n", gp_result_as_string(ret));
        return ret;  /* Return actual error - let caller handle it */
    }

    log_ts("controller: Capture complete: %s/%s\n", path.folder, path.name);

    /* Download the file returned by gp_camera_capture directly */
    download_file(camera, context, path.folder, path.name);
    clock_gettime(CLOCK_MONOTONIC, &t2);
    log_ts("controller: [TIMING] download_file: %ldms\n",
            (t2.tv_sec - t1.tv_sec) * 1000 + (t2.tv_nsec - t1.tv_nsec) / 1000000);

    /* NOTE: Skipping drain - polling loop picks up any additional files (RAW+JPEG) */

    return GP_OK;
}
