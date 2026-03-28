import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/Card';
import { Button } from '@/shared/components/ui/Button';
import { format, parseISO } from 'date-fns';
import type { IssuedCertificate } from '@/features/certificates/services/certificateService';

export function VerifyTab({
  verifyCode,
  setVerifyCode,
  onVerify,
  verifying,
  result,
}: {
  verifyCode: string;
  setVerifyCode: (v: string) => void;
  onVerify: () => void;
  verifying: boolean;
  result: IssuedCertificate | null;
}) {
  return (
    <div className="max-w-lg mx-auto space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{'\u{1F50D}'} Verify Certificate</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Enter the 8-character verification code from a certificate to verify its authenticity.
          </p>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              type="text"
              value={verifyCode}
              onChange={e => setVerifyCode(e.target.value.toUpperCase())}
              placeholder="e.g. ABC12345"
              maxLength={8}
              className="flex-1 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm font-mono tracking-widest uppercase focus:ring-2 focus:ring-blue-500"
              onKeyDown={e => e.key === 'Enter' && onVerify()}
            />
            <Button onClick={onVerify} disabled={verifying || verifyCode.length < 6}>
              {verifying ? '...' : '\u{1F50D} Verify'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {result && (
        <Card className={`ring-2 ${result.status === 'issued' ? 'ring-emerald-400' : 'ring-red-400'}`}>
          <CardContent className="p-5">
            <div className="text-center mb-4">
              <div className="text-4xl mb-2">{result.status === 'issued' ? '\u2705' : '\u{1F6AB}'}</div>
              <h3 className="text-lg font-bold text-gray-900 dark:text-white">
                {result.status === 'issued' ? 'Certificate Verified!' : 'Certificate Revoked'}
              </h3>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
              <div>
                <span className="text-xs text-gray-400">Student</span>
                <p className="font-medium text-gray-900 dark:text-white">{result.student?.name}</p>
              </div>
              <div>
                <span className="text-xs text-gray-400">Course</span>
                <p className="font-medium text-gray-900 dark:text-white">{result.course?.course_name || result.session?.course?.course_name || '\u2013'}</p>
              </div>
              <div>
                <span className="text-xs text-gray-400">Certificate #</span>
                <p className="font-mono text-gray-700 dark:text-gray-300">{result.certificate_number}</p>
              </div>
              <div>
                <span className="text-xs text-gray-400">Issued</span>
                <p className="text-gray-700 dark:text-gray-300">
                  {result.issued_at ? format(parseISO(result.issued_at), 'MMM d, yyyy') : '\u2013'}
                </p>
              </div>
              {result.final_score != null && (
                <div>
                  <span className="text-xs text-gray-400">Score</span>
                  <p className="font-bold text-emerald-600">{result.final_score.toFixed(1)}%</p>
                </div>
              )}
              {result.attendance_rate != null && (
                <div>
                  <span className="text-xs text-gray-400">Attendance</span>
                  <p className="font-bold text-blue-600">{result.attendance_rate.toFixed(1)}%</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
