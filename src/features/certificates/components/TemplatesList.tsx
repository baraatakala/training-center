import { Card, CardContent } from '@/shared/components/ui/Card';
import { Button } from '@/shared/components/ui/Button';
import { TEMPLATE_TYPES } from '@/features/certificates/constants/certificateConstants';
import type { CertificateTemplate, StyleConfig } from '@/features/certificates/services/certificateService';

export function TemplatesList({
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
          <div className="text-4xl mb-3">{'\u{1F4CB}'}</div>
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
                    <span className="text-xl">{typeObj?.icon || '\u{1F4DC}'}</span>
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
                <div>Style: <strong>{(tmpl.style_config as StyleConfig)?.border_style || '\u2013'}</strong></div>
                <div>Type: <strong>{typeObj?.label || tmpl.template_type}</strong></div>
              </div>

              {isTeacher && (
                <div className="mt-3 flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => onEdit(tmpl)} className="flex-1 min-h-[36px]">{'\u270F\uFE0F'} Edit</Button>
                  <Button variant="outline" size="sm" onClick={() => onDelete(tmpl)} className="text-red-500 min-h-[36px]" aria-label={`Delete template ${tmpl.name}`}>{'\u{1F5D1}'}</Button>
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
