import { NextRequest } from 'next/server';
import { revalidatePath } from 'next/cache';
import { auth, checkProjectAccess } from '@/lib/auth';
import { apiErrors, successResponse, withCacheControl } from '@/lib/api-response';
import { db } from '@/lib/db';
import { logError } from '@/lib/logger';
import { rateLimit } from '@/lib/rate-limit';

type RouteParams = { params: Promise<{ projectId: string }> };

const MAX_BULK_MOVE = 50;

// Thrown inside the move transaction when the atomic source-ownership re-check
// fails (a concurrent request relocated a video between check and commit).
class VideoMoveConflictError extends Error {}

// GET /api/projects/[projectId]/videos/move
// Lists destination projects (same workspace, manageable by the user) the
// current project's videos can be moved into.
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const limited = await rateLimit(request, 'api');
    if (limited) return limited;

    const session = await auth();
    const { projectId } = await params;

    if (!session?.user?.id) {
      return apiErrors.unauthorized();
    }
    const userId = session.user.id;

    const project = await db.project.findUnique({
      where: { id: projectId },
      select: { id: true, ownerId: true, workspaceId: true, visibility: true },
    });
    if (!project) {
      return apiErrors.notFound('Project');
    }

    const access = await checkProjectAccess(project, userId, { intent: 'manage' });
    if (!access.canEdit) {
      return apiErrors.forbidden('Access denied');
    }

    // Workspace owners/admins can manage every project in the workspace; everyone
    // else can only move into projects they own or are an admin member of.
    const [workspace, workspaceMember] = await Promise.all([
      db.workspace.findUnique({
        where: { id: project.workspaceId },
        select: { ownerId: true },
      }),
      db.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId: project.workspaceId, userId } },
      }),
    ]);
    const isWorkspaceManager = workspace?.ownerId === userId || workspaceMember?.role === 'ADMIN';

    const targets = await db.project.findMany({
      where: {
        workspaceId: project.workspaceId,
        id: { not: projectId },
        ...(isWorkspaceManager
          ? {}
          : {
              OR: [{ ownerId: userId }, { members: { some: { userId, role: 'ADMIN' } } }],
            }),
      },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    });

    const response = successResponse({ projects: targets });
    return withCacheControl(response, 'private, no-store');
  } catch (error) {
    logError('Error listing video move targets:', error);
    return apiErrors.internalError('Failed to load destination projects');
  }
}

// POST /api/projects/[projectId]/videos/move
// Moves one or more videos from this project into another project in the same
// workspace. Versions, comments and assets follow the video automatically.
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const limited = await rateLimit(request, 'mutate');
    if (limited) return limited;

    const session = await auth();
    const { projectId } = await params;

    if (!session?.user?.id) {
      return apiErrors.unauthorized();
    }
    const userId = session.user.id;

    const body = await request.json();
    const { videoIds, targetProjectId } = body as {
      videoIds?: unknown;
      targetProjectId?: unknown;
    };

    if (!Array.isArray(videoIds) || videoIds.length === 0) {
      return apiErrors.badRequest('videoIds must be a non-empty array');
    }
    if (videoIds.length > MAX_BULK_MOVE) {
      return apiErrors.badRequest(`You can move at most ${MAX_BULK_MOVE} videos at once`);
    }
    if (!videoIds.every((id) => typeof id === 'string' && id.trim().length > 0)) {
      return apiErrors.badRequest('Each video id must be a non-empty string');
    }
    if (typeof targetProjectId !== 'string' || targetProjectId.trim().length === 0) {
      return apiErrors.badRequest('targetProjectId must be a non-empty string');
    }

    const normalizedIds = [...new Set(videoIds.map((id) => id.trim()))];
    const targetId = targetProjectId.trim();

    if (targetId === projectId) {
      return apiErrors.badRequest('Source and destination projects are the same');
    }

    const [sourceProject, targetProject] = await Promise.all([
      db.project.findUnique({
        where: { id: projectId },
        select: { id: true, ownerId: true, workspaceId: true, visibility: true },
      }),
      db.project.findUnique({
        where: { id: targetId },
        select: { id: true, ownerId: true, workspaceId: true, visibility: true },
      }),
    ]);
    if (!sourceProject) {
      return apiErrors.notFound('Project');
    }
    if (!targetProject) {
      return apiErrors.badRequest('Destination project not found');
    }
    if (sourceProject.workspaceId !== targetProject.workspaceId) {
      return apiErrors.badRequest('Videos can only be moved within the same workspace');
    }

    const [sourceAccess, targetAccess] = await Promise.all([
      checkProjectAccess(sourceProject, userId, { intent: 'manage' }),
      checkProjectAccess(targetProject, userId, { intent: 'manage' }),
    ]);
    if (!sourceAccess.canEdit) {
      return apiErrors.forbidden('You cannot move videos out of this project');
    }
    if (!targetAccess.canEdit) {
      return apiErrors.forbidden('You cannot move videos into the selected project');
    }

    // Fast, friendly pre-check for the common case (stale UI). The authoritative
    // ownership guard is re-asserted atomically inside the transaction below.
    const videos = await db.video.findMany({
      where: { id: { in: normalizedIds }, projectId },
      select: { id: true },
    });
    if (videos.length !== normalizedIds.length) {
      return apiErrors.badRequest('One or more selected videos do not belong to this project');
    }

    try {
      await db.$transaction(async (tx) => {
        // Append moved videos after the destination's existing videos so ordering
        // stays stable instead of colliding with the source positions. Read this
        // before the move so the videos being moved aren't counted yet.
        const maxPosition = await tx.video.aggregate({
          where: { projectId: targetId },
          _max: { position: true },
        });
        const basePosition = (maxPosition._max.position ?? -1) + 1;

        // Re-assert source ownership as part of the write itself: a concurrent
        // move can't slip a video out from under us between check and commit,
        // and the row locks serialize competing moves of the same videos.
        const moved = await tx.video.updateMany({
          where: { id: { in: normalizedIds }, projectId },
          data: { projectId: targetId },
        });
        if (moved.count !== normalizedIds.length) {
          throw new VideoMoveConflictError();
        }

        // Apply per-video ordering now that the videos live in the destination.
        await Promise.all(
          normalizedIds.map((id, index) =>
            tx.video.update({ where: { id }, data: { position: basePosition + index } })
          )
        );

        // Keep video-scoped share links pointing at the video's new project.
        await tx.shareLink.updateMany({
          where: { videoId: { in: normalizedIds } },
          data: { projectId: targetId },
        });
      });
    } catch (error) {
      if (error instanceof VideoMoveConflictError) {
        return apiErrors.conflict(
          'One or more selected videos changed while moving. Please refresh and try again.'
        );
      }
      throw error;
    }

    revalidatePath(`/projects/${projectId}`);
    revalidatePath(`/projects/${targetId}`);

    const response = successResponse({
      message: `${normalizedIds.length} video${normalizedIds.length === 1 ? '' : 's'} moved`,
      movedCount: normalizedIds.length,
      targetProjectId: targetId,
    });
    return withCacheControl(response, 'private, no-store');
  } catch (error) {
    logError('Error moving videos:', error);
    return apiErrors.internalError('Failed to move videos');
  }
}
