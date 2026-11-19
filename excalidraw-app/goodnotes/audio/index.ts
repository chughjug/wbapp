export {
  collectMarks,
  formatTimecode,
  indexMarks,
  isMarkable,
  LEAD_IN_MS,
  seedSeen,
  seekTargetFor,
} from "./marks";
export type { AudioMark, MarkableElement } from "./marks";

export {
  AudioRecorderError,
  describeMicError,
  pickMimeType,
  startRecording,
} from "./recorder";
export type { AudioRecorderHandle, RecorderState } from "./recorder";

export {
  blobToArrayBuffer,
  defaultLabelFor,
  deleteRecording,
  forgetRecordings,
  getRecording,
  getRecordingBlob,
  listRecordings,
  recordingsSize,
  renameRecording,
  saveRecording,
} from "./store";
export type { Recording, RecordingSummary } from "./store";

export { useAudio } from "./useAudio";
export type { AudioPhase, UseAudioResult } from "./useAudio";

export { AudioBar } from "./AudioBar";
export type { AudioBarProps } from "./AudioBar";
