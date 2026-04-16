import { supabase } from '@/shared/lib/supabase';
import { logInsert, logUpdate, logDelete } from '@/shared/services/auditService';

export interface Specialization {
  id: string;
  name: string;
  created_at: string;
}

/** Fetch all specializations ordered by name. */
export async function getAll() {
  return supabase
    .from('specialization')
    .select('*')
    .order('name');
}

/** Create a new specialization. */
export async function create(name: string) {
  const { data, error } = await supabase
    .from('specialization')
    .insert({ name: name.trim() })
    .select()
    .single();

  if (!error && data) {
    await logInsert('specialization', data.id, data as Record<string, unknown>);
  }

  return { data, error };
}

/** Rename an existing specialization and cascade the change to students. */
export async function rename(id: string, newName: string) {
  // 1. Get the old name
  const { data: old, error: fetchErr } = await supabase
    .from('specialization')
    .select('name')
    .eq('id', id)
    .single();
  if (fetchErr || !old) return { data: null, error: fetchErr };

  // 2. Rename the specialization row
  const { data, error } = await supabase
    .from('specialization')
    .update({ name: newName.trim() })
    .eq('id', id)
    .select()
    .single();
  if (error) return { data: null, error };

  // 3. Cascade: update every student and teacher that had the old name
  await supabase
    .from('student')
    .update({ specialization: newName.trim() })
    .eq('specialization', old.name);

  await supabase
    .from('teacher')
    .update({ specialization: newName.trim() })
    .eq('specialization', old.name);

  await logUpdate('specialization', id, { name: old.name } as Record<string, unknown>, { name: newName.trim() } as Record<string, unknown>);

  return { data, error: null };
}

/** Delete a specialization. Nullifies the field on students that had it. */
export async function remove(id: string) {
  // 1. Get the name first so we can clean up students
  const { data: old, error: fetchErr } = await supabase
    .from('specialization')
    .select('name')
    .eq('id', id)
    .single();
  if (fetchErr || !old) return { error: fetchErr };

  // 2. Nullify on students and teachers
  await supabase
    .from('student')
    .update({ specialization: null })
    .eq('specialization', old.name);

  await supabase
    .from('teacher')
    .update({ specialization: null })
    .eq('specialization', old.name);

  // 3. Delete the specialization row
  const { error } = await supabase
    .from('specialization')
    .delete()
    .eq('id', id);

  if (!error) {
    await logDelete('specialization', id, { name: old.name } as Record<string, unknown>);
  }

  return { error };
}

/** Count how many students currently use a specialization name. */
export async function studentCount(name: string) {
  const { count, error } = await supabase
    .from('student')
    .select('*', { count: 'exact', head: true })
    .eq('specialization', name);
  return { count: count ?? 0, error };
}

export const specializationService = { getAll, create, rename, remove, studentCount };
