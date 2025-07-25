/**
 * Converts timestamp string (HH:MM:SS or MM:SS) to seconds
 * @param {string} timeStr - Time string like "01:30" or "00:01:30"
 * @returns {number} - Time in seconds
 */
function timeToSeconds(timeStr) {
    if (!timeStr) return 0;
    
    const parts = timeStr.split(':').map(Number);
    
    if (parts.length === 2) {
        // MM:SS format
        return parts[0] * 60 + parts[1];
    } else if (parts.length === 3) {
        // HH:MM:SS format
        return parts[0] * 3600 + parts[1] * 60 + parts[2];
    }
    
    return 0;
}

/**
 * Converts seconds to timestamp string (MM:SS format)
 * @param {number} seconds - Time in seconds
 * @returns {string} - Formatted time string
 */
function secondsToTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Validates time range
 * @param {string} startTime - Start time string
 * @param {string} endTime - End time string
 * @returns {boolean} - True if valid range
 */
function isValidTimeRange(startTime, endTime) {
    if (!startTime || !endTime) return false;
    
    const start = timeToSeconds(startTime);
    const end = timeToSeconds(endTime);
    
    return start < end && start >= 0 && end > 0;
}

/**
 * Calculates duration between two timestamps
 * @param {string} startTime - Start time string
 * @param {string} endTime - End time string
 * @returns {number} - Duration in seconds
 */
function calculateDuration(startTime, endTime) {
    return timeToSeconds(endTime) - timeToSeconds(startTime);
}

/**
 * Formats duration for FFmpeg
 * @param {number} seconds - Duration in seconds
 * @returns {string} - FFmpeg compatible duration format (HH:MM:SS)
 */
function formatForFFmpeg(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

module.exports = {
    timeToSeconds,
    secondsToTime,
    isValidTimeRange,
    calculateDuration,
    formatForFFmpeg
}; 