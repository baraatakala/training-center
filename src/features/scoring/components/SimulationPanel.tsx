import { useState, useEffect, useMemo } from 'react';
import {
  type ScoringConfig,
  calcLateScore,
  calcWeightedScore,
} from '@/features/scoring/services/scoringConfigService';

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

export function SimulationPanel({ config }: { config: Omit<ScoringConfig, 'id' | 'teacher_id' | 'created_at' | 'updated_at'> }) {
  const saved = loadSimValues();
  const [simPresent, setSimPresent] = useState(saved.present);
  const [simLate, setSimLate] = useState(saved.late);
  const [simAbsent, setSimAbsent] = useState(saved.absent);
  const [simNotHeld, setSimNotHeld] = useState(saved.notHeld);
  const [simAvgLateMin, setSimAvgLateMin] = useState(saved.avgLateMin);
  const [simTotalClassSessions, setSimTotalClassSessions] = useState(saved.totalClassSessions);
  
  const simEffectiveSessions = simPresent + simLate + simAbsent;
  
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
    
    const lateCredit = calcLateScore(simAvgLateMin, config);
    const qualityScore = simPresent + (simLate * lateCredit);
    const qualityRate = effective > 0 ? (qualityScore / effective) * 100 : 0;
    
    const totalForCoverage = simTotalClassSessions - simNotHeld;
    const { rawScore, coverageFactor, finalScore } = calcWeightedScore(
      qualityRate, attendanceRate, punctualityPct, effective, totalForCoverage, config
    );
    
    let adjustedScore = finalScore;
    let bonusTotal = 0;
    let penaltyTotal = 0;
    
    if (attendanceRate >= 100 && config.perfect_attendance_bonus > 0) {
      bonusTotal += config.perfect_attendance_bonus;
    }
    
    if (config.absence_penalty_multiplier > 1.0 && simAbsent > 0) {
      const baseDeduction = effective > 0 ? (simAbsent / effective) * 100 : 0;
      penaltyTotal += baseDeduction * (config.absence_penalty_multiplier - 1);
    }
    
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
      
      <div className="flex flex-wrap gap-2 text-[10px]">
        <span className="px-2 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 font-medium">
          Effective: {simEffectiveSessions}
        </span>
        <span className="px-2 py-0.5 rounded-full bg-purple-50 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400 font-medium">
          Coverage: {simEffectiveSessions}/{results.totalForCoverage}
        </span>
      </div>
      
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
        
        <div className="mt-3 p-2 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-600">
          <p className="text-xs text-gray-500 dark:text-gray-400 font-mono text-center">
            ({config.weight_quality}%×{results.qualityRate} + {config.weight_attendance}%×{results.attendanceRate} + {config.weight_punctuality}%×{results.punctualityPct}) × {results.coverageFactor}
            {results.bonusTotal > 0 && <span className="text-green-600 dark:text-green-400"> +{results.bonusTotal}</span>}
            {results.penaltyTotal > 0 && <span className="text-red-600 dark:text-red-400"> −{results.penaltyTotal}</span>}
            {' '}= <span className={`font-bold ${scoreColor}`}>{results.finalScore}</span>
          </p>
        </div>
      </div>
    </div>
  );
}
