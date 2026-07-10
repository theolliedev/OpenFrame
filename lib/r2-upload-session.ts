import { db } from '@/lib/db';

export type CreateR2UploadSessionInput = {
  userId: string;
  projectId: string;
  billedUserId: string;
  objectKey: string;
  thumbnailObjectKey: string;
  declaredSizeBytes: bigint;
  contentType: string;
  reservationId: string | null;
  uploadJti: string;
  expiresAt: Date;
  multipartUploadId?: string | null;
};

export async function createR2UploadSession(input: CreateR2UploadSessionInput) {
  return db.videoUploadSession.create({
    data: {
      userId: input.userId,
      projectId: input.projectId,
      billedUserId: input.billedUserId,
      objectKey: input.objectKey,
      thumbnailObjectKey: input.thumbnailObjectKey,
      declaredSizeBytes: input.declaredSizeBytes,
      contentType: input.contentType,
      reservationId: input.reservationId,
      uploadJti: input.uploadJti,
      expiresAt: input.expiresAt,
      multipartUploadId: input.multipartUploadId ?? null,
    },
  });
}

export async function cancelR2UploadSession(sessionId: string) {
  return db.videoUploadSession.updateMany({
    where: {
      id: sessionId,
      status: 'INITIATED',
      expiresAt: { gt: new Date() },
    },
    data: {
      status: 'CANCELLED',
      consumedAt: new Date(),
    },
  });
}
