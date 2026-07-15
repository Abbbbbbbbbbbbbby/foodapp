export type UserRole = 'admin' | 'staff' | 'volunteer';
export type YesNoDeclined = 'yes' | 'no' | 'declined';
export type AmiBracket = '<30%' | '30-50%' | '50-80%' | '80-120%' | '>120%' | 'declined';

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

export interface FamilySearchResult extends Family {
  last_visit_date: string | null;
}

export interface WizardFormData {
  name: string;
  phone: string | null;
  zip_code: string | null;
  language: string | null;
  num_people: number | null;
  num_children_under_18: number | null;
  num_children_under_5: number | null;
  ami_bracket: AmiBracket | null;
  snap_benefits: YesNoDeclined | null;
  health_insurance: YesNoDeclined | null;
  receives_texts: boolean | null;
  want_text_updates: boolean | null;
}

export interface ProxyData {
  proxy_name: string;
  proxy_phone: string | null;
}
