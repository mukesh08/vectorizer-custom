/* Small building blocks for the control rail: a labelled group, a slider with a readout,
   a select and a checkbox, all driven by the one settings object. */
import type { ReactNode } from "react";

export function Group({ children, hidden, className = "group" }: { children: ReactNode; hidden?: boolean; className?: string }) {
  return <div className={className} hidden={hidden}>{children}</div>;
}

interface SliderProps {
  id: string;
  label: string;
  /** The value shown on the right of the label. */
  readout?: string;
  min: number;
  max: number;
  step?: number;
  value: number;
  disabled?: boolean;
  hidden?: boolean;
  onChange: (v: number) => void;
}

export function Slider({ id, label, readout, min, max, step = 1, value, disabled, hidden, onChange }: SliderProps) {
  return (
    <Group hidden={hidden}>
      <label className="label" htmlFor={id}>{label} {readout !== undefined && <output>{readout}</output>}</label>
      <input type="range" id={id} min={min} max={max} step={step} value={value} disabled={disabled}
        onChange={e => onChange(+e.target.value)} />
    </Group>
  );
}

interface SelectProps<T extends string> {
  id: string;
  label: string;
  value: T;
  options: { value: T; label: string }[];
  disabled?: boolean;
  hidden?: boolean;
  onChange: (v: T) => void;
}

export function Select<T extends string>({ id, label, value, options, disabled, hidden, onChange }: SelectProps<T>) {
  return (
    <Group hidden={hidden}>
      <label className="label" htmlFor={id}>{label}</label>
      <select id={id} value={value} disabled={disabled} onChange={e => onChange(e.target.value as T)}>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </Group>
  );
}

export function Check({ id, label, checked, disabled, onChange, children }: {
  id?: string; label: string; checked: boolean; disabled?: boolean; onChange: (v: boolean) => void; children?: ReactNode;
}) {
  return (
    <label className="check">
      <input type="checkbox" id={id} checked={checked} disabled={disabled} onChange={e => onChange(e.target.checked)} />
      {" " + label}
      {children}
    </label>
  );
}

/** Collapsible section of the rail. */
export function Section({ title, hint, open, hidden, children, id }: {
  title: string; hint?: string; open?: boolean; hidden?: boolean; children: ReactNode; id?: string;
}) {
  return (
    <details className="sect" id={id} open={open} hidden={hidden}>
      <summary>{title}{hint && <small>{hint}</small>}</summary>
      <div className="sect-body">{children}</div>
    </details>
  );
}
