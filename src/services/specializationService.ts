import { supabase } from '../lib/supabase';

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
  return supabase
    .from('specialization')
    .insert({ name: name.trim() })
    .select()
    .single();
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

  // 3. Cascade: update every student that had the old name
  await supabase
    .from('student')
    .update({ specialization: newName.trim() })
    .eq('specialization', old.name);

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

  // 2. Nullify on students
  await supabase
    .from('student')
    .update({ specialization: null })
    .eq('specialization', old.name);

  // 3. Delete the specialization row
  const { error } = await supabase
    .from('specialization')
    .delete()
    .eq('id', id);

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
