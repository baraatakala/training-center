import { Button } from '@/shared/components/ui/Button';
import { Modal } from '@/shared/components/ui/Modal';
import { TEMPLATE_TYPES } from '@/features/certificates/constants/certificateConstants';
import { CertificatePreviewCard } from '@/features/certificates/components/CertificatePreviewCard';
import {
  resolveTemplate,
  type CertificateTemplate,
  type IssuedCertificate,
  type StyleConfig,
} from '@/features/certificates/services/certificateService';

export function CertificatePreview({
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

  const signerName = certificate.signature_name || tmpl?.signature_name || '\u2013';
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
          <div class="icon">${typeObj?.icon || '\u{1F4DC}'}</div>
          <div class="title">CERTIFICATE</div>
          <div class="subtitle">of ${tmpl?.template_type || 'completion'}</div>
          <div class="divider">
            <div class="divider-line"></div>
            <span style="color: ${style.accent_color};">\u2726</span>
            <div class="divider-line"></div>
          </div>
          <div class="body">${displayBody}</div>
          <div class="meta">${certificate.issued_at ? new Date(certificate.issued_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : ''}</div>
          <div class="sig">
            <div class="sig-name">${signerName}</div>
            <div class="sig-title">${signerTitle}</div>
          </div>
          <div class="verify">Certificate #${certificate.certificate_number} \u00B7 Verify: ${certificate.verification_code}</div>
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
            <span className="text-red-500 font-bold">{'\u26A0\uFE0F'} REVOKED</span>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-2 border-t border-gray-200 dark:border-gray-700">
          <Button variant="outline" onClick={onClose}>Close</Button>
          <Button onClick={handlePrint}>{'\u{1F5A8}'} Print Certificate</Button>
        </div>
      </div>
    </Modal>
  );
}
