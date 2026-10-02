import { useRef, useState, type DragEvent } from 'react';

interface Props {
  busy: boolean;
  progress: { done: number; total: number; label: string } | null;
  onFiles: (files: File[]) => void;
  onDemo: () => void;
}

export function ImportPanel({ busy, progress, onFiles, onDemo }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const drop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    if (!busy) onFiles([...e.dataTransfer.files]);
  };
  return (
    <section className="card import" aria-labelledby="import-title">
      <h2 id="import-title">Load your Extended Streaming History</h2>
      <div
        className={`dropzone${over ? ' over' : ''}${busy ? ' busy' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={drop}
      >
        {busy ? (
          <div className="progress" role="status" aria-live="polite">
            <div className="progress-bar"><span style={{ width: `${progress && progress.total ? (progress.done / progress.total) * 100 : 5}%` }} /></div>
            <p>Reading files in a background worker{progress && progress.total ? ` (${progress.done} of ${progress.total})` : ''}…</p>
          </div>
        ) : (
          <>
            <p className="drop-lead">Drop the ZIP or the <code>Streaming_History_Audio_*.json</code> files here</p>
            <button type="button" className="btn primary" onClick={() => input.current?.click()}>Choose files</button>
            <input
              ref={input}
              type="file"
              multiple
              accept=".zip,.json,application/zip,application/json"
              hidden
              data-testid="file-input"
              onChange={(e) => {
                const files = [...(e.target.files ?? [])];
                e.target.value = '';
                if (files.length) onFiles(files);
              }}
            />
            <p className="muted small">or <button type="button" className="link" onClick={onDemo}>explore with synthetic demo data</button></p>
          </>
        )}
      </div>
      <ul className="privacy-points">
        <li><b>Stays in this tab.</b> Files are read in your browser. Nothing is uploaded, and the page cannot make network requests at all.</li>
        <li><b>Not saved.</b> Nothing is written to browser storage. Reloading or closing the tab clears everything.</li>
        <li><b>Only PNG/SVG exports</b> that you download yourself leave the page.</li>
      </ul>
      <details className="howto">
        <summary>How to get the export</summary>
        <p>In your Spotify account, open <i>Privacy settings</i> and request <b>Extended streaming history</b>. Spotify says this can take up to 30 days. The one-year “Account data” export has a different, reduced format and is not supported here.</p>
      </details>
    </section>
  );
}
