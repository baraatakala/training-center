import { useState, useEffect, useCallback, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/Card';
import { Button } from '@/shared/components/ui/Button';
import { ConfirmDialog } from '@/shared/components/ui/ConfirmDialog';
import { useToast } from '@/shared/hooks/useToast';
import { ToastContainer } from '@/shared/components/ui/ToastContainer';
import { useIsTeacher } from '@/shared/hooks/useIsTeacher';
import {
  type ScoringConfig,
  DEFAULT_SCORING_CONFIG,
  saveScoringConfig,
  getScoringConfig,
  resetScoringConfig,
  calcLateScore,
  calcWeightedScore,
  calcCoverageFactor,
  generateDecayCurve,
  generateCoverageCurve,
} from '@/features/scoring/services/scoringConfigService';

// =====================================================
// MINI CHART COMPONENT (SVG-based, no external deps)
// =====================================================

function MiniChart({ 
  data, 
  xKey, 
  yKey, 
  color = '#3b82f6', 
  height = 120, 
  width = 320,
  xLabel = '',
  yLabel = '',
  referenceLines = [] as { value: number; label: string; color: string }[],
}: {
  data: Record<string, number>[];
  xKey: string;
  yKey: string;
  color?: string;
  height?: number;
  width?: number;
  xLabel?: string;
  yLabel?: string;
  referenceLines?: { value: number; label: string; color: string }[];
}) {
  const padding = { top: 10, right: 15, bottom: 30, left: 40 };
  const chartW = width - padding.left - padding.right;
  const chartH = height - padding.top - padding.bottom;
  
  const xValues = data.map(d => d[xKey]);
  const yValues = data.map(d => d[yKey]);
  const xMin = Math.min(...xValues);
  const xMax = Math.max(...xValues);
  const yMin = 0;
  const yMax = Math.max(100, ...yValues);
  
  const toX = (v: number) => padding.left + ((v - xMin) / (xMax - xMin || 1)) * chartW;
  const toY = (v: number) => padding.top + chartH - ((v - yMin) / (yMax - yMin || 1)) * chartH;
  
  const pathD = data
    .map((d, i) => `${i === 0 ? 'M' : 'L'} ${toX(d[xKey])} ${toY(d[yKey])}`)
    .join(' ');
  
  const areaD = pathD + ` L ${toX(xValues[xValues.length - 1])} ${toY(0)} L ${toX(xValues[0])} ${toY(0)} Z`;

  return (
    <svg width={width} height={height} className="overflow-visible">
      {/* Grid lines */}
      {[0, 25, 50, 75, 100].map(v => (
        <g key={v}>
          <line x1={padding.left} y1={toY(v)} x2={width - padding.right} y2={toY(v)} 
            stroke="currentColor" strokeOpacity={0.1} strokeDasharray="2,3" />
          <text x={padding.left - 5} y={toY(v) + 3} textAnchor="end" 
            className="fill-current text-gray-400 dark:text-gray-500" fontSize={9}>{v}%</text>
        </g>
      ))}
      
      {/* Reference lines */}
      {referenceLines.map((ref, i) => {
        const y = toY(ref.value);
        return (
          <g key={i}>
            <line x1={padding.left} y1={y} x2={width - padding.right} y2={y} 
              stroke={ref.color} strokeWidth={1.5} strokeDasharray="4,4" />
            <text x={width - padding.right + 2} y={y + 3} 
              fill={ref.color} fontSize={8} fontWeight="bold">{ref.label}</text>
          </g>
        );
      })}
      
      {/* Area fill */}
      <path d={areaD} fill={color} fillOpacity={0.08} />
      
      {/* Line */}
      <path d={pathD} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      
      {/* Axes */}
      <line x1={padding.left} y1={padding.top} x2={padding.left} y2={height - padding.bottom} 
        stroke="currentColor" strokeOpacity={0.2} />
      <line x1={padding.left} y1={height - padding.bottom} x2={width - padding.right} y2={height - padding.bottom} 
        stroke="currentColor" strokeOpacity={0.2} />
      
      {/* X axis labels */}
      {[xMin, Math.round((xMax - xMin) * 0.25 + xMin), Math.round((xMax - xMin) * 0.5 + xMin), Math.round((xMax - xMin) * 0.75 + xMin), xMax].map(v => (
        <text key={v} x={toX(v)} y={height - padding.bottom + 14} textAnchor="middle"
          className="fill-current text-gray-400 dark:text-gray-500" fontSize={9}>{v}</text>
      ))}
      
      {/* Axis titles */}
      {xLabel && (
        <text x={padding.left + chartW / 2} y={height - 2} textAnchor="middle"
          className="fill-current text-gray-400 dark:text-gray-500" fontSize={9}>{xLabel}</text>
      )}
      {yLabel && (
        <text x={8} y={padding.top + chartH / 2} textAnchor="middle"
          className="fill-current text-gray-400 dark:text-gray-500" fontSize={9}
          transform={`rotate(-90, 8, ${padding.top + chartH / 2})`}>{yLabel}</text>
      )}
    </svg>
  );
}

// =====================================================
// WEIGHT WHEEL - Visual weight distribution
// =====================================================

function WeightWheel({ quality, attendance, punctuality }: { quality: number; attendance: number; punctuality: number }) {
  const total = quality + attendance + punctuality;
  const cx = 80, cy = 80, r = 65;
  
  const segments = [
    { pct: quality / total, color: '#6366f1', label: 'Quality' },
    { pct: attendance / total, color: '#22c55e', label: 'Attendance' },
    { pct: punctuality / total, color: '#f59e0b', label: 'Punctuality' },
  ];
  
  let cumAngle = -90;
  
  const arcs = segments.map((seg) => {
    const startAngle = cumAngle;
    const sweepAngle = seg.pct * 360;
    cumAngle += sweepAngle;
    
    const startRad = (startAngle * Math.PI) / 180;
    const endRad = ((startAngle + sweepAngle) * Math.PI) / 180;
    
    const x1 = cx + r * Math.cos(startRad);
    const y1 = cy + r * Math.sin(startRad);
    const x2 = cx + r * Math.cos(endRad);
    const y2 = cy + r * Math.sin(endRad);
    
    const largeArc = sweepAngle > 180 ? 1 : 0;
    const d = `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2} Z`;
    
    // Label position
    const midRad = ((startAngle + sweepAngle / 2) * Math.PI) / 180;
    const lx = cx + r * 0.6 * Math.cos(midRad);
    const ly = cy + r * 0.6 * Math.sin(midRad);
    
    return { ...seg, d, lx, ly };
  });
  
  return (
    <svg width={160} height={160} viewBox="0 0 160 160">
      {arcs.map((arc, i) => (
        <g key={i}>
          <path d={arc.d} fill={arc.color} fillOpacity={0.85} stroke="white" strokeWidth={2} />
          {arc.pct > 0.08 && (
            <text x={arc.lx} y={arc.ly + 4} textAnchor="middle" fill="white" fontSize={11} fontWeight="bold">
              {Math.round(arc.pct * 100)}%
            </text>
          )}
        </g>
      ))}
      <circle cx={cx} cy={cy} r={20} fill="white" className="dark:fill-gray-800" />
      <text x={cx} y={cy + 4} textAnchor="middle" className="fill-current text-gray-600 dark:text-gray-300" fontSize={10} fontWeight="bold">
        Score
      </text>
    </svg>
  );
}

// =====================================================
// SLIDER WITH LABELS
// =====================================================

function LabeledSlider({
  label,
  value,
  min,
  max,
  step,
  unit = '',
  description,
  color = 'blue',
  onChange,
  disabled = false,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  description?: string;
  color?: string;
  onChange: (v: number) => void;
  disabled?: boolean;
}) {
  const colorMap: Record<string, string> = {
    blue: 'accent-blue-600',
    green: 'accent-green-600',
    amber: 'accent-amber-600',
    purple: 'accent-purple-600',
    red: 'accent-red-600',
    indigo: 'accent-indigo-600',
  };
  
  return (
    <div className="space-y-1">
      <div className="flex justify-between items-center">
        <label className="text-sm font-medium text-gray-700 dark:text-gray-300">{label}</label>
        <div className="flex items-center gap-1">
          <input
            type="number"
            value={value}
            min={min}
            max={max}
            step={step}
            onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
            disabled={disabled}
            className={`w-20 text-right px-2 py-0.5 text-sm border rounded-md bg-white dark:bg-gray-700 
              border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 ${disabled ? 'opacity-60 cursor-not-allowed' : ''}`}
          />
          {unit && <span className="text-xs text-gray-500 dark:text-gray-400 w-6">{unit}</span>}
        </div>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        disabled={disabled}
        className={`w-full h-2 rounded-lg ${disabled ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'} ${colorMap[color] || colorMap.blue}`}
      />
      {description && (
        <p className="text-xs text-gray-500 dark:text-gray-400">{description}</p>
      )}
    </div>
  );
}

// =====================================================
// SIMULATION PANEL
// =====================================================

const SIM_STORAGE_KEY = 'scoring_sim_values';

function loadSimValues(): { present: number; late: number; absent: number; excused: number; notHeld: number; avgLateMin: number; totalClassSessions: number } {
  try {
    const raw = localStorage.getItem(SIM_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        present: typeof parsed.present === 'number' ? parsed.present : 18,
        late: typeof parsed.late === 'number' ? parsed.late : 3,
        absent: typeof parsed.absent === 'number' ? parsed.absent : 4,
        excused: typeof parsed.excused === 'number' ? parsed.excused : 2,
        notHeld: typeof parsed.notHeld === 'number' ? parsed.notHeld : 3,
        avgLateMin: typeof parsed.avgLateMin === 'number' ? parsed.avgLateMin : 15,
        totalClassSessions: typeof parsed.totalClassSessions === 'number' ? parsed.totalClassSessions : 27,
      };
    }
  } catch { /* ignore */ }
  return { present: 18, late: 3, absent: 4, excused: 2, notHeld: 3, avgLateMin: 15, totalClassSessions: 27 };
}

function SimulationPanel({ config }: { config: Omit<ScoringConfig, 'id' | 'teacher_id' | 'created_at' | 'updated_at'> }) {
  const saved = loadSimValues();
  const [simPresent, setSimPresent] = useState(saved.present);
  const [simLate, setSimLate] = useState(saved.late);
  const [simAbsent, setSimAbsent] = useState(saved.absent);
  const [simNotHeld, setSimNotHeld] = useState(saved.notHeld);
  const [simAvgLateMin, setSimAvgLateMin] = useState(saved.avgLateMin);
  const [simTotalClassSessions, setSimTotalClassSessions] = useState(saved.totalClassSessions);
  
  // Effective = present + late + absent (what the student is accountable for)
  const simEffectiveSessions = simPresent + simLate + simAbsent;
  
  // Persist simulation values to localStorage whenever they change
  useEffect(() => {
    localStorage.setItem(SIM_STORAGE_KEY, JSON.stringify({
      present: simPresent, late: simLate, absent: simAbsent,
      notHeld: simNotHeld, avgLateMin: simAvgLateMin,
      totalClassSessions: simTotalClassSessions,
    }));
  }, [simPresent, simLate, simAbsent, simNotHeld, simAvgLateMin, simTotalClassSessions]);
  
  const results = useMemo(() => {
    const effective = simPresent + simLate + simAbsent;
    const attendanceRate = effective > 0 ? ((simPresent + simLate) / effective) * 100 : 0;
    const punctualityPct = (simPresent + simLate) > 0 ? (simPresent / (simPresent + simLate)) * 100 : 0;
    
    // Quality: present gets full credit, late gets decay credit
    const lateCredit = calcLateScore(simAvgLateMin, config);
    const qualityScore = simPresent + (simLate * lateCredit);
    const qualityRate = effective > 0 ? (qualityScore / effective) * 100 : 0;
    
    // Coverage denominator = Total Class Sessions minus Not Held (matches AttendanceRecords)
    // This is the global class-wide count, NOT just this student's sessions
    const totalForCoverage = simTotalClassSessions - simNotHeld;
    const { rawScore, coverageFactor, finalScore } = calcWeightedScore(
      qualityRate, attendanceRate, punctualityPct, effective, totalForCoverage, config
    );
    
    // Apply Bonuses & Penalties (same logic as AttendanceRecords)
    let adjustedScore = finalScore;
    let bonusTotal = 0;
    let penaltyTotal = 0;
    
    // Perfect attendance bonus
    if (attendanceRate >= 100 && config.perfect_attendance_bonus > 0) {
      bonusTotal += config.perfect_attendance_bonus;
    }
    
    // Absence penalty multiplier
    if (config.absence_penalty_multiplier > 1.0 && simAbsent > 0) {
      const baseDeduction = effective > 0 ? (simAbsent / effective) * 100 : 0;
      penaltyTotal += baseDeduction * (config.absence_penalty_multiplier - 1);
    }
    
    // Streak bonus (simplified: estimate ~1 week per 5 sessions present+late)
    if (config.streak_bonus_per_week > 0) {
      const estimatedWeeks = Math.floor((simPresent + simLate) / 5);
      bonusTotal += estimatedWeeks * config.streak_bonus_per_week;
    }
    
    adjustedScore = adjustedScore + bonusTotal - penaltyTotal;
    adjustedScore = Math.min(100, Math.max(0, adjustedScore));
    
    return {
      attendanceRate: Math.round(attendanceRate * 10) / 10,
      qualityRate: Math.round(qualityRate * 10) / 10,
      punctualityPct: Math.round(punctualityPct * 10) / 10,
      lateCredit: Math.round(lateCredit * 100),
      rawScore: Math.round(rawScore * 10) / 10,
      coverageFactor: Math.round(coverageFactor * 1000) / 1000,
      finalScore: Math.round(adjustedScore * 10) / 10,
      baseScore: Math.round(finalScore * 10) / 10,
      bonusTotal: Math.round(bonusTotal * 10) / 10,
      penaltyTotal: Math.round(penaltyTotal * 10) / 10,
      effective,
      totalForCoverage,
    };
  }, [simPresent, simLate, simAbsent, simNotHeld, simTotalClassSessions, simAvgLateMin, config]);
  
  const scoreColor = results.finalScore >= 80 ? 'text-green-600 dark:text-green-400' :
    results.finalScore >= 60 ? 'text-yellow-600 dark:text-yellow-400' :
    results.finalScore >= 40 ? 'text-orange-600 dark:text-orange-400' : 'text-red-600 dark:text-red-400';
  
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <div>
          <label className="text-xs font-medium text-gray-600 dark:text-gray-400">On Time</label>
          <input type="number" value={simPresent} min={0} max={100} step={1}
            onChange={(e) => setSimPresent(Math.floor(Number(e.target.value)) || 0)}
            className="w-full mt-1 px-2 py-1.5 text-sm border rounded-lg bg-green-50 dark:bg-green-900/20 
              border-green-200 dark:border-green-800 text-green-800 dark:text-green-300 font-medium" />
        </div>
        <div>
          <label className="text-xs font-medium text-gray-600 dark:text-gray-400">Late</label>
          <input type="number" value={simLate} min={0} max={100} step={1}
            onChange={(e) => setSimLate(Math.floor(Number(e.target.value)) || 0)}
            className="w-full mt-1 px-2 py-1.5 text-sm border rounded-lg bg-yellow-50 dark:bg-yellow-900/20 
              border-yellow-200 dark:border-yellow-800 text-yellow-800 dark:text-yellow-300 font-medium" />
        </div>
        <div>
          <label className="text-xs font-medium text-gray-600 dark:text-gray-400">Absent</label>
          <input type="number" value={simAbsent} min={0} max={100} step={1}
            onChange={(e) => setSimAbsent(Math.floor(Number(e.target.value)) || 0)}
            className="w-full mt-1 px-2 py-1.5 text-sm border rounded-lg bg-red-50 dark:bg-red-900/20 
              border-red-200 dark:border-red-800 text-red-800 dark:text-red-300 font-medium" />
        </div>
        <div>
          <label className="text-xs font-medium text-gray-600 dark:text-gray-400">Not Held</label>
          <input type="number" value={simNotHeld} min={0} max={100} step={1}
            onChange={(e) => setSimNotHeld(Math.floor(Number(e.target.value)) || 0)}
            className="w-full mt-1 px-2 py-1.5 text-sm border rounded-lg bg-gray-50 dark:bg-gray-700 
              border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-400 font-medium" />
          <span className="text-[10px] text-gray-400 dark:text-gray-500">Excluded entirely</span>
        </div>
        <div>
          <label className="text-xs font-medium text-gray-600 dark:text-gray-400">Avg Late (min)</label>
          <input type="number" value={simAvgLateMin} min={0} max={240} step="any"
            onChange={(e) => setSimAvgLateMin(parseFloat(e.target.value) || 0)}
            className="w-full mt-1 px-2 py-1.5 text-sm border rounded-lg bg-gray-50 dark:bg-gray-700 
              border-gray-200 dark:border-gray-600 text-gray-800 dark:text-gray-300 font-medium" />
        </div>
        <div>
          <label className="text-xs font-medium text-gray-600 dark:text-gray-400">Total Sessions</label>
          <input type="number" value={simTotalClassSessions} min={1} max={500} step={1}
            onChange={(e) => setSimTotalClassSessions(Math.floor(Number(e.target.value)) || 1)}
            className="w-full mt-1 px-2 py-1.5 text-sm border rounded-lg bg-purple-50 dark:bg-purple-900/20 
              border-purple-200 dark:border-purple-800 text-purple-800 dark:text-purple-300 font-medium" />
          <span className="text-[10px] text-purple-400 dark:text-purple-500">All class sessions</span>
        </div>
      </div>
      
      {/* Auto-calculated summary */}
      <div className="flex flex-wrap gap-2 text-[10px]">
        <span className="px-2 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 font-medium">
          Effective: {simEffectiveSessions}
        </span>
        <span className="px-2 py-0.5 rounded-full bg-purple-50 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400 font-medium">
          Coverage: {simEffectiveSessions}/{results.totalForCoverage}
        </span>
      </div>
      
      {/* Results */}
      <div className="bg-gradient-to-r from-gray-50 to-blue-50 dark:from-gray-800 dark:to-blue-900/20 
        rounded-xl p-4 border border-gray-200 dark:border-gray-700">
        <div className="text-center mb-3">
          <span className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide font-medium">Final Weighted Score</span>
          <div className={`text-4xl font-bold ${scoreColor}`}>{results.finalScore}</div>
        </div>
        
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="flex justify-between bg-white dark:bg-gray-700/50 rounded-lg px-2 py-1.5">
            <span className="text-gray-500 dark:text-gray-400">Quality Rate</span>
            <span className="font-semibold text-indigo-600 dark:text-indigo-400">{results.qualityRate}%</span>
          </div>
          <div className="flex justify-between bg-white dark:bg-gray-700/50 rounded-lg px-2 py-1.5">
            <span className="text-gray-500 dark:text-gray-400">Attendance Rate</span>
            <span className="font-semibold text-green-600 dark:text-green-400">{results.attendanceRate}%</span>
          </div>
          <div className="flex justify-between bg-white dark:bg-gray-700/50 rounded-lg px-2 py-1.5">
            <span className="text-gray-500 dark:text-gray-400">Punctuality</span>
            <span className="font-semibold text-amber-600 dark:text-amber-400">{results.punctualityPct}%</span>
          </div>
          <div className="flex justify-between bg-white dark:bg-gray-700/50 rounded-lg px-2 py-1.5">
            <span className="text-gray-500 dark:text-gray-400">Late Credit</span>
            <span className="font-semibold text-purple-600 dark:text-purple-400">{results.lateCredit}%</span>
          </div>
          <div className="flex justify-between bg-white dark:bg-gray-700/50 rounded-lg px-2 py-1.5">
            <span className="text-gray-500 dark:text-gray-400">Raw Score</span>
            <span className="font-semibold">{results.rawScore}</span>
          </div>
          <div className="flex justify-between bg-white dark:bg-gray-700/50 rounded-lg px-2 py-1.5">
            <span className="text-gray-500 dark:text-gray-400">Coverage</span>
            <span className="font-semibold">{results.coverageFactor}</span>
          </div>
          {(results.bonusTotal > 0 || results.penaltyTotal > 0) && (
            <>
              <div className="flex justify-between bg-green-50 dark:bg-green-900/20 rounded-lg px-2 py-1.5">
                <span className="text-green-600 dark:text-green-400">Bonuses</span>
                <span className="font-semibold text-green-600 dark:text-green-400">+{results.bonusTotal}</span>
              </div>
              <div className="flex justify-between bg-red-50 dark:bg-red-900/20 rounded-lg px-2 py-1.5">
                <span className="text-red-600 dark:text-red-400">Penalties</span>
                <span className="font-semibold text-red-600 dark:text-red-400">-{results.penaltyTotal}</span>
              </div>
            </>
          )}
        </div>
        
        {/* Formula breakdown */}
        <div className="mt-3 p-2 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-600">
          <p className="text-xs text-gray-500 dark:text-gray-400 font-mono text-center">
            ({config.weight_quality}%Ãƒâ€”{results.qualityRate} + {config.weight_attendance}%Ãƒâ€”{results.attendanceRate} + {config.weight_punctuality}%Ãƒâ€”{results.punctualityPct}) Ãƒâ€” {results.coverageFactor}
            {results.bonusTotal > 0 && <span className="text-green-600 dark:text-green-400"> +{results.bonusTotal}</span>}
            {results.penaltyTotal > 0 && <span className="text-red-600 dark:text-red-400"> Ã¢Ë†â€™{results.penaltyTotal}</span>}
            {' '}= <span className={`font-bold ${scoreColor}`}>{results.finalScore}</span>
          </p>
        </div>
      </div>
    </div>
  );
}

// =====================================================
// TRANSLATIONS
// =====================================================

const translations = {
  en: {
    title: 'Scoring Configuration',
    subtitle: 'Dynamically control how weighted scores are calculated for attendance records',
    resetToDefault: 'Reset to Default',
    saving: 'Saving...',
    saveChanges: 'Ã°Å¸â€™Â¾ Save Changes',
    saved: 'Saved',
    quickPresets: 'Quick Presets',
    presetsHint: 'Ã¢â‚¬â€ Click to apply a pre-configured template',
    // Section tabs
    sectionWeights: 'Score Weights',
    sectionDecay: 'Late Decay',
    sectionCoverage: 'Coverage Factor',
    sectionBrackets: 'Display Brackets',
    sectionBonuses: 'Bonuses & Penalties',
    // Weights
    weightsTitle: 'Score Component Weights',
    sum: 'Sum',
    qualityLabel: 'Quality-Adjusted Rate',
    qualityDesc: 'Attendance rate with late penalty applied (e^(-t/Ãâ€ž) decay)',
    attendanceLabel: 'Simple Attendance Rate',
    attendanceDesc: 'Credit for showing up (on time + late both count as present)',
    punctualityLabel: 'Punctuality Bonus',
    punctualityDesc: 'Ratio of on-time arrivals vs total present sessions',
    quality: 'Quality',
    attendance: 'Attendance',
    punctuality: 'Punctuality',
    formula: 'FORMULA',
    // Late Decay
    decayTitle: 'Late Arrival Scoring Curve',
    decaySubtitle: 'Controls how much credit a student gets based on how late they arrive. Uses exponential decay:',
    decayConstant: 'Decay Constant (Ãâ€ž)',
    decayConstantDesc: 'Higher = more lenient. 43.3 gives 50% credit at 30 min',
    minimumCredit: 'Minimum Credit',
    minimumCreditDesc: 'Floor credit for any late arrival (0 = no credit, 0.5 = 50%)',
    unknownLate: 'Unknown Late Estimate',
    unknownLateDesc: 'Credit when late_minutes is not tracked (~20 min equivalent)',
    decayCurvePreview: 'DECAY CURVE PREVIEW',
    referencePoints: 'REFERENCE POINTS',
    minutesLate: 'Minutes Late',
    creditPercent: 'Credit %',
    // Coverage
    coverageTitle: 'Coverage Factor',
    coverageSubtitle: 'Penalizes students who attended very few sessions, so they don\'t outrank students with consistent full-course attendance.',
    enableCoverage: 'Enable Coverage Factor',
    enableCoverageDesc: 'When disabled, all students are scored equally regardless of how many sessions they attended',
    scalingMethod: 'Scaling Method',
    sqrtName: 'Ã¢Ë†Å¡ Square Root',
    sqrtDesc: 'Gentle curve (default)',
    linearName: 'Ã¢â‚¬â€ Linear',
    linearDesc: 'Proportional',
    logName: 'ln Logarithmic',
    logDesc: 'Harsh for low attendance',
    noneName: 'Ã¢Ë†â€¦ None',
    noneDesc: 'No coverage penalty',
    minFactor: 'Minimum Factor',
    minFactorDesc: 'Floor for coverage factor (prevents scores going to near-zero)',
    coverageCurve: 'COVERAGE CURVE (30 sessions total)',
    daysAttended: 'Days Attended',
    factorPercent: 'Factor %',
    // Brackets
    bracketsTitle: 'Late Display Brackets',
    bracketsSubtitle: 'Visual categorization only Ã¢â‚¬â€ scoring uses the smooth decay curve, not these brackets.',
    bracketName: 'Bracket name',
    preview: 'Preview',
    addBracket: '+ Add Bracket',
    // Bonuses
    bonusesTitle: 'Bonuses & Penalties',
    bonusesSubtitle: 'Optional modifiers that add extra scoring dimensions.',
    perfectBonus: 'Perfect Attendance Bonus',
    perfectBonusDesc: 'Extra points added when student has 100% attendance (0 = disabled)',
    streakBonus: 'Streak Bonus (per week)',
    streakBonusDesc: 'Bonus per consecutive week of perfect attendance',
    absenceMultiplier: 'Unexcused Absence Multiplier',
    absenceMultiplierDesc: '1.0 = normal, 2.0 = double penalty for unexcused absences',
    // Simulation
    liveSimulation: 'Live Simulation',
    // How It Works
    howItWorks: 'How It Works',
    howQuality: 'Each "on time" session = 100% credit. Each "late" session gets partial credit based on the decay curve.',
    howAttendance: 'Simple present/total. Both "on time" and "late" count as present.',
    howPunctuality: 'Ratio of on-time sessions to total present sessions.',
    howCoverage: 'Penalizes new students or those enrolled in few sessions.',
    howBonuses: 'Perfect attendance bonus, streak bonus per week, and absence penalty multiplier are applied after the base score.',
    howFormula: 'Final = (WÃ¢â€šÂÃƒâ€”Quality + WÃ¢â€šâ€šÃƒâ€”Attendance + WÃ¢â€šÆ’Ãƒâ€”Punctuality) Ãƒâ€” Coverage + Bonuses Ã¢Ë†â€™ Penalties',
    // Reset dialog
    resetTitle: 'Reset Scoring Configuration',
    resetMessage: 'This will revert all settings to the factory defaults. Your current configuration will be lost. Continue?',
    resetConfirm: 'Reset to Defaults',
    // Access
    adminRequired: 'Admin Access Required',
    adminRequiredDesc: 'Only the admin can configure scoring parameters.',
    backToDashboard: 'Back to Dashboard',
    readOnlyBanner: 'You are viewing scoring configuration in read-only mode.',
    readOnlyBannerStudent: 'Students can view but not modify scoring settings.',
    // Presets
    presetBalanced: 'Balanced (Default)',
    presetBalancedDesc: 'Equal emphasis on quality, attendance, and timeliness',
    presetStrict: 'Strict Punctuality',
    presetStrictDesc: 'Heavy penalty for lateness, low tolerance',
    presetLenient: 'Lenient',
    presetLenientDesc: 'Forgiving Ã¢â‚¬â€ focus on showing up, mild late penalties',
    presetQuality: 'Quality First',
    presetQualityDesc: 'Maximum weight on quality-adjusted rate',
    presetAttendance: 'Attendance Only',
    presetAttendanceDesc: 'Pure attendance tracking Ã¢â‚¬â€ lateness barely affects score',
    presetMilitary: 'Military Precision',
    presetMilitaryDesc: 'Zero tolerance Ã¢â‚¬â€ late is almost as bad as absent',
  },
  ar: {
    title: 'Ã˜Â¥Ã˜Â¹Ã˜Â¯Ã˜Â§Ã˜Â¯Ã˜Â§Ã˜Âª Ã˜Â§Ã™â€žÃ˜ÂªÃ™â€šÃ™Å Ã™Å Ã™â€¦',
    subtitle: 'Ã˜Â§Ã™â€žÃ˜ÂªÃ˜Â­Ã™Æ’Ã™â€¦ Ã˜Â§Ã™â€žÃ˜Â¯Ã™Å Ã™â€ Ã˜Â§Ã™â€¦Ã™Å Ã™Æ’Ã™Å  Ã™ÂÃ™Å  Ã™Æ’Ã™Å Ã™ÂÃ™Å Ã˜Â© Ã˜Â­Ã˜Â³Ã˜Â§Ã˜Â¨ Ã˜Â§Ã™â€žÃ˜Â¯Ã˜Â±Ã˜Â¬Ã˜Â§Ã˜Âª Ã˜Â§Ã™â€žÃ™â€¦Ã˜Â±Ã˜Â¬Ã™â€˜Ã˜Â­Ã˜Â© Ã™â€žÃ˜Â³Ã˜Â¬Ã™â€žÃ˜Â§Ã˜Âª Ã˜Â§Ã™â€žÃ˜Â­Ã˜Â¶Ã™Ë†Ã˜Â±',
    resetToDefault: 'Ã˜Â¥Ã˜Â¹Ã˜Â§Ã˜Â¯Ã˜Â© Ã™â€žÃ™â€žÃ˜Â§Ã™ÂÃ˜ÂªÃ˜Â±Ã˜Â§Ã˜Â¶Ã™Å ',
    saving: 'Ã˜Â¬Ã˜Â§Ã˜Â±Ã™Â Ã˜Â§Ã™â€žÃ˜Â­Ã™ÂÃ˜Â¸...',
    saveChanges: 'Ã°Å¸â€™Â¾ Ã˜Â­Ã™ÂÃ˜Â¸ Ã˜Â§Ã™â€žÃ˜ÂªÃ˜ÂºÃ™Å Ã™Å Ã˜Â±Ã˜Â§Ã˜Âª',
    saved: 'Ã˜ÂªÃ™â€¦ Ã˜Â§Ã™â€žÃ˜Â­Ã™ÂÃ˜Â¸',
    quickPresets: 'Ã™â€šÃ™Ë†Ã˜Â§Ã™â€žÃ˜Â¨ Ã˜Â³Ã˜Â±Ã™Å Ã˜Â¹Ã˜Â©',
    presetsHint: 'Ã¢â‚¬â€ Ã˜Â§Ã™â€ Ã™â€šÃ˜Â± Ã™â€žÃ˜ÂªÃ˜Â·Ã˜Â¨Ã™Å Ã™â€š Ã™â€šÃ˜Â§Ã™â€žÃ˜Â¨ Ã™â€¦Ã™ÂÃ˜Â¹Ã˜Â¯ Ã™â€¦Ã˜Â³Ã˜Â¨Ã™â€šÃ˜Â§Ã™â€¹',
    // Section tabs
    sectionWeights: 'Ã˜Â£Ã™Ë†Ã˜Â²Ã˜Â§Ã™â€  Ã˜Â§Ã™â€žÃ˜Â¯Ã˜Â±Ã˜Â¬Ã˜Â§Ã˜Âª',
    sectionDecay: 'Ã˜ÂªÃ™â€ Ã˜Â§Ã™â€šÃ˜Âµ Ã˜Â§Ã™â€žÃ˜ÂªÃ˜Â£Ã˜Â®Ã™Å Ã˜Â±',
    sectionCoverage: 'Ã˜Â¹Ã˜Â§Ã™â€¦Ã™â€ž Ã˜Â§Ã™â€žÃ˜ÂªÃ˜ÂºÃ˜Â·Ã™Å Ã˜Â©',
    sectionBrackets: 'Ã™ÂÃ˜Â¦Ã˜Â§Ã˜Âª Ã˜Â§Ã™â€žÃ˜Â¹Ã˜Â±Ã˜Â¶',
    sectionBonuses: 'Ã˜Â§Ã™â€žÃ™â€¦Ã™Æ’Ã˜Â§Ã™ÂÃ˜Â¢Ã˜Âª Ã™Ë†Ã˜Â§Ã™â€žÃ˜Â¹Ã™â€šÃ™Ë†Ã˜Â¨Ã˜Â§Ã˜Âª',
    // Weights
    weightsTitle: 'Ã˜Â£Ã™Ë†Ã˜Â²Ã˜Â§Ã™â€  Ã™â€¦Ã™Æ’Ã™Ë†Ã™â€ Ã˜Â§Ã˜Âª Ã˜Â§Ã™â€žÃ˜Â¯Ã˜Â±Ã˜Â¬Ã˜Â©',
    sum: 'Ã˜Â§Ã™â€žÃ™â€¦Ã˜Â¬Ã™â€¦Ã™Ë†Ã˜Â¹',
    qualityLabel: 'Ã™â€¦Ã˜Â¹Ã˜Â¯Ã™â€ž Ã˜Â§Ã™â€žÃ˜Â¬Ã™Ë†Ã˜Â¯Ã˜Â© Ã˜Â§Ã™â€žÃ™â€¦Ã˜Â¹Ã˜Â¯Ã™â€˜Ã™â€ž',
    qualityDesc: 'Ã™â€¦Ã˜Â¹Ã˜Â¯Ã™â€ž Ã˜Â§Ã™â€žÃ˜Â­Ã˜Â¶Ã™Ë†Ã˜Â± Ã™â€¦Ã˜Â¹ Ã˜ÂªÃ˜Â·Ã˜Â¨Ã™Å Ã™â€š Ã˜Â¹Ã™â€šÃ™Ë†Ã˜Â¨Ã˜Â© Ã˜Â§Ã™â€žÃ˜ÂªÃ˜Â£Ã˜Â®Ã™Å Ã˜Â± (Ã˜ÂªÃ™â€ Ã˜Â§Ã™â€šÃ˜Âµ Ã˜Â£Ã˜Â³Ã™Å )',
    attendanceLabel: 'Ã™â€¦Ã˜Â¹Ã˜Â¯Ã™â€ž Ã˜Â§Ã™â€žÃ˜Â­Ã˜Â¶Ã™Ë†Ã˜Â± Ã˜Â§Ã™â€žÃ˜Â¨Ã˜Â³Ã™Å Ã˜Â·',
    attendanceDesc: 'Ã˜Â§Ã™â€žÃ™ÂÃ˜Â¶Ã™â€ž Ã™ÂÃ™Å  Ã˜Â§Ã™â€žÃ˜Â­Ã˜Â¶Ã™Ë†Ã˜Â± (Ã™ÂÃ™Å  Ã˜Â§Ã™â€žÃ™Ë†Ã™â€šÃ˜Âª Ã™Ë†Ã˜Â§Ã™â€žÃ™â€¦Ã˜ÂªÃ˜Â£Ã˜Â®Ã˜Â± Ã™Æ’Ã™â€žÃ˜Â§Ã™â€¡Ã™â€¦Ã˜Â§ Ã™Å Ã™ÂÃ˜Â­Ã˜Â³Ã˜Â¨ Ã˜Â­Ã˜Â§Ã˜Â¶Ã˜Â±Ã˜Â§Ã™â€¹)',
    punctualityLabel: 'Ã™â€¦Ã™Æ’Ã˜Â§Ã™ÂÃ˜Â£Ã˜Â© Ã˜Â§Ã™â€žÃ˜Â§Ã™â€ Ã˜Â¶Ã˜Â¨Ã˜Â§Ã˜Â·',
    punctualityDesc: 'Ã™â€ Ã˜Â³Ã˜Â¨Ã˜Â© Ã˜Â§Ã™â€žÃ˜Â­Ã˜Â¶Ã™Ë†Ã˜Â± Ã™ÂÃ™Å  Ã˜Â§Ã™â€žÃ™Ë†Ã™â€šÃ˜Âª Ã™â€¦Ã™â€šÃ˜Â§Ã˜Â¨Ã™â€ž Ã˜Â¥Ã˜Â¬Ã™â€¦Ã˜Â§Ã™â€žÃ™Å  Ã˜Â§Ã™â€žÃ˜Â¬Ã™â€žÃ˜Â³Ã˜Â§Ã˜Âª Ã˜Â§Ã™â€žÃ˜Â­Ã˜Â§Ã˜Â¶Ã˜Â±Ã˜Â©',
    quality: 'Ã˜Â§Ã™â€žÃ˜Â¬Ã™Ë†Ã˜Â¯Ã˜Â©',
    attendance: 'Ã˜Â§Ã™â€žÃ˜Â­Ã˜Â¶Ã™Ë†Ã˜Â±',
    punctuality: 'Ã˜Â§Ã™â€žÃ˜Â§Ã™â€ Ã˜Â¶Ã˜Â¨Ã˜Â§Ã˜Â·',
    formula: 'Ã˜Â§Ã™â€žÃ™â€¦Ã˜Â¹Ã˜Â§Ã˜Â¯Ã™â€žÃ˜Â©',
    // Late Decay
    decayTitle: 'Ã™â€¦Ã™â€ Ã˜Â­Ã™â€ Ã™â€° Ã˜ÂªÃ™â€šÃ™Å Ã™Å Ã™â€¦ Ã˜Â§Ã™â€žÃ˜ÂªÃ˜Â£Ã˜Â®Ã™Å Ã˜Â±',
    decaySubtitle: 'Ã™Å Ã˜ÂªÃ˜Â­Ã™Æ’Ã™â€¦ Ã™ÂÃ™Å  Ã™â€¦Ã™â€šÃ˜Â¯Ã˜Â§Ã˜Â± Ã˜Â§Ã™â€žÃ˜Â§Ã˜Â¦Ã˜ÂªÃ™â€¦Ã˜Â§Ã™â€  Ã˜Â§Ã™â€žÃ˜Â°Ã™Å  Ã™Å Ã˜Â­Ã˜ÂµÃ™â€ž Ã˜Â¹Ã™â€žÃ™Å Ã™â€¡ Ã˜Â§Ã™â€žÃ˜Â·Ã˜Â§Ã™â€žÃ˜Â¨ Ã˜Â¨Ã™â€ Ã˜Â§Ã˜Â¡Ã™â€¹ Ã˜Â¹Ã™â€žÃ™â€° Ã˜ÂªÃ˜Â£Ã˜Â®Ã˜Â±Ã™â€¡. Ã™Å Ã˜Â³Ã˜ÂªÃ˜Â®Ã˜Â¯Ã™â€¦ Ã˜Â§Ã™â€žÃ˜ÂªÃ™â€ Ã˜Â§Ã™â€šÃ˜Âµ Ã˜Â§Ã™â€žÃ˜Â£Ã˜Â³Ã™Å :',
    decayConstant: 'Ã˜Â«Ã˜Â§Ã˜Â¨Ã˜Âª Ã˜Â§Ã™â€žÃ˜ÂªÃ™â€ Ã˜Â§Ã™â€šÃ˜Âµ (Ãâ€ž)',
    decayConstantDesc: 'Ã˜Â£Ã˜Â¹Ã™â€žÃ™â€° = Ã˜Â£Ã™Æ’Ã˜Â«Ã˜Â± Ã˜ÂªÃ˜Â³Ã˜Â§Ã™â€¦Ã˜Â­Ã˜Â§Ã™â€¹. 43.3 Ã™Å Ã˜Â¹Ã˜Â·Ã™Å  50% Ã˜Â§Ã˜Â¦Ã˜ÂªÃ™â€¦Ã˜Â§Ã™â€  Ã˜Â¹Ã™â€ Ã˜Â¯ 30 Ã˜Â¯Ã™â€šÃ™Å Ã™â€šÃ˜Â©',
    minimumCredit: 'Ã˜Â§Ã™â€žÃ˜Â­Ã˜Â¯ Ã˜Â§Ã™â€žÃ˜Â£Ã˜Â¯Ã™â€ Ã™â€° Ã™â€žÃ™â€žÃ˜Â§Ã˜Â¦Ã˜ÂªÃ™â€¦Ã˜Â§Ã™â€ ',
    minimumCreditDesc: 'Ã˜Â£Ã˜Â¯Ã™â€ Ã™â€° Ã˜Â§Ã˜Â¦Ã˜ÂªÃ™â€¦Ã˜Â§Ã™â€  Ã™â€žÃ˜Â£Ã™Å  Ã˜ÂªÃ˜Â£Ã˜Â®Ã™Å Ã˜Â± (0 = Ã˜Â¨Ã˜Â¯Ã™Ë†Ã™â€ Ã˜Å’ 0.5 = 50%)',
    unknownLate: 'Ã˜ÂªÃ™â€šÃ˜Â¯Ã™Å Ã˜Â± Ã˜Â§Ã™â€žÃ˜ÂªÃ˜Â£Ã˜Â®Ã˜Â± Ã˜ÂºÃ™Å Ã˜Â± Ã˜Â§Ã™â€žÃ™â€¦Ã˜Â¹Ã˜Â±Ã™Ë†Ã™Â',
    unknownLateDesc: 'Ã˜Â§Ã™â€žÃ˜Â§Ã˜Â¦Ã˜ÂªÃ™â€¦Ã˜Â§Ã™â€  Ã˜Â¹Ã™â€ Ã˜Â¯Ã™â€¦Ã˜Â§ Ã™â€žÃ˜Â§ Ã™Å Ã˜ÂªÃ™â€¦ Ã˜ÂªÃ˜ÂªÃ˜Â¨Ã˜Â¹ Ã˜Â¯Ã™â€šÃ˜Â§Ã˜Â¦Ã™â€š Ã˜Â§Ã™â€žÃ˜ÂªÃ˜Â£Ã˜Â®Ã™Å Ã˜Â± (~Ã™â€¦Ã˜Â§ Ã™Å Ã˜Â¹Ã˜Â§Ã˜Â¯Ã™â€ž 20 Ã˜Â¯Ã™â€šÃ™Å Ã™â€šÃ˜Â©)',
    decayCurvePreview: 'Ã™â€¦Ã˜Â¹Ã˜Â§Ã™Å Ã™â€ Ã˜Â© Ã™â€¦Ã™â€ Ã˜Â­Ã™â€ Ã™â€° Ã˜Â§Ã™â€žÃ˜ÂªÃ™â€ Ã˜Â§Ã™â€šÃ˜Âµ',
    referencePoints: 'Ã™â€ Ã™â€šÃ˜Â§Ã˜Â· Ã™â€¦Ã˜Â±Ã˜Â¬Ã˜Â¹Ã™Å Ã˜Â©',
    minutesLate: 'Ã˜Â¯Ã™â€šÃ˜Â§Ã˜Â¦Ã™â€š Ã˜Â§Ã™â€žÃ˜ÂªÃ˜Â£Ã˜Â®Ã™Å Ã˜Â±',
    creditPercent: 'Ã˜Â§Ã™â€žÃ˜Â§Ã˜Â¦Ã˜ÂªÃ™â€¦Ã˜Â§Ã™â€  %',
    // Coverage
    coverageTitle: 'Ã˜Â¹Ã˜Â§Ã™â€¦Ã™â€ž Ã˜Â§Ã™â€žÃ˜ÂªÃ˜ÂºÃ˜Â·Ã™Å Ã˜Â©',
    coverageSubtitle: 'Ã™Å Ã˜Â¹Ã˜Â§Ã™â€šÃ˜Â¨ Ã˜Â§Ã™â€žÃ˜Â·Ã™â€žÃ˜Â§Ã˜Â¨ Ã˜Â§Ã™â€žÃ˜Â°Ã™Å Ã™â€  Ã˜Â­Ã˜Â¶Ã˜Â±Ã™Ë†Ã˜Â§ Ã˜Â¬Ã™â€žÃ˜Â³Ã˜Â§Ã˜Âª Ã™â€šÃ™â€žÃ™Å Ã™â€žÃ˜Â© Ã˜Â¬Ã˜Â¯Ã˜Â§Ã™â€¹Ã˜Å’ Ã˜Â­Ã˜ÂªÃ™â€° Ã™â€žÃ˜Â§ Ã™Å Ã˜ÂªÃ™ÂÃ™Ë†Ã™â€šÃ™Ë†Ã˜Â§ Ã˜Â¹Ã™â€žÃ™â€° Ã˜Â§Ã™â€žÃ˜Â·Ã™â€žÃ˜Â§Ã˜Â¨ Ã˜Â°Ã™Ë†Ã™Å  Ã˜Â§Ã™â€žÃ˜Â­Ã˜Â¶Ã™Ë†Ã˜Â± Ã˜Â§Ã™â€žÃ™â€¦Ã™â€ Ã˜ÂªÃ˜Â¸Ã™â€¦.',
    enableCoverage: 'Ã˜ÂªÃ™ÂÃ˜Â¹Ã™Å Ã™â€ž Ã˜Â¹Ã˜Â§Ã™â€¦Ã™â€ž Ã˜Â§Ã™â€žÃ˜ÂªÃ˜ÂºÃ˜Â·Ã™Å Ã˜Â©',
    enableCoverageDesc: 'Ã˜Â¹Ã™â€ Ã˜Â¯ Ã˜Â§Ã™â€žÃ˜ÂªÃ˜Â¹Ã˜Â·Ã™Å Ã™â€žÃ˜Å’ Ã™Å Ã˜ÂªÃ™â€¦ Ã˜ÂªÃ™â€šÃ™Å Ã™Å Ã™â€¦ Ã˜Â¬Ã™â€¦Ã™Å Ã˜Â¹ Ã˜Â§Ã™â€žÃ˜Â·Ã™â€žÃ˜Â§Ã˜Â¨ Ã˜Â¨Ã˜Â§Ã™â€žÃ˜ÂªÃ˜Â³Ã˜Â§Ã™Ë†Ã™Å  Ã˜Â¨Ã˜ÂºÃ˜Â¶ Ã˜Â§Ã™â€žÃ™â€ Ã˜Â¸Ã˜Â± Ã˜Â¹Ã™â€  Ã˜Â¹Ã˜Â¯Ã˜Â¯ Ã˜Â§Ã™â€žÃ˜Â¬Ã™â€žÃ˜Â³Ã˜Â§Ã˜Âª',
    scalingMethod: 'Ã˜Â·Ã˜Â±Ã™Å Ã™â€šÃ˜Â© Ã˜Â§Ã™â€žÃ™â€šÃ™Å Ã˜Â§Ã˜Â³',
    sqrtName: 'Ã¢Ë†Å¡ Ã˜Â¬Ã˜Â°Ã˜Â± Ã˜ÂªÃ˜Â±Ã˜Â¨Ã™Å Ã˜Â¹Ã™Å ',
    sqrtDesc: 'Ã™â€¦Ã™â€ Ã˜Â­Ã™â€ Ã™â€° Ã™â€žÃ˜Â·Ã™Å Ã™Â (Ã˜Â§Ã™ÂÃ˜ÂªÃ˜Â±Ã˜Â§Ã˜Â¶Ã™Å )',
    linearName: 'Ã¢â‚¬â€ Ã˜Â®Ã˜Â·Ã™Å ',
    linearDesc: 'Ã™â€¦Ã˜ÂªÃ™â€ Ã˜Â§Ã˜Â³Ã˜Â¨',
    logName: 'ln Ã™â€žÃ™Ë†Ã˜ÂºÃ˜Â§Ã˜Â±Ã™Å Ã˜ÂªÃ™â€¦Ã™Å ',
    logDesc: 'Ã˜ÂµÃ˜Â§Ã˜Â±Ã™â€¦ Ã™â€žÃ™â€žÃ˜Â­Ã˜Â¶Ã™Ë†Ã˜Â± Ã˜Â§Ã™â€žÃ™â€¦Ã™â€ Ã˜Â®Ã™ÂÃ˜Â¶',
    noneName: 'Ã¢Ë†â€¦ Ã˜Â¨Ã˜Â¯Ã™Ë†Ã™â€ ',
    noneDesc: 'Ã˜Â¨Ã˜Â¯Ã™Ë†Ã™â€  Ã˜Â¹Ã™â€šÃ™Ë†Ã˜Â¨Ã˜Â© Ã˜ÂªÃ˜ÂºÃ˜Â·Ã™Å Ã˜Â©',
    minFactor: 'Ã˜Â§Ã™â€žÃ˜Â­Ã˜Â¯ Ã˜Â§Ã™â€žÃ˜Â£Ã˜Â¯Ã™â€ Ã™â€° Ã™â€žÃ™â€žÃ˜Â¹Ã˜Â§Ã™â€¦Ã™â€ž',
    minFactorDesc: 'Ã˜Â£Ã˜Â±Ã˜Â¶Ã™Å Ã˜Â© Ã˜Â¹Ã˜Â§Ã™â€¦Ã™â€ž Ã˜Â§Ã™â€žÃ˜ÂªÃ˜ÂºÃ˜Â·Ã™Å Ã˜Â© (Ã™Å Ã™â€¦Ã™â€ Ã˜Â¹ Ã˜Â§Ã™â€žÃ˜Â¯Ã˜Â±Ã˜Â¬Ã˜Â§Ã˜Âª Ã™â€¦Ã™â€  Ã˜Â§Ã™â€žÃ˜Â§Ã™â€ Ã˜Â®Ã™ÂÃ˜Â§Ã˜Â¶ Ã™â€žÃ™â€žÃ˜ÂµÃ™ÂÃ˜Â±)',
    coverageCurve: 'Ã™â€¦Ã™â€ Ã˜Â­Ã™â€ Ã™â€° Ã˜Â§Ã™â€žÃ˜ÂªÃ˜ÂºÃ˜Â·Ã™Å Ã˜Â© (30 Ã˜Â¬Ã™â€žÃ˜Â³Ã˜Â© Ã˜Â¥Ã˜Â¬Ã™â€¦Ã˜Â§Ã™â€žÃ™Å )',
    daysAttended: 'Ã˜Â£Ã™Å Ã˜Â§Ã™â€¦ Ã˜Â§Ã™â€žÃ˜Â­Ã˜Â¶Ã™Ë†Ã˜Â±',
    factorPercent: 'Ã˜Â§Ã™â€žÃ˜Â¹Ã˜Â§Ã™â€¦Ã™â€ž %',
    // Brackets
    bracketsTitle: 'Ã™ÂÃ˜Â¦Ã˜Â§Ã˜Âª Ã˜Â¹Ã˜Â±Ã˜Â¶ Ã˜Â§Ã™â€žÃ˜ÂªÃ˜Â£Ã˜Â®Ã™Å Ã˜Â±',
    bracketsSubtitle: 'Ã˜ÂªÃ˜ÂµÃ™â€ Ã™Å Ã™Â Ã˜Â¨Ã˜ÂµÃ˜Â±Ã™Å  Ã™ÂÃ™â€šÃ˜Â· Ã¢â‚¬â€ Ã˜Â§Ã™â€žÃ˜ÂªÃ™â€šÃ™Å Ã™Å Ã™â€¦ Ã™Å Ã˜Â³Ã˜ÂªÃ˜Â®Ã˜Â¯Ã™â€¦ Ã™â€¦Ã™â€ Ã˜Â­Ã™â€ Ã™â€° Ã˜Â§Ã™â€žÃ˜ÂªÃ™â€ Ã˜Â§Ã™â€šÃ˜Âµ Ã˜Â§Ã™â€žÃ˜Â³Ã™â€žÃ˜Â³ Ã™Ë†Ã™â€žÃ™Å Ã˜Â³ Ã™â€¡Ã˜Â°Ã™â€¡ Ã˜Â§Ã™â€žÃ™ÂÃ˜Â¦Ã˜Â§Ã˜Âª.',
    bracketName: 'Ã˜Â§Ã˜Â³Ã™â€¦ Ã˜Â§Ã™â€žÃ™ÂÃ˜Â¦Ã˜Â©',
    preview: 'Ã™â€¦Ã˜Â¹Ã˜Â§Ã™Å Ã™â€ Ã˜Â©',
    addBracket: '+ Ã˜Â¥Ã˜Â¶Ã˜Â§Ã™ÂÃ˜Â© Ã™ÂÃ˜Â¦Ã˜Â©',
    // Bonuses
    bonusesTitle: 'Ã˜Â§Ã™â€žÃ™â€¦Ã™Æ’Ã˜Â§Ã™ÂÃ˜Â¢Ã˜Âª Ã™Ë†Ã˜Â§Ã™â€žÃ˜Â¹Ã™â€šÃ™Ë†Ã˜Â¨Ã˜Â§Ã˜Âª',
    bonusesSubtitle: 'Ã™â€¦Ã˜Â¹Ã˜Â¯Ã™â€˜Ã™â€žÃ˜Â§Ã˜Âª Ã˜Â§Ã˜Â®Ã˜ÂªÃ™Å Ã˜Â§Ã˜Â±Ã™Å Ã˜Â© Ã˜ÂªÃ˜Â¶Ã™Å Ã™Â Ã˜Â£Ã˜Â¨Ã˜Â¹Ã˜Â§Ã˜Â¯ Ã˜ÂªÃ™â€šÃ™Å Ã™Å Ã™â€¦ Ã˜Â¥Ã˜Â¶Ã˜Â§Ã™ÂÃ™Å Ã˜Â©.',
    perfectBonus: 'Ã™â€¦Ã™Æ’Ã˜Â§Ã™ÂÃ˜Â£Ã˜Â© Ã˜Â§Ã™â€žÃ˜Â­Ã˜Â¶Ã™Ë†Ã˜Â± Ã˜Â§Ã™â€žÃ™Æ’Ã˜Â§Ã™â€¦Ã™â€ž',
    perfectBonusDesc: 'Ã™â€ Ã™â€šÃ˜Â§Ã˜Â· Ã˜Â¥Ã˜Â¶Ã˜Â§Ã™ÂÃ™Å Ã˜Â© Ã˜Â¹Ã™â€ Ã˜Â¯ Ã˜Â­Ã˜Â¶Ã™Ë†Ã˜Â± 100% (0 = Ã™â€¦Ã˜Â¹Ã˜Â·Ã™â€ž)',
    streakBonus: 'Ã™â€¦Ã™Æ’Ã˜Â§Ã™ÂÃ˜Â£Ã˜Â© Ã˜Â§Ã™â€žÃ˜ÂªÃ˜ÂªÃ˜Â§Ã˜Â¨Ã˜Â¹ (Ã˜Â£Ã˜Â³Ã˜Â¨Ã™Ë†Ã˜Â¹Ã™Å Ã˜Â§Ã™â€¹)',
    streakBonusDesc: 'Ã™â€¦Ã™Æ’Ã˜Â§Ã™ÂÃ˜Â£Ã˜Â© Ã™â€žÃ™Æ’Ã™â€ž Ã˜Â£Ã˜Â³Ã˜Â¨Ã™Ë†Ã˜Â¹ Ã™â€¦Ã˜ÂªÃ˜ÂªÃ˜Â§Ã™â€žÃ™Å  Ã™â€¦Ã™â€  Ã˜Â§Ã™â€žÃ˜Â­Ã˜Â¶Ã™Ë†Ã˜Â± Ã˜Â§Ã™â€žÃ™Æ’Ã˜Â§Ã™â€¦Ã™â€ž',
    absenceMultiplier: 'Ã™â€¦Ã˜Â¶Ã˜Â§Ã˜Â¹Ã™Â Ã˜Â§Ã™â€žÃ˜ÂºÃ™Å Ã˜Â§Ã˜Â¨ Ã˜Â¨Ã˜Â¯Ã™Ë†Ã™â€  Ã˜Â¹Ã˜Â°Ã˜Â±',
    absenceMultiplierDesc: '1.0 = Ã˜Â¹Ã˜Â§Ã˜Â¯Ã™Å Ã˜Å’ 2.0 = Ã˜Â¹Ã™â€šÃ™Ë†Ã˜Â¨Ã˜Â© Ã™â€¦Ã˜Â¶Ã˜Â§Ã˜Â¹Ã™ÂÃ˜Â© Ã™â€žÃ™â€žÃ˜ÂºÃ™Å Ã˜Â§Ã˜Â¨ Ã˜Â¨Ã˜Â¯Ã™Ë†Ã™â€  Ã˜Â¹Ã˜Â°Ã˜Â±',
    // Simulation
    liveSimulation: 'Ã˜Â§Ã™â€žÃ™â€¦Ã˜Â­Ã˜Â§Ã™Æ’Ã˜Â§Ã˜Â© Ã˜Â§Ã™â€žÃ˜Â­Ã™Å Ã˜Â©',
    // How It Works
    howItWorks: 'Ã™Æ’Ã™Å Ã™Â Ã™Å Ã˜Â¹Ã™â€¦Ã™â€ž',
    howQuality: 'Ã™Æ’Ã™â€ž Ã˜Â¬Ã™â€žÃ˜Â³Ã˜Â© "Ã™ÂÃ™Å  Ã˜Â§Ã™â€žÃ™Ë†Ã™â€šÃ˜Âª" = 100% Ã˜Â§Ã˜Â¦Ã˜ÂªÃ™â€¦Ã˜Â§Ã™â€ . Ã™Æ’Ã™â€ž Ã˜Â¬Ã™â€žÃ˜Â³Ã˜Â© "Ã™â€¦Ã˜ÂªÃ˜Â£Ã˜Â®Ã˜Â±Ã˜Â©" Ã˜ÂªÃ˜Â­Ã˜ÂµÃ™â€ž Ã˜Â¹Ã™â€žÃ™â€° Ã˜Â§Ã˜Â¦Ã˜ÂªÃ™â€¦Ã˜Â§Ã™â€  Ã˜Â¬Ã˜Â²Ã˜Â¦Ã™Å  Ã˜Â¨Ã™â€ Ã˜Â§Ã˜Â¡Ã™â€¹ Ã˜Â¹Ã™â€žÃ™â€° Ã™â€¦Ã™â€ Ã˜Â­Ã™â€ Ã™â€° Ã˜Â§Ã™â€žÃ˜ÂªÃ™â€ Ã˜Â§Ã™â€šÃ˜Âµ.',
    howAttendance: 'Ã˜Â­Ã˜Â§Ã˜Â¶Ã˜Â±/Ã˜Â¥Ã˜Â¬Ã™â€¦Ã˜Â§Ã™â€žÃ™Å  Ã˜Â¨Ã˜Â³Ã™Å Ã˜Â·. Ã™Æ’Ã™â€žÃ˜Â§ "Ã™ÂÃ™Å  Ã˜Â§Ã™â€žÃ™Ë†Ã™â€šÃ˜Âª" Ã™Ë† "Ã™â€¦Ã˜ÂªÃ˜Â£Ã˜Â®Ã˜Â±" Ã™Å Ã™ÂÃ˜Â­Ã˜Â³Ã˜Â¨ Ã™Æ’Ã˜Â­Ã˜Â§Ã˜Â¶Ã˜Â±.',
    howPunctuality: 'Ã™â€ Ã˜Â³Ã˜Â¨Ã˜Â© Ã˜Â§Ã™â€žÃ˜Â¬Ã™â€žÃ˜Â³Ã˜Â§Ã˜Âª Ã™ÂÃ™Å  Ã˜Â§Ã™â€žÃ™Ë†Ã™â€šÃ˜Âª Ã˜Â¥Ã™â€žÃ™â€° Ã˜Â¥Ã˜Â¬Ã™â€¦Ã˜Â§Ã™â€žÃ™Å  Ã˜Â§Ã™â€žÃ˜Â¬Ã™â€žÃ˜Â³Ã˜Â§Ã˜Âª Ã˜Â§Ã™â€žÃ˜Â­Ã˜Â§Ã˜Â¶Ã˜Â±Ã˜Â©.',
    howCoverage: 'Ã™Å Ã˜Â¹Ã˜Â§Ã™â€šÃ˜Â¨ Ã˜Â§Ã™â€žÃ˜Â·Ã™â€žÃ˜Â§Ã˜Â¨ Ã˜Â§Ã™â€žÃ˜Â¬Ã˜Â¯Ã˜Â¯ Ã˜Â£Ã™Ë† Ã˜Â§Ã™â€žÃ™â€¦Ã˜Â³Ã˜Â¬Ã™â€žÃ™Å Ã™â€  Ã™ÂÃ™Å  Ã˜Â¹Ã˜Â¯Ã˜Â¯ Ã™â€šÃ™â€žÃ™Å Ã™â€ž Ã™â€¦Ã™â€  Ã˜Â§Ã™â€žÃ˜Â¬Ã™â€žÃ˜Â³Ã˜Â§Ã˜Âª.',
    howBonuses: 'Ã™â€¦Ã™Æ’Ã˜Â§Ã™ÂÃ˜Â£Ã˜Â© Ã˜Â§Ã™â€žÃ˜Â­Ã˜Â¶Ã™Ë†Ã˜Â± Ã˜Â§Ã™â€žÃ™Æ’Ã˜Â§Ã™â€¦Ã™â€ž Ã™Ë†Ã™â€¦Ã™Æ’Ã˜Â§Ã™ÂÃ˜Â£Ã˜Â© Ã˜Â§Ã™â€žÃ˜ÂªÃ˜ÂªÃ˜Â§Ã˜Â¨Ã˜Â¹ Ã˜Â§Ã™â€žÃ˜Â£Ã˜Â³Ã˜Â¨Ã™Ë†Ã˜Â¹Ã™Å Ã˜Â© Ã™Ë†Ã™â€¦Ã˜Â¶Ã˜Â§Ã˜Â¹Ã™Â Ã˜Â¹Ã™â€šÃ™Ë†Ã˜Â¨Ã˜Â© Ã˜Â§Ã™â€žÃ˜ÂºÃ™Å Ã˜Â§Ã˜Â¨ Ã˜ÂªÃ™ÂÃ˜Â·Ã˜Â¨Ã™â€š Ã˜Â¨Ã˜Â¹Ã˜Â¯ Ã˜Â§Ã™â€žÃ˜Â¯Ã˜Â±Ã˜Â¬Ã˜Â© Ã˜Â§Ã™â€žÃ˜Â£Ã˜Â³Ã˜Â§Ã˜Â³Ã™Å Ã˜Â©.',
    howFormula: 'Ã˜Â§Ã™â€žÃ™â€ Ã™â€¡Ã˜Â§Ã˜Â¦Ã™Å  = (Ã™Ë†Ã¢â€šÂÃƒâ€”Ã˜Â§Ã™â€žÃ˜Â¬Ã™Ë†Ã˜Â¯Ã˜Â© + Ã™Ë†Ã¢â€šâ€šÃƒâ€”Ã˜Â§Ã™â€žÃ˜Â­Ã˜Â¶Ã™Ë†Ã˜Â± + Ã™Ë†Ã¢â€šÆ’Ãƒâ€”Ã˜Â§Ã™â€žÃ˜Â§Ã™â€ Ã˜Â¶Ã˜Â¨Ã˜Â§Ã˜Â·) Ãƒâ€” Ã˜Â§Ã™â€žÃ˜ÂªÃ˜ÂºÃ˜Â·Ã™Å Ã˜Â© + Ã˜Â§Ã™â€žÃ™â€¦Ã™Æ’Ã˜Â§Ã™ÂÃ˜Â¢Ã˜Âª Ã¢Ë†â€™ Ã˜Â§Ã™â€žÃ˜Â¹Ã™â€šÃ™Ë†Ã˜Â¨Ã˜Â§Ã˜Âª',
    // Reset dialog
    resetTitle: 'Ã˜Â¥Ã˜Â¹Ã˜Â§Ã˜Â¯Ã˜Â© Ã˜ÂªÃ˜Â¹Ã™Å Ã™Å Ã™â€  Ã˜Â¥Ã˜Â¹Ã˜Â¯Ã˜Â§Ã˜Â¯Ã˜Â§Ã˜Âª Ã˜Â§Ã™â€žÃ˜ÂªÃ™â€šÃ™Å Ã™Å Ã™â€¦',
    resetMessage: 'Ã˜Â³Ã™Å Ã˜Â¤Ã˜Â¯Ã™Å  Ã™â€¡Ã˜Â°Ã˜Â§ Ã˜Â¥Ã™â€žÃ™â€° Ã˜Â¥Ã˜Â±Ã˜Â¬Ã˜Â§Ã˜Â¹ Ã˜Â¬Ã™â€¦Ã™Å Ã˜Â¹ Ã˜Â§Ã™â€žÃ˜Â¥Ã˜Â¹Ã˜Â¯Ã˜Â§Ã˜Â¯Ã˜Â§Ã˜Âª Ã˜Â¥Ã™â€žÃ™â€° Ã˜Â§Ã™â€žÃ˜Â§Ã™ÂÃ˜ÂªÃ˜Â±Ã˜Â§Ã˜Â¶Ã™Å . Ã˜Â³Ã™Å Ã˜ÂªÃ™â€¦ Ã™ÂÃ™â€šÃ˜Â¯Ã˜Â§Ã™â€  Ã˜Â§Ã™â€žÃ˜Â¥Ã˜Â¹Ã˜Â¯Ã˜Â§Ã˜Â¯Ã˜Â§Ã˜Âª Ã˜Â§Ã™â€žÃ˜Â­Ã˜Â§Ã™â€žÃ™Å Ã˜Â©. Ã™â€¦Ã˜ÂªÃ˜Â§Ã˜Â¨Ã˜Â¹Ã˜Â©Ã˜Å¸',
    resetConfirm: 'Ã˜Â¥Ã˜Â¹Ã˜Â§Ã˜Â¯Ã˜Â© Ã™â€žÃ™â€žÃ˜Â§Ã™ÂÃ˜ÂªÃ˜Â±Ã˜Â§Ã˜Â¶Ã™Å ',
    // Access
    adminRequired: 'Ã™â€¦Ã˜Â·Ã™â€žÃ™Ë†Ã˜Â¨ Ã˜ÂµÃ™â€žÃ˜Â§Ã˜Â­Ã™Å Ã˜Â© Ã˜Â§Ã™â€žÃ™â€¦Ã˜Â´Ã˜Â±Ã™Â',
    adminRequiredDesc: 'Ã™ÂÃ™â€šÃ˜Â· Ã˜Â§Ã™â€žÃ™â€¦Ã˜Â´Ã˜Â±Ã™Â Ã™Å Ã™â€¦Ã™Æ’Ã™â€ Ã™â€¡ Ã˜ÂªÃ˜Â¹Ã˜Â¯Ã™Å Ã™â€ž Ã˜Â¥Ã˜Â¹Ã˜Â¯Ã˜Â§Ã˜Â¯Ã˜Â§Ã˜Âª Ã˜Â§Ã™â€žÃ˜ÂªÃ™â€šÃ™Å Ã™Å Ã™â€¦.',
    backToDashboard: 'Ã˜Â§Ã™â€žÃ˜Â¹Ã™Ë†Ã˜Â¯Ã˜Â© Ã™â€žÃ™â€žÃ™Ë†Ã˜Â­Ã˜Â© Ã˜Â§Ã™â€žÃ˜ÂªÃ˜Â­Ã™Æ’Ã™â€¦',
    readOnlyBanner: 'Ã˜Â£Ã™â€ Ã˜Âª Ã˜ÂªÃ˜Â´Ã˜Â§Ã™â€¡Ã˜Â¯ Ã˜Â¥Ã˜Â¹Ã˜Â¯Ã˜Â§Ã˜Â¯Ã˜Â§Ã˜Âª Ã˜Â§Ã™â€žÃ˜ÂªÃ™â€šÃ™Å Ã™Å Ã™â€¦ Ã™ÂÃ™Å  Ã™Ë†Ã˜Â¶Ã˜Â¹ Ã˜Â§Ã™â€žÃ™â€šÃ˜Â±Ã˜Â§Ã˜Â¡Ã˜Â© Ã™ÂÃ™â€šÃ˜Â·.',
    readOnlyBannerStudent: 'Ã™Å Ã™â€¦Ã™Æ’Ã™â€  Ã™â€žÃ™â€žÃ˜Â·Ã™â€žÃ˜Â§Ã˜Â¨ Ã˜Â§Ã™â€žÃ™â€¦Ã˜Â´Ã˜Â§Ã™â€¡Ã˜Â¯Ã˜Â© Ã™ÂÃ™â€šÃ˜Â· Ã™Ë†Ã™â€žÃ™Å Ã˜Â³ Ã˜Â§Ã™â€žÃ˜ÂªÃ˜Â¹Ã˜Â¯Ã™Å Ã™â€ž.',
    // Presets
    presetBalanced: 'Ã™â€¦Ã˜ÂªÃ™Ë†Ã˜Â§Ã˜Â²Ã™â€  (Ã˜Â§Ã™ÂÃ˜ÂªÃ˜Â±Ã˜Â§Ã˜Â¶Ã™Å )',
    presetBalancedDesc: 'Ã˜ÂªÃ˜Â±Ã™Æ’Ã™Å Ã˜Â² Ã™â€¦Ã˜ÂªÃ˜Â³Ã˜Â§Ã™Ë†Ã™Å  Ã˜Â¹Ã™â€žÃ™â€° Ã˜Â§Ã™â€žÃ˜Â¬Ã™Ë†Ã˜Â¯Ã˜Â© Ã™Ë†Ã˜Â§Ã™â€žÃ˜Â­Ã˜Â¶Ã™Ë†Ã˜Â± Ã™Ë†Ã˜Â§Ã™â€žÃ˜Â§Ã™â€ Ã˜Â¶Ã˜Â¨Ã˜Â§Ã˜Â·',
    presetStrict: 'Ã˜Â§Ã™â€ Ã˜Â¶Ã˜Â¨Ã˜Â§Ã˜Â· Ã˜ÂµÃ˜Â§Ã˜Â±Ã™â€¦',
    presetStrictDesc: 'Ã˜Â¹Ã™â€šÃ™Ë†Ã˜Â¨Ã˜Â© Ã˜Â´Ã˜Â¯Ã™Å Ã˜Â¯Ã˜Â© Ã™â€žÃ™â€žÃ˜ÂªÃ˜Â£Ã˜Â®Ã™Å Ã˜Â±Ã˜Å’ Ã˜ÂªÃ˜Â³Ã˜Â§Ã™â€¦Ã˜Â­ Ã™â€¦Ã™â€ Ã˜Â®Ã™ÂÃ˜Â¶',
    presetLenient: 'Ã™â€¦Ã˜ÂªÃ˜Â³Ã˜Â§Ã™â€¦Ã˜Â­',
    presetLenientDesc: 'Ã™â€¦Ã˜ÂªÃ˜Â³Ã˜Â§Ã™â€¦Ã˜Â­ Ã¢â‚¬â€ Ã˜Â§Ã™â€žÃ˜ÂªÃ˜Â±Ã™Æ’Ã™Å Ã˜Â² Ã˜Â¹Ã™â€žÃ™â€° Ã˜Â§Ã™â€žÃ˜Â­Ã˜Â¶Ã™Ë†Ã˜Â±Ã˜Å’ Ã˜Â¹Ã™â€šÃ™Ë†Ã˜Â¨Ã˜Â§Ã˜Âª Ã˜ÂªÃ˜Â£Ã˜Â®Ã™Å Ã˜Â± Ã˜Â®Ã™ÂÃ™Å Ã™ÂÃ˜Â©',
    presetQuality: 'Ã˜Â§Ã™â€žÃ˜Â¬Ã™Ë†Ã˜Â¯Ã˜Â© Ã˜Â£Ã™Ë†Ã™â€žÃ˜Â§Ã™â€¹',
    presetQualityDesc: 'Ã˜Â£Ã™â€šÃ˜ÂµÃ™â€° Ã™Ë†Ã˜Â²Ã™â€  Ã™â€žÃ™â€¦Ã˜Â¹Ã˜Â¯Ã™â€ž Ã˜Â§Ã™â€žÃ˜Â¬Ã™Ë†Ã˜Â¯Ã˜Â© Ã˜Â§Ã™â€žÃ™â€¦Ã˜Â¹Ã˜Â¯Ã™â€˜Ã™â€ž',
    presetAttendance: 'Ã˜Â§Ã™â€žÃ˜Â­Ã˜Â¶Ã™Ë†Ã˜Â± Ã™ÂÃ™â€šÃ˜Â·',
    presetAttendanceDesc: 'Ã˜ÂªÃ˜ÂªÃ˜Â¨Ã˜Â¹ Ã˜Â­Ã˜Â¶Ã™Ë†Ã˜Â± Ã˜Â¨Ã˜Â­Ã˜Âª Ã¢â‚¬â€ Ã˜Â§Ã™â€žÃ˜ÂªÃ˜Â£Ã˜Â®Ã™Å Ã˜Â± Ã˜Â¨Ã˜Â§Ã™â€žÃ™Æ’Ã˜Â§Ã˜Â¯ Ã™Å Ã˜Â¤Ã˜Â«Ã˜Â± Ã˜Â¹Ã™â€žÃ™â€° Ã˜Â§Ã™â€žÃ˜Â¯Ã˜Â±Ã˜Â¬Ã˜Â©',
    presetMilitary: 'Ã˜Â¯Ã™â€šÃ˜Â© Ã˜Â¹Ã˜Â³Ã™Æ’Ã˜Â±Ã™Å Ã˜Â©',
    presetMilitaryDesc: 'Ã˜Â¹Ã˜Â¯Ã™â€¦ Ã˜ÂªÃ˜Â³Ã˜Â§Ã™â€¦Ã˜Â­ Ã¢â‚¬â€ Ã˜Â§Ã™â€žÃ˜ÂªÃ˜Â£Ã˜Â®Ã™Å Ã˜Â± Ã˜ÂªÃ™â€šÃ˜Â±Ã™Å Ã˜Â¨Ã˜Â§Ã™â€¹ Ã™â€¦Ã˜Â«Ã™â€ž Ã˜Â§Ã™â€žÃ˜ÂºÃ™Å Ã˜Â§Ã˜Â¨',
  },
};

// =====================================================
// PRESET TEMPLATES
// =====================================================

const PRESETS: { name: string; emoji: string; description: string; config: Partial<ScoringConfig> }[] = [
  {
    name: 'Balanced (Default)',
    emoji: 'Ã¢Å¡â€“Ã¯Â¸Â',
    description: 'Equal emphasis on quality, attendance, and timeliness',
    config: { weight_quality: 55, weight_attendance: 35, weight_punctuality: 10, late_decay_constant: 43.3, late_minimum_credit: 0.05 },
  },
  {
    name: 'Strict Punctuality',
    emoji: 'Ã¢ÂÂ°',
    description: 'Heavy penalty for lateness, low tolerance',
    config: { weight_quality: 45, weight_attendance: 25, weight_punctuality: 30, late_decay_constant: 20, late_minimum_credit: 0.01 },
  },
  {
    name: 'Lenient',
    emoji: 'Ã°Å¸â€¢Å Ã¯Â¸Â',
    description: 'Forgiving Ã¢â‚¬â€ focus on showing up, mild late penalties',
    config: { weight_quality: 30, weight_attendance: 60, weight_punctuality: 10, late_decay_constant: 80, late_minimum_credit: 0.20 },
  },
  {
    name: 'Quality First',
    emoji: 'Ã°Å¸Ââ€ ',
    description: 'Maximum weight on quality-adjusted rate',
    config: { weight_quality: 70, weight_attendance: 20, weight_punctuality: 10, late_decay_constant: 35, late_minimum_credit: 0.05 },
  },
  {
    name: 'Attendance Only',
    emoji: 'Ã°Å¸â€œâ€¹',
    description: 'Pure attendance tracking Ã¢â‚¬â€ lateness barely affects score',
    config: { weight_quality: 10, weight_attendance: 85, weight_punctuality: 5, late_decay_constant: 100, late_minimum_credit: 0.50 },
  },
  {
    name: 'Military Precision',
    emoji: 'Ã°Å¸Å½â€“Ã¯Â¸Â',
    description: 'Zero tolerance Ã¢â‚¬â€ late is almost as bad as absent',
    config: { weight_quality: 50, weight_attendance: 15, weight_punctuality: 35, late_decay_constant: 10, late_minimum_credit: 0.01 },
  },
];

// =====================================================
// MAIN COMPONENT
// =====================================================

export function ScoringConfiguration() {
  const { toasts, success, error: showError, removeToast } = useToast();
  const { isTeacher, isAdmin, loading: authLoading } = useIsTeacher();
  const canEdit = isAdmin || isTeacher;
  
  const [config, setConfig] = useState<Omit<ScoringConfig, 'id' | 'teacher_id' | 'created_at' | 'updated_at'>>(DEFAULT_SCORING_CONFIG);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [activeSection, setActiveSection] = useState<'weights' | 'decay' | 'coverage' | 'brackets' | 'bonuses'>('weights');
  const [lang, setLang] = useState<'en' | 'ar'>('en');
  const t = translations[lang];
  const isArabic = lang === 'ar';
  
  // Load existing config
  useEffect(() => {
    const load = async () => {
      const { data, error } = await getScoringConfig();
      if (error) {
        showError(`Failed to load scoring config: ${error.message}`);
      }
      if (data) {
        setConfig(data);
      }
      setLoading(false);
    };
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  
  // Update a field
  const updateField = useCallback(<K extends keyof typeof config>(field: K, value: (typeof config)[K]) => {
    setConfig(prev => ({ ...prev, [field]: value }));
    setHasChanges(true);
  }, []);
  
  // Balance weights to sum to 100
  const balanceWeights = useCallback((changed: 'quality' | 'attendance' | 'punctuality', newVal: number) => {
    const clamped = Math.max(0, Math.min(100, newVal));
    const remaining = 100 - clamped;
    
    if (changed === 'quality') {
      const ratio = config.weight_attendance + config.weight_punctuality;
      if (ratio > 0) {
        updateField('weight_quality', clamped);
        updateField('weight_attendance', Math.round(remaining * config.weight_attendance / ratio));
        updateField('weight_punctuality', remaining - Math.round(remaining * config.weight_attendance / ratio));
      } else {
        updateField('weight_quality', clamped);
        updateField('weight_attendance', remaining);
        updateField('weight_punctuality', 0);
      }
    } else if (changed === 'attendance') {
      const ratio = config.weight_quality + config.weight_punctuality;
      if (ratio > 0) {
        updateField('weight_attendance', clamped);
        updateField('weight_quality', Math.round(remaining * config.weight_quality / ratio));
        updateField('weight_punctuality', remaining - Math.round(remaining * config.weight_quality / ratio));
      } else {
        updateField('weight_attendance', clamped);
        updateField('weight_quality', remaining);
        updateField('weight_punctuality', 0);
      }
    } else {
      const ratio = config.weight_quality + config.weight_attendance;
      if (ratio > 0) {
        updateField('weight_punctuality', clamped);
        updateField('weight_quality', Math.round(remaining * config.weight_quality / ratio));
        updateField('weight_attendance', remaining - Math.round(remaining * config.weight_quality / ratio));
      } else {
        updateField('weight_punctuality', clamped);
        updateField('weight_quality', remaining);
        updateField('weight_attendance', 0);
      }
    }
  }, [config, updateField]);
  
  // Apply preset
  const applyPreset = useCallback((preset: typeof PRESETS[0]) => {
    setConfig(prev => ({ ...prev, ...preset.config }));
    setHasChanges(true);
    success(`Applied "${preset.name}" preset`);
  }, [success]);
  
  // Save
  const handleSave = useCallback(async () => {
    // Validate weights sum
    const sum = config.weight_quality + config.weight_attendance + config.weight_punctuality;
    if (Math.abs(sum - 100) > 0.5) {
      showError(`Weights must sum to 100% (currently ${sum}%)`);
      return;
    }
    
    // Auto-fix tiny rounding errors before save
    const roundedConfig = {
      ...config,
      weight_quality: Math.round(config.weight_quality * 100) / 100,
      weight_attendance: Math.round(config.weight_attendance * 100) / 100,
      weight_punctuality: Math.round(config.weight_punctuality * 100) / 100,
    };
    
    setSaving(true);
    const { data, error } = await saveScoringConfig(roundedConfig);
    setSaving(false);
    
    if (error && !data) {
      // Complete failure Ã¢â‚¬â€ nothing saved
      showError(`Save failed: ${error.message}`);
    } else if (error && data) {
      // Partial success Ã¢â‚¬â€ saved to localStorage but DB failed
      setHasChanges(false);
      success('Configuration saved locally. Note: ' + error.message);
    } else {
      setHasChanges(false);
      success('Scoring configuration saved to database! It will be used for future score calculations.');
    }
  }, [config, success, showError]);
  
  // Reset
  const handleReset = useCallback(async () => {
    setShowResetConfirm(false);
    const { error } = await resetScoringConfig();
    if (error) {
      showError(`Reset failed: ${error.message}`);
    } else {
      setConfig(DEFAULT_SCORING_CONFIG);
      setHasChanges(false);
      success('Reset to default configuration');
    }
  }, [success, showError]);
  
  // Decay curve data
  const decayCurve = useMemo(() => generateDecayCurve(config), [config]);
  const coverageCurve = useMemo(() => generateCoverageCurve(config), [config]);
  
  // Key reference points for the decay
  const decayRefPoints = useMemo(() => [
    { min: 5, label: '5 min' },
    { min: 15, label: '15 min' },
    { min: 30, label: '30 min' },
    { min: 60, label: '60 min' },
    { min: 90, label: '90 min' },
    { min: 120, label: '120 min' },
  ].map(p => ({
    ...p,
    credit: Math.round(calcLateScore(p.min, config) * 100),
  })), [config]);
  
  if (authLoading || loading) {
    return (
      <div className="space-y-6 p-6 animate-pulse">
        <div className="h-8 bg-gray-200 dark:bg-gray-700 rounded-lg w-64" />
        <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-96 mt-2" />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="h-64 bg-gray-200 dark:bg-gray-700 rounded-xl" />
          <div className="h-64 bg-gray-200 dark:bg-gray-700 rounded-xl" />
        </div>
      </div>
    );
  }
  
  // No access-denied block Ã¢â‚¬â€ everyone can view the page.
  // canEdit (admin/teacher) can modify; students see read-only.
  
  const sections = [
    { id: 'weights' as const, label: t.sectionWeights, icon: 'Ã¢Å¡â€“Ã¯Â¸Â' },
    { id: 'decay' as const, label: t.sectionDecay, icon: 'Ã°Å¸â€œâ€°' },
    { id: 'coverage' as const, label: t.sectionCoverage, icon: 'Ã°Å¸â€œÅ ' },
    { id: 'brackets' as const, label: t.sectionBrackets, icon: 'Ã°Å¸ÂÂ·Ã¯Â¸Â' },
    { id: 'bonuses' as const, label: t.sectionBonuses, icon: 'Ã°Å¸Å½Â¯' },
  ];
  
  const presetNames = [t.presetBalanced, t.presetStrict, t.presetLenient, t.presetQuality, t.presetAttendance, t.presetMilitary];
  const presetDescs = [t.presetBalancedDesc, t.presetStrictDesc, t.presetLenientDesc, t.presetQualityDesc, t.presetAttendanceDesc, t.presetMilitaryDesc];
  
  return (
    <div className={`space-y-6 ${isArabic ? 'direction-rtl' : ''}`} dir={isArabic ? 'rtl' : 'ltr'}>
      <ToastContainer toasts={toasts} onClose={removeToast} />
      
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold bg-gradient-to-r from-indigo-600 to-purple-600 
            bg-clip-text text-transparent dark:from-indigo-400 dark:to-purple-400">
            {t.title}
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            {t.subtitle}
          </p>
        </div>
        <div className="flex gap-2 items-center">
          {/* Language Toggle */}
          <div className="flex items-center gap-1 bg-gray-100 dark:bg-gray-800 rounded-lg p-1">
            <button
              onClick={() => setLang('en')}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-all duration-200 ${
                lang === 'en'
                  ? 'bg-white dark:bg-gray-700 shadow-sm text-indigo-700 dark:text-indigo-300'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
              }`}
            >
              EN
            </button>
            <button
              onClick={() => setLang('ar')}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-all duration-200 ${
                lang === 'ar'
                  ? 'bg-white dark:bg-gray-700 shadow-sm text-indigo-700 dark:text-indigo-300'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
              }`}
            >
              Ã˜Â¹
            </button>
          </div>
          {canEdit && (
            <>
              <Button variant="outline" onClick={() => setShowResetConfirm(true)} disabled={saving}>
                {t.resetToDefault}
              </Button>
              <Button 
                onClick={handleSave} 
                disabled={saving || !hasChanges}
                className={hasChanges ? 'bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white shadow-lg shadow-indigo-500/25' : ''}
              >
                {saving ? t.saving : hasChanges ? t.saveChanges : t.saved}
              </Button>
            </>
          )}
        </div>
      </div>
      
      {/* Read-only banner for students */}
      {!canEdit && (
        <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl p-4 flex items-center gap-3">
          <span className="text-2xl">Ã°Å¸â€˜ÂÃ¯Â¸Â</span>
          <div>
            <p className="text-sm font-medium text-blue-700 dark:text-blue-300">{t.readOnlyBanner}</p>
            <p className="text-xs text-blue-500 dark:text-blue-400">{t.readOnlyBannerStudent}</p>
          </div>
        </div>
      )}
      
      {/* Presets Bar Ã¢â‚¬â€ only for editors */}
      {canEdit && (
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-4">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">{t.quickPresets}</span>
          <span className="text-xs text-gray-400">{t.presetsHint}</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((preset, i) => (
            <button
              key={i}
              onClick={() => applyPreset(preset)}
              className="group flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium
                bg-gray-50 dark:bg-gray-700/50 border border-gray-200 dark:border-gray-600
                hover:bg-indigo-50 hover:border-indigo-300 dark:hover:bg-indigo-900/30 dark:hover:border-indigo-600
                transition-all duration-200"
              title={presetDescs[i]}
            >
              <span>{preset.emoji}</span>
              <span className="text-gray-700 dark:text-gray-300 group-hover:text-indigo-700 dark:group-hover:text-indigo-300">
                {presetNames[i]}
              </span>
            </button>
          ))}
        </div>
      </div>
      )}
      
      {/* Main Content - Section Nav + Editor + Simulation */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Left: Section Navigation + Editor */}
        <div className="xl:col-span-2 space-y-4">
          {/* Section Tabs */}
          <div className="flex gap-1 p-1 bg-gray-100 dark:bg-gray-800 rounded-xl overflow-x-auto">
            {sections.map(sec => (
              <button
                key={sec.id}
                onClick={() => setActiveSection(sec.id)}
                className={`flex items-center gap-1.5 px-3 py-2 min-h-[36px] rounded-lg text-sm font-medium whitespace-nowrap transition-all
                  ${activeSection === sec.id
                    ? 'bg-white dark:bg-gray-700 shadow-sm text-indigo-700 dark:text-indigo-300'
                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
                  }`}
                aria-label={sec.label}
                title={sec.label}
              >
                <span>{sec.icon}</span>
                <span className="hidden sm:inline">{sec.label}</span>
              </button>
            ))}
          </div>
          
          {/* Section Content */}
          <Card>
            <CardContent className="p-6 space-y-6">
              {/* WEIGHTS SECTION */}
              {activeSection === 'weights' && (
                <div className="space-y-6">
                  <div className="flex items-start gap-4">
                    <div className="flex-1 space-y-4">
                      <div className="flex items-center gap-2 mb-2">
                        <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">{t.weightsTitle}</h3>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                          Math.abs(config.weight_quality + config.weight_attendance + config.weight_punctuality - 100) < 0.1
                            ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300'
                            : 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
                        }`}>
                          {t.sum}: {config.weight_quality + config.weight_attendance + config.weight_punctuality}%
                        </span>
                      </div>
                      
                      <LabeledSlider
                        label={t.qualityLabel}
                        value={config.weight_quality}
                        min={0} max={100} step={5}
                        unit="%"
                        color="indigo"
                        description={t.qualityDesc}
                        onChange={(v) => balanceWeights('quality', v)}
                        disabled={!canEdit}
                      />
                      
                      <LabeledSlider
                        label={t.attendanceLabel}
                        value={config.weight_attendance}
                        min={0} max={100} step={5}
                        unit="%"
                        color="green"
                        description={t.attendanceDesc}
                        onChange={(v) => balanceWeights('attendance', v)}
                        disabled={!canEdit}
                      />
                      
                      <LabeledSlider
                        label={t.punctualityLabel}
                        value={config.weight_punctuality}
                        min={0} max={100} step={5}
                        unit="%"
                        color="amber"
                        description={t.punctualityDesc}
                        onChange={(v) => balanceWeights('punctuality', v)}
                        disabled={!canEdit}
                      />
                    </div>
                    
                    {/* Weight wheel */}
                    <div className="hidden md:flex flex-col items-center gap-2">
                      <WeightWheel 
                        quality={config.weight_quality} 
                        attendance={config.weight_attendance} 
                        punctuality={config.weight_punctuality} 
                      />
                      <div className="text-xs space-y-1">
                        <div className="flex items-center gap-1">
                          <div className="w-2.5 h-2.5 rounded-full bg-indigo-500" /> {t.quality}
                        </div>
                        <div className="flex items-center gap-1">
                          <div className="w-2.5 h-2.5 rounded-full bg-green-500" /> {t.attendance}
                        </div>
                        <div className="flex items-center gap-1">
                          <div className="w-2.5 h-2.5 rounded-full bg-amber-500" /> {t.punctuality}
                        </div>
                      </div>
                    </div>
                  </div>
                  
                  {/* Formula display */}
                  <div className="bg-gradient-to-r from-indigo-50 to-purple-50 dark:from-indigo-900/20 dark:to-purple-900/20 
                    rounded-xl p-4 border border-indigo-100 dark:border-indigo-800/50">
                    <p className="text-xs text-gray-500 dark:text-gray-400 mb-1 font-medium">{t.formula}</p>
                    <p className="text-sm font-mono text-indigo-800 dark:text-indigo-300">
                      WeightedScore = ({config.weight_quality}% Ãƒâ€” QualityRate + {config.weight_attendance}% Ãƒâ€” AttendanceRate + {config.weight_punctuality}% Ãƒâ€” Punctuality) Ãƒâ€” CoverageFactor
                    </p>
                  </div>
                </div>
              )}
              
              {/* LATE DECAY SECTION */}
              {activeSection === 'decay' && (
                <div className="space-y-6">
                  <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">{t.decayTitle}</h3>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    {t.decaySubtitle} <code className="px-1 py-0.5 bg-gray-100 dark:bg-gray-700 rounded text-xs">score = e^(-minutes/Ãâ€ž)</code>
                  </p>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-4">
                      <LabeledSlider
                        label={t.decayConstant}
                        value={config.late_decay_constant}
                        min={5} max={200} step={1}
                        color="purple"
                        description={t.decayConstantDesc}
                        onChange={(v) => updateField('late_decay_constant', v)}
                        disabled={!canEdit}
                      />
                      
                      <LabeledSlider
                        label={t.minimumCredit}
                        value={config.late_minimum_credit}
                        min={0} max={0.5} step={0.01}
                        color="red"
                        description={t.minimumCreditDesc}
                        onChange={(v) => updateField('late_minimum_credit', v)}
                        disabled={!canEdit}
                      />
                      
                      <LabeledSlider
                        label={t.unknownLate}
                        value={config.late_null_estimate}
                        min={0} max={1} step={0.05}
                        color="blue"
                        description={t.unknownLateDesc}
                        onChange={(v) => updateField('late_null_estimate', v)}
                        disabled={!canEdit}
                      />
                    </div>
                    
                    <div>
                      <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">{t.decayCurvePreview}</p>
                      <MiniChart
                        data={decayCurve}
                        xKey="minutes"
                        yKey="credit"
                        color="#8b5cf6"
                        width={340}
                        height={160}
                        xLabel={t.minutesLate}
                        yLabel={t.creditPercent}
                        referenceLines={[
                          { value: 50, label: '50%', color: '#ef4444' },
                          { value: config.late_minimum_credit * 100, label: `Floor ${config.late_minimum_credit * 100}%`, color: '#f59e0b' },
                        ]}
                      />
                    </div>
                  </div>
                  
                  {/* Reference points table */}
                  <div>
                    <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">{t.referencePoints}</p>
                    <div className="flex flex-wrap gap-2">
                      {decayRefPoints.map(p => (
                        <div key={p.min} className="flex flex-col items-center px-3 py-2 rounded-lg border 
                          border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
                          <span className="text-xs text-gray-400">{p.label}</span>
                          <span className={`text-lg font-bold ${
                            p.credit >= 70 ? 'text-green-600 dark:text-green-400' :
                            p.credit >= 40 ? 'text-amber-600 dark:text-amber-400' :
                            'text-red-600 dark:text-red-400'
                          }`}>{p.credit}%</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
              
              {/* COVERAGE SECTION */}
              {activeSection === 'coverage' && (
                <div className="space-y-6">
                  <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">{t.coverageTitle}</h3>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    {t.coverageSubtitle}
                  </p>
                  
                  <div className="flex items-center gap-3 p-3 rounded-lg bg-gray-50 dark:bg-gray-700/50">
                    <label className={`relative inline-flex items-center ${canEdit ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'}`}>
                      <input
                        type="checkbox"
                        checked={config.coverage_enabled}
                        onChange={(e) => updateField('coverage_enabled', e.target.checked)}
                        disabled={!canEdit}
                        className="sr-only peer"
                      />
                      <div className="w-11 h-6 bg-gray-200 peer-focus:ring-4 peer-focus:ring-indigo-300 
                        dark:peer-focus:ring-indigo-800 rounded-full peer dark:bg-gray-600 
                        peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full 
                        peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] 
                        after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full 
                        after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-indigo-600" />
                    </label>
                    <div>
                      <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{t.enableCoverage}</span>
                      <p className="text-xs text-gray-500 dark:text-gray-400">{t.enableCoverageDesc}</p>
                    </div>
                  </div>
                  
                  {config.coverage_enabled && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div className="space-y-4">
                        <div>
                          <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2 block">{t.scalingMethod}</label>
                          <div className="grid grid-cols-2 gap-2">
                            {[
                              { value: 'sqrt' as const, name: t.sqrtName, desc: t.sqrtDesc },
                              { value: 'linear' as const, name: t.linearName, desc: t.linearDesc },
                              { value: 'log' as const, name: t.logName, desc: t.logDesc },
                              { value: 'none' as const, name: t.noneName, desc: t.noneDesc },
                            ].map(opt => (
                              <button
                                key={opt.value}
                                onClick={() => canEdit && updateField('coverage_method', opt.value)}
                                disabled={!canEdit}
                                className={`p-2 rounded-lg border text-left text-sm transition-all ${!canEdit ? 'opacity-60 cursor-not-allowed' : ''} ${
                                  config.coverage_method === opt.value
                                    ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/30 dark:border-indigo-600'
                                    : 'border-gray-200 dark:border-gray-600 hover:border-gray-300 dark:hover:border-gray-500'
                                }`}
                              >
                                <div className="font-medium text-gray-800 dark:text-gray-200">{opt.name}</div>
                                <div className="text-xs text-gray-500 dark:text-gray-400">{opt.desc}</div>
                              </button>
                            ))}
                          </div>
                        </div>
                        
                        <LabeledSlider
                          label={t.minFactor}
                          value={config.coverage_minimum}
                          min={0} max={0.5} step={0.05}
                          color="blue"
                          description={t.minFactorDesc}
                          onChange={(v) => updateField('coverage_minimum', v)}
                          disabled={!canEdit}
                        />
                      </div>
                      
                      <div>
                        <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">{t.coverageCurve}</p>
                        <MiniChart
                          data={coverageCurve}
                          xKey="days"
                          yKey="factor"
                          color="#3b82f6"
                          width={340}
                          height={160}
                          xLabel={t.daysAttended}
                          yLabel={t.factorPercent}
                        />
                        <div className="mt-2 flex flex-wrap gap-2 text-xs">
                          {[1, 5, 10, 20, 30].map(d => (
                            <span key={d} className="px-2 py-1 bg-gray-100 dark:bg-gray-700 rounded">
                              {d}d Ã¢â€ â€™ {Math.round(calcCoverageFactor(d, 30, config) * 100)}%
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
              
              {/* BRACKETS SECTION */}
              {activeSection === 'brackets' && (
                <div className="space-y-6">
                  <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">{t.bracketsTitle}</h3>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    {t.bracketsSubtitle}
                  </p>
                  
                  <div className="space-y-3">
                    {config.late_brackets.map((bracket, idx) => (
                      <div key={bracket.id} className="flex items-center gap-3 p-3 rounded-lg border 
                        border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800">
                        <span className="text-sm font-mono w-8 text-gray-400">{idx + 1}</span>
                        <input
                          value={bracket.name}
                          onChange={(e) => {
                            const newBrackets = [...config.late_brackets];
                            newBrackets[idx] = { ...bracket, name: e.target.value };
                            updateField('late_brackets', newBrackets);
                          }}
                          disabled={!canEdit}
                          className={`flex-1 px-2 py-1 text-sm border rounded-md bg-gray-50 dark:bg-gray-700 
                            border-gray-200 dark:border-gray-600 text-gray-900 dark:text-gray-100 ${!canEdit ? 'opacity-60 cursor-not-allowed' : ''}`}
                          placeholder={t.bracketName}
                        />
                        <div className="flex items-center gap-1 text-xs">
                          <input
                            type="number"
                            value={bracket.min}
                            onChange={(e) => {
                              const newBrackets = [...config.late_brackets];
                              newBrackets[idx] = { ...bracket, min: parseInt(e.target.value) || 0 };
                              updateField('late_brackets', newBrackets);
                            }}
                            disabled={!canEdit}
                            className={`w-14 px-1 py-1 text-center border rounded-md bg-gray-50 dark:bg-gray-700 
                              border-gray-200 dark:border-gray-600 ${!canEdit ? 'opacity-60 cursor-not-allowed' : ''}`}
                          />
                          <span className="text-gray-400">-</span>
                          <input
                            type="number"
                            value={bracket.max}
                            onChange={(e) => {
                              const newBrackets = [...config.late_brackets];
                              newBrackets[idx] = { ...bracket, max: parseInt(e.target.value) || 999 };
                              updateField('late_brackets', newBrackets);
                            }}
                            disabled={!canEdit}
                            className={`w-14 px-1 py-1 text-center border rounded-md bg-gray-50 dark:bg-gray-700 
                              border-gray-200 dark:border-gray-600 ${!canEdit ? 'opacity-60 cursor-not-allowed' : ''}`}
                          />
                          <span className="text-gray-400">min</span>
                        </div>
                        <span className={`px-2 py-1 rounded text-xs font-medium ${bracket.color.split(' ').slice(0, 2).join(' ')}`}>
                          {t.preview}
                        </span>
                        {canEdit && (
                        <button
                          onClick={() => {
                            const newBrackets = config.late_brackets.filter((_, i) => i !== idx);
                            updateField('late_brackets', newBrackets);
                          }}
                          className="text-red-400 hover:text-red-600 p-1.5 min-h-[36px] min-w-[36px] flex items-center justify-center rounded"
                          aria-label={`Delete bracket ${bracket.name}`}
                        >
                          Ã¢Å“â€¢
                        </button>
                        )}
                      </div>
                    ))}
                  </div>
                  
                  {canEdit && (
                  <Button
                    variant="outline"
                    onClick={() => {
                      const lastMax = config.late_brackets.length > 0 
                        ? config.late_brackets[config.late_brackets.length - 1].max + 1 
                        : 1;
                      updateField('late_brackets', [...config.late_brackets, {
                        id: String(Date.now()),
                        min: lastMax,
                        max: lastMax + 30,
                        name: isArabic ? 'Ã™ÂÃ˜Â¦Ã˜Â© Ã˜Â¬Ã˜Â¯Ã™Å Ã˜Â¯Ã˜Â©' : 'New Bracket',
                        color: 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300',
                      }]);
                    }}
                  >
                    {t.addBracket}
                  </Button>
                  )}
                </div>
              )}
              
              {/* BONUSES SECTION */}
              {activeSection === 'bonuses' && (
                <div className="space-y-6">
                  <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">{t.bonusesTitle}</h3>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    {t.bonusesSubtitle}
                  </p>
                  
                  <LabeledSlider
                    label={t.perfectBonus}
                    value={config.perfect_attendance_bonus}
                    min={0} max={20} step={1}
                    unit="pts"
                    color="green"
                    description={t.perfectBonusDesc}
                    onChange={(v) => updateField('perfect_attendance_bonus', v)}
                    disabled={!canEdit}
                  />
                  
                  <LabeledSlider
                    label={t.streakBonus}
                    value={config.streak_bonus_per_week}
                    min={0} max={5} step={0.5}
                    unit="pts"
                    color="blue"
                    description={t.streakBonusDesc}
                    onChange={(v) => updateField('streak_bonus_per_week', v)}
                    disabled={!canEdit}
                  />
                  
                  <LabeledSlider
                    label={t.absenceMultiplier}
                    value={config.absence_penalty_multiplier}
                    min={0.5} max={3} step={0.1}
                    color="red"
                    description={t.absenceMultiplierDesc}
                    onChange={(v) => updateField('absence_penalty_multiplier', v)}
                    disabled={!canEdit}
                  />
                </div>
              )}
            </CardContent>
          </Card>
        </div>
        
        {/* Right: Live Simulation */}
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <span>Ã°Å¸Â§Âª</span> {t.liveSimulation}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <SimulationPanel config={config} />
            </CardContent>
          </Card>
          
          {/* Quick info card */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <span>Ã°Å¸â€œâ€“</span> {t.howItWorks}
              </CardTitle>
            </CardHeader>
            <CardContent className="text-xs text-gray-500 dark:text-gray-400 space-y-2">
              <p><strong className="text-gray-700 dark:text-gray-300">{t.qualityLabel}:</strong> {t.howQuality}</p>
              <p><strong className="text-gray-700 dark:text-gray-300">{t.attendanceLabel}:</strong> {t.howAttendance}</p>
              <p><strong className="text-gray-700 dark:text-gray-300">{t.punctualityLabel}:</strong> {t.howPunctuality}</p>
              <p><strong className="text-gray-700 dark:text-gray-300">{t.coverageTitle}:</strong> {t.howCoverage}</p>
              <p><strong className="text-gray-700 dark:text-gray-300">{t.bonusesTitle}:</strong> {t.howBonuses}</p>
              <p className="pt-2 border-t border-gray-200 dark:border-gray-700 font-medium text-gray-600 dark:text-gray-300">
                {t.howFormula}
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
      
      {/* Reset confirmation */}
      <ConfirmDialog
        isOpen={showResetConfirm}
        onCancel={() => setShowResetConfirm(false)}
        onConfirm={handleReset}
        title={t.resetTitle}
        message={t.resetMessage}
        confirmText={t.resetConfirm}
        type="danger"
      />
    </div>
  );
}
