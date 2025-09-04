'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
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
  const [job, setJob] = useState<{ total: number; completed: number; failed: number; paused?: boolean } | null>(null);
  const pollTimer = useRef<any>(null);
  const [query, setQuery] = useState('');
  const [onlyNoShot, setOnlyNoShot] = useState(false);
  const [onlyError, setOnlyError] = useState(false);
  const [onlyNegative, setOnlyNegative] = useState(false);
  const [sortKey, setSortKey] = useState<'date'|'likes'|'replies'|'profile'|'neg'|'conf'|'none'>('none');
  const [sortDir, setSortDir] = useState<'asc'|'desc'>('desc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(100);
  // compact UI helpers
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});
  const toggleExpanded = (id: string) => setExpandedIds((prev) => ({ ...prev, [id]: !prev[id] }));
  // highlight toggle
  const [highlightRows, setHighlightRows] = useState<boolean>(true);
  // top horizontal scroll slider
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [scrollX, setScrollX] = useState(0);
  const [scrollMax, setScrollMax] = useState(0);
  // keep slider bounds in sync with container size; depends on visible count
  useEffect(() => {
    const update = () => {
      const el = scrollRef.current;
      if (!el) return;
      const max = Math.max(0, el.scrollWidth - el.clientWidth);
      setScrollMax(max);
      setScrollX(Math.min(el.scrollLeft, max));
    };
    update();
    const handle = () => update();
    window.addEventListener('resize', handle);
    return () => window.removeEventListener('resize', handle);
  }, [comments, page, pageSize, sortKey, sortDir, query, onlyNoShot, onlyError]);
  const onScrollContainer = () => {
    const el = scrollRef.current;
    if (!el) return;
    const max = Math.max(0, el.scrollWidth - el.clientWidth);
    setScrollMax(max);
    setScrollX(el.scrollLeft);
  };
  const onSliderChange = (val: number) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollLeft = val;
    setScrollX(val);
  };

  const filteredSorted = useMemo(() => {
    const list = comments
      .filter((c) => {
        const meta = JSON.parse(c.metadata);
        if (onlyNoShot && c.screenshot_path) return false;
        if (onlyError && !c.last_error) return false;
        if (onlyNegative) {
          const neg = (c as any).is_negative === true || (c as any).is_negative === 1;
          if (!neg) return false;
        }
        if (!query) return true;
        const q = query.toLowerCase();
        const hay = `${meta.profileName || ''} ${meta.text || ''}`.toLowerCase();
        return hay.includes(q);
      })
      .sort((a, b) => {
        if (sortKey === 'none') return 0;
        const am = JSON.parse(a.metadata);
        const bm = JSON.parse(b.metadata);
        let av = 0, bv = 0;
        if (sortKey === 'date') {
          av = am.date ? new Date(am.date).getTime() : 0;
          bv = bm.date ? new Date(bm.date).getTime() : 0;
        } else if (sortKey === 'likes') {
          av = Number(am.likesCount || 0);
          bv = Number(bm.likesCount || 0);
        } else if (sortKey === 'replies') {
          av = Number(am.commentsCount || 0);
          bv = Number(bm.commentsCount || 0);
        } else if (sortKey === 'profile') {
          return String(am.profileName || '').localeCompare(String(bm.profileName || '')) * (sortDir === 'asc' ? 1 : -1);
        } else if (sortKey === 'neg') {
          av = (a as any).is_negative ? 1 : 0;
          bv = (b as any).is_negative ? 1 : 0;
        } else if (sortKey === 'conf') {
          const an = (a as any);
          const bn = (b as any);
          const aConf = typeof an.confidence_score === 'number' ? an.confidence_score : -1;
          const bConf = typeof bn.confidence_score === 'number' ? bn.confidence_score : -1;
          // Severity sort: only count confidence for negative items; positives sink to bottom
          av = an.is_negative ? aConf : -1;
          bv = bn.is_negative ? bConf : -1;
        }
        return (av - bv) * (sortDir === 'asc' ? 1 : -1);
      });
    return list;
  }, [comments, query, onlyNoShot, onlyError, onlyNegative, sortKey, sortDir]);

  const total = filteredSorted.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * pageSize;
  const end = Math.min(start + pageSize, total);
  const visible = filteredSorted.slice(start, end);

  useEffect(() => {
    setPage(1);
  }, [query, onlyNoShot, onlyError, sortKey, sortDir, pageSize]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [totalPages]);
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
      .map((c) => {
        const meta = JSON.parse(c.metadata);
        const snippet = typeof meta?.text === 'string' ? meta.text.slice(0, 160) : '';
        return { id: c.id, url: c.url, snippet } as any;
      });
    if (todo.length === 0) {
      alert('Alle Kommentare haben bereits Screenshots.');
      return;
    }
    await window.electronAPI.startBatchScreenshots({ postId, comments: todo });
    startPollingJob();
  };

  const takeSelectedScreenshots = async () => {
    const todo = comments
      .filter((c) => selectedIds[c.id])
      .map((c) => {
        const meta = JSON.parse(c.metadata);
        const snippet = typeof meta?.text === 'string' ? meta.text.slice(0, 160) : '';
        return { id: c.id, url: c.url, snippet } as any;
      });
    if (todo.length === 0) {
      alert('Bitte wähle mindestens einen Kommentar aus.');
      return;
    }
    await window.electronAPI.startBatchScreenshots({ postId, comments: todo });
    startPollingJob();
  };

  const retakeSelectedScreenshots = async () => {
    const todo = comments
      .filter((c) => selectedIds[c.id] && !!c.screenshot_path)
      .map((c) => {
        const meta = JSON.parse(c.metadata);
        const snippet = typeof meta?.text === 'string' ? meta.text.slice(0, 160) : '';
        return { id: c.id, url: c.url, snippet } as any;
      });
    if (todo.length === 0) {
      alert('Bitte wähle Kommentare mit bestehendem Screenshot aus.');
      return;
    }
    await window.electronAPI.startBatchScreenshots({ postId, comments: todo });
    startPollingJob();
  };

  const startPollingJob = () => {
    if (pollTimer.current) clearTimeout(pollTimer.current);
    const poll = async () => {
      const st = await window.electronAPI.getBatchStatus();
      if (st?.success && st.job) {
        setJob({ total: st.job.total, completed: st.job.completed, failed: st.job.failed, paused: st.job.paused });
        pollTimer.current = setTimeout(poll, 800);
      } else {
        // job done
        setJob(null);
        const refreshed = await window.electronAPI.getComments({ postId });
        if (refreshed.success) setComments(refreshed.comments);
        setSelectedIds({});
        if (pollTimer.current) clearTimeout(pollTimer.current);
      }
    };
    pollTimer.current = setTimeout(poll, 500);
  };

  const pauseJob = async () => { await window.electronAPI.pauseBatch(); };
  const resumeJob = async () => { await window.electronAPI.resumeBatch(); };
  const cancelJob = async () => { await window.electronAPI.cancelBatch(); };

  const deleteSelectedScreenshots = async () => {
    const ids = comments.filter((c) => selectedIds[c.id]).map((c) => c.id);
    if (ids.length === 0) {
      alert('Bitte wähle mindestens einen Kommentar aus.');
      return;
    }
    const res = await window.electronAPI.deleteScreenshotsBatch(ids);
    if (res.success) {
      alert(`Gelöscht: ${res.completed}, Fehler: ${res.failed}`);
      const refreshed = await window.electronAPI.getComments({ postId });
      if (refreshed.success) setComments(refreshed.comments);
      setSelectedIds({});
    } else {
      alert('Fehler beim Löschen.');
    }
  };

  const analyzeSelected = async () => {
    const ids = Object.entries(selectedIds).filter(([id, v]) => v).map(([id]) => id);
    if (ids.length === 0) {
      alert('Bitte wähle mindestens einen Kommentar aus.');
      return;
    }
    const res = await window.electronAPI.analyzeComments(ids, undefined, 100);
    if (!res?.success) {
      alert('Analyse fehlgeschlagen: ' + (res?.error || 'Unbekannt'));
      return;
    }
    const refreshed = await window.electronAPI.getComments({ postId });
    if (refreshed.success) setComments(refreshed.comments);
  };

  const analyzeMissing = async () => {
    const ids = comments.filter((c) => !c.confidence_score && !c.reasoning && !c.is_negative).map((c) => c.id);
    if (ids.length === 0) {
      alert('Keine offenen Kommentare für Analyse.');
      return;
    }
    const res = await window.electronAPI.analyzeComments(ids, undefined, 100);
    if (!res?.success) {
      alert('Analyse fehlgeschlagen: ' + (res?.error || 'Unbekannt'));
      return;
    }
    const refreshed = await window.electronAPI.getComments({ postId });
    if (refreshed.success) setComments(refreshed.comments);
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
              <button className="btn-secondary" onClick={() => window.electronAPI.openLikesFolder(postId)}>
                Likes-Ordner öffnen
              </button>
              <button className="btn-secondary" onClick={deleteSelectedScreenshots}>
                Screenshots löschen (ausgewählte)
              </button>
              <button className="btn-secondary" onClick={takeSelectedScreenshots} disabled={!!job}>
                Neu aufnehmen (ausgewählte)
              </button>
              <button className="btn-secondary" onClick={retakeSelectedScreenshots} disabled={!!job}>
                Erneut aufnehmen (ausgewählte)
              </button>
              <button className="btn-primary" onClick={takeBatchScreenshots} disabled={!!job}>
                Screenshots (fehlende)
              </button>
              <div className="border-l h-6 mx-2" />
              <button
                className="btn-secondary"
                onClick={async () => {
                  const ids = Object.entries(selectedIds).filter(([id, v]) => v).map(([id]) => id);
                  const res = await window.electronAPI.exportJson(postId, '', ids);
                  if (!res?.success && !res?.cancelled) alert('Export JSON fehlgeschlagen: ' + (res?.error || 'Unbekannt'));
                }}
              >
                Export JSON
              </button>
              <button
                className="btn-secondary"
                onClick={async () => {
                  const ids = Object.entries(selectedIds).filter(([id, v]) => v).map(([id]) => id);
                  const res = await window.electronAPI.exportPdf(postId, '', ids);
                  if (!res?.success && !res?.cancelled) alert('Export PDF fehlgeschlagen: ' + (res?.error || 'Unbekannt'));
                }}
              >
                Export PDF
              </button>
              <div className="border-l h-6 mx-2" />
              <button className="btn-secondary" onClick={analyzeSelected}>Analysieren (ausgewählte)</button>
              <button className="btn-primary" onClick={analyzeMissing}>Analysieren (fehlende)</button>
            </div>
          </div>
          {job && (
            <div className="mb-4">
              <div className="flex items-center justify-between text-sm text-gray-700 mb-1">
                <span>Fortschritt: {job.completed + job.failed} / {job.total}</span>
                <span>Fehler: {job.failed}</span>
              </div>
              <div className="w-full bg-gray-200 rounded h-2 overflow-hidden">
                <div
                  className="bg-blue-600 h-2"
                  style={{ width: `${Math.min(100, Math.round(((job.completed + job.failed) / job.total) * 100))}%` }}
                />
              </div>
              <div className="mt-2 flex gap-2">
                {!job.paused ? (
                  <button className="btn-secondary text-sm" onClick={pauseJob}>Pausieren</button>
                ) : (
                  <button className="btn-secondary text-sm" onClick={resumeJob}>Fortsetzen</button>
                )}
                <button className="btn-secondary text-sm" onClick={cancelJob}>Abbrechen</button>
              </div>
            </div>
          )}
          {comments.length === 0 ? (
            <div className="text-gray-500">Keine Kommentare gefunden.</div>
          ) : (
            <>
              {scrollMax > 0 && (
                <div className="sticky top-0 z-30 bg-white/90 backdrop-blur p-2 border-b mb-2">
                  <input
                    type="range"
                    min={0}
                    max={Math.max(0, Math.round(scrollMax))}
                    value={Math.min(scrollX, scrollMax)}
                    onChange={(e) => onSliderChange(parseInt(e.target.value || '0', 10))}
                    className="w-full"
                  />
                </div>
              )}
              <div className="overflow-x-auto" ref={scrollRef} onScroll={onScrollContainer}>
              {/* Filter/Sort Controls */}
              <div className="mb-3 flex flex-col md:flex-row gap-2 md:items-center md:justify-between">
                <div className="flex gap-2 items-center">
                  <input
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Suche (Text/Autor)"
                    className="border rounded px-3 py-2 w-64"
                  />
                  <label className="inline-flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={onlyNoShot} onChange={(e) => setOnlyNoShot(e.target.checked)} />
                    nur ohne Screenshot
                  </label>
                  <label className="inline-flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={onlyError} onChange={(e) => setOnlyError(e.target.checked)} />
                    nur Fehler
                  </label>
                  <label className="inline-flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={onlyNegative} onChange={(e) => setOnlyNegative(e.target.checked)} />
                    nur negativ
                  </label>
                  <label className="inline-flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={highlightRows} onChange={(e) => setHighlightRows(e.target.checked)} />
                    Farbmarkierung
                  </label>
                </div>
                <div className="flex gap-2 items-center">
                  <select value={sortKey} onChange={(e) => setSortKey(e.target.value as any)} className="border rounded px-2 py-2">
                    <option value="none">Keine Sortierung</option>
                    <option value="date">Datum</option>
                    <option value="likes">Likes</option>
                    <option value="replies">Antworten</option>
                    <option value="profile">Autor</option>
                    <option value="neg">Negativ</option>
                    <option value="conf">Konfidenz</option>
                  </select>
                  <select value={sortDir} onChange={(e) => setSortDir(e.target.value as any)} className="border rounded px-2 py-2">
                    <option value="desc">Desc</option>
                    <option value="asc">Asc</option>
                  </select>
                </div>
              </div>
              <div className="mb-2 flex items-center justify-between text-sm text-gray-600">
                <div>
                  Zeige {start + 1}-{end} von {total}
                </div>
                <div className="flex items-center gap-2">
                  <button className="btn-secondary text-sm" disabled={safePage <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>Zurück</button>
                  <span>Seite {safePage}/{totalPages}</span>
                  <button className="btn-secondary text-sm" disabled={safePage >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>Weiter</button>
                  <select className="border rounded px-2 py-1" value={pageSize} onChange={(e) => setPageSize(parseInt(e.target.value, 10))}>
                    <option value={50}>50</option>
                    <option value={100}>100</option>
                    <option value={200}>200</option>
                    <option value={500}>500</option>
                  </select>
                </div>
              </div>

              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="table-header sticky left-0 bg-gray-50 z-20 w-10">
                      <input type="checkbox" className="h-4 w-4" checked={allSelected} onChange={toggleAll} />
                    </th>
                    <th className="table-header sticky left-0 bg-gray-50 z-10 min-w-[220px]">Aktionen</th>
                    <th className="table-header">Autor</th>
                    <th className="table-header">Datum</th>
                    <th className="table-header min-w-[420px]">Text</th>
                    <th className="table-header">Likes</th>
                    <th className="table-header">Antworten</th>
                    <th className="table-header">AI Negativ</th>
                    <th className="table-header">AI Konfidenz</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {visible.map((c) => {
                    const meta = JSON.parse(c.metadata);
                    return (
                      <tr key={c.id} className={`hover:bg-gray-50 ${highlightRows && typeof (c as any).is_negative !== 'undefined' ? ((c as any).is_negative ? 'bg-red-50' : 'bg-green-50') : ''}`}>
                        <td className="table-cell sticky left-0 bg-white z-20 w-10 py-2">
                          <input
                            type="checkbox"
                            className="h-4 w-4"
                            checked={!!selectedIds[c.id]}
                            onChange={(e) => setSelectedIds((prev) => ({ ...prev, [c.id]: e.target.checked }))}
                          />
                        </td>
                        <td className="table-cell sticky left-0 bg-white z-10 min-w-[220px] py-2">
                          <div className="flex gap-2">
                            <button className="btn-secondary text-sm" onClick={() => openDetails(c)}>
                              Details
                            </button>
                            {c.screenshot_path ? (
                              <>
                                <button className="btn-secondary text-sm" onClick={() => openScreenshot(c.screenshot_path!)}>
                                  Screenshot
                                </button>
                                <button
                                  className="btn-secondary text-sm"
                                  onClick={async () => {
                                    const meta = JSON.parse(c.metadata);
                                    const snippet = typeof meta?.text === 'string' ? meta.text.slice(0, 160) : '';
                                    const res = await window.electronAPI.takeLikesScreenshot({ postId, commentUrl: c.url, commentId: c.id, snippet });
                                    if (!res?.success) alert('Likes-Screenshot fehlgeschlagen: ' + (res?.error || 'Unbekannt'));
                                  }}
                                >
                                  Likes-Screenshot
                                </button>
                                <button
                                  className="btn-secondary text-sm"
                                  onClick={async () => {
                                    const meta = JSON.parse(c.metadata);
                                    const snippet = typeof meta?.text === 'string' ? meta.text.slice(0, 160) : '';
                                    const res = await window.electronAPI.takeScreenshot({ postId, commentUrl: c.url, commentId: c.id, snippet });
                                    if (!res?.success) alert('Erneut aufnehmen fehlgeschlagen: ' + (res?.error || 'Unbekannter Fehler'));
                                    const refreshed = await window.electronAPI.getComments({ postId });
                                    if (refreshed.success) setComments(refreshed.comments);
                                  }}
                                >
                                  Erneut aufnehmen
                                </button>
                              </>
                            ) : (
                              <button
                                className="btn-secondary text-sm"
                                onClick={async () => {
                                  const meta = JSON.parse(c.metadata);
                                  const snippet = typeof meta?.text === 'string' ? meta.text.slice(0, 160) : '';
                                  const res = await window.electronAPI.takeScreenshot({ postId, commentUrl: c.url, commentId: c.id, snippet });
                                  if (!res?.success) alert('Neuaufnahme fehlgeschlagen: ' + (res?.error || 'Unbekannter Fehler'));
                                  const refreshed = await window.electronAPI.getComments({ postId });
                                  if (refreshed.success) setComments(refreshed.comments);
                                }}
                              >
                                Neu aufnehmen
                              </button>
                            )}
                          </div>
                        </td>
                        <td className="table-cell min-w-[160px] py-2">{meta.profileName}</td>
                        <td className="table-cell whitespace-nowrap py-2">{new Date(meta.date).toLocaleString('de-DE')}</td>
                        <td className="table-cell max-w-3xl py-2">
                          <div className={expandedIds[c.id] ? 'whitespace-pre-wrap select-text' : 'text-gray-900 line-clamp-2 select-text'}>
                            {meta.text}
                          </div>
                          <div className="flex items-center gap-2">
                            <button className="text-xs text-blue-600" onClick={() => toggleExpanded(c.id)}>
                              {expandedIds[c.id] ? 'Weniger' : 'Mehr'}
                            </button>
                            <a href={c.url} target="_blank" rel="noreferrer" className="text-xs text-blue-600">Link</a>
                          </div>
                        </td>
                        <td className="table-cell py-2">{meta.likesCount ?? '-'}</td>
                        <td className="table-cell py-2">{meta.commentsCount ?? '-'}</td>
                        <td className="table-cell py-2">
                          {typeof (c as any).is_negative !== 'undefined' ? (
                            <span className={(c as any).is_negative ? 'text-red-600' : 'text-green-700'}>{(c as any).is_negative ? 'Ja' : 'Nein'}</span>
                          ) : '—'}
                        </td>
                        <td className="table-cell py-2">
                          {typeof (c as any).confidence_score === 'number' ? `${Math.round(((c as any).confidence_score || 0) * 100)}%` : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              </div>
            </>
          )}
        </div>
      )}

      <CommentDetailsModal open={open} onClose={() => setOpen(false)} comment={selected} />
    </div>
  );
}


