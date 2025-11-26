import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';

const supabaseUrl = 'https://qrznvvjlzqzoqsmzljvk.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFyem52dmpsenF6b3FzbXpsanZrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQwODU3NDksImV4cCI6MjA3OTY2MTc0OX0.CBIjHpxwX-S5JlMPm9gzwB7AwpknaI_Nl52sgjPxm68';

console.log('🔍 Validating SQL files...\n');

// Read and check schema file
const schemaPath = './supabase-schema.sql';
const sampleDataPath = './sample-data.sql';

try {
  const schema = fs.readFileSync(schemaPath, 'utf-8');
  const sampleData = fs.readFileSync(sampleDataPath, 'utf-8');
  
  console.log('✅ Schema file: Found');
  console.log(`   Size: ${(schema.length / 1024).toFixed(2)} KB`);
  console.log(`   Lines: ${schema.split('\n').length}`);
  
  console.log('✅ Sample data file: Found');
  console.log(`   Size: ${(sampleData.length / 1024).toFixed(2)} KB`);
  console.log(`   Lines: ${sampleData.split('\n').length}`);
  
  console.log('\n📊 Checking schema structure...\n');
  
  // Count tables
  const tableMatches = schema.match(/CREATE TABLE \w+/g);
  console.log(`   Tables to create: ${tableMatches?.length || 0}`);
  tableMatches?.forEach(match => {
    const tableName = match.replace('CREATE TABLE ', '');
    console.log(`   ✓ ${tableName}`);
  });
  
  // Count indexes
  const indexMatches = schema.match(/CREATE INDEX/g);
  console.log(`\n   Indexes to create: ${indexMatches?.length || 0}`);
  
  // Count triggers
  const triggerMatches = schema.match(/CREATE TRIGGER/g);
  console.log(`   Triggers to create: ${triggerMatches?.length || 0}`);
  
  // Count RLS policies
  const policyMatches = schema.match(/CREATE POLICY/g);
  console.log(`   RLS policies to create: ${policyMatches?.length || 0}`);
  
  // Check for common SQL syntax issues
  console.log('\n🔎 Checking for potential issues...\n');
  
  let issues = 0;
  
  // Check for unmatched parentheses
  const openParens = (schema.match(/\(/g) || []).length;
  const closeParens = (schema.match(/\)/g) || []).length;
  if (openParens !== closeParens) {
    console.log(`   ⚠️  Unmatched parentheses: ${openParens} open, ${closeParens} close`);
    issues++;
  } else {
    console.log(`   ✓ Parentheses balanced: ${openParens} pairs`);
  }
  
  // Check for UUID extension
  if (schema.includes('uuid-ossp') || schema.includes('uuid_generate_v4')) {
    console.log('   ✓ UUID extension configured');
  } else {
    console.log('   ⚠️  UUID extension not found');
    issues++;
  }
  
  // Check for RLS enabled
  if (schema.includes('ENABLE ROW LEVEL SECURITY')) {
    console.log('   ✓ Row Level Security enabled');
  }
  
  // Check for foreign keys
  const fkMatches = schema.match(/REFERENCES \w+\(/g);
  console.log(`   ✓ Foreign key relationships: ${fkMatches?.length || 0}`);
  
  // Validate sample data
  console.log('\n📊 Checking sample data...\n');
  
  const insertMatches = sampleData.match(/INSERT INTO \w+/g);
  console.log(`   Insert statements: ${insertMatches?.length || 0}`);
  
  const tablesInSample = new Set(
    insertMatches?.map(m => m.replace('INSERT INTO ', ''))
  );
  console.log(`   Tables with sample data: ${tablesInSample.size}`);
  tablesInSample.forEach(table => console.log(`   ✓ ${table}`));
  
  console.log('\n' + '='.repeat(60));
  if (issues === 0) {
    console.log('✅ SQL files look good! Ready to execute.');
  } else {
    console.log(`⚠️  Found ${issues} potential issue(s). Review before executing.`);
  }
  console.log('='.repeat(60));
  
  console.log('\n📝 To execute:');
  console.log('1. Go to: https://supabase.com/dashboard/project/qrznvvjlzqzoqsmzljvk/sql/new');
  console.log('2. Copy supabase-schema.sql and click Run');
  console.log('3. Copy sample-data.sql and click Run');
  
} catch (error) {
  console.error('❌ Error reading files:', error);
}
