'use client';

import { useEffect, useState } from 'react';

export default function SettingsPage() {
  const [cookieSaved, setCookieSaved] = useState<boolean | null>(null);
  const [chromePath, setChromePath] = useState<string>('');
  const [lastExec, setLastExec] = useState<string | null>(null);
  const [minDelay, setMinDelay] = useState<number>(2);
  const [maxDelay, setMaxDelay] = useState<number>(6);
  const [fixedBackoff, setFixedBackoff] = useState<boolean>(false);
  const [aiLegalContext, setAiLegalContext] = useState<string>('');
  const [aiBatchSize, setAiBatchSize] = useState<number>(100);
  const [likesAddCounterOverlay, setLikesAddCounterOverlay] = useState<boolean>(false);
  const [likesSecondBottomPass, setLikesSecondBottomPass] = useState<boolean>(false);

  useEffect(() => {
    const load = async () => {
      try {
        const st = await window.electronAPI.getSettingsStatus();
        if (st?.success && st.status) {
          setCookieSaved(!!st.status.cookieSaved);
          setLastExec(st.status.lastExecutablePath || null);
          const s = st.status.settings;
          if (s) {
            setMinDelay(s.minDelaySec ?? 2);
            setMaxDelay(s.maxDelaySec ?? 6);
            setFixedBackoff(!!s.fixedBackoff);
            setChromePath(s.chromePath || '');
            setAiLegalContext(s.aiLegalContext || '');
            setAiBatchSize(Number(s.aiBatchSize || 100));
            setLikesAddCounterOverlay(!!s.likesAddCounterOverlay);
            setLikesSecondBottomPass(!!s.likesSecondBottomPass);
          }
        }
      } catch {}
    };
    load();
  }, []);

  const handleClearCookies = async () => {
    const res = await window.electronAPI.clearCookies();
    if (res?.success) setCookieSaved(false);
  };

  const handleSave = async () => {
    const payload = {
      minDelaySec: Math.max(1, Number(minDelay) || 2),
      maxDelaySec: Math.max(1, Number(maxDelay) || 6),
      fixedBackoff,
      chromePath: chromePath.trim(),
      aiLegalContext: aiLegalContext,
      aiBatchSize: Math.max(1, Math.min(200, Number(aiBatchSize) || 100)),
      likesAddCounterOverlay,
      likesSecondBottomPass,
    };
    const res = await window.electronAPI.saveSettings(payload);
    if (res?.success) {
      alert('Einstellungen gespeichert.');
    } else {
      alert('Speichern fehlgeschlagen: ' + (res?.error || 'Unbekannter Fehler'));
    }
  };

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">Einstellungen</h2>
        <p className="text-gray-600">Steuerung für Wartezeiten, Browser und Login</p>
      </div>

      <div className="card space-y-4">
        <h3 className="text-lg font-semibold text-gray-900">Wartezeiten</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="text-sm text-gray-600">Min (Sekunden)</label>
            <input type="number" className="mt-1 w-full border rounded px-3 py-2" value={minDelay} onChange={(e) => setMinDelay(parseInt(e.target.value || '0', 10))} />
          </div>
          <div>
            <label className="text-sm text-gray-600">Max (Sekunden)</label>
            <input type="number" className="mt-1 w-full border rounded px-3 py-2" value={maxDelay} onChange={(e) => setMaxDelay(parseInt(e.target.value || '0', 10))} />
          </div>
          <div className="flex items-end">
            <label className="inline-flex items-center gap-2">
              <input type="checkbox" checked={fixedBackoff} onChange={(e) => setFixedBackoff(e.target.checked)} />
              Feste Sequenz verwenden
            </label>
          </div>
        </div>
        <p className="text-xs text-gray-500">Hinweis: Aktuell per Umgebungsvariablen (FIXED_BACKOFF=1) steuerbar; UI-Persistenz folgt.</p>
      </div>

      <div className="card space-y-3">
        <h3 className="text-lg font-semibold text-gray-900">Browser</h3>
        <label className="text-sm text-gray-600">CHROME_PATH</label>
        <input type="text" className="mt-1 w-full border rounded px-3 py-2" value={chromePath} onChange={(e) => setChromePath(e.target.value)} placeholder="C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" />
        <p className="text-xs text-gray-500">Zuletzt verwendet: {lastExec || '—'}</p>
        <div className="flex gap-2">
          <button className="btn-primary" onClick={handleSave}>Speichern</button>
          <a href="/" className="btn-secondary">Zurück</a>
        </div>
      </div>

      <div className="card space-y-3">
        <h3 className="text-lg font-semibold text-gray-900">Likes-Screenshots</h3>
        <div className="flex items-center gap-4">
          <label className="inline-flex items-center gap-2">
            <input type="checkbox" checked={likesAddCounterOverlay} onChange={(e) => setLikesAddCounterOverlay(e.target.checked)} />
            Zähler-Overlay anzeigen (gesichtete Namen)
          </label>
        </div>
        <div className="flex items-center gap-4">
          <label className="inline-flex items-center gap-2">
            <input type="checkbox" checked={likesSecondBottomPass} onChange={(e) => setLikesSecondBottomPass(e.target.checked)} />
            Second-Bottom-Pass (Laden am Ende triggern)
          </label>
        </div>
        <div className="flex gap-2">
          <button className="btn-primary" onClick={handleSave}>Speichern</button>
          <a href="/" className="btn-secondary">Zurück</a>
        </div>
      </div>

      <div className="card space-y-3">
        <h3 className="text-lg font-semibold text-gray-900">KI – Rechtlicher Kontext</h3>
        <p className="text-sm text-gray-600">Füge hier den rechtlichen Prompt/Leitfaden ein, der der KI mitgegeben wird.</p>
        <textarea className="mt-1 w-full border rounded px-3 py-2 min-h-[180px]" value={aiLegalContext} onChange={(e) => setAiLegalContext(e.target.value)} placeholder="Rechtlicher Kontext (optional)"></textarea>
        <div>
          <label className="text-sm text-gray-600">Batch-Größe (1–200)</label>
          <input type="number" className="mt-1 w-40 border rounded px-3 py-2" value={aiBatchSize} onChange={(e) => setAiBatchSize(parseInt(e.target.value || '0', 10))} />
        </div>
        <div className="flex gap-2">
          <button className="btn-primary" onClick={handleSave}>Speichern</button>
          <a href="/" className="btn-secondary">Zurück</a>
        </div>
      </div>

      <div className="card space-y-3">
        <h3 className="text-lg font-semibold text-gray-900">Login & Cookies</h3>
        <div className="text-sm">Cookies gespeichert: {cookieSaved === null ? '—' : (cookieSaved ? 'Ja' : 'Nein')}</div>
        <div className="flex gap-2">
          <a href="/" className="btn-secondary">Zurück</a>
          <button className="btn-secondary" onClick={handleClearCookies}>Cookies löschen</button>
        </div>
      </div>
    </div>
  );
}


