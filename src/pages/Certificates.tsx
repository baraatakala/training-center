import { useState, useEffect, useCallback, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/Card';
import { Button } from '@/shared/components/ui/Button';
import { Modal } from '@/shared/components/ui/Modal';
import { ConfirmDialog } from '@/shared/components/ui/ConfirmDialog';
import { toast } from '@/shared/components/ui/toastUtils';
import { TableSkeleton } from '@/shared/components/ui/Skeleton';
import { useIsTeacher } from '@/shared/hooks/useIsTeacher';
import { useAuth } from '../context/AuthContext';
import { format, parseISO } from 'date-fns';
import {
  certificateService,
  resolveTemplate,
  type CertificateTemplate,
  type IssuedCertificate,
  type StyleConfig,
} from '../services/certificateService';
import { supabase } from '@/shared/lib/supabase';
import { attendanceService } from '../services/attendanceService';
import { useRefreshOnFocus } from '@/shared/hooks/useRefreshOnFocus';

// =====================================================
// CONSTANTS
// =====================================================

const TEMPLATE_TYPES = [
  { value: 'completion', label: 'Course Completion', icon: 'ðŸŽ“' },
  { value: 'attendance', label: 'Perfect Attendance', icon: 'ðŸ“Š' },
  { value: 'achievement', label: 'Achievement Award', icon: 'ðŸ†' },
  { value: 'participation', label: 'Participation', icon: 'ðŸ¤' },
] as const;

const BORDER_STYLES = [
  { value: 'classic', label: 'Classic Gold' },
  { value: 'modern', label: 'Modern Gradient' },
  { value: 'minimal', label: 'Minimal Clean' },
  { value: 'ornate', label: 'Ornate Decorative' },
] as const;

const FONT_FAMILIES = [
  { value: 'serif', label: 'Serif (Traditional)' },
  { value: 'sans-serif', label: 'Sans-Serif (Modern)' },
  { value: 'Georgia, serif', label: 'Georgia' },
  { value: '"Times New Roman", serif', label: 'Times New Roman' },
] as const;

const STATUS_COLORS = {
  draft: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300',
  issued: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  revoked: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
} as const;

// =====================================================
// MAIN COMPONENT
// =====================================================

export function Certificates() {
  const { user } = useAuth();
  const { isTeacher, loading: roleLoading } = useIsTeacher();

  // Active tab
  const [tab, setTab] = useState<'certificates' | 'templates' | 'verify'>('certificates');

  // Data
  const [certificates, setCertificates] = useState<IssuedCertificate[]>([]);
  const [templates, setTemplates] = useState<CertificateTemplate[]>([]);
  const [loading, setLoading] = useState(true);

  // Modals
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<CertificateTemplate | null>(null);
  const [previewCert, setPreviewCert] = useState<IssuedCertificate | null>(null);
  const [showIssueModal, setShowIssueModal] = useState(false);
  const [revokeConfirm, setRevokeConfirm] = useState<IssuedCertificate | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<CertificateTemplate | null>(null);

  // Verify
  const [verifyCode, setVerifyCode] = useState('');
  const [verifyResult, setVerifyResult] = useState<IssuedCertificate | null>(null);
  const [verifying, setVerifying] = useState(false);

  // =====================================================
  // DATA LOADING
  // =====================================================

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [certRes, tmplRes] = await Promise.all([
        certificateService.getIssuedCertificates(),
        certificateService.getTemplates(),
      ]);

      if (certRes.data) setCertificates(certRes.data);
      if (tmplRes.data) setTemplates(tmplRes.data);
      if (certRes.error) {
        console.error('Certs error:', certRes.error);
        toast.error('Failed to load certificates');
      }
      if (tmplRes.error) {
        console.error('Templates error:', tmplRes.error);
        toast.error('Failed to load certificate templates');
      }
    } catch (err) {
      console.error(err);
      toast.error('Unexpected error loading certificate data');
    } finally {
      setLoading(false);
    }
  }, []);

  useRefreshOnFocus(fetchData);

  useEffect(() => {
    if (!roleLoading) fetchData();
  }, [fetchData, roleLoading]);

  // =====================================================
  // HANDLERS
  // =====================================================

  const handleVerify = async () => {
    if (!verifyCode.trim()) return;
    setVerifying(true);
    setVerifyResult(null);
    const { data, error } = await certificateService.verifyCertificate(verifyCode.trim());
    if (error || !data) {
      toast.error('Certificate not found or invalid code');
    } else {
      setVerifyResult(data);
    }
    setVerifying(false);
  };

  const handleRevoke = async () => {
    if (!revokeConfirm) return;
    const { error } = await certificateService.revokeCertificate(revokeConfirm.certificate_id, 'Revoked by admin');
    if (error) {
      toast.error('Failed to revoke certificate');
    } else {
      toast.success('Certificate revoked');
      setRevokeConfirm(null);
      fetchData();
    }
  };

  const handleDeleteTemplate = async () => {
    if (!deleteConfirm) return;
    const { error } = await certificateService.deleteTemplate(deleteConfirm.template_id);
    if (error) {
      toast.error('Failed to delete template');
    } else {
      toast.success('Template deleted');
      setDeleteConfirm(null);
      fetchData();
    }
  };

  // =====================================================
  // RENDER
  // =====================================================

  if (roleLoading) {
    return <div className="p-4 md:p-6"><TableSkeleton /></div>;
  }

  return (
    <div className="space-y-4 md:space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            ðŸ† Certificates
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Generate and manage course completion certificates
          </p>
        </div>
        {isTeacher && (
          <div className="flex flex-col sm:flex-row w-full sm:w-auto gap-2">
            <Button variant="outline" size="sm" onClick={fetchData} className="w-full sm:w-auto justify-center">ðŸ”„ Refresh</Button>
            <Button size="sm" onClick={() => setShowIssueModal(true)} className="w-full sm:w-auto justify-center">ðŸŽ“ Issue Certificate</Button>
            <Button variant="outline" size="sm" onClick={() => { setEditingTemplate(null); setShowTemplateModal(true); }} className="w-full sm:w-auto justify-center">
              âœï¸ New Template
            </Button>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200 dark:border-gray-700 overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
        <nav className="flex gap-4 sm:gap-6 min-w-max">
          {(['certificates', 'templates', 'verify'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`pb-3 text-sm font-medium border-b-2 transition-colors ${
                tab === t
                  ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                  : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
              }`}
            >
              {t === 'certificates' ? `ðŸ“œ Certificates (${certificates.length})` :
               t === 'templates' ? `ðŸ“‹ Templates (${templates.length})` :
               'ðŸ” Verify'}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab Content */}
      {loading ? (
        <TableSkeleton />
      ) : tab === 'certificates' ? (
        <CertificatesList
          certificates={certificates}
          isTeacher={isTeacher}
          onPreview={setPreviewCert}
          onRevoke={setRevokeConfirm}
        />
      ) : tab === 'templates' ? (
        <TemplatesList
          templates={templates}
          isTeacher={isTeacher}
          onEdit={t => { setEditingTemplate(t); setShowTemplateModal(true); }}
          onDelete={setDeleteConfirm}
        />
      ) : (
        <VerifyTab
          verifyCode={verifyCode}
          setVerifyCode={setVerifyCode}
          onVerify={handleVerify}
          verifying={verifying}
          result={verifyResult}
        />
      )}

      {/* Modals */}
      {showTemplateModal && (
        <TemplateModal
          template={editingTemplate}
          onClose={() => setShowTemplateModal(false)}
          onSaved={() => { setShowTemplateModal(false); fetchData(); }}
        />
      )}

      {showIssueModal && (
        <IssueModal
          templates={templates.filter(t => t.is_active)}
          onClose={() => setShowIssueModal(false)}
          onIssued={() => { setShowIssueModal(false); fetchData(); }}
          userEmail={user?.email || ''}
        />
      )}

      {previewCert && (
        <CertificatePreview
          certificate={previewCert}
          onClose={() => setPreviewCert(null)}
        />
      )}

      {revokeConfirm && (
        <ConfirmDialog
          isOpen={true}
          title="Revoke Certificate"
          message={`Revoke certificate ${revokeConfirm.certificate_number} for ${revokeConfirm.student?.name || 'this student'}?`}
          confirmText="Revoke"
          type="danger"
          onConfirm={handleRevoke}
          onCancel={() => setRevokeConfirm(null)}
        />
      )}

      {deleteConfirm && (
        <ConfirmDialog
          isOpen={true}
          title="Delete Template"
          message={`Delete template "${deleteConfirm.name}"? This will also delete all certificates using this template.`}
          confirmText="Delete"
          type="danger"
          onConfirm={handleDeleteTemplate}
          onCancel={() => setDeleteConfirm(null)}
        />
      )}
    </div>
  );
}

// =====================================================
// CERTIFICATES LIST
// =====================================================

function CertificatesList({
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
          <div className="text-4xl mb-3">ðŸ“œ</div>
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
                      {cert.status === 'issued' ? 'âœ…' : cert.status === 'revoked' ? 'ðŸš«' : 'ðŸ“'} {cert.status}
                    </span>
                    <code className="text-xs text-gray-400 dark:text-gray-500 font-mono">{cert.certificate_number}</code>
                  </div>
                  <h3 className="mt-1.5 text-sm font-semibold text-gray-900 dark:text-white">
                    {cert.student?.name || 'Unknown Student'}
                  </h3>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                    {cert.course?.course_name || cert.session?.course?.course_name || 'Unknown Course'}
                    {cert.issued_at && ` Â· Issued ${format(parseISO(cert.issued_at), 'MMM d, yyyy')}`}
                  </p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2 sm:gap-3 text-xs text-gray-400">
                    {cert.final_score != null && <span>Score: <strong>{cert.final_score.toFixed(1)}%</strong></span>}
                    {cert.attendance_rate != null && <span>Attendance: <strong>{cert.attendance_rate.toFixed(1)}%</strong></span>}
                    <span className="break-all">Verify: <code className="font-mono text-blue-500">{cert.verification_code}</code></span>
                  </div>
                </div>
                <div className="flex flex-col sm:flex-row gap-2 shrink-0 sm:min-w-[160px]">
                  <Button variant="outline" size="sm" onClick={() => onPreview(cert)} className="justify-center min-h-[36px]">ðŸ‘ Preview</Button>
                  {isTeacher && cert.status === 'issued' && (
                    <Button variant="outline" size="sm" onClick={() => onRevoke(cert)} className="text-red-500 justify-center min-h-[36px]">
                      ðŸš« Revoke
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

// =====================================================
// TEMPLATES LIST
// =====================================================

function TemplatesList({
  templates,
  isTeacher,
  onEdit,
  onDelete,
}: {
  templates: CertificateTemplate[];
  isTeacher: boolean;
  onEdit: (t: CertificateTemplate) => void;
  onDelete: (t: CertificateTemplate) => void;
}) {
  if (templates.length === 0) {
    return (
      <Card>
        <CardContent className="p-12 text-center">
          <div className="text-4xl mb-3">ðŸ“‹</div>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">No Templates</h3>
          <p className="text-sm text-gray-500 mt-1">Create a certificate template to get started.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {templates.map(tmpl => {
        const typeObj = TEMPLATE_TYPES.find(t => t.value === tmpl.template_type);
        return (
          <Card key={tmpl.template_id} className="hover:shadow-md transition-shadow">
            <CardContent className="p-4">
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xl">{typeObj?.icon || 'ðŸ“œ'}</span>
                    <h3 className="text-sm font-bold text-gray-900 dark:text-white">{tmpl.name}</h3>
                  </div>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{tmpl.description || 'No description'}</p>
                </div>
                <span className={`px-2 py-0.5 rounded-full text-xs ${tmpl.is_active ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' : 'bg-gray-100 text-gray-500'}`}>
                  {tmpl.is_active ? 'Active' : 'Inactive'}
                </span>
              </div>

              <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-gray-500 dark:text-gray-400">
                <div className={tmpl.min_score > 0 ? 'text-blue-600 dark:text-blue-400 font-medium' : ''}>
                  Min Score: <strong>{tmpl.min_score > 0 ? `${tmpl.min_score}%` : 'None'}</strong>
                </div>
                <div className={tmpl.min_attendance > 0 ? 'text-blue-600 dark:text-blue-400 font-medium' : ''}>
                  Min Attendance: <strong>{tmpl.min_attendance > 0 ? `${tmpl.min_attendance}%` : 'None'}</strong>
                </div>
                <div>Style: <strong>{(tmpl.style_config as StyleConfig)?.border_style || 'â€”'}</strong></div>
                <div>Type: <strong>{typeObj?.label || tmpl.template_type}</strong></div>
              </div>

              {isTeacher && (
                <div className="mt-3 flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => onEdit(tmpl)} className="flex-1 min-h-[36px]">âœï¸ Edit</Button>
                  <Button variant="outline" size="sm" onClick={() => onDelete(tmpl)} className="text-red-500 min-h-[36px]" aria-label={`Delete template ${tmpl.name}`}>ðŸ—‘</Button>
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

// =====================================================
// VERIFY TAB
// =====================================================

function VerifyTab({
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
          <CardTitle>ðŸ” Verify Certificate</CardTitle>
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
              {verifying ? '...' : 'ðŸ” Verify'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {result && (
        <Card className={`ring-2 ${result.status === 'issued' ? 'ring-emerald-400' : 'ring-red-400'}`}>
          <CardContent className="p-5">
            <div className="text-center mb-4">
              <div className="text-4xl mb-2">{result.status === 'issued' ? 'âœ…' : 'ðŸš«'}</div>
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
                <p className="font-medium text-gray-900 dark:text-white">{result.course?.course_name || result.session?.course?.course_name || 'â€”'}</p>
              </div>
              <div>
                <span className="text-xs text-gray-400">Certificate #</span>
                <p className="font-mono text-gray-700 dark:text-gray-300">{result.certificate_number}</p>
              </div>
              <div>
                <span className="text-xs text-gray-400">Issued</span>
                <p className="text-gray-700 dark:text-gray-300">
                  {result.issued_at ? format(parseISO(result.issued_at), 'MMM d, yyyy') : 'â€”'}
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

// =====================================================
// TEMPLATE MODAL (Create / Edit)
// =====================================================

function TemplateModal({
  template,
  onClose,
  onSaved,
}: {
  template: CertificateTemplate | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEditing = !!template;
  const [saving, setSaving] = useState(false);

  // Form state
  const [name, setName] = useState(template?.name || '');
  const [description, setDescription] = useState(template?.description || '');
  const [templateType, setTemplateType] = useState(template?.template_type || 'completion');
  const [minScore, setMinScore] = useState(template?.min_score || 0);
  const [minAttendance, setMinAttendance] = useState(template?.min_attendance || 0);
  const [bodyTemplate, setBodyTemplate] = useState(
    template?.body_template ||
    'This is to certify that {{name}} has successfully completed the course "{{course}}" with a score of {{score}}% and {{attendance}}% attendance rate.'
  );

  const [isActive, setIsActive] = useState(template?.is_active ?? true);

  // Style
  const defaultStyle: StyleConfig = {
    background_color: '#ffffff',
    accent_color: '#1e40af',
    font_family: 'serif',
    border_style: 'classic',
    orientation: 'landscape',
  };
  const existingStyle = template?.style_config as StyleConfig | undefined;
  const [style, setStyle] = useState<StyleConfig>({ ...defaultStyle, ...existingStyle });

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error('Template name is required');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: name.trim(),
        description: description.trim() || undefined,
        template_type: templateType,
        min_score: minScore,
        min_attendance: minAttendance,
        style_config: style,
        body_template: bodyTemplate,

      };

      const { error } = isEditing
        ? await certificateService.updateTemplate(template!.template_id, { ...payload, is_active: isActive } as Parameters<typeof certificateService.updateTemplate>[1])
        : await certificateService.createTemplate(payload);

      if (error) {
        toast.error(`Failed to ${isEditing ? 'update' : 'create'} template`);
      } else {
        toast.success(`Template ${isEditing ? 'updated' : 'created'}`);
        onSaved();
      }
    } finally {
      setSaving(false);
    }
  };

  // Preview resolved body
  const previewBody = resolveTemplate(bodyTemplate, {
    name: 'Ahmed Al-Farsi',
    course: 'Quran Memorization 101',
    date: format(new Date(), 'MMMM d, yyyy'),
    score: '95.5',
    attendance: '98.2',
    teacher: 'Sheikh Mohammad',
  });

  return (
    <Modal isOpen={true} onClose={onClose} title={isEditing ? 'Edit Template' : 'New Certificate Template'} size="xl">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6 max-h-[75vh] overflow-y-auto">
        {/* Left: Form */}
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Template Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Course Completion Certificate"
              className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Description</label>
            <input
              type="text"
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Brief description of this template"
              className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Type</label>
              <select
                value={templateType}
                onChange={e => setTemplateType(e.target.value as CertificateTemplate['template_type'])}
                className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm"
              >
                {TEMPLATE_TYPES.map(t => (
                  <option key={t.value} value={t.value}>{t.icon} {t.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Border Style</label>
              <select
                value={style.border_style}
                onChange={e => setStyle(s => ({ ...s, border_style: e.target.value as StyleConfig['border_style'] }))}
                className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm"
              >
                {BORDER_STYLES.map(b => (
                  <option key={b.value} value={b.value}>{b.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Min Score (%)
                <span className="block text-[10px] text-gray-400 font-normal">Students below this are warned on issuance</span>
              </label>
              <input
                type="number"
                value={minScore}
                onChange={e => setMinScore(Number(e.target.value))}
                min={0}
                max={100}
                placeholder="0 = no minimum"
                className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Min Attendance (%)
                <span className="block text-[10px] text-gray-400 font-normal">Students below this are warned on issuance</span>
              </label>
              <input
                type="number"
                value={minAttendance}
                onChange={e => setMinAttendance(Number(e.target.value))}
                min={0}
                max={100}
                placeholder="0 = no minimum"
                className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Accent Color</label>
              <input
                type="color"
                value={style.accent_color}
                onChange={e => setStyle(s => ({ ...s, accent_color: e.target.value }))}
                className="w-full h-9 rounded-lg border border-gray-300 dark:border-gray-600 cursor-pointer"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Font</label>
              <select
                value={style.font_family}
                onChange={e => setStyle(s => ({ ...s, font_family: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm"
              >
                {FONT_FAMILIES.map(f => (
                  <option key={f.value} value={f.value}>{f.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Body Template
              <span className="text-xs text-gray-400 ml-2">
                {'Placeholders: {{name}}, {{course}}, {{date}}, {{score}}, {{attendance}}, {{teacher}}'}
              </span>
            </label>
            <textarea
              value={bodyTemplate}
              onChange={e => setBodyTemplate(e.target.value)}
              rows={3}
              className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm resize-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={isActive}
              onChange={e => setIsActive(e.target.checked)}
              className="rounded border-gray-300"
            />
            <span className="text-gray-700 dark:text-gray-300">Active (available for issuance)</span>
          </label>
        </div>

        {/* Right: Preview */}
        <div>
          <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Preview</h3>
          <CertificatePreviewCard
            style={style}
            body={previewBody}
            signatureName="(Set when issuing)"
            signatureTitle=""
            templateType={templateType}
          />
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-4 border-t border-gray-200 dark:border-gray-700 mt-4">
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button onClick={handleSave} disabled={saving}>
          {saving ? 'Saving...' : isEditing ? 'ðŸ’¾ Update Template' : 'âœ¨ Create Template'}
        </Button>
      </div>
    </Modal>
  );
}

// =====================================================
// ISSUE MODAL
// =====================================================

function IssueModal({
  templates,
  onClose,
  onIssued,
  userEmail,
}: {
  templates: CertificateTemplate[];
  onClose: () => void;
  onIssued: () => void;
  userEmail: string;
}) {
  const [templateId, setTemplateId] = useState('');
  const [teacherId, setTeacherId] = useState('');
  const [courseId, setCourseId] = useState('');
  const [sessionId, setSessionId] = useState('');
  const [studentId, setStudentId] = useState('');
  const [score, setScore] = useState(0);
  const [attendance, setAttendance] = useState(0);
  const [issuing, setIssuing] = useState(false);
  const [loadingStats, setLoadingStats] = useState(false);
  const [signerName, setSignerName] = useState('');
  const [signerTitle, setSignerTitle] = useState('');
  const [belowThresholdAcknowledged, setBelowThresholdAcknowledged] = useState(false);

  // Loaded data
  const [teachers, setTeachers] = useState<Array<{ teacher_id: string; name: string; specialization: string | null }>>([]);
  const [courses, setCourses] = useState<Array<{ course_id: string; course_name: string; teacher_id: string }>>([]);
  const [sessions, setSessions] = useState<Array<{ session_id: string; label: string }>>([]);
  const [students, setStudents] = useState<Array<{ student_id: string; name: string }>>([]);

  // Load teachers on mount
  useEffect(() => {
    const load = async () => {
      const { data, error } = await supabase
        .from('teacher')
        .select('teacher_id, name, specialization')
        .order('name');
      if (error) {
        toast.error('Failed to load teachers: ' + error.message);
        return;
      }
      if (data) setTeachers(data);
    };
    load();
  }, []);

  // Load courses when teacher changes
  useEffect(() => {
    setCourseId('');
    setSessionId('');
    setStudentId('');
    setCourses([]);
    setSessions([]);
    setStudents([]);
    if (!teacherId) return;
    const load = async () => {
      // Get courses that have sessions taught by this teacher
      const { data, error } = await supabase
        .from('session')
        .select('course_id, course:course_id(course_id, course_name)')
        .eq('teacher_id', teacherId);
      if (error) {
        toast.error('Failed to load courses: ' + error.message);
        return;
      }
      if (data) {
        const unique = new Map<string, { course_id: string; course_name: string; teacher_id: string }>();
        for (const s of data) {
          const c = (Array.isArray(s.course) ? s.course[0] : s.course) as { course_id: string; course_name: string } | null;
          if (c && !unique.has(c.course_id)) {
            unique.set(c.course_id, { course_id: c.course_id, course_name: c.course_name, teacher_id: teacherId });
          }
        }
        setCourses(Array.from(unique.values()).sort((a, b) => a.course_name.localeCompare(b.course_name)));
      }
    };
    load();
    // Auto-fill signer metadata from teacher
    const t = teachers.find(t => t.teacher_id === teacherId);
    if (t && !signerName) setSignerName(t.name);
    if (t && !signerTitle && t.specialization) setSignerTitle(t.specialization);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teacherId]);

  // Load sessions + enrolled students when course changes
  useEffect(() => {
    setSessionId('');
    setStudentId('');
    setSessions([]);
    setStudents([]);
    if (!courseId || !teacherId) return;
    const load = async () => {
      // Get sessions for this course+teacher
      const { data: sessData, error: sessError } = await supabase
        .from('session')
        .select('session_id, day, time, start_date')
        .eq('course_id', courseId)
        .eq('teacher_id', teacherId)
        .order('start_date', { ascending: false });
      if (sessError) {
        toast.error('Failed to load sessions: ' + sessError.message);
        return;
      }
      if (sessData) {
        setSessions(sessData.map(s => {
          const parts: string[] = [];
          if (s.day) parts.push(s.day);
          if (s.time) parts.push(`@ ${s.time}`);
          if (s.start_date) parts.push(`(${s.start_date})`);
          return { session_id: s.session_id, label: parts.join(' ') || s.session_id };
        }));

        // Get enrolled students across ALL sessions for this course+teacher
        const sessionIds = sessData.map(s => s.session_id);
        if (sessionIds.length > 0) {
          const { data: enrollData, error: enrollError } = await supabase
            .from('enrollment')
            .select('student:student_id(student_id, name)')
            .in('session_id', sessionIds)
            .eq('status', 'active');
          if (enrollError) {
            toast.error('Failed to load students: ' + enrollError.message);
            return;
          }
          if (enrollData) {
            const unique = new Map<string, { student_id: string; name: string }>();
            for (const e of enrollData) {
              const stu = (Array.isArray(e.student) ? e.student[0] : e.student) as { student_id: string; name: string } | null;
              if (stu && !unique.has(stu.student_id)) {
                unique.set(stu.student_id, { student_id: stu.student_id, name: stu.name });
              }
            }
            setStudents(Array.from(unique.values()).sort((a, b) => a.name.localeCompare(b.name)));
          }
        }
      }
    };
    load();
  }, [courseId, teacherId]);

  // Re-filter students when a specific session is selected
  useEffect(() => {
    if (!sessionId || !courseId || !teacherId) return;
    setStudentId('');
    const load = async () => {
      const { data: enrollData, error: enrollError } = await supabase
        .from('enrollment')
        .select('student:student_id(student_id, name)')
        .eq('session_id', sessionId)
        .eq('status', 'active');
      if (enrollError) {
        toast.error('Failed to load students: ' + enrollError.message);
        return;
      }
      if (enrollData) {
        const unique = new Map<string, { student_id: string; name: string }>();
        for (const e of enrollData) {
          const stu = (Array.isArray(e.student) ? e.student[0] : e.student) as { student_id: string; name: string } | null;
          if (stu && !unique.has(stu.student_id)) {
            unique.set(stu.student_id, { student_id: stu.student_id, name: stu.name });
          }
        }
        setStudents(Array.from(unique.values()).sort((a, b) => a.name.localeCompare(b.name)));
      }
    };
    load();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // Auto-fetch attendance stats when student + course selected
  useEffect(() => {
    if (!studentId || !courseId || !teacherId) return;
    const fetchStats = async () => {
      setLoadingStats(true);
      try {
        // Get all session IDs for this course+teacher
        const { data: sessData, error: sessErr } = await supabase
          .from('session')
          .select('session_id')
          .eq('course_id', courseId)
          .eq('teacher_id', teacherId);
        if (sessErr) {
          toast.error('Failed to load attendance data');
          setLoadingStats(false);
          return;
        }
        const sessionIds = sessData?.map(s => s.session_id) || [];
        if (sessionIds.length === 0) { setLoadingStats(false); return; }

        // If a specific session is selected, use only that one
        const idsToQuery = sessionId ? [sessionId] : sessionIds;

        const { data: summary } = await attendanceService.getStudentAttendanceSummary(studentId, idsToQuery);
        if (summary) {
          setAttendance(summary.rate);
          setScore(summary.qualityRate);
        } else {
          setAttendance(0);
          setScore(0);
        }
      } catch { /* non-critical */ }
      setLoadingStats(false);
    };
    fetchStats();
  }, [studentId, courseId, teacherId, sessionId]);

  // Reset threshold acknowledgment when key form values change
  useEffect(() => {
    setBelowThresholdAcknowledged(false);
  }, [templateId, studentId, score, attendance]);

  // Computed: selected template and threshold status
  const selectedTemplate = templates.find(t => t.template_id === templateId);
  const belowMinScore = selectedTemplate && selectedTemplate.min_score > 0 && score < selectedTemplate.min_score;
  const belowMinAttendance = selectedTemplate && selectedTemplate.min_attendance > 0 && attendance < selectedTemplate.min_attendance;
  const hasThresholdWarning = !!(belowMinScore || belowMinAttendance);

  const handleIssue = async () => {
    if (!templateId || !studentId) {
      toast.error('Select a template and student');
      return;
    }
    // Threshold check â€” warn but allow override
    const selectedTemplate = templates.find(t => t.template_id === templateId);
    if (selectedTemplate && !belowThresholdAcknowledged) {
      const belowScore = selectedTemplate.min_score > 0 && score < selectedTemplate.min_score;
      const belowAttendance = selectedTemplate.min_attendance > 0 && attendance < selectedTemplate.min_attendance;
      if (belowScore || belowAttendance) {
        setBelowThresholdAcknowledged(true);
        toast.warning(
          `Student does not meet template requirements (${belowScore ? `Score: ${score}% < ${selectedTemplate.min_score}%` : ''}${belowScore && belowAttendance ? ', ' : ''}${belowAttendance ? `Attendance: ${attendance}% < ${selectedTemplate.min_attendance}%` : ''}). Click "Issue Anyway" to confirm.`
        );
        return;
      }
    }
    setIssuing(true);
    try {
      const { error } = await certificateService.issueCertificate({
        template_id: templateId,
        student_id: studentId,
        session_id: sessionId || undefined,
        course_id: courseId || undefined,
        signer_teacher_id: teacherId || undefined,
        final_score: score,
        attendance_rate: attendance,
        issued_by: userEmail,
        signature_name: signerName.trim() || undefined,
        signature_title: signerTitle.trim() || undefined,
      });
      if (error) {
        toast.error('Failed to issue certificate: ' + error.message);
      } else {
        toast.success('Certificate issued!');
        onIssued();
      }
    } finally {
      setIssuing(false);
    }
  };

  return (
    <Modal isOpen={true} onClose={onClose} title="Issue Certificate" size="lg">
      <div className="space-y-4">
        {/* Template */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Template <span className="text-red-500">*</span></label>
          <select
            value={templateId}
            onChange={e => setTemplateId(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm"
          >
            <option value="">Select template...</option>
            {templates.map(t => (
              <option key={t.template_id} value={t.template_id}>{t.name} ({t.template_type})</option>
            ))}
          </select>
        </div>

        {/* Teacher */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Teacher</label>
          <select
            value={teacherId}
            onChange={e => setTeacherId(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm"
          >
            <option value="">Select teacher...</option>
            {teachers.map(t => (
              <option key={t.teacher_id} value={t.teacher_id}>{t.name}</option>
            ))}
          </select>
        </div>

        {/* Course */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Course <span className="text-red-500">*</span></label>
          <select
            value={courseId}
            onChange={e => setCourseId(e.target.value)}
            disabled={!teacherId}
            className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm disabled:opacity-50"
          >
            <option value="">{teacherId ? 'Select course...' : 'Select a teacher first'}</option>
            {courses.map(c => (
              <option key={c.course_id} value={c.course_id}>{c.course_name}</option>
            ))}
          </select>
        </div>

        {/* Session (optional) */}
        {sessions.length > 1 && courseId && (
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Session <span className="text-xs text-gray-400">(optional â€” defaults to all sessions)</span>
            </label>
            <select
              value={sessionId}
              onChange={e => setSessionId(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm"
            >
              <option value="">All sessions (combined stats)</option>
              {sessions.map(s => (
                <option key={s.session_id} value={s.session_id}>{s.label}</option>
              ))}
            </select>
          </div>
        )}

        {/* Student */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Student <span className="text-red-500">*</span></label>
          <select
            value={studentId}
            onChange={e => setStudentId(e.target.value)}
            disabled={!courseId}
            className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm disabled:opacity-50"
          >
            <option value="">{courseId ? `Select student... (${students.length} enrolled)` : 'Select a course first'}</option>
            {students.map(s => (
              <option key={s.student_id} value={s.student_id}>{s.name}</option>
            ))}
          </select>
        </div>

        {/* Scores */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Final Score (%) {loadingStats && <span className="text-xs text-blue-500">loading...</span>}
            </label>
            <input
              type="number"
              value={score}
              onChange={e => setScore(Number(e.target.value))}
              min={0}
              max={100}
              step={0.1}
              className={`w-full px-3 py-2 rounded-lg border text-sm ${belowMinScore ? 'border-red-400 bg-red-50 dark:bg-red-900/20 dark:border-red-600' : 'border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800'}`}
            />
            {belowMinScore && (
              <p className="text-xs text-red-500 mt-1 font-medium">âš  Below minimum {selectedTemplate!.min_score}%</p>
            )}
            {studentId && courseId && !loadingStats && !belowMinScore && <p className="text-xs text-gray-400 mt-1">Auto-filled from attendance records</p>}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Attendance Rate (%) {loadingStats && <span className="text-xs text-blue-500">loading...</span>}
            </label>
            <input
              type="number"
              value={attendance}
              onChange={e => setAttendance(Number(e.target.value))}
              min={0}
              max={100}
              step={0.1}
              className={`w-full px-3 py-2 rounded-lg border text-sm ${belowMinAttendance ? 'border-red-400 bg-red-50 dark:bg-red-900/20 dark:border-red-600' : 'border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800'}`}
            />
            {belowMinAttendance && (
              <p className="text-xs text-red-500 mt-1 font-medium">âš  Below minimum {selectedTemplate!.min_attendance}%</p>
            )}
          </div>
        </div>

        {/* Signer Info */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Signer Name</label>
            <input
              type="text"
              value={signerName}
              onChange={e => setSignerName(e.target.value)}
              placeholder="e.g. Dr. Ahmad"
              className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm"
            />
            {teacherId && !signerName && (
              <button
                type="button"
                onClick={() => {
                  const t = teachers.find(t => t.teacher_id === teacherId);
                  if (t) setSignerName(t.name);
                }}
                className="text-xs text-blue-500 hover:text-blue-700 mt-1"
              >
                Use teacher name
              </button>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Signer Title</label>
            <input
              type="text"
              value={signerTitle}
              onChange={e => setSignerTitle(e.target.value)}
              placeholder="e.g. Mathematics"
              className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm"
            />
            {teacherId && !signerTitle && (
              <button
                type="button"
                onClick={() => {
                  const t = teachers.find(t => t.teacher_id === teacherId);
                  if (t?.specialization) setSignerTitle(t.specialization);
                }}
                className="text-xs text-blue-500 hover:text-blue-700 mt-1"
              >
                Use teacher specialization
              </button>
            )}
          </div>
        </div>

        {/* Threshold requirements indicator */}
        {selectedTemplate && (selectedTemplate.min_score > 0 || selectedTemplate.min_attendance > 0) && (
          <div className={`p-3 rounded-lg border text-xs ${
            hasThresholdWarning
              ? 'bg-amber-50 dark:bg-amber-900/20 border-amber-300 dark:border-amber-700 text-amber-800 dark:text-amber-200'
              : 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-300 dark:border-emerald-700 text-emerald-800 dark:text-emerald-200'
          }`}>
            <div className="font-semibold mb-1">{hasThresholdWarning ? 'âš  Template Requirements Not Met' : 'âœ… Template Requirements Met'}</div>
            <div className="flex gap-4">
              {selectedTemplate.min_score > 0 && (
                <span>Score: <strong>{score}%</strong> / {selectedTemplate.min_score}% min {score >= selectedTemplate.min_score ? 'âœ“' : 'âœ—'}</span>
              )}
              {selectedTemplate.min_attendance > 0 && (
                <span>Attendance: <strong>{attendance}%</strong> / {selectedTemplate.min_attendance}% min {attendance >= selectedTemplate.min_attendance ? 'âœ“' : 'âœ—'}</span>
              )}
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            onClick={handleIssue}
            disabled={issuing || !templateId || !studentId}
            className={hasThresholdWarning && !belowThresholdAcknowledged ? '' : hasThresholdWarning && belowThresholdAcknowledged ? 'bg-amber-600 hover:bg-amber-700' : ''}
          >
            {issuing ? 'Issuing...' : hasThresholdWarning && !belowThresholdAcknowledged ? 'âš  Check Requirements' : hasThresholdWarning && belowThresholdAcknowledged ? 'âš  Issue Anyway' : 'ðŸŽ“ Issue Certificate'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// =====================================================
// CERTIFICATE PREVIEW (Visual)
// =====================================================

function CertificatePreviewCard({
  style,
  body,
  signatureName,
  signatureTitle,
  templateType,
}: {
  style: StyleConfig;
  body: string;
  signatureName: string;
  signatureTitle: string;
  templateType: string;
}) {
  const typeObj = TEMPLATE_TYPES.find(t => t.value === templateType);
  const borderClasses = {
    classic: 'border-4 border-double',
    modern: 'border-2',
    minimal: 'border',
    ornate: 'border-4 border-double',
  }[style.border_style] || 'border-2';

  return (
    <div
      className={`${borderClasses} rounded-lg p-6 text-center space-y-4 shadow-lg`}
      style={{
        backgroundColor: style.background_color,
        borderColor: style.accent_color,
        fontFamily: style.font_family,
        minHeight: '300px',
      }}
    >
      {/* Header */}
      <div className="space-y-1">
        <div className="text-3xl">{typeObj?.icon || 'ðŸ“œ'}</div>
        <h2 className="text-xl font-bold tracking-wide" style={{ color: style.accent_color }}>
          CERTIFICATE
        </h2>
        <p className="text-xs uppercase tracking-widest text-gray-500">
          of {templateType}
        </p>
      </div>

      {/* Decorative line */}
      <div className="flex items-center gap-2 mx-auto max-w-xs">
        <div className="flex-1 h-px" style={{ backgroundColor: style.accent_color }} />
        <span style={{ color: style.accent_color }}>âœ¦</span>
        <div className="flex-1 h-px" style={{ backgroundColor: style.accent_color }} />
      </div>

      {/* Body */}
      <p className="text-sm leading-relaxed text-gray-700 px-4">{body}</p>

      {/* Date */}
      <p className="text-xs text-gray-500">{format(new Date(), 'MMMM d, yyyy')}</p>

      {/* Signature */}
      <div className="pt-4 border-t border-gray-200 inline-block mx-auto px-8">
        <div className="h-6 mb-1" /> {/* Signature space */}
        <div className="border-t border-gray-400 pt-1">
          <p className="text-sm font-bold text-gray-800">{signatureName}</p>
          <p className="text-xs text-gray-500">{signatureTitle}</p>
        </div>
      </div>
    </div>
  );
}

// =====================================================
// CERTIFICATE PREVIEW MODAL (for issued)
// =====================================================

function CertificatePreview({
  certificate,
  onClose,
}: {
  certificate: IssuedCertificate;
  onClose: () => void;
}) {
  const tmpl = certificate.template as CertificateTemplate | undefined;
  const style: StyleConfig = (tmpl?.style_config as StyleConfig) || {
    background_color: '#ffffff',
    accent_color: '#1e40af',
    font_family: 'serif',
    border_style: 'classic',
    orientation: 'landscape',
  };

  // Re-resolve the body if it still contains unresolved {{...}} placeholders
  // This fixes cases where the stored resolved_body has issues
  const courseName = certificate.course?.course_name || certificate.session?.course?.course_name || '';
  const teacherName = certificate.session?.teacher?.name || '';
  const displayBody = certificate.resolved_body
    ? resolveTemplate(certificate.resolved_body, {
        name: certificate.student?.name,
        course: courseName,
        date: certificate.issued_at
          ? new Date(certificate.issued_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
          : undefined,
        score: certificate.final_score ?? undefined,
        attendance: certificate.attendance_rate ?? undefined,
        teacher: teacherName,
      })
    : '(No content)';

  const signerName = certificate.signature_name || tmpl?.signature_name || 'â€”';
  const signerTitle = certificate.signature_title || tmpl?.signature_title || '';

  const handlePrint = () => {
    // Create a printable window with the certificate
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;

    const typeObj = TEMPLATE_TYPES.find(t => t.value === tmpl?.template_type);

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Certificate - ${certificate.certificate_number}</title>
        <style>
          *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
          @page { size: ${style.orientation === 'portrait' ? 'A4 portrait' : 'A4 landscape'}; margin: 10mm; }
          html, body { width: 100%; height: 100%; font-family: ${style.font_family}; }
          body { display: flex; align-items: center; justify-content: center; }
          .cert {
            border: 4px double ${style.accent_color};
            border-radius: 12px;
            padding: 40px 48px;
            text-align: center;
            width: 100%;
            max-width: ${style.orientation === 'portrait' ? '170mm' : '257mm'};
            background: ${style.background_color};
            page-break-inside: avoid;
          }
          .title { font-size: 28px; color: ${style.accent_color}; font-weight: bold; letter-spacing: 4px; margin-bottom: 4px; }
          .subtitle { font-size: 11px; text-transform: uppercase; letter-spacing: 3px; color: #888; margin-bottom: 12px; }
          .icon { font-size: 36px; margin-bottom: 8px; }
          .divider { display: flex; align-items: center; gap: 8px; margin: 12px auto; max-width: 200px; }
          .divider-line { flex: 1; height: 1px; background: ${style.accent_color}; }
          .body { font-size: 14px; line-height: 1.8; color: #333; margin: 16px 24px; }
          .meta { font-size: 11px; color: #888; margin-top: 10px; }
          .sig { display: inline-block; margin-top: 20px; padding: 0 32px; border-top: 1px solid #999; padding-top: 8px; }
          .sig-name { font-size: 14px; font-weight: bold; }
          .sig-title { font-size: 11px; color: #666; }
          .verify { margin-top: 12px; font-size: 10px; color: #aaa; font-family: monospace; }
          @media print {
            body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          }
        </style>
      </head>
      <body>
        <div class="cert">
          <div class="icon">${typeObj?.icon || 'ðŸ“œ'}</div>
          <div class="title">CERTIFICATE</div>
          <div class="subtitle">of ${tmpl?.template_type || 'completion'}</div>
          <div class="divider">
            <div class="divider-line"></div>
            <span style="color: ${style.accent_color};">âœ¦</span>
            <div class="divider-line"></div>
          </div>
          <div class="body">${displayBody}</div>
          <div class="meta">${certificate.issued_at ? new Date(certificate.issued_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : ''}</div>
          <div class="sig">
            <div class="sig-name">${signerName}</div>
            <div class="sig-title">${signerTitle}</div>
          </div>
          <div class="verify">Certificate #${certificate.certificate_number} Â· Verify: ${certificate.verification_code}</div>
        </div>
      </body>
      </html>
    `);
    printWindow.document.close();
    setTimeout(() => printWindow.print(), 500);
  };

  return (
    <Modal isOpen={true} onClose={onClose} title="Certificate Preview" size="xl">
      <div className="space-y-4">
        <CertificatePreviewCard
          style={style}
          body={displayBody}
          signatureName={signerName}
          signatureTitle={signerTitle}
          templateType={tmpl?.template_type || 'completion'}
        />

        <div className="flex items-center justify-between text-xs text-gray-400 px-2">
          <span>#{certificate.certificate_number}</span>
          <span>Verify: <code className="font-mono text-blue-500">{certificate.verification_code}</code></span>
          {certificate.status === 'revoked' && (
            <span className="text-red-500 font-bold">âš ï¸ REVOKED</span>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-2 border-t border-gray-200 dark:border-gray-700">
          <Button variant="outline" onClick={onClose}>Close</Button>
          <Button onClick={handlePrint}>ðŸ–¨ Print Certificate</Button>
        </div>
      </div>
    </Modal>
  );
}
