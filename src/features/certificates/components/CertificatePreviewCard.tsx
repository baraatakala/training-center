import { format } from 'date-fns';
import { TEMPLATE_TYPES } from '@/features/certificates/constants/certificateConstants';
import type { StyleConfig } from '@/features/certificates/services/certificateService';

export function CertificatePreviewCard({
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
        <div className="text-3xl">{typeObj?.icon || '\u{1F4DC}'}</div>
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
        <span style={{ color: style.accent_color }}>{'\u2726'}</span>
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
