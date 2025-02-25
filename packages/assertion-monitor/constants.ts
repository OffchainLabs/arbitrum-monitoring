/** Maximum number of days to look back when scanning for assertions */
export const MAXIMUM_SEARCH_DAYS = 7

/** Number of hours to check for recent creation events */
export const RECENT_CREATION_CHECK_HOURS = 4

/** Number of hours to consider an event "recent" for confirmation checks */
export const RECENT_EVENT_HOURS = 24

/** Maximum number of blocks a validator can be inactive before alerts are triggered */
export const VALIDATOR_AFK_BLOCKS = 45818

/** Buffer period in days to avoid scanning too close to the current block */
export const SAFETY_BUFFER_DAYS = 4

/** Number of blocks to process in each chunk when fetching logs to avoid RPC timeouts */
export const CHUNK_SIZE = 800n

/** Number of seconds in a day */
export const SECONDS_IN_A_DAY = 24 * 60 * 60

/** Challenge period in seconds (6.4 days) */
export const CHALLENGE_PERIOD_SECONDS = 6.4 * SECONDS_IN_A_DAY

/** Search window in seconds (7 days) */
export const SEARCH_WINDOW_SECONDS = MAXIMUM_SEARCH_DAYS * SECONDS_IN_A_DAY

/** Recent activity threshold in seconds (4 hours) */
export const RECENT_ACTIVITY_SECONDS = RECENT_CREATION_CHECK_HOURS * 60 * 60

/** Convert hours to seconds for timestamp comparison */
export const hoursToSeconds = (hours: number) => hours * 60 * 60 