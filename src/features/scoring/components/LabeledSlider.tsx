interface LabeledSliderProps {
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
}

export function LabeledSlider({
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
}: LabeledSliderProps) {
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
