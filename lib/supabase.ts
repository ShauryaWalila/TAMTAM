import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';

// Corrected URL: added the missing 'j'
export const supabaseUrl = 'https://jzxfdaalvmsjzkrrajvp.supabase.co';
export const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp6eGZkYWFsdm1zanprcnJhanZwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ2Mjc4NjYsImV4cCI6MjA5MDIwMzg2Nn0.MqqMx7LQKqGHDlNJqpMcdL0MRC_Bye1P5_2p4dYy6T4';

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
  global: {
    headers: { 'x-application-name': 'tamtam' },
  },
});
