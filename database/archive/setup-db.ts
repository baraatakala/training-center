import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';

// Supabase credentials
const supabaseUrl = 'https://qrznvvjlzqzoqsmzljvk.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFyem52dmpsenF6b3FzbXpsanZrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQwODU3NDksImV4cCI6MjA3OTY2MTc0OX0.CBIjHpxwX-S5JlMPm9gzwB7AwpknaI_Nl52sgjPxm68';

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function setupDatabase() {
  console.log('🚀 Starting database setup...\n');

  // Read the SQL schema file
  const schemaPath = path.join(process.cwd(), 'supabase-schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf-8');

  // Split the schema into individual statements
  const statements = schema
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0 && !s.startsWith('--'));

  console.log(`📝 Found ${statements.length} SQL statements to execute\n`);

  let successCount = 0;
  let errorCount = 0;

  // Execute each statement
  for (let i = 0; i < statements.length; i++) {
    const statement = statements[i] + ';';
    
    // Skip comments
    if (statement.trim().startsWith('--')) continue;

    try {
      const { error } = await supabase.rpc('exec_sql', { sql: statement });
      
      if (error) {
        console.error(`❌ Error executing statement ${i + 1}:`, error.message);
        errorCount++;
      } else {
        successCount++;
        // Show progress for key operations
        if (statement.includes('CREATE TABLE')) {
          const tableName = statement.match(/CREATE TABLE (\w+)/)?.[1];
          console.log(`✅ Created table: ${tableName}`);
        } else if (statement.includes('CREATE POLICY')) {
          const policyName = statement.match(/CREATE POLICY "([^"]+)"/)?.[1];
          console.log(`🔒 Created policy: ${policyName}`);
        }
      }
    } catch (err) {
      console.error(`❌ Exception on statement ${i + 1}:`, err);
      errorCount++;
    }
  }

  console.log('\n' + '='.repeat(50));
  console.log(`✨ Database setup completed!`);
  console.log(`✅ Successful: ${successCount}`);
  console.log(`❌ Errors: ${errorCount}`);
  console.log('='.repeat(50));
}

setupDatabase().catch(console.error);
