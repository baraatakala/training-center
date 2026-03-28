import { useState } from 'react';
import { Button } from '@/shared/components/ui/Button';
import { Modal } from '@/shared/components/ui/Modal';
import { toast } from '@/shared/components/ui/toastUtils';
import { format } from 'date-fns';
import {
  certificateService,
  resolveTemplate,
  type CertificateTemplate,
  type StyleConfig,
} from '@/features/certificates/services/certificateService';
import { TEMPLATE_TYPES, BORDER_STYLES, FONT_FAMILIES } from '@/features/certificates/constants/certificateConstants';
import { CertificatePreviewCard } from '@/features/certificates/components/CertificatePreviewCard';

export function TemplateModal({
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
          {saving ? 'Saving...' : isEditing ? '\u{1F4BE} Update Template' : '\u2728 Create Template'}
        </Button>
      </div>
    </Modal>
  );
}
