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
  calcCoverageFactor,
  generateDecayCurve,
  generateCoverageCurve,
} from '@/features/scoring/services/scoringConfigService';
import { MiniChart } from '@/features/scoring/components/MiniChart';
import { WeightWheel } from '@/features/scoring/components/WeightWheel';
import { LabeledSlider } from '@/features/scoring/components/LabeledSlider';
import { SimulationPanel } from '@/features/scoring/components/SimulationPanel';
import { translations } from '@/features/scoring/constants/translations';
import { PRESETS } from '@/features/scoring/constants/presets';

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
