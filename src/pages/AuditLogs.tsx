import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Select } from '../components/ui/Select';
import { format, subDays, subMonths, isAfter, isBefore, parseISO } from 'date-fns';
import { getAuditLogs, type AuditLogEntry } from '../services/auditService';

// =====================================================
// HELPERS
// =====================================================

/** Turn a table + operation + data into a human-readable sentence */
const describeAction = (log: AuditLogEntry): string => {
  const data = log.old_data || log.new_data || {};
  const name =
    (data as Record<string, unknown>).name ||
    (data as Record<string, unknown>).course_name ||
    (data as Record<string, unknown>).student_name ||
    (data as Record<string, unknown>).teacher_name ||
    (data as Record<string, unknown>).title ||
    '';

  const entity = log.table_name.charAt(0).toUpperCase() + log.table_name.slice(1);

  switch (log.operation) {
    case 'DELETE':
      return name ? `${entity} "${name}" was deleted` : `A ${log.table_name} record was deleted`;
    case 'UPDATE':
      return name ? `${entity} "${name}" was updated` : `A ${log.table_name} record was updated`;
    case 'INSERT':
      return name ? `${entity} "${name}" was created` : `A new ${log.table_name} record was created`;
    default:
      return `${log.operation} on ${log.table_name}`;
  }
};

/** Return keys that differ between old and new data objects */
const getChangedFields = (
  oldData: Record<string, unknown> | undefined,
  newData: Record<string, unknown> | undefined
): { key: string; old: unknown; new: unknown }[] => {
  if (!oldData || !newData) return [];
  const allKeys = new Set([...Object.keys(oldData), ...Object.keys(newData)]);
  const changes: { key: string; old: unknown; new: unknown }[] = [];
  allKeys.forEach((key) => {
    const oldVal = JSON.stringify(oldData[key]);
    const newVal = JSON.stringify(newData[key]);
    if (oldVal !== newVal) {
      changes.push({ key, old: oldData[key], new: newData[key] });
    }
  });
  return changes;
};

const formatValue = (val: unknown): string => {
  if (val === null || val === undefined) return '(empty)';
  if (typeof val === 'object') return JSON.stringify(val);
  return String(val);
};

const TABLE_ICONS: Record<string, string> = {
  student: '🎓',
  teacher: '👨‍🏫',
  course: '📚',
  session: '📅',
  enrollment: '📋',
  attendance: '✅',
};

const OP_ICONS: Record<string, string> = {
  DELETE: '🗑️',
  UPDATE: '✏️',
  INSERT: '➕',
};

// =====================================================
// COMPONENT
// =====================================================

export function AuditLogs() {
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedLog, setExpandedLog] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'timeline' | 'table'>('timeline');

  // Filters
  const [filterTable, setFilterTable] = useState('');
  const [filterOp, setFilterOp] = useState('');
  const [filterDateRange, setFilterDateRange] = useState('30d');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  // Pagination
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 50;

  const loadLogs = useCallback(async () => {
    try {
      setLoading(true);
      const data = await getAuditLogs({
        tableName: filterTable || undefined,
        operation: filterOp || undefined,
        limit: 500,
      });
      setLogs(data);
    } catch (error) {
      console.error('Error loading audit logs:', error);
    } finally {
      setLoading(false);
    }
  }, [filterTable, filterOp]);

  useEffect(() => {
    loadLogs();
  }, [loadLogs]);

  // Client-side date range and search filter
  const filteredLogs = useMemo(() => {
    let result = [...logs];

    // Date range filter
    const now = new Date();
    let rangeStart: Date | null = null;
    let rangeEnd: Date | null = null;

    switch (filterDateRange) {
      case '7d':
        rangeStart = subDays(now, 7);
        break;
      case '30d':
        rangeStart = subDays(now, 30);
        break;
      case '90d':
        rangeStart = subDays(now, 90);
        break;
      case '6m':
        rangeStart = subMonths(now, 6);
        break;
      case 'custom':
        if (customStart) rangeStart = parseISO(customStart);
        if (customEnd) rangeEnd = parseISO(customEnd);
        break;
      // 'all' = no filter
    }

    if (rangeStart) {
      result = result.filter((l) => l.deleted_at && isAfter(new Date(l.deleted_at), rangeStart!));
    }
    if (rangeEnd) {
      result = result.filter((l) => l.deleted_at && isBefore(new Date(l.deleted_at), rangeEnd!));
    }

    // Search across record data
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter((l) => {
        const desc = describeAction(l).toLowerCase();
        const dataStr = JSON.stringify(l.old_data || l.new_data || {}).toLowerCase();
        const user = (l.deleted_by || '').toLowerCase();
        return desc.includes(q) || dataStr.includes(q) || user.includes(q) || l.table_name.includes(q);
      });
    }

    return result;
  }, [logs, filterDateRange, customStart, customEnd, searchQuery]);

  // Pagination
  const totalPages = Math.ceil(filteredLogs.length / PAGE_SIZE);
  const pagedLogs = filteredLogs.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // Stats
  const stats = useMemo(() => {
    const deletes = filteredLogs.filter((l) => l.operation === 'DELETE').length;
    const updates = filteredLogs.filter((l) => l.operation === 'UPDATE').length;
    const inserts = filteredLogs.filter((l) => l.operation === 'INSERT').length;

    // Group by day for mini chart
    const byDay = new Map<string, number>();
    filteredLogs.forEach((l) => {
      if (l.deleted_at) {
        const day = format(new Date(l.deleted_at), 'MM/dd');
        byDay.set(day, (byDay.get(day) || 0) + 1);
      }
    });
    const dailyActivity = Array.from(byDay.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-14); // Last 14 days

    // Most active table
    const tableCounts = new Map<string, number>();
    filteredLogs.forEach((l) => tableCounts.set(l.table_name, (tableCounts.get(l.table_name) || 0) + 1));
    const mostActiveTable = [...tableCounts.entries()].sort((a, b) => b[1] - a[1])[0];

    return { deletes, updates, inserts, dailyActivity, mostActiveTable };
  }, [filteredLogs]);

  const maxDailyCount = Math.max(1, ...stats.dailyActivity.map(([, c]) => c));

  // Group logs by date for timeline view
  const groupedByDate = useMemo(() => {
    const groups = new Map<string, AuditLogEntry[]>();
    pagedLogs.forEach((log) => {
      const day = log.deleted_at ? format(new Date(log.deleted_at), 'yyyy-MM-dd') : 'Unknown';
      if (!groups.has(day)) groups.set(day, []);
      groups.get(day)!.push(log);
    });
    return groups;
  }, [pagedLogs]);

  const getOpColor = (op: string) => {
    switch (op) {
      case 'DELETE':
        return 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 border-red-200 dark:border-red-800';
      case 'UPDATE':
        return 'bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-300 border-yellow-200 dark:border-yellow-800';
      case 'INSERT':
        return 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300 border-green-200 dark:border-green-800';
      default:
        return 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300';
    }
  };

  const getTimelineDotColor = (op: string) => {
    switch (op) {
      case 'DELETE': return 'bg-red-500';
      case 'UPDATE': return 'bg-yellow-500';
      case 'INSERT': return 'bg-green-500';
      default: return 'bg-gray-500';
    }
  };

  return (
    <div className="container mx-auto p-4 sm:p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold dark:text-white flex items-center gap-3">
            📋 Activity Log
          </h1>
          <p className="text-gray-600 dark:text-gray-400 mt-1">
            Track all changes made across your training center
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex bg-gray-100 dark:bg-gray-700 rounded-lg p-1">
            <button
              onClick={() => setViewMode('timeline')}
              className={`px-3 py-1.5 text-sm rounded-md transition-all ${
                viewMode === 'timeline'
                  ? 'bg-white dark:bg-gray-600 shadow-sm text-blue-600 dark:text-blue-400 font-medium'
                  : 'text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200'
              }`}
            >
              📜 Timeline
            </button>
            <button
              onClick={() => setViewMode('table')}
              className={`px-3 py-1.5 text-sm rounded-md transition-all ${
                viewMode === 'table'
                  ? 'bg-white dark:bg-gray-600 shadow-sm text-blue-600 dark:text-blue-400 font-medium'
                  : 'text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200'
              }`}
            >
              📊 Table
            </button>
          </div>
          <Button onClick={loadLogs} disabled={loading}>
            {loading ? '⟳ Loading...' : '🔄 Refresh'}
          </Button>
        </div>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-gradient-to-br from-red-50 to-rose-50 dark:from-red-900/30 dark:to-rose-900/30 p-4 rounded-xl border border-red-100 dark:border-red-800/50">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-lg">🗑️</span>
            <span className="text-sm text-red-700 dark:text-red-400 font-medium">Deletions</span>
          </div>
          <div className="text-2xl font-bold text-red-900 dark:text-red-100">{stats.deletes}</div>
        </div>
        <div className="bg-gradient-to-br from-yellow-50 to-amber-50 dark:from-yellow-900/30 dark:to-amber-900/30 p-4 rounded-xl border border-yellow-100 dark:border-yellow-800/50">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-lg">✏️</span>
            <span className="text-sm text-yellow-700 dark:text-yellow-400 font-medium">Updates</span>
          </div>
          <div className="text-2xl font-bold text-yellow-900 dark:text-yellow-100">{stats.updates}</div>
        </div>
        <div className="bg-gradient-to-br from-green-50 to-emerald-50 dark:from-green-900/30 dark:to-emerald-900/30 p-4 rounded-xl border border-green-100 dark:border-green-800/50">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-lg">➕</span>
            <span className="text-sm text-green-700 dark:text-green-400 font-medium">Inserts</span>
          </div>
          <div className="text-2xl font-bold text-green-900 dark:text-green-100">{stats.inserts}</div>
        </div>
        <div className="bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-900/30 dark:to-indigo-900/30 p-4 rounded-xl border border-blue-100 dark:border-blue-800/50">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-lg">{TABLE_ICONS[stats.mostActiveTable?.[0] || ''] || '📊'}</span>
            <span className="text-sm text-blue-700 dark:text-blue-400 font-medium">Most Active</span>
          </div>
          <div className="text-lg font-bold text-blue-900 dark:text-blue-100 truncate">
            {stats.mostActiveTable ? `${stats.mostActiveTable[0]} (${stats.mostActiveTable[1]})` : '—'}
          </div>
        </div>
      </div>

      {/* Activity Sparkline */}
      {stats.dailyActivity.length > 1 && (
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Daily Activity</span>
              <span className="text-xs text-gray-500 dark:text-gray-500">(last 14 days)</span>
            </div>
            <div className="flex items-end gap-1 h-16">
              {stats.dailyActivity.map(([day, count]) => (
                <div key={day} className="flex-1 flex flex-col items-center group relative">
                  <div
                    className="w-full bg-blue-400 dark:bg-blue-500 rounded-t transition-all group-hover:bg-blue-600 dark:group-hover:bg-blue-400"
                    style={{ height: `${Math.max(4, (count / maxDailyCount) * 60)}px` }}
                  />
                  <span className="text-[9px] text-gray-400 dark:text-gray-500 mt-1 hidden sm:block">{day}</span>
                  {/* Tooltip */}
                  <div className="absolute bottom-full mb-2 hidden group-hover:block z-10">
                    <div className="bg-gray-900 dark:bg-gray-700 text-white text-xs rounded px-2 py-1 whitespace-nowrap">
                      {day}: {count} events
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Filters */}
      <Card>
        <CardContent className="pt-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            {/* Search */}
            <div className="sm:col-span-2 lg:col-span-1">
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Search</label>
              <div className="relative">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => { setSearchQuery(e.target.value); setPage(1); }}
                  placeholder="Search names, emails..."
                  className="w-full pl-8 pr-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
                <svg className="absolute left-2.5 top-2.5 w-4 h-4 text-gray-400 dark:text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Table</label>
              <Select
                value={filterTable}
                onChange={(v) => { setFilterTable(v); setPage(1); }}
                options={[
                  { value: '', label: 'All Tables' },
                  { value: 'student', label: '🎓 Student' },
                  { value: 'teacher', label: '👨‍🏫 Teacher' },
                  { value: 'course', label: '📚 Course' },
                  { value: 'session', label: '📅 Session' },
                  { value: 'enrollment', label: '📋 Enrollment' },
                  { value: 'attendance', label: '✅ Attendance' },
                ]}
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Operation</label>
              <Select
                value={filterOp}
                onChange={(v) => { setFilterOp(v); setPage(1); }}
                options={[
                  { value: '', label: 'All Operations' },
                  { value: 'DELETE', label: '🗑️ Delete' },
                  { value: 'UPDATE', label: '✏️ Update' },
                  { value: 'INSERT', label: '➕ Insert' },
                ]}
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Date Range</label>
              <Select
                value={filterDateRange}
                onChange={(v) => { setFilterDateRange(v); setPage(1); }}
                options={[
                  { value: '7d', label: 'Last 7 Days' },
                  { value: '30d', label: 'Last 30 Days' },
                  { value: '90d', label: 'Last 90 Days' },
                  { value: '6m', label: 'Last 6 Months' },
                  { value: 'all', label: 'All Time' },
                  { value: 'custom', label: 'Custom Range' },
                ]}
              />
            </div>
          </div>

          {filterDateRange === 'custom' && (
            <div className="grid grid-cols-2 gap-4 mt-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">From</label>
                <input
                  type="date"
                  value={customStart}
                  onChange={(e) => setCustomStart(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">To</label>
                <input
                  type="date"
                  value={customEnd}
                  onChange={(e) => setCustomEnd(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 dark:text-white"
                />
              </div>
            </div>
          )}

          <div className="flex items-center justify-between mt-3 pt-3 border-t dark:border-gray-700">
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Showing <span className="font-semibold text-gray-700 dark:text-gray-300">{filteredLogs.length}</span> activities
              {filteredLogs.length !== logs.length && (
                <span> (filtered from {logs.length})</span>
              )}
            </p>
            {(filterTable || filterOp || searchQuery || filterDateRange !== '30d') && (
              <button
                onClick={() => { setFilterTable(''); setFilterOp(''); setSearchQuery(''); setFilterDateRange('30d'); setPage(1); }}
                className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
              >
                Clear all filters
              </button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Content */}
      {loading ? (
        <div className="text-center py-12">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 dark:border-blue-400 mx-auto"></div>
          <p className="text-gray-600 dark:text-gray-400 mt-4">Loading activity log...</p>
        </div>
      ) : filteredLogs.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <span className="text-5xl block mb-4">📭</span>
            <p className="text-gray-600 dark:text-gray-400 font-medium">No activities found</p>
            <p className="text-sm text-gray-500 dark:text-gray-500 mt-1">Try adjusting your filters or date range</p>
          </CardContent>
        </Card>
      ) : viewMode === 'timeline' ? (
        /* ==================== TIMELINE VIEW ==================== */
        <div className="space-y-6">
          {[...groupedByDate.entries()].map(([dateStr, dayLogs]) => (
            <div key={dateStr}>
              {/* Date header */}
              <div className="flex items-center gap-3 mb-3">
                <div className="bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 px-3 py-1 rounded-full text-sm font-medium">
                  {dateStr !== 'Unknown' ? format(new Date(dateStr), 'EEEE, MMMM d yyyy') : 'Unknown Date'}
                </div>
                <div className="flex-1 border-t border-gray-200 dark:border-gray-700" />
                <span className="text-xs text-gray-500 dark:text-gray-500">{dayLogs.length} events</span>
              </div>

              {/* Timeline entries */}
              <div className="relative ml-4 pl-6 border-l-2 border-gray-200 dark:border-gray-700 space-y-3">
                {dayLogs.map((log) => {
                  const isExpanded = expandedLog === log.audit_id;
                  const changes = log.operation === 'UPDATE' ? getChangedFields(log.old_data, log.new_data) : [];

                  return (
                    <div key={log.audit_id} className="relative">
                      {/* Timeline dot */}
                      <div className={`absolute -left-[31px] top-3 w-4 h-4 rounded-full border-2 border-white dark:border-gray-900 ${getTimelineDotColor(log.operation)}`} />

                      {/* Card */}
                      <div
                        className={`bg-white dark:bg-gray-800 rounded-xl border transition-all cursor-pointer hover:shadow-md ${
                          isExpanded
                            ? 'border-blue-300 dark:border-blue-600 shadow-md'
                            : 'border-gray-100 dark:border-gray-700'
                        }`}
                        onClick={() => setExpandedLog(isExpanded ? null : log.audit_id || null)}
                      >
                        <div className="p-4">
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex items-start gap-3 min-w-0">
                              <span className="text-xl flex-shrink-0 mt-0.5">
                                {TABLE_ICONS[log.table_name] || '📄'}
                              </span>
                              <div className="min-w-0">
                                <p className="text-sm font-medium text-gray-900 dark:text-white">
                                  {describeAction(log)}
                                </p>
                                <div className="flex flex-wrap items-center gap-2 mt-1">
                                  <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${getOpColor(log.operation)}`}>
                                    {OP_ICONS[log.operation]} {log.operation}
                                  </span>
                                  <span className="text-xs text-gray-500 dark:text-gray-500">
                                    by {log.deleted_by || 'system'}
                                  </span>
                                  {log.deleted_at && (
                                    <span className="text-xs text-gray-400 dark:text-gray-500">
                                      {format(new Date(log.deleted_at), 'HH:mm:ss')}
                                    </span>
                                  )}
                                </div>
                                {/* Quick change preview for updates */}
                                {log.operation === 'UPDATE' && changes.length > 0 && !isExpanded && (
                                  <p className="text-xs text-gray-500 dark:text-gray-500 mt-1 truncate">
                                    Changed: {changes.map(c => c.key).join(', ')}
                                  </p>
                                )}
                              </div>
                            </div>
                            <button className="text-gray-400 dark:text-gray-500 flex-shrink-0 mt-1">
                              <svg className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                              </svg>
                            </button>
                          </div>

                          {/* Expanded details */}
                          {isExpanded && (
                            <div className="mt-4 pt-4 border-t border-gray-100 dark:border-gray-700 space-y-3">
                              {log.reason && (
                                <div className="flex items-start gap-2 bg-blue-50 dark:bg-blue-900/20 p-3 rounded-lg">
                                  <span className="text-blue-500">💬</span>
                                  <p className="text-sm text-blue-700 dark:text-blue-300">{log.reason}</p>
                                </div>
                              )}

                              {/* UPDATE: show diff */}
                              {log.operation === 'UPDATE' && changes.length > 0 && (
                                <div>
                                  <p className="text-xs font-semibold text-gray-600 dark:text-gray-400 mb-2 uppercase tracking-wider">Changes</p>
                                  <div className="space-y-2">
                                    {changes.map(({ key, old: oldVal, new: newVal }) => (
                                      <div key={key} className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3">
                                        <p className="text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">{key}</p>
                                        <div className="flex flex-col sm:flex-row gap-2">
                                          <div className="flex-1 text-xs bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 px-2 py-1 rounded border border-red-200 dark:border-red-800/50">
                                            <span className="font-medium mr-1">−</span>{formatValue(oldVal)}
                                          </div>
                                          <span className="hidden sm:block text-gray-400 self-center">→</span>
                                          <div className="flex-1 text-xs bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300 px-2 py-1 rounded border border-green-200 dark:border-green-800/50">
                                            <span className="font-medium mr-1">+</span>{formatValue(newVal)}
                                          </div>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {/* DELETE: show deleted data as key-value */}
                              {log.operation === 'DELETE' && log.old_data && (
                                <div>
                                  <p className="text-xs font-semibold text-gray-600 dark:text-gray-400 mb-2 uppercase tracking-wider">Deleted Record</p>
                                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                    {Object.entries(log.old_data).map(([key, value]) => (
                                      <div key={key} className="bg-red-50 dark:bg-red-900/10 rounded-lg px-3 py-2 border border-red-100 dark:border-red-900/30">
                                        <p className="text-[10px] uppercase text-gray-500 dark:text-gray-500 tracking-wider">{key}</p>
                                        <p className="text-xs text-gray-800 dark:text-gray-300 break-all">{formatValue(value)}</p>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {/* INSERT: show created data */}
                              {log.operation === 'INSERT' && log.new_data && (
                                <div>
                                  <p className="text-xs font-semibold text-gray-600 dark:text-gray-400 mb-2 uppercase tracking-wider">Created Record</p>
                                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                    {Object.entries(log.new_data).map(([key, value]) => (
                                      <div key={key} className="bg-green-50 dark:bg-green-900/10 rounded-lg px-3 py-2 border border-green-100 dark:border-green-900/30">
                                        <p className="text-[10px] uppercase text-gray-500 dark:text-gray-500 tracking-wider">{key}</p>
                                        <p className="text-xs text-gray-800 dark:text-gray-300 break-all">{formatValue(value)}</p>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}

                              <div className="text-[10px] text-gray-400 dark:text-gray-600 font-mono">
                                ID: {log.record_id}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      ) : (
        /* ==================== TABLE VIEW ==================== */
        <Card>
          <CardHeader>
            <CardTitle>Activity Table</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                <thead className="bg-gray-50 dark:bg-gray-700">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Date & Time</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Action</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Description</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">User</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Details</th>
                  </tr>
                </thead>
                <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                  {pagedLogs.map((log) => {
                    const isExpanded = expandedLog === log.audit_id;
                    const changes = log.operation === 'UPDATE' ? getChangedFields(log.old_data, log.new_data) : [];

                    return (
                      <React.Fragment key={log.audit_id}>
                        <tr className="hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer" onClick={() => setExpandedLog(isExpanded ? null : log.audit_id || null)}>
                          <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                            {log.deleted_at ? format(new Date(log.deleted_at), 'MMM dd, HH:mm') : '—'}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium border ${getOpColor(log.operation)}`}>
                              {OP_ICONS[log.operation]} {log.operation}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-700 dark:text-gray-300 max-w-xs truncate">
                            <span className="mr-1">{TABLE_ICONS[log.table_name] || '📄'}</span>
                            {describeAction(log)}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400 whitespace-nowrap">
                            {log.deleted_by || 'system'}
                          </td>
                          <td className="px-4 py-3">
                            <button className="text-blue-600 dark:text-blue-400 text-xs hover:underline">
                              {isExpanded ? 'Hide' : 'View'}
                            </button>
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr>
                            <td colSpan={5} className="px-4 py-4 bg-gray-50 dark:bg-gray-700/50">
                              <div className="space-y-3">
                                {log.reason && (
                                  <div className="bg-blue-50 dark:bg-blue-900/20 p-3 rounded-lg">
                                    <p className="text-sm text-blue-700 dark:text-blue-300">💬 {log.reason}</p>
                                  </div>
                                )}
                                {log.operation === 'UPDATE' && changes.length > 0 && (
                                  <div className="space-y-2">
                                    {changes.map(({ key, old: oldVal, new: newVal }) => (
                                      <div key={key} className="flex flex-wrap items-center gap-2 text-xs">
                                        <span className="font-medium text-gray-700 dark:text-gray-300 w-24">{key}:</span>
                                        <span className="bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 px-2 py-0.5 rounded line-through">{formatValue(oldVal)}</span>
                                        <span className="text-gray-400">→</span>
                                        <span className="bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 px-2 py-0.5 rounded">{formatValue(newVal)}</span>
                                      </div>
                                    ))}
                                  </div>
                                )}
                                {log.operation === 'DELETE' && log.old_data && (
                                  <pre className="bg-white dark:bg-gray-800 p-3 rounded border border-gray-200 dark:border-gray-600 text-xs overflow-x-auto text-gray-700 dark:text-gray-300">
                                    {JSON.stringify(log.old_data, null, 2)}
                                  </pre>
                                )}
                                {log.operation === 'INSERT' && log.new_data && (
                                  <pre className="bg-white dark:bg-gray-800 p-3 rounded border border-gray-200 dark:border-gray-600 text-xs overflow-x-auto text-gray-700 dark:text-gray-300">
                                    {JSON.stringify(log.new_data, null, 2)}
                                  </pre>
                                )}
                                <p className="text-[10px] text-gray-400 dark:text-gray-600 font-mono">ID: {log.record_id}</p>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <button
            onClick={() => setPage(Math.max(1, page - 1))}
            disabled={page === 1}
            className="px-3 py-1.5 text-sm bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg disabled:opacity-50 hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300"
          >
            ← Previous
          </button>
          <span className="text-sm text-gray-600 dark:text-gray-400">
            Page {page} of {totalPages}
          </span>
          <button
            onClick={() => setPage(Math.min(totalPages, page + 1))}
            disabled={page === totalPages}
            className="px-3 py-1.5 text-sm bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg disabled:opacity-50 hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300"
          >
            Next →
          </button>
        </div>
      )}

      {/* Storage Efficiency Tips */}
      <Card>
        <CardContent className="pt-4">
          <div className="flex items-start gap-3">
            <span className="text-xl">💡</span>
            <div>
              <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Storage & Performance Tips</p>
              <ul className="mt-2 space-y-1 text-xs text-gray-500 dark:text-gray-500">
                <li>• Audit logs currently store full record snapshots. Estimated ~{Math.round(logs.length * 0.5)}KB for {logs.length} records.</li>
                <li>• For high-volume tables (attendance), consider setting up a Supabase cron job to purge logs older than 6 months.</li>
                <li>• UPDATE logs can be optimized by storing only changed fields instead of full old/new data.</li>
                <li>• Use <code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">DELETE FROM audit_log WHERE deleted_at &lt; NOW() - INTERVAL '6 months'</code> to clean up.</li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default AuditLogs;
