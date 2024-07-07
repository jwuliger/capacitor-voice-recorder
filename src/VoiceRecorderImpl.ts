/**
 * @file This file contains the implementation of the VoiceRecorderImpl class,
 * which handles voice recording functionalities using the MediaRecorder API.
 */

import getBlobDuration from 'get-blob-duration';

import type { Base64String, CurrentRecordingStatus, GenericResponse, RecordingData } from './definitions';
import {
  alreadyRecordingError,
  couldNotQueryPermissionStatusError,
  deviceCannotVoiceRecordError,
  emptyRecordingError,
  failedToFetchRecordingError,
  failedToRecordError,
  failureResponse,
  missingPermissionError,
  recordingHasNotStartedError,
  successResponse,
} from './predefined-web-responses';

/**
 * Prioritized list of MIME types for audio recording.
 * The browser will use the first supported type in this list.
 * These types are chosen for compatibility with OpenAI's Whisper API:
 * - audio/mp4: MP4 container (usually with AAC codec)
 * - audio/mpeg: MP3 format
 * - audio/webm: WebM container
 * - audio/x-m4a: M4A format (AAC in MPEG-4 container)
 * - audio/ogg;codecs=opus: Ogg container with Opus codec (fallback)
 */
const possibleMimeTypes = ['audio/mp4', 'audio/mpeg', 'audio/webm', 'audio/x-m4a', 'audio/ogg;codecs=opus'];

/**
 * A promise that never resolves, used for initializing pendingResult.
 */
const neverResolvingPromise = (): Promise<any> => new Promise(() => undefined);

/**
 * Class that implements voice recording functionalities.
 */
export class VoiceRecorderImpl {
  private static readonly FALLBACK_MIME_TYPE = 'audio/webm';
  private mediaRecorder: MediaRecorder | null = null;
  private chunks: BlobPart[] = [];
  private pendingResult: Promise<RecordingData> = neverResolvingPromise();

  /**
   * Checks if the device can record audio.
   * @returns {Promise<GenericResponse>} Response indicating if the device can record audio.
   */
  public static async canDeviceVoiceRecord(): Promise<GenericResponse> {
    if (!navigator?.mediaDevices?.getUserMedia) {
      return failureResponse();
    }

    const mimeType = VoiceRecorderImpl.getSupportedMimeType();
    if (!mimeType) {
      return failureResponse();
    }

    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });
      return successResponse();
    } catch (error) {
      return failureResponse();
    }
  }

  /**
   * Starts recording audio.
   * @returns {Promise<GenericResponse>} Response indicating the result of starting the recording.
   * @throws Will throw an error if already recording or if the device cannot record audio.
   */
  public async startRecording(): Promise<GenericResponse> {
    if (this.mediaRecorder != null) {
      throw alreadyRecordingError();
    }
    const deviceCanRecord = await VoiceRecorderImpl.canDeviceVoiceRecord();
    if (!deviceCanRecord.value) {
      throw deviceCannotVoiceRecordError();
    }
    const havingPermission = await VoiceRecorderImpl.hasAudioRecordingPermission().catch(() => successResponse());
    if (!havingPermission.value) {
      throw missingPermissionError();
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      return this.onSuccessfullyStartedRecording(stream);
    } catch (error) {
      return this.onFailedToStartRecording();
    }
  }

  /**
   * Stops recording audio and returns the recorded data.
   * @returns {Promise<RecordingData>} The recorded audio data.
   * @throws Will throw an error if recording has not started or if there was an issue fetching the recording.
   */
  public async stopRecording(): Promise<RecordingData> {
    if (this.mediaRecorder == null) {
      throw recordingHasNotStartedError();
    }
    try {
      this.mediaRecorder.stop();
      this.mediaRecorder.stream.getTracks().forEach((track) => track.stop());
      return this.pendingResult;
    } catch (ignore) {
      throw failedToFetchRecordingError();
    } finally {
      this.prepareInstanceForNextOperation();
    }
  }

  /**
   * Checks if the user has granted audio recording permission.
   * @returns {Promise<GenericResponse>} Response indicating if audio recording permission is granted.
   */
  public static async hasAudioRecordingPermission(): Promise<GenericResponse> {
    return navigator.permissions
      .query({ name: 'microphone' as any })
      .then((result) => ({ value: result.state === 'granted' }))
      .catch(() => {
        throw couldNotQueryPermissionStatusError();
      });
  }

  /**
   * Requests audio recording permission from the user.
   * @returns {Promise<GenericResponse>} Response indicating if audio recording permission was granted.
   */
  public static async requestAudioRecordingPermission(): Promise<GenericResponse> {
    const havingPermission = await VoiceRecorderImpl.hasAudioRecordingPermission().catch(() => failureResponse());
    if (havingPermission.value) {
      return successResponse();
    }

    return navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then(() => successResponse())
      .catch(() => failureResponse());
  }

  /**
   * Pauses the ongoing audio recording.
   * @returns {Promise<GenericResponse>} Response indicating the result of pausing the recording.
   * @throws Will throw an error if recording has not started.
   */
  public pauseRecording(): Promise<GenericResponse> {
    if (this.mediaRecorder == null) {
      throw recordingHasNotStartedError();
    } else if (this.mediaRecorder.state === 'recording') {
      this.mediaRecorder.pause();
      return Promise.resolve(successResponse());
    } else {
      return Promise.resolve(failureResponse());
    }
  }

  /**
   * Resumes the paused audio recording.
   * @returns {Promise<GenericResponse>} Response indicating the result of resuming the recording.
   * @throws Will throw an error if recording has not started.
   */
  public resumeRecording(): Promise<GenericResponse> {
    if (this.mediaRecorder == null) {
      throw recordingHasNotStartedError();
    } else if (this.mediaRecorder.state === 'paused') {
      this.mediaRecorder.resume();
      return Promise.resolve(successResponse());
    } else {
      return Promise.resolve(failureResponse());
    }
  }

  /**
   * Gets the current status of the audio recording.
   * @returns {Promise<CurrentRecordingStatus>} The current recording status.
   */
  public getCurrentStatus(): Promise<CurrentRecordingStatus> {
    const status =
      this.mediaRecorder?.state === 'recording'
        ? 'RECORDING'
        : this.mediaRecorder?.state === 'paused'
        ? 'PAUSED'
        : 'NONE';
    return Promise.resolve({ status });
  }

  /**
   * Gets a supported MIME type for audio recording.
   * @returns {string | undefined} The supported MIME type or undefined if none are supported.
   */
  public static getSupportedMimeType(): string | undefined {
    if (MediaRecorder?.isTypeSupported == null) return undefined;
    return possibleMimeTypes.find((type) => MediaRecorder.isTypeSupported(type));
  }

  /**
   * Handles the successful start of audio recording.
   * @param {MediaStream} stream - The audio stream to record.
   * @returns {GenericResponse} Response indicating successful start of recording.
   */
  private onSuccessfullyStartedRecording(stream: MediaStream): GenericResponse {
    this.pendingResult = new Promise<RecordingData>((resolve, reject) => {
      const mimeType = VoiceRecorderImpl.getSupportedMimeType();
      const options: MediaRecorderOptions = mimeType ? { mimeType } : {};

      try {
        this.mediaRecorder = new MediaRecorder(stream, options);
      } catch (e) {
        reject(failedToRecordError());
        return;
      }

      if (!this.mediaRecorder) {
        reject(failedToRecordError());
        return;
      }

      this.mediaRecorder.onerror = () => {
        this.prepareInstanceForNextOperation();
        reject(failedToRecordError());
      };

      this.mediaRecorder.onstop = async () => {
        if (!this.mediaRecorder) {
          reject(failedToRecordError());
          return;
        }

        try {
          const actualMimeType = this.mediaRecorder.mimeType || VoiceRecorderImpl.FALLBACK_MIME_TYPE;
          const blobVoiceRecording = new Blob(this.chunks, { type: actualMimeType });
          if (blobVoiceRecording.size <= 0) {
            reject(emptyRecordingError());
            return;
          }
          const recordDataBase64 = await VoiceRecorderImpl.blobToBase64(blobVoiceRecording);
          const recordingDuration = await getBlobDuration(blobVoiceRecording);
          resolve({ value: { recordDataBase64, mimeType: actualMimeType, msDuration: recordingDuration * 1000 } });
        } catch (error) {
          reject(failedToFetchRecordingError());
        } finally {
          this.prepareInstanceForNextOperation();
        }
      };

      this.mediaRecorder.ondataavailable = (event: BlobEvent) => this.chunks.push(event.data);
      this.mediaRecorder.start();
    });
    return successResponse();
  }

  /**
   * Handles failure to start audio recording.
   * @returns {GenericResponse} Response indicating failure to start recording.
   */
  private onFailedToStartRecording(): GenericResponse {
    this.prepareInstanceForNextOperation();
    throw failedToRecordError();
  }

  /**
   * Converts a Blob to a Base64-encoded string.
   * @param {Blob} blob - The Blob to convert.
   * @returns {Promise<Base64String>} The Base64-encoded string.
   */
  private static blobToBase64(blob: Blob): Promise<Base64String> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        if (typeof reader.result === 'string') {
          const base64 = reader.result.split(',')[1];
          resolve(base64 ?? '');
        } else if (reader.result instanceof ArrayBuffer) {
          const uint8Array = new Uint8Array(reader.result);
          const binary = uint8Array.reduce((acc, byte) => acc + String.fromCharCode(byte), '');
          const base64 = btoa(binary);
          resolve(base64);
        } else {
          reject(new Error('Unexpected result type from FileReader'));
        }
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  /**
   * Prepares the instance for the next recording operation.
   */
  private prepareInstanceForNextOperation(): void {
    if (this.mediaRecorder != null && this.mediaRecorder.state === 'recording') {
      try {
        this.mediaRecorder.stop();
        // eslint-disable-next-line no-empty
      } catch (ignore) {}
    }
    this.pendingResult = neverResolvingPromise();
    this.mediaRecorder = null;
    this.chunks = [];
  }
}
