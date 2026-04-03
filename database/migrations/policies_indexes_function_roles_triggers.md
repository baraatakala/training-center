
look i want to creat md file to copilit for current indexes fuction and roles and polcies and and triggeres  in my supabase "1-Database Functions 
Docs

schema

public

Search for a function

Return Type

Security

Create a new function

Name	Arguments	Return type	Security	

calculate_gps_distance
lat1 double precision, lon1 double precision, lat2 double precision, lon2 double precision

double precision

Invoker



check_book_ref_same_course
–

trigger	
Invoker



cleanup_expired_qr_sessions
–

integer

Invoker



fn_enforce_can_host_on_status_change
–

trigger	
Invoker



generate_qr_session
p_session_id uuid, p_attendance_date date, p_created_by text DEFAULT NULL::text, p_check_in_mode text DEFAULT 'qr_code'::text, p_linked_photo_token text DEFAULT NULL::text, p_expires_at timestamp with time zone DEFAULT NULL::timestamp with time zone

json

Definer



get_late_bracket_info
p_late_minutes integer, p_session_id uuid DEFAULT NULL::uuid

TABLE(bracket_name character varying, bracket_name_ar character varying, score_weight numeric, display_color character varying)

Invoker



get_late_score_weight
p_late_minutes integer, p_session_id uuid DEFAULT NULL::uuid

numeric

Invoker



get_my_student_id
–

uuid

Definer



get_unread_announcement_count
p_student_id uuid

integer

Definer



invalidate_qr_session
p_token uuid

boolean

Definer



is_admin
–

boolean

Definer



is_teacher
–

boolean

Definer



rls_auto_enable
–

event_trigger

Definer



update_announcement_timestamp
–

trigger	
Invoker



update_certificate_template_timestamp
–

trigger	
Invoker



update_excuse_request_updated_at
–

trigger	
Invoker



update_issued_certificate_timestamp
–

trigger	
Invoker



update_scoring_config_timestamp
–

trigger	
Invoker



update_updated_at_column
–

trigger	
Invoker



validate_excuse_request_session_day
–

trigger	
Invoker



validate_qr_token
p_token uuid, p_session_id uuid, p_attendance_date date

json

Definer

 " and "2-Database Triggers
Execute actions automatically when database events occur

Data
Event

schema

public

Search for a trigger

Table
Docs

New trigger

Name	Table	Function	Events	Orientation	Enabled	

aaa_enforce_can_host_on_status_change
enrollment
fn_enforce_can_host_on_status_change
BEFORE UPDATE
BEFORE INSERT
ROW



scoring_config_updated
scoring_config
update_scoring_config_timestamp
BEFORE UPDATE
ROW



trg_book_ref_same_course
course_book_reference
check_book_ref_same_course
BEFORE UPDATE
BEFORE INSERT
ROW



trg_certificate_template_updated
certificate_template
update_certificate_template_timestamp
BEFORE UPDATE
ROW



trg_issued_certificate_updated
issued_certificate
update_issued_certificate_timestamp
BEFORE UPDATE
ROW



trg_validate_excuse_request_session_day
excuse_request
validate_excuse_request_session_day
BEFORE UPDATE
BEFORE INSERT
ROW



trigger_excuse_request_updated_at
excuse_request
update_excuse_request_updated_at
BEFORE UPDATE
ROW



trigger_update_announcement_timestamp
announcement
update_announcement_timestamp
BEFORE UPDATE
ROW



update_admin_updated_at
admin
update_updated_at_column
BEFORE UPDATE
ROW



update_announcement_comment_updated_at
announcement_comment
update_updated_at_column
BEFORE UPDATE
ROW



update_attendance_updated_at
attendance
update_updated_at_column
BEFORE UPDATE
ROW



update_course_updated_at
course
update_updated_at_column
BEFORE UPDATE
ROW



update_enrollment_updated_at
enrollment
update_updated_at_column
BEFORE UPDATE
ROW



update_session_date_host_updated_at
session_date_host
update_updated_at_column
BEFORE UPDATE
ROW



update_session_recording_updated_at
session_recording
update_updated_at_column
BEFORE UPDATE
ROW



update_session_updated_at
session
update_updated_at_column
BEFORE UPDATE
ROW



update_student_updated_at
student
update_updated_at_column
BEFORE UPDATE
ROW



update_teacher_updated_at
teacher
update_updated_at_column
BEFORE UPDATE
ROW

 "and "3- Database Indexes
Improve query performance against your database
Docs
Index Advisor

schema

public

Search for an index

Create index
Table	Columns	Name	
admin

auth_user_id

admin_auth_user_id_key


View definition

admin

email

admin_email_key


View definition

admin

admin_id

admin_pkey


View definition

announcement_comment

comment_id

announcement_comment_pkey


View definition

announcement

announcement_id

announcement_pkey


View definition

announcement_reaction

announcement_id, student_id, emoji

announcement_reaction_announcement_id_student_id_emoji_key


View definition

announcement_reaction

reaction_id

announcement_reaction_pkey


View definition

announcement_read

announcement_id, student_id

announcement_read_announcement_id_student_id_key


View definition

announcement_read

read_id

announcement_read_pkey


View definition

attendance

enrollment_id, attendance_date

attendance_enrollment_date_unique


View definition

attendance

attendance_id

attendance_pkey


View definition

audit_log

audit_id

audit_log_pkey


View definition

certificate_template

template_id

certificate_template_pkey


View definition

course_book_reference

reference_id

course_book_reference_pkey


View definition

course

course_id

course_pkey


View definition

enrollment

enrollment_id

enrollment_pkey


View definition

enrollment

student_id, session_id

enrollment_student_id_session_id_key


View definition

enrollment

student_id, session_id

enrollment_student_session_unique


View definition

excuse_request

request_id

excuse_request_pkey


View definition

excuse_request

student_id, session_id, attendance_date

excuse_request_student_id_session_id_attendance_date_key


View definition

excuse_request

student_id, session_id, attendance_date

excuse_request_student_session_date_unique


View definition

feedback_question

id

feedback_question_pkey


View definition

feedback_template

id

feedback_template_pkey


View definition

announcement

category

idx_announcement_category


View definition

announcement_comment

announcement_id

idx_announcement_comment_announcement


View definition

announcement_comment

parent_comment_id

idx_announcement_comment_parent


View definition

announcement

course_id

idx_announcement_course


View definition

announcement

course_id, created_at

idx_announcement_course_created


View definition

announcement

created_at

idx_announcement_created_at


View definition

announcement

created_by

idx_announcement_created_by


View definition

announcement

is_pinned

idx_announcement_pinned


View definition

announcement

priority

idx_announcement_priority


View definition

announcement_reaction

announcement_id

idx_announcement_reaction_announcement


View definition

announcement_reaction

student_id

idx_announcement_reaction_student


View definition

announcement_read

student_id

idx_announcement_read_student


View definition

attendance

attendance_date, host_address

idx_attendance_date_address


View definition

attendance

host_address

idx_attendance_host_address


View definition

attendance

late_minutes

idx_attendance_late_minutes


View definition

attendance

session_id, attendance_date

idx_attendance_session_date


View definition

attendance

status, excuse_reason

idx_attendance_status_excuse


View definition

attendance

student_id, attendance_date

idx_attendance_student_date


View definition

attendance

student_id, session_id

idx_attendance_student_session


View definition

audit_log

changed_at

idx_audit_log_changed_at


View definition

audit_log

changed_by

idx_audit_log_changed_by


View definition

audit_log

deleted_at

idx_audit_log_deleted_at


View definition

audit_log

deleted_by

idx_audit_log_deleted_by


View definition

audit_log

operation

idx_audit_log_operation


View definition

audit_log

record_id

idx_audit_log_record


View definition

audit_log

table_name

idx_audit_log_table


View definition

audit_log

table_name, changed_at

idx_audit_log_table_changed


View definition

course_book_reference

parent_id

idx_book_ref_parent


View definition

course_book_reference

course_id

idx_course_book_reference_course_id


View definition

course_book_reference

course_id, start_page

idx_course_book_reference_pages


View definition

course

teacher_id

idx_course_teacher


View definition

enrollment

session_id

idx_enrollment_can_host


View definition

enrollment

session_id, can_host

idx_enrollment_session_canhost


View definition

enrollment

session_id, status

idx_enrollment_session_status


View definition

enrollment

session_id, student_id

idx_enrollment_session_student


View definition

excuse_request

attendance_date

idx_excuse_request_date


View definition

excuse_request

session_id

idx_excuse_request_session


View definition

excuse_request

session_id, attendance_date, status

idx_excuse_request_session_date_status


View definition

excuse_request

status

idx_excuse_request_status


View definition

excuse_request

student_id

idx_excuse_request_student


View definition

feedback_question

session_id, sort_order

idx_feedback_question_session


View definition

feedback_question

session_id, attendance_date

idx_feedback_question_session_date


View definition

feedback_question

session_id, attendance_date, question_text

idx_feedback_question_unique_per_date


View definition

issued_certificate

session_id

idx_issued_cert_session


View definition

issued_certificate

student_id

idx_issued_cert_student


View definition

issued_certificate

template_id

idx_issued_cert_template


View definition

issued_certificate

student_id, session_id

idx_issued_certificate_student_session


View definition

message

created_at

idx_message_created_at


View definition

message_reaction

message_id

idx_message_reaction_message


View definition

message

recipient_type, recipient_id

idx_message_recipient


View definition

message

recipient_type, recipient_id, created_at

idx_message_recipient_sorted


View definition

message

sender_type, sender_id

idx_message_sender


View definition

message

sender_type, sender_id, created_at

idx_message_sender_sorted


View definition

message_starred

message_id

idx_message_starred_message


View definition

message

parent_message_id

idx_message_thread


View definition

message

is_read

idx_message_unread


View definition

photo_checkin_sessions

session_id, attendance_date

idx_photo_checkin_session


View definition

photo_checkin_sessions

token

idx_photo_checkin_token


View definition

qr_sessions

expires_at

idx_qr_sessions_expires


View definition

qr_sessions

linked_photo_token

idx_qr_sessions_linked_photo_token


View definition

qr_sessions

session_id, attendance_date

idx_qr_sessions_session_date


View definition

qr_sessions

token

idx_qr_sessions_token


View definition

scoring_config

teacher_id

idx_scoring_config_teacher


View definition

session_book_coverage

session_id

idx_session_book_coverage_session


View definition

session

course_id, start_date

idx_session_course_start


View definition

session_date_host

attendance_date

idx_session_date_host_date


View definition

session

start_date, end_date

idx_session_dates


View definition

session_day_change

effective_date

idx_session_day_change_effective


View definition

session_day_change

session_id

idx_session_day_change_session


View definition

session

end_date

idx_session_end_date


View definition

session_feedback

session_id, attendance_date

idx_session_feedback_session_date


View definition

session_feedback

student_id

idx_session_feedback_student


View definition

session

learning_method

idx_session_learning_method


View definition

session_recording

session_id, attendance_date

idx_session_recording_primary_per_date


View definition

session_recording

session_id, attendance_date

idx_session_recording_session_date


View definition

session_recording

recording_visibility

idx_session_recording_visibility


View definition

session

teacher_id, start_date

idx_session_teacher_start


View definition

session_time_change

effective_date

idx_session_time_change_effective


View definition

session_time_change

session_id

idx_session_time_change_session


View definition

student

name

idx_student_name


View definition

student

specialization

idx_student_specialization


View definition

teacher_host_schedule

host_date

idx_teacher_host_schedule_host_date


View definition

teacher_host_schedule

session_id

idx_teacher_host_schedule_session_id


View definition

teacher_host_schedule

teacher_id

idx_teacher_host_schedule_teacher_id


View definition

teacher

name

idx_teacher_name


View definition

teacher

specialization

idx_teacher_specialization


View definition

issued_certificate

certificate_number

issued_certificate_certificate_number_key


View definition

issued_certificate

certificate_id

issued_certificate_pkey


View definition

issued_certificate

verification_code

issued_certificate_verification_code_key


View definition

message

message_id

message_pkey


View definition

message_reaction

message_id, reactor_type, reactor_id

message_reaction_message_id_reactor_type_reactor_id_key


View definition

message_reaction

reaction_id

message_reaction_pkey


View definition

message_starred

message_id, user_type, user_id

message_starred_message_id_user_type_user_id_key


View definition

message_starred

id

message_starred_pkey


View definition

photo_checkin_sessions

id

photo_checkin_sessions_pkey


View definition

photo_checkin_sessions

token

photo_checkin_sessions_token_key


View definition

qr_sessions

session_id, attendance_date, check_in_mode

qr_sessions_active_unique


View definition

qr_sessions

qr_session_id

qr_sessions_pkey


View definition

qr_sessions

token

qr_sessions_token_key


View definition

scoring_config

id

scoring_config_pkey


View definition

session_book_coverage

coverage_id

session_book_coverage_pkey


View definition

session_book_coverage

session_id, attendance_date

session_book_coverage_session_id_attendance_date_key


View definition

session_date_host

id

session_date_host_pkey


View definition

session_date_host

session_id, attendance_date

session_date_host_session_id_attendance_date_key


View definition

session_day_change

change_id

session_day_change_pkey


View definition

session_day_change

session_id, effective_date

session_day_change_session_date_unique


View definition

session_feedback

id

session_feedback_pkey


View definition

session_feedback

session_id, attendance_date, student_id

session_feedback_session_id_attendance_date_student_id_key


View definition

session

session_id

session_pkey


View definition

session_recording

recording_id

session_recording_pkey


View definition

session_time_change

change_id

session_time_change_pkey


View definition

session_time_change

session_id, effective_date

session_time_change_session_date_unique


View definition

specialization

name

specialization_name_key


View definition

specialization

id

specialization_pkey


View definition

student

email

student_email_key


View definition

student

student_id

student_pkey


View definition

teacher

email

teacher_email_key


View definition

teacher_host_schedule

id

teacher_host_schedule_pkey


View definition

teacher_host_schedule

session_id, host_date

teacher_host_schedule_session_date_unique


View definition

teacher_host_schedule

teacher_id, session_id, host_date

teacher_host_schedule_teacher_id_session_id_host_date_key


View definition

teacher

teacher_id

teacher_pkey


View definition

scoring_config

teacher_id, is_default

unique_teacher_default


View definition

teacher_host_schedule

teacher_id, session_id

unique_teacher_session


View definition
 " and "4- Database Roles
Manage access control to your database through users, groups, and permissions
Search for a role
All roles
Active roles

Active connections

17/60


Add role
Roles managed by Supabase

Protected

anon

(ID: 16480)

0 connections


authenticated

(ID: 16481)

0 connections


authenticator

(ID: 16483)

11 connections


dashboard_user

(ID: 16601)

0 connections


pgbouncer

(ID: 16385)

0 connections


service_role

(ID: 16482)

0 connections


supabase_admin

(ID: 10)

5 connections


supabase_auth_admin

(ID: 16541)

0 connections


supabase_etl_admin

(ID: 16428)

0 connections


supabase_read_only_user

(ID: 16430)

0 connections


supabase_realtime_admin

(ID: 17366)

0 connections


supabase_replication_admin

(ID: 16427)

0 connections


supabase_storage_admin

(ID: 16596)

0 connections

Other database roles


postgres

(ID: 16384)

1 connections

 " and "Policies
Manage Row Level Security policies for your tables
Docs

schema

public

Filter tables and policies
admin

Disable RLS

Create policy

Name	Command	Applied to	Actions

Admin delete admin table
DELETE	
authenticated


Admin insert admin table
INSERT	
authenticated


Admin read admin table
SELECT	
authenticated


Admin update admin table
UPDATE	
authenticated

announcement

Disable RLS

Create policy

Name	Command	Applied to	Actions

Admin has full access
ALL	
authenticated


Students can read relevant announcements
SELECT	
authenticated


Teachers can manage their announcements
ALL	
authenticated

announcement_comment

Disable RLS

Create policy

Name	Command	Applied to	Actions

Admin has full access
ALL	
authenticated


Enable delete for own comments
DELETE	
authenticated


Enable insert for authenticated users
INSERT	
authenticated


Enable read for authenticated users
SELECT	
authenticated


Enable update for own comments
UPDATE	
authenticated

announcement_reaction

Disable RLS

Create policy

Name	Command	Applied to	Actions

Admin has full access
ALL	
authenticated


Enable delete for own reactions
DELETE	
authenticated


Enable insert for authenticated users
INSERT	
authenticated


Enable read for authenticated users
SELECT	
authenticated

announcement_read

Disable RLS

Create policy

Name	Command	Applied to	Actions

Admin has full access
ALL	
authenticated


Students can mark announcements as read
ALL	
authenticated


Teachers can view read status
SELECT	
authenticated

attendance

Disable RLS

Create policy

Name	Command	Applied to	Actions

Admin has full access
ALL	
authenticated


Students can insert own attendance
INSERT	
authenticated


Students can read own attendance
SELECT	
authenticated


Students can update own attendance
UPDATE	
authenticated


Teachers can insert
INSERT	
authenticated


Teachers can read
SELECT	
authenticated


Teachers can update
UPDATE	
authenticated

audit_log

Disable RLS

Create policy

Name	Command	Applied to	Actions

Admin has full access
ALL	
authenticated


Teachers can insert
INSERT	
authenticated


Teachers can read
SELECT	
authenticated

certificate_template

Disable RLS

Create policy

Name	Command	Applied to	Actions

Anyone can view active templates
SELECT	
authenticated


Teachers can manage templates
ALL	
authenticated

course

Disable RLS

Create policy

Name	Command	Applied to	Actions

Admin has full access
ALL	
authenticated


Students can read courses
SELECT	
authenticated


Teachers can insert
INSERT	
authenticated


Teachers can read
SELECT	
authenticated


Teachers can update
UPDATE	
authenticated

course_book_reference

Disable RLS

Create policy

Name	Command	Applied to	Actions

Admin has full access
ALL	
authenticated


Students can read book references
SELECT	
authenticated


Teachers can delete book references
DELETE	
authenticated


Teachers can insert
INSERT	
authenticated


Teachers can read
SELECT	
authenticated


Teachers can update book references
UPDATE	
authenticated

enrollment

Disable RLS

Create policy

Name	Command	Applied to	Actions

Admin has full access
ALL	
authenticated


Students can read own enrollments
SELECT	
authenticated


Teachers can insert
INSERT	
authenticated


Teachers can read
SELECT	
authenticated


Teachers can update enrollment
UPDATE	
authenticated

excuse_request

Disable RLS

Create policy

Name	Command	Applied to	Actions

Admins have full access to excuse requests
ALL	
authenticated


Students can cancel own pending requests
UPDATE	
authenticated


Students can create own excuse requests
INSERT	
authenticated


Students can view own excuse requests
SELECT	
authenticated


Teachers can review excuse requests
UPDATE	
authenticated


Teachers can view excuse requests for their sessions
SELECT	
authenticated

feedback_question

Disable RLS

Create policy

Name	Command	Applied to	Actions

Anyone can read feedback questions
SELECT	
authenticated


Teachers and admins can manage feedback questions
ALL	
authenticated


Teachers can manage own session feedback questions
ALL	
authenticated

feedback_template

Disable RLS

Create policy

Name	Command	Applied to	Actions

Anyone can read feedback templates
SELECT	
authenticated


Teachers and admins can manage feedback templates
ALL	
authenticated

issued_certificate

Disable RLS

Create policy

Name	Command	Applied to	Actions

Students view own certificates
SELECT	
authenticated


Teachers manage certificates
ALL	
authenticated


Teachers view all certificates
SELECT	
authenticated

message

Disable RLS

Create policy

Name	Command	Applied to	Actions

Admin has full access
ALL	
authenticated


Recipients can update message read status
UPDATE	
authenticated


Students can send messages
INSERT	
authenticated


Teachers can send messages
INSERT	
authenticated


Users can delete their messages
DELETE	
authenticated


Users can view their messages
SELECT	
authenticated

message_reaction

Disable RLS

Create policy

Name	Command	Applied to	Actions

Admin has full access
ALL	
authenticated


Enable delete for own reactions
DELETE	
authenticated


Enable insert for authenticated users
INSERT	
authenticated


Enable read for authenticated users
SELECT	
authenticated

message_starred

Disable RLS

Create policy

Name	Command	Applied to	Actions

Admin has full access
ALL	
authenticated


Enable delete for own stars
DELETE	
authenticated


Enable insert for authenticated users
INSERT	
authenticated


Enable read for authenticated users
SELECT	
authenticated

photo_checkin_sessions

Disable RLS

Create policy

Name	Command	Applied to	Actions

Admin has full access
ALL	
authenticated


Students can read photo sessions
SELECT	
authenticated


Teachers can insert
INSERT	
authenticated


Teachers can read
SELECT	
authenticated

qr_sessions

Disable RLS

Create policy

Name	Command	Applied to	Actions

Admin has full access
ALL	
authenticated


Students can read QR sessions
SELECT	
authenticated


Teachers can insert
INSERT	
authenticated


Teachers can read
SELECT	
authenticated

scoring_config

Disable RLS

Create policy

Name	Command	Applied to	Actions

Authenticated read scoring_config
SELECT	
authenticated


Teacher and admin write scoring_config
ALL	
authenticated

session

Disable RLS

Create policy

Name	Command	Applied to	Actions

Admin has full access
ALL	
authenticated


Students can read sessions
SELECT	
authenticated


Teachers can delete
DELETE	
authenticated


Teachers can insert
INSERT	
authenticated


Teachers can read
SELECT	
authenticated


Teachers can update
UPDATE	
authenticated

session_book_coverage

Disable RLS

Create policy

Name	Command	Applied to	Actions

Admin has full access
ALL	
authenticated


Students can read book coverage
SELECT	
authenticated


Teachers can delete book coverage
DELETE	
authenticated


Teachers can insert
INSERT	
authenticated


Teachers can read
SELECT	
authenticated


Teachers can update book coverage
UPDATE	
authenticated

session_date_host

Disable RLS

Create policy

Name	Command	Applied to	Actions

Admin has full access
ALL	
authenticated


Students can read session hosts
SELECT	
authenticated


Teachers can insert
INSERT	
authenticated


Teachers can read
SELECT	
authenticated


Teachers can update
UPDATE	
authenticated

session_day_change

Disable RLS

Create policy

Name	Command	Applied to	Actions

Admin has full access
ALL	
authenticated


Students can read day changes
SELECT	
authenticated


Teachers can delete day changes
DELETE	
authenticated


Teachers can insert
INSERT	
authenticated


Teachers can read
SELECT	
authenticated

session_feedback

Disable RLS

Create policy

Name	Command	Applied to	Actions

Students can read own feedback
SELECT	
authenticated


Students can submit feedback
INSERT	
authenticated


Teachers can delete session feedback
DELETE	
authenticated


Teachers can read own session feedback analytics
SELECT	
authenticated

session_recording

Disable RLS

Create policy

Name	Command	Applied to	Actions

Admins have full access to session recordings
ALL	
authenticated


Students can view session recordings
SELECT	
authenticated


Teachers have full access to session recordings
ALL	
authenticated

session_time_change

Disable RLS

Create policy

Name	Command	Applied to	Actions

Admin has full access
ALL	
authenticated


Students can read time changes
SELECT	
authenticated


Teachers can delete time changes
DELETE	
authenticated


Teachers can insert
INSERT	
authenticated


Teachers can read
SELECT	
authenticated

specialization

Disable RLS

Create policy

Name	Command	Applied to	Actions

Anyone can read specializations
SELECT	
authenticated


Teachers and admins can manage specializations
ALL	
authenticated

student

Disable RLS

Create policy

Name	Command	Applied to	Actions

Admin has full access
ALL	
authenticated


Students can read students
SELECT	
authenticated


Teachers can insert
INSERT	
authenticated


Teachers can read
SELECT	
authenticated


Teachers can update
UPDATE	
authenticated

teacher

Disable RLS

Create policy

Name	Command	Applied to	Actions

Admin has full access
ALL	
authenticated


Students can read teachers
SELECT	
authenticated


Teachers can insert
INSERT	
authenticated


Teachers can read
SELECT	
authenticated


Teachers can update
UPDATE	
authenticated

teacher_host_schedule

Disable RLS

Create policy

Name	Command	Applied to	Actions

Admin has full access
ALL	
authenticated


Students can read host schedule
SELECT	
authenticated


Teachers can delete host schedule
DELETE	
authenticated


Teachers can insert
INSERT	
authenticated


Teachers can read
SELECT	
authenticated


Teachers can update host schedule
UPDATE	
authenticated
 "