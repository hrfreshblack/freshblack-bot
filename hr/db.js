import pg from 'pg';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import pdfParse from 'pdf-parse';
import mammoth from 'mammoth';

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

// HRD = повний доступ до всього (аналог "адмін" у ERP виробництва).
// Recruiter — перша реально розмежована роль з ТЗ п.4: Vacancy Requests,
// Vacancies, Candidates, Interviews, Offers, Preboarding — без
// Compensation і приватних HR-нотаток. Решта ролей з ТЗ (Hiring Manager,
// Department Manager, Mentor/Buddy, Financial Manager, Custom Role)
// стосуються модулів, яких ще нема (employee self-service портал) —
// поле лишається розширюваним.
const ACCOUNT_ROLES = ['HRD', 'Recruiter', 'Manager', 'Employee'];
const SESSION_IDLE_MINUTES = 60;

const EMPLOYEE_STATUSES = [
  'Future Employee', 'Probation', 'Active', 'Part-time',
  'Maternity/Parental Leave', 'Suspended', 'Long Absence', 'Leaving', 'Former Employee'
];
const POSITION_STATUSES = ['Filled', 'Vacant', 'Recruitment Active', 'Planned', 'Frozen', 'Closed'];
const RESERVATION_STATUSES = ['Not Reserved', 'In Progress', 'Reserved', 'Expiring', 'Other'];

// Recruitment / ATS (ТЗ розділи 9-19)
const VACANCY_REQUEST_STATUSES = ['Draft', 'Pending Approval', 'Approved', 'Rejected', 'Converted to Vacancy', 'Cancelled'];
const VACANCY_STATUSES = ['Open', 'On Hold', 'Filled', 'Cancelled', 'Closed'];
const APPLICATION_STAGES = ['New Candidate', 'Screening', 'Interview', 'Test Task', 'Reference Check', 'Offer', 'Hired'];
const APPLICATION_STATUSES = ['Active', 'Rejected', 'Withdrawn', 'Hired'];
const REJECTION_REASONS_COMPANY = ['Недостатньо досвіду', 'Не підходить за компетенціями', 'Не пройшов тестове завдання', 'Завищені зарплатні очікування', 'Не підходить за soft skills', 'Вакансію закрито/заморожено', 'Інше'];
const REJECTION_REASONS_CANDIDATE = ['Прийняв іншу пропозицію', 'Не влаштовують умови', 'Не влаштовує зарплата', 'Змінив рішення щодо пошуку роботи', 'Не виходить на зв`язок', 'Інше'];
const OFFER_STATUSES = ['Draft', 'Sent', 'Accepted', 'Declined', 'Expired', 'Withdrawn'];
const INTERVIEW_TYPES = ['HR Screening', 'Technical/Professional', 'Final', 'Test Task Review', 'Reference Check'];
const INTERVIEW_STATUSES = ['Scheduled', 'Completed', 'Cancelled', 'No Show'];

// Onboarding / Adaptation (ТЗ розділи 20, 23, 23.1)
const ONBOARDING_MILESTONES = ['Day 1 / Week 1', '14 days', '30 days', '60 days', '90 days'];
const ONBOARDING_TASK_STATUSES = ['Not Started', 'In Progress', 'Waiting', 'Completed', 'Skipped'];
const ONBOARDING_TEMPLATE_SCOPES = ['Company', 'Department', 'Position'];
const PROBATION_DECISIONS = ['Passed', 'Extended', 'Failed'];

// Performance / 1:1 / OKR / KPI / PDP (ТЗ розділ 25)
const ONE_ON_ONE_STATUSES = ['Planned', 'Completed', 'Cancelled'];
const ACTION_ITEM_STATUSES = ['Open', 'Done'];
const PERFORMANCE_REVIEW_STATUSES = ['Draft', 'In Progress', 'Completed'];
const OKR_OWNER_TYPES = ['Company', 'Department', 'Individual'];
const OKR_OBJECTIVE_STATUSES = ['Draft', 'Active', 'Completed', 'Cancelled'];
const OKR_CONFIDENCE_LEVELS = ['On Track', 'At Risk', 'Off Track'];
const KPI_SOURCES = ['Manual', 'System'];
const KPI_STATUSES = ['Active', 'Completed', 'Cancelled'];
const PDP_ITEM_STATUSES = ['Not Started', 'In Progress', 'Completed', 'Cancelled'];

// Knowledge Base + Learning (ТЗ розділ 24)
const KB_CATEGORIES = ['About Fresh Black', 'Welcome', 'Rules', 'HR Policies', 'Departments', 'Products', 'Processes', 'Tools', 'Sales', 'Production', 'Finance', 'Templates', 'FAQ'];
const KB_AUDIENCE_TYPES = ['Company', 'Department', 'Position', 'Individual'];
const KB_ASSIGNMENT_STATUSES = ['Assigned', 'Acknowledged'];
const LEARNING_PATH_SCOPES = ['Department', 'Position'];
const LEARNING_ITEM_TYPES = ['Article', 'Task', 'Test'];
const LEARNING_ASSIGNMENT_STATUSES = ['Assigned', 'Started', 'Completed'];

// Surveys & Engagement (ТЗ розділ 26)
const SURVEY_TYPES = ['eNPS', 'Pulse', 'Adaptation', 'Exit', 'Custom'];
const SURVEY_STATUSES = ['Draft', 'Active', 'Closed'];
const SURVEY_QUESTION_TYPES = ['Scale', 'NPS', 'Single Select', 'Multi Select', 'Text'];

// HR Operations: absences (ТЗ розділ 27)
const ABSENCE_TYPES = ['Vacation', 'Sick Leave', 'Unpaid Leave', 'Business Trip', 'Remote', 'Other'];
const ABSENCE_STATUSES = ['Requested', 'Approved', 'Rejected', 'Cancelled'];

// Offboarding (ТЗ розділ 28, 28.1)
const OFFBOARDING_INITIATION_TYPES = ['Employee Initiative', 'Company Initiative', 'End of Contract', 'Probation Failed', 'Mutual Agreement', 'Other'];
const OFFBOARDING_STATUSES = ['Initiated', 'In Progress', 'Completed', 'Cancelled'];
const OFFBOARDING_CHECKLIST_CATEGORIES = ['Knowledge Transfer', 'Assets/Access'];
const OFFBOARDING_CHECKLIST_STATUSES = ['Pending', 'Done'];
const RECOMMEND_COMPANY_OPTIONS = ['Yes', 'No', 'Maybe'];

async function initSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS hr_accounts (
      username TEXT PRIMARY KEY,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL,
      display_name TEXT NOT NULL DEFAULT '',
      active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS hr_sessions (
      token TEXT PRIMARY KEY,
      username TEXT NOT NULL REFERENCES hr_accounts(username),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_hr_sessions_last_seen ON hr_sessions(last_seen_at);

    -- Organization Structure: департаменти з ієрархією (батьківський
    -- департамент — напр. "Виробництво" батько для "Обсмажка"/"Пакування").
    CREATE TABLE IF NOT EXISTS hr_departments (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      parent_department_id INTEGER REFERENCES hr_departments(id),
      planned_headcount INTEGER NOT NULL DEFAULT 0,
      active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_hr_departments_parent ON hr_departments(parent_department_id);
    -- ЦКП контуру/відділу — те саме, що purpose на позиції, але на рівні
    -- всього департаменту ("АДМІНІСТРАТИВНЕ ВІДДІЛЕННЯ: існує для того, щоб...").
    ALTER TABLE hr_departments ADD COLUMN IF NOT EXISTS purpose TEXT NOT NULL DEFAULT '';

    -- Position — конкретна штатна одиниця ("посадова одиниця"), а не просто
    -- назва посади: одна и та ж назва ("Продавець-консультант") — кілька
    -- рядків Position, якщо потрібно кілька одиниць. reports_to_position_id
    -- задає лінію підпорядкування для org chart незалежно від того, хто
    -- конкретно зараз цю посаду займає.
    CREATE TABLE IF NOT EXISTS hr_positions (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      department_id INTEGER NOT NULL REFERENCES hr_departments(id),
      reports_to_position_id INTEGER REFERENCES hr_positions(id),
      status TEXT NOT NULL DEFAULT 'Vacant',
      is_department_head BOOLEAN NOT NULL DEFAULT false,
      note TEXT NOT NULL DEFAULT '',
      active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_hr_positions_department ON hr_positions(department_id);
    CREATE INDEX IF NOT EXISTS idx_hr_positions_reports_to ON hr_positions(reports_to_position_id);
    -- ЦКП ролі (Ціннісний Кінцевий Продукт) — коротко, для чого ця посада
    -- взагалі існує, окремо від довільних приміток (note).
    ALTER TABLE hr_positions ADD COLUMN IF NOT EXISTS purpose TEXT NOT NULL DEFAULT '';

    -- Person = "one person — one master record" (ТЗ п.3). У Release 1 ще
    -- немає Candidate/Recruitment — Person тут завжди веде до одного
    -- Employee, але таблиця виділена окремо, щоб рекрутинг (коли дійде
    -- черга) міг додати Candidate-профіль до того самого Person без
    -- дублювання людини.
    CREATE TABLE IF NOT EXISTS hr_persons (
      id SERIAL PRIMARY KEY,
      full_name TEXT NOT NULL,
      birth_date DATE,
      gender TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL DEFAULT '',
      personal_email TEXT NOT NULL DEFAULT '',
      telegram TEXT NOT NULL DEFAULT '',
      city TEXT NOT NULL DEFAULT '',
      emergency_contact TEXT NOT NULL DEFAULT '',
      photo_url TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS hr_employees (
      id SERIAL PRIMARY KEY,
      person_id INTEGER NOT NULL UNIQUE REFERENCES hr_persons(id),
      employee_number TEXT UNIQUE,
      status TEXT NOT NULL DEFAULT 'Future Employee',
      corporate_email TEXT NOT NULL DEFAULT '',
      first_hire_date DATE,
      rehire_eligible BOOLEAN,
      -- Бронювання/військовий статус (ТЗ 21.3) — чутливе поле, окремо
      -- позначене в API/UI як restricted (field-level permission поки
      -- спрощено до ролі HRD, як і решта чутливих полів у цьому зрізі).
      reservation_applicable TEXT NOT NULL DEFAULT 'Not applicable',
      reservation_status TEXT NOT NULL DEFAULT '',
      reservation_start_date DATE,
      reservation_end_date DATE,
      reservation_comment TEXT NOT NULL DEFAULT '',
      reservation_document_url TEXT NOT NULL DEFAULT '',
      active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_hr_employees_status ON hr_employees(status);

    -- Employment Period: кожна зміна посади/департаменту/керівника —
    -- НОВИЙ рядок (закриває попередній end_date), а не перезапис (ТЗ п.3
    -- "No silent overwrites"). Це водночас і поточне працевлаштування
    -- (end_date IS NULL), і повна історія змін для вкладки Changes.
    CREATE TABLE IF NOT EXISTS hr_employment_periods (
      id SERIAL PRIMARY KEY,
      employee_id INTEGER NOT NULL REFERENCES hr_employees(id),
      position_id INTEGER NOT NULL REFERENCES hr_positions(id),
      department_id INTEGER NOT NULL REFERENCES hr_departments(id),
      manager_employee_id INTEGER REFERENCES hr_employees(id),
      start_date DATE NOT NULL,
      end_date DATE,
      employment_type TEXT NOT NULL DEFAULT '',
      employment_format TEXT NOT NULL DEFAULT '',
      location TEXT NOT NULL DEFAULT '',
      change_reason TEXT NOT NULL DEFAULT '',
      created_by TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_hr_employment_periods_employee ON hr_employment_periods(employee_id);
    CREATE INDEX IF NOT EXISTS idx_hr_employment_periods_current ON hr_employment_periods(employee_id) WHERE end_date IS NULL;

    -- Compensation: кожна зміна — окремий effective-dated запис, ніколи не
    -- перезаписується (ТЗ п.22).
    CREATE TABLE IF NOT EXISTS hr_compensation_records (
      id SERIAL PRIMARY KEY,
      employee_id INTEGER NOT NULL REFERENCES hr_employees(id),
      effective_from DATE NOT NULL,
      effective_to DATE,
      fixed_salary NUMERIC,
      currency TEXT NOT NULL DEFAULT 'UAH',
      bonus_type TEXT NOT NULL DEFAULT '',
      bonus_formula TEXT NOT NULL DEFAULT '',
      kpi_bonus TEXT NOT NULL DEFAULT '',
      additional_payments TEXT NOT NULL DEFAULT '',
      reason TEXT NOT NULL DEFAULT '',
      comment TEXT NOT NULL DEFAULT '',
      document_url TEXT NOT NULL DEFAULT '',
      created_by TEXT NOT NULL DEFAULT '',
      approved_by TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_hr_compensation_employee ON hr_compensation_records(employee_id);

    -- ==================== Recruitment / ATS (ТЗ розділи 9-19) ====================

    -- Vacancy Request: погодження потреби ще ДО того, як існує вакансія
    -- (ТЗ 9.1/9.2) — керівник ініціює, HRD фінально погоджує, потім
    -- окрема дія "Convert to Vacancy" (не автоматично на Approved).
    CREATE TABLE IF NOT EXISTS hr_vacancy_requests (
      id SERIAL PRIMARY KEY,
      position_title TEXT NOT NULL,
      department_id INTEGER NOT NULL REFERENCES hr_departments(id),
      hiring_manager_employee_id INTEGER REFERENCES hr_employees(id),
      request_reason TEXT NOT NULL DEFAULT '',
      quantity INTEGER NOT NULL DEFAULT 1,
      priority TEXT NOT NULL DEFAULT '',
      desired_start_date DATE,
      ideal_candidate_portrait TEXT NOT NULL DEFAULT '',
      responsibilities TEXT NOT NULL DEFAULT '',
      skills_professional TEXT NOT NULL DEFAULT '',
      skills_technical TEXT NOT NULL DEFAULT '',
      skills_additional TEXT NOT NULL DEFAULT '',
      product_knowledge TEXT NOT NULL DEFAULT '',
      personal_qualities_required TEXT NOT NULL DEFAULT '',
      personal_qualities_desired TEXT NOT NULL DEFAULT '',
      compensation_trial TEXT NOT NULL DEFAULT '',
      compensation_probation TEXT NOT NULL DEFAULT '',
      compensation_after_probation TEXT NOT NULL DEFAULT '',
      compensation_bonus_formula TEXT NOT NULL DEFAULT '',
      probation_goals TEXT NOT NULL DEFAULT '',
      career_growth TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'Draft',
      status_note TEXT NOT NULL DEFAULT '',
      created_by TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_hr_vacancy_requests_status ON hr_vacancy_requests(status);

    -- Довільні файли, прикріплені до заявки на вакансію (опис вакансії,
    -- узгоджений ТЗ на пошук тощо) — той самий підхід, що й резюме
    -- кандидата: файл у базі (BYTEA), диск на Railway ефемерний, append-only.
    CREATE TABLE IF NOT EXISTS hr_vacancy_request_attachments (
      id SERIAL PRIMARY KEY,
      vacancy_request_id INTEGER NOT NULL REFERENCES hr_vacancy_requests(id),
      filename TEXT NOT NULL,
      mime_type TEXT NOT NULL DEFAULT '',
      file_size INTEGER NOT NULL DEFAULT 0,
      file_data BYTEA NOT NULL,
      uploaded_by TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_hr_vr_attachments_request ON hr_vacancy_request_attachments(vacancy_request_id);

    CREATE TABLE IF NOT EXISTS hr_vacancies (
      id SERIAL PRIMARY KEY,
      vacancy_request_id INTEGER REFERENCES hr_vacancy_requests(id),
      position_id INTEGER REFERENCES hr_positions(id),
      department_id INTEGER NOT NULL REFERENCES hr_departments(id),
      hiring_manager_employee_id INTEGER REFERENCES hr_employees(id),
      recruiter_username TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'Open',
      priority TEXT NOT NULL DEFAULT '',
      target_date DATE,
      profile_snapshot TEXT NOT NULL DEFAULT '',
      override_reason TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_hr_vacancies_status ON hr_vacancies(status);

    -- Candidate = hr_persons профіль + рекрутингові поля (ТЗ п.3 "one
    -- person — one master record", п.10 Candidate/Application). Той самий
    -- person_id пізніше стає hr_employees при Offer Accepted — не
    -- дублюється.
    CREATE TABLE IF NOT EXISTS hr_candidates (
      id SERIAL PRIMARY KEY,
      person_id INTEGER NOT NULL UNIQUE REFERENCES hr_persons(id),
      current_job_title TEXT NOT NULL DEFAULT '',
      desired_role TEXT NOT NULL DEFAULT '',
      desired_salary TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT '',
      owner_recruiter TEXT NOT NULL DEFAULT '',
      resume_url TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      talent_pool_segment TEXT NOT NULL DEFAULT '',
      talent_pool_category TEXT NOT NULL DEFAULT '',
      talent_pool_next_contact DATE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- Application: Candidate ↔ Vacancy (не сам Candidate — той самий
    -- кандидат може мати кілька заявок одночасно, ТЗ п.10).
    CREATE TABLE IF NOT EXISTS hr_applications (
      id SERIAL PRIMARY KEY,
      candidate_id INTEGER NOT NULL REFERENCES hr_candidates(id),
      vacancy_id INTEGER NOT NULL REFERENCES hr_vacancies(id),
      stage TEXT NOT NULL DEFAULT 'New Candidate',
      status TEXT NOT NULL DEFAULT 'Active',
      rejection_reason TEXT NOT NULL DEFAULT '',
      rejection_comment TEXT NOT NULL DEFAULT '',
      applied_date DATE NOT NULL DEFAULT CURRENT_DATE,
      next_action TEXT NOT NULL DEFAULT '',
      next_action_date DATE,
      created_by TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (candidate_id, vacancy_id)
    );
    CREATE INDEX IF NOT EXISTS idx_hr_applications_vacancy ON hr_applications(vacancy_id);
    CREATE INDEX IF NOT EXISTS idx_hr_applications_candidate ON hr_applications(candidate_id);

    -- Interview: спрощено на цьому зрізі — дата/тип/нотатки/рішення, без
    -- формального зваженого scorecard-шаблону (ТЗ п.16 Scorecard templates
    -- — наступний крок) і без Google Calendar sync.
    CREATE TABLE IF NOT EXISTS hr_interviews (
      id SERIAL PRIMARY KEY,
      application_id INTEGER NOT NULL REFERENCES hr_applications(id),
      interview_type TEXT NOT NULL DEFAULT '',
      scheduled_at TIMESTAMPTZ,
      participants TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'Scheduled',
      notes TEXT NOT NULL DEFAULT '',
      decision TEXT NOT NULL DEFAULT '',
      created_by TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_hr_interviews_application ON hr_interviews(application_id);

    -- Offer: Accepted створює Future Employee РІВНО ОДИН РАЗ (employee_id
    -- фіксує це — ТЗ п.37 idempotent).
    CREATE TABLE IF NOT EXISTS hr_offers (
      id SERIAL PRIMARY KEY,
      application_id INTEGER NOT NULL REFERENCES hr_applications(id),
      fixed_salary NUMERIC,
      currency TEXT NOT NULL DEFAULT 'UAH',
      bonus_formula TEXT NOT NULL DEFAULT '',
      kpi_bonus TEXT NOT NULL DEFAULT '',
      start_date DATE,
      probation_goals TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'Draft',
      acceptance_deadline DATE,
      employee_id INTEGER REFERENCES hr_employees(id),
      created_by TEXT NOT NULL DEFAULT '',
      approved_by TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_hr_offers_application ON hr_offers(application_id);

    -- Probation control (ТЗ 23.1) — поля на hr_employees, а не окрема
    -- таблиця: один активний випробувальний період на співробітника,
    -- продовження просто зсуває end_date з причиною (не окрема історія).
    ALTER TABLE hr_employees ADD COLUMN IF NOT EXISTS probation_period_days INTEGER NOT NULL DEFAULT 90;
    ALTER TABLE hr_employees ADD COLUMN IF NOT EXISTS probation_end_date DATE;
    ALTER TABLE hr_employees ADD COLUMN IF NOT EXISTS probation_goals TEXT NOT NULL DEFAULT '';
    ALTER TABLE hr_employees ADD COLUMN IF NOT EXISTS probation_decision TEXT NOT NULL DEFAULT '';
    ALTER TABLE hr_employees ADD COLUMN IF NOT EXISTS probation_decision_date DATE;
    ALTER TABLE hr_employees ADD COLUMN IF NOT EXISTS probation_decision_reason TEXT NOT NULL DEFAULT '';

    -- ==================== Onboarding / Adaptation (ТЗ 20, 23, 23.1) ====================

    -- Бібліотека шаблонів завдань — компанія в цілому, або конкретний
    -- департамент/посада (ТЗ 24 "Position automation": посада може мати
    -- прив'язаний Adaptation Template).
    CREATE TABLE IF NOT EXISTS hr_onboarding_templates (
      id SERIAL PRIMARY KEY,
      scope TEXT NOT NULL DEFAULT 'Company',
      department_id INTEGER REFERENCES hr_departments(id),
      position_id INTEGER REFERENCES hr_positions(id),
      milestone TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      owner_role TEXT NOT NULL DEFAULT '',
      due_offset_days INTEGER NOT NULL DEFAULT 0,
      required BOOLEAN NOT NULL DEFAULT true,
      active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_hr_onb_templates_scope ON hr_onboarding_templates(scope, department_id, position_id);

    -- Задачі конкретного співробітника — згенеровані з шаблонів
    -- (generateOnboardingTasks, ідемпотентно за template_id) або ad-hoc.
    CREATE TABLE IF NOT EXISTS hr_onboarding_tasks (
      id SERIAL PRIMARY KEY,
      employee_id INTEGER NOT NULL REFERENCES hr_employees(id),
      template_id INTEGER REFERENCES hr_onboarding_templates(id),
      milestone TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      owner_role TEXT NOT NULL DEFAULT '',
      due_date DATE,
      required BOOLEAN NOT NULL DEFAULT true,
      status TEXT NOT NULL DEFAULT 'Not Started',
      evidence_url TEXT NOT NULL DEFAULT '',
      comment TEXT NOT NULL DEFAULT '',
      skip_reason TEXT NOT NULL DEFAULT '',
      completed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_hr_onb_tasks_employee ON hr_onboarding_tasks(employee_id);

    -- Preboarding — одна картка на співробітника (ТЗ 20 Welcome Letter
    -- Generator: текст лишається editable, тому зберігаємо саме текст, а
    -- не тільки вхідні поля).
    CREATE TABLE IF NOT EXISTS hr_preboarding_info (
      employee_id INTEGER PRIMARY KEY REFERENCES hr_employees(id),
      workplace_location TEXT NOT NULL DEFAULT '',
      hr_contact TEXT NOT NULL DEFAULT '',
      documents_to_bring TEXT NOT NULL DEFAULT '',
      first_day_agenda TEXT NOT NULL DEFAULT '',
      welcome_letter_text TEXT NOT NULL DEFAULT '',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- ==================== Performance / 1:1 / OKR / KPI / PDP (ТЗ 25) ====================

    -- 1:1 (ТЗ 25.1) — shared_notes бачить і співробітник, private_notes
    -- лишається лише керівнику/HR (розділення приватності з ТЗ).
    CREATE TABLE IF NOT EXISTS hr_one_on_ones (
      id SERIAL PRIMARY KEY,
      employee_id INTEGER NOT NULL REFERENCES hr_employees(id),
      manager_employee_id INTEGER REFERENCES hr_employees(id),
      meeting_date DATE NOT NULL DEFAULT CURRENT_DATE,
      cadence TEXT NOT NULL DEFAULT '',
      shared_notes TEXT NOT NULL DEFAULT '',
      private_notes TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'Planned',
      created_by TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_hr_1on1_employee ON hr_one_on_ones(employee_id);

    CREATE TABLE IF NOT EXISTS hr_one_on_one_actions (
      id SERIAL PRIMARY KEY,
      one_on_one_id INTEGER NOT NULL REFERENCES hr_one_on_ones(id),
      title TEXT NOT NULL,
      owner_username TEXT NOT NULL DEFAULT '',
      due_date DATE,
      status TEXT NOT NULL DEFAULT 'Open',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_hr_1on1_actions_meeting ON hr_one_on_one_actions(one_on_one_id);

    -- Performance Review (ТЗ 25.2) — кожен період окремий запис, історія
    -- зберігається (не перезаписується).
    CREATE TABLE IF NOT EXISTS hr_performance_reviews (
      id SERIAL PRIMARY KEY,
      employee_id INTEGER NOT NULL REFERENCES hr_employees(id),
      period_label TEXT NOT NULL DEFAULT '',
      period_start DATE,
      period_end DATE,
      goals_results TEXT NOT NULL DEFAULT '',
      competencies_notes TEXT NOT NULL DEFAULT '',
      manager_feedback TEXT NOT NULL DEFAULT '',
      employee_self_review TEXT NOT NULL DEFAULT '',
      hr_comments TEXT NOT NULL DEFAULT '',
      final_outcome TEXT NOT NULL DEFAULT '',
      development_actions TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'Draft',
      created_by TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_hr_perf_reviews_employee ON hr_performance_reviews(employee_id);

    -- OKR (ТЗ 25.3) — Objective може бути Company/Department/Individual;
    -- parent_objective_id дозволяє roll-up вирівнювання.
    CREATE TABLE IF NOT EXISTS hr_okr_objectives (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      owner_type TEXT NOT NULL DEFAULT 'Individual',
      owner_department_id INTEGER REFERENCES hr_departments(id),
      owner_employee_id INTEGER REFERENCES hr_employees(id),
      parent_objective_id INTEGER REFERENCES hr_okr_objectives(id),
      period TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'Draft',
      created_by TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_hr_okr_owner ON hr_okr_objectives(owner_type, owner_department_id, owner_employee_id);

    CREATE TABLE IF NOT EXISTS hr_okr_key_results (
      id SERIAL PRIMARY KEY,
      objective_id INTEGER NOT NULL REFERENCES hr_okr_objectives(id),
      title TEXT NOT NULL,
      metric_unit TEXT NOT NULL DEFAULT '',
      start_value NUMERIC NOT NULL DEFAULT 0,
      target_value NUMERIC NOT NULL DEFAULT 0,
      current_value NUMERIC NOT NULL DEFAULT 0,
      confidence TEXT NOT NULL DEFAULT 'On Track',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_hr_okr_kr_objective ON hr_okr_key_results(objective_id);

    CREATE TABLE IF NOT EXISTS hr_okr_checkins (
      id SERIAL PRIMARY KEY,
      key_result_id INTEGER NOT NULL REFERENCES hr_okr_key_results(id),
      value NUMERIC NOT NULL,
      comment TEXT NOT NULL DEFAULT '',
      created_by TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_hr_okr_checkins_kr ON hr_okr_checkins(key_result_id);

    -- KPI (ТЗ 25.4) — шаблони по посаді + фактичні KPI співробітника,
    -- ізольовано скопійовані (не reference), щоб зміна шаблону не ламала
    -- вже призначені KPI.
    CREATE TABLE IF NOT EXISTS hr_kpi_templates (
      id SERIAL PRIMARY KEY,
      position_id INTEGER NOT NULL REFERENCES hr_positions(id),
      name TEXT NOT NULL,
      metric TEXT NOT NULL DEFAULT '',
      target NUMERIC,
      weight NUMERIC,
      active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_hr_kpi_templates_position ON hr_kpi_templates(position_id);

    CREATE TABLE IF NOT EXISTS hr_kpis (
      id SERIAL PRIMARY KEY,
      employee_id INTEGER NOT NULL REFERENCES hr_employees(id),
      template_id INTEGER REFERENCES hr_kpi_templates(id),
      name TEXT NOT NULL,
      metric TEXT NOT NULL DEFAULT '',
      target NUMERIC,
      weight NUMERIC,
      period TEXT NOT NULL DEFAULT '',
      actual NUMERIC,
      source TEXT NOT NULL DEFAULT 'Manual',
      comment TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'Active',
      created_by TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_hr_kpis_employee ON hr_kpis(employee_id);

    -- Development Plan / PDP (ТЗ 25.5)
    CREATE TABLE IF NOT EXISTS hr_development_plan_items (
      id SERIAL PRIMARY KEY,
      employee_id INTEGER NOT NULL REFERENCES hr_employees(id),
      goal TEXT NOT NULL,
      skill_competency TEXT NOT NULL DEFAULT '',
      action TEXT NOT NULL DEFAULT '',
      learning_item TEXT NOT NULL DEFAULT '',
      owner_username TEXT NOT NULL DEFAULT '',
      due_date DATE,
      success_criteria TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'Not Started',
      review_date DATE,
      created_by TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_hr_pdp_employee ON hr_development_plan_items(employee_id);

    -- ==================== Knowledge Base + Learning (ТЗ 24) ====================

    CREATE TABLE IF NOT EXISTS hr_kb_articles (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL DEFAULT '',
      video_url TEXT NOT NULL DEFAULT '',
      file_url TEXT NOT NULL DEFAULT '',
      link_url TEXT NOT NULL DEFAULT '',
      owner_username TEXT NOT NULL DEFAULT '',
      version INTEGER NOT NULL DEFAULT 1,
      audience_type TEXT NOT NULL DEFAULT 'Company',
      audience_department_id INTEGER REFERENCES hr_departments(id),
      audience_position_id INTEGER REFERENCES hr_positions(id),
      mandatory BOOLEAN NOT NULL DEFAULT false,
      active BOOLEAN NOT NULL DEFAULT true,
      created_by TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_hr_kb_articles_category ON hr_kb_articles(category);
    CREATE INDEX IF NOT EXISTS idx_hr_kb_articles_audience ON hr_kb_articles(audience_type, audience_department_id, audience_position_id);

    -- Mandatory reading assignment + acknowledgement (ТЗ 24: "store user,
    -- document version, date/time"). acknowledged_version фіксує версію
    -- статті на момент підтвердження — якщо статтю потім оновили, видно,
    -- що людина читала стару версію.
    CREATE TABLE IF NOT EXISTS hr_kb_assignments (
      id SERIAL PRIMARY KEY,
      article_id INTEGER NOT NULL REFERENCES hr_kb_articles(id),
      employee_id INTEGER NOT NULL REFERENCES hr_employees(id),
      due_date DATE,
      status TEXT NOT NULL DEFAULT 'Assigned',
      acknowledged_at TIMESTAMPTZ,
      acknowledged_version INTEGER,
      created_by TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (article_id, employee_id)
    );
    CREATE INDEX IF NOT EXISTS idx_hr_kb_assignments_employee ON hr_kb_assignments(employee_id);

    -- Learning Path: впорядковані матеріали/задачі/тести під конкретну
    -- посаду або департамент (ТЗ 24 "Position automation").
    CREATE TABLE IF NOT EXISTS hr_learning_paths (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      scope TEXT NOT NULL DEFAULT 'Position',
      department_id INTEGER REFERENCES hr_departments(id),
      position_id INTEGER REFERENCES hr_positions(id),
      active BOOLEAN NOT NULL DEFAULT true,
      created_by TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_hr_learning_paths_scope ON hr_learning_paths(scope, department_id, position_id);

    CREATE TABLE IF NOT EXISTS hr_learning_path_items (
      id SERIAL PRIMARY KEY,
      learning_path_id INTEGER NOT NULL REFERENCES hr_learning_paths(id),
      order_index INTEGER NOT NULL DEFAULT 0,
      title TEXT NOT NULL,
      item_type TEXT NOT NULL DEFAULT 'Article',
      kb_article_id INTEGER REFERENCES hr_kb_articles(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_hr_learning_items_path ON hr_learning_path_items(learning_path_id);

    CREATE TABLE IF NOT EXISTS hr_learning_assignments (
      id SERIAL PRIMARY KEY,
      learning_path_id INTEGER NOT NULL REFERENCES hr_learning_paths(id),
      employee_id INTEGER NOT NULL REFERENCES hr_employees(id),
      status TEXT NOT NULL DEFAULT 'Assigned',
      test_result TEXT NOT NULL DEFAULT '',
      started_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ,
      created_by TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (learning_path_id, employee_id)
    );
    CREATE INDEX IF NOT EXISTS idx_hr_learning_assignments_employee ON hr_learning_assignments(employee_id);

    CREATE TABLE IF NOT EXISTS hr_learning_item_progress (
      id SERIAL PRIMARY KEY,
      assignment_id INTEGER NOT NULL REFERENCES hr_learning_assignments(id),
      item_id INTEGER NOT NULL REFERENCES hr_learning_path_items(id),
      completed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (assignment_id, item_id)
    );

    -- ==================== Surveys & Engagement (ТЗ 26) ====================

    -- linked_employee_id — для Adaptation/Exit опитувань, прив'язаних до
    -- конкретного співробітника (ТЗ 26 "Linked to employee adaptation" /
    -- "Linked to offboarding"); NULL для company-wide eNPS/Pulse/Custom.
    CREATE TABLE IF NOT EXISTS hr_surveys (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'Custom',
      anonymous BOOLEAN NOT NULL DEFAULT false,
      status TEXT NOT NULL DEFAULT 'Draft',
      linked_employee_id INTEGER REFERENCES hr_employees(id),
      created_by TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_hr_surveys_type ON hr_surveys(type);

    CREATE TABLE IF NOT EXISTS hr_survey_questions (
      id SERIAL PRIMARY KEY,
      survey_id INTEGER NOT NULL REFERENCES hr_surveys(id),
      order_index INTEGER NOT NULL DEFAULT 0,
      question_text TEXT NOT NULL,
      question_type TEXT NOT NULL DEFAULT 'Text',
      options JSONB NOT NULL DEFAULT '[]',
      required BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_hr_survey_questions_survey ON hr_survey_questions(survey_id);

    -- Хто запрошений — основа для response rate (відповіді / запрошення).
    CREATE TABLE IF NOT EXISTS hr_survey_invitations (
      id SERIAL PRIMARY KEY,
      survey_id INTEGER NOT NULL REFERENCES hr_surveys(id),
      employee_id INTEGER NOT NULL REFERENCES hr_employees(id),
      invited_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (survey_id, employee_id)
    );
    CREATE INDEX IF NOT EXISTS idx_hr_survey_invitations_survey ON hr_survey_invitations(survey_id);

    -- Одна відповідь на опитування на співробітника. employee_id
    -- зберігається завжди (для response rate), але UI для anonymous
    -- опитувань не показує, хто саме що відповів (ТЗ 26 "Avoid exposing
    -- individuals in anonymous surveys").
    CREATE TABLE IF NOT EXISTS hr_survey_responses (
      id SERIAL PRIMARY KEY,
      survey_id INTEGER NOT NULL REFERENCES hr_surveys(id),
      employee_id INTEGER NOT NULL REFERENCES hr_employees(id),
      submitted_by TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (survey_id, employee_id)
    );
    CREATE INDEX IF NOT EXISTS idx_hr_survey_responses_survey ON hr_survey_responses(survey_id);

    CREATE TABLE IF NOT EXISTS hr_survey_answers (
      id SERIAL PRIMARY KEY,
      response_id INTEGER NOT NULL REFERENCES hr_survey_responses(id),
      question_id INTEGER NOT NULL REFERENCES hr_survey_questions(id),
      answer_text TEXT NOT NULL DEFAULT '',
      answer_value NUMERIC,
      answer_options JSONB NOT NULL DEFAULT '[]',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_hr_survey_answers_response ON hr_survey_answers(response_id);

    -- ==================== HR Operations: absences (ТЗ 27) ====================

    CREATE TABLE IF NOT EXISTS hr_absences (
      id SERIAL PRIMARY KEY,
      employee_id INTEGER NOT NULL REFERENCES hr_employees(id),
      type TEXT NOT NULL DEFAULT 'Vacation',
      start_date DATE NOT NULL,
      end_date DATE NOT NULL,
      workdays INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'Requested',
      comment TEXT NOT NULL DEFAULT '',
      document_url TEXT NOT NULL DEFAULT '',
      approver_username TEXT NOT NULL DEFAULT '',
      created_by TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_hr_absences_employee ON hr_absences(employee_id);
    CREATE INDEX IF NOT EXISTS idx_hr_absences_dates ON hr_absences(start_date, end_date);

    -- ==================== Offboarding (ТЗ 28, 28.1) ====================

    CREATE TABLE IF NOT EXISTS hr_offboarding_cases (
      id SERIAL PRIMARY KEY,
      employee_id INTEGER NOT NULL REFERENCES hr_employees(id),
      initiation_type TEXT NOT NULL DEFAULT 'Employee Initiative',
      initiation_date DATE NOT NULL DEFAULT CURRENT_DATE,
      last_working_day DATE,
      statement_text TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'Initiated',
      created_by TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      completed_at TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS idx_hr_offboarding_employee ON hr_offboarding_cases(employee_id);

    CREATE TABLE IF NOT EXISTS hr_offboarding_checklist_items (
      id SERIAL PRIMARY KEY,
      case_id INTEGER NOT NULL REFERENCES hr_offboarding_cases(id),
      category TEXT NOT NULL DEFAULT 'Knowledge Transfer',
      title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'Pending',
      completed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_hr_offboarding_checklist_case ON hr_offboarding_checklist_items(case_id);

    -- Одне exit interview на case (ТЗ 28.1).
    CREATE TABLE IF NOT EXISTS hr_exit_interviews (
      id SERIAL PRIMARY KEY,
      case_id INTEGER NOT NULL UNIQUE REFERENCES hr_offboarding_cases(id),
      primary_reason TEXT NOT NULL DEFAULT '',
      secondary_reasons TEXT NOT NULL DEFAULT '',
      good_notes TEXT NOT NULL DEFAULT '',
      bad_notes TEXT NOT NULL DEFAULT '',
      manager_notes TEXT NOT NULL DEFAULT '',
      team_notes TEXT NOT NULL DEFAULT '',
      conditions_notes TEXT NOT NULL DEFAULT '',
      compensation_notes TEXT NOT NULL DEFAULT '',
      growth_notes TEXT NOT NULL DEFAULT '',
      processes_notes TEXT NOT NULL DEFAULT '',
      what_could_retain TEXT NOT NULL DEFAULT '',
      recommend_company TEXT NOT NULL DEFAULT '',
      rehire_eligible BOOLEAN,
      comments TEXT NOT NULL DEFAULT '',
      created_by TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- Резюме — прив'язані до кандидата файли (ТЗ 11 "Resume Upload &
    -- Parsing"). Зберігаємо сам файл у базі (BYTEA), бо диск на Railway
    -- ефемерний і зникає при редеплої. Append-only: новий аплоад — новий
    -- рядок, історія не втрачається.
    CREATE TABLE IF NOT EXISTS hr_candidate_resumes (
      id SERIAL PRIMARY KEY,
      candidate_id INTEGER NOT NULL REFERENCES hr_candidates(id),
      filename TEXT NOT NULL,
      mime_type TEXT NOT NULL DEFAULT '',
      file_size INTEGER NOT NULL DEFAULT 0,
      file_data BYTEA NOT NULL,
      extracted_text TEXT NOT NULL DEFAULT '',
      parse_status TEXT NOT NULL DEFAULT 'ok',
      uploaded_by TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_hr_candidate_resumes_candidate ON hr_candidate_resumes(candidate_id);

    -- Audit Log: хто/що/коли для чутливих змін (статус, компенсація,
    -- працевлаштування) — ТЗ п.3 Auditability і п.39 Audit.
    CREATE TABLE IF NOT EXISTS hr_audit_log (
      id SERIAL PRIMARY KEY,
      actor TEXT NOT NULL DEFAULT '',
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id INTEGER,
      old_value JSONB,
      new_value JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_hr_audit_entity ON hr_audit_log(entity_type, entity_id);
    CREATE INDEX IF NOT EXISTS idx_hr_audit_created ON hr_audit_log(created_at);
  `);
}

// ---------------------------------------------------------------------
// Auth (той самий підхід, що й у warehouse/db.js — окремі акаунти/сесії,
// бо HR CRM і ERP свідомо різні backend-сервіси на цьому етапі; ТЗ п.5
// прямо допускає "SSO-ready", не вимагає єдиного логіна вже в Release 1).
// ---------------------------------------------------------------------

async function createAccountIfMissingWithHash({ username, password_hash, role, display_name }) {
  if (!ACCOUNT_ROLES.includes(role)) {
    throw new Error(`Unknown role: ${role}`);
  }
  const { rowCount } = await pool.query(
    `INSERT INTO hr_accounts (username, password_hash, role, display_name)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (username) DO NOTHING`,
    [username, password_hash, role, display_name || '']
  );
  return rowCount;
}

async function findAccountByUsername(username) {
  const { rows } = await pool.query('SELECT * FROM hr_accounts WHERE username = $1 AND active = true', [username]);
  return rows[0] || null;
}

async function verifyAccountPassword(account, password) {
  return bcrypt.compare(password, account.password_hash);
}

async function createSession(username) {
  const token = crypto.randomBytes(32).toString('hex');
  await pool.query('INSERT INTO hr_sessions (token, username) VALUES ($1, $2)', [token, username]);
  return token;
}

async function touchSession(token) {
  const { rows } = await pool.query(
    `UPDATE hr_sessions SET last_seen_at = now()
     WHERE token = $1 AND last_seen_at > now() - interval '${SESSION_IDLE_MINUTES} minutes'
     RETURNING username`,
    [token]
  );
  return rows[0]?.username || null;
}

async function deleteSession(token) {
  await pool.query('DELETE FROM hr_sessions WHERE token = $1', [token]);
}

async function cleanupExpiredSessions() {
  const { rowCount } = await pool.query(
    `DELETE FROM hr_sessions WHERE last_seen_at < now() - interval '${SESSION_IDLE_MINUTES} minutes'`
  );
  return rowCount;
}

// ---------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------

async function writeAudit({ actor, action, entity_type, entity_id, old_value, new_value }) {
  await pool.query(
    `INSERT INTO hr_audit_log (actor, action, entity_type, entity_id, old_value, new_value)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [actor || '', action, entity_type, entity_id ?? null, old_value ? JSON.stringify(old_value) : null, new_value ? JSON.stringify(new_value) : null]
  );
}

async function listAuditLog({ entity_type = '', entity_id = null, limit = 100 } = {}) {
  const conditions = [];
  const params = [];
  if (entity_type) {
    params.push(entity_type);
    conditions.push(`entity_type = $${params.length}`);
  }
  if (entity_id) {
    params.push(entity_id);
    conditions.push(`entity_id = $${params.length}`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  params.push(limit);
  const { rows } = await pool.query(
    `SELECT * FROM hr_audit_log ${where} ORDER BY created_at DESC LIMIT $${params.length}`,
    params
  );
  return rows;
}

// ---------------------------------------------------------------------
// Departments
// ---------------------------------------------------------------------

async function listDepartments() {
  const { rows } = await pool.query(`
    SELECT d.*,
      (SELECT COUNT(*)::int FROM hr_positions p WHERE p.department_id = d.id AND p.active = true) AS position_count,
      (SELECT COUNT(*)::int FROM hr_positions p
         JOIN hr_employment_periods ep ON ep.position_id = p.id AND ep.end_date IS NULL
        WHERE p.department_id = d.id AND p.active = true) AS filled_count
    FROM hr_departments d
    WHERE d.active = true
    ORDER BY lower(d.name) ASC
  `);
  return rows;
}

async function createDepartment({ name, parent_department_id, planned_headcount, purpose }) {
  const { rows } = await pool.query(
    `INSERT INTO hr_departments (name, parent_department_id, planned_headcount, purpose)
     VALUES ($1,$2,$3,$4) RETURNING *`,
    [name, parent_department_id || null, planned_headcount || 0, purpose || '']
  );
  return rows[0];
}

async function updateDepartment(id, { name, parent_department_id, planned_headcount, purpose, active }) {
  if (parent_department_id && Number(parent_department_id) === Number(id)) {
    throw new Error('Департамент не може бути власним батьківським');
  }
  const { rows } = await pool.query(
    `UPDATE hr_departments SET
       name = COALESCE($2, name),
       parent_department_id = $3,
       planned_headcount = COALESCE($4, planned_headcount),
       purpose = COALESCE($5, purpose),
       active = COALESCE($6, active),
       updated_at = now()
     WHERE id = $1 RETURNING *`,
    [id, name ?? null, parent_department_id ?? null, planned_headcount ?? null, purpose ?? null, active ?? null]
  );
  return rows[0] || null;
}

// ---------------------------------------------------------------------
// Positions
// ---------------------------------------------------------------------

async function listPositions({ department_id = null } = {}) {
  const conditions = [`p.active = true`];
  const params = [];
  if (department_id) {
    params.push(department_id);
    conditions.push(`p.department_id = $${params.length}`);
  }
  const { rows } = await pool.query(`
    SELECT p.*, d.name AS department_name, rp.title AS reports_to_title,
      ep.employee_id AS current_employee_id, per.full_name AS current_employee_name
    FROM hr_positions p
    JOIN hr_departments d ON d.id = p.department_id
    LEFT JOIN hr_positions rp ON rp.id = p.reports_to_position_id
    LEFT JOIN hr_employment_periods ep ON ep.position_id = p.id AND ep.end_date IS NULL
    LEFT JOIN hr_employees emp ON emp.id = ep.employee_id
    LEFT JOIN hr_persons per ON per.id = emp.person_id
    WHERE ${conditions.join(' AND ')}
    ORDER BY lower(d.name) ASC, lower(p.title) ASC
  `, params);
  return rows;
}

async function createPosition({ title, department_id, reports_to_position_id, status, is_department_head, note, purpose }) {
  if (status && !POSITION_STATUSES.includes(status)) {
    throw new Error(`Unknown position status: ${status}`);
  }
  const { rows } = await pool.query(
    `INSERT INTO hr_positions (title, department_id, reports_to_position_id, status, is_department_head, note, purpose)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [title, department_id, reports_to_position_id || null, status || 'Vacant', !!is_department_head, note || '', purpose || '']
  );
  return rows[0];
}

async function updatePosition(id, { title, department_id, reports_to_position_id, status, is_department_head, note, purpose, active }) {
  if (status && !POSITION_STATUSES.includes(status)) {
    throw new Error(`Unknown position status: ${status}`);
  }
  if (reports_to_position_id && Number(reports_to_position_id) === Number(id)) {
    throw new Error('Посада не може підпорядковуватись сама собі');
  }
  const { rows } = await pool.query(
    `UPDATE hr_positions SET
       title = COALESCE($2, title),
       department_id = COALESCE($3, department_id),
       reports_to_position_id = $4,
       status = COALESCE($5, status),
       is_department_head = COALESCE($6, is_department_head),
       note = COALESCE($7, note),
       purpose = COALESCE($8, purpose),
       active = COALESCE($9, active),
       updated_at = now()
     WHERE id = $1 RETURNING *`,
    [id, title ?? null, department_id ?? null, reports_to_position_id ?? null, status ?? null, is_department_head ?? null, note ?? null, purpose ?? null, active ?? null]
  );
  return rows[0] || null;
}

// ---------------------------------------------------------------------
// People (Person + Employee)
// ---------------------------------------------------------------------

function humanTenure(startDate) {
  if (!startDate) return '';
  const start = new Date(startDate);
  const now = new Date();
  let months = (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth());
  if (now.getDate() < start.getDate()) months -= 1;
  if (months < 0) return '';
  const years = Math.floor(months / 12);
  const remMonths = months % 12;
  const parts = [];
  if (years > 0) parts.push(`${years} ${years === 1 ? 'рік' : years < 5 ? 'роки' : 'років'}`);
  if (remMonths > 0 || years === 0) parts.push(`${remMonths} міс.`);
  return parts.join(' ');
}

async function listEmployees({ search = '', status = '', department_id = null } = {}) {
  const conditions = [`e.active = true`];
  const params = [];
  if (search) {
    params.push(`%${search.toLowerCase()}%`);
    conditions.push(`(lower(per.full_name) LIKE $${params.length} OR lower(e.employee_number) LIKE $${params.length} OR lower(per.phone) LIKE $${params.length} OR lower(per.personal_email) LIKE $${params.length})`);
  }
  if (status) {
    params.push(status);
    conditions.push(`e.status = $${params.length}`);
  }
  if (department_id) {
    params.push(department_id);
    conditions.push(`ep.department_id = $${params.length}`);
  }
  const { rows } = await pool.query(`
    SELECT e.*, per.full_name, per.birth_date, per.phone, per.personal_email, per.telegram, per.photo_url,
      pos.title AS position_title, dep.name AS department_name, dep.id AS department_id,
      mgr_per.full_name AS manager_name,
      ep.start_date AS employment_start_date
    FROM hr_employees e
    JOIN hr_persons per ON per.id = e.person_id
    LEFT JOIN hr_employment_periods ep ON ep.employee_id = e.id AND ep.end_date IS NULL
    LEFT JOIN hr_positions pos ON pos.id = ep.position_id
    LEFT JOIN hr_departments dep ON dep.id = ep.department_id
    LEFT JOIN hr_employees mgr ON mgr.id = ep.manager_employee_id
    LEFT JOIN hr_persons mgr_per ON mgr_per.id = mgr.person_id
    WHERE ${conditions.join(' AND ')}
    ORDER BY lower(per.full_name) ASC
  `, params);
  return rows.map((r) => ({ ...r, tenure: humanTenure(r.employment_start_date || r.first_hire_date) }));
}

async function getEmployee(id) {
  const { rows } = await pool.query(`
    SELECT e.*, per.*, e.id AS id, e.created_at AS created_at
    FROM hr_employees e
    JOIN hr_persons per ON per.id = e.person_id
    WHERE e.id = $1
  `, [id]);
  const employee = rows[0];
  if (!employee) return null;

  const { rows: periods } = await pool.query(`
    SELECT ep.*, pos.title AS position_title, dep.name AS department_name, mgr_per.full_name AS manager_name
    FROM hr_employment_periods ep
    JOIN hr_positions pos ON pos.id = ep.position_id
    JOIN hr_departments dep ON dep.id = ep.department_id
    LEFT JOIN hr_employees mgr ON mgr.id = ep.manager_employee_id
    LEFT JOIN hr_persons mgr_per ON mgr_per.id = mgr.person_id
    WHERE ep.employee_id = $1
    ORDER BY ep.start_date DESC, ep.id DESC
  `, [id]);

  const { rows: compensation } = await pool.query(`
    SELECT * FROM hr_compensation_records WHERE employee_id = $1 ORDER BY effective_from DESC, id DESC
  `, [id]);

  const current = periods.find((p) => !p.end_date) || null;

  return {
    ...employee,
    tenure: humanTenure(current?.start_date || employee.first_hire_date),
    current_period: current,
    employment_periods: periods,
    compensation_records: compensation
  };
}

async function createEmployee({ full_name, birth_date, gender, phone, personal_email, telegram, city,
  emergency_contact, employee_number, status, corporate_email, first_hire_date,
  position_id, department_id, manager_employee_id, start_date, employment_type, employment_format, location,
  created_by }) {
  if (status && !EMPLOYEE_STATUSES.includes(status)) {
    throw new Error(`Unknown employee status: ${status}`);
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: personRows } = await client.query(
      `INSERT INTO hr_persons (full_name, birth_date, gender, phone, personal_email, telegram, city, emergency_contact)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [full_name, birth_date || null, gender || '', phone || '', personal_email || '', telegram || '', city || '', emergency_contact || '']
    );
    const person = personRows[0];

    const { rows: empRows } = await client.query(
      `INSERT INTO hr_employees (person_id, employee_number, status, corporate_email, first_hire_date)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [person.id, employee_number || null, status || 'Future Employee', corporate_email || '', first_hire_date || start_date || null]
    );
    const employee = empRows[0];

    if (position_id && department_id && start_date) {
      await client.query(
        `INSERT INTO hr_employment_periods (employee_id, position_id, department_id, manager_employee_id, start_date, employment_type, employment_format, location, change_reason, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'Прийняття на роботу',$9)`,
        [employee.id, position_id, department_id, manager_employee_id || null, start_date, employment_type || '', employment_format || '', location || '', created_by || '']
      );
      await client.query(`UPDATE hr_positions SET status = 'Filled', updated_at = now() WHERE id = $1`, [position_id]);
    }

    await client.query('COMMIT');
    await writeAudit({ actor: created_by, action: 'create', entity_type: 'employee', entity_id: employee.id, new_value: { full_name, status: employee.status } });
    return employee;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function updatePersonFields(personId, fields) {
  const { full_name, birth_date, gender, phone, personal_email, telegram, city, emergency_contact, photo_url } = fields;
  const { rows } = await pool.query(
    `UPDATE hr_persons SET
       full_name = COALESCE($2, full_name),
       birth_date = $3,
       gender = COALESCE($4, gender),
       phone = COALESCE($5, phone),
       personal_email = COALESCE($6, personal_email),
       telegram = COALESCE($7, telegram),
       city = COALESCE($8, city),
       emergency_contact = COALESCE($9, emergency_contact),
       photo_url = COALESCE($10, photo_url),
       updated_at = now()
     WHERE id = $1 RETURNING *`,
    [personId, full_name ?? null, birth_date ?? null, gender ?? null, phone ?? null, personal_email ?? null,
      telegram ?? null, city ?? null, emergency_contact ?? null, photo_url ?? null]
  );
  return rows[0] || null;
}

async function updateEmployeeStatus(employeeId, status, actor) {
  if (!EMPLOYEE_STATUSES.includes(status)) {
    throw new Error(`Unknown employee status: ${status}`);
  }
  const { rows: before } = await pool.query('SELECT status FROM hr_employees WHERE id = $1', [employeeId]);
  if (!before[0]) return null;

  const { rows } = await pool.query(
    `UPDATE hr_employees SET status = $2, updated_at = now() WHERE id = $1 RETURNING *`,
    [employeeId, status]
  );
  await writeAudit({
    actor, action: 'status_change', entity_type: 'employee', entity_id: employeeId,
    old_value: { status: before[0].status }, new_value: { status }
  });
  return rows[0];
}

async function updateEmployeeFields(employeeId, { employee_number, corporate_email, first_hire_date, rehire_eligible,
  reservation_applicable, reservation_status, reservation_start_date, reservation_end_date, reservation_comment, reservation_document_url }) {
  if (reservation_status && !RESERVATION_STATUSES.includes(reservation_status)) {
    throw new Error(`Unknown reservation status: ${reservation_status}`);
  }
  const { rows } = await pool.query(
    `UPDATE hr_employees SET
       employee_number = COALESCE($2, employee_number),
       corporate_email = COALESCE($3, corporate_email),
       first_hire_date = COALESCE($4, first_hire_date),
       rehire_eligible = COALESCE($5, rehire_eligible),
       reservation_applicable = COALESCE($6, reservation_applicable),
       reservation_status = COALESCE($7, reservation_status),
       reservation_start_date = $8,
       reservation_end_date = $9,
       reservation_comment = COALESCE($10, reservation_comment),
       reservation_document_url = COALESCE($11, reservation_document_url),
       updated_at = now()
     WHERE id = $1 RETURNING *`,
    [employeeId, employee_number ?? null, corporate_email ?? null, first_hire_date ?? null, rehire_eligible ?? null,
      reservation_applicable ?? null, reservation_status ?? null, reservation_start_date ?? null, reservation_end_date ?? null,
      reservation_comment ?? null, reservation_document_url ?? null]
  );
  return rows[0] || null;
}

// Зміна посади/департаменту/керівника — закриває поточний Employment
// Period (end_date = день перед новим start_date) і створює новий, а не
// перезаписує (ТЗ п.3 No silent overwrites). Стара посада звільняється
// (стає Vacant), якщо на ній не лишилось інших активних періодів.
async function changeEmployment(employeeId, { position_id, department_id, manager_employee_id, start_date,
  employment_type, employment_format, location, change_reason, created_by }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: currentRows } = await client.query(
      `SELECT * FROM hr_employment_periods WHERE employee_id = $1 AND end_date IS NULL FOR UPDATE`,
      [employeeId]
    );
    const current = currentRows[0];

    if (current) {
      const endDate = new Date(start_date);
      endDate.setDate(endDate.getDate() - 1);
      await client.query(
        `UPDATE hr_employment_periods SET end_date = $2 WHERE id = $1`,
        [current.id, endDate.toISOString().slice(0, 10)]
      );
      if (current.position_id !== position_id) {
        const { rows: stillFilled } = await client.query(
          `SELECT 1 FROM hr_employment_periods WHERE position_id = $1 AND end_date IS NULL AND id != $2`,
          [current.position_id, current.id]
        );
        if (stillFilled.length === 0) {
          await client.query(`UPDATE hr_positions SET status = 'Vacant', updated_at = now() WHERE id = $1`, [current.position_id]);
        }
      }
    }

    const { rows: newRows } = await client.query(
      `INSERT INTO hr_employment_periods (employee_id, position_id, department_id, manager_employee_id, start_date, employment_type, employment_format, location, change_reason, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [employeeId, position_id, department_id, manager_employee_id || null, start_date,
        employment_type || '', employment_format || '', location || '', change_reason || '', created_by || '']
    );
    await client.query(`UPDATE hr_positions SET status = 'Filled', updated_at = now() WHERE id = $1`, [position_id]);

    await client.query('COMMIT');
    await writeAudit({
      actor: created_by, action: 'employment_change', entity_type: 'employee', entity_id: employeeId,
      old_value: current ? { position_id: current.position_id, department_id: current.department_id, manager_employee_id: current.manager_employee_id } : null,
      new_value: { position_id, department_id, manager_employee_id, start_date, change_reason }
    });
    return newRows[0];
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------
// Compensation
// ---------------------------------------------------------------------

async function addCompensationRecord({ employee_id, effective_from, fixed_salary, currency, bonus_type,
  bonus_formula, kpi_bonus, additional_payments, reason, comment, document_url, created_by, approved_by }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Попередній відкритий запис логічно закривається днем перед новим
    // effective_from (ТЗ п.22 — "попередній запис має закриватись логічно,
    // без перекриття дат").
    const { rows: openRows } = await client.query(
      `SELECT id FROM hr_compensation_records WHERE employee_id = $1 AND effective_to IS NULL FOR UPDATE`,
      [employee_id]
    );
    if (openRows[0]) {
      const endDate = new Date(effective_from);
      endDate.setDate(endDate.getDate() - 1);
      await client.query(`UPDATE hr_compensation_records SET effective_to = $2 WHERE id = $1`, [openRows[0].id, endDate.toISOString().slice(0, 10)]);
    }

    const { rows } = await client.query(
      `INSERT INTO hr_compensation_records (employee_id, effective_from, fixed_salary, currency, bonus_type, bonus_formula, kpi_bonus, additional_payments, reason, comment, document_url, created_by, approved_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [employee_id, effective_from, fixed_salary || null, currency || 'UAH', bonus_type || '', bonus_formula || '',
        kpi_bonus || '', additional_payments || '', reason || '', comment || '', document_url || '', created_by || '', approved_by || '']
    );
    await client.query('COMMIT');
    await writeAudit({ actor: created_by, action: 'compensation_change', entity_type: 'employee', entity_id: employee_id, new_value: { fixed_salary, reason, effective_from } });
    return rows[0];
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------
// Org chart (спрощений перший варіант: вкладене дерево департамент → посади
// → хто зараз на посаді, а не графічний drag&drop — Chart View з
// повноцінною візуалізацією лишається наступним кроком)
// ---------------------------------------------------------------------

async function getOrgTree() {
  const departments = await listDepartments();
  const { rows: positions } = await pool.query(`
    SELECT p.*, ep.employee_id AS current_employee_id, per.full_name AS current_employee_name,
      per.photo_url AS current_employee_photo, emp.status AS current_employee_status
    FROM hr_positions p
    LEFT JOIN hr_employment_periods ep ON ep.position_id = p.id AND ep.end_date IS NULL
    LEFT JOIN hr_employees emp ON emp.id = ep.employee_id
    LEFT JOIN hr_persons per ON per.id = emp.person_id
    WHERE p.active = true
    ORDER BY lower(p.title) ASC
  `);
  return { departments, positions };
}

// ---------------------------------------------------------------------
// Recruitment / ATS — Vacancy Requests
// ---------------------------------------------------------------------

const VACANCY_REQUEST_FIELDS = [
  'position_title', 'department_id', 'hiring_manager_employee_id', 'request_reason', 'quantity', 'priority',
  'desired_start_date', 'ideal_candidate_portrait', 'responsibilities', 'skills_professional', 'skills_technical',
  'skills_additional', 'product_knowledge', 'personal_qualities_required', 'personal_qualities_desired',
  'compensation_trial', 'compensation_probation', 'compensation_after_probation', 'compensation_bonus_formula',
  'probation_goals', 'career_growth', 'notes'
];

async function listVacancyRequests({ status = '' } = {}) {
  const conditions = [];
  const params = [];
  if (status) {
    params.push(status);
    conditions.push(`vr.status = $${params.length}`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await pool.query(`
    SELECT vr.*, d.name AS department_name, per.full_name AS hiring_manager_name
    FROM hr_vacancy_requests vr
    JOIN hr_departments d ON d.id = vr.department_id
    LEFT JOIN hr_employees mgr ON mgr.id = vr.hiring_manager_employee_id
    LEFT JOIN hr_persons per ON per.id = mgr.person_id
    ${where}
    ORDER BY vr.created_at DESC
  `, params);
  return rows;
}

async function getVacancyRequest(id) {
  const { rows } = await pool.query(`
    SELECT vr.*, d.name AS department_name, per.full_name AS hiring_manager_name
    FROM hr_vacancy_requests vr
    JOIN hr_departments d ON d.id = vr.department_id
    LEFT JOIN hr_employees mgr ON mgr.id = vr.hiring_manager_employee_id
    LEFT JOIN hr_persons per ON per.id = mgr.person_id
    WHERE vr.id = $1
  `, [id]);
  if (!rows[0]) return null;
  const { rows: vacancies } = await pool.query(`SELECT * FROM hr_vacancies WHERE vacancy_request_id = $1`, [id]);
  return { ...rows[0], vacancy: vacancies[0] || null };
}

const VACANCY_REQUEST_NULLABLE_FIELDS = new Set(['hiring_manager_employee_id', 'desired_start_date']);

// Без AI — та сама евристика, що й для резюме (ТЗ п.11): шукаємо в тексті
// рядок "Label: значення" (label — один із відомих варіантів написання
// поля), якщо значення порожнє — беремо наступний непорожній рядок. Завжди
// можна доправити вручну в модалці після імпорту, це лише чернетка.
const VACANCY_REQUEST_FIELD_LABELS = {
  position_title: ['посада', 'назва посади'],
  quantity: ['кількість', 'к-сть', 'кількість вакансій'],
  priority: ['пріоритет'],
  desired_start_date: ['бажана дата старту', 'дата старту', 'дата початку'],
  request_reason: ['причина заявки', 'причина'],
  responsibilities: ["обов'язки", 'обов’язки', 'обовязки'],
  ideal_candidate_portrait: ['портрет ідеального кандидата', 'портрет кандидата'],
  skills_professional: ['професійні навички'],
  skills_technical: ['технічні навички'],
  skills_additional: ['додаткові навички'],
  product_knowledge: ['знання продукту'],
  personal_qualities_required: ["обов'язкові особисті якості", 'особисті якості обов’язкові', 'особисті якості (обов\'язкові)'],
  personal_qualities_desired: ['бажані особисті якості', 'особисті якості бажані', 'особисті якості (бажані)'],
  compensation_trial: ['оплата на стажуванні', 'оплата стажування'],
  compensation_probation: ['оплата на випробувальному'],
  compensation_after_probation: ['оплата після випробувального'],
  compensation_bonus_formula: ['формула бонусу', 'бонус'],
  probation_goals: ['цілі випробувального'],
  career_growth: ["кар'єрний ріст", 'кар’єрний ріст', 'кар\'єрне зростання'],
  notes: ['нотатки', 'примітки']
};

const PRIORITY_ALIASES = {
  низький: 'Low', low: 'Low',
  середній: 'Medium', medium: 'Medium',
  високий: 'High', high: 'High',
  терміново: 'Urgent', термінові: 'Urgent', urgent: 'Urgent', критично: 'Urgent'
};

function parseVacancyRequestFieldsFromText(text) {
  const lines = text.split('\n').map((l) => l.trim());
  const found = {};
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const m = line.match(/^([^:—-]{2,40})[:—-]\s*(.*)$/);
    if (!m) continue;
    const rawLabel = m[1].trim().toLowerCase();
    let value = m[2].trim();
    for (const [field, labels] of Object.entries(VACANCY_REQUEST_FIELD_LABELS)) {
      if (found[field]) continue;
      if (!labels.includes(rawLabel)) continue;
      if (!value) {
        const next = lines.slice(i + 1).find(Boolean);
        value = next || '';
      }
      if (value) found[field] = value;
      break;
    }
  }
  if (found.quantity) {
    const n = parseInt(found.quantity, 10);
    found.quantity = Number.isFinite(n) && n > 0 ? n : 1;
  }
  if (found.priority) {
    found.priority = PRIORITY_ALIASES[found.priority.toLowerCase()] || '';
    if (!found.priority) delete found.priority;
  }
  if (found.desired_start_date) {
    const ddmmyyyy = found.desired_start_date.match(/^(\d{1,2})[.\/](\d{1,2})[.\/](\d{4})$/);
    if (ddmmyyyy) {
      found.desired_start_date = `${ddmmyyyy[3]}-${ddmmyyyy[2].padStart(2, '0')}-${ddmmyyyy[1].padStart(2, '0')}`;
    } else if (!/^\d{4}-\d{2}-\d{2}$/.test(found.desired_start_date)) {
      delete found.desired_start_date;
    }
  }
  return found;
}

// Файл (docx/pdf/txt) -> чернетка заявки на вакансію (Draft), сам файл
// одразу прикріплюється до неї. Департамент — обов'язкове поле в схемі
// (NOT NULL FK), тому не намагаємось вгадати його з тексту (заголовки типу
// "Відділ продажів" неоднозначні) — його обирає користувач у формі
// завантаження, як і при ручному створенні заявки.
async function createVacancyRequestFromFile({ buffer, filename, mimeType, department_id }, uploadedBy) {
  if (!department_id) throw new Error('Департамент обов’язковий');
  const { text } = await extractResumeText(buffer, mimeType, filename);
  const parsed = parseVacancyRequestFieldsFromText(text);
  if (!parsed.position_title) {
    parsed.position_title = filename.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
  }
  const request = await createVacancyRequest({ ...parsed, department_id }, uploadedBy);
  const attachment = await addVacancyRequestAttachment(request.id, { buffer, filename, mimeType }, uploadedBy);
  return { request, attachment, parsedFields: Object.keys(parsed) };
}

async function createVacancyRequest(fields, created_by) {
  const cols = VACANCY_REQUEST_FIELDS;
  const values = cols.map((c) => {
    if (c === 'quantity') return fields.quantity || 1;
    if (VACANCY_REQUEST_NULLABLE_FIELDS.has(c)) return fields[c] || null;
    return fields[c] ?? '';
  });
  const { rows } = await pool.query(
    `INSERT INTO hr_vacancy_requests (${cols.join(', ')}, created_by)
     VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}, $${cols.length + 1}) RETURNING *`,
    [...values, created_by || '']
  );
  await writeAudit({ actor: created_by, action: 'create', entity_type: 'vacancy_request', entity_id: rows[0].id, new_value: { position_title: rows[0].position_title } });
  return rows[0];
}

async function updateVacancyRequest(id, fields) {
  const cols = VACANCY_REQUEST_FIELDS.filter((c) => fields[c] !== undefined);
  if (!cols.length) return getVacancyRequest(id);
  const setClause = cols.map((c, i) => `${c} = $${i + 2}`).join(', ');
  const { rows } = await pool.query(
    `UPDATE hr_vacancy_requests SET ${setClause}, updated_at = now() WHERE id = $1 RETURNING *`,
    [id, ...cols.map((c) => fields[c])]
  );
  return rows[0] || null;
}

async function updateVacancyRequestStatus(id, status, status_note, actor) {
  if (!VACANCY_REQUEST_STATUSES.includes(status)) {
    throw new Error(`Unknown vacancy request status: ${status}`);
  }
  const { rows: before } = await pool.query('SELECT status FROM hr_vacancy_requests WHERE id = $1', [id]);
  if (!before[0]) return null;
  const { rows } = await pool.query(
    `UPDATE hr_vacancy_requests SET status = $2, status_note = COALESCE($3, status_note), updated_at = now() WHERE id = $1 RETURNING *`,
    [id, status, status_note ?? null]
  );
  await writeAudit({ actor, action: 'status_change', entity_type: 'vacancy_request', entity_id: id, old_value: { status: before[0].status }, new_value: { status } });
  return rows[0];
}

// Convert to Vacancy — окрема свідома дія (ТЗ 9.2), не автоматично на
// Approved; idempotent — повторний виклик повертає вже створену вакансію.
async function convertVacancyRequestToVacancy(requestId, { position_id, recruiter_username, target_date, priority }, actor) {
  const { rows: existing } = await pool.query(`SELECT * FROM hr_vacancies WHERE vacancy_request_id = $1`, [requestId]);
  if (existing[0]) return existing[0];

  const request = await getVacancyRequest(requestId);
  if (!request) throw new Error('Заявку на вакансію не знайдено');
  if (request.status !== 'Approved') {
    throw new Error('Конвертувати у вакансію можна лише погоджену заявку (Approved)');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO hr_vacancies (vacancy_request_id, position_id, department_id, hiring_manager_employee_id, recruiter_username, title, priority, target_date, profile_snapshot)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [requestId, position_id || null, request.department_id, request.hiring_manager_employee_id, recruiter_username || '',
        request.position_title, priority || request.priority || '', target_date || null, request.ideal_candidate_portrait || '']
    );
    await client.query(`UPDATE hr_vacancy_requests SET status = 'Converted to Vacancy', updated_at = now() WHERE id = $1`, [requestId]);
    if (position_id) {
      await client.query(`UPDATE hr_positions SET status = 'Recruitment Active', updated_at = now() WHERE id = $1`, [position_id]);
    }
    await client.query('COMMIT');
    await writeAudit({ actor, action: 'convert_to_vacancy', entity_type: 'vacancy_request', entity_id: requestId, new_value: { vacancy_id: rows[0].id } });
    return rows[0];
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------
// Recruitment / ATS — Vacancies
// ---------------------------------------------------------------------

async function listVacancies({ status = '' } = {}) {
  const conditions = [];
  const params = [];
  if (status) {
    params.push(status);
    conditions.push(`v.status = $${params.length}`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await pool.query(`
    SELECT v.*, d.name AS department_name, per.full_name AS hiring_manager_name,
      (SELECT COUNT(*)::int FROM hr_applications a WHERE a.vacancy_id = v.id AND a.status = 'Active') AS active_applications_count
    FROM hr_vacancies v
    JOIN hr_departments d ON d.id = v.department_id
    LEFT JOIN hr_employees mgr ON mgr.id = v.hiring_manager_employee_id
    LEFT JOIN hr_persons per ON per.id = mgr.person_id
    ${where}
    ORDER BY v.created_at DESC
  `, params);
  return rows;
}

async function getVacancy(id) {
  const { rows } = await pool.query(`
    SELECT v.*, d.name AS department_name, per.full_name AS hiring_manager_name
    FROM hr_vacancies v
    JOIN hr_departments d ON d.id = v.department_id
    LEFT JOIN hr_employees mgr ON mgr.id = v.hiring_manager_employee_id
    LEFT JOIN hr_persons per ON per.id = mgr.person_id
    WHERE v.id = $1
  `, [id]);
  if (!rows[0]) return null;
  const applications = await listApplicationsForVacancy(id);
  return { ...rows[0], applications };
}

async function createVacancy({ position_id, department_id, hiring_manager_employee_id, recruiter_username, title, priority, target_date, profile_snapshot, override_reason }, created_by) {
  const { rows } = await pool.query(
    `INSERT INTO hr_vacancies (position_id, department_id, hiring_manager_employee_id, recruiter_username, title, priority, target_date, profile_snapshot, override_reason)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [position_id || null, department_id, hiring_manager_employee_id || null, recruiter_username || '', title, priority || '', target_date || null, profile_snapshot || '', override_reason || '']
  );
  await writeAudit({ actor: created_by, action: 'create', entity_type: 'vacancy', entity_id: rows[0].id, new_value: { title } });
  return rows[0];
}

async function updateVacancy(id, { recruiter_username, priority, target_date, profile_snapshot }) {
  const { rows } = await pool.query(
    `UPDATE hr_vacancies SET
       recruiter_username = COALESCE($2, recruiter_username),
       priority = COALESCE($3, priority),
       target_date = $4,
       profile_snapshot = COALESCE($5, profile_snapshot),
       updated_at = now()
     WHERE id = $1 RETURNING *`,
    [id, recruiter_username ?? null, priority ?? null, target_date ?? null, profile_snapshot ?? null]
  );
  return rows[0] || null;
}

async function updateVacancyStatus(id, status, actor) {
  if (!VACANCY_STATUSES.includes(status)) {
    throw new Error(`Unknown vacancy status: ${status}`);
  }
  const { rows: before } = await pool.query('SELECT status, position_id FROM hr_vacancies WHERE id = $1', [id]);
  if (!before[0]) return null;
  const { rows } = await pool.query(
    `UPDATE hr_vacancies SET status = $2, updated_at = now() WHERE id = $1 RETURNING *`,
    [id, status]
  );
  if (before[0].position_id && (status === 'Cancelled' || status === 'Closed') && before[0].status !== 'Filled') {
    await pool.query(`UPDATE hr_positions SET status = 'Vacant', updated_at = now() WHERE id = $1 AND status = 'Recruitment Active'`, [before[0].position_id]);
  }
  await writeAudit({ actor, action: 'status_change', entity_type: 'vacancy', entity_id: id, old_value: { status: before[0].status }, new_value: { status } });
  return rows[0];
}

// ---------------------------------------------------------------------
// Recruitment / ATS — Candidates
// ---------------------------------------------------------------------

async function findDuplicateCandidate({ phone, personal_email }) {
  const conditions = [];
  const params = [];
  if (phone) {
    params.push(phone);
    conditions.push(`per.phone = $${params.length}`);
  }
  if (personal_email) {
    params.push(personal_email.toLowerCase());
    conditions.push(`lower(per.personal_email) = $${params.length}`);
  }
  if (!conditions.length) return null;
  const { rows } = await pool.query(`
    SELECT c.*, per.full_name, per.phone, per.personal_email
    FROM hr_candidates c JOIN hr_persons per ON per.id = c.person_id
    WHERE ${conditions.join(' OR ')}
    LIMIT 1
  `, params);
  return rows[0] || null;
}

// Дублікати за телефоном/email не створюються повторно — та сама Person
// (ТЗ п.3 "one person — one master record"); повертаємо існуючого
// кандидата з прапорцем duplicate: true, щоб UI попередив користувача.
async function createCandidate({ full_name, phone, personal_email, telegram, city, current_job_title, desired_role,
  desired_salary, source, owner_recruiter, resume_url, notes }, created_by) {
  const duplicate = await findDuplicateCandidate({ phone, personal_email });
  if (duplicate) {
    return { candidate: duplicate, duplicate: true };
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: personRows } = await client.query(
      `INSERT INTO hr_persons (full_name, phone, personal_email, telegram, city) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [full_name, phone || '', personal_email || '', telegram || '', city || '']
    );
    const person = personRows[0];
    const { rows: candRows } = await client.query(
      `INSERT INTO hr_candidates (person_id, current_job_title, desired_role, desired_salary, source, owner_recruiter, resume_url, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [person.id, current_job_title || '', desired_role || '', desired_salary || '', source || '', owner_recruiter || '', resume_url || '', notes || '']
    );
    await client.query('COMMIT');
    await writeAudit({ actor: created_by, action: 'create', entity_type: 'candidate', entity_id: candRows[0].id, new_value: { full_name } });
    return { candidate: { ...candRows[0], full_name, phone: phone || '', personal_email: personal_email || '' }, duplicate: false };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function listCandidates({ search = '' } = {}) {
  const conditions = [];
  const params = [];
  if (search) {
    params.push(`%${search.toLowerCase()}%`);
    conditions.push(`(lower(per.full_name) LIKE $${params.length} OR lower(per.phone) LIKE $${params.length} OR lower(per.personal_email) LIKE $${params.length})`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await pool.query(`
    SELECT c.*, per.full_name, per.phone, per.personal_email, per.telegram, per.city,
      (SELECT COUNT(*)::int FROM hr_applications a WHERE a.candidate_id = c.id AND a.status = 'Active') AS active_applications_count
    FROM hr_candidates c
    JOIN hr_persons per ON per.id = c.person_id
    ${where}
    ORDER BY c.created_at DESC
  `, params);
  return rows;
}

async function getCandidate(id) {
  const { rows } = await pool.query(`
    SELECT c.*, per.*, c.id AS id, c.created_at AS created_at
    FROM hr_candidates c JOIN hr_persons per ON per.id = c.person_id
    WHERE c.id = $1
  `, [id]);
  if (!rows[0]) return null;
  const { rows: applications } = await pool.query(`
    SELECT a.*, v.title AS vacancy_title, v.status AS vacancy_status
    FROM hr_applications a JOIN hr_vacancies v ON v.id = a.vacancy_id
    WHERE a.candidate_id = $1
    ORDER BY a.created_at DESC
  `, [id]);
  return { ...rows[0], applications };
}

async function updateCandidateFields(id, { current_job_title, desired_role, desired_salary, source, owner_recruiter,
  resume_url, notes, talent_pool_segment, talent_pool_category, talent_pool_next_contact }) {
  const { rows } = await pool.query(
    `UPDATE hr_candidates SET
       current_job_title = COALESCE($2, current_job_title),
       desired_role = COALESCE($3, desired_role),
       desired_salary = COALESCE($4, desired_salary),
       source = COALESCE($5, source),
       owner_recruiter = COALESCE($6, owner_recruiter),
       resume_url = COALESCE($7, resume_url),
       notes = COALESCE($8, notes),
       talent_pool_segment = COALESCE($9, talent_pool_segment),
       talent_pool_category = COALESCE($10, talent_pool_category),
       talent_pool_next_contact = $11,
       updated_at = now()
     WHERE id = $1 RETURNING *`,
    [id, current_job_title ?? null, desired_role ?? null, desired_salary ?? null, source ?? null, owner_recruiter ?? null,
      resume_url ?? null, notes ?? null, talent_pool_segment ?? null, talent_pool_category ?? null, talent_pool_next_contact ?? null]
  );
  return rows[0] || null;
}

// Видалення дозволене лише для кандидата без жодної заявки на вакансію —
// це саме для чистки помилково створених карток (напр. дублікати, зіпсовані
// bulk-імпортом файли), а не для "стирання історії" реального процесу
// найму. Якщо хоч одна заявка є — відмовляємо явно, а не тихо каскадимо.
async function deleteCandidate(id, actor) {
  const { rows: appRows } = await pool.query('SELECT id FROM hr_applications WHERE candidate_id = $1 LIMIT 1', [id]);
  if (appRows.length) {
    throw new Error('Не можна видалити кандидата із заявками на вакансії');
  }
  const { rows: candRows } = await pool.query('SELECT id FROM hr_candidates WHERE id = $1', [id]);
  if (!candRows.length) return false;
  await pool.query('DELETE FROM hr_candidate_resumes WHERE candidate_id = $1', [id]);
  await pool.query('DELETE FROM hr_candidates WHERE id = $1', [id]);
  await writeAudit({ actor, action: 'delete', entity_type: 'candidate', entity_id: id, old_value: null, new_value: null });
  return true;
}

// ---------------------------------------------------------------------
// Recruitment / ATS — Applications
// ---------------------------------------------------------------------

async function listApplicationsForVacancy(vacancyId) {
  const { rows } = await pool.query(`
    SELECT a.*, per.full_name AS candidate_name, per.phone AS candidate_phone, per.personal_email AS candidate_email
    FROM hr_applications a
    JOIN hr_candidates c ON c.id = a.candidate_id
    JOIN hr_persons per ON per.id = c.person_id
    WHERE a.vacancy_id = $1
    ORDER BY a.created_at DESC
  `, [vacancyId]);
  return rows;
}

async function getApplication(id) {
  const { rows } = await pool.query(`
    SELECT a.*, per.full_name AS candidate_name, per.phone AS candidate_phone, per.personal_email AS candidate_email,
      v.title AS vacancy_title, v.status AS vacancy_status, v.department_id
    FROM hr_applications a
    JOIN hr_candidates c ON c.id = a.candidate_id
    JOIN hr_persons per ON per.id = c.person_id
    JOIN hr_vacancies v ON v.id = a.vacancy_id
    WHERE a.id = $1
  `, [id]);
  if (!rows[0]) return null;
  const { rows: interviews } = await pool.query(`SELECT * FROM hr_interviews WHERE application_id = $1 ORDER BY scheduled_at DESC NULLS LAST, id DESC`, [id]);
  const { rows: offers } = await pool.query(`SELECT * FROM hr_offers WHERE application_id = $1 ORDER BY created_at DESC`, [id]);
  return { ...rows[0], interviews, offers };
}

// Заявка кандидата на вакансію — унікальна пара (candidate_id, vacancy_id);
// повторний виклик повертає вже існуючу заявку (idempotent).
async function createApplication({ candidate_id, vacancy_id, applied_date }, created_by) {
  const { rows: existing } = await pool.query(
    `SELECT * FROM hr_applications WHERE candidate_id = $1 AND vacancy_id = $2`,
    [candidate_id, vacancy_id]
  );
  if (existing[0]) return existing[0];
  const { rows } = await pool.query(
    `INSERT INTO hr_applications (candidate_id, vacancy_id, applied_date, created_by)
     VALUES ($1,$2,COALESCE($3, CURRENT_DATE),$4) RETURNING *`,
    [candidate_id, vacancy_id, applied_date || null, created_by || '']
  );
  await writeAudit({ actor: created_by, action: 'create', entity_type: 'application', entity_id: rows[0].id, new_value: { candidate_id, vacancy_id } });
  return rows[0];
}

async function updateApplicationStage(id, stage, actor) {
  if (!APPLICATION_STAGES.includes(stage)) {
    throw new Error(`Unknown application stage: ${stage}`);
  }
  const { rows: before } = await pool.query('SELECT stage FROM hr_applications WHERE id = $1', [id]);
  if (!before[0]) return null;
  const { rows } = await pool.query(
    `UPDATE hr_applications SET stage = $2, updated_at = now() WHERE id = $1 RETURNING *`,
    [id, stage]
  );
  await writeAudit({ actor, action: 'stage_change', entity_type: 'application', entity_id: id, old_value: { stage: before[0].stage }, new_value: { stage } });
  return rows[0];
}

async function updateApplicationStatus(id, { status, rejection_reason, rejection_comment, next_action, next_action_date }, actor) {
  if (!APPLICATION_STATUSES.includes(status)) {
    throw new Error(`Unknown application status: ${status}`);
  }
  if (status === 'Rejected' && !rejection_reason) {
    throw new Error('Для відмови потрібно вказати причину');
  }
  const { rows: before } = await pool.query('SELECT status FROM hr_applications WHERE id = $1', [id]);
  if (!before[0]) return null;
  const { rows } = await pool.query(
    `UPDATE hr_applications SET
       status = $2,
       rejection_reason = COALESCE($3, rejection_reason),
       rejection_comment = COALESCE($4, rejection_comment),
       next_action = COALESCE($5, next_action),
       next_action_date = $6,
       updated_at = now()
     WHERE id = $1 RETURNING *`,
    [id, status, rejection_reason ?? null, rejection_comment ?? null, next_action ?? null, next_action_date ?? null]
  );
  await writeAudit({ actor, action: 'status_change', entity_type: 'application', entity_id: id, old_value: { status: before[0].status }, new_value: { status, rejection_reason } });
  return rows[0];
}

// ---------------------------------------------------------------------
// Recruitment / ATS — Interviews
// ---------------------------------------------------------------------

async function createInterview({ application_id, interview_type, scheduled_at, participants, notes }, created_by) {
  if (interview_type && !INTERVIEW_TYPES.includes(interview_type)) {
    throw new Error(`Unknown interview type: ${interview_type}`);
  }
  const { rows } = await pool.query(
    `INSERT INTO hr_interviews (application_id, interview_type, scheduled_at, participants, notes, created_by)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [application_id, interview_type || '', scheduled_at || null, participants || '', notes || '', created_by || '']
  );
  return rows[0];
}

async function listInterviewsForApplication(applicationId) {
  const { rows } = await pool.query(
    `SELECT * FROM hr_interviews WHERE application_id = $1 ORDER BY scheduled_at DESC NULLS LAST, id DESC`,
    [applicationId]
  );
  return rows;
}

async function updateInterview(id, { status, notes, decision, scheduled_at, participants }) {
  if (status && !INTERVIEW_STATUSES.includes(status)) {
    throw new Error(`Unknown interview status: ${status}`);
  }
  const { rows } = await pool.query(
    `UPDATE hr_interviews SET
       status = COALESCE($2, status),
       notes = COALESCE($3, notes),
       decision = COALESCE($4, decision),
       scheduled_at = COALESCE($5, scheduled_at),
       participants = COALESCE($6, participants)
     WHERE id = $1 RETURNING *`,
    [id, status ?? null, notes ?? null, decision ?? null, scheduled_at ?? null, participants ?? null]
  );
  return rows[0] || null;
}

// ---------------------------------------------------------------------
// Recruitment / ATS — Offers (Accepted → Future Employee, рівно один раз)
// ---------------------------------------------------------------------

async function createOffer({ application_id, fixed_salary, currency, bonus_formula, kpi_bonus, start_date,
  probation_goals, acceptance_deadline }, created_by) {
  const { rows } = await pool.query(
    `INSERT INTO hr_offers (application_id, fixed_salary, currency, bonus_formula, kpi_bonus, start_date, probation_goals, acceptance_deadline, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [application_id, fixed_salary || null, currency || 'UAH', bonus_formula || '', kpi_bonus || '', start_date || null,
      probation_goals || '', acceptance_deadline || null, created_by || '']
  );
  await writeAudit({ actor: created_by, action: 'create', entity_type: 'offer', entity_id: rows[0].id, new_value: { application_id } });
  return rows[0];
}

async function getOffer(id) {
  const { rows } = await pool.query(`SELECT * FROM hr_offers WHERE id = $1`, [id]);
  return rows[0] || null;
}

async function updateOffer(id, { fixed_salary, currency, bonus_formula, kpi_bonus, start_date, probation_goals, acceptance_deadline }) {
  const { rows } = await pool.query(
    `UPDATE hr_offers SET
       fixed_salary = COALESCE($2, fixed_salary),
       currency = COALESCE($3, currency),
       bonus_formula = COALESCE($4, bonus_formula),
       kpi_bonus = COALESCE($5, kpi_bonus),
       start_date = COALESCE($6, start_date),
       probation_goals = COALESCE($7, probation_goals),
       acceptance_deadline = $8,
       updated_at = now()
     WHERE id = $1 RETURNING *`,
    [id, fixed_salary ?? null, currency ?? null, bonus_formula ?? null, kpi_bonus ?? null, start_date ?? null, probation_goals ?? null, acceptance_deadline ?? null]
  );
  return rows[0] || null;
}

async function updateOfferStatus(id, status, actor, approved_by) {
  if (!OFFER_STATUSES.includes(status)) {
    throw new Error(`Unknown offer status: ${status}`);
  }
  const offer = await getOffer(id);
  if (!offer) return null;

  if (status === 'Sent' && (!offer.fixed_salary || !offer.start_date)) {
    throw new Error('Перед відправкою офера потрібно вказати оклад і дату старту');
  }

  // Idempotent: якщо співробітника вже створено з цього офера — повторний
  // Accepted нічого не дублює (ТЗ п.37).
  if (status === 'Accepted' && offer.employee_id) {
    return offer;
  }

  if (status !== 'Accepted') {
    const { rows } = await pool.query(
      `UPDATE hr_offers SET status = $2, approved_by = COALESCE($3, approved_by), updated_at = now() WHERE id = $1 RETURNING *`,
      [id, status, approved_by ?? null]
    );
    await writeAudit({ actor, action: 'status_change', entity_type: 'offer', entity_id: id, old_value: { status: offer.status }, new_value: { status } });
    return rows[0];
  }

  const application = await getApplication(offer.application_id);
  if (!application) throw new Error('Заявку кандидата не знайдено');

  const { rows: candRows } = await pool.query(`SELECT person_id FROM hr_candidates WHERE id = $1`, [application.candidate_id]);
  const personId = candRows[0]?.person_id;
  if (!personId) throw new Error('Не знайдено персональний профіль кандидата');

  const { rows: vacRows } = await pool.query(`SELECT position_id, department_id, hiring_manager_employee_id FROM hr_vacancies WHERE id = $1`, [application.vacancy_id]);
  const vacancy = vacRows[0];

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: empRows } = await client.query(
      `INSERT INTO hr_employees (person_id, status, first_hire_date)
       VALUES ($1,'Future Employee',$2) RETURNING *`,
      [personId, offer.start_date || null]
    );
    const employee = empRows[0];

    if (vacancy?.position_id && vacancy?.department_id && offer.start_date) {
      await client.query(
        `INSERT INTO hr_employment_periods (employee_id, position_id, department_id, manager_employee_id, start_date, change_reason)
         VALUES ($1,$2,$3,$4,$5,'Прийняття офера')`,
        [employee.id, vacancy.position_id, vacancy.department_id, vacancy.hiring_manager_employee_id || null, offer.start_date]
      );
      await client.query(`UPDATE hr_positions SET status = 'Filled', updated_at = now() WHERE id = $1`, [vacancy.position_id]);
    }

    const { rows: offerRows } = await client.query(
      `UPDATE hr_offers SET status = 'Accepted', employee_id = $2, approved_by = COALESCE($3, approved_by), updated_at = now() WHERE id = $1 RETURNING *`,
      [id, employee.id, approved_by ?? null]
    );
    await client.query(`UPDATE hr_applications SET status = 'Hired', stage = 'Hired', updated_at = now() WHERE id = $1`, [offer.application_id]);
    await client.query(`UPDATE hr_vacancies SET status = 'Filled', updated_at = now() WHERE id = $1`, [application.vacancy_id]);

    await client.query('COMMIT');
    await writeAudit({ actor, action: 'offer_accepted', entity_type: 'offer', entity_id: id, new_value: { employee_id: employee.id } });

    // Best-effort: пробація і onboarding-задачі не мають блокувати сам
    // факт прийняття офера, якщо тут щось піде не так.
    try {
      await setProbation(employee.id, { probation_goals: offer.probation_goals || '' });
      if (vacancy?.position_id || vacancy?.department_id) {
        await generateOnboardingTasks(employee.id, { department_id: vacancy.department_id, position_id: vacancy.position_id, start_date: offer.start_date }, actor);
        await generateLearningAssignments(employee.id, { department_id: vacancy.department_id, position_id: vacancy.position_id }, actor);
      }
    } catch (sideEffectError) {
      console.error('offer_accepted onboarding/probation side effect ERROR:', sideEffectError?.message || sideEffectError);
    }

    return offerRows[0];
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------
// Onboarding / Adaptation — templates library
// ---------------------------------------------------------------------

async function listOnboardingTemplates({ department_id = null, position_id = null } = {}) {
  const conditions = ['t.active = true'];
  const params = [];
  if (department_id) {
    params.push(department_id);
    conditions.push(`t.department_id = $${params.length}`);
  }
  if (position_id) {
    params.push(position_id);
    conditions.push(`t.position_id = $${params.length}`);
  }
  const { rows } = await pool.query(`
    SELECT t.*, d.name AS department_name, p.title AS position_title
    FROM hr_onboarding_templates t
    LEFT JOIN hr_departments d ON d.id = t.department_id
    LEFT JOIN hr_positions p ON p.id = t.position_id
    WHERE ${conditions.join(' AND ')}
    ORDER BY t.scope, t.milestone, t.id
  `, params);
  return rows;
}

async function createOnboardingTemplate({ scope, department_id, position_id, milestone, title, description, owner_role, due_offset_days, required }) {
  if (!ONBOARDING_TEMPLATE_SCOPES.includes(scope)) throw new Error(`Unknown template scope: ${scope}`);
  if (!ONBOARDING_MILESTONES.includes(milestone)) throw new Error(`Unknown milestone: ${milestone}`);
  const { rows } = await pool.query(
    `INSERT INTO hr_onboarding_templates (scope, department_id, position_id, milestone, title, description, owner_role, due_offset_days, required)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [scope, scope === 'Department' ? department_id : null, scope === 'Position' ? position_id : null, milestone, title,
      description || '', owner_role || '', due_offset_days ?? 0, required ?? true]
  );
  return rows[0];
}

async function updateOnboardingTemplate(id, { title, description, owner_role, due_offset_days, required, active }) {
  const { rows } = await pool.query(
    `UPDATE hr_onboarding_templates SET
       title = COALESCE($2, title),
       description = COALESCE($3, description),
       owner_role = COALESCE($4, owner_role),
       due_offset_days = COALESCE($5, due_offset_days),
       required = COALESCE($6, required),
       active = COALESCE($7, active)
     WHERE id = $1 RETURNING *`,
    [id, title ?? null, description ?? null, owner_role ?? null, due_offset_days ?? null, required ?? null, active ?? null]
  );
  return rows[0] || null;
}

// ---------------------------------------------------------------------
// Onboarding / Adaptation — per-employee tasks
// ---------------------------------------------------------------------

// Генерує задачі з усіх активних шаблонів, що підходять під Company +
// департамент + посаду співробітника. Ідемпотентно: шаблон, з якого вже
// створена задача цьому співробітнику, повторно не застосовується —
// можна безпечно викликати ще раз після додавання нових шаблонів.
async function generateOnboardingTasks(employeeId, { department_id, position_id, start_date }, createdBy) {
  const { rows: templates } = await pool.query(`
    SELECT * FROM hr_onboarding_templates
    WHERE active = true AND (
      scope = 'Company'
      OR (scope = 'Department' AND department_id = $1)
      OR (scope = 'Position' AND position_id = $2)
    )
  `, [department_id || null, position_id || null]);

  if (!templates.length) return [];

  const { rows: existing } = await pool.query(
    `SELECT template_id FROM hr_onboarding_tasks WHERE employee_id = $1 AND template_id IS NOT NULL`,
    [employeeId]
  );
  const existingTemplateIds = new Set(existing.map((r) => r.template_id));
  const toCreate = templates.filter((t) => !existingTemplateIds.has(t.id));
  if (!toCreate.length) return [];

  const created = [];
  for (const t of toCreate) {
    const dueDate = start_date ? new Date(start_date) : null;
    if (dueDate) dueDate.setDate(dueDate.getDate() + (t.due_offset_days || 0));
    const { rows } = await pool.query(
      `INSERT INTO hr_onboarding_tasks (employee_id, template_id, milestone, title, description, owner_role, due_date, required)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [employeeId, t.id, t.milestone, t.title, t.description, t.owner_role, dueDate ? dueDate.toISOString().slice(0, 10) : null, t.required]
    );
    created.push(rows[0]);
  }
  await writeAudit({ actor: createdBy, action: 'onboarding_tasks_generated', entity_type: 'employee', entity_id: employeeId, new_value: { count: created.length } });
  return created;
}

async function createAdHocOnboardingTask({ employee_id, milestone, title, description, owner_role, due_date, required }, createdBy) {
  if (!ONBOARDING_MILESTONES.includes(milestone)) throw new Error(`Unknown milestone: ${milestone}`);
  const { rows } = await pool.query(
    `INSERT INTO hr_onboarding_tasks (employee_id, milestone, title, description, owner_role, due_date, required)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [employee_id, milestone, title, description || '', owner_role || '', due_date || null, required ?? true]
  );
  await writeAudit({ actor: createdBy, action: 'create', entity_type: 'onboarding_task', entity_id: rows[0].id, new_value: { title } });
  return rows[0];
}

async function listOnboardingTasks(employeeId) {
  const { rows } = await pool.query(
    `SELECT * FROM hr_onboarding_tasks WHERE employee_id = $1 ORDER BY
       array_position(ARRAY['Day 1 / Week 1','14 days','30 days','60 days','90 days'], milestone), due_date NULLS LAST, id`,
    [employeeId]
  );
  const today = new Date().toISOString().slice(0, 10);
  return rows.map((t) => ({
    ...t,
    is_overdue: !!(t.due_date && t.due_date.toISOString().slice(0, 10) < today && !['Completed', 'Skipped'].includes(t.status))
  }));
}

async function updateOnboardingTask(id, { status, evidence_url, comment, skip_reason, due_date }, actor) {
  if (status && !ONBOARDING_TASK_STATUSES.includes(status)) {
    throw new Error(`Unknown onboarding task status: ${status}`);
  }
  if (status === 'Skipped' && !skip_reason) {
    throw new Error('Для пропуску задачі потрібно вказати причину');
  }
  const { rows: before } = await pool.query('SELECT status, employee_id FROM hr_onboarding_tasks WHERE id = $1', [id]);
  if (!before[0]) return null;
  const { rows } = await pool.query(
    `UPDATE hr_onboarding_tasks SET
       status = COALESCE($2, status),
       evidence_url = COALESCE($3, evidence_url),
       comment = COALESCE($4, comment),
       skip_reason = COALESCE($5, skip_reason),
       due_date = COALESCE($6, due_date),
       completed_at = CASE WHEN $2 = 'Completed' THEN now() ELSE completed_at END,
       updated_at = now()
     WHERE id = $1 RETURNING *`,
    [id, status ?? null, evidence_url ?? null, comment ?? null, skip_reason ?? null, due_date ?? null]
  );
  if (status && status !== before[0].status) {
    await writeAudit({ actor, action: 'status_change', entity_type: 'onboarding_task', entity_id: id, old_value: { status: before[0].status }, new_value: { status } });
  }
  return rows[0];
}

// ---------------------------------------------------------------------
// Preboarding
// ---------------------------------------------------------------------

async function getPreboardingInfo(employeeId) {
  const { rows } = await pool.query('SELECT * FROM hr_preboarding_info WHERE employee_id = $1', [employeeId]);
  return rows[0] || null;
}

async function upsertPreboardingInfo(employeeId, { workplace_location, hr_contact, documents_to_bring, first_day_agenda, welcome_letter_text }) {
  const { rows } = await pool.query(
    `INSERT INTO hr_preboarding_info (employee_id, workplace_location, hr_contact, documents_to_bring, first_day_agenda, welcome_letter_text)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (employee_id) DO UPDATE SET
       workplace_location = COALESCE($2, hr_preboarding_info.workplace_location),
       hr_contact = COALESCE($3, hr_preboarding_info.hr_contact),
       documents_to_bring = COALESCE($4, hr_preboarding_info.documents_to_bring),
       first_day_agenda = COALESCE($5, hr_preboarding_info.first_day_agenda),
       welcome_letter_text = COALESCE($6, hr_preboarding_info.welcome_letter_text),
       updated_at = now()
     RETURNING *`,
    [employeeId, workplace_location ?? '', hr_contact ?? '', documents_to_bring ?? '', first_day_agenda ?? '', welcome_letter_text ?? '']
  );
  return rows[0];
}

// Текст листа — початковий чорновик; лишається editable (ТЗ 20), тому
// це лише генератор чорновика, не джерело правди.
function buildWelcomeLetterText({ full_name, first_hire_date, position_title, department_name }, info) {
  const dateStr = first_hire_date ? new Date(first_hire_date).toLocaleDateString('uk-UA') : '[дата]';
  return `Вітаємо в Fresh Black, ${full_name || '[ім\'я]'}!

Твій перший робочий день: ${dateStr}${info?.workplace_location ? ', ' + info.workplace_location : ''}.
Посада: ${position_title || '[посада]'}${department_name ? ', ' + department_name : ''}.
${info?.hr_contact ? 'Контакт HR: ' + info.hr_contact + '.' : ''}
${info?.documents_to_bring ? '\nДокументи, які треба взяти з собою:\n' + info.documents_to_bring : ''}
${info?.first_day_agenda ? '\nПлан першого дня:\n' + info.first_day_agenda : ''}

До зустрічі!`;
}

// ---------------------------------------------------------------------
// Probation control (ТЗ 23.1)
// ---------------------------------------------------------------------

function computeProbationEndDate(firstHireDate, periodDays) {
  if (!firstHireDate) return null;
  const d = new Date(firstHireDate);
  d.setDate(d.getDate() + (periodDays || 90));
  return d.toISOString().slice(0, 10);
}

async function setProbation(employeeId, { probation_period_days, probation_goals }) {
  const { rows: empRows } = await pool.query('SELECT first_hire_date FROM hr_employees WHERE id = $1', [employeeId]);
  if (!empRows[0]) return null;
  const periodDays = probation_period_days ?? 90;
  const endDate = computeProbationEndDate(empRows[0].first_hire_date, periodDays);
  const { rows } = await pool.query(
    `UPDATE hr_employees SET
       probation_period_days = $2,
       probation_end_date = $3,
       probation_goals = COALESCE($4, probation_goals),
       updated_at = now()
     WHERE id = $1 RETURNING *`,
    [employeeId, periodDays, endDate, probation_goals ?? null]
  );
  return rows[0] || null;
}

async function recordProbationDecision(employeeId, { decision, reason, new_end_date }, actor) {
  if (!PROBATION_DECISIONS.includes(decision)) throw new Error(`Unknown probation decision: ${decision}`);
  if (decision === 'Extended' && (!new_end_date || !reason)) {
    throw new Error('Продовження випробувального терміну вимагає нової дати і причини');
  }
  const { rows: before } = await pool.query('SELECT probation_decision, probation_end_date FROM hr_employees WHERE id = $1', [employeeId]);
  if (!before[0]) return null;
  const { rows } = await pool.query(
    `UPDATE hr_employees SET
       probation_decision = $2,
       probation_decision_reason = COALESCE($3, ''),
       probation_decision_date = CURRENT_DATE,
       probation_end_date = COALESCE($4, probation_end_date),
       updated_at = now()
     WHERE id = $1 RETURNING *`,
    [employeeId, decision, reason ?? null, decision === 'Extended' ? new_end_date : null]
  );
  await writeAudit({
    actor, action: 'probation_decision', entity_type: 'employee', entity_id: employeeId,
    old_value: { decision: before[0].probation_decision, end_date: before[0].probation_end_date },
    new_value: { decision, reason, new_end_date }
  });
  return rows[0];
}

// ---------------------------------------------------------------------
// Performance — 1:1
// ---------------------------------------------------------------------

async function listOneOnOnes(employeeId) {
  const { rows } = await pool.query(`
    SELECT o.*, per.full_name AS manager_name
    FROM hr_one_on_ones o
    LEFT JOIN hr_employees mgr ON mgr.id = o.manager_employee_id
    LEFT JOIN hr_persons per ON per.id = mgr.person_id
    WHERE o.employee_id = $1
    ORDER BY o.meeting_date DESC, o.id DESC
  `, [employeeId]);
  const withActions = [];
  for (const row of rows) {
    const { rows: actions } = await pool.query('SELECT * FROM hr_one_on_one_actions WHERE one_on_one_id = $1 ORDER BY id', [row.id]);
    withActions.push({ ...row, actions });
  }
  return withActions;
}

async function createOneOnOne({ employee_id, manager_employee_id, meeting_date, cadence, shared_notes, private_notes, status }, createdBy) {
  if (status && !ONE_ON_ONE_STATUSES.includes(status)) throw new Error(`Unknown 1:1 status: ${status}`);
  const { rows } = await pool.query(
    `INSERT INTO hr_one_on_ones (employee_id, manager_employee_id, meeting_date, cadence, shared_notes, private_notes, status, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [employee_id, manager_employee_id || null, meeting_date || new Date().toISOString().slice(0, 10), cadence || '',
      shared_notes || '', private_notes || '', status || 'Planned', createdBy || '']
  );
  return rows[0];
}

async function updateOneOnOne(id, { meeting_date, cadence, shared_notes, private_notes, status }) {
  if (status && !ONE_ON_ONE_STATUSES.includes(status)) throw new Error(`Unknown 1:1 status: ${status}`);
  const { rows } = await pool.query(
    `UPDATE hr_one_on_ones SET
       meeting_date = COALESCE($2, meeting_date),
       cadence = COALESCE($3, cadence),
       shared_notes = COALESCE($4, shared_notes),
       private_notes = COALESCE($5, private_notes),
       status = COALESCE($6, status),
       updated_at = now()
     WHERE id = $1 RETURNING *`,
    [id, meeting_date ?? null, cadence ?? null, shared_notes ?? null, private_notes ?? null, status ?? null]
  );
  return rows[0] || null;
}

async function addOneOnOneAction({ one_on_one_id, title, owner_username, due_date }) {
  const { rows } = await pool.query(
    `INSERT INTO hr_one_on_one_actions (one_on_one_id, title, owner_username, due_date) VALUES ($1,$2,$3,$4) RETURNING *`,
    [one_on_one_id, title, owner_username || '', due_date || null]
  );
  return rows[0];
}

async function updateOneOnOneAction(id, { status }) {
  if (status && !ACTION_ITEM_STATUSES.includes(status)) throw new Error(`Unknown action item status: ${status}`);
  const { rows } = await pool.query(
    `UPDATE hr_one_on_one_actions SET status = COALESCE($2, status) WHERE id = $1 RETURNING *`,
    [id, status ?? null]
  );
  return rows[0] || null;
}

// ---------------------------------------------------------------------
// Performance Review
// ---------------------------------------------------------------------

async function listPerformanceReviews(employeeId) {
  const { rows } = await pool.query(
    `SELECT * FROM hr_performance_reviews WHERE employee_id = $1 ORDER BY COALESCE(period_start, created_at::date) DESC, id DESC`,
    [employeeId]
  );
  return rows;
}

async function createPerformanceReview({ employee_id, period_label, period_start, period_end, goals_results, competencies_notes,
  manager_feedback, employee_self_review, hr_comments, final_outcome, development_actions, status }, createdBy) {
  if (status && !PERFORMANCE_REVIEW_STATUSES.includes(status)) throw new Error(`Unknown review status: ${status}`);
  const { rows } = await pool.query(
    `INSERT INTO hr_performance_reviews (employee_id, period_label, period_start, period_end, goals_results, competencies_notes,
       manager_feedback, employee_self_review, hr_comments, final_outcome, development_actions, status, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
    [employee_id, period_label || '', period_start || null, period_end || null, goals_results || '', competencies_notes || '',
      manager_feedback || '', employee_self_review || '', hr_comments || '', final_outcome || '', development_actions || '',
      status || 'Draft', createdBy || '']
  );
  await writeAudit({ actor: createdBy, action: 'create', entity_type: 'performance_review', entity_id: rows[0].id, new_value: { period_label } });
  return rows[0];
}

async function updatePerformanceReview(id, fields) {
  if (fields.status && !PERFORMANCE_REVIEW_STATUSES.includes(fields.status)) throw new Error(`Unknown review status: ${fields.status}`);
  const cols = ['period_label', 'period_start', 'period_end', 'goals_results', 'competencies_notes', 'manager_feedback',
    'employee_self_review', 'hr_comments', 'final_outcome', 'development_actions', 'status'].filter((c) => fields[c] !== undefined);
  if (!cols.length) {
    const { rows } = await pool.query('SELECT * FROM hr_performance_reviews WHERE id = $1', [id]);
    return rows[0] || null;
  }
  const setClause = cols.map((c, i) => `${c} = $${i + 2}`).join(', ');
  const { rows } = await pool.query(
    `UPDATE hr_performance_reviews SET ${setClause}, updated_at = now() WHERE id = $1 RETURNING *`,
    [id, ...cols.map((c) => fields[c])]
  );
  return rows[0] || null;
}

// ---------------------------------------------------------------------
// OKR
// ---------------------------------------------------------------------

function withKeyResultProgress(kr) {
  const span = Number(kr.target_value) - Number(kr.start_value);
  const progress_pct = span !== 0 ? Math.round(((Number(kr.current_value) - Number(kr.start_value)) / span) * 1000) / 10 : null;
  return { ...kr, progress_pct };
}

async function listObjectives({ owner_type = '', owner_department_id = null, owner_employee_id = null, period = '' } = {}) {
  const conditions = [];
  const params = [];
  if (owner_type) { params.push(owner_type); conditions.push(`o.owner_type = $${params.length}`); }
  if (owner_department_id) { params.push(owner_department_id); conditions.push(`o.owner_department_id = $${params.length}`); }
  if (owner_employee_id) { params.push(owner_employee_id); conditions.push(`o.owner_employee_id = $${params.length}`); }
  if (period) { params.push(period); conditions.push(`o.period = $${params.length}`); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await pool.query(`
    SELECT o.*, d.name AS department_name, per.full_name AS employee_name
    FROM hr_okr_objectives o
    LEFT JOIN hr_departments d ON d.id = o.owner_department_id
    LEFT JOIN hr_employees emp ON emp.id = o.owner_employee_id
    LEFT JOIN hr_persons per ON per.id = emp.person_id
    ${where}
    ORDER BY o.period DESC, o.created_at DESC
  `, params);
  return rows;
}

async function getObjective(id) {
  const { rows } = await pool.query(`
    SELECT o.*, d.name AS department_name, per.full_name AS employee_name
    FROM hr_okr_objectives o
    LEFT JOIN hr_departments d ON d.id = o.owner_department_id
    LEFT JOIN hr_employees emp ON emp.id = o.owner_employee_id
    LEFT JOIN hr_persons per ON per.id = emp.person_id
    WHERE o.id = $1
  `, [id]);
  if (!rows[0]) return null;
  const { rows: krs } = await pool.query('SELECT * FROM hr_okr_key_results WHERE objective_id = $1 ORDER BY id', [id]);
  const keyResults = [];
  for (const kr of krs) {
    const { rows: checkins } = await pool.query('SELECT * FROM hr_okr_checkins WHERE key_result_id = $1 ORDER BY created_at DESC', [kr.id]);
    keyResults.push({ ...withKeyResultProgress(kr), checkins });
  }
  return { ...rows[0], key_results: keyResults };
}

async function createObjective({ title, description, owner_type, owner_department_id, owner_employee_id, parent_objective_id, period }, createdBy) {
  if (!OKR_OWNER_TYPES.includes(owner_type)) throw new Error(`Unknown OKR owner type: ${owner_type}`);
  const { rows } = await pool.query(
    `INSERT INTO hr_okr_objectives (title, description, owner_type, owner_department_id, owner_employee_id, parent_objective_id, period, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [title, description || '', owner_type, owner_type === 'Department' ? owner_department_id || null : null,
      owner_type === 'Individual' ? owner_employee_id || null : null, parent_objective_id || null, period || '', createdBy || '']
  );
  return rows[0];
}

async function updateObjectiveStatus(id, status) {
  if (!OKR_OBJECTIVE_STATUSES.includes(status)) throw new Error(`Unknown objective status: ${status}`);
  const { rows } = await pool.query(
    `UPDATE hr_okr_objectives SET status = $2, updated_at = now() WHERE id = $1 RETURNING *`,
    [id, status]
  );
  return rows[0] || null;
}

async function createKeyResult({ objective_id, title, metric_unit, start_value, target_value, current_value }) {
  const { rows } = await pool.query(
    `INSERT INTO hr_okr_key_results (objective_id, title, metric_unit, start_value, target_value, current_value)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [objective_id, title, metric_unit || '', start_value ?? 0, target_value ?? 0, current_value ?? (start_value ?? 0)]
  );
  return withKeyResultProgress(rows[0]);
}

async function addOkrCheckin({ key_result_id, value, comment }, createdBy) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: checkinRows } = await client.query(
      `INSERT INTO hr_okr_checkins (key_result_id, value, comment, created_by) VALUES ($1,$2,$3,$4) RETURNING *`,
      [key_result_id, value, comment || '', createdBy || '']
    );
    const { rows: krRows } = await client.query(
      `UPDATE hr_okr_key_results SET current_value = $2, updated_at = now() WHERE id = $1 RETURNING *`,
      [key_result_id, value]
    );
    await client.query('COMMIT');
    return { checkin: checkinRows[0], key_result: withKeyResultProgress(krRows[0]) };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function updateKeyResultConfidence(id, confidence) {
  if (!OKR_CONFIDENCE_LEVELS.includes(confidence)) throw new Error(`Unknown confidence level: ${confidence}`);
  const { rows } = await pool.query(
    `UPDATE hr_okr_key_results SET confidence = $2, updated_at = now() WHERE id = $1 RETURNING *`,
    [id, confidence]
  );
  return rows[0] ? withKeyResultProgress(rows[0]) : null;
}

// ---------------------------------------------------------------------
// KPI
// ---------------------------------------------------------------------

async function listKpiTemplates({ position_id = null } = {}) {
  const conditions = ['t.active = true'];
  const params = [];
  if (position_id) { params.push(position_id); conditions.push(`t.position_id = $${params.length}`); }
  const { rows } = await pool.query(`
    SELECT t.*, p.title AS position_title
    FROM hr_kpi_templates t JOIN hr_positions p ON p.id = t.position_id
    WHERE ${conditions.join(' AND ')}
    ORDER BY p.title, t.name
  `, params);
  return rows;
}

async function createKpiTemplate({ position_id, name, metric, target, weight }) {
  const { rows } = await pool.query(
    `INSERT INTO hr_kpi_templates (position_id, name, metric, target, weight) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [position_id, name, metric || '', target ?? null, weight ?? null]
  );
  return rows[0];
}

async function updateKpiTemplate(id, { name, metric, target, weight, active }) {
  const { rows } = await pool.query(
    `UPDATE hr_kpi_templates SET
       name = COALESCE($2, name), metric = COALESCE($3, metric), target = COALESCE($4, target),
       weight = COALESCE($5, weight), active = COALESCE($6, active)
     WHERE id = $1 RETURNING *`,
    [id, name ?? null, metric ?? null, target ?? null, weight ?? null, active ?? null]
  );
  return rows[0] || null;
}

function withKpiAchievement(kpi) {
  const achievement_pct = (kpi.target && Number(kpi.target) !== 0 && kpi.actual != null)
    ? Math.round((Number(kpi.actual) / Number(kpi.target)) * 1000) / 10
    : null;
  return { ...kpi, achievement_pct };
}

async function listKpisForEmployee(employeeId) {
  const { rows } = await pool.query('SELECT * FROM hr_kpis WHERE employee_id = $1 ORDER BY created_at DESC', [employeeId]);
  return rows.map(withKpiAchievement);
}

async function createKpiForEmployee({ employee_id, template_id, name, metric, target, weight, period, source }, createdBy) {
  let base = { name, metric, target, weight };
  if (template_id) {
    const { rows: tRows } = await pool.query('SELECT * FROM hr_kpi_templates WHERE id = $1', [template_id]);
    if (tRows[0]) {
      base = {
        name: name || tRows[0].name,
        metric: metric || tRows[0].metric,
        target: target ?? tRows[0].target,
        weight: weight ?? tRows[0].weight
      };
    }
  }
  if (source && !KPI_SOURCES.includes(source)) throw new Error(`Unknown KPI source: ${source}`);
  const { rows } = await pool.query(
    `INSERT INTO hr_kpis (employee_id, template_id, name, metric, target, weight, period, source, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [employee_id, template_id || null, base.name, base.metric || '', base.target ?? null, base.weight ?? null,
      period || '', source || 'Manual', createdBy || '']
  );
  return withKpiAchievement(rows[0]);
}

async function updateKpi(id, { actual, comment, status }) {
  if (status && !KPI_STATUSES.includes(status)) throw new Error(`Unknown KPI status: ${status}`);
  const { rows } = await pool.query(
    `UPDATE hr_kpis SET
       actual = COALESCE($2, actual), comment = COALESCE($3, comment), status = COALESCE($4, status), updated_at = now()
     WHERE id = $1 RETURNING *`,
    [id, actual ?? null, comment ?? null, status ?? null]
  );
  return rows[0] ? withKpiAchievement(rows[0]) : null;
}

// ---------------------------------------------------------------------
// Development Plan / PDP
// ---------------------------------------------------------------------

async function listDevelopmentPlanItems(employeeId) {
  const { rows } = await pool.query('SELECT * FROM hr_development_plan_items WHERE employee_id = $1 ORDER BY due_date NULLS LAST, id DESC', [employeeId]);
  return rows;
}

async function createDevelopmentPlanItem({ employee_id, goal, skill_competency, action, learning_item, owner_username, due_date, success_criteria, review_date }, createdBy) {
  const { rows } = await pool.query(
    `INSERT INTO hr_development_plan_items (employee_id, goal, skill_competency, action, learning_item, owner_username, due_date, success_criteria, review_date, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [employee_id, goal, skill_competency || '', action || '', learning_item || '', owner_username || '', due_date || null,
      success_criteria || '', review_date || null, createdBy || '']
  );
  return rows[0];
}

async function updateDevelopmentPlanItem(id, { status, action, learning_item, due_date, success_criteria, review_date }) {
  if (status && !PDP_ITEM_STATUSES.includes(status)) throw new Error(`Unknown PDP item status: ${status}`);
  const { rows } = await pool.query(
    `UPDATE hr_development_plan_items SET
       status = COALESCE($2, status), action = COALESCE($3, action), learning_item = COALESCE($4, learning_item),
       due_date = COALESCE($5, due_date), success_criteria = COALESCE($6, success_criteria), review_date = COALESCE($7, review_date),
       updated_at = now()
     WHERE id = $1 RETURNING *`,
    [id, status ?? null, action ?? null, learning_item ?? null, due_date ?? null, success_criteria ?? null, review_date ?? null]
  );
  return rows[0] || null;
}

// ---------------------------------------------------------------------
// Knowledge Base — articles
// ---------------------------------------------------------------------

async function listKbArticles({ category = '', audience_type = '', search = '' } = {}) {
  const conditions = ['a.active = true'];
  const params = [];
  if (category) { params.push(category); conditions.push(`a.category = $${params.length}`); }
  if (audience_type) { params.push(audience_type); conditions.push(`a.audience_type = $${params.length}`); }
  if (search) { params.push(`%${search.toLowerCase()}%`); conditions.push(`lower(a.title) LIKE $${params.length}`); }
  const { rows } = await pool.query(`
    SELECT a.*, d.name AS audience_department_name, p.title AS audience_position_title
    FROM hr_kb_articles a
    LEFT JOIN hr_departments d ON d.id = a.audience_department_id
    LEFT JOIN hr_positions p ON p.id = a.audience_position_id
    WHERE ${conditions.join(' AND ')}
    ORDER BY a.category, lower(a.title)
  `, params);
  return rows;
}

async function getKbArticle(id) {
  const { rows } = await pool.query('SELECT * FROM hr_kb_articles WHERE id = $1', [id]);
  return rows[0] || null;
}

async function createKbArticle({ title, category, content, video_url, file_url, link_url, owner_username,
  audience_type, audience_department_id, audience_position_id, mandatory }, createdBy) {
  if (category && !KB_CATEGORIES.includes(category)) throw new Error(`Unknown category: ${category}`);
  if (audience_type && !KB_AUDIENCE_TYPES.includes(audience_type)) throw new Error(`Unknown audience type: ${audience_type}`);
  const { rows } = await pool.query(
    `INSERT INTO hr_kb_articles (title, category, content, video_url, file_url, link_url, owner_username, audience_type, audience_department_id, audience_position_id, mandatory, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
    [title, category || '', content || '', video_url || '', file_url || '', link_url || '', owner_username || '',
      audience_type || 'Company', audience_type === 'Department' ? audience_department_id || null : null,
      audience_type === 'Position' ? audience_position_id || null : null, !!mandatory, createdBy || '']
  );
  return rows[0];
}

async function updateKbArticle(id, { title, category, content, video_url, file_url, link_url, owner_username, mandatory, active,
  audience_type, audience_department_id, audience_position_id }) {
  if (category && !KB_CATEGORIES.includes(category)) throw new Error(`Unknown category: ${category}`);
  if (audience_type && !KB_AUDIENCE_TYPES.includes(audience_type)) throw new Error(`Unknown audience type: ${audience_type}`);
  const { rows } = await pool.query(
    `UPDATE hr_kb_articles SET
       title = COALESCE($2, title),
       category = COALESCE($3, category),
       content = COALESCE($4, content),
       video_url = COALESCE($5, video_url),
       file_url = COALESCE($6, file_url),
       link_url = COALESCE($7, link_url),
       owner_username = COALESCE($8, owner_username),
       mandatory = COALESCE($9, mandatory),
       active = COALESCE($10, active),
       audience_type = COALESCE($11, audience_type),
       audience_department_id = CASE WHEN $11 = 'Department' THEN $12 WHEN $11 IS NOT NULL THEN NULL ELSE audience_department_id END,
       audience_position_id = CASE WHEN $11 = 'Position' THEN $13 WHEN $11 IS NOT NULL THEN NULL ELSE audience_position_id END,
       version = CASE WHEN $4 IS NOT NULL THEN version + 1 ELSE version END,
       updated_at = now()
     WHERE id = $1 RETURNING *`,
    [id, title ?? null, category ?? null, content ?? null, video_url ?? null, file_url ?? null, link_url ?? null,
      owner_username ?? null, mandatory ?? null, active ?? null, audience_type ?? null,
      audience_department_id ?? null, audience_position_id ?? null]
  );
  return rows[0] || null;
}

// ---------------------------------------------------------------------
// Knowledge Base — mandatory reading assignments
// ---------------------------------------------------------------------

async function listKbAssignmentsForEmployee(employeeId) {
  const { rows } = await pool.query(`
    SELECT ka.*, a.title AS article_title, a.category AS article_category, a.version AS article_current_version
    FROM hr_kb_assignments ka JOIN hr_kb_articles a ON a.id = ka.article_id
    WHERE ka.employee_id = $1
    ORDER BY ka.due_date NULLS LAST, ka.id DESC
  `, [employeeId]);
  return rows;
}

async function assignKbArticle({ article_id, employee_id, due_date }, createdBy) {
  const { rows } = await pool.query(
    `INSERT INTO hr_kb_assignments (article_id, employee_id, due_date, created_by)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (article_id, employee_id) DO NOTHING RETURNING *`,
    [article_id, employee_id, due_date || null, createdBy || '']
  );
  if (rows[0]) return rows[0];
  const { rows: existing } = await pool.query('SELECT * FROM hr_kb_assignments WHERE article_id = $1 AND employee_id = $2', [article_id, employee_id]);
  return existing[0];
}

// Масове призначення всім активним співробітникам, що підпадають під
// audience статті (ТЗ 24 "Position automation"). Ідемпотентно — вже
// призначеним не дублює.
async function assignArticleToAudience(articleId, createdBy) {
  const article = await getKbArticle(articleId);
  if (!article) throw new Error('Статтю не знайдено');
  if (article.audience_type === 'Individual' || article.audience_type === 'Company') {
    throw new Error('Масове призначення доступне лише для audience Department/Position');
  }
  const conditions = ['ep.end_date IS NULL', 'e.active = true'];
  const params = [];
  if (article.audience_type === 'Department' && article.audience_department_id) {
    params.push(article.audience_department_id);
    conditions.push(`ep.department_id = $${params.length}`);
  } else if (article.audience_type === 'Position' && article.audience_position_id) {
    params.push(article.audience_position_id);
    conditions.push(`ep.position_id = $${params.length}`);
  } else {
    return [];
  }
  const { rows: employees } = await pool.query(`
    SELECT DISTINCT e.id FROM hr_employees e JOIN hr_employment_periods ep ON ep.employee_id = e.id
    WHERE ${conditions.join(' AND ')}
  `, params);
  const created = [];
  for (const emp of employees) {
    const assignment = await assignKbArticle({ article_id: articleId, employee_id: emp.id }, createdBy);
    created.push(assignment);
  }
  return created;
}

async function acknowledgeKbAssignment(id) {
  const { rows: before } = await pool.query('SELECT article_id FROM hr_kb_assignments WHERE id = $1', [id]);
  if (!before[0]) return null;
  const article = await getKbArticle(before[0].article_id);
  const { rows } = await pool.query(
    `UPDATE hr_kb_assignments SET status = 'Acknowledged', acknowledged_at = now(), acknowledged_version = $2 WHERE id = $1 RETURNING *`,
    [id, article?.version || null]
  );
  return rows[0] || null;
}

// ---------------------------------------------------------------------
// Learning Paths
// ---------------------------------------------------------------------

async function listLearningPaths({ department_id = null, position_id = null } = {}) {
  const conditions = ['lp.active = true'];
  const params = [];
  if (department_id) { params.push(department_id); conditions.push(`lp.department_id = $${params.length}`); }
  if (position_id) { params.push(position_id); conditions.push(`lp.position_id = $${params.length}`); }
  const { rows } = await pool.query(`
    SELECT lp.*, d.name AS department_name, p.title AS position_title,
      (SELECT COUNT(*)::int FROM hr_learning_path_items i WHERE i.learning_path_id = lp.id) AS item_count
    FROM hr_learning_paths lp
    LEFT JOIN hr_departments d ON d.id = lp.department_id
    LEFT JOIN hr_positions p ON p.id = lp.position_id
    WHERE ${conditions.join(' AND ')}
    ORDER BY lp.created_at DESC
  `, params);
  return rows;
}

async function getLearningPath(id) {
  const { rows } = await pool.query(`
    SELECT lp.*, d.name AS department_name, p.title AS position_title
    FROM hr_learning_paths lp
    LEFT JOIN hr_departments d ON d.id = lp.department_id
    LEFT JOIN hr_positions p ON p.id = lp.position_id
    WHERE lp.id = $1
  `, [id]);
  if (!rows[0]) return null;
  const { rows: items } = await pool.query('SELECT * FROM hr_learning_path_items WHERE learning_path_id = $1 ORDER BY order_index, id', [id]);
  return { ...rows[0], items };
}

async function createLearningPath({ title, description, scope, department_id, position_id }, createdBy) {
  if (!LEARNING_PATH_SCOPES.includes(scope)) throw new Error(`Unknown learning path scope: ${scope}`);
  const { rows } = await pool.query(
    `INSERT INTO hr_learning_paths (title, description, scope, department_id, position_id, created_by)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [title, description || '', scope, scope === 'Department' ? department_id || null : null, scope === 'Position' ? position_id || null : null, createdBy || '']
  );
  return rows[0];
}

async function updateLearningPath(id, { title, description, active }) {
  const { rows } = await pool.query(
    `UPDATE hr_learning_paths SET title = COALESCE($2, title), description = COALESCE($3, description), active = COALESCE($4, active) WHERE id = $1 RETURNING *`,
    [id, title ?? null, description ?? null, active ?? null]
  );
  return rows[0] || null;
}

async function addLearningPathItem({ learning_path_id, title, item_type, kb_article_id }) {
  if (item_type && !LEARNING_ITEM_TYPES.includes(item_type)) throw new Error(`Unknown item type: ${item_type}`);
  const { rows: maxRows } = await pool.query('SELECT COALESCE(MAX(order_index), -1) AS max_order FROM hr_learning_path_items WHERE learning_path_id = $1', [learning_path_id]);
  const { rows } = await pool.query(
    `INSERT INTO hr_learning_path_items (learning_path_id, order_index, title, item_type, kb_article_id)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [learning_path_id, maxRows[0].max_order + 1, title, item_type || 'Article', kb_article_id || null]
  );
  return rows[0];
}

// ---------------------------------------------------------------------
// Learning assignments (per-employee progress)
// ---------------------------------------------------------------------

// Ідемпотентно, аналогічно generateOnboardingTasks — шлях, вже
// призначений цьому співробітнику, повторно не дублюється.
async function generateLearningAssignments(employeeId, { department_id, position_id }, createdBy) {
  const { rows: paths } = await pool.query(`
    SELECT * FROM hr_learning_paths
    WHERE active = true AND (
      (scope = 'Department' AND department_id = $1)
      OR (scope = 'Position' AND position_id = $2)
    )
  `, [department_id || null, position_id || null]);
  const created = [];
  for (const path of paths) {
    const { rows } = await pool.query(
      `INSERT INTO hr_learning_assignments (learning_path_id, employee_id, created_by)
       VALUES ($1,$2,$3) ON CONFLICT (learning_path_id, employee_id) DO NOTHING RETURNING *`,
      [path.id, employeeId, createdBy || '']
    );
    if (rows[0]) created.push(rows[0]);
  }
  return created;
}

async function listLearningAssignmentsForEmployee(employeeId) {
  const { rows } = await pool.query(`
    SELECT la.*, lp.title AS path_title,
      (SELECT COUNT(*)::int FROM hr_learning_path_items i WHERE i.learning_path_id = la.learning_path_id) AS item_count,
      (SELECT COUNT(*)::int FROM hr_learning_item_progress ip WHERE ip.assignment_id = la.id) AS completed_count
    FROM hr_learning_assignments la
    JOIN hr_learning_paths lp ON lp.id = la.learning_path_id
    WHERE la.employee_id = $1
    ORDER BY la.created_at DESC
  `, [employeeId]);
  return rows.map((r) => ({ ...r, progress_pct: r.item_count ? Math.round((r.completed_count / r.item_count) * 100) : 0 }));
}

async function getLearningAssignment(id) {
  const { rows } = await pool.query(`
    SELECT la.*, lp.title AS path_title FROM hr_learning_assignments la JOIN hr_learning_paths lp ON lp.id = la.learning_path_id WHERE la.id = $1
  `, [id]);
  if (!rows[0]) return null;
  const { rows: items } = await pool.query('SELECT * FROM hr_learning_path_items WHERE learning_path_id = $1 ORDER BY order_index, id', [rows[0].learning_path_id]);
  const { rows: progress } = await pool.query('SELECT item_id FROM hr_learning_item_progress WHERE assignment_id = $1', [id]);
  const completedIds = new Set(progress.map((p) => p.item_id));
  return { ...rows[0], items: items.map((i) => ({ ...i, completed: completedIds.has(i.id) })) };
}

async function markLearningItemComplete(assignmentId, itemId) {
  await pool.query(
    `INSERT INTO hr_learning_item_progress (assignment_id, item_id) VALUES ($1,$2) ON CONFLICT (assignment_id, item_id) DO NOTHING`,
    [assignmentId, itemId]
  );
  const { rows: before } = await pool.query('SELECT status FROM hr_learning_assignments WHERE id = $1', [assignmentId]);
  if (before[0] && before[0].status === 'Assigned') {
    await pool.query(`UPDATE hr_learning_assignments SET status = 'Started', started_at = now() WHERE id = $1`, [assignmentId]);
  }
  return getLearningAssignment(assignmentId);
}

async function completeLearningAssignment(id, { test_result }) {
  const { rows } = await pool.query(
    `UPDATE hr_learning_assignments SET status = 'Completed', completed_at = now(), test_result = COALESCE($2, test_result) WHERE id = $1 RETURNING *`,
    [id, test_result ?? null]
  );
  return rows[0] || null;
}

// ---------------------------------------------------------------------
// Surveys & Engagement
// ---------------------------------------------------------------------

async function listSurveys({ type = '', status = '' } = {}) {
  const conditions = [];
  const params = [];
  if (type) { params.push(type); conditions.push(`s.type = $${params.length}`); }
  if (status) { params.push(status); conditions.push(`s.status = $${params.length}`); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await pool.query(`
    SELECT s.*, per.full_name AS linked_employee_name,
      (SELECT COUNT(*)::int FROM hr_survey_invitations i WHERE i.survey_id = s.id) AS invitation_count,
      (SELECT COUNT(*)::int FROM hr_survey_responses r WHERE r.survey_id = s.id) AS response_count
    FROM hr_surveys s
    LEFT JOIN hr_employees emp ON emp.id = s.linked_employee_id
    LEFT JOIN hr_persons per ON per.id = emp.person_id
    ${where}
    ORDER BY s.created_at DESC
  `, params);
  return rows;
}

async function getSurvey(id) {
  const { rows } = await pool.query(`
    SELECT s.*, per.full_name AS linked_employee_name,
      (SELECT COUNT(*)::int FROM hr_survey_invitations i WHERE i.survey_id = s.id) AS invitation_count,
      (SELECT COUNT(*)::int FROM hr_survey_responses r WHERE r.survey_id = s.id) AS response_count
    FROM hr_surveys s
    LEFT JOIN hr_employees emp ON emp.id = s.linked_employee_id
    LEFT JOIN hr_persons per ON per.id = emp.person_id
    WHERE s.id = $1
  `, [id]);
  if (!rows[0]) return null;
  const { rows: questions } = await pool.query('SELECT * FROM hr_survey_questions WHERE survey_id = $1 ORDER BY order_index, id', [id]);
  return { ...rows[0], questions };
}

async function createSurvey({ title, type, anonymous, linked_employee_id }, createdBy) {
  if (!SURVEY_TYPES.includes(type)) throw new Error(`Unknown survey type: ${type}`);
  const { rows } = await pool.query(
    `INSERT INTO hr_surveys (title, type, anonymous, linked_employee_id, created_by)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [title, type, !!anonymous, linked_employee_id || null, createdBy || '']
  );
  const survey = rows[0];

  // eNPS має фіксовану структуру з ТЗ 26: "0–10 + reason/comments".
  if (type === 'eNPS') {
    await addSurveyQuestion({ survey_id: survey.id, question_text: 'Наскільки ймовірно ви порекомендуєте компанію як місце роботи? (0-10)', question_type: 'NPS', required: true });
    await addSurveyQuestion({ survey_id: survey.id, question_text: 'Чому ви поставили таку оцінку?', question_type: 'Text', required: false });
  }
  return survey;
}

async function updateSurveyStatus(id, status) {
  if (!SURVEY_STATUSES.includes(status)) throw new Error(`Unknown survey status: ${status}`);
  const { rows } = await pool.query(
    `UPDATE hr_surveys SET status = $2, updated_at = now() WHERE id = $1 RETURNING *`,
    [id, status]
  );
  return rows[0] || null;
}

async function addSurveyQuestion({ survey_id, question_text, question_type, options, required }) {
  if (!SURVEY_QUESTION_TYPES.includes(question_type)) throw new Error(`Unknown question type: ${question_type}`);
  const { rows: maxRows } = await pool.query('SELECT COALESCE(MAX(order_index), -1) AS max_order FROM hr_survey_questions WHERE survey_id = $1', [survey_id]);
  const { rows } = await pool.query(
    `INSERT INTO hr_survey_questions (survey_id, order_index, question_text, question_type, options, required)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [survey_id, maxRows[0].max_order + 1, question_text, question_type, JSON.stringify(options || []), required ?? true]
  );
  return rows[0];
}

async function inviteEmployees(surveyId, employeeIds) {
  const created = [];
  for (const employeeId of employeeIds) {
    const { rows } = await pool.query(
      `INSERT INTO hr_survey_invitations (survey_id, employee_id) VALUES ($1,$2) ON CONFLICT (survey_id, employee_id) DO NOTHING RETURNING *`,
      [surveyId, employeeId]
    );
    if (rows[0]) created.push(rows[0]);
  }
  return created;
}

async function inviteAllActiveEmployees(surveyId) {
  const { rows: employees } = await pool.query(`SELECT id FROM hr_employees WHERE active = true AND status IN ('Active', 'Probation', 'Part-time')`);
  return inviteEmployees(surveyId, employees.map((e) => e.id));
}

// Одна відповідь на опитування на співробітника — повторна спроба
// відповісти повертає зрозумілу помилку, а не тихо перезаписує.
async function submitSurveyResponse({ survey_id, employee_id, answers }, submittedBy) {
  const { rows: existing } = await pool.query('SELECT id FROM hr_survey_responses WHERE survey_id = $1 AND employee_id = $2', [survey_id, employee_id]);
  if (existing[0]) throw new Error('Цей співробітник вже відповів на опитування');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: respRows } = await client.query(
      `INSERT INTO hr_survey_responses (survey_id, employee_id, submitted_by) VALUES ($1,$2,$3) RETURNING *`,
      [survey_id, employee_id, submittedBy || '']
    );
    const response = respRows[0];
    for (const a of (answers || [])) {
      await client.query(
        `INSERT INTO hr_survey_answers (response_id, question_id, answer_text, answer_value, answer_options)
         VALUES ($1,$2,$3,$4,$5)`,
        [response.id, a.question_id, a.answer_text || '', a.answer_value ?? null, JSON.stringify(a.answer_options || [])]
      );
    }
    await client.query('COMMIT');
    return response;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

// Агрегація по кожному питанню, з повагою до anonymous (не повертаємо
// respondent name, якщо опитування анонімне — ТЗ 26).
async function getSurveyResults(surveyId) {
  const survey = await getSurvey(surveyId);
  if (!survey) return null;

  const { rows: responses } = await pool.query(`
    SELECT r.id, r.employee_id, per.full_name
    FROM hr_survey_responses r
    JOIN hr_employees emp ON emp.id = r.employee_id
    JOIN hr_persons per ON per.id = emp.person_id
    WHERE r.survey_id = $1
  `, [surveyId]);

  const responseRate = survey.invitation_count ? Math.round((responses.length / survey.invitation_count) * 1000) / 10 : null;

  const questionResults = [];
  for (const q of survey.questions) {
    const { rows: answers } = await pool.query(`
      SELECT a.*, r.employee_id FROM hr_survey_answers a JOIN hr_survey_responses r ON r.id = a.response_id
      WHERE a.question_id = $1
    `, [q.id]);

    const result = { question_id: q.id, question_text: q.question_text, question_type: q.question_type, answer_count: answers.length };

    if (q.question_type === 'Scale' || q.question_type === 'NPS') {
      const values = answers.map((a) => Number(a.answer_value)).filter((v) => !isNaN(v));
      result.average = values.length ? Math.round((values.reduce((s, v) => s + v, 0) / values.length) * 100) / 100 : null;
      if (q.question_type === 'NPS' && values.length) {
        const promoters = values.filter((v) => v >= 9).length;
        const detractors = values.filter((v) => v <= 6).length;
        result.nps_score = Math.round(((promoters - detractors) / values.length) * 100);
      }
    } else if (q.question_type === 'Single Select' || q.question_type === 'Multi Select') {
      const distribution = {};
      answers.forEach((a) => {
        const opts = q.question_type === 'Single Select' ? [a.answer_text].filter(Boolean) : (a.answer_options || []);
        opts.forEach((opt) => { distribution[opt] = (distribution[opt] || 0) + 1; });
      });
      result.distribution = distribution;
    } else {
      result.texts = survey.anonymous
        ? answers.map((a) => a.answer_text).filter(Boolean)
        : answers.map((a) => ({ text: a.answer_text, employee_name: responses.find((r) => r.employee_id === a.employee_id)?.full_name || '' })).filter((x) => x.text);
    }

    questionResults.push(result);
  }

  return {
    survey,
    response_count: responses.length,
    response_rate: responseRate,
    respondents: survey.anonymous ? undefined : responses.map((r) => r.full_name),
    questions: questionResults
  };
}

// ---------------------------------------------------------------------
// HR Operations: absences
// ---------------------------------------------------------------------

function countWorkdays(startDate, endDate) {
  const start = new Date(startDate);
  const end = new Date(endDate);
  let count = 0;
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const day = d.getDay();
    if (day !== 0 && day !== 6) count++;
  }
  return count;
}

async function listAbsences({ employee_id = null, department_id = null, status = '', from = '', to = '' } = {}) {
  const conditions = [];
  const params = [];
  if (employee_id) { params.push(employee_id); conditions.push(`a.employee_id = $${params.length}`); }
  if (status) { params.push(status); conditions.push(`a.status = $${params.length}`); }
  if (from) { params.push(from); conditions.push(`a.end_date >= $${params.length}`); }
  if (to) { params.push(to); conditions.push(`a.start_date <= $${params.length}`); }
  if (department_id) { params.push(department_id); conditions.push(`ep.department_id = $${params.length}`); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await pool.query(`
    SELECT a.*, per.full_name AS employee_name, dep.name AS department_name
    FROM hr_absences a
    JOIN hr_employees emp ON emp.id = a.employee_id
    JOIN hr_persons per ON per.id = emp.person_id
    LEFT JOIN hr_employment_periods ep ON ep.employee_id = a.employee_id AND ep.end_date IS NULL
    LEFT JOIN hr_departments dep ON dep.id = ep.department_id
    ${where}
    ORDER BY a.start_date DESC
  `, params);
  return rows;
}

async function createAbsence({ employee_id, type, start_date, end_date, comment, document_url }, createdBy) {
  if (!ABSENCE_TYPES.includes(type)) throw new Error(`Unknown absence type: ${type}`);
  if (new Date(end_date) < new Date(start_date)) throw new Error('Дата завершення не може бути раніше дати початку');
  const workdays = countWorkdays(start_date, end_date);
  const { rows } = await pool.query(
    `INSERT INTO hr_absences (employee_id, type, start_date, end_date, workdays, comment, document_url, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [employee_id, type, start_date, end_date, workdays, comment || '', document_url || '', createdBy || '']
  );
  await writeAudit({ actor: createdBy, action: 'create', entity_type: 'absence', entity_id: rows[0].id, new_value: { type, start_date, end_date } });
  return rows[0];
}

async function updateAbsenceStatus(id, status, approver_username, actor) {
  if (!ABSENCE_STATUSES.includes(status)) throw new Error(`Unknown absence status: ${status}`);
  const { rows: before } = await pool.query('SELECT status FROM hr_absences WHERE id = $1', [id]);
  if (!before[0]) return null;
  const { rows } = await pool.query(
    `UPDATE hr_absences SET status = $2, approver_username = COALESCE($3, approver_username), updated_at = now() WHERE id = $1 RETURNING *`,
    [id, status, approver_username ?? null]
  );
  await writeAudit({ actor, action: 'status_change', entity_type: 'absence', entity_id: id, old_value: { status: before[0].status }, new_value: { status } });
  return rows[0];
}

async function updateAbsence(id, { comment, document_url }) {
  const { rows } = await pool.query(
    `UPDATE hr_absences SET comment = COALESCE($2, comment), document_url = COALESCE($3, document_url), updated_at = now() WHERE id = $1 RETURNING *`,
    [id, comment ?? null, document_url ?? null]
  );
  return rows[0] || null;
}

// ---------------------------------------------------------------------
// Offboarding
// ---------------------------------------------------------------------

// ТЗ 28.1: "Analytics separates Voluntary / Involuntary / Probation
// turnover" — обчислюємо з initiation_type, окремо не зберігаємо.
function turnoverClassification(initiationType) {
  if (initiationType === 'Probation Failed') return 'Probation';
  if (initiationType === 'Employee Initiative' || initiationType === 'Mutual Agreement') return 'Voluntary';
  if (initiationType === 'Company Initiative' || initiationType === 'End of Contract') return 'Involuntary';
  return 'Other';
}

async function listOffboardingCases({ status = '' } = {}) {
  const conditions = [];
  const params = [];
  if (status) { params.push(status); conditions.push(`c.status = $${params.length}`); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await pool.query(`
    SELECT c.*, per.full_name AS employee_name
    FROM hr_offboarding_cases c
    JOIN hr_employees emp ON emp.id = c.employee_id
    JOIN hr_persons per ON per.id = emp.person_id
    ${where}
    ORDER BY c.created_at DESC
  `, params);
  return rows.map((c) => ({ ...c, turnover_classification: turnoverClassification(c.initiation_type) }));
}

async function getOffboardingCasesForEmployee(employeeId) {
  const { rows } = await pool.query('SELECT * FROM hr_offboarding_cases WHERE employee_id = $1 ORDER BY created_at DESC', [employeeId]);
  return rows.map((c) => ({ ...c, turnover_classification: turnoverClassification(c.initiation_type) }));
}

async function getOffboardingCase(id) {
  const { rows } = await pool.query(`
    SELECT c.*, per.full_name AS employee_name
    FROM hr_offboarding_cases c
    JOIN hr_employees emp ON emp.id = c.employee_id
    JOIN hr_persons per ON per.id = emp.person_id
    WHERE c.id = $1
  `, [id]);
  if (!rows[0]) return null;
  const { rows: checklist } = await pool.query('SELECT * FROM hr_offboarding_checklist_items WHERE case_id = $1 ORDER BY category, id', [id]);
  const { rows: exitInterview } = await pool.query('SELECT * FROM hr_exit_interviews WHERE case_id = $1', [id]);
  return {
    ...rows[0],
    turnover_classification: turnoverClassification(rows[0].initiation_type),
    checklist,
    exit_interview: exitInterview[0] || null
  };
}

function buildOffboardingStatementText({ full_name, initiation_date, last_working_day, initiation_type }) {
  const initDate = initiation_date ? new Date(initiation_date).toLocaleDateString('uk-UA') : '[дата]';
  const lastDay = last_working_day ? new Date(last_working_day).toLocaleDateString('uk-UA') : '[дата]';
  return `Заява на звільнення

Співробітник: ${full_name || '[ПІБ]'}
Дата подання: ${initDate}
Останній робочий день: ${lastDay}
Підстава: ${initiation_type || '[підстава]'}

Прошу вважати ${lastDay} останнім робочим днем.`;
}

async function initiateOffboarding({ employee_id, initiation_type, initiation_date, last_working_day }, createdBy) {
  if (!OFFBOARDING_INITIATION_TYPES.includes(initiation_type)) throw new Error(`Unknown initiation type: ${initiation_type}`);
  const { rows: empRows } = await pool.query(`
    SELECT e.*, per.full_name FROM hr_employees e JOIN hr_persons per ON per.id = e.person_id WHERE e.id = $1
  `, [employee_id]);
  if (!empRows[0]) throw new Error('Співробітника не знайдено');

  const statementText = buildOffboardingStatementText({
    full_name: empRows[0].full_name, initiation_date: initiation_date || new Date().toISOString().slice(0, 10),
    last_working_day, initiation_type
  });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO hr_offboarding_cases (employee_id, initiation_type, initiation_date, last_working_day, statement_text, created_by)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [employee_id, initiation_type, initiation_date || new Date().toISOString().slice(0, 10), last_working_day || null, statementText, createdBy || '']
    );
    await client.query(`UPDATE hr_employees SET status = 'Leaving', updated_at = now() WHERE id = $1`, [employee_id]);
    await client.query('COMMIT');
    await writeAudit({ actor: createdBy, action: 'offboarding_initiated', entity_type: 'employee', entity_id: employee_id, new_value: { initiation_type, case_id: rows[0].id } });
    return rows[0];
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function updateOffboardingCase(id, { last_working_day, statement_text }) {
  const { rows } = await pool.query(
    `UPDATE hr_offboarding_cases SET
       last_working_day = COALESCE($2, last_working_day),
       statement_text = COALESCE($3, statement_text),
       updated_at = now()
     WHERE id = $1 RETURNING *`,
    [id, last_working_day ?? null, statement_text ?? null]
  );
  return rows[0] || null;
}

async function updateOffboardingCaseStatus(id, status, actor) {
  if (!OFFBOARDING_STATUSES.includes(status)) throw new Error(`Unknown offboarding status: ${status}`);
  const { rows: before } = await pool.query('SELECT status FROM hr_offboarding_cases WHERE id = $1', [id]);
  if (!before[0]) return null;
  const { rows } = await pool.query(
    `UPDATE hr_offboarding_cases SET status = $2, updated_at = now() WHERE id = $1 RETURNING *`,
    [id, status]
  );
  await writeAudit({ actor, action: 'status_change', entity_type: 'offboarding_case', entity_id: id, old_value: { status: before[0].status }, new_value: { status } });
  return rows[0];
}

async function addOffboardingChecklistItem({ case_id, category, title }) {
  if (!OFFBOARDING_CHECKLIST_CATEGORIES.includes(category)) throw new Error(`Unknown checklist category: ${category}`);
  const { rows } = await pool.query(
    `INSERT INTO hr_offboarding_checklist_items (case_id, category, title) VALUES ($1,$2,$3) RETURNING *`,
    [case_id, category, title]
  );
  return rows[0];
}

async function updateOffboardingChecklistItem(id, { status }) {
  if (!OFFBOARDING_CHECKLIST_STATUSES.includes(status)) throw new Error(`Unknown checklist status: ${status}`);
  const { rows } = await pool.query(
    `UPDATE hr_offboarding_checklist_items SET status = $2, completed_at = CASE WHEN $2 = 'Done' THEN now() ELSE NULL END WHERE id = $1 RETURNING *`,
    [id, status]
  );
  return rows[0] || null;
}

async function upsertExitInterview({ case_id, primary_reason, secondary_reasons, good_notes, bad_notes, manager_notes, team_notes,
  conditions_notes, compensation_notes, growth_notes, processes_notes, what_could_retain, recommend_company, rehire_eligible, comments }, createdBy) {
  if (recommend_company && !RECOMMEND_COMPANY_OPTIONS.includes(recommend_company)) throw new Error(`Unknown recommend_company value: ${recommend_company}`);
  const { rows } = await pool.query(
    `INSERT INTO hr_exit_interviews (case_id, primary_reason, secondary_reasons, good_notes, bad_notes, manager_notes, team_notes,
       conditions_notes, compensation_notes, growth_notes, processes_notes, what_could_retain, recommend_company, rehire_eligible, comments, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
     ON CONFLICT (case_id) DO UPDATE SET
       primary_reason = EXCLUDED.primary_reason, secondary_reasons = EXCLUDED.secondary_reasons,
       good_notes = EXCLUDED.good_notes, bad_notes = EXCLUDED.bad_notes, manager_notes = EXCLUDED.manager_notes,
       team_notes = EXCLUDED.team_notes, conditions_notes = EXCLUDED.conditions_notes, compensation_notes = EXCLUDED.compensation_notes,
       growth_notes = EXCLUDED.growth_notes, processes_notes = EXCLUDED.processes_notes, what_could_retain = EXCLUDED.what_could_retain,
       recommend_company = EXCLUDED.recommend_company, rehire_eligible = EXCLUDED.rehire_eligible, comments = EXCLUDED.comments,
       updated_at = now()
     RETURNING *`,
    [case_id, primary_reason || '', secondary_reasons || '', good_notes || '', bad_notes || '', manager_notes || '', team_notes || '',
      conditions_notes || '', compensation_notes || '', growth_notes || '', processes_notes || '', what_could_retain || '',
      recommend_company || '', rehire_eligible ?? null, comments || '', createdBy || '']
  );
  return rows[0];
}

// Закриває процес: Employee → Former Employee, закриває поточний
// Employment Period, переносить rehire eligibility з exit interview
// (якщо є) — ТЗ 28 "Close".
async function closeOffboardingCase(id, actor) {
  const caseRow = await getOffboardingCase(id);
  if (!caseRow) return null;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: currentPeriod } = await client.query(
      `SELECT * FROM hr_employment_periods WHERE employee_id = $1 AND end_date IS NULL FOR UPDATE`,
      [caseRow.employee_id]
    );
    if (currentPeriod[0]) {
      const endDate = caseRow.last_working_day || new Date().toISOString().slice(0, 10);
      await client.query(`UPDATE hr_employment_periods SET end_date = $2 WHERE id = $1`, [currentPeriod[0].id, endDate]);
      const { rows: stillFilled } = await client.query(
        `SELECT 1 FROM hr_employment_periods WHERE position_id = $1 AND end_date IS NULL AND id != $2`,
        [currentPeriod[0].position_id, currentPeriod[0].id]
      );
      if (stillFilled.length === 0) {
        await client.query(`UPDATE hr_positions SET status = 'Vacant', updated_at = now() WHERE id = $1`, [currentPeriod[0].position_id]);
      }
    }
    await client.query(
      `UPDATE hr_employees SET status = 'Former Employee', rehire_eligible = COALESCE($2, rehire_eligible), updated_at = now() WHERE id = $1`,
      [caseRow.employee_id, caseRow.exit_interview?.rehire_eligible ?? null]
    );
    const { rows } = await client.query(
      `UPDATE hr_offboarding_cases SET status = 'Completed', completed_at = now(), updated_at = now() WHERE id = $1 RETURNING *`,
      [id]
    );
    await client.query('COMMIT');
    await writeAudit({ actor, action: 'offboarding_completed', entity_type: 'employee', entity_id: caseRow.employee_id, new_value: { case_id: id } });
    return rows[0];
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------
// Resume upload & parsing (ТЗ п.11)
// ---------------------------------------------------------------------

const EXT_MIME_TYPES = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  doc: 'application/msword',
  txt: 'text/plain'
};

// Деякі браузери/ОС при завантаженні файлу не проставляють коректний
// Content-Type для конкретної частини multipart-запиту (шлють порожньо або
// узагальнено 'application/octet-stream') — тоді сервер віддавав би файл із
// цим типом і браузер завжди пропонував "завантажити", а не відкривав його
// одразу (напр. PDF-резюме не показувалось у вкладці для друку). Якщо
// клієнт не дав чіткого типу — визначаємо його самі за розширенням файлу.
function inferMimeType(filename, mimeType) {
  if (mimeType && mimeType !== 'application/octet-stream') return mimeType;
  const ext = (filename.split('.').pop() || '').toLowerCase();
  return EXT_MIME_TYPES[ext] || mimeType || 'application/octet-stream';
}

// Postgres не приймає байт 0x00 у TEXT-колонках взагалі (незалежно від
// кодування) — деякі PDF (пошкоджені/нестандартно вбудовані шрифти) при
// розборі pdf-parse видають текст із null-байтами, і INSERT падав з
// "invalid byte sequence for encoding UTF8: 0x00". Прибираємо їх одразу
// після витягування, до будь-якого подальшого використання тексту
// (збереження, вгадування ПІБ/email/телефону).
function stripNullBytes(text) {
  return text.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');
}

async function extractResumeText(buffer, mimeType, filename) {
  const ext = (filename.split('.').pop() || '').toLowerCase();
  try {
    if (mimeType === 'application/pdf' || ext === 'pdf') {
      const parsed = await pdfParse(buffer);
      return { text: stripNullBytes(parsed.text || ''), parse_status: 'ok' };
    }
    if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || ext === 'docx') {
      const result = await mammoth.extractRawText({ buffer });
      return { text: stripNullBytes(result.value || ''), parse_status: 'ok' };
    }
    if (mimeType === 'text/plain' || ext === 'txt') {
      return { text: stripNullBytes(buffer.toString('utf8')), parse_status: 'ok' };
    }
    // .doc (старий бінарний формат), зображення (скани) — без OCR/AI не
    // розбираємо; файл все одно зберігається, текст просто порожній.
    return { text: '', parse_status: 'unsupported' };
  } catch (error) {
    console.error('extractResumeText ERROR:', error?.message || error);
    return { text: '', parse_status: 'failed' };
  }
}

function guessEmailFromText(text) {
  const match = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
  return match ? match[0] : '';
}

function guessPhoneFromText(text) {
  const match = text.match(/(\+?38)?[\s.\-(]*0\d{2}[\s.\-)]*\d{3}[\s.\-]*\d{2}[\s.\-]*\d{2}/);
  if (match) return match[0].replace(/[\s().]/g, '');
  const generic = text.match(/\+?\d[\d\s\-()]{8,14}\d/);
  return generic ? generic[0].replace(/[\s()]/g, '') : '';
}

// Без AI — евристика: перші кілька непорожніх рядків, шукаємо той, що
// виглядає як ПІБ (2-3 слова з великої літери, без цифр/@, розумна
// довжина). Завжди можна поправити вручну після імпорту.
function guessNameFromText(text, fallbackFilename) {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 15);
  const nameLike = /^[\p{Lu}][\p{L}'-]+(\s+[\p{Lu}][\p{L}'-]+){1,3}$/u;
  for (const line of lines) {
    if (line.length <= 60 && nameLike.test(line)) return line;
  }
  return fallbackFilename.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
}

// Один файл → або нова картка кандидата (createCandidate вже вміє
// dedupe за телефоном/email), або резюме доклеюється до вже існуючого
// кандидата, якщо збіг знайдено — жодного дублювання людини.
async function uploadResumeAndMatchCandidate({ buffer, filename, mimeType }, uploadedBy) {
  const { text, parse_status } = await extractResumeText(buffer, mimeType, filename);
  const guessed = {
    full_name: guessNameFromText(text, filename),
    email: guessEmailFromText(text),
    phone: guessPhoneFromText(text)
  };

  const { candidate, duplicate } = await createCandidate({
    full_name: guessed.full_name,
    phone: guessed.phone,
    personal_email: guessed.email,
    source: 'Resume Import'
  }, uploadedBy);

  const { rows } = await pool.query(
    `INSERT INTO hr_candidate_resumes (candidate_id, filename, mime_type, file_size, file_data, extracted_text, parse_status, uploaded_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, candidate_id, filename, mime_type, file_size, parse_status, created_at`,
    [candidate.id, filename, inferMimeType(filename, mimeType), buffer.length, buffer, text, parse_status, uploadedBy || '']
  );

  return { candidate, duplicate, resume: rows[0], guessed, parse_status };
}

async function addResumeToCandidate(candidateId, { buffer, filename, mimeType }, uploadedBy) {
  const { text, parse_status } = await extractResumeText(buffer, mimeType, filename);
  const { rows } = await pool.query(
    `INSERT INTO hr_candidate_resumes (candidate_id, filename, mime_type, file_size, file_data, extracted_text, parse_status, uploaded_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, candidate_id, filename, mime_type, file_size, parse_status, created_at`,
    [candidateId, filename, inferMimeType(filename, mimeType), buffer.length, buffer, text, parse_status, uploadedBy || '']
  );
  return rows[0];
}

async function listResumesForCandidate(candidateId) {
  const { rows } = await pool.query(
    `SELECT id, candidate_id, filename, mime_type, file_size, parse_status, created_at
     FROM hr_candidate_resumes WHERE candidate_id = $1 ORDER BY created_at DESC`,
    [candidateId]
  );
  return rows;
}

async function getResumeFile(resumeId) {
  const { rows } = await pool.query('SELECT filename, mime_type, file_data FROM hr_candidate_resumes WHERE id = $1', [resumeId]);
  return rows[0] || null;
}

// -- Файли, прикріплені до заявки на вакансію --

async function addVacancyRequestAttachment(vacancyRequestId, { buffer, filename, mimeType }, uploadedBy) {
  const { rows } = await pool.query(
    `INSERT INTO hr_vacancy_request_attachments (vacancy_request_id, filename, mime_type, file_size, file_data, uploaded_by)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, vacancy_request_id, filename, mime_type, file_size, created_at`,
    [vacancyRequestId, filename, inferMimeType(filename, mimeType), buffer.length, buffer, uploadedBy || '']
  );
  return rows[0];
}

async function listVacancyRequestAttachments(vacancyRequestId) {
  const { rows } = await pool.query(
    `SELECT id, vacancy_request_id, filename, mime_type, file_size, uploaded_by, created_at
     FROM hr_vacancy_request_attachments WHERE vacancy_request_id = $1 ORDER BY created_at DESC`,
    [vacancyRequestId]
  );
  return rows;
}

async function getVacancyRequestAttachmentFile(attachmentId) {
  const { rows } = await pool.query('SELECT filename, mime_type, file_data FROM hr_vacancy_request_attachments WHERE id = $1', [attachmentId]);
  return rows[0] || null;
}

// ---------------------------------------------------------------------
// Dashboard metrics — базові HR-метрики зі стандартними формулами
// (навмисно без повноцінної аналітики/фільтрів з ТЗ розділу 29, яку
// ТЗ прямо каже відкласти до стабілізації даних — це саме "основні
// метрики" на прохання користувача, з формулами для навчання команди).
// ---------------------------------------------------------------------

const ACTIVE_EMPLOYEE_STATUSES = ['Active', 'Probation', 'Part-time'];

async function countHeadcountAsOf(date) {
  const { rows } = await pool.query(`
    SELECT COUNT(DISTINCT e.id)::int AS count
    FROM hr_employees e
    JOIN hr_employment_periods ep ON ep.employee_id = e.id
    WHERE ep.start_date <= $1 AND (ep.end_date IS NULL OR ep.end_date >= $1)
  `, [date]);
  return rows[0].count;
}

async function getDashboardMetrics() {
  const now = new Date();
  const twelveMonthsAgo = new Date(now);
  twelveMonthsAgo.setFullYear(twelveMonthsAgo.getFullYear() - 1);
  const twelveMonthsAgoStr = twelveMonthsAgo.toISOString().slice(0, 10);

  const { rows: activeRows } = await pool.query(
    `SELECT e.id, e.status, per.gender, ep.start_date
     FROM hr_employees e
     JOIN hr_persons per ON per.id = e.person_id
     LEFT JOIN hr_employment_periods ep ON ep.employee_id = e.id AND ep.end_date IS NULL
     WHERE e.status = ANY($1) AND e.active = true`,
    [ACTIVE_EMPLOYEE_STATUSES]
  );
  const headcountNow = activeRows.length;
  const probationCount = activeRows.filter((r) => r.status === 'Probation').length;

  // Плинність кадрів (Turnover Rate) за останні 12 місяців:
  // (звільнення за період / середній headcount за період) × 100.
  // Середній headcount = (headcount зараз + headcount 12 міс тому) / 2.
  const headcount12moAgo = await countHeadcountAsOf(twelveMonthsAgoStr);
  const { rows: separationRows } = await pool.query(
    `SELECT initiation_type FROM hr_offboarding_cases WHERE status = 'Completed' AND completed_at >= $1`,
    [twelveMonthsAgo.toISOString()]
  );
  const separations12mo = separationRows.length;
  const avgHeadcount = (headcountNow + headcount12moAgo) / 2;
  const turnoverRatePct = avgHeadcount > 0 ? Math.round((separations12mo / avgHeadcount) * 1000) / 10 : null;
  const turnoverBreakdown = { Voluntary: 0, Involuntary: 0, Probation: 0, Other: 0 };
  separationRows.forEach((r) => { turnoverBreakdown[turnoverClassification(r.initiation_type)]++; });

  // Середній стаж серед активних співробітників, у місяцях.
  const tenureDaysList = activeRows.filter((r) => r.start_date).map((r) => (now - new Date(r.start_date)) / 86400000);
  const avgTenureMonths = tenureDaysList.length ? Math.round((tenureDaysList.reduce((s, d) => s + d, 0) / tenureDaysList.length / 30.44) * 10) / 10 : null;

  // Розподіл за стажем (ТЗ 21.2): <3м, 3-6м, 6-12м, 1-2р, 2-3р, 3+р.
  const tenureBuckets = { '<3 міс': 0, '3-6 міс': 0, '6-12 міс': 0, '1-2 роки': 0, '2-3 роки': 0, '3+ роки': 0 };
  tenureDaysList.forEach((days) => {
    const months = days / 30.44;
    if (months < 3) tenureBuckets['<3 міс']++;
    else if (months < 6) tenureBuckets['3-6 міс']++;
    else if (months < 12) tenureBuckets['6-12 міс']++;
    else if (months < 24) tenureBuckets['1-2 роки']++;
    else if (months < 36) tenureBuckets['2-3 роки']++;
    else tenureBuckets['3+ роки']++;
  });

  // Гендерний розподіл (ТЗ 21.2).
  const genderBreakdown = { Female: 0, Male: 0, 'Не вказано': 0 };
  activeRows.forEach((r) => {
    if (r.gender === 'Female') genderBreakdown.Female++;
    else if (r.gender === 'Male') genderBreakdown.Male++;
    else genderBreakdown['Не вказано']++;
  });

  // Vacant positions + департаменти (ті самі, що вже були на дашборді).
  const { rows: posRows } = await pool.query(`SELECT status FROM hr_positions WHERE active = true`);
  const vacantPositions = posRows.filter((p) => p.status === 'Vacant' || p.status === 'Recruitment Active').length;
  const { rows: deptCountRows } = await pool.query(`SELECT COUNT(*)::int AS count FROM hr_departments WHERE active = true`);

  // Час закриття вакансії (Time to Fill) — середня к-сть днів від
  // створення вакансії до переходу в статус Filled.
  const { rows: filledVacancies } = await pool.query(
    `SELECT EXTRACT(EPOCH FROM (updated_at - created_at)) / 86400 AS days FROM hr_vacancies WHERE status = 'Filled'`
  );
  const timeToFillDays = filledVacancies.length
    ? Math.round((filledVacancies.reduce((s, r) => s + Number(r.days), 0) / filledVacancies.length) * 10) / 10
    : null;

  // Воронка найму — активні заявки кандидатів по етапах.
  const { rows: funnelRows } = await pool.query(
    `SELECT stage, COUNT(*)::int AS count FROM hr_applications WHERE status = 'Active' GROUP BY stage`
  );
  const funnel = {};
  APPLICATION_STAGES.forEach((s) => { funnel[s] = 0; });
  funnelRows.forEach((r) => { funnel[r.stage] = r.count; });

  // % проходження випробувального терміну = Passed / (Passed + Failed).
  const { rows: probationRows } = await pool.query(
    `SELECT probation_decision, COUNT(*)::int AS count FROM hr_employees WHERE probation_decision != '' GROUP BY probation_decision`
  );
  const probationCounts = { Passed: 0, Extended: 0, Failed: 0 };
  probationRows.forEach((r) => { probationCounts[r.probation_decision] = r.count; });
  const probationDenominator = probationCounts.Passed + probationCounts.Failed;
  const probationPassRatePct = probationDenominator > 0 ? Math.round((probationCounts.Passed / probationDenominator) * 1000) / 10 : null;

  return {
    headcountNow,
    probationCount,
    vacantPositions,
    departmentsCount: deptCountRows[0].count,
    turnoverRatePct,
    turnoverBreakdown,
    separations12mo,
    avgTenureMonths,
    tenureBuckets,
    genderBreakdown,
    timeToFillDays,
    filledVacanciesCount: filledVacancies.length,
    funnel,
    probationCounts,
    probationPassRatePct
  };
}

function avgDaysFromRows(rows, field) {
  if (!rows.length) return null;
  const total = rows.reduce((s, r) => s + Number(r[field]), 0);
  return Math.round((total / rows.length) * 10) / 10;
}

// Recruiter Quality & Progress Dashboard (ТЗ розділ 30) — окремий,
// глибший зріз саме для рекрутингу: обсяг/вік вакансій, воронка,
// швидкість по етапах, джерела, причини відмов, ефективність по
// рекрутеру, список "потребує уваги". Усе, що можна порахувати з
// наявних даних без нової інфраструктури (без cost-трекінгу і
// SLA-правил, яких ще нема — див. docs/HR.md).
async function getRecruitmentMetrics() {
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 86400000);

  // -- Вакансії: обсяг і вік --
  const { rows: vacancyRows } = await pool.query(`
    SELECT v.id, v.title, v.status, v.created_at, v.updated_at, v.recruiter_username, d.name AS department_name
    FROM hr_vacancies v JOIN hr_departments d ON d.id = v.department_id
  `);
  const openVacancies = vacancyRows.filter((v) => v.status === 'Open');
  const onHoldVacancies = vacancyRows.filter((v) => v.status === 'On Hold');
  const newVacancies30d = vacancyRows.filter((v) => new Date(v.created_at) >= thirtyDaysAgo);
  const closedVacancies30d = vacancyRows.filter((v) => ['Filled', 'Cancelled', 'Closed'].includes(v.status) && new Date(v.updated_at) >= thirtyDaysAgo);
  const avgVacancyAgeDays = openVacancies.length
    ? Math.round((openVacancies.reduce((s, v) => s + (now - new Date(v.created_at)) / 86400000, 0) / openVacancies.length) * 10) / 10
    : null;
  const vacancyAging = openVacancies
    .map((v) => ({ id: v.id, title: v.title, department_name: v.department_name, days_open: Math.round((now - new Date(v.created_at)) / 86400000) }))
    .sort((a, b) => b.days_open - a.days_open)
    .slice(0, 10);

  // -- Кандидати та воронка --
  const { rows: candidateRows } = await pool.query(`SELECT id, source, created_at FROM hr_candidates`);
  const candidatesTotal = candidateRows.length;
  const candidatesNew30d = candidateRows.filter((c) => new Date(c.created_at) >= thirtyDaysAgo).length;
  const { rows: appCountRows } = await pool.query(`SELECT COUNT(*)::int AS count FROM hr_applications`);
  const candidatesPerVacancy = vacancyRows.length ? Math.round((appCountRows[0].count / vacancyRows.length) * 10) / 10 : null;

  const { rows: interviewTypeRows } = await pool.query(`SELECT interview_type, COUNT(*)::int AS count FROM hr_interviews GROUP BY interview_type`);
  const interviewsByType = {};
  INTERVIEW_TYPES.forEach((t) => { interviewsByType[t] = 0; });
  interviewTypeRows.forEach((r) => { interviewsByType[r.interview_type || 'Не вказано'] = r.count; });

  const { rows: offerStatusRows } = await pool.query(`SELECT status, COUNT(*)::int AS count FROM hr_offers GROUP BY status`);
  const offersByStatus = {};
  OFFER_STATUSES.forEach((s) => { offersByStatus[s] = 0; });
  offerStatusRows.forEach((r) => { offersByStatus[r.status] = r.count; });

  const { rows: hiredRows } = await pool.query(`SELECT id, created_at, updated_at FROM hr_applications WHERE status = 'Hired'`);
  const hiresTotal = hiredRows.length;
  const hires30d = hiredRows.filter((r) => new Date(r.updated_at) >= thirtyDaysAgo).length;
  const overallConversionPct = candidatesTotal > 0 ? Math.round((hiresTotal / candidatesTotal) * 1000) / 10 : null;

  // -- Швидкість по етапах --
  const { rows: screeningAudit } = await pool.query(`
    SELECT DISTINCT ON (entity_id) entity_id, created_at
    FROM hr_audit_log
    WHERE entity_type = 'application' AND action = 'stage_change' AND new_value->>'stage' = 'Screening'
    ORDER BY entity_id, created_at ASC
  `);
  const { rows: appsForScreening } = await pool.query(`SELECT id, created_at FROM hr_applications`);
  const appCreatedById = Object.fromEntries(appsForScreening.map((a) => [a.id, a.created_at]));
  const screeningDeltas = screeningAudit
    .filter((r) => appCreatedById[r.entity_id])
    .map((r) => ({ delta: (new Date(r.created_at) - new Date(appCreatedById[r.entity_id])) / 86400000 }));
  const timeToScreeningDays = screeningDeltas.length ? avgDaysFromRows(screeningDeltas, 'delta') : null;

  const { rows: firstInterviewRows } = await pool.query(`
    SELECT a.created_at AS app_created, MIN(iv.created_at) AS first_interview
    FROM hr_applications a JOIN hr_interviews iv ON iv.application_id = a.id
    GROUP BY a.id, a.created_at
  `);
  const timeToInterviewDays = avgDaysFromRows(
    firstInterviewRows.map((r) => ({ delta: (new Date(r.first_interview) - new Date(r.app_created)) / 86400000 })), 'delta'
  );

  const { rows: firstOfferRows } = await pool.query(`
    SELECT a.created_at AS app_created, MIN(o.created_at) AS first_offer
    FROM hr_applications a JOIN hr_offers o ON o.application_id = a.id
    GROUP BY a.id, a.created_at
  `);
  const timeToOfferDays = avgDaysFromRows(
    firstOfferRows.map((r) => ({ delta: (new Date(r.first_offer) - new Date(r.app_created)) / 86400000 })), 'delta'
  );

  const timeToHireDays = avgDaysFromRows(
    hiredRows.map((r) => ({ delta: (new Date(r.updated_at) - new Date(r.created_at)) / 86400000 })), 'delta'
  );

  // -- Джерела кандидатів --
  const { rows: sourceAllRows } = await pool.query(`SELECT source, COUNT(*)::int AS count FROM hr_candidates GROUP BY source`);
  const sourceOfCandidates = {};
  sourceAllRows.forEach((r) => { sourceOfCandidates[r.source || 'Не вказано'] = r.count; });

  const { rows: sourceHireRows } = await pool.query(`
    SELECT c.source, COUNT(DISTINCT c.id)::int AS count
    FROM hr_candidates c JOIN hr_applications a ON a.candidate_id = c.id
    WHERE a.status = 'Hired'
    GROUP BY c.source
  `);
  const sourceOfHire = {};
  sourceHireRows.forEach((r) => { sourceOfHire[r.source || 'Не вказано'] = r.count; });

  const sourceConversionPct = {};
  Object.keys(sourceOfCandidates).forEach((src) => {
    const hires = sourceOfHire[src] || 0;
    sourceConversionPct[src] = sourceOfCandidates[src] > 0 ? Math.round((hires / sourceOfCandidates[src]) * 1000) / 10 : 0;
  });

  const { rows: sourceProbationRows } = await pool.query(`
    SELECT c.source, e.probation_decision, COUNT(*)::int AS count
    FROM hr_candidates c
    JOIN hr_persons per ON per.id = c.person_id
    JOIN hr_employees e ON e.person_id = per.id
    WHERE e.probation_decision != ''
    GROUP BY c.source, e.probation_decision
  `);
  const sourceQualityAgg = {};
  sourceProbationRows.forEach((r) => {
    const src = r.source || 'Не вказано';
    sourceQualityAgg[src] = sourceQualityAgg[src] || { Passed: 0, Failed: 0 };
    if (r.probation_decision === 'Passed' || r.probation_decision === 'Failed') sourceQualityAgg[src][r.probation_decision] = r.count;
  });
  const sourceQualityPassRatePct = {};
  Object.entries(sourceQualityAgg).forEach(([src, counts]) => {
    const denom = counts.Passed + counts.Failed;
    sourceQualityPassRatePct[src] = denom > 0 ? Math.round((counts.Passed / denom) * 1000) / 10 : null;
  });

  // -- Причини відмов: company (ми відмовили) vs candidate (кандидат відмовився) --
  const { rows: rejectionRows } = await pool.query(
    `SELECT rejection_reason, COUNT(*)::int AS count FROM hr_applications WHERE rejection_reason != '' GROUP BY rejection_reason`
  );
  const companyRejectionReasons = {};
  const candidateDeclineReasons = {};
  rejectionRows.forEach((r) => {
    if (REJECTION_REASONS_COMPANY.includes(r.rejection_reason)) companyRejectionReasons[r.rejection_reason] = r.count;
    else if (REJECTION_REASONS_CANDIDATE.includes(r.rejection_reason)) candidateDeclineReasons[r.rejection_reason] = r.count;
  });

  // -- Ефективність по рекрутеру (за vacancy.recruiter_username) --
  const recruiterStats = {};
  vacancyRows.forEach((v) => {
    if (!v.recruiter_username) return;
    recruiterStats[v.recruiter_username] = recruiterStats[v.recruiter_username] || { activeVacancies: 0, hires: 0, hireDeltas: [] };
    if (v.status === 'Open' || v.status === 'On Hold') recruiterStats[v.recruiter_username].activeVacancies++;
  });
  const { rows: hiresByRecruiterRows } = await pool.query(`
    SELECT v.recruiter_username, a.created_at, a.updated_at
    FROM hr_applications a JOIN hr_vacancies v ON v.id = a.vacancy_id
    WHERE a.status = 'Hired' AND v.recruiter_username != ''
  `);
  hiresByRecruiterRows.forEach((r) => {
    recruiterStats[r.recruiter_username] = recruiterStats[r.recruiter_username] || { activeVacancies: 0, hires: 0, hireDeltas: [] };
    recruiterStats[r.recruiter_username].hires++;
    recruiterStats[r.recruiter_username].hireDeltas.push((new Date(r.updated_at) - new Date(r.created_at)) / 86400000);
  });
  const recruiterPerformance = Object.entries(recruiterStats).map(([username, s]) => ({
    username,
    activeVacancies: s.activeVacancies,
    hires: s.hires,
    avgTimeToHireDays: s.hireDeltas.length ? Math.round((s.hireDeltas.reduce((a, b) => a + b, 0) / s.hireDeltas.length) * 10) / 10 : null
  }));

  // -- Потребує уваги: активні заявки без наступної дії / прострочені / "завислі" --
  const { rows: activeAppRows } = await pool.query(`
    SELECT a.id, a.next_action, a.next_action_date, a.updated_at, a.created_at, per.full_name AS candidate_name, v.title AS vacancy_title
    FROM hr_applications a
    JOIN hr_candidates c ON c.id = a.candidate_id
    JOIN hr_persons per ON per.id = c.person_id
    JOIN hr_vacancies v ON v.id = a.vacancy_id
    WHERE a.status = 'Active'
  `);
  const { rows: lastStageChangeRows } = await pool.query(`
    SELECT DISTINCT ON (entity_id) entity_id, created_at
    FROM hr_audit_log
    WHERE entity_type = 'application' AND action = 'stage_change'
    ORDER BY entity_id, created_at DESC
  `);
  const lastStageChangeById = Object.fromEntries(lastStageChangeRows.map((r) => [r.entity_id, r.created_at]));

  const withoutNextAction = activeAppRows.filter((a) => !a.next_action);
  const overdueNextAction = activeAppRows.filter((a) => a.next_action_date && new Date(a.next_action_date) < now);
  const stuckCandidates = activeAppRows.filter((a) => {
    const lastMoved = lastStageChangeById[a.id] || a.created_at;
    return (now - new Date(lastMoved)) / 86400000 > 14;
  }).map((a) => ({ ...a, days_stuck: Math.round((now - new Date(lastStageChangeById[a.id] || a.created_at)) / 86400000) }));

  return {
    openVacancies: openVacancies.length,
    onHoldVacancies: onHoldVacancies.length,
    newVacancies30d: newVacancies30d.length,
    closedVacancies30d: closedVacancies30d.length,
    avgVacancyAgeDays,
    vacancyAging,
    candidatesTotal,
    candidatesNew30d,
    candidatesPerVacancy,
    interviewsByType,
    offersByStatus,
    hiresTotal,
    hires30d,
    overallConversionPct,
    timeToScreeningDays,
    timeToInterviewDays,
    timeToOfferDays,
    timeToHireDays,
    sourceOfCandidates,
    sourceOfHire,
    sourceConversionPct,
    sourceQualityPassRatePct,
    companyRejectionReasons,
    candidateDeclineReasons,
    recruiterPerformance,
    withoutNextActionCount: withoutNextAction.length,
    withoutNextActionList: withoutNextAction.slice(0, 10).map((a) => ({ id: a.id, candidate_name: a.candidate_name, vacancy_title: a.vacancy_title })),
    overdueNextActionCount: overdueNextAction.length,
    overdueNextActionList: overdueNextAction.slice(0, 10).map((a) => ({ id: a.id, candidate_name: a.candidate_name, vacancy_title: a.vacancy_title, next_action_date: a.next_action_date })),
    stuckCandidatesCount: stuckCandidates.length,
    stuckCandidatesList: stuckCandidates.sort((a, b) => b.days_stuck - a.days_stuck).slice(0, 10).map((a) => ({ id: a.id, candidate_name: a.candidate_name, vacancy_title: a.vacancy_title, days_stuck: a.days_stuck }))
  };
}

export default {
  initSchema,
  EMPLOYEE_STATUSES,
  POSITION_STATUSES,
  RESERVATION_STATUSES,
  VACANCY_REQUEST_STATUSES,
  VACANCY_STATUSES,
  APPLICATION_STAGES,
  APPLICATION_STATUSES,
  REJECTION_REASONS_COMPANY,
  REJECTION_REASONS_CANDIDATE,
  OFFER_STATUSES,
  INTERVIEW_TYPES,
  INTERVIEW_STATUSES,
  createAccountIfMissingWithHash,
  findAccountByUsername,
  verifyAccountPassword,
  createSession,
  touchSession,
  deleteSession,
  cleanupExpiredSessions,
  writeAudit,
  listAuditLog,
  listDepartments,
  createDepartment,
  updateDepartment,
  listPositions,
  createPosition,
  updatePosition,
  listEmployees,
  getEmployee,
  createEmployee,
  updatePersonFields,
  updateEmployeeStatus,
  updateEmployeeFields,
  changeEmployment,
  addCompensationRecord,
  getOrgTree,
  listVacancyRequests,
  getVacancyRequest,
  createVacancyRequest,
  createVacancyRequestFromFile,
  updateVacancyRequest,
  updateVacancyRequestStatus,
  convertVacancyRequestToVacancy,
  listVacancies,
  getVacancy,
  createVacancy,
  updateVacancy,
  updateVacancyStatus,
  findDuplicateCandidate,
  createCandidate,
  listCandidates,
  getCandidate,
  updateCandidateFields,
  deleteCandidate,
  listApplicationsForVacancy,
  getApplication,
  createApplication,
  updateApplicationStage,
  updateApplicationStatus,
  createInterview,
  listInterviewsForApplication,
  updateInterview,
  createOffer,
  getOffer,
  updateOffer,
  updateOfferStatus,
  ONBOARDING_MILESTONES,
  ONBOARDING_TASK_STATUSES,
  ONBOARDING_TEMPLATE_SCOPES,
  PROBATION_DECISIONS,
  listOnboardingTemplates,
  createOnboardingTemplate,
  updateOnboardingTemplate,
  generateOnboardingTasks,
  createAdHocOnboardingTask,
  listOnboardingTasks,
  updateOnboardingTask,
  getPreboardingInfo,
  upsertPreboardingInfo,
  buildWelcomeLetterText,
  setProbation,
  recordProbationDecision,
  ONE_ON_ONE_STATUSES,
  ACTION_ITEM_STATUSES,
  PERFORMANCE_REVIEW_STATUSES,
  OKR_OWNER_TYPES,
  OKR_OBJECTIVE_STATUSES,
  OKR_CONFIDENCE_LEVELS,
  KPI_SOURCES,
  KPI_STATUSES,
  PDP_ITEM_STATUSES,
  listOneOnOnes,
  createOneOnOne,
  updateOneOnOne,
  addOneOnOneAction,
  updateOneOnOneAction,
  listPerformanceReviews,
  createPerformanceReview,
  updatePerformanceReview,
  listObjectives,
  getObjective,
  createObjective,
  updateObjectiveStatus,
  createKeyResult,
  addOkrCheckin,
  updateKeyResultConfidence,
  listKpiTemplates,
  createKpiTemplate,
  updateKpiTemplate,
  listKpisForEmployee,
  createKpiForEmployee,
  updateKpi,
  listDevelopmentPlanItems,
  createDevelopmentPlanItem,
  updateDevelopmentPlanItem,
  KB_CATEGORIES,
  KB_AUDIENCE_TYPES,
  KB_ASSIGNMENT_STATUSES,
  LEARNING_PATH_SCOPES,
  LEARNING_ITEM_TYPES,
  LEARNING_ASSIGNMENT_STATUSES,
  listKbArticles,
  getKbArticle,
  createKbArticle,
  updateKbArticle,
  listKbAssignmentsForEmployee,
  assignKbArticle,
  assignArticleToAudience,
  acknowledgeKbAssignment,
  listLearningPaths,
  getLearningPath,
  createLearningPath,
  updateLearningPath,
  addLearningPathItem,
  generateLearningAssignments,
  listLearningAssignmentsForEmployee,
  getLearningAssignment,
  markLearningItemComplete,
  completeLearningAssignment,
  SURVEY_TYPES,
  SURVEY_STATUSES,
  SURVEY_QUESTION_TYPES,
  listSurveys,
  getSurvey,
  createSurvey,
  updateSurveyStatus,
  addSurveyQuestion,
  inviteEmployees,
  inviteAllActiveEmployees,
  submitSurveyResponse,
  getSurveyResults,
  ABSENCE_TYPES,
  ABSENCE_STATUSES,
  listAbsences,
  createAbsence,
  updateAbsenceStatus,
  updateAbsence,
  OFFBOARDING_INITIATION_TYPES,
  OFFBOARDING_STATUSES,
  OFFBOARDING_CHECKLIST_CATEGORIES,
  OFFBOARDING_CHECKLIST_STATUSES,
  RECOMMEND_COMPANY_OPTIONS,
  listOffboardingCases,
  getOffboardingCasesForEmployee,
  getOffboardingCase,
  initiateOffboarding,
  updateOffboardingCase,
  updateOffboardingCaseStatus,
  addOffboardingChecklistItem,
  updateOffboardingChecklistItem,
  upsertExitInterview,
  closeOffboardingCase,
  uploadResumeAndMatchCandidate,
  addResumeToCandidate,
  listResumesForCandidate,
  getResumeFile,
  addVacancyRequestAttachment,
  listVacancyRequestAttachments,
  getVacancyRequestAttachmentFile,
  getDashboardMetrics,
  getRecruitmentMetrics
};
