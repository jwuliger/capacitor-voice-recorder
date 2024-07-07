package com.tchvu3.capacitorvoicerecorder;

import android.content.Context;
import android.media.MediaRecorder;
import android.os.Build;

import java.io.File;
import java.io.IOException;

public class CustomMediaRecorder {

    private final Context context;
    private MediaRecorder mediaRecorder;
    private File outputFile;
    private CurrentRecordingStatus currentRecordingStatus = CurrentRecordingStatus.NONE;

    public CustomMediaRecorder(Context context) throws IOException {
        this.context = context;
        generateMediaRecorder();
    }

    private void generateMediaRecorder() throws IOException {
        mediaRecorder = new MediaRecorder();
        mediaRecorder.setAudioSource(MediaRecorder.AudioSource.MIC);
        mediaRecorder.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4); // Changed to MPEG_4 for M4A
        mediaRecorder.setAudioEncoder(MediaRecorder.AudioEncoder.AAC); // AAC encoder for M4A
        mediaRecorder.setAudioEncodingBitRate(128000); // 128 kbps
        mediaRecorder.setAudioSamplingRate(44100); // 44.1 kHz
        setRecorderOutputFile();
        mediaRecorder.prepare();
    }

    private void setRecorderOutputFile() throws IOException {
        File outputDir = context.getCacheDir();
        outputFile = File.createTempFile("voice_record_temp", ".m4a", outputDir); // Changed extension to .m4a
        outputFile.deleteOnExit();
        mediaRecorder.setOutputFile(outputFile.getAbsolutePath());
    }

    public void startRecording() {
        mediaRecorder.start();
        currentRecordingStatus = CurrentRecordingStatus.RECORDING;
    }

    public void stopRecording() {
        mediaRecorder.stop();
        mediaRecorder.release();
        currentRecordingStatus = CurrentRecordingStatus.NONE;
    }

    public File getOutputFile() {
        return outputFile;
    }

    public boolean pauseRecording() throws NotSupportedOsVersion {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N) {
            throw new NotSupportedOsVersion();
        }

        if (currentRecordingStatus == CurrentRecordingStatus.RECORDING) {
            mediaRecorder.pause();
            currentRecordingStatus = CurrentRecordingStatus.PAUSED;
            return true;
        } else {
            return false;
        }
    }

    public boolean resumeRecording() throws NotSupportedOsVersion {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N) {
            throw new NotSupportedOsVersion();
        }

        if (currentRecordingStatus == CurrentRecordingStatus.PAUSED) {
            mediaRecorder.resume();
            currentRecordingStatus = CurrentRecordingStatus.RECORDING;
            return true;
        } else {
            return false;
        }
    }

    public CurrentRecordingStatus getCurrentStatus() {
        return currentRecordingStatus;
    }

    public boolean deleteOutputFile() {
        return outputFile.delete();
    }

    public static boolean canPhoneCreateMediaRecorder(Context context) {
        return true;
    }

    private static boolean canPhoneCreateMediaRecorderWhileHavingPermission(Context context) {
        CustomMediaRecorder tempMediaRecorder = null;
        try {
            tempMediaRecorder = new CustomMediaRecorder(context);
            tempMediaRecorder.startRecording();
            tempMediaRecorder.stopRecording();
            return true;
        } catch (Exception exp) {
            return exp.getMessage().startsWith("stop failed");
        } finally {
            if (tempMediaRecorder != null)
                tempMediaRecorder.deleteOutputFile();
        }
    }
}