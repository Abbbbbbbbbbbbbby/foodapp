import { useState } from 'react';
import type { WizardFormData, ProxyData, YesNoDeclined } from '../../lib/types';
import TextInput from './inputs/TextInput';
import PhoneInput from './inputs/PhoneInput';
import NumberInput from './inputs/NumberInput';
import SelectInput from './inputs/SelectInput';
import IncomeInput from './inputs/IncomeInput';

const TOTAL_STEPS = 11;

const ORDINALS_EN = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth'];
const ORDINALS_ES = ['primera', 'segunda', 'tercera', 'cuarta', 'quinta', 'sexta', 'séptima', 'octava', 'novena', 'décima'];
function ordinalEn(i: number) { return ORDINALS_EN[i] ?? `${i + 1}th`; }
function ordinalEs(i: number) { return ORDINALS_ES[i] ?? `${i + 1}ª`; }

const YES_NO_DECLINED = [
  { value: 'yes', labelEn: 'Yes', labelEs: 'Sí' },
  { value: 'no', labelEn: 'No', labelEs: 'No' },
  { value: 'declined', labelEn: "Don't know / Prefer not to say", labelEs: 'No sé / Prefiero no responder' },
];

interface TextsStepProps {
  language?: string | null;
  onComplete: (receivesTexts: boolean | null, wantUpdates: boolean | null) => void;
  onBack: () => void;
}

// Exported for direct unit testing (walking 10 heterogeneous wizard steps in
// a DOM test is brittle; the sub-step logic here is what needs pinning).
export function TextsStep({ language, onComplete, onBack }: TextsStepProps) {
  const [subStep, setSubStep] = useState(0);
  const [receivesTexts, setReceivesTexts] = useState<boolean | null>(null);

  const isSpanish = language?.toLowerCase().startsWith('es');

  function yesLabel() { return isSpanish ? <><span>Sí</span><span style={{ fontSize: 14, color: 'var(--text-muted)' }}>Yes</span></> : <><span>Yes</span><span style={{ fontSize: 14, color: 'var(--text-muted)' }}>Sí</span></>; }
  function noLabel() { return <span>No</span>; }
  function dkLabel() { return isSpanish
    ? <><span>No sé / Prefiero no responder</span><span style={{ fontSize: 14, color: 'var(--text-muted)' }}>{"Don't know / Prefer not to say"}</span></>
    : <><span>{"Don't know / Prefer not to say"}</span><span style={{ fontSize: 14, color: 'var(--text-muted)' }}>No sé / Prefiero no responder</span></>; }

  if (subStep === 0) {
    return (
      <div className="wizard-step">
        <p className="question-en">Do you currently receive weekly text messages from us?</p>
        <p className="question-es">¿Actualmente recibe mensajes de texto semanales de nuestra parte?</p>
        <div className="option-list">
          <button className="btn-option" onClick={() => onComplete(true, null)}>
            {yesLabel()}
          </button>
          <button className="btn-option" onClick={() => { setReceivesTexts(false); setSubStep(1); }}>
            {noLabel()}
          </button>
          <button className="btn-option" onClick={() => { setReceivesTexts(null); setSubStep(1); }}>
            {dkLabel()}
          </button>
        </div>
        <div className="step-actions"><button className="btn-ghost" onClick={onBack}>Back / Atrás</button></div>
      </div>
    );
  }

  return (
    <div className="wizard-step">
      <p className="question-en">
        Would you like to receive weekly text updates about food distribution events?
      </p>
      <p className="question-es">
        ¿Le gustaría recibir actualizaciones semanales por mensaje de texto sobre eventos de distribución de alimentos?
      </p>
      <div className="option-list">
        <button className="btn-option" onClick={() => onComplete(receivesTexts, true)}>
          {yesLabel()}
        </button>
        <button className="btn-option" onClick={() => onComplete(receivesTexts, false)}>
          {noLabel()}
        </button>
      </div>
      <div className="step-actions">
        <button className="btn-ghost" onClick={() => setSubStep(0)}>Back / Atrás</button>
      </div>
    </div>
  );
}

interface WizardProps {
  familyIndex: number;
  total: number;
  initialData: Partial<WizardFormData>;
  proxyData: ProxyData | null;
  onComplete: (data: WizardFormData, proxy: ProxyData | null) => Promise<void>;
  onBack: () => void;
}

export default function Wizard({ familyIndex, total, initialData, proxyData, onComplete, onBack }: WizardProps) {
  const [step, setStep] = useState(0);
  const [data, setData] = useState<Partial<WizardFormData>>({ ...initialData });
  const [submitting, setSubmitting] = useState(false);

  function set<K extends keyof WizardFormData>(key: K, value: WizardFormData[K]) {
    setData(prev => ({ ...prev, [key]: value }));
  }

  function next() { setStep(s => s + 1); }

  function goBack() {
    if (step === 0) onBack(); else setStep(s => s - 1);
  }

  async function finish(finalData: Partial<WizardFormData>) {
    setSubmitting(true);
    try {
      await onComplete(finalData as WizardFormData, proxyData);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="wizard">
      <div className="wizard-header">
        <p className="wizard-progress">
          Family {familyIndex + 1} of {total} — Step {step + 1} of {TOTAL_STEPS}
        </p>
        <div className="progress-bar">
          <div className="progress-fill" style={{ width: `${((step + 1) / TOTAL_STEPS) * 100}%` }} />
        </div>
      </div>

      {step === 0 && (
        <TextInput
          questionEn={total === 1
            ? 'What is the full name of the person receiving the food?'
            : `What is the full name of the person receiving the food in the ${ordinalEn(familyIndex)} family?`}
          questionEs={total === 1
            ? '¿Cuál es el nombre completo de la persona que recibe los alimentos?'
            : `¿Cuál es el nombre completo de la persona que recibe los alimentos en la ${ordinalEs(familyIndex)} familia?`}
          value={data.name ?? ''}
          onChange={v => set('name', v)}
          onNext={next}
          onBack={goBack}
          required
        />
      )}
      {step === 1 && (
        <PhoneInput
          questionEn="What is your phone number?"
          questionEs="¿Cuál es su número de teléfono?"
          value={data.phone ?? ''}
          onChange={v => set('phone', v)}
          onNext={next}
          onBack={goBack}
          onSkip={() => { set('phone', null); next(); }}
        />
      )}
      {step === 2 && (
        <TextInput
          questionEn="What is your zip code?"
          questionEs="¿Cuál es su código postal?"
          value={data.zip_code ?? ''}
          onChange={v => set('zip_code', v)}
          onNext={next}
          onBack={goBack}
          onSkip={() => { set('zip_code', null); next(); }}
          type="tel"
        />
      )}
      {step === 3 && (
        <SelectInput
          questionEn="What language do you prefer?"
          questionEs="¿Qué idioma prefiere?"
          onChange={v => { set('language', v); next(); }}
          onBack={goBack}
          options={[
            { value: 'en', labelEn: 'English', labelEs: 'English' },
            { value: 'es', labelEn: 'Español', labelEs: 'Español' },
            { value: 'other', labelEn: 'Other', labelEs: 'Otro' },
            { value: 'declined', labelEn: "Don't know / Prefer not to say", labelEs: 'No sé / Prefiero no responder' },
          ]}
        />
      )}
      {step === 4 && (
        <NumberInput
          questionEn="How many people live in your household?"
          questionEs="¿Cuántas personas viven en su hogar?"
          onChange={v => { set('num_people', v); next(); }}
          onBack={goBack}
          options={[1, 2, 3, 4, 5, 6]}
          overflowLabel="7+"
          overflowMin={7}
        />
      )}
      {step === 5 && (() => {
        const max18 = data.num_people ?? 6;
        const opts18 = Array.from({ length: Math.min(max18, 6) + 1 }, (_, i) => i);
        const hasOverflow18 = max18 > 6;
        return (
          <NumberInput
            questionEn="How many children under 18 live in your household?"
            questionEs="¿Cuántos niños menores de 18 años viven en su hogar?"
            onChange={v => { set('num_children_under_18', v); next(); }}
            onBack={goBack}
            options={opts18}
            overflowLabel={hasOverflow18 ? '7+' : undefined}
            overflowMin={hasOverflow18 ? 7 : undefined}
          />
        );
      })()}
      {step === 6 && (() => {
        const max5 = data.num_children_under_18 ?? 5;
        const opts5 = Array.from({ length: Math.min(max5, 5) + 1 }, (_, i) => i);
        const hasOverflow5 = max5 > 5;
        return (
          <NumberInput
            questionEn="How many children under 5 live in your household?"
            questionEs="¿Cuántos niños menores de 5 años viven en su hogar?"
            onChange={v => { set('num_children_under_5', v); next(); }}
            onBack={goBack}
            options={opts5}
            overflowLabel={hasOverflow5 ? '6+' : undefined}
            overflowMin={hasOverflow5 ? 6 : undefined}
          />
        );
      })()}
      {step === 7 && (
        <IncomeInput
          questionEn="How much money does your entire household earn in a week, two weeks, a month, or a year?"
          questionEs="¿Cuánto dinero gana en total su hogar por semana, cada dos semanas, al mes o al año?"
          familySize={data.num_people ?? 1}
          onChange={v => { set('ami_bracket', v); next(); }}
          onBack={goBack}
          onSkip={() => { set('ami_bracket', 'declined'); next(); }}
        />
      )}
      {step === 8 && (
        <SelectInput
          questionEn="Does your family currently receive SNAP benefits?"
          questionEs="¿Su familia recibe beneficios de SNAP actualmente?"
          onChange={v => { set('snap_benefits', v as YesNoDeclined); next(); }}
          onBack={goBack}
          options={YES_NO_DECLINED}
          language={data.language}
        />
      )}
      {step === 9 && (
        <SelectInput
          questionEn="Does anyone in your family have health insurance?"
          questionEs="¿Alguien en su familia tiene seguro de salud?"
          onChange={v => { set('health_insurance', v as YesNoDeclined); next(); }}
          onBack={goBack}
          options={YES_NO_DECLINED}
          language={data.language}
        />
      )}
      {step === 10 && (
        <TextsStep
          language={data.language}
          onComplete={(rt, wu) => {
            if (!submitting) finish({ ...data, receives_texts: rt, want_text_updates: wu });
          }}
          onBack={goBack}
        />
      )}
    </div>
  );
}
