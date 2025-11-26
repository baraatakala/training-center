import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://qrznvvjlzqzoqsmzljvk.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFyem52dmpsenF6b3FzbXpsanZrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQwODU3NDksImV4cCI6MjA3OTY2MTc0OX0.CBIjHpxwX-S5JlMPm9gzwB7AwpknaI_Nl52sgjPxm68';

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function checkTables() {
  console.log('🔍 Checking existing tables...\n');
  
  const tables = ['teacher', 'student', 'course', 'session', 'location', 'session_location', 'enrollment', 'attendance'];
  
  for (const table of tables) {
    const { data, error } = await supabase.from(table).select('*').limit(1);
    
    if (error) {
      console.log(`❌ ${table}: Not found`);
    } else {
      console.log(`✅ ${table}: Exists (${data.length} sample rows)`);
    }
  }
  
  console.log('\n' + '='.repeat(60));
  console.log('📝 Setup Instructions:');
  console.log('='.repeat(60));
  console.log('\n1. Open Supabase SQL Editor:');
  console.log('   https://supabase.com/dashboard/project/qrznvvjlzqzoqsmzljvk/sql/new');
  console.log('\n2. Copy and paste supabase-schema.sql');
  console.log('\n3. Click "Run" to create all tables');
  console.log('\n4. (Optional) Run sample-data.sql for test data\n');
}

checkTables().catch(console.error);
