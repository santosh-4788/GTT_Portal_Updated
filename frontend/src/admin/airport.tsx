/**
 * The airport direction, as the admin forms ask it.
 *
 * Same rule as the website: an airport trip says which way it goes before it
 * asks for addresses, because the direction decides which end is the airport.
 * The server refuses an airport booking without one, so the forms ask for it
 * rather than letting the save fail.
 */
export type AirportDir = 'TO' | 'FROM' | '';

const AIRPORT_HINT = /\bairport\b|\bterminal\s*[t]?[123]\b|\bT[123]\b|\bCSMIA\b|\bNMIA\b/i;

/** For bookings saved before the direction was stored: read it off the addresses. */
export function inferAirportDir(pickup?: string | null, drop?: string | null): AirportDir {
  const p = AIRPORT_HINT.test(pickup ?? '');
  const d = AIRPORT_HINT.test(drop ?? '');
  if (d && !p) return 'TO';
  if (p && !d) return 'FROM';
  return '';
}

/** The airports the office serves, offered as suggestions on the airport end. */
export const AIRPORT_NAMES = [
  'CSMIA Terminal 2 (international), Mumbai',
  'CSMIA Terminal 1 (domestic), Mumbai',
  'Navi Mumbai International Airport',
  'Pune Airport',
];

/** Labels and placeholders for the two ends, once the direction is known. */
export function airportEnds(dir: AirportDir) {
  return dir === 'FROM'
    ? { pickup: 'Pickup airport', drop: 'Drop address', pickupHint: 'e.g. CSMIA Terminal 2', dropHint: 'e.g. Lower Parel, Mumbai', airportEnd: 'pickup' as const }
    : { pickup: 'Pickup address', drop: 'Drop airport', pickupHint: 'e.g. Powai, Mumbai', dropHint: 'e.g. CSMIA Terminal 1', airportEnd: 'drop' as const };
}

export function AirportDirectionPicker({
  value, onChange, error,
}: { value: AirportDir; onChange: (v: AirportDir) => void; error?: string }) {
  return (
    <div>
      <div role="radiogroup" aria-label="Airport direction" className="flex gap-1.5">
        {([['TO', 'To airport', 'Drop at the airport'], ['FROM', 'From airport', 'Pickup at the airport']] as const).map(([v, label, sub]) => (
          <button
            key={v} type="button" role="radio" aria-checked={value === v} onClick={() => onChange(v)}
            className={`flex-1 rounded-lg px-3 py-1.5 text-left text-xs font-semibold ring-1 ring-inset transition-colors ${
              value === v ? 'bg-ink-900 text-white ring-ink-900' : error ? 'bg-white text-ink-700 ring-danger-300' : 'bg-white text-ink-700 ring-ink-200 hover:bg-ink-50'
            }`}
          >
            {label}
            <span className={`block text-2xs font-medium ${value === v ? 'text-white/70' : 'text-ink-400'}`}>{sub}</span>
          </button>
        ))}
      </div>
      {error && <p className="mt-1 text-xs text-danger-600">{error}</p>}
    </div>
  );
}
