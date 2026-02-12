/**
 * Scoring Configuration Service
 * 
 * Manages weighted score configuration stored in Supabase.
 * Only teachers (RLS-enforced) can read/write scoring configs.
 * Configs are per-teacher, allowing each teacher to have their own scoring rules.
 */

import { supabase } from '../lib/supabase';

// =====================================================
// TYPES
// =====================================================

export interface LateBracket {
  id: string;
  min: number;
  max: number;
  name: string;
  color: string;
}

export interface ScoringConfig {
  id?: string;
  teacher_id: string;
  config_name: string;
  is_default: boolean;
  
  // Component weights (must sum to 100)
  weight_quality: number;      // Quality-adjusted rate weight (default 55%)
  weight_attendance: number;   // Simple attendance rate weight (default 35%)
  weight_punctuality: number;  // Punctuality bonus weight (default 10%)
  
  // Late decay parameters  
  late_decay_constant: number;     // τ in e^(-t/τ), default 43.3 (~50% at 30 min)
  late_minimum_credit: number;     // Minimum credit for showing up late (default 0.05 = 5%)
  late_null_estimate: number;      // Credit when late_minutes is null (default 0.60)
  
  // Coverage factor
  coverage_enabled: boolean;          // Whether to apply coverage factor
  coverage_method: 'sqrt' | 'linear' | 'log' | 'none';  // How to compute coverage
  coverage_minimum: number;           // Minimum coverage factor (default 0.1)
  
  // Display brackets (for UI categorization only)
  late_brackets: LateBracket[];
  
  // Bonus/penalty modifiers
  perfect_attendance_bonus: number;   // Bonus points for 100% attendance (default 0)
  streak_bonus_per_week: number;      // Bonus per consecutive week of perfect attendance (default 0)
  absence_penalty_multiplier: number; // Multiplier for unexcused absences (default 1.0)
  
  // Metadata
  created_at?: string;
  updated_at?: string;
}

// Default configuration matching current hardcoded values
export const DEFAULT_SCORING_CONFIG: Omit<ScoringConfig, 'id' | 'teacher_id' | 'created_at' | 'updated_at'> = {
  config_name: 'Default Scoring',
  is_default: true,
  
  weight_quality: 55,
  weight_attendance: 35,
  weight_punctuality: 10,
  
  late_decay_constant: 43.3,
  late_minimum_credit: 0.05,
  late_null_estimate: 0.60,
  
  coverage_enabled: true,
  coverage_method: 'sqrt',
  coverage_minimum: 0.1,
  
  late_brackets: [
    { id: '1', min: 1, max: 5, name: 'Minor', color: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300' },
    { id: '2', min: 6, max: 15, name: 'Moderate', color: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300' },
    { id: '3', min: 16, max: 30, name: 'Significant', color: 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300' },
    { id: '4', min: 31, max: 60, name: 'Severe', color: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300' },
    { id: '5', min: 61, max: 999, name: 'Very Late', color: 'bg-red-200 text-red-900 dark:bg-red-900/50 dark:text-red-200' },
  ],
  
  perfect_attendance_bonus: 0,
  streak_bonus_per_week: 0,
  absence_penalty_multiplier: 1.0,
};

// =====================================================
// VALUE NORMALIZATION — Supabase PostgREST returns NUMERIC(5,2)
// columns as STRINGS like "55.00". This breaks typeof checks and
// arithmetic unless we coerce them back to real JS numbers.
// =====================================================

/**
 * Ensure all numeric fields in a scoring config are real JS numbers.
 * Supabase/PostgREST returns NUMERIC columns as strings to preserve precision.
 * Without this, loadConfigSync's typeof check fails and returns DEFAULT_SCORING_CONFIG.
 */
export function normalizeScoringConfig(
  raw: Record<string, unknown>
): Omit<ScoringConfig, 'id' | 'teacher_id' | 'created_at' | 'updated_at'> {
  const n = (v: unknown, fallback: number): number => {
    if (typeof v === 'number' && !isNaN(v)) return v;
    if (typeof v === 'string') { const p = parseFloat(v); if (!isNaN(p)) return p; }
    return fallback;
  };
  const b = (v: unknown, fallback: boolean): boolean => {
    if (typeof v === 'boolean') return v;
    if (v === 'true') return true;
    if (v === 'false') return false;
    return fallback;
  };
  const d = DEFAULT_SCORING_CONFIG;

  let brackets = d.late_brackets;
  if (Array.isArray(raw.late_brackets)) {
    brackets = raw.late_brackets;
  } else if (typeof raw.late_brackets === 'string') {
    try { brackets = JSON.parse(raw.late_brackets); } catch { /* keep default */ }
  }

  return {
    config_name: typeof raw.config_name === 'string' ? raw.config_name : d.config_name,
    is_default: b(raw.is_default, d.is_default),
    weight_quality: n(raw.weight_quality, d.weight_quality),
    weight_attendance: n(raw.weight_attendance, d.weight_attendance),
    weight_punctuality: n(raw.weight_punctuality, d.weight_punctuality),
    late_decay_constant: n(raw.late_decay_constant, d.late_decay_constant),
    late_minimum_credit: n(raw.late_minimum_credit, d.late_minimum_credit),
    late_null_estimate: n(raw.late_null_estimate, d.late_null_estimate),
    coverage_enabled: b(raw.coverage_enabled, d.coverage_enabled),
    coverage_method: (['sqrt','linear','log','none'].includes(raw.coverage_method as string)
      ? raw.coverage_method as ScoringConfig['coverage_method']
      : d.coverage_method),
    coverage_minimum: n(raw.coverage_minimum, d.coverage_minimum),
    late_brackets: brackets,
    perfect_attendance_bonus: n(raw.perfect_attendance_bonus, d.perfect_attendance_bonus),
    streak_bonus_per_week: n(raw.streak_bonus_per_week, d.streak_bonus_per_week),
    absence_penalty_multiplier: n(raw.absence_penalty_multiplier, d.absence_penalty_multiplier),
  };
}

// =====================================================
// SCORING ENGINE - Pure computation functions
// =====================================================

/**
 * Calculate late score using configurable exponential decay
 */
export function calcLateScore(lateMinutes: number | null | undefined, config: Omit<ScoringConfig, 'id' | 'teacher_id' | 'created_at' | 'updated_at'>): number {
  if (lateMinutes === null || lateMinutes === undefined) {
    return config.late_null_estimate;
  }
  if (lateMinutes <= 0) return 1.0;
  
  const score = Math.exp(-lateMinutes / config.late_decay_constant);
  return Math.max(config.late_minimum_credit, score);
}

/**
 * Calculate coverage factor using the configured method
 */
export function calcCoverageFactor(
  effectiveDays: number, 
  totalSessionDays: number, 
  config: Omit<ScoringConfig, 'id' | 'teacher_id' | 'created_at' | 'updated_at'>
): number {
  if (!config.coverage_enabled || totalSessionDays === 0) return 1;
  
  const ratio = effectiveDays / totalSessionDays;
  let factor: number;
  
  switch (config.coverage_method) {
    case 'sqrt':
      factor = Math.sqrt(ratio);
      break;
    case 'linear':
      factor = ratio;
      break;
    case 'log':
      factor = Math.log(1 + ratio * (Math.E - 1)); // log scaled to [0,1]
      break;
    case 'none':
      return 1;
    default:
      factor = Math.sqrt(ratio);
  }
  
  return Math.max(config.coverage_minimum, Math.min(factor, 1));
}

/**
 * Calculate weighted score using configurable weights
 */
export function calcWeightedScore(
  qualityAdjustedRate: number,
  attendanceRate: number,
  punctualityPercentage: number,
  effectiveDays: number,
  totalSessionDays: number,
  config: Omit<ScoringConfig, 'id' | 'teacher_id' | 'created_at' | 'updated_at'>
): { rawScore: number; coverageFactor: number; finalScore: number } {
  const w1 = config.weight_quality / 100;
  const w2 = config.weight_attendance / 100;
  const w3 = config.weight_punctuality / 100;
  
  const rawScore = (w1 * qualityAdjustedRate) + (w2 * attendanceRate) + (w3 * punctualityPercentage);
  const coverageFactor = calcCoverageFactor(effectiveDays, totalSessionDays, config);
  const finalScore = rawScore * coverageFactor;
  
  return { rawScore, coverageFactor, finalScore };
}

/**
 * Generate a preview curve for the late decay function
 * Returns array of { minutes, credit } points for visualization
 */
export function generateDecayCurve(
  config: Omit<ScoringConfig, 'id' | 'teacher_id' | 'created_at' | 'updated_at'>,
  maxMinutes = 120,
  points = 50
): { minutes: number; credit: number }[] {
  const curve: { minutes: number; credit: number }[] = [];
  for (let i = 0; i <= points; i++) {
    const minutes = (i / points) * maxMinutes;
    const credit = calcLateScore(minutes, config) * 100;
    curve.push({ minutes: Math.round(minutes), credit: Math.round(credit * 10) / 10 });
  }
  return curve;
}

/**
 * Generate coverage factor curve for visualization
 */
export function generateCoverageCurve(
  config: Omit<ScoringConfig, 'id' | 'teacher_id' | 'created_at' | 'updated_at'>,
  totalSessions = 30,
  points = 30
): { days: number; factor: number }[] {
  const curve: { days: number; factor: number }[] = [];
  for (let i = 0; i <= points; i++) {
    const days = Math.round((i / points) * totalSessions);
    const factor = calcCoverageFactor(days, totalSessions, config) * 100;
    curve.push({ days, factor: Math.round(factor * 10) / 10 });
  }
  return curve;
}

// =====================================================
// SUPABASE CRUD (with RLS)
// =====================================================

/**
 * Get scoring config for the current teacher.
 * Tries Supabase first (source of truth), then localStorage cache, then defaults.
 */
export async function getScoringConfig(): Promise<{ data: ScoringConfig | null; error: Error | null }> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { data: null, error: new Error('Not authenticated') };
    
    // Try Supabase first (source of truth)
    try {
      const { data, error } = await supabase
        .from('scoring_config')
        .select('*')
        .eq('teacher_id', user.id)
        .eq('is_default', true)
        .maybeSingle();
      
      if (!error && data) {
        // Parse late_brackets from JSON if stored as string
        if (typeof data.late_brackets === 'string') {
          data.late_brackets = JSON.parse(data.late_brackets);
        }
        // Normalize numeric fields (PostgREST returns NUMERIC as strings)
        const normalized = normalizeScoringConfig(data as Record<string, unknown>);
        // Cache the NORMALIZED version to BOTH localStorage keys for sync access
        const normalizedJson = JSON.stringify(normalized);
        localStorage.setItem(`scoring_config_${user.id}`, normalizedJson);
        localStorage.setItem('scoring_config_current', normalizedJson);
        return { data: { ...data, ...normalized }, error: null };
      }
      
      if (error) {
        console.warn('Scoring config DB load warning:', error.code, error.message);
        // 42P01 = table doesn't exist, PGRST116 = no rows (old postgrest)
        // For these, fall through to localStorage/defaults
        if (error.code !== '42P01' && error.code !== 'PGRST116') {
          // Unexpected error — still try localStorage below
          console.error('Unexpected scoring config error:', error);
        }
      }
      // No error but no data => no row in DB yet, that's OK
    } catch (dbErr) {
      console.warn('Scoring config DB access failed:', dbErr);
      // Fall through to localStorage
    }
    
    // Try localStorage as fallback — also normalize in case it has string numbers
    const cached = localStorage.getItem(`scoring_config_${user.id}`);
    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        const normalized = normalizeScoringConfig(parsed);
        return { data: { ...parsed, ...normalized } as ScoringConfig, error: null };
      } catch {
        // Corrupt cache
      }
    }
    
    // No config anywhere — return null (caller uses DEFAULT_SCORING_CONFIG)
    return { data: null, error: null };
  } catch (err) {
    console.warn('Scoring config load error:', err);
    return { data: null, error: null };
  }
}

/**
 * Save scoring config to Supabase + localStorage.
 * Reports actual errors instead of silently falling back.
 */
export async function saveScoringConfig(config: Partial<ScoringConfig>): Promise<{ data: ScoringConfig | null; error: Error | null }> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { data: null, error: new Error('Not authenticated') };
    
    // Merge with defaults
    const merged = { ...DEFAULT_SCORING_CONFIG, ...config };
    
    // IMPORTANT: Whitelist only the columns that exist in the scoring_config table.
    // This prevents stale/extra fields from localStorage or frontend state from
    // being sent to Supabase, which would cause PGRST204 "column not found" errors.
    const dbPayload = {
      teacher_id: user.id,
      config_name: merged.config_name,
      is_default: true as const,
      weight_quality: merged.weight_quality,
      weight_attendance: merged.weight_attendance,
      weight_punctuality: merged.weight_punctuality,
      late_decay_constant: merged.late_decay_constant,
      late_minimum_credit: merged.late_minimum_credit,
      late_null_estimate: merged.late_null_estimate,
      coverage_enabled: merged.coverage_enabled,
      coverage_method: merged.coverage_method,
      coverage_minimum: merged.coverage_minimum,
      late_brackets: merged.late_brackets ?? DEFAULT_SCORING_CONFIG.late_brackets,
      perfect_attendance_bonus: merged.perfect_attendance_bonus,
      streak_bonus_per_week: merged.streak_bonus_per_week,
      absence_penalty_multiplier: merged.absence_penalty_multiplier,
    };
    
    // Save to localStorage immediately (for loadConfigSync)
    // Write to BOTH the user-specific key AND the canonical "current" key.
    // loadConfigSync checks "scoring_config_current" first for fast synchronous access.
    const normalizedPayload = normalizeScoringConfig(dbPayload as Record<string, unknown>);
    const payloadJson = JSON.stringify(normalizedPayload);
    localStorage.setItem(`scoring_config_${user.id}`, payloadJson);
    localStorage.setItem('scoring_config_current', payloadJson);
    
    // Dispatch custom event so any open AttendanceRecords page can react immediately
    window.dispatchEvent(new Event('scoring-config-changed'));
    
    // Try Supabase upsert
    let dbError: Error | null = null;
    try {
      // First try: upsert with conflict on the unique constraint
      const { data: upsertData, error } = await supabase
        .from('scoring_config')
        .upsert(dbPayload, { onConflict: 'teacher_id,is_default' })
        .select()
        .single();
      
      if (error) {
        console.error('Scoring config save error:', error.code, error.message, error.details);
        
        // If upsert failed, try insert (for first-time saves)
        if (error.code === '23505') {
          // Duplicate key — try update instead
          const { data: updateData, error: updateError } = await supabase
            .from('scoring_config')
            .update(dbPayload)
            .eq('teacher_id', user.id)
            .eq('is_default', true)
            .select()
            .single();
          
          if (updateError) {
            dbError = new Error(`DB update failed: ${updateError.message}`);
          } else if (updateData) {
            const normalizedUpdate = normalizeScoringConfig(updateData as Record<string, unknown>);
            const updateJson = JSON.stringify(normalizedUpdate);
            localStorage.setItem(`scoring_config_${user.id}`, updateJson);
            localStorage.setItem('scoring_config_current', updateJson);
            return { data: { ...updateData, ...normalizedUpdate } as ScoringConfig, error: null };
          }
        } else if (error.code === '42P01') {
          // Table doesn't exist — saved to localStorage only
          dbError = new Error('Scoring config table does not exist in database. Run the SQL migration. Config is saved locally only.');
        } else {
          dbError = new Error(`DB save failed: ${error.message}`);
        }
      } else if (upsertData) {
        // Success — normalize DB response (PostgREST returns NUMERIC as strings)
        // then update localStorage with properly typed values
        const normalizedUpsert = normalizeScoringConfig(upsertData as Record<string, unknown>);
        const upsertJson = JSON.stringify(normalizedUpsert);
        localStorage.setItem(`scoring_config_${user.id}`, upsertJson);
        localStorage.setItem('scoring_config_current', upsertJson);
        return { data: { ...upsertData, ...normalizedUpsert } as ScoringConfig, error: null };
      }
    } catch (err) {
      console.error('Scoring config save exception:', err);
      dbError = new Error(`DB save exception: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
    
    // If DB failed but localStorage succeeded, return partial success
    if (dbError) {
      console.warn('Scoring config saved to localStorage only:', dbError.message);
      return { data: dbPayload as ScoringConfig, error: dbError };
    }
    
    return { data: dbPayload as ScoringConfig, error: null };
  } catch (err) {
    return { data: null, error: err instanceof Error ? err : new Error('Save failed') };
  }
}

/**
 * Load config from localStorage (synchronous, for use in calculations).
 * Searches for the scoring config key by checking all localStorage keys.
 */
export function loadConfigSync(): Omit<ScoringConfig, 'id' | 'teacher_id' | 'created_at' | 'updated_at'> {
  try {
    // Priority 1: Check the canonical "scoring_config_current" key.
    // This is always written by saveScoringConfig and is the most reliable source.
    const currentRaw = localStorage.getItem('scoring_config_current');
    if (currentRaw) {
      try {
        const val = JSON.parse(currentRaw);
        if (val && (typeof val.weight_quality === 'number' || typeof val.weight_quality === 'string')) {
          const normalized = normalizeScoringConfig(val);
          console.log('[ScoringConfig] loadConfigSync → scoring_config_current:', normalized.weight_quality, '/', normalized.weight_attendance, '/', normalized.weight_punctuality);
          return normalized;
        }
      } catch { /* corrupt — continue */ }
    }

    // Priority 2: Find the user-specific key via Supabase auth
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && (key.includes('supabase') || key.includes('sb-'))) {
        try {
          const val = JSON.parse(localStorage.getItem(key) || '');
          const userId = val?.user?.id || val?.currentSession?.user?.id;
          if (userId) {
            const cached = localStorage.getItem(`scoring_config_${userId}`);
            if (cached) {
              const parsed = JSON.parse(cached);
              if (parsed && (typeof parsed.weight_quality === 'number' || typeof parsed.weight_quality === 'string')) {
                const normalized = normalizeScoringConfig(parsed);
                // Promote to canonical key for faster future reads
                localStorage.setItem('scoring_config_current', JSON.stringify(normalized));
                console.log('[ScoringConfig] loadConfigSync → scoring_config_' + userId.slice(0,8) + ':', normalized.weight_quality, '/', normalized.weight_attendance, '/', normalized.weight_punctuality);
                return normalized;
              }
            }
          }
        } catch { /* skip */ }
      }
    }

    // Priority 3: Any scoring_config_* key (last resort)
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('scoring_config_') && key !== 'scoring_config_current') {
        try {
          const val = JSON.parse(localStorage.getItem(key) || '');
          if (val && (typeof val.weight_quality === 'number' || (typeof val.weight_quality === 'string' && !isNaN(parseFloat(val.weight_quality))))) {
            const normalized = normalizeScoringConfig(val);
            localStorage.setItem('scoring_config_current', JSON.stringify(normalized));
            console.log('[ScoringConfig] loadConfigSync → fallback key', key, ':', normalized.weight_quality, '/', normalized.weight_attendance, '/', normalized.weight_punctuality);
            return normalized;
          }
        } catch { /* skip corrupt entries */ }
      }
    }
  } catch { /* skip */ }
  
  return DEFAULT_SCORING_CONFIG;
}

/**
 * Reset config to defaults
 */
export async function resetScoringConfig(): Promise<{ error: Error | null }> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { error: new Error('Not authenticated') };
    
    localStorage.removeItem(`scoring_config_${user.id}`);
    
    try {
      await supabase
        .from('scoring_config')
        .delete()
        .eq('teacher_id', user.id);
    } catch { /* table may not exist */ }
    
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err : new Error('Reset failed') };
  }
}
