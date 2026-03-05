import { useState, useEffect, useCallback, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { toast } from '../components/ui/toastUtils';
import { TableSkeleton } from '../components/ui/Skeleton';
import { useIsTeacher } from '../hooks/useIsTeacher';
import { useAuth } from '../context/AuthContext';
import { format, parseISO } from 'date-fns';
import {
  certificateService,
  resolveTemplate,
  type CertificateTemplate,
  type IssuedCertificate,
  type StyleConfig,
} from '../services/certificateService';
import { supabase } from '../lib/supabase';

// =====================================================
// CONSTANTS
// =====================================================

const TEMPLATE_TYPES = [
  { value: 'completion', label: 'Course Completion', icon: '🎓' },
  { value: 'attendance', label: 'Perfect Attendance', icon: '📊' },
  { value: 'achievement', label: 'Achievement Award', icon: '🏆' },
  { value: 'participation', label: 'Participation', icon: '🤝' },
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
      if (certRes.error) console.error('Certs error:', certRes.error);
      if (tmplRes.error) console.error('Templates error:', tmplRes.error);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

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
    return <div className="p-6"><TableSkeleton /></div>;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            🏆 Certificates
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Generate and manage course completion certificates
          </p>
        </div>
        {isTeacher && (
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={fetchData}>🔄 Refresh</Button>
            <Button size="sm" onClick={() => setShowIssueModal(true)}>🎓 Issue Certificate</Button>
            <Button variant="outline" size="sm" onClick={() => { setEditingTemplate(null); setShowTemplateModal(true); }}>
              ✏️ New Template
            </Button>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200 dark:border-gray-700">
        <nav className="flex gap-6">
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
              {t === 'certificates' ? `📜 Certificates (${certificates.length})` :
               t === 'templates' ? `📋 Templates (${templates.length})` :
               '🔍 Verify'}
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
      c.session?.course?.course_name?.toLowerCase().includes(term)
    );
  }, [certificates, search]);

  if (certificates.length === 0) {
    return (
      <Card>
        <CardContent className="p-12 text-center">
          <div className="text-4xl mb-3">📜</div>
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
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[cert.status]}`}>
                      {cert.status === 'issued' ? '✅' : cert.status === 'revoked' ? '🚫' : '📝'} {cert.status}
                    </span>
                    <code className="text-xs text-gray-400 dark:text-gray-500 font-mono">{cert.certificate_number}</code>
                  </div>
                  <h3 className="mt-1.5 text-sm font-semibold text-gray-900 dark:text-white">
                    {cert.student?.name || 'Unknown Student'}
                  </h3>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                    {cert.session?.course?.course_name || 'Unknown Course'}
                    {cert.issued_at && ` · Issued ${format(parseISO(cert.issued_at), 'MMM d, yyyy')}`}
                  </p>
                  <div className="mt-1.5 flex items-center gap-3 text-xs text-gray-400">
                    {cert.final_score != null && <span>Score: <strong>{cert.final_score.toFixed(1)}%</strong></span>}
                    {cert.attendance_rate != null && <span>Attendance: <strong>{cert.attendance_rate.toFixed(1)}%</strong></span>}
                    <span>Verify: <code className="font-mono text-blue-500">{cert.verification_code}</code></span>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Button variant="outline" size="sm" onClick={() => onPreview(cert)}>👁 Preview</Button>
                  {isTeacher && cert.status === 'issued' && (
                    <Button variant="outline" size="sm" onClick={() => onRevoke(cert)} className="text-red-500">
                      🚫 Revoke
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
          <div className="text-4xl mb-3">📋</div>
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
                    <span className="text-xl">{typeObj?.icon || '📜'}</span>
                    <h3 className="text-sm font-bold text-gray-900 dark:text-white">{tmpl.name}</h3>
                  </div>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{tmpl.description || 'No description'}</p>
                </div>
                <span className={`px-2 py-0.5 rounded-full text-xs ${tmpl.is_active ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' : 'bg-gray-100 text-gray-500'}`}>
                  {tmpl.is_active ? 'Active' : 'Inactive'}
                </span>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-gray-500 dark:text-gray-400">
                <div>Min Score: <strong>{tmpl.min_score}%</strong></div>
                <div>Min Attendance: <strong>{tmpl.min_attendance}%</strong></div>
                <div>Style: <strong>{(tmpl.style_config as StyleConfig)?.border_style || '—'}</strong></div>
                <div>Type: <strong>{typeObj?.label || tmpl.template_type}</strong></div>
              </div>

              {isTeacher && (
                <div className="mt-3 flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => onEdit(tmpl)} className="flex-1">✏️ Edit</Button>
                  <Button variant="outline" size="sm" onClick={() => onDelete(tmpl)} className="text-red-500">🗑</Button>
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
          <CardTitle>🔍 Verify Certificate</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Enter the 8-character verification code from a certificate to verify its authenticity.
          </p>
          <div className="flex gap-2">
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
              {verifying ? '...' : '🔍 Verify'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {result && (
        <Card className={`ring-2 ${result.status === 'issued' ? 'ring-emerald-400' : 'ring-red-400'}`}>
          <CardContent className="p-5">
            <div className="text-center mb-4">
              <div className="text-4xl mb-2">{result.status === 'issued' ? '✅' : '🚫'}</div>
              <h3 className="text-lg font-bold text-gray-900 dark:text-white">
                {result.status === 'issued' ? 'Certificate Verified!' : 'Certificate Revoked'}
              </h3>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <span className="text-xs text-gray-400">Student</span>
                <p className="font-medium text-gray-900 dark:text-white">{result.student?.name}</p>
              </div>
              <div>
                <span className="text-xs text-gray-400">Course</span>
                <p className="font-medium text-gray-900 dark:text-white">{result.session?.course?.course_name || '—'}</p>
              </div>
              <div>
                <span className="text-xs text-gray-400">Certificate #</span>
                <p className="font-mono text-gray-700 dark:text-gray-300">{result.certificate_number}</p>
              </div>
              <div>
                <span className="text-xs text-gray-400">Issued</span>
                <p className="text-gray-700 dark:text-gray-300">
                  {result.issued_at ? format(parseISO(result.issued_at), 'MMM d, yyyy') : '—'}
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
  const [signatureName, setSignatureName] = useState(template?.signature_name || '');
  const [signatureTitle, setSignatureTitle] = useState(template?.signature_title || '');
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
        signature_name: signatureName.trim() || undefined,
        signature_title: signatureTitle.trim() || undefined,
      };

      const { error } = isEditing
        ? await certificateService.updateTemplate(template!.template_id, { ...payload, ...(isActive !== template!.is_active ? {} : {}) })
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
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 max-h-[70vh] overflow-y-auto">
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

          <div className="grid grid-cols-2 gap-3">
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

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Min Score (%)</label>
              <input
                type="number"
                value={minScore}
                onChange={e => setMinScore(Number(e.target.value))}
                min={0}
                max={100}
                className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Min Attendance (%)</label>
              <input
                type="number"
                value={minAttendance}
                onChange={e => setMinAttendance(Number(e.target.value))}
                min={0}
                max={100}
                className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
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

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Signer Name</label>
              <input
                type="text"
                value={signatureName}
                onChange={e => setSignatureName(e.target.value)}
                placeholder="e.g. Dr. Ahmad"
                className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Signer Title</label>
              <input
                type="text"
                value={signatureTitle}
                onChange={e => setSignatureTitle(e.target.value)}
                placeholder="e.g. Director"
                className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm"
              />
            </div>
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
            signatureName={signatureName || 'Director Name'}
            signatureTitle={signatureTitle || 'Training Center Director'}
            templateType={templateType}
          />
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-4 border-t border-gray-200 dark:border-gray-700 mt-4">
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button onClick={handleSave} disabled={saving}>
          {saving ? 'Saving...' : isEditing ? '💾 Update Template' : '✨ Create Template'}
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
  const [sessionId, setSessionId] = useState('');
  const [studentId, setStudentId] = useState('');
  const [score, setScore] = useState(0);
  const [attendance, setAttendance] = useState(0);
  const [issuing, setIssuing] = useState(false);
  const [loadingStats, setLoadingStats] = useState(false);

  // Load sessions + students
  const [sessions, setSessions] = useState<Array<{ session_id: string; label: string; course_id: string }>>([]);
  const [students, setStudents] = useState<Array<{ student_id: string; name: string }>>([]);

  useEffect(() => {
    const loadSessions = async () => {
      const { data } = await supabase
        .from('session')
        .select('session_id, day, time, start_date, course:course_id(course_name), teacher:teacher_id(name)')
        .order('start_date', { ascending: false });
      if (data) {
        setSessions(data.map((s: Record<string, unknown>) => {
          const courseName = (s.course as Record<string, string> | null)?.course_name || 'Unknown';
          const teacherName = (s.teacher as Record<string, string> | null)?.name || 'Unknown Teacher';
          const day = s.day as string | null;
          const time = s.time as string | null;
          const parts = [courseName, `(${teacherName})`];
          if (day) parts.push(`- ${day}`);
          if (time) parts.push(`@ ${time}`);
          return {
            session_id: s.session_id as string,
            label: parts.join(' '),
            course_id: s.course_id as string,
          };
        }));
      }
    };
    loadSessions();
  }, []);

  useEffect(() => {
    if (!sessionId) { setStudents([]); return; }
    const loadStudents = async () => {
      const { data } = await supabase
        .from('enrollment')
        .select('student:student_id(student_id, name)')
        .eq('session_id', sessionId)
        .eq('status', 'active');
      if (data) {
        setStudents(data.map((e: Record<string, unknown>) => {
          const stu = e.student as Record<string, string> | null;
          return {
            student_id: stu?.student_id || '',
            name: stu?.name || 'Unknown',
          };
        }).filter(s => s.student_id));
      }
    };
    loadStudents();
  }, [sessionId]);

  // Auto-fetch attendance stats when student + session selected
  useEffect(() => {
    if (!studentId || !sessionId) return;
    const fetchStats = async () => {
      setLoadingStats(true);
      try {
        const { data: records } = await supabase
          .from('attendance')
          .select('status, late_minutes')
          .eq('session_id', sessionId)
          .eq('student_id', studentId);
        if (records && records.length > 0) {
          // Exclude excused from denominator — only count accountable days
          const excusedCount = records.filter((r: { status: string }) => r.status === 'excused').length;
          const accountable = records.length - excusedCount;
          const present = records.filter((r: { status: string }) => r.status === 'on time' || r.status === 'late').length;
          const attendRate = accountable > 0 ? Math.round((present / accountable) * 1000) / 10 : 0;
          // Quality-adjusted score: on time=1, late=partial (exponential decay), absent=0, excused=excluded
          let qualitySum = 0;
          for (const r of records) {
            if (r.status === 'on time') qualitySum += 1;
            else if (r.status === 'late') {
              const mins = (r as { late_minutes?: number }).late_minutes || 0;
              qualitySum += Math.max(0.05, Math.exp(-mins / 43.3));
            }
            // absent = 0, excused = excluded (not counted)
          }
          const qualityRate = accountable > 0 ? Math.round((qualitySum / accountable) * 1000) / 10 : 0;
          setAttendance(attendRate);
          setScore(qualityRate);
        } else {
          setAttendance(0);
          setScore(0);
        }
      } catch { /* non-critical */ }
      setLoadingStats(false);
    };
    fetchStats();
  }, [studentId, sessionId]);

  const handleIssue = async () => {
    if (!templateId || !studentId) {
      toast.error('Select a template and student');
      return;
    }
    setIssuing(true);
    try {
      const session = sessions.find(s => s.session_id === sessionId);
      const { error } = await certificateService.issueCertificate({
        template_id: templateId,
        student_id: studentId,
        session_id: sessionId || undefined,
        course_id: session?.course_id,
        final_score: score,
        attendance_rate: attendance,
        issued_by: userEmail,
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

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Session / Course</label>
          <select
            value={sessionId}
            onChange={e => setSessionId(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm"
          >
            <option value="">Select session...</option>
            {sessions.map(s => (
              <option key={s.session_id} value={s.session_id}>{s.label}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Student <span className="text-red-500">*</span></label>
          <select
            value={studentId}
            onChange={e => setStudentId(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm"
            disabled={!sessionId}
          >
            <option value="">{sessionId ? 'Select student...' : 'Select a session first'}</option>
            {students.map(s => (
              <option key={s.student_id} value={s.student_id}>{s.name}</option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-3">
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
              className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm"
            />
            {studentId && sessionId && !loadingStats && <p className="text-xs text-gray-400 mt-1">Auto-filled from attendance records</p>}
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
              className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm"
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleIssue} disabled={issuing || !templateId || !studentId}>
            {issuing ? 'Issuing...' : '🎓 Issue Certificate'}
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
        <div className="text-3xl">{typeObj?.icon || '📜'}</div>
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
        <span style={{ color: style.accent_color }}>✦</span>
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
          @page { size: ${style.orientation}; margin: 0; }
          body { margin: 0; padding: 40px; font-family: ${style.font_family}; display: flex; align-items: center; justify-content: center; min-height: 100vh; }
          .cert { border: 4px double ${style.accent_color}; border-radius: 12px; padding: 48px; text-align: center; max-width: 800px; background: ${style.background_color}; }
          .title { font-size: 28px; color: ${style.accent_color}; font-weight: bold; letter-spacing: 4px; margin-bottom: 4px; }
          .subtitle { font-size: 11px; text-transform: uppercase; letter-spacing: 3px; color: #888; }
          .divider { display: flex; align-items: center; gap: 8px; margin: 16px auto; max-width: 200px; }
          .divider-line { flex: 1; height: 1px; background: ${style.accent_color}; }
          .body { font-size: 14px; line-height: 1.8; color: #333; margin: 20px 32px; }
          .meta { font-size: 11px; color: #888; margin-top: 12px; }
          .sig { display: inline-block; margin-top: 24px; padding: 0 32px; border-top: 1px solid #999; padding-top: 8px; }
          .sig-name { font-size: 14px; font-weight: bold; }
          .sig-title { font-size: 11px; color: #666; }
          .verify { margin-top: 16px; font-size: 10px; color: #aaa; font-family: monospace; }
        </style>
      </head>
      <body>
        <div class="cert">
          <div style="font-size: 36px;">${typeObj?.icon || '📜'}</div>
          <div class="title">CERTIFICATE</div>
          <div class="subtitle">of ${tmpl?.template_type || 'completion'}</div>
          <div class="divider">
            <div class="divider-line"></div>
            <span style="color: ${style.accent_color};">✦</span>
            <div class="divider-line"></div>
          </div>
          <div class="body">${certificate.resolved_body || ''}</div>
          <div class="meta">${certificate.issued_at ? new Date(certificate.issued_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : ''}</div>
          <div class="sig">
            <div class="sig-name">${tmpl?.signature_name || ''}</div>
            <div class="sig-title">${tmpl?.signature_title || ''}</div>
          </div>
          <div class="verify">Certificate #${certificate.certificate_number} · Verify: ${certificate.verification_code}</div>
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
          body={certificate.resolved_body || '(No content)'}
          signatureName={tmpl?.signature_name || ''}
          signatureTitle={tmpl?.signature_title || ''}
          templateType={tmpl?.template_type || 'completion'}
        />

        <div className="flex items-center justify-between text-xs text-gray-400 px-2">
          <span>#{certificate.certificate_number}</span>
          <span>Verify: <code className="font-mono text-blue-500">{certificate.verification_code}</code></span>
          {certificate.status === 'revoked' && (
            <span className="text-red-500 font-bold">⚠️ REVOKED</span>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-2 border-t border-gray-200 dark:border-gray-700">
          <Button variant="outline" onClick={onClose}>Close</Button>
          <Button onClick={handlePrint}>🖨 Print Certificate</Button>
        </div>
      </div>
    </Modal>
  );
}

export default Certificates;
