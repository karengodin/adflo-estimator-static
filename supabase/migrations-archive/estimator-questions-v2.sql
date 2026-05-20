-- ─────────────────────────────────────────────────────────────────────────────
-- Estimator Questions v2 Migration
-- Run this in Supabase SQL Editor.
-- Deletes all existing questions, adds new schema columns, inserts 29 questions,
-- and updates logic_settings tiers + rates.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Add new columns to questions table
ALTER TABLE questions ADD COLUMN IF NOT EXISTS question_type  TEXT    NOT NULL DEFAULT 'yesno';
ALTER TABLE questions ADD COLUMN IF NOT EXISTS conditional_logic JSONB  NULL;
ALTER TABLE questions ADD COLUMN IF NOT EXISTS is_risk_multiplier BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE questions ADD COLUMN IF NOT EXISTS risk_multiplier_value NUMERIC NULL;
ALTER TABLE questions ADD COLUMN IF NOT EXISTS risk_direction  TEXT    NULL;
-- risk_direction values: 'yes_adds_hours' | 'no_adds_risk' | null

-- 2. Add new columns to logic_settings
ALTER TABLE logic_settings ADD COLUMN IF NOT EXISTS product_hour_rate   NUMERIC NOT NULL DEFAULT 4;
ALTER TABLE logic_settings ADD COLUMN IF NOT EXISTS connector_hour_rate NUMERIC NOT NULL DEFAULT 12;

-- 3. Clear existing questions and reset ID sequence
TRUNCATE questions, weight_adjustments RESTART IDENTITY;

-- 4. Insert 29 new questions (explicit ids to avoid missing-default issue)
INSERT INTO questions
  (id, cat, q, trigger, weight, can_remove, sort_order, active, blocker, sow,
   question_type, conditional_logic, is_risk_multiplier, risk_multiplier_value, risk_direction)
VALUES

-- ── Data & Structure ─────────────────────────────────────────────────────────
(1, 'Data & Structure',
 'Will Adflo be the single source of truth for all campaign and order data?',
 'Yes', 10, false, 1, true, false, false,
 'yesno', null, false, null, 'yes_adds_hours'),

(2, 'Data & Structure',
 'Do you need to import historical campaign or order data?',
 'Yes', 12, false, 2, true, false, false,
 'yesno', null, false, null, 'yes_adds_hours'),

-- ── Workflow & Approvals ─────────────────────────────────────────────────────
(3, 'Workflow & Approvals',
 'Do orders require more than one approval step before activation?',
 'Yes', 6, false, 3, true, false, false,
 'yesno', null, false, null, 'yes_adds_hours'),

(4, 'Workflow & Approvals',
 'Do approvals involve multiple departments (Sales, Finance, Ops, etc.)?',
 'Yes', 8, false, 4, true, false, false,
 'yesno', null, false, null, 'yes_adds_hours'),

(5, 'Workflow & Approvals',
 'Do you require conditional workflow routing (if/then rules)?',
 'Yes', 10, false, 5, true, false, false,
 'yesno', null, false, null, 'yes_adds_hours'),

(6, 'Workflow & Approvals',
 'Do you require automated SLA tracking or deadlines in workflows?',
 'Yes', 6, false, 6, true, false, false,
 'yesno', null, false, null, 'yes_adds_hours'),

-- ── Integrations ─────────────────────────────────────────────────────────────
(7, 'Integrations',
 'Will Adflo integrate with a CRM system?',
 'Yes', 12, false, 7, true, false, false,
 'yesno', null, false, null, 'yes_adds_hours'),

(8, 'Integrations',
 'Will Adflo integrate with proposal or quoting tools?',
 'Yes', 8, false, 8, true, false, false,
 'yesno', null, false, null, 'yes_adds_hours'),

(9, 'Integrations',
 'Will Adflo integrate with billing or finance systems?',
 'Yes', 14, false, 9, true, false, false,
 'yesno', null, false, null, 'yes_adds_hours'),

(10, 'Integrations',
 'Will Adflo receive data from external platforms via API or webhook?',
 'Yes', 16, false, 10, true, false, false,
 'yesno', null, false, null, 'yes_adds_hours'),

-- Q11: only show if any of Q7-Q10 answered Yes
(11, 'Integrations',
 'Do any integrations require bi-directional syncing?',
 'Yes', 8, false, 11, true, false, false,
 'yesno', '{"type":"any_answered_yes_or_nonzero","sort_orders":[7,8,9,10]}'::jsonb,
 false, null, 'yes_adds_hours'),

-- Q12: number type — 12 hrs per connector
(12, 'Integrations',
 'How many push connectors to ad servers or external vendors do you require?',
 'Yes', 12, false, 12, true, false, false,
 'number', null, false, null, 'yes_adds_hours'),

-- ── Configuration ────────────────────────────────────────────────────────────
-- Q13: number type — tiered product hours, base rate in logic_settings
(13, 'Configuration',
 'How many products do you offer?',
 'Yes', 4, false, 13, true, false, false,
 'number', null, false, null, 'yes_adds_hours'),

-- Q14: only show if Q13 > 0; Yes multiplies product hours × 1.5
(14, 'Configuration',
 'Will products include flight forms and workflows?',
 'Yes', 0, false, 14, true, false, false,
 'yesno', '{"type":"greater_than","sort_order":13,"value":0}'::jsonb,
 false, null, 'yes_adds_hours'),

(15, 'Configuration',
 'Will you require custom task forms?',
 'Yes', 5, false, 15, true, false, false,
 'yesno', null, false, null, 'yes_adds_hours'),

(16, 'Configuration',
 'Will you require buy sheets or IO exports?',
 'Yes', 5, false, 16, true, false, false,
 'yesno', null, false, null, 'yes_adds_hours'),

(17, 'Configuration',
 'Will the platform need to support multiple business units or brands?',
 'Yes', 10, false, 17, true, false, false,
 'yesno', null, false, null, 'yes_adds_hours'),

(18, 'Configuration',
 'Will users require different permission levels or roles?',
 'Yes', 6, false, 18, true, false, false,
 'yesno', null, false, null, 'yes_adds_hours'),

-- ── Reporting & Financial ─────────────────────────────────────────────────────
(19, 'Reporting & Financial',
 'Do you require custom financial tracking (margin, COGS, reconciliation)?',
 'Yes', 10, false, 19, true, false, false,
 'yesno', null, false, null, 'yes_adds_hours'),

(20, 'Reporting & Financial',
 'Do you require billing automation or invoice generation?',
 'Yes', 10, false, 20, true, false, false,
 'yesno', null, false, null, 'yes_adds_hours'),

(21, 'Reporting & Financial',
 'Will campaign revenue need to be adjusted via change orders?',
 'Yes', 6, false, 21, true, false, false,
 'yesno', null, false, null, 'yes_adds_hours'),

(22, 'Reporting & Financial',
 'Will you need pacing data during campaigns?',
 'Yes', 4, false, 22, true, false, false,
 'yesno', null, false, null, 'yes_adds_hours'),

-- ── Organizational Readiness ─────────────────────────────────────────────────
-- Q23-Q26: risk multipliers. No = adds % to total hours.
(23, 'Organizational Readiness',
 'Do you have a dedicated internal implementation lead?',
 'Yes', 0, false, 23, true, false, false,
 'yesno', null, true, 1.15, 'no_adds_risk'),

(24, 'Organizational Readiness',
 'Do you have documented current workflows?',
 'Yes', 0, false, 24, true, false, false,
 'yesno', null, true, 1.10, 'no_adds_risk'),

(25, 'Organizational Readiness',
 'Do stakeholders agree on how workflows should operate in Adflo?',
 'Yes', 0, false, 25, true, false, false,
 'yesno', null, true, 1.20, 'no_adds_risk'),

-- Q26: only show if any integrations answered; No = 10% risk
(26, 'Organizational Readiness',
 'Do you have a dedicated technical resource for integrations?',
 'Yes', 0, false, 26, true, false, false,
 'yesno', '{"type":"any_answered_yes_or_nonzero","sort_orders":[7,8,9,10,11,12]}'::jsonb,
 true, 1.10, 'no_adds_risk'),

-- Q27: date type — red flag if < 8 weeks from today
(27, 'Organizational Readiness',
 'What is your target go-live date?',
 'Yes', 0, false, 27, true, false, false,
 'date', null, false, null, null),

-- ── Scale ────────────────────────────────────────────────────────────────────
(28, 'Scale',
 'Will more than 20 users access the platform?',
 'Yes', 4, false, 28, true, false, false,
 'yesno', null, false, null, 'yes_adds_hours'),

(29, 'Scale',
 'Will the platform support more than one geographic market or region?',
 'Yes', 6, false, 29, true, false, false,
 'yesno', null, false, null, 'yes_adds_hours');

-- 5. Update logic_settings
UPDATE logic_settings
SET
  base_hours            = 0,
  best_case_multiplier  = 0.8,
  worst_case_multiplier = 1.3,
  product_hour_rate     = 4,
  connector_hour_rate   = 12,
  tiers = '[
    {"name":"Bronze",     "min_hours":0,   "timeline":"3–5 weeks"},
    {"name":"Silver",     "min_hours":61,  "timeline":"5–8 weeks"},
    {"name":"Gold",       "min_hours":121, "timeline":"8–12 weeks"},
    {"name":"Enterprise", "min_hours":201, "timeline":"12–16 weeks"}
  ]'::jsonb
WHERE id = 'global';

-- Verify
SELECT id, sort_order, cat, question_type, weight, is_risk_multiplier, risk_multiplier_value
FROM questions
ORDER BY sort_order;

SELECT base_hours, product_hour_rate, connector_hour_rate, tiers
FROM logic_settings
WHERE id = 'global';
