/**
 * Shared shapes for the Canvas bridge relay.
 *
 * Laptop Chrome extension = "agent" (has the Canvas session).
 * iPad wbapp = "client" (requests sync, consumes payloads).
 */

/** @typedef {"waiting" | "running" | "ready" | "error" | "expired"} JobStatus */

/**
 * @typedef {object} BridgeFile
 * @property {string} id
 * @property {string} displayName
 * @property {string} [contentType]
 * @property {number} [size]
 * @property {string} [updatedAt]
 * @property {string} [downloadUrl] Canvas URL (extension may resolve)
 * @property {string} [dataBase64] optional inlined small file
 */

/**
 * @typedef {object} BridgeAssignment
 * @property {string} id
 * @property {string} name
 * @property {string | null} dueAt
 * @property {string} [htmlUrl]
 * @property {number | null} [pointsPossible]
 */

/**
 * @typedef {object} BridgeCourseSummary
 * @property {string} id
 * @property {string} name
 * @property {string} [courseCode]
 * @property {string} [term]
 */

/**
 * @typedef {object} BridgeCoursesPayload
 * @property {"courses"} kind
 * @property {string} host
 * @property {BridgeCourseSummary[]} courses
 * @property {number} syncedAt
 */

/**
 * @typedef {object} BridgeCoursePayload
 * @property {"course"} [kind]
 * @property {string} courseId
 * @property {string} courseName
 * @property {string} [courseCode]
 * @property {string} host
 * @property {BridgeAssignment[]} assignments
 * @property {BridgeFile[]} files
 * @property {number} syncedAt
 */

/**
 * @typedef {object} SyncJob
 * @property {string} id
 * @property {string} roomId
 * @property {JobStatus} status
 * @property {string} [courseId]
 * @property {string} [error]
 * @property {BridgeCoursePayload} [payload]
 * @property {number} createdAt
 * @property {number} updatedAt
 */

/**
 * @typedef {object} Room
 * @property {string} id
 * @property {string} pairCode
 * @property {string} agentSecret
 * @property {string} [canvasHost]
 * @property {number} createdAt
 * @property {number} lastAgentSeenAt
 * @property {Map<string, SyncJob>} jobs
 */

export {};
