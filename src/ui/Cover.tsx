/** Album cover from the local cover folder, or a quiet placeholder with the name's initial. */
export function Cover({ src, name, size = 40, round = false, title }: { src?: string | null; name: string; size?: number; round?: boolean; title?: string }) {
  const style = { width: size, height: size, borderRadius: round ? '50%' : Math.max(4, size / 10) };
  if (src) return <img className="cover" src={src} alt="" width={size} height={size} style={style} loading="lazy" decoding="async" title={title} />;
  const initial = (name.replace(/^the\s+/i, '').trim()[0] ?? '?').toUpperCase();
  return <span className="cover cover-empty" style={{ ...style, fontSize: size * 0.42 }} aria-hidden="true" title={title}>{initial}</span>;
}
