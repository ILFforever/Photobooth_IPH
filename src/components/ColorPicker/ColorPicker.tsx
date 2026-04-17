import { useState, useRef, useEffect, useCallback } from 'react';
import Icon from '@mdi/react';
import { mdiEyedropper } from '@mdi/js';
import './ColorPicker.css';

// ── Color math ────────────────────────────────────────────────────────────────

function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r = 0, g = 0, b = 0;
  if      (h < 60)  { r = c; g = x; }
  else if (h < 120) { r = x; g = c; }
  else if (h < 180) {         g = c; b = x; }
  else if (h < 240) {         g = x; b = c; }
  else if (h < 300) { r = x;         b = c; }
  else              { r = c;         b = x; }
  return [
    Math.round((r + m) * 255),
    Math.round((g + m) * 255),
    Math.round((b + m) * 255),
  ];
}

function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  const v = max;
  const s = max === 0 ? 0 : d / max;
  let h = 0;
  if (d !== 0) {
    if      (max === r) h = ((g - b) / d + 6) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else                h = (r - g) / d + 4;
    h *= 60;
  }
  return [h, s, v];
}

function hexToRgb(hex: string): [number, number, number] | null {
  const clean = hex.replace('#', '');
  if (!/^[0-9a-f]{6}$/i.test(clean)) return null;
  return [
    parseInt(clean.slice(0, 2), 16),
    parseInt(clean.slice(2, 4), 16),
    parseInt(clean.slice(4, 6), 16),
  ];
}

function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
}

// ── Component ─────────────────────────────────────────────────────────────────

interface ColorPickerProps {
  value: string;
  onChange: (hex: string) => void;
}

export function ColorPicker({ value, onChange }: ColorPickerProps) {
  const [open, setOpen]       = useState(false);
  const [closing, setClosing] = useState(false);
  const [hue, setHue]         = useState(0);
  const [sat, setSat]         = useState(1);
  const [bri, setBri]         = useState(1);
  const [hexInput, setHexInput] = useState(value);
  const [pos, setPos]         = useState({ top: 0, left: 0 });

  const swatchRef        = useRef<HTMLButtonElement>(null);
  const svRef            = useRef<HTMLDivElement>(null);
  const hueSliderRef     = useRef<HTMLDivElement>(null);
  const popoverRef       = useRef<HTMLDivElement>(null);
  const dragging         = useRef<'sv' | 'hue' | null>(null);
  // Avoid stale closures in global mouse handlers
  const hsvRef = useRef({ h: hue, s: sat, v: bri });

  // Sync inward only when closed — while open, picker owns its own state
  useEffect(() => {
    if (open) return;
    const rgb = hexToRgb(value);
    if (rgb) {
      const [h, s, v] = rgbToHsv(...rgb);
      setHue(h); setSat(s); setBri(v);
      hsvRef.current = { h, s, v };
      setHexInput(value);
    }
  }, [value, open]);

  const emitColor = useCallback((h: number, s: number, v: number) => {
    const hex = rgbToHex(...hsvToRgb(h, s, v));
    hsvRef.current = { h, s, v };
    setHexInput(hex);
    onChange(hex);
  }, [onChange]);

  const closePopover = useCallback(() => {
    setClosing(true);
    setTimeout(() => { setOpen(false); setClosing(false); }, 140);
  }, []);

  // Open / position popover
  const handleSwatchClick = () => {
    if (!open && swatchRef.current) {
      const rect = swatchRef.current.getBoundingClientRect();
      const W = 224, H = 268;
      let left = rect.left;
      let top  = rect.bottom + 6;
      if (left + W > window.innerWidth  - 8) left = window.innerWidth  - W - 8;
      if (top  + H > window.innerHeight - 8) top  = rect.top - H - 6;
      setPos({ top, left });
    }
    if (open) { closePopover(); } else { setOpen(true); }
  };

  // Click outside → close
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        popoverRef.current?.contains(e.target as Node) ||
        swatchRef.current?.contains(e.target as Node)
      ) return;
      closePopover();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open, closePopover]);

  // Global mouse move / up for drag
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (dragging.current === 'sv') {
        const el = svRef.current;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        const s = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        const v = Math.max(0, Math.min(1, 1 - (e.clientY - rect.top) / rect.height));
        setSat(s); setBri(v);
        emitColor(hsvRef.current.h, s, v);
      } else if (dragging.current === 'hue') {
        const el = hueSliderRef.current;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        const h = Math.max(0, Math.min(359.99, ((e.clientX - rect.left) / rect.width) * 360));
        setHue(h);
        emitColor(h, hsvRef.current.s, hsvRef.current.v);
      }
    };
    const onUp = () => { dragging.current = null; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [emitColor]);

  const handleSvDown = (e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = 'sv';
    const rect = svRef.current!.getBoundingClientRect();
    const s = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const v = Math.max(0, Math.min(1, 1 - (e.clientY - rect.top) / rect.height));
    setSat(s); setBri(v);
    emitColor(hsvRef.current.h, s, v);
  };

  const handleHueDown = (e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = 'hue';
    const rect = hueSliderRef.current!.getBoundingClientRect();
    const h = Math.max(0, Math.min(359.99, ((e.clientX - rect.left) / rect.width) * 360));
    setHue(h);
    emitColor(h, hsvRef.current.s, hsvRef.current.v);
  };

  const handleHexChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    setHexInput(raw);
    const normalized = raw.startsWith('#') ? raw : '#' + raw;
    const rgb = hexToRgb(normalized);
    if (rgb) {
      const [h, s, v] = rgbToHsv(...rgb);
      setHue(h); setSat(s); setBri(v);
      hsvRef.current = { h, s, v };
      onChange(normalized);
    }
  };

  const handleEyedropper = async () => {
    try {
      const dropper = new (window as any).EyeDropper();
      const { sRGBHex } = await dropper.open();
      const rgb = hexToRgb(sRGBHex);
      if (rgb) {
        const [h, s, v] = rgbToHsv(...rgb);
        setHue(h); setSat(s); setBri(v);
        hsvRef.current = { h, s, v };
        setHexInput(sRGBHex);
        onChange(sRGBHex);
      }
    } catch {}
  };

  // Dot contrast
  const [dr, dg, db] = hsvToRgb(hue, sat, bri);
  const dotBorder = (dr * 299 + dg * 587 + db * 114) / 1000 > 128
    ? 'rgba(0,0,0,0.55)'
    : 'rgba(255,255,255,0.75)';

  return (
    <div className="cpick-root">
      <button
        ref={swatchRef}
        className="cpick-swatch"
        style={{ background: value }}
        onClick={handleSwatchClick}
        title="Pick color"
      />

      {(open || closing) && (
        <div
          ref={popoverRef}
          className={`cpick-popover${closing ? ' cpick-popover--closing' : ''}`}
          style={{ top: pos.top, left: pos.left }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {/* Saturation / Value square */}
          <div
            ref={svRef}
            className="cpick-sv"
            style={{ '--cpick-hue': `${hue}deg` } as React.CSSProperties}
            onMouseDown={handleSvDown}
          >
            <div
              className="cpick-sv-dot"
              style={{
                left: `${sat * 100}%`,
                top:  `${(1 - bri) * 100}%`,
                borderColor: dotBorder,
              }}
            />
          </div>

          {/* Hue slider */}
          <div
            ref={hueSliderRef}
            className="cpick-hue"
            onMouseDown={handleHueDown}
          >
            <div
              className="cpick-hue-thumb"
              style={{ left: `${(hue / 360) * 100}%` }}
            />
          </div>

          {/* Bottom row: eyedropper | hex input | preview */}
          <div className="cpick-bottom">
            {'EyeDropper' in window && (
              <button
                className="cpick-dropper"
                onClick={handleEyedropper}
                title="Sample color from screen"
              >
                <Icon path={mdiEyedropper} size={0.75} />
              </button>
            )}
            <input
              className="cpick-hex"
              value={hexInput}
              onChange={handleHexChange}
              maxLength={7}
              spellCheck={false}
            />
            <div className="cpick-preview" style={{ background: rgbToHex(dr, dg, db) }} />
          </div>
        </div>
      )}
    </div>
  );
}
