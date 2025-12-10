import { useState, useEffect } from 'react';
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

  useEffect(() => {
    loadLogs();
  }, [filters]);

  const loadLogs = async () => {
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
  };

  const getOperationBadge = (operation: string) => {
    const colors = {
      DELETE: 'bg-red-100 text-red-800',
      UPDATE: 'bg-yellow-100 text-yellow-800',
      INSERT: 'bg-green-100 text-green-800'
    };
    return (
      <span className={`px-2 py-1 text-xs font-semibold rounded ${colors[operation as keyof typeof colors]}`}>
        {operation}
      </span>
    );
  };

  const getTableBadge = (tableName: string) => {
    const colors = {
      student: 'bg-blue-100 text-blue-800',
      teacher: 'bg-purple-100 text-purple-800',
      course: 'bg-green-100 text-green-800',
      session: 'bg-orange-100 text-orange-800',
      enrollment: 'bg-pink-100 text-pink-800',
      attendance: 'bg-indigo-100 text-indigo-800'
    };
    return (
      <span className={`px-2 py-1 text-xs font-semibold rounded ${colors[tableName as keyof typeof colors] || 'bg-gray-100 text-gray-800'}`}>
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
              <label className="block text-sm font-medium text-gray-700 mb-1">Table</label>
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
              <label className="block text-sm font-medium text-gray-700 mb-1">Operation</label>
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
              <label className="block text-sm font-medium text-gray-700 mb-1">Limit</label>
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
            <div className="bg-red-50 p-4 rounded-lg">
              <div className="text-sm text-gray-600">Total Deletions</div>
              <div className="text-2xl font-bold text-red-600">
                {logs.filter(l => l.operation === 'DELETE').length}
              </div>
            </div>
            <div className="bg-yellow-50 p-4 rounded-lg">
              <div className="text-sm text-gray-600">Total Updates</div>
              <div className="text-2xl font-bold text-yellow-600">
                {logs.filter(l => l.operation === 'UPDATE').length}
              </div>
            </div>
            <div className="bg-green-50 p-4 rounded-lg">
              <div className="text-sm text-gray-600">Total Inserts</div>
              <div className="text-2xl font-bold text-green-600">
                {logs.filter(l => l.operation === 'INSERT').length}
              </div>
            </div>
            <div className="bg-blue-50 p-4 rounded-lg">
              <div className="text-sm text-gray-600">Total Records</div>
              <div className="text-2xl font-bold text-blue-600">{logs.length}</div>
            </div>
          </div>

          {/* Audit Log Table */}
          {loading ? (
            <div className="text-center py-8">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
              <p className="text-gray-600 mt-4">Loading audit logs...</p>
            </div>
          ) : logs.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-gray-600">No audit logs found</p>
              <p className="text-sm text-gray-500 mt-2">Logs will appear here when data is deleted, updated, or inserted</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Date & Time
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Operation
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Table
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Record ID
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      User
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {logs.map((log) => (
                    <>
                      <tr key={log.audit_id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900">
                          {log.deleted_at ? format(new Date(log.deleted_at), 'MMM dd, yyyy HH:mm:ss') : '-'}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          {getOperationBadge(log.operation)}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          {getTableBadge(log.table_name)}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-600 font-mono text-xs">
                          {log.record_id.substring(0, 8)}...
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-600">
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
                        <tr>
                          <td colSpan={6} className="px-4 py-4 bg-gray-50">
                            <div className="space-y-4">
                              {log.old_data && (
                                <div>
                                  <h4 className="text-sm font-semibold text-gray-700 mb-2">
                                    {log.operation === 'DELETE' ? 'Deleted Data:' : 'Old Data:'}
                                  </h4>
                                  <pre className="bg-white p-3 rounded border border-gray-200 text-xs overflow-x-auto">
                                    {formatData(log.old_data)}
                                  </pre>
                                </div>
                              )}
                              {log.new_data && (
                                <div>
                                  <h4 className="text-sm font-semibold text-gray-700 mb-2">New Data:</h4>
                                  <pre className="bg-white p-3 rounded border border-gray-200 text-xs overflow-x-auto">
                                    {formatData(log.new_data)}
                                  </pre>
                                </div>
                              )}
                              {log.reason && (
                                <div>
                                  <h4 className="text-sm font-semibold text-gray-700 mb-2">Reason:</h4>
                                  <p className="text-sm text-gray-600">{log.reason}</p>
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
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
