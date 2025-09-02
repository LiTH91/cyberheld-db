'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import type { Comment } from '@/types/facebook';
import { ArrowLeftIcon } from '@heroicons/react/24/outline';
import CommentDetailsModal from '@/components/CommentDetailsModal';

export default function PostCommentsPage() {
  const params = useParams<{ postId: string }>();
  const postId = useMemo(() => decodeURIComponent(params.postId), [params.postId]);
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Comment | null>(null);
  const [open, setOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Record<string, boolean>>({});
  const allSelected = useMemo(() => {
    if (comments.length === 0) return false;
    return comments.every((c) => selectedIds[c.id]);
  }, [comments, selectedIds]);

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        const res = await window.electronAPI.getComments({ postId });
        if (!res.success) {
          setError(res.error || 'Unbekannter Fehler');
          return;
        }
        setComments(res.comments);
      } catch (e: any) {
        setError(e?.message || String(e));
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [postId]);

  const openScreenshot = async (path: string | undefined) => {
    if (!path) return;
    await window.electronAPI.openScreenshot(path);
  };

  const openDetails = (comment: Comment) => {
    setSelected(comment);
    setOpen(true);
  };

  const takeBatchScreenshots = async () => {
    const todo = comments
      .filter((c) => !c.screenshot_path)
      .map((c) => ({ id: c.id, url: c.url }));
    if (todo.length === 0) {
      alert('Alle Kommentare haben bereits Screenshots.');
      return;
    }
    const res = await window.electronAPI.takeScreenshotsBatch({ postId, comments: todo });
    if (res.success) {
      alert(`Screenshots fertig. Erfolgreich: ${res.completed}, Fehlgeschlagen: ${res.failed}`);
      // reload
      const refreshed = await window.electronAPI.getComments({ postId });
      if (refreshed.success) setComments(refreshed.comments);
    } else {
      alert('Fehler beim Screenshot-Job.');
    }
  };

  const takeSelectedScreenshots = async () => {
    const todo = comments
      .filter((c) => selectedIds[c.id])
      .map((c) => ({ id: c.id, url: c.url }));
    if (todo.length === 0) {
      alert('Bitte wähle mindestens einen Kommentar aus.');
      return;
    }
    const res = await window.electronAPI.takeScreenshotsBatch({ postId, comments: todo });
    if (res.success) {
      alert(`Screenshots fertig. Erfolgreich: ${res.completed}, Fehlgeschlagen: ${res.failed}`);
      const refreshed = await window.electronAPI.getComments({ postId });
      if (refreshed.success) setComments(refreshed.comments);
      setSelectedIds({});
    } else {
      alert('Fehler beim Screenshot-Job.');
    }
  };

  const toggleAll = () => {
    if (allSelected) {
      setSelectedIds({});
    } else {
      const next = {} as Record<string, boolean>;
      comments.forEach((c) => (next[c.id] = true));
      setSelectedIds(next);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-6 flex items-center gap-3">
        <a href="/" className="btn-secondary inline-flex items-center gap-2">
          <ArrowLeftIcon className="h-4 w-4" />
          Zurück
        </a>
        <h2 className="text-2xl font-bold text-gray-900">Kommentare</h2>
        <span className="text-gray-500">für Post {postId}</span>
      </div>

      {loading && (
        <div className="text-gray-500">Lade Kommentare...</div>
      )}
      {error && (
        <div className="text-red-600">{error}</div>
      )}

      {!loading && !error && (
        <div className="card">
          <div className="flex justify-between items-center mb-4">
            <div className="text-sm text-gray-600">{comments.length} Kommentare</div>
            <div className="flex gap-2">
              <button className="btn-secondary" onClick={takeSelectedScreenshots}>
                Screenshots (ausgewählte)
              </button>
              <button className="btn-primary" onClick={takeBatchScreenshots}>
                Screenshots (fehlende)
              </button>
            </div>
          </div>
          {comments.length === 0 ? (
            <div className="text-gray-500">Keine Kommentare gefunden.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="table-header sticky left-0 bg-gray-50 z-20 w-10">
                      <input type="checkbox" className="h-4 w-4" checked={allSelected} onChange={toggleAll} />
                    </th>
                    <th className="table-header sticky left-0 bg-gray-50 z-10">Aktionen</th>
                    <th className="table-header">Autor</th>
                    <th className="table-header">Datum</th>
                    <th className="table-header">Text</th>
                    <th className="table-header">Likes</th>
                    <th className="table-header">Antworten</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {comments.map((c) => {
                    const meta = JSON.parse(c.metadata);
                    return (
                      <tr key={c.id} className="hover:bg-gray-50">
                        <td className="table-cell sticky left-0 bg-white z-20 w-10">
                          <input
                            type="checkbox"
                            className="h-4 w-4"
                            checked={!!selectedIds[c.id]}
                            onChange={(e) => setSelectedIds((prev) => ({ ...prev, [c.id]: e.target.checked }))}
                          />
                        </td>
                        <td className="table-cell sticky left-0 bg-white z-10 min-w-[150px]">
                          <div className="flex gap-2">
                            <button className="btn-secondary text-sm" onClick={() => openDetails(c)}>
                              Details
                            </button>
                            {c.screenshot_path ? (
                              <button className="btn-secondary text-sm" onClick={() => openScreenshot(c.screenshot_path!)}>
                                Screenshot
                              </button>
                            ) : null}
                          </div>
                        </td>
                        <td className="table-cell min-w-[160px]">{meta.profileName}</td>
                        <td className="table-cell whitespace-nowrap">{new Date(meta.date).toLocaleString('de-DE')}</td>
                        <td className="table-cell max-w-3xl cursor-pointer" onClick={() => openDetails(c)}>
                          <div className="text-gray-900 line-clamp-3 select-text">{meta.text}</div>
                          <a href={c.url} target="_blank" rel="noreferrer" className="text-xs text-blue-600">Link</a>
                        </td>
                        <td className="table-cell">{meta.likesCount ?? '-'}</td>
                        <td className="table-cell">{meta.commentsCount ?? '-'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <CommentDetailsModal open={open} onClose={() => setOpen(false)} comment={selected} />
    </div>
  );
}


