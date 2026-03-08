/*
 * camera_filemgmt - File management and failed file tracking
 *
 * Header file for file management functions used by gphoto2-controller.
 */

#ifndef CAMERA_FILEMGMT_H
#define CAMERA_FILEMGMT_H

#include <time.h>

/* Configuration constants */
#define MAX_DOWNLOAD_RETRIES 3     /* Max download attempts before skipping a file */
#define FAILED_FILE_RESET_SEC 300  /* Reset failed files after 5 minutes */
#define MAX_FAILED_FILES 50        /* Maximum number of failed files to track */

/* Track files that have failed to download */
typedef struct {
    char filename[128];
    int retry_count;
    time_t first_failure;
} FailedFile;

/*
 * Reset old failed file entries (called periodically)
 * Removes entries older than FAILED_FILE_RESET_SEC
 */
void reset_old_failed_files(void);

/*
 * Find a failed file entry
 * Returns: index of the entry, or -1 if not found
 */
int find_failed_file(const char *filename);

/*
 * Check if a file should be skipped due to too many failures
 * Returns: 1 if should skip, 0 otherwise
 */
int should_skip_file(const char *filename);

/*
 * Record a failed download attempt
 * Returns: new retry count for this file
 */
int record_failed_download(const char *filename);

/*
 * Clear a file from failed list (on successful download)
 */
void clear_failed_file(const char *filename);

/*
 * Check if a file already exists locally in /tmp
 * Returns: 1 if exists, 0 otherwise
 */
int file_exists_locally(const char *filename);

/*
 * Get the current count of failed files
 * Returns: number of entries in the failed files table
 */
int get_failed_file_count(void);

/*
 * Get a failed file entry by index
 * Returns: pointer to FailedFile struct, or NULL if index out of range
 */
const FailedFile* get_failed_file(int index);

#endif /* CAMERA_FILEMGMT_H */
