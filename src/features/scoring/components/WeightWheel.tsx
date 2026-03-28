export function WeightWheel({ quality, attendance, punctuality }: { quality: number; attendance: number; punctuality: number }) {
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
