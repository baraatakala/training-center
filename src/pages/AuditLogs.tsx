import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Select } from '../components/ui/Select';
import { format } from 'date-fns';
import { getAuditLogs, type AuditLogEntry } from '../services/auditService';

export function AuditLogs() {
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({
    tableName: '',
    operation: '',
    limit: 100
  });
  const [expandedLog, setExpandedLog] = useState<string | null>(null);

  const loadLogs = useCallback(async () => {
    try {
      setLoading(true);
      const data = await getAuditLogs(filters);
      setLogs(data);
    } catch (error) {
      console.error('Error loading audit logs:', error);
      alert('Error loading audit logs. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    loadLogs();
  }, [loadLogs]);

  const getOperationBadge = (operation: string) => {
    const colors = {
      DELETE: 'bg-red-100 dark:bg-red-900/40 text-red-800 dark:text-red-300',
      UPDATE: 'bg-yellow-100 dark:bg-yellow-900/40 text-yellow-800 dark:text-yellow-300',
      INSERT: 'bg-green-100 dark:bg-green-900/40 text-green-800 dark:text-green-300'
    };
    return (
      <span className={`px-2 py-1 text-xs font-semibold rounded ${colors[operation as keyof typeof colors]}`}>
        {operation}
      </span>
    );
  };

  const getTableBadge = (tableName: string) => {
    const colors = {
      student: 'bg-blue-100 dark:bg-blue-900/40 text-blue-800 dark:text-blue-300',
      teacher: 'bg-purple-100 dark:bg-purple-900/40 text-purple-800 dark:text-purple-300',
      course: 'bg-green-100 dark:bg-green-900/40 text-green-800 dark:text-green-300',
      session: 'bg-orange-100 dark:bg-orange-900/40 text-orange-800 dark:text-orange-300',
      enrollment: 'bg-pink-100 dark:bg-pink-900/40 text-pink-800 dark:text-pink-300',
      attendance: 'bg-indigo-100 dark:bg-indigo-900/40 text-indigo-800 dark:text-indigo-300'
    };
    return (
      <span className={`px-2 py-1 text-xs font-semibold rounded ${colors[tableName as keyof typeof colors] || 'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-300'}`}>
        {tableName}
      </span>
    );
  };

  const formatData = (data: Record<string, unknown>) => {
    return JSON.stringify(data, null, 2);
  };

  return (
    <div className="container mx-auto p-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>📋 Audit Log</span>
            <Button onClick={loadLogs} disabled={loading}>
              {loading ? 'Loading...' : 'Refresh'}
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {/* Filters */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Table</label>
              <Select
                value={filters.tableName}
                onChange={(value) => setFilters({ ...filters, tableName: value })}
                options={[
                  { value: '', label: 'All Tables' },
                  { value: 'student', label: 'Student' },
                  { value: 'teacher', label: 'Teacher' },
                  { value: 'course', label: 'Course' },
                  { value: 'session', label: 'Session' },
                  { value: 'enrollment', label: 'Enrollment' },
                  { value: 'attendance', label: 'Attendance' },
                ]}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Operation</label>
              <Select
                value={filters.operation}
                onChange={(value) => setFilters({ ...filters, operation: value })}
                options={[
                  { value: '', label: 'All Operations' },
                  { value: 'DELETE', label: 'Delete' },
                  { value: 'UPDATE', label: 'Update' },
                  { value: 'INSERT', label: 'Insert' },
                ]}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Limit</label>
              <Select
                value={filters.limit.toString()}
                onChange={(value) => setFilters({ ...filters, limit: parseInt(value) })}
                options={[
                  { value: '50', label: '50 records' },
                  { value: '100', label: '100 records' },
                  { value: '200', label: '200 records' },
                  { value: '500', label: '500 records' },
                ]}
              />
            </div>
          </div>

          {/* Summary Stats */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
            <div className="bg-red-50 dark:bg-red-900/30 p-4 rounded-lg">
              <div className="text-sm text-gray-600 dark:text-gray-400">Total Deletions</div>
              <div className="text-2xl font-bold text-red-600 dark:text-red-400">
                {logs.filter(l => l.operation === 'DELETE').length}
              </div>
            </div>
            <div className="bg-yellow-50 dark:bg-yellow-900/30 p-4 rounded-lg">
              <div className="text-sm text-gray-600 dark:text-gray-400">Total Updates</div>
              <div className="text-2xl font-bold text-yellow-600 dark:text-yellow-400">
                {logs.filter(l => l.operation === 'UPDATE').length}
              </div>
            </div>
            <div className="bg-green-50 dark:bg-green-900/30 p-4 rounded-lg">
              <div className="text-sm text-gray-600 dark:text-gray-400">Total Inserts</div>
              <div className="text-2xl font-bold text-green-600 dark:text-green-400">
                {logs.filter(l => l.operation === 'INSERT').length}
              </div>
            </div>
            <div className="bg-blue-50 dark:bg-blue-900/30 p-4 rounded-lg">
              <div className="text-sm text-gray-600 dark:text-gray-400">Total Records</div>
              <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">{logs.length}</div>
            </div>
          </div>

          {/* Audit Log Table */}
          {loading ? (
            <div className="text-center py-8">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 dark:border-blue-400 mx-auto"></div>
              <p className="text-gray-600 dark:text-gray-400 mt-4">Loading audit logs...</p>
            </div>
          ) : logs.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-gray-600 dark:text-gray-400">No audit logs found</p>
              <p className="text-sm text-gray-500 dark:text-gray-500 mt-2">Logs will appear here when data is deleted, updated, or inserted</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                <thead className="bg-gray-50 dark:bg-gray-700">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Date & Time
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Operation
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Table
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Record ID
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      User
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                  {logs.map((log) => (
                    <React.Fragment key={log.audit_id}>
                      <tr className="hover:bg-gray-50 dark:hover:bg-gray-700">
                        <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                          {log.deleted_at ? format(new Date(log.deleted_at), 'MMM dd, yyyy HH:mm:ss') : '-'}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          {getOperationBadge(log.operation)}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          {getTableBadge(log.table_name)}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-gray-600 dark:text-gray-400 font-mono text-xs">
                          {log.record_id.substring(0, 8)}...
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">
                          {log.deleted_by || 'system'}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-sm">
                          <Button
                            size="sm"
                            onClick={() => setExpandedLog(expandedLog === log.audit_id ? null : log.audit_id || null)}
                            className="text-xs"
                          >
                            {expandedLog === log.audit_id ? 'Hide' : 'View'} Data
                          </Button>
                        </td>
                      </tr>
                      {expandedLog === log.audit_id && (
                        <tr key={log.audit_id + '-expanded'}>
                          <td colSpan={6} className="px-4 py-4 bg-gray-50 dark:bg-gray-700">
                            <div className="space-y-4">
                              {log.old_data && (
                                <div>
                                  <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                                    {log.operation === 'DELETE' ? 'Deleted Data:' : 'Old Data:'}
                                  </h4>
                                  <pre className="bg-white dark:bg-gray-800 p-3 rounded border border-gray-200 dark:border-gray-600 text-xs overflow-x-auto dark:text-gray-300">
                                    {formatData(log.old_data)}
                                  </pre>
                                </div>
                              )}
                              {log.new_data && (
                                <div>
                                  <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">New Data:</h4>
                                  <pre className="bg-white dark:bg-gray-800 p-3 rounded border border-gray-200 dark:border-gray-600 text-xs overflow-x-auto dark:text-gray-300">
                                    {formatData(log.new_data)}
                                  </pre>
                                </div>
                              )}
                              {log.reason && (
                                <div>
                                  <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Reason:</h4>
                                  <p className="text-sm text-gray-600 dark:text-gray-400">{log.reason}</p>
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
