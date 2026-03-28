import type { AbsentStudent } from '@/shared/utils/attendanceAnalytics';
import type { MessageTemplate, MessageChannel } from '../constants/dashboardConstants';
import { generateTemplateBody } from '../utils/messageGenerators';

interface MessageComposerModalProps {
  composerOpen: boolean;
  composerStudent: AbsentStudent | null;
  composerChannel: MessageChannel;
  composerTemplate: MessageTemplate;
  composerSubject: string;
  composerBody: string;
  bulkMode: boolean;
  filteredStudentsCount: number;
  setComposerOpen: (open: boolean) => void;
  setComposerChannel: (ch: MessageChannel) => void;
  setComposerTemplate: (t: MessageTemplate) => void;
  setComposerSubject: (s: string) => void;
  setComposerBody: (b: string) => void;
  onSend: () => void;
}

export function MessageComposerModal({
  composerOpen,
  composerStudent,
  composerChannel,
  composerTemplate,
  composerSubject,
  composerBody,
  bulkMode,
  filteredStudentsCount,
  setComposerOpen,
  setComposerChannel,
  setComposerTemplate,
  setComposerSubject,
  setComposerBody,
  onSend,
}: MessageComposerModalProps) {
  if (!composerOpen) return null;

  return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between p-5 border-b border-gray-200 dark:border-gray-700">
              <div>
                <h3 className="text-lg font-bold text-gray-900 dark:text-white">
                  {bulkMode ? `Ã°Å¸â€œÂ¨ Bulk Message (${filteredStudentsCount} students)` : 'Ã¢Å"â€°Ã¯Â¸Â Message Composer'}
                </h3>
                {composerStudent && !bulkMode && (
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
                    To: {composerStudent.student_name} Ã¢â‚¬â€ {composerStudent.course_name}
                  </p>
                )}
              </div>
              <button
                onClick={() => setComposerOpen(false)}
                className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              >
                <svg className="w-5 h-5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              {/* Channel selector */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Channel</label>
                <div className="flex gap-2">
                  {(['email', 'sms', 'whatsapp'] as MessageChannel[]).map(ch => (
                    <button
                      key={ch}
                      onClick={() => {
                        setComposerChannel(ch);
                        if (composerStudent) {
                          const { subject, body } = generateTemplateBody(composerTemplate, composerStudent, ch);
                          setComposerSubject(subject);
                          setComposerBody(body);
                        }
                      }}
                      className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                        composerChannel === ch
                          ? ch === 'email' ? 'bg-blue-600 text-white' : ch === 'sms' ? 'bg-green-600 text-white' : 'bg-emerald-600 text-white'
                          : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                      }`}
                    >
                      {ch === 'email' ? 'Ã°Å¸â€œÂ§ Email' : ch === 'sms' ? 'Ã°Å¸â€™Â¬ SMS' : 'Ã°Å¸â€œÂ± WhatsApp'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Template selector */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Template</label>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  {([
                    { key: 'attendance_alert' as MessageTemplate, label: '\u{1F6A8} Attendance Alert', desc: 'Risk-based warning' },
                    { key: 'encouragement' as MessageTemplate, label: '\u{1F31F} Encouragement', desc: 'Positive reinforcement' },
                    { key: 'reminder' as MessageTemplate, label: '\u{1F4C5} Session Reminder', desc: 'Upcoming session' },
                    { key: 'custom' as MessageTemplate, label: '\u270F\uFE0F Custom', desc: 'Write your own' },
                  ]).map(t => (
                    <button
                      key={t.key}
                      onClick={() => {
                        setComposerTemplate(t.key);
                        if (composerStudent) {
                          const { subject, body } = generateTemplateBody(t.key, composerStudent, composerChannel);
                          setComposerSubject(subject);
                          setComposerBody(body);
                        }
                      }}
                      className={`p-3 rounded-lg border-2 text-left transition-colors ${
                        composerTemplate === t.key
                          ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30 dark:border-blue-400'
                          : 'border-gray-200 dark:border-gray-600 hover:border-gray-400 dark:hover:border-gray-500'
                      }`}
                    >
                      <div className="text-sm font-medium text-gray-900 dark:text-white">{t.label}</div>
                      <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{t.desc}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Subject (email only) */}
              {composerChannel === 'email' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Subject</label>
                  <input
                    type="text"
                    value={composerSubject}
                    onChange={e => setComposerSubject(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm dark:bg-gray-700 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder="Email subject..."
                  />
                </div>
              )}

              {/* Message body */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Message Body</label>
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    {composerBody.length} characters
                    {composerChannel === 'sms' && composerBody.length > 160 && (
                      <span className="text-amber-600 dark:text-amber-400 ml-1">
                        ({Math.ceil(composerBody.length / 160)} SMS parts)
                      </span>
                    )}
                  </span>
                </div>
                <textarea
                  value={composerBody}
                  onChange={e => setComposerBody(e.target.value)}
                  rows={12}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm dark:bg-gray-700 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-mono"
                  placeholder="Compose your message..."
                />
              </div>

              {/* Student preview card (non-bulk) */}
              {composerStudent && !bulkMode && (
                <div className="p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
                  <div className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-2">Recipient Details</div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                    <div><span className="text-gray-500 dark:text-gray-400">Name:</span> <span className="font-medium text-gray-900 dark:text-white">{composerStudent.student_name}</span></div>
                    <div><span className="text-gray-500 dark:text-gray-400">Rate:</span> <span className="font-medium text-gray-900 dark:text-white">{composerStudent.attendanceRate}%</span></div>
                    <div><span className="text-gray-500 dark:text-gray-400">Risk:</span> <span className={`font-medium ${composerStudent.riskLevel === 'critical' ? 'text-red-600' : composerStudent.riskLevel === 'high' ? 'text-orange-600' : composerStudent.riskLevel === 'medium' ? 'text-yellow-600' : 'text-blue-600'}`}>{composerStudent.riskLevel.toUpperCase()}</span></div>
                    <div><span className="text-gray-500 dark:text-gray-400">Trend:</span> <span className="font-medium text-gray-900 dark:text-white">{composerStudent.trend}</span></div>
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between p-5 border-t border-gray-200 dark:border-gray-700">
              <button
                onClick={() => setComposerOpen(false)}
                className="px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <div className="flex items-center gap-2">
                {!bulkMode && composerStudent && (
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    {composerChannel === 'email' ? composerStudent.email : composerStudent.phone || 'No phone'}
                  </span>
                )}
                <button
                  onClick={onSend}
                  className={`px-6 py-2 rounded-lg text-white text-sm font-medium transition-colors ${
                    composerChannel === 'email' ? 'bg-blue-600 hover:bg-blue-700' :
                    composerChannel === 'sms' ? 'bg-green-600 hover:bg-green-700' :
                    'bg-emerald-600 hover:bg-emerald-700'
                  }`}
                >
                  {bulkMode ? `Send to ${filteredStudentsCount} Students` : 'Send Message'}
                </button>
              </div>
            </div>
          </div>
        </div>
  );
}
