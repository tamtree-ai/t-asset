"use client";

type EventOption = { type: string; label: string; group: string };

/** The catalogue as checkboxes, by group. */
export function EventPicker({ events, picked, onChange }: { events: EventOption[]; picked: string[]; onChange: (next: string[]) => void }) {
  const groups = [...new Set(events.map((e) => e.group))];
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="mb-1 text-[13px] font-medium text-fg-2">Events</legend>
      {groups.map((g) => (
        <div key={g} className="flex flex-col gap-1.5">
          <p className="text-[12px] font-medium uppercase tracking-wide text-fg-muted">{g}</p>
          {events
            .filter((e) => e.group === g)
            .map((e) => (
              <label key={e.type} className="flex items-center gap-2 text-[13px] text-fg-2">
                <input type="checkbox" checked={picked.includes(e.type)} onChange={(ev) => onChange(ev.target.checked ? [...picked, e.type] : picked.filter((t) => t !== e.type))} />
                {e.label} <code className="text-[11px] text-fg-muted">{e.type}</code>
              </label>
            ))}
        </div>
      ))}
    </fieldset>
  );
}
