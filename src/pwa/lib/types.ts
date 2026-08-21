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
  proxy_name: string | null; // display metadata — the phone is the pickup-match key
  proxy_phone: string | null;
}

// import type only — erased at build time, so this does not create a real
// module cycle with the component tree.
import type { SummaryFamily } from '../components/enter/SummaryScreen';

export type EnterView =
  | { type: 'lookup' }
  | { type: 'results'; results: FamilySearchResult[]; searchName: string; searchPhone: string | null; offline?: boolean }
  | { type: 'family-select'; own: FamilySearchResult | null; proxy: FamilySearchResult[]; pickupName: string; pickupPhone: string | null; extra?: FamilySearchResult[]; selectedIds?: string[]; notice?: string }
  | { type: 'inline-register'; prefillName: string; returnTo: { own: FamilySearchResult | null; proxy: FamilySearchResult[]; pickupName: string; pickupPhone: string | null; extra: FamilySearchResult[]; selectedIds: string[] } }
  | { type: 'log-visit'; families: FamilySearchResult[]; current: number; pickupPhone: string | null }
  | { type: 'how-many'; searchName: string; searchPhone: string | null }
  | { type: 'consent'; familyCount: number; searchName: string; searchPhone: string | null }
  | { type: 'proxy-question'; familyIndex: number; total: number; prefillName: string; prefillPhone: string | null }
  | { type: 'wizard'; familyIndex: number; total: number; initialData: Partial<WizardFormData>; proxyData: ProxyData | null }
  | { type: 'done'; families: SummaryFamily[]; error?: string };
