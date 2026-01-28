import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://qrznvvjlzqzoqsmzljvk.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFyem52dmpsenF6b3FzbXpsanZrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQwODU3NDksImV4cCI6MjA3OTY2MTc0OX0.CBIjHpxwX-S5JlMPm9gzwB7AwpknaI_Nl52sgjPxm68';

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function testConnection() {
  console.log('🔌 Testing Supabase connection...\n');
  
  const { error } = await supabase
    .from('_not_a_real_table')
    .select('*')
    .limit(1);
  
  // We expect an error about table not existing, which means connection works
  if (error && error.message.includes('does not exist')) {
    console.log('✅ Successfully connected to Supabase!');
    console.log('📊 Project URL:', supabaseUrl);
    console.log('\n' + '='.repeat(50));
    console.log('✨ Your .env file has been created!');
    console.log('='.repeat(50));
    console.log('\n📋 Next steps:');
    console.log('1. Go to your Supabase dashboard SQL Editor');
    console.log('2. Copy the contents of supabase-schema.sql');
    console.log('3. Paste and run it in the SQL Editor');
    console.log('4. (Optional) Run sample-data.sql for test data');
    console.log('\n🔗 SQL Editor: https://supabase.com/dashboard/project/qrznvvjlzqzoqsmzljvk/sql/new');
    return true;
  } else if (error) {
    console.error('❌ Connection error:', error.message);
    return false;
  }
  
  console.log('✅ Connected to Supabase!');
  return true;
}

testConnection().catch(console.error);
