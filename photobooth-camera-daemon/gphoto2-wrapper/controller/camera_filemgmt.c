/*
 * camera_filemgmt - File management and failed file tracking
 *
 * Handles tracking of failed file downloads, retry logic, and local
 * file existence checking for the gphoto2 controller.
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

#include "camera_filemgmt.h"

/* External logging function from gphoto2-controller.c */
extern void log_timestamped(const char *format, ...);
#define log_ts(...) log_timestamped(__VA_ARGS__)

/* Failed file tracking */
static FailedFile g_failed_files[MAX_FAILED_FILES];
static int g_failed_file_count = 0;

/* Reset old failed file entries (called periodically) */
void reset_old_failed_files(void) {
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

/* Find a failed file entry, returns index or -1 if not found */
int find_failed_file(const char *filename) {
    for (int i = 0; i < g_failed_file_count; i++) {
        if (strcmp(g_failed_files[i].filename, filename) == 0) {
            return i;
        }
    }
    return -1;
}

/* Check if a file should be skipped due to too many failures */
int should_skip_file(const char *filename) {
    int idx = find_failed_file(filename);
    if (idx < 0) return 0;
    return g_failed_files[idx].retry_count >= MAX_DOWNLOAD_RETRIES;
}

/* Record a failed download attempt, returns new retry count */
int record_failed_download(const char *filename) {
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

/* Clear a file from failed list (on successful download) */
void clear_failed_file(const char *filename) {
    int idx = find_failed_file(filename);
    if (idx < 0) return;

    // Shift remaining entries
    for (int i = idx; i < g_failed_file_count - 1; i++) {
        g_failed_files[i] = g_failed_files[i + 1];
    }
    g_failed_file_count--;
}

/* Check if a file already exists locally in /tmp */
int file_exists_locally(const char *filename) {
    char path[512];
    snprintf(path, sizeof(path), "/tmp/%s", filename);
    FILE *f = fopen(path, "rb");
    if (f) {
        fclose(f);
        return 1;
    }
    return 0;
}

/* Get the current count of failed files */
int get_failed_file_count(void) {
    return g_failed_file_count;
}

/* Get a failed file entry by index */
const FailedFile* get_failed_file(int index) {
    if (index < 0 || index >= g_failed_file_count) {
        return NULL;
    }
    return &g_failed_files[index];
}
