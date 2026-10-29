import { useEffect, useId, useRef, useState } from "react";
import "./focus-controls.css";

export default function FocusTaskPicker({ tasks, value, onChange, dueLabel, label = "Focus task", emptyLabel = "No task — just focus" }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const root = useRef(null);
  const trigger = useRef(null);
  const list = useRef(null);
  const id = useId();
  const options = [{ id: "", title: emptyLabel }, ...tasks];
  const selected = options.find((task) => task.id === value) || options[0];
  useEffect(() => { setActive(0); }, [tasks]);
  const close = () => { setOpen(false); trigger.current?.focus(); };
  const choose = (task) => { onChange(task.id || null); close(); };
  useEffect(() => {
    if (!open) return;
    list.current?.focus();
    const outside = (event) => { if (!root.current?.contains(event.target)) setOpen(false); };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  useEffect(() => {
    if (open) list.current?.children[active]?.scrollIntoView({ block: "nearest" });
  }, [active, open]);
  return <div className="north-task-picker" ref={root} onBlur={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  }}>
    <button ref={trigger} type="button" className="north-task-trigger" aria-haspopup="listbox"
      aria-expanded={open} aria-controls={id} aria-label={`${label}: ${selected.title}`}
      onClick={() => { setActive(Math.max(0, options.indexOf(selected))); setOpen(!open); }}
      onKeyDown={(event) => {
        if (["ArrowDown", "ArrowUp"].includes(event.key)) {
          event.preventDefault(); setActive(Math.max(0, options.indexOf(selected))); setOpen(true);
        }
      }}><span>{selected.title}</span><span aria-hidden="true">⌄</span></button>
    {open && <div ref={list} id={id} role="listbox" tabIndex={-1} aria-label={label}
      aria-activedescendant={`${id}-${Math.min(active, options.length - 1)}`} className="north-task-options"
      onKeyDown={(event) => {
        if (["ArrowDown", "ArrowUp", "Home", "End", "Enter", " ", "Escape"].includes(event.key)) event.preventDefault();
        if (event.key === "Escape") close();
        if (event.key === "ArrowDown") setActive((n) => Math.min(n + 1, options.length - 1));
        if (event.key === "ArrowUp") setActive((n) => Math.max(n - 1, 0));
        if (event.key === "Home") setActive(0);
        if (event.key === "End") setActive(options.length - 1);
        if (["Enter", " "].includes(event.key)) choose(options[Math.min(active, options.length - 1)]);
        if (event.key.length === 1 && event.key !== " ") {
          const match = options.findIndex((task) => task.title.toLowerCase().startsWith(event.key.toLowerCase()));
          if (match >= 0) setActive(match);
        }
      }}>
      {options.map((task, index) => <div key={task.id} id={`${id}-${index}`} role="option"
        aria-selected={task.id === selected.id} className={index === active ? "active" : ""}
        onPointerMove={() => setActive(index)} onClick={() => choose(task)}>
        <span>{task.title}{task.due && <small>{dueLabel(task.due, false)}</small>}</span>
        <span aria-hidden="true">{task.id === selected.id ? "✓" : ""}</span>
      </div>)}
    </div>}
  </div>;
}
