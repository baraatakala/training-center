BEGIN;

INSERT INTO public.session_date_host (
  session_id,
  attendance_date,
  host_id,
  host_type,
  host_address
)
SELECT
  attendance_row.session_id,
  attendance_row.attendance_date,
  NULL,
  'student',
  MIN(btrim(attendance_row.host_address)) AS host_address
FROM public.attendance attendance_row
LEFT JOIN public.session_date_host host_row
  ON host_row.session_id = attendance_row.session_id
 AND host_row.attendance_date = attendance_row.attendance_date
WHERE host_row.id IS NULL
  AND attendance_row.status <> 'absent'
  AND attendance_row.host_address IS NOT NULL
  AND btrim(attendance_row.host_address) <> ''
  AND attendance_row.host_address <> 'SESSION_NOT_HELD'
GROUP BY attendance_row.session_id, attendance_row.attendance_date
HAVING COUNT(DISTINCT lower(btrim(attendance_row.host_address))) = 1
ON CONFLICT (session_id, attendance_date) DO NOTHING;

UPDATE public.attendance attendance_row
SET host_address = host_row.host_address
FROM public.session_date_host host_row
WHERE attendance_row.session_id = host_row.session_id
  AND attendance_row.attendance_date = host_row.attendance_date
  AND attendance_row.status <> 'absent'
  AND host_row.host_address IS NOT NULL
  AND btrim(host_row.host_address) <> ''
  AND (
    attendance_row.host_address IS NULL
    OR btrim(attendance_row.host_address) = ''
    OR lower(btrim(attendance_row.host_address)) <> lower(btrim(host_row.host_address))
  );

COMMIT;