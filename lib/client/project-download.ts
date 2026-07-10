'use client';

import { downloadNamedFile, navigateDownload } from '@/lib/client/download-file';

const DOWNLOAD_STAGGER_MS = 500;

export type ManifestDownloadProgress = {
  /** 1-based index of the file currently downloading. */
  index: number;
  total: number;
  fileName: string;
  receivedBytes: number;
  totalBytes: number | null;
};

export type ProjectDownloadManifestFile = {
  fileName: string;
  url: string;
  sizeBytes: number | null;
};

export type ProjectDownloadManifest = {
  projectName: string;
  files: ProjectDownloadManifestFile[];
  totalFiles: number;
  totalBytes: string | null;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function triggerBrowserDownload(
  file: ProjectDownloadManifestFile,
  onProgress?: (received: number, total: number | null) => void
): Promise<void> {
  // Same-origin proxy files (R2 / S3 / MinIO via /api/upload/video/...): the
  // download attribute applies and the browser streams straight to disk, so the
  // name is correct at any size with no memory cost (browser shows its own
  // progress, so we don't track bytes here).
  if (file.url.startsWith('/api/upload/video/')) {
    navigateDownload(file.url, file.fileName);
    return;
  }

  // Bunny (CDN redirect) and external direct hosts are cross-origin, so the name
  // only applies if we fetch the bytes. downloadNamedFile does that for files up
  // to 10 GB; larger ones fall back to a plain navigation (CDN filename).
  const saved = await downloadNamedFile(file.url, file.fileName, (p) =>
    onProgress?.(p.receivedBytes, p.totalBytes)
  );
  if (!saved) {
    navigateDownload(file.url, file.fileName);
  }
}

export async function runProjectDownloadManifest(
  manifest: ProjectDownloadManifest,
  onProgress?: (progress: ManifestDownloadProgress) => void
): Promise<void> {
  const total = manifest.files.length;
  for (let index = 0; index < total; index += 1) {
    const file = manifest.files[index]!;
    onProgress?.({
      index: index + 1,
      total,
      fileName: file.fileName,
      receivedBytes: 0,
      totalBytes: file.sizeBytes,
    });
    // Sequential so at most one file is buffered in memory at a time.
    await triggerBrowserDownload(file, (received, fileTotal) =>
      onProgress?.({
        index: index + 1,
        total,
        fileName: file.fileName,
        receivedBytes: received,
        totalBytes: fileTotal,
      })
    );
    if (index < total - 1) {
      await sleep(DOWNLOAD_STAGGER_MS);
    }
  }
}
