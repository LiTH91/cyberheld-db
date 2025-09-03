'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { XMarkIcon, ArrowTopRightOnSquareIcon, PhotoIcon } from '@heroicons/react/24/outline';
import type { Comment } from '@/types/facebook';
import type { ReactNode } from 'react';

type Props = {
  open: boolean;
  onClose: () => void;
  comment: Comment | null;
};

export default function CommentDetailsModal({ open, onClose, comment }: Props) {
  // Hooks always at top-level to avoid dev warnings
  const [preview, setPreview] = useState<string | null>(null);
  const meta = useMemo(() => (comment ? safeParse(comment.metadata) : null), [comment]);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      if (open && comment?.screenshot_path) {
        const url = await window.electronAPI.readScreenshotDataUrl(comment.screenshot_path);
        if (mounted) setPreview(url || null);
      } else {
        setPreview(null);
      }
    };
    load();
    return () => { mounted = false; };
  }, [open, comment?.screenshot_path]);

  const openScreenshot = async () => {
    if (comment?.screenshot_path) {
      await window.electronAPI.openScreenshot(comment.screenshot_path);
    }
  };

  if (!open || !comment) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />

      <div className="relative bg-white w-full max-w-3xl rounded-xl shadow-lg border border-gray-200">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h3 className="text-lg font-semibold text-gray-900">Kommentar-Details</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700">
            <XMarkIcon className="h-6 w-6" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <DetailItem label="Kommentar-URL">
              <a
                href={comment.url}
                target="_blank"
                rel="noreferrer"
                className="text-blue-600 inline-flex items-center gap-1"
              >
                Öffnen <ArrowTopRightOnSquareIcon className="h-4 w-4" />
              </a>
            </DetailItem>

            <DetailItem label="Datum">
              {meta?.date ? new Date(meta.date).toLocaleString('de-DE') : '—'}
            </DetailItem>

            <DetailItem label="Likes">
              {meta?.likesCount ?? '—'}
            </DetailItem>

            <DetailItem label="Antworten">
              {meta?.commentsCount ?? '—'}
            </DetailItem>

            <DetailItem label="Thread-Tiefe">
              {meta?.threadingDepth ?? '—'}
            </DetailItem>

            <DetailItem label="Profile-ID">
              {meta?.profileId ?? '—'}
            </DetailItem>

            <DetailItem label="Profil-Name">
              {meta?.profileName ?? '—'}
            </DetailItem>

            <DetailItem label="Profil-Link">
              {meta?.profileUrl ? (
                <a href={meta.profileUrl} target="_blank" rel="noreferrer" className="text-blue-600 inline-flex items-center gap-1">
                  Öffnen <ArrowTopRightOnSquareIcon className="h-4 w-4" />
                </a>
              ) : '—'}
            </DetailItem>
          </div>

          <DetailItem label="Text">
            <div className="whitespace-pre-wrap text-gray-900">{meta?.text ?? '—'}</div>
          </DetailItem>

          <DetailItem label="Screenshot">
            {comment.screenshot_path ? (
              <div className="space-y-2">
                {preview ? (
                  <img src={preview} alt="Screenshot Preview" className="max-h-80 rounded border" />
                ) : (
                  <div className="text-gray-500 text-sm">Keine Vorschau verfügbar</div>
                )}
                <button className="btn-secondary inline-flex items-center gap-2" onClick={openScreenshot}>
                  <PhotoIcon className="h-4 w-4" /> In Ordner öffnen
                </button>
              </div>
            ) : (
              <span className="text-gray-500">Kein Screenshot vorhanden</span>
            )}
          </DetailItem>
        </div>

        <div className="px-6 py-4 border-t border-gray-200 flex justify-end">
          <button className="btn-secondary" onClick={onClose}>Schließen</button>
        </div>
      </div>
    </div>
  );
}

function DetailItem({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-gray-500 mb-1">{label}</div>
      <div className="text-sm text-gray-900 break-words">{children}</div>
    </div>
  );
}

function safeParse(json: string): any {
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}


