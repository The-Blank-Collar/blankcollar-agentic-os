import {
  useState,
  useRef,
  useEffect,
  useCallback,
  type CSSProperties,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
} from "react";

const TWEAKS_STYLE = `
  .twk-panel{position:fixed;right:16px;bottom:16px;z-index:2147483646;width:280px;
    max-height:calc(100vh - 32px);display:flex;flex-direction:column;
    background:rgba(250,249,247,.78);color:#29261b;
    -webkit-backdrop-filter:blur(24px) saturate(160%);backdrop-filter:blur(24px) saturate(160%);
    border:.5px solid rgba(255,255,255,.6);border-radius:14px;
    box-shadow:0 1px 0 rgba(255,255,255,.5) inset,0 12px 40px rgba(0,0,0,.18);
    font:11.5px/1.4 ui-sans-serif,system-ui,-apple-system,sans-serif;overflow:hidden}
  .twk-launch{position:fixed;right:16px;bottom:16px;z-index:2147483645;
    height:32px;padding:0 12px;border:0;border-radius:999px;background:rgba(11,11,12,.75);
    color:#F5F4F0;font:11px/1 ui-sans-serif,system-ui,sans-serif;letter-spacing:.04em;
    cursor:pointer;box-shadow:0 4px 18px rgba(0,0,0,.35);backdrop-filter:blur(8px)}
  .twk-launch:hover{background:rgba(11,11,12,.9)}
  .twk-hd{display:flex;align-items:center;justify-content:space-between;
    padding:10px 8px 10px 14px;cursor:move;user-select:none}
  .twk-hd b{font-size:12px;font-weight:600;letter-spacing:.01em}
  .twk-x{appearance:none;border:0;background:transparent;color:rgba(41,38,27,.55);
    width:22px;height:22px;border-radius:6px;cursor:pointer;font-size:13px;line-height:1}
  .twk-x:hover{background:rgba(0,0,0,.06);color:#29261b}
  .twk-body{padding:2px 14px 14px;display:flex;flex-direction:column;gap:10px;
    overflow-y:auto;overflow-x:hidden;min-height:0}
  .twk-row{display:flex;flex-direction:column;gap:5px}
  .twk-row-h{flex-direction:row;align-items:center;justify-content:space-between;gap:10px}
  .twk-lbl{display:flex;justify-content:space-between;align-items:baseline;
    color:rgba(41,38,27,.72)}
  .twk-lbl>span:first-child{font-weight:500}
  .twk-val{color:rgba(41,38,27,.5);font-variant-numeric:tabular-nums}
  .twk-sect{font-size:10px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;
    color:rgba(41,38,27,.45);padding:10px 0 0}
  .twk-sect:first-child{padding-top:0}
  .twk-toggle{position:relative;width:32px;height:18px;border:0;border-radius:999px;
    background:rgba(0,0,0,.15);transition:background .15s;cursor:pointer;padding:0}
  .twk-toggle[data-on="1"]{background:#34c759}
  .twk-toggle i{position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;
    background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.25);transition:transform .15s}
  .twk-toggle[data-on="1"] i{transform:translateX(14px)}
  .twk-seg{position:relative;display:flex;padding:2px;border-radius:8px;
    background:rgba(0,0,0,.06);user-select:none}
  .twk-seg-thumb{position:absolute;top:2px;bottom:2px;border-radius:6px;
    background:rgba(255,255,255,.9);box-shadow:0 1px 2px rgba(0,0,0,.12);
    transition:left .15s cubic-bezier(.3,.7,.4,1),width .15s}
  .twk-seg.dragging .twk-seg-thumb{transition:none}
  .twk-seg button{appearance:none;position:relative;z-index:1;flex:1;border:0;
    background:transparent;color:inherit;font:inherit;font-weight:500;min-height:22px;
    border-radius:6px;cursor:pointer;padding:4px 6px;line-height:1.2}
`;

export type TweakValues = {
  theme: "dark" | "light";
  density: "cozy" | "compact";
  role: "Founder" | "Manager" | "Contributor";
  agentStyle: "mixed" | "human" | "agent";
  showLiveFeed: boolean;
  populated: boolean;
  surface: "desktop" | "mobile";
};

export const DEFAULT_TWEAKS: TweakValues = {
  theme: "dark",
  density: "cozy",
  role: "Founder",
  agentStyle: "mixed",
  showLiveFeed: true,
  populated: true,
  surface: "desktop",
};

export function useTweaks(defaults: TweakValues): [
  TweakValues,
  <K extends keyof TweakValues>(key: K, val: TweakValues[K]) => void,
] {
  const [values, setValues] = useState<TweakValues>(defaults);
  const setTweak = useCallback(
    <K extends keyof TweakValues>(key: K, val: TweakValues[K]) => {
      setValues((prev) => ({ ...prev, [key]: val }));
    },
    [],
  );
  return [values, setTweak];
}

export function TweaksPanel({ title = "Tweaks", children }: { title?: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const dragRef = useRef<HTMLDivElement | null>(null);
  const offsetRef = useRef({ x: 16, y: 16 });
  const PAD = 16;

  const clampToViewport = useCallback(() => {
    const panel = dragRef.current;
    if (!panel) return;
    const w = panel.offsetWidth;
    const h = panel.offsetHeight;
    const maxRight = Math.max(PAD, window.innerWidth - w - PAD);
    const maxBottom = Math.max(PAD, window.innerHeight - h - PAD);
    offsetRef.current = {
      x: Math.min(maxRight, Math.max(PAD, offsetRef.current.x)),
      y: Math.min(maxBottom, Math.max(PAD, offsetRef.current.y)),
    };
    panel.style.right = offsetRef.current.x + "px";
    panel.style.bottom = offsetRef.current.y + "px";
  }, []);

  useEffect(() => {
    if (!open) return;
    clampToViewport();
    window.addEventListener("resize", clampToViewport);
    return () => window.removeEventListener("resize", clampToViewport);
  }, [open, clampToViewport]);

  const onDragStart = (e: ReactPointerEvent<HTMLDivElement>) => {
    const panel = dragRef.current;
    if (!panel) return;
    const r = panel.getBoundingClientRect();
    const sx = e.clientX;
    const sy = e.clientY;
    const startRight = window.innerWidth - r.right;
    const startBottom = window.innerHeight - r.bottom;
    const move = (ev: PointerEvent) => {
      offsetRef.current = {
        x: startRight - (ev.clientX - sx),
        y: startBottom - (ev.clientY - sy),
      };
      clampToViewport();
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  if (!open) {
    return (
      <>
        <style>{TWEAKS_STYLE}</style>
        <button className="twk-launch" onClick={() => setOpen(true)} aria-label="Open tweaks">
          ⚙ {title}
        </button>
      </>
    );
  }
  return (
    <>
      <style>{TWEAKS_STYLE}</style>
      <div
        ref={dragRef}
        className="twk-panel"
        style={{ right: offsetRef.current.x, bottom: offsetRef.current.y }}
      >
        <div className="twk-hd" onPointerDown={onDragStart}>
          <b>{title}</b>
          <button
            className="twk-x"
            aria-label="Close tweaks"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => setOpen(false)}
          >
            ✕
          </button>
        </div>
        <div className="twk-body">{children}</div>
      </div>
    </>
  );
}

export function TweakSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <>
      <div className="twk-sect">{title}</div>
      {children}
    </>
  );
}

export function TweakRow({ label, value, children, inline = false }: { label: string; value?: string; children: ReactNode; inline?: boolean }) {
  return (
    <div className={inline ? "twk-row twk-row-h" : "twk-row"}>
      <div className="twk-lbl">
        <span>{label}</span>
        {value != null && <span className="twk-val">{value}</span>}
      </div>
      {children}
    </div>
  );
}

export function TweakToggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="twk-row twk-row-h">
      <div className="twk-lbl">
        <span>{label}</span>
      </div>
      <button
        type="button"
        className="twk-toggle"
        data-on={value ? "1" : "0"}
        role="switch"
        aria-checked={value}
        onClick={() => onChange(!value)}
      >
        <i />
      </button>
    </div>
  );
}

type RadioOption<V> = { value: V; label: string };

export function TweakRadio<V extends string>({ label, value, options, onChange }: {
  label: string;
  value: V;
  options: RadioOption<V>[];
  onChange: (v: V) => void;
}) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const idx = Math.max(0, options.findIndex((o) => o.value === value));
  const n = options.length;
  const valueRef = useRef(value);
  valueRef.current = value;

  const segAt = (clientX: number) => {
    const track = trackRef.current;
    if (!track) return value;
    const r = track.getBoundingClientRect();
    const inner = r.width - 4;
    const i = Math.floor(((clientX - r.left - 2) / inner) * n);
    return options[Math.max(0, Math.min(n - 1, i))].value;
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    setDragging(true);
    const v0 = segAt(e.clientX);
    if (v0 !== valueRef.current) onChange(v0);
    const move = (ev: PointerEvent) => {
      if (!trackRef.current) return;
      const v = segAt(ev.clientX);
      if (v !== valueRef.current) onChange(v);
    };
    const up = () => {
      setDragging(false);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const thumbStyle: CSSProperties = {
    left: `calc(2px + ${idx} * (100% - 4px) / ${n})`,
    width: `calc((100% - 4px) / ${n})`,
  };

  return (
    <TweakRow label={label}>
      <div
        ref={trackRef}
        role="radiogroup"
        onPointerDown={onPointerDown}
        className={dragging ? "twk-seg dragging" : "twk-seg"}
      >
        <div className="twk-seg-thumb" style={thumbStyle} />
        {options.map((o) => (
          <button key={o.value} type="button" role="radio" aria-checked={o.value === value}>
            {o.label}
          </button>
        ))}
      </div>
    </TweakRow>
  );
}
