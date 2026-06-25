'use client';
import React from 'react';

const SEARCH_ENGINES = {
  google:     (q) => `https://www.google.com/search?q=${encodeURIComponent(q)}`,
  bing:       (q) => `https://www.bing.com/search?q=${encodeURIComponent(q)}`,
  duckduckgo: (q) => `https://duckduckgo.com/?q=${encodeURIComponent(q)}`,
  perplexity: (q) => `https://www.perplexity.ai/search?q=${encodeURIComponent(q)}`,
  brave:      (q) => `https://search.brave.com/search?q=${encodeURIComponent(q)}`,
};

function isSearchQuery(input) {
  return !input.includes('.') && !input.startsWith('http');
}

function stripScripts(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/\s+on\w+="[^"]*"/gi, '')
    .replace(/\s+on\w+='[^']*'/gi, '')
    .replace(/<img[^>]+(?:gen_204|pixel\.gif|track|beacon)[^>]*>/gi, '');
}

export default function MainComponent() {
  const [inputValue, setInputValue]   = React.useState('');
  const [currentUrl, setCurrentUrl]   = React.useState('');
  const [iframeSrc, setIframeSrc]     = React.useState('');
  const [loading, setLoading]         = React.useState(false);
  const [error, setError]             = React.useState(null);
  const [history, setHistory]         = React.useState([]);
  const [historyIndex, setHistoryIndex] = React.useState(-1);
  const [searchEngine, setSearchEngine] = React.useState('google');
  const abortRef    = React.useRef(null);
  const iframeRef   = React.useRef(null);
  const prevBlobRef = React.useRef(null);

  const navigate = React.useCallback(async (targetUrl) => {
    if (!targetUrl) return;
    if (abortRef.current) abortRef.current.abort();

    let fullUrl = targetUrl;
    if (!fullUrl.startsWith('http://') && !fullUrl.startsWith('https://'))
      fullUrl = 'https://' + fullUrl;

    setLoading(true);
    setError(null);
    setInputValue(fullUrl);

    try {
      abortRef.current = new AbortController();
      const res = await fetch('/api/proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: fullUrl }),
        signal: abortRef.current.signal,
      });

      if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`);
      const html = await res.text();
      if (!html?.trim()) throw new Error('Empty response from website');

      if (prevBlobRef.current) {
        URL.revokeObjectURL(prevBlobRef.current);
        prevBlobRef.current = null;
      }

      const clean   = stripScripts(html);
      const blob    = new Blob([clean], { type: 'text/html' });
      const blobUrl = URL.createObjectURL(blob);
      prevBlobRef.current = blobUrl;

      setIframeSrc(blobUrl);
      setCurrentUrl(fullUrl);

      setHistory((prev) => {
        const next = prev.slice(0, historyIndex + 1);
        next.push(fullUrl);
        return next;
      });
      setHistoryIndex((i) => i + 1);
    } catch (err) {
      if (err.name === 'AbortError') return;
      setError(`Failed to load: ${err.message}`);
    } finally {
      setLoading(false);
      abortRef.current = null;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historyIndex]);

  const handleSubmit = (e) => {
    e.preventDefault();
    const val = inputValue.trim();
    if (!val) return;
    if (isSearchQuery(val)) navigate(SEARCH_ENGINES[searchEngine](val));
    else navigate(val);
  };

  const goBack = () => {
    if (historyIndex > 0) navigate(history[historyIndex - 1]);
  };

  const goForward = () => {
    if (historyIndex < history.length - 1) navigate(history[historyIndex + 1]);
  };

  const handleReset = () => {
    setCurrentUrl('');
    setIframeSrc('');
    setError(null);
    setInputValue('');
  };

  React.useEffect(() => {
    return () => {
      if (abortRef.current) abortRef.current.abort();
      if (prevBlobRef.current) URL.revokeObjectURL(prevBlobRef.current);
    };
  }, []);

  const canBack = historyIndex > 0;
  const canFwd  = historyIndex < history.length - 1;

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 flex flex-col">
      {/* Toolbar */}
      <header className="bg-gray-900 border-b border-gray-800 sticky top-0 z-10 shadow-lg">
        <div className="w-full px-2 sm:px-4 py-2 sm:py-3">

          {/* Row 1: logo + nav + engine + open */}
          <div className="flex items-center gap-1 sm:gap-2 mb-2">
            {/* Logo */}
            <div className="flex items-center gap-1.5 mr-2 flex-shrink-0">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className="text-emerald-400">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.5"/>
                <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" stroke="currentColor" strokeWidth="1.5"/>
              </svg>
              <span className="font-bold text-sm tracking-tight text-white">ONE</span>
            </div>

            <NavBtn onClick={goBack}    disabled={!canBack}               title="Back">
              <i className="fas fa-arrow-left text-xs" />
            </NavBtn>
            <NavBtn onClick={goForward} disabled={!canFwd}                title="Forward">
              <i className="fas fa-arrow-right text-xs" />
            </NavBtn>
            <NavBtn onClick={() => currentUrl && navigate(currentUrl)} disabled={!currentUrl || loading} title="Reload">
              {loading
                ? <i className="fas fa-spinner fa-spin text-xs" />
                : <i className="fas fa-redo text-xs" />}
            </NavBtn>
            <NavBtn onClick={handleReset} title="Home">
              <i className="fas fa-home text-xs" />
            </NavBtn>

            <div className="flex-1" />

            <select
              value={searchEngine}
              onChange={(e) => setSearchEngine(e.target.value)}
              className="text-xs border border-gray-700 rounded px-1.5 py-1 bg-gray-800 text-gray-300 focus:outline-none focus:border-emerald-500"
            >
              <option value="google">Google</option>
              <option value="bing">Bing</option>
              <option value="duckduckgo">DDG</option>
              <option value="perplexity">Perplexity</option>
              <option value="brave">Brave</option>
            </select>

            {currentUrl && (
              <button
                onClick={() => window.open(currentUrl, '_blank', 'noopener,noreferrer')}
                className="px-2 py-1 text-xs bg-gray-800 text-gray-400 hover:text-white border border-gray-700 hover:border-gray-500 rounded transition-colors"
                title="Open in new tab"
              >
                <i className="fas fa-external-link-alt" />
              </button>
            )}
          </div>

          {/* Row 2: URL bar */}
          <form onSubmit={handleSubmit} className="flex gap-2">
            <div className="relative flex-1">
              {currentUrl && (
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-emerald-400 pointer-events-none">
                  <i className="fas fa-lock text-xs" />
                </span>
              )}
              <input
                type="text"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onFocus={(e) => e.target.select()}
                placeholder="Enter URL or search…"
                className={`w-full bg-gray-800 border border-gray-700 rounded-full py-1.5 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/30 transition-all ${
                  currentUrl ? 'pl-8 pr-4' : 'px-4'
                }`}
                autoComplete="off"
                spellCheck={false}
              />
            </div>
            <button
              type="submit"
              disabled={loading || !inputValue.trim()}
              className="px-5 py-1.5 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 text-black font-semibold text-sm rounded-full transition-colors flex-shrink-0"
            >
              Go
            </button>
          </form>

          {/* Row 3: status strip */}
          {currentUrl && (
            <div className="mt-1.5 flex items-center text-xs text-gray-500 gap-1 overflow-hidden">
              <span className="truncate">{currentUrl}</span>
              <span className="flex-shrink-0 ml-auto text-gray-600">
                {history.length > 0 && `${historyIndex + 1} / ${history.length}`}
              </span>
            </div>
          )}
        </div>
      </header>

      {/* Loading bar */}
      {loading && (
        <div className="h-0.5 bg-gray-800 relative overflow-hidden flex-shrink-0">
          <div className="absolute inset-y-0 bg-emerald-400 animate-[progress_1.4s_ease-in-out_infinite] w-1/3" />
          <style>{`@keyframes progress{0%{left:-33%}100%{left:100%}}`}</style>
        </div>
      )}

      {/* Main */}
      <main className="flex-1 flex flex-col">
        {error && (
          <div className="mx-3 mt-3 p-3 bg-red-950 border border-red-800 text-red-400 rounded-lg text-sm">
            <i className="fas fa-exclamation-triangle mr-2" />{error}
          </div>
        )}

        {!iframeSrc && !loading && !error && <EmptyState onNavigate={navigate} />}

        {iframeSrc && (
          <iframe
            ref={iframeRef}
            src={iframeSrc}
            className="flex-1 w-full border-0 bg-white"
            style={{ minHeight: 'calc(100vh - 110px)' }}
            title="ONE Browser viewport"
            sandbox="allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox"
          />
        )}
      </main>
    </div>
  );
}

function NavBtn({ onClick, disabled, title, children }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`p-2 rounded-lg text-sm transition-colors ${
        disabled ? 'text-gray-700 cursor-not-allowed' : 'text-gray-400 hover:text-white hover:bg-gray-800'
      }`}
    >
      {children}
    </button>
  );
}

function EmptyState({ onNavigate }) {
  const quickLinks = [
    { label: 'Google',      url: 'https://www.google.com',                 icon: 'fa-magnifying-glass' },
    { label: 'Perplexity',  url: 'https://www.perplexity.ai',              icon: 'fa-star' },
    { label: 'GitHub',      url: 'https://github.com/Manitec',             icon: 'fa-code-branch' },
    { label: 'Vercel',      url: 'https://vercel.com/manitecs-projects',   icon: 'fa-triangle' },
    { label: 'HuggingFace', url: 'https://huggingface.co',                 icon: 'fa-robot' },
    { label: "Joe's Faves", url: 'https://joesfaves.com',                  icon: 'fa-star' },
  ];

  return (
    <div className="flex-1 flex items-center justify-center px-4 py-16">
      <div className="text-center max-w-md">
        <svg width="56" height="56" viewBox="0 0 24 24" fill="none" className="mx-auto mb-5 text-gray-700">
          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1"/>
          <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" stroke="currentColor" strokeWidth="1"/>
        </svg>
        <h2 className="text-xl font-bold text-white mb-1">ONE Browser</h2>
        <p className="text-sm text-gray-500 mb-6">Browse through the empire&apos;s own proxy.</p>
        <div className="flex flex-wrap gap-2 justify-center">
          {quickLinks.map(({ label, url, icon }) => (
            <button
              key={label}
              onClick={() => onNavigate(url)}
              className="flex items-center gap-1.5 px-3 py-2 bg-gray-900 border border-gray-800 hover:border-emerald-500/50 hover:text-white text-gray-400 text-xs rounded-lg transition-colors"
            >
              <i className={`fas ${icon} text-xs`} />{label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
