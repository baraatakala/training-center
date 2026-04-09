import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/shared/components/ui/Button';
import { ConfirmDialog } from '@/shared/components/ui/ConfirmDialog';
import { toast } from '@/shared/components/ui/toastUtils';
import { TableSkeleton } from '@/shared/components/ui/Skeleton';
import { useIsTeacher } from '@/shared/hooks/useIsTeacher';
import { useAuth } from '@/features/auth/AuthContext';
import {
  certificateService,
  type CertificateTemplate,
  type IssuedCertificate,
} from '@/features/certificates/services/certificateService';
import { useRefreshOnFocus } from '@/shared/hooks/useRefreshOnFocus';
import { CertificatesList } from '@/features/certificates/components/CertificatesList';
import { TemplatesList } from '@/features/certificates/components/TemplatesList';
import { VerifyTab } from '@/features/certificates/components/VerifyTab';
import { TemplateModal } from '@/features/certificates/components/TemplateModal';
import { IssueModal } from '@/features/certificates/components/IssueModal';
import { CertificatePreview } from '@/features/certificates/components/CertificatePreview';

export function Certificates({ embedded }: { embedded?: boolean } = {}) {
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
    <div className={embedded ? 'space-y-4' : 'space-y-4 md:space-y-6'}>
      {/* Header — hidden when embedded as a tab */}
      {!embedded && (
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            🏆 Certificates
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Generate and manage course completion certificates
          </p>
        </div>
        {isTeacher && (
          <div className="flex flex-col sm:flex-row w-full sm:w-auto gap-2">
            <Button variant="outline" size="sm" onClick={fetchData} className="w-full sm:w-auto justify-center">🔄 Refresh</Button>
            <Button size="sm" onClick={() => setShowIssueModal(true)} className="w-full sm:w-auto justify-center">🎓 Issue Certificate</Button>
            <Button variant="outline" size="sm" onClick={() => { setEditingTemplate(null); setShowTemplateModal(true); }} className="w-full sm:w-auto justify-center">
              ✏️ New Template
            </Button>
          </div>
        )}
      </div>
      )}

      {/* Action buttons when embedded */}
      {embedded && isTeacher && (
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={fetchData}>🔄 Refresh</Button>
          <Button size="sm" onClick={() => setShowIssueModal(true)}>🎓 Issue Certificate</Button>
          <Button variant="outline" size="sm" onClick={() => { setEditingTemplate(null); setShowTemplateModal(true); }}>✏️ New Template</Button>
        </div>
      )}

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
