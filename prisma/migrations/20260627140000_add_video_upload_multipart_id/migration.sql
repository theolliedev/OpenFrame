-- AlterTable: track the S3/R2 multipart upload id so chunked uploads can be completed/aborted.
ALTER TABLE "video_upload_sessions" ADD COLUMN "multipart_upload_id" TEXT;
