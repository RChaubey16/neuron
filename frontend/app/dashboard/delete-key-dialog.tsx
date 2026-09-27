'use client';

import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import type { ApiKey } from '@/lib/api';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

export function DeleteKeyDialog({
  apiKey,
  pending,
  onConfirm,
  onOpenChange,
}: {
  apiKey: ApiKey | null;
  pending: boolean;
  onConfirm: (id: string) => void;
  onOpenChange: (open: boolean) => void;
}) {
  // Keep showing the last key while the close animation plays, instead of
  // its text blanking out the moment `apiKey` resets to null.
  const [shownKey, setShownKey] = useState(apiKey);
  if (apiKey && apiKey !== shownKey) setShownKey(apiKey);
  const label = shownKey?.name ?? `${shownKey?.keyPrefix}…`;

  return (
    <AlertDialog open={apiKey !== null} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete API key?</AlertDialogTitle>
          <AlertDialogDescription>
            <span className="font-medium text-fg">{label}</span> will be
            removed from this list.{' '}
            {shownKey && !shownKey.revokedAt
              ? 'It stops working immediately — any app still using it will get 401 errors. '
              : ''}
            Its usage history is kept. This can&apos;t be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={pending}
            onClick={(e) => {
              // Radix closes the dialog on Action click by default; keep it
              // open while the request is in flight so the user sees progress.
              e.preventDefault();
              if (apiKey) onConfirm(apiKey.id);
            }}
          >
            <Trash2 />
            {pending ? 'Deleting…' : 'Delete key'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
