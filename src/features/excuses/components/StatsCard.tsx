import { Card, CardContent } from '@/shared/components/ui/Card';

export function StatsCard({
  label,
  value,
  color,
  icon,
  highlight,
  className = '',
}: {
  label: string;
  value: string | number;
  color: string;
  icon: string;
  highlight?: boolean;
  className?: string;
}) {
  return (
    <Card className={`${highlight ? 'ring-2 ring-amber-400 dark:ring-amber-600' : ''} ${className}`}>
      <CardContent className="p-3 flex items-center gap-3">
        <span className="text-2xl">{icon}</span>
        <div>
          <p className={`text-xl font-bold ${color}`}>{value}</p>
          <p className="text-xs text-gray-500 dark:text-gray-400">{label}</p>
        </div>
      </CardContent>
    </Card>
  );
}
