
export function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="text-xs text-gray-500 dark:text-gray-400">{label}</span>
      <p className="text-sm text-gray-900 dark:text-white font-medium">{value}</p>
    </div>
  );
}
