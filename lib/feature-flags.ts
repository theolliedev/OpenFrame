import { logError } from '@/lib/logger';

function readBooleanEnv(name: string, defaultValue: boolean): boolean {
  const value = process.env[name];
  if (!value) return defaultValue;

  const normalized = value.trim().toLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;

  return defaultValue;
}

let warnedAboutConflictingUploadFlags = false;

function warnIfConflictingDirectUploadFlags(): void {
  if (warnedAboutConflictingUploadFlags) return;
  if (!isS3VideoUploadsFeatureEnabled() || !isBunnyUploadsFeatureEnabled()) return;
  if (!hasR2Config() || !hasBunnyUploadsConfig()) return;

  warnedAboutConflictingUploadFlags = true;
  logError(
    'OPENFRAME_ENABLE_S3_VIDEO_UPLOADS and OPENFRAME_ENABLE_BUNNY_UPLOADS are both enabled with valid config. S3 video uploads take precedence; disable Bunny uploads for self-hosted deployments.',
    new Error('Conflicting direct upload feature flags')
  );
}

export function isStripeFeatureEnabled() {
  return readBooleanEnv('OPENFRAME_ENABLE_STRIPE', true);
}

export function hasStripeConfig() {
  return Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_PRICE_ID);
}

export function isStripeBillingEnabled() {
  return isStripeFeatureEnabled() && hasStripeConfig();
}

export function isBunnyUploadsFeatureEnabled() {
  return readBooleanEnv('OPENFRAME_ENABLE_BUNNY_UPLOADS', true);
}

export function hasBunnyUploadsConfig() {
  return Boolean(
    process.env.BUNNY_STREAM_API_KEY &&
    (process.env.BUNNY_STREAM_LIBRARY_ID || process.env.NEXT_PUBLIC_BUNNY_STREAM_LIBRARY_ID)
  );
}

export function isS3VideoUploadsFeatureEnabled() {
  return readBooleanEnv('OPENFRAME_ENABLE_S3_VIDEO_UPLOADS', false);
}

export function hasR2Config() {
  return Boolean(
    process.env.R2_ACCESS_KEY_ID &&
    process.env.R2_SECRET_ACCESS_KEY &&
    process.env.R2_BUCKET_NAME &&
    (process.env.R2_ENDPOINT || process.env.R2_ACCOUNT_ID)
  );
}

export function isS3VideoUploadsEnabled() {
  warnIfConflictingDirectUploadFlags();
  return isS3VideoUploadsFeatureEnabled() && hasR2Config();
}

export function isBunnyUploadsEnabled() {
  if (isS3VideoUploadsEnabled()) {
    return false;
  }
  return isBunnyUploadsFeatureEnabled() && hasBunnyUploadsConfig();
}

export function isDirectFileUploadEnabled() {
  return isS3VideoUploadsEnabled() || isBunnyUploadsEnabled();
}

export function getMaxVideoUploadBytes(): bigint {
  const raw = process.env.OPENFRAME_MAX_VIDEO_UPLOAD_BYTES?.trim();
  if (!raw) {
    return BigInt(5) * BigInt(1024) * BigInt(1024) * BigInt(1024);
  }

  try {
    const parsed = BigInt(raw);
    if (parsed <= BigInt(0)) {
      return BigInt(5) * BigInt(1024) * BigInt(1024) * BigInt(1024);
    }
    return parsed;
  } catch {
    return BigInt(5) * BigInt(1024) * BigInt(1024) * BigInt(1024);
  }
}

export function isInviteCodeRequired() {
  return readBooleanEnv('OPENFRAME_REQUIRE_INVITE_CODE', true);
}

function parseBigIntEnv(name: string, defaultValue: bigint, minValue?: bigint): bigint {
  const raw = process.env[name]?.trim();
  if (!raw) return defaultValue;

  try {
    const parsed = BigInt(raw);
    if (parsed <= BigInt(0)) return defaultValue;
    if (minValue !== undefined && parsed < minValue) return minValue;
    return parsed;
  } catch {
    return defaultValue;
  }
}

// Files larger than this use S3 multipart upload (chunked) instead of a single PUT.
// Default 90 MiB keeps each request under the common 100 MB Cloudflare proxy/tunnel cap.
export function getR2MultipartThresholdBytes(): bigint {
  return parseBigIntEnv(
    'OPENFRAME_R2_MULTIPART_THRESHOLD_BYTES',
    BigInt(90) * BigInt(1024) * BigInt(1024)
  );
}

// Size of each multipart chunk. Clamped to the S3 minimum of 5 MiB for non-final parts.
export function getR2MultipartPartSizeBytes(): bigint {
  const minPartSize = BigInt(5) * BigInt(1024) * BigInt(1024);
  return parseBigIntEnv(
    'OPENFRAME_R2_MULTIPART_PART_SIZE_BYTES',
    BigInt(32) * BigInt(1024) * BigInt(1024),
    minPartSize
  );
}
