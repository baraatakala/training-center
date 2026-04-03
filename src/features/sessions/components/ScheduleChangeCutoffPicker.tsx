import { useState, useMemo } from 'react';
import { Button } from '@/shared/components/ui/Button';

/**
 * Unified schedule-change dialog.
 *
 * Instead of forcing the admin to choose between abstract strategy names
 * ("from_start / after_last_attended / from_today"), this component simply asks:
 *
 *   "When does the new schedule start?" — and optionally "When does it end?"
 *
 * The answer is an optional cutoff date range:
 *   - null fromDate  → apply retroactively from session start (clears all overrides)
 *   - fromDate only  → old schedule kept before it, new schedule from it forever
 *   - fromDate+toDate → new schedule applies only between those two dates; reverts after
 *
 * Works for day-only, time-only, or combined day+time changes in one interaction.
 */
export function ScheduleChangeCutoffPicker({
  dayChanged,
  timeChanged,
  oldDay,
  newDay,
  oldTime,
  newTime,
  sessionStartDate,
  lastAttendedDate,
  sessionEndDate,
  onApply,
  onCancel,
  executing = false,
}: {
  dayChanged: boolean;
  timeChanged: boolean;
  oldDay: string | null;
  newDay: string | null;
  oldTime: string | null;
  newTime: string | null;
  sessionStartDate: string | null;
  lastAttendedDate: string | null;
  sessionEndDate?: string | null;
  /** fromDate = null means retroactive; toDate = null means open-ended */
  onApply: (fromDate: string | null, toDate: string | null) => void;
  onCancel: () => void;
  executing?: boolean;
}) {
  const today = useMemo(() => new Date().toISOString().split('T')[0], []);

  const [mode, setMode] = useState<'from_date' | 'date_range' | 'retroactive'>('from_date');
  const [cutoffDate, setCutoffDate] = useState<string>(today);
  const [toDate, setToDate] = useState<string>(sessionEndDate || today);

  const effectiveFromDate = mode === 'retroactive' ? null : cutoffDate;
  const effectiveToDate = mode === 'date_range' ? toDate : null;

  // Format a date like "Mon, Apr 2" for display
  const fmt = (dateStr: string | null) => {
    if (!dateStr) return '';
    const [y, m, d] = dateStr.split('-').map(Number);
    return new Date(y, (m || 1) - 1, d || 1).toLocaleDateString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric',
    });
  };

  // One day after toDate for display purposes
  const dayAfter = (dateStr: string) => {
    const [y, m, d] = dateStr.split('-').map(Number);
    const next = new Date(y, (m || 1) - 1, (d || 1) + 1);
    return next.toISOString().split('T')[0];
  };

  // Build readable "before / from / after" summary
  const buildPreview = () => {
    const oldSchedule = [oldDay, oldTime ? `@ ${oldTime}` : ''].filter(Boolean).join(' ');
    const newSchedule = [newDay, newTime ? `@ ${newTime}` : ''].filter(Boolean).join(' ');

    if (effectiveFromDate === null) {
      return (
        <div className="space-y-1 text-sm">
          <div className="flex items-center gap-2">
            <span className="w-20 text-right text-gray-400 dark:text-gray-500 text-xs">All dates</span>
            <span className="text-green-600 dark:text-green-400 font-semibold">{newSchedule || '(new schedule)'}</span>
          </div>
          <p className="text-xs text-amber-600 dark:text-amber-400 pl-24">
            ⚠️ Old schedule ({oldSchedule || '—'}) will be erased from history.
          </p>
        </div>
      );
    }
    if (effectiveToDate) {
      const isValid = toDate >= cutoffDate;
      return (
        <div className="space-y-1 text-sm">
          <div className="flex items-center gap-2">
            <span className="w-24 text-right text-gray-400 dark:text-gray-500 text-xs">Before {fmt(effectiveFromDate)}</span>
            <span className="text-gray-600 dark:text-gray-300">{oldSchedule || '(old schedule)'}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-24 text-right text-blue-500 dark:text-blue-400 text-xs font-medium">{fmt(effectiveFromDate)} → {fmt(effectiveToDate)}</span>
            <span className="text-blue-700 dark:text-blue-300 font-semibold">{newSchedule || '(new schedule)'}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-24 text-right text-gray-400 dark:text-gray-500 text-xs">From {fmt(dayAfter(effectiveToDate))}</span>
            <span className="text-gray-600 dark:text-gray-300">{oldSchedule || '(old schedule, resumes)'}</span>
          </div>
          {!isValid && (
            <p className="text-xs text-red-500 dark:text-red-400 pl-28">⚠️ End date must be on or after start date.</p>
          )}
        </div>
      );
    }
    return (
      <div className="space-y-1 text-sm">
        <div className="flex items-center gap-2">
          <span className="w-20 text-right text-gray-400 dark:text-gray-500 text-xs">Before {fmt(effectiveFromDate)}</span>
          <span className="text-gray-600 dark:text-gray-300">{oldSchedule || '(old schedule)'}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-20 text-right text-blue-500 dark:text-blue-400 text-xs font-medium">From {fmt(effectiveFromDate)}</span>
          <span className="text-blue-700 dark:text-blue-300 font-semibold">{newSchedule || '(new schedule)'}</span>
        </div>
      </div>
    );
  };

  const changeLabels: string[] = [];
  if (dayChanged && oldDay && newDay) changeLabels.push(`${oldDay} → ${newDay}`);
  if (timeChanged && (oldTime || newTime)) changeLabels.push(`${oldTime || '—'} → ${newTime || '—'}`);

  return (
    <div className="space-y-5">
      {/* Change summary badge */}
      <div className="rounded-xl border border-violet-200 dark:border-violet-700 bg-violet-50 dark:bg-violet-900/20 p-4 space-y-1.5">
        <p className="text-xs font-semibold text-violet-500 dark:text-violet-400 uppercase tracking-wide">
          Schedule change detected
        </p>
        {changeLabels.map((label, i) => (
          <p key={i} className="text-sm font-medium text-violet-900 dark:text-violet-200">{label}</p>
        ))}
      </div>

      {/* Mode selection */}
      <div className="space-y-2">
        <p className="text-sm font-medium text-gray-700 dark:text-gray-300">When does the new schedule start?</p>

        {/* Option A: specific date (open-ended) */}
        <label className={`flex items-start gap-3 p-3.5 rounded-xl border-2 cursor-pointer transition-all ${
          mode === 'from_date'
            ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 dark:border-blue-500'
            : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
        }`}>
          <input
            type="radio"
            className="mt-0.5 accent-blue-600"
            checked={mode === 'from_date'}
            onChange={() => setMode('from_date')}
          />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-gray-900 dark:text-white">From a specific date</p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              Keep the old schedule before this date; apply the new schedule from it onward.
            </p>
            {mode === 'from_date' && (
              <div className="mt-3 space-y-2">
                <input
                  type="date"
                  value={cutoffDate}
                  onChange={e => setCutoffDate(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
                {/* Quick-pick buttons */}
                <div className="flex flex-wrap gap-2">
                  {sessionStartDate && (
                    <button
                      type="button"
                      onClick={() => setCutoffDate(sessionStartDate)}
                      className="px-2.5 py-1 text-xs font-medium rounded-full border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300 transition-colors"
                    >
                      Session start ({fmt(sessionStartDate)})
                    </button>
                  )}
                  {lastAttendedDate && (
                    <button
                      type="button"
                      onClick={() => {
                        const [y, m, d] = lastAttendedDate.split('-').map(Number);
                        const next = new Date(y, (m || 1) - 1, (d || 1) + 1);
                        setCutoffDate(next.toISOString().split('T')[0]);
                      }}
                      className="px-2.5 py-1 text-xs font-medium rounded-full border border-orange-300 dark:border-orange-700 hover:bg-orange-50 dark:hover:bg-orange-900/20 text-orange-600 dark:text-orange-400 transition-colors"
                    >
                      After last attendance ({fmt(lastAttendedDate)})
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setCutoffDate(today)}
                    className="px-2.5 py-1 text-xs font-medium rounded-full border border-blue-300 dark:border-blue-700 hover:bg-blue-50 dark:hover:bg-blue-900/20 text-blue-600 dark:text-blue-400 transition-colors"
                  >
                    Today ({fmt(today)})
                  </button>
                </div>
              </div>
            )}
          </div>
        </label>

        {/* Option B: specific date range (bounded) */}
        <label className={`flex items-start gap-3 p-3.5 rounded-xl border-2 cursor-pointer transition-all ${
          mode === 'date_range'
            ? 'border-green-500 bg-green-50 dark:bg-green-900/20 dark:border-green-500'
            : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
        }`}>
          <input
            type="radio"
            className="mt-0.5 accent-green-600"
            checked={mode === 'date_range'}
            onChange={() => setMode('date_range')}
          />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-gray-900 dark:text-white">Date range (bounded)</p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              Apply the new schedule between two dates; revert to the old schedule after.
            </p>
            {mode === 'date_range' && (
              <div className="mt-3 space-y-3">
                {/* From date */}
                <div>
                  <p className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">From</p>
                  <input
                    type="date"
                    value={cutoffDate}
                    onChange={e => setCutoffDate(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm focus:ring-2 focus:ring-green-500 focus:border-green-500"
                  />
                  <div className="flex flex-wrap gap-2 mt-1.5">
                    {sessionStartDate && (
                      <button type="button" onClick={() => setCutoffDate(sessionStartDate)}
                        className="px-2.5 py-1 text-xs font-medium rounded-full border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300 transition-colors">
                        Session start ({fmt(sessionStartDate)})
                      </button>
                    )}
                    {lastAttendedDate && (
                      <button type="button" onClick={() => {
                        const [y, m, d] = lastAttendedDate.split('-').map(Number);
                        const next = new Date(y, (m || 1) - 1, (d || 1) + 1);
                        setCutoffDate(next.toISOString().split('T')[0]);
                      }}
                        className="px-2.5 py-1 text-xs font-medium rounded-full border border-orange-300 dark:border-orange-700 hover:bg-orange-50 dark:hover:bg-orange-900/20 text-orange-600 dark:text-orange-400 transition-colors">
                        After last attendance ({fmt(lastAttendedDate)})
                      </button>
                    )}
                    <button type="button" onClick={() => setCutoffDate(today)}
                      className="px-2.5 py-1 text-xs font-medium rounded-full border border-blue-300 dark:border-blue-700 hover:bg-blue-50 dark:hover:bg-blue-900/20 text-blue-600 dark:text-blue-400 transition-colors">
                      Today ({fmt(today)})
                    </button>
                  </div>
                </div>
                {/* To date */}
                <div>
                  <p className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">To (last day of new schedule)</p>
                  <input
                    type="date"
                    value={toDate}
                    min={cutoffDate}
                    onChange={e => setToDate(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm focus:ring-2 focus:ring-green-500 focus:border-green-500"
                  />
                  <div className="flex flex-wrap gap-2 mt-1.5">
                    {sessionEndDate && (
                      <button type="button" onClick={() => setToDate(sessionEndDate)}
                        className="px-2.5 py-1 text-xs font-medium rounded-full border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300 transition-colors">
                        Session end ({fmt(sessionEndDate)})
                      </button>
                    )}
                    <button type="button" onClick={() => setToDate(today)}
                      className="px-2.5 py-1 text-xs font-medium rounded-full border border-blue-300 dark:border-blue-700 hover:bg-blue-50 dark:hover:bg-blue-900/20 text-blue-600 dark:text-blue-400 transition-colors">
                      Today ({fmt(today)})
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </label>

        {/* Option C: retroactive */}
        <label className={`flex items-start gap-3 p-3.5 rounded-xl border-2 cursor-pointer transition-all ${
          mode === 'retroactive'
            ? 'border-amber-500 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-500'
            : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
        }`}>
          <input
            type="radio"
            className="mt-0.5 accent-amber-600"
            checked={mode === 'retroactive'}
            onChange={() => setMode('retroactive')}
          />
          <div>
            <p className="text-sm font-medium text-gray-900 dark:text-white">Retroactively (from session start)</p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              Rewrites history — the new schedule replaces the old one across all dates.
            </p>
          </div>
        </label>
      </div>

      {/* Live preview */}
      <div className="rounded-xl bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 px-4 py-3">
        <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-2">Preview</p>
        {buildPreview()}
      </div>

      {/* Actions */}
      <div className="flex gap-3 justify-end">
        <Button variant="secondary" onClick={onCancel} disabled={executing}>
          Cancel
        </Button>
        <Button
          onClick={() => onApply(effectiveFromDate, effectiveToDate)}
          disabled={
            executing ||
            ((mode === 'from_date' || mode === 'date_range') && !cutoffDate) ||
            (mode === 'date_range' && (!toDate || toDate < cutoffDate))
          }
        >
          {executing ? 'Applying…' : 'Apply Change'}
        </Button>
      </div>
    </div>
  );
}
