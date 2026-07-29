export type UserRole = 'admin' | 'staff' | 'volunteer';
export type YesNoDeclined = 'yes' | 'no' | 'declined';
export type AmiBracket = '<30%' | '30-50%' | '50-80%' | '80-120%' | '>120%' | 'declined';

export interface User {
  id: string;
  name: string;
  phone: string;
  role: UserRole;
  active: boolean;
  self_registered: boolean;
  created_at: string;
}

export interface Family {
  id: string;
  name: string;
  phone: string | null;
  address: string | null;
  zip_code: string | null;
  date_of_birth: string | null;
  language: string | null;
  ethnicity: string | null;
  hispanic: YesNoDeclined | null;
  ami_bracket: AmiBracket | null;
  num_people: number | null;
  num_children_under_18: number | null;
  num_children_under_5: number | null;
  num_with_diabetes: number | null;
  health_insurance: YesNoDeclined | null;
  snap_benefits: YesNoDeclined | null;
  receives_texts: boolean | null;
  want_text_updates: boolean | null;
  id_confirmed: boolean | null;
  bag_received: boolean | null;
  first_visit_date: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface Visit {
  id: string;
  family_id: string;
  visit_date: string;
  picked_up_by_phone: string | null;
  volunteer_id: string | null;
  created_at: string;
}

export interface Proxy {
  id: string;
  family_id: string;
  proxy_name: string | null;
  proxy_phone: string | null;
  proxy_form_ref: string | null;
  created_at: string;
}

export interface Env {
  DB: D1Database;
  SESSIONS: KVNamespace;
  ASSETS: Fetcher;
  TWILIO_ACCOUNT_SID: string;
  TWILIO_AUTH_TOKEN: string;
  TWILIO_PHONE_NUMBER: string;
  JWT_SECRET: string;
  ENVIRONMENT: string;
  MESSAGE_EVERYWHERE_API_KEY: string;
}

export type NewFamily = Omit<Family, 'id' | 'created_at' | 'updated_at'>;
export type NewVisit = Omit<Visit, 'id' | 'created_at'>;

export type QuestionInputType =
  | 'text' | 'phone' | 'number' | 'select' | 'multiselect'
  | 'yesno' | 'yesno_declined' | 'income';

export interface QuestionSetting {
  id: string;
  field_name: string;
  label_en: string;
  label_es: string;
  hint_en: string | null;
  hint_es: string | null;
  input_type: QuestionInputType;
  options_en: string | null;
  options_es: string | null;
  visible: number;  // D1 INTEGER: 1 = shown, 0 = hidden
  required: number; // D1 INTEGER: 1 = required, 0 = optional
  display_order: number;
  updated_at: string;
}
