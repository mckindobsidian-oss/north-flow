import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Calendar, ChevronLeft, ChevronRight } from "lucide-react";

// UTC date keys match the usage buckets; display never shifts across time zones.
const dateOf = (key) => new Date(`${key}T12:00:00Z`);
const keyOf = (date) => date.toISOString().slice(0, 10);
export default function DateField({ label, value, onChange, max, colors }) {
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(value.slice(0, 7));
  const root = useRef(null);
  const trigger = useRef(null);
  const popover = useRef(null);
  const [position, setPosition] = useState({ top: 100, left: 16 });
  const c = colors;
  useEffect(() => {
    if (!open) return;
    const close = (event) => { if (!root.current?.contains(event.target) && !popover.current?.contains(event.target)) setOpen(false); };
    const escape = (event) => { if (event.key === "Escape") { setOpen(false); trigger.current?.focus(); } };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", escape); };
  }, [open]);
  const first = dateOf(`${month}-01`);
  const offset = (first.getUTCDay() + 6) % 7;
  const count = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  const move = (delta) => { const date = dateOf(`${month}-01`); date.setUTCMonth(date.getUTCMonth() + delta); setMonth(keyOf(date).slice(0, 7)); };
  const button = { border: 0, borderRadius: 9, minHeight: 36, background: "transparent", color: c.txt, cursor: "pointer", font: "inherit" };
  return <div ref={root} style={{ position: "relative", minWidth: 140 }}>
    <div style={{ color: c.sub, fontSize: 12, marginBottom: 5 }}>{label}</div>
    <button ref={trigger} type="button" className="b" aria-label={`${label}: ${value}`} aria-haspopup="dialog" aria-expanded={open}
      onClick={() => {
        const rect = trigger.current.getBoundingClientRect();
        setPosition({ left: Math.max(12, Math.min(rect.left, window.innerWidth - 312)), top: Math.max(12, Math.min(rect.bottom + 8, window.innerHeight - 350)) });
        setMonth(value.slice(0, 7)); setOpen(!open);
      }}
      style={{ ...button, display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", background: c.card, border: `1px solid ${c.border}`, width: "100%" }}>
      <Calendar size={16} color={c.acc} />{dateOf(value).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })}
    </button>
    {open && createPortal(<div ref={popover} role="dialog" aria-label={`${label} calendar`} style={{ position: "fixed", zIndex: 11000, ...position, width: 300, maxWidth: "calc(100vw - 24px)", maxHeight: "calc(100dvh - 24px)", overflowY: "auto", padding: 14, borderRadius: 16, background: c.dark ? "#1b1d25" : "#f7f8fc", color: c.txt, border: `1px solid ${c.border}`, boxShadow: "0 16px 48px #0006", fontFamily: "system-ui,sans-serif" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <button type="button" className="b" aria-label="Previous month" onClick={() => move(-1)} style={{ ...button, width: 36 }}><ChevronLeft size={17} /></button>
        <strong style={{ fontSize: 13 }}>{first.toLocaleDateString(undefined, { month: "long", year: "numeric", timeZone: "UTC" })}</strong>
        <button type="button" className="b" aria-label="Next month" disabled={max && month >= max.slice(0, 7)} onClick={() => move(1)} style={{ ...button, width: 36 }}><ChevronRight size={17} /></button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 2 }}>
        {["M", "T", "W", "T", "F", "S", "S"].map((day, index) => <span key={index} style={{ textAlign: "center", color: c.sub, fontSize: 11, paddingBottom: 7 }} aria-hidden="true">{day}</span>)}
        {Array.from({ length: offset }, (_, index) => <span key={`empty${index}`} />)}
        {Array.from({ length: count }, (_, index) => {
          const key = `${month}-${String(index + 1).padStart(2, "0")}`;
          const disabled = Boolean(max && key > max);
          return <button key={key} type="button" className="b" aria-label={key} aria-pressed={key === value} disabled={disabled}
            onClick={() => { onChange(key); setOpen(false); trigger.current?.focus(); }}
            style={{ ...button, opacity: disabled ? .3 : 1, background: key === value ? c.acc : "transparent", color: key === value ? c.onAcc : c.txt }}>{index + 1}</button>;
        })}
      </div>
    </div>, document.body)}
  </div>;
}
