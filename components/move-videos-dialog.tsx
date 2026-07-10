'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { FolderInput, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface MoveTarget {
  id: string;
  name: string;
}

interface MoveVideosDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Source project the videos currently belong to. */
  projectId: string;
  /** Videos to move. */
  videoIds: string[];
  /** Called after a successful move with the ids that were moved. */
  onMoved?: (movedIds: string[]) => void;
}

export function MoveVideosDialog({
  open,
  onOpenChange,
  projectId,
  videoIds,
  onMoved,
}: MoveVideosDialogProps) {
  const router = useRouter();
  const [targets, setTargets] = useState<MoveTarget[] | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [isMoving, setIsMoving] = useState(false);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    setIsLoading(true);
    setLoadError('');
    setTargets(null);
    setSelectedId('');

    fetch(`/api/projects/${projectId}/videos/move`, { cache: 'no-store' })
      .then(async (res) => {
        const body = await res.json().catch(() => null);
        if (!res.ok) {
          throw new Error(typeof body?.error === 'string' ? body.error : 'Failed to load projects');
        }
        if (cancelled) return;
        setTargets((body?.data?.projects as MoveTarget[] | undefined) ?? []);
      })
      .catch((err) => {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : 'Failed to load projects');
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, projectId]);

  const count = videoIds.length;
  const noun = count === 1 ? 'video' : 'videos';

  const handleMove = async () => {
    if (!selectedId || isMoving) return;
    setIsMoving(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/videos/move`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoIds, targetProjectId: selectedId }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(typeof body?.error === 'string' ? body.error : 'Failed to move videos');
        return;
      }
      toast.success(typeof body?.data?.message === 'string' ? body.data.message : 'Videos moved');
      onOpenChange(false);
      onMoved?.(videoIds);
      router.refresh();
    } catch {
      toast.error('Failed to move videos');
    } finally {
      setIsMoving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            Move {count === 1 ? 'video' : `${count} videos`} to another project
          </DialogTitle>
          <DialogDescription>
            Choose a destination project in this workspace. Versions, comments and assets move with
            the {noun}.
          </DialogDescription>
        </DialogHeader>

        <div className="py-2">
          {isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading projects…
            </div>
          ) : loadError ? (
            <p className="text-sm text-destructive">{loadError}</p>
          ) : targets && targets.length > 0 ? (
            <Select value={selectedId} onValueChange={setSelectedId} disabled={isMoving}>
              <SelectTrigger>
                <SelectValue placeholder="Select a project" />
              </SelectTrigger>
              <SelectContent>
                {targets.map((target) => (
                  <SelectItem key={target.id} value={target.id}>
                    {target.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <p className="text-sm text-muted-foreground">
              No other projects in this workspace are available to move to.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={isMoving}>
            Cancel
          </Button>
          <Button onClick={handleMove} disabled={!selectedId || isMoving}>
            {isMoving ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <FolderInput className="h-4 w-4 mr-2" />
            )}
            Move
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
