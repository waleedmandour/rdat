interface RdatLogoProps {
  className?: string;
  size?: number;
}

/**
 * RDAT: Translation Copilot logo.
 *
 * Uses the actual app icon (the same PNG used for the Tauri/PWA icons)
 * instead of a hand-drawn SVG. The icon is loaded from /icon-192.png
 * which is the opaque-background variant generated from the user's
 * RDAT.png source image.
 *
 * In Tauri mode, the icon is served from the bundled assets (public/).
 * In PWA mode, it's served from the Vercel static assets.
 */
export function RdatLogo({ className = "", size = 24 }: RdatLogoProps) {
  return (
    <img
      src="/icon-192.png"
      width={size}
      height={size}
      alt="RDAT"
      className={className}
      style={{
        borderRadius: Math.round(size * 0.22),
        objectFit: "cover",
      }}
    />
  );
}

export default RdatLogo;
