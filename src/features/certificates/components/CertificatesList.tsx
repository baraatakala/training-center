import { useState, useMemo } from 'react';
import { Card, CardContent } from '@/shared/components/ui/Card';
import { Button } from '@/shared/components/ui/Button';
import { format, parseISO } from 'date-fns';
import { STATUS_COLORS } from '@/features/certificates/constants/certificateConstants';
import type { IssuedCertificate } from '@/features/certificates/services/certificateService';

export function CertificatesList({
  certificates,
  isTeacher,
  onPreview,
  onRevoke,
}: {
  certificates: IssuedCertificate[];
  isTeacher: boolean;
  onPreview: (c: IssuedCertificate) => void;
  onRevoke: (c: IssuedCertificate) => void;
}) {
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    if (!search.trim()) return certificates;
    const term = search.toLowerCase();
    return certificates.filter(c =>
      c.student?.name?.toLowerCase().includes(term) ||
      c.certificate_number.toLowerCase().includes(term) ||
      c.course?.course_name?.toLowerCase().includes(term) ||
      c.session?.course?.course_name?.toLowerCase().includes(term)
    );
  }, [certificates, search]);

  if (certificates.length === 0) {
    return (
      <Card>
        <CardContent className="p-12 text-center">
          <div className="text-4xl mb-3">{'\u{1F4DC}'}</div>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">No Certificates Issued</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            {isTeacher ? 'Issue certificates to students using the button above.' : 'No certificates have been issued to you yet.'}
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <input
        type="text"
        placeholder="Search certificates..."
        value={search}
        onChange={e => setSearch(e.target.value)}
        className="w-full max-w-md px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm focus:ring-2 focus:ring-blue-500"
      />

      <div className="grid gap-3">
        {filtered.map(cert => (
          <Card key={cert.certificate_id} className="hover:shadow-md transition-shadow">
            <CardContent className="p-4">
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[cert.status]}`}>
                      {cert.status === 'issued' ? '\u2705' : cert.status === 'revoked' ? '\u{1F6AB}' : '\u{1F4D1}'} {cert.status}
                    </span>
                    <code className="text-xs text-gray-400 dark:text-gray-500 font-mono">{cert.certificate_number}</code>
                  </div>
                  <h3 className="mt-1.5 text-sm font-semibold text-gray-900 dark:text-white">
                    {cert.student?.name || 'Unknown Student'}
                  </h3>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                    {cert.course?.course_name || cert.session?.course?.course_name || 'Unknown Course'}
                    {cert.issued_at && ` \u00B7 Issued ${format(parseISO(cert.issued_at), 'MMM d, yyyy')}`}
                  </p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2 sm:gap-3 text-xs text-gray-400">
                    {cert.final_score != null && <span>Score: <strong>{cert.final_score.toFixed(1)}%</strong></span>}
                    {cert.attendance_rate != null && <span>Attendance: <strong>{cert.attendance_rate.toFixed(1)}%</strong></span>}
                    <span className="break-all">Verify: <code className="font-mono text-blue-500">{cert.verification_code}</code></span>
                  </div>
                </div>
                <div className="flex flex-col sm:flex-row gap-2 shrink-0 sm:min-w-[160px]">
                  <Button variant="outline" size="sm" onClick={() => onPreview(cert)} className="justify-center min-h-[36px]">{'\u{1F441}'} Preview</Button>
                  {isTeacher && cert.status === 'issued' && (
                    <Button variant="outline" size="sm" onClick={() => onRevoke(cert)} className="text-red-500 justify-center min-h-[36px]">
                      {'\u{1F6AB}'} Revoke
                    </Button>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
