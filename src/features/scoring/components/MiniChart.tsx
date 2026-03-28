interface ReferenceLineConfig {
  value: number;
  label?: string;
  color?: string;
}

interface MiniChartProps {
  data: Record<string, number>[];
  xKey: string;
  yKey: string;
  color?: string;
  width?: number;
  height?: number;
  xLabel?: string;
  yLabel?: string;
  referenceLines?: ReferenceLineConfig[];
}

export function MiniChart({ data, xKey, yKey, color = '#6366f1', width = 300, height = 140, xLabel, yLabel, referenceLines = [] }: MiniChartProps) {
  if (!data || data.length === 0) return null;
  
  const padding = { top: 10, right: 10, bottom: 24, left: 30 };
  const chartW = width - padding.left - padding.right;
  const chartH = height - padding.top - padding.bottom;
  
  const xValues = data.map(d => d[xKey]);
  const yValues = data.map(d => d[yKey]);
  const xMin = Math.min(...xValues);
  const xMax = Math.max(...xValues);
  const yMin = Math.min(...yValues, 0);
  const yMax = Math.max(...yValues, 100);
  
  const scaleX = (v: number) => padding.left + ((v - xMin) / (xMax - xMin || 1)) * chartW;
  const scaleY = (v: number) => padding.top + chartH - ((v - yMin) / (yMax - yMin || 1)) * chartH;
  
  const pathD = data.map((d, i) => {
    const x = scaleX(d[xKey]);
    const y = scaleY(d[yKey]);
    return `${i === 0 ? 'M' : 'L'} ${x} ${y}`;
  }).join(' ');
  
  const areaD = pathD + ` L ${scaleX(data[data.length - 1][xKey])} ${scaleY(yMin)} L ${scaleX(data[0][xKey])} ${scaleY(yMin)} Z`;
  
  return (
    <svg width={width} height={height} className="overflow-visible">
      {/* Grid lines */}
      {[0, 25, 50, 75, 100].filter(v => v >= yMin && v <= yMax).map(v => (
        <g key={v}>
          <line x1={padding.left} y1={scaleY(v)} x2={padding.left + chartW} y2={scaleY(v)}
            stroke="currentColor" className="text-gray-200 dark:text-gray-700" strokeDasharray="3,3" />
          <text x={padding.left - 4} y={scaleY(v) + 3} textAnchor="end"
            className="fill-current text-gray-400 dark:text-gray-500" fontSize={9}>{v}</text>
        </g>
      ))}
      
      {/* Reference lines */}
      {referenceLines.map((ref, i) => (
        <g key={i}>
          <line x1={padding.left} y1={scaleY(ref.value)} x2={padding.left + chartW} y2={scaleY(ref.value)}
            stroke={ref.color || '#ef4444'} strokeDasharray="4,2" strokeWidth={1.5} />
          {ref.label && (
            <text x={padding.left + chartW - 2} y={scaleY(ref.value) - 3} textAnchor="end"
              fill={ref.color || '#ef4444'} fontSize={8} fontWeight="bold">{ref.label}</text>
          )}
        </g>
      ))}
      
      {/* Area fill */}
      <path d={areaD} fill={color} fillOpacity={0.1} />
      
      {/* Line */}
      <path d={pathD} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      
      {/* X axis labels */}
      {data.filter((_, i) => i % Math.max(1, Math.floor(data.length / 6)) === 0).map((d) => (
        <text key={d[xKey]} x={scaleX(d[xKey])} y={height - 4} textAnchor="middle"
          className="fill-current text-gray-400 dark:text-gray-500" fontSize={9}>{d[xKey]}</text>
      ))}
      
      {/* Axis labels */}
      {xLabel && (
        <text x={padding.left + chartW / 2} y={height - 1} textAnchor="middle"
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
