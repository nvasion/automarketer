// A screenshot of the real app, framed like a browser window. Each shot exists
// once per theme (src/assets/shots/<name>-automarketer|light|dark.webp, made by
// scripts/shots.mjs); CSS shows the one that matches the theme, and lazy
// loading means the hidden ones are never fetched.

const SHOTS = import.meta.glob<string>('../../assets/shots/*.webp', { eager: true, import: 'default' })

const VARIANTS = ['automarketer', 'light', 'dark'] as const

function shotUrl(name: string, variant: string): string | undefined {
  return SHOTS[`../../assets/shots/${name}-${variant}.webp`]
}

export function Shot({ name, alt, path }: { name: string; alt: string; path: string }) {
  // A missing capture falls back to the light one, so a new theme never shows a hole.
  const fallback = shotUrl(name, 'light')
  return (
    <figure className="shot">
      <div className="shot-bar" aria-hidden="true">
        <span className="shot-dots">
          <i />
          <i />
          <i />
        </span>
        <span className="shot-url">automarketer.tynhub.com{path}</span>
      </div>
      {fallback ? (
        VARIANTS.map((v) => (
          <img
            key={v}
            className={`shot-img shot-${v}`}
            src={shotUrl(name, v) ?? fallback}
            alt={alt}
            loading="lazy"
            width={1440}
            height={900}
          />
        ))
      ) : (
        <div className="shot-missing" role="img" aria-label={alt} />
      )}
    </figure>
  )
}
