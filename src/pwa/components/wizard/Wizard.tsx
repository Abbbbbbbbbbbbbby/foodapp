import { useState, useEffect } from 'react';
import type { WizardFormData, ProxyData, YesNoDeclined } from '../../lib/types';
import { setTelemetryContext } from '../../lib/telemetry';
import { formatPhoneAsTyped } from '../../lib/phone';
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
function cap(s: string) { return s.charAt(0).toUpperCase() + s.slice(1); }

function makeLabel(familyIndex: number, total: number) {
  if (total === 1) return {
    familyEn: 'this family',
    familyEs: 'esta familia',
  };
  return {
    familyEn: `the ${ordinalEn(familyIndex)} family`,
    familyEs: `la ${ordinalEs(familyIndex)} familia`,
  };
}

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

  function yesLabel() { return isSpanish ? <><span>Sí</span><span style={{ fontSize: 13, color: 'var(--text-muted)' }}>Yes</span></> : <><span>Yes</span><span style={{ fontSize: 13, color: 'var(--text-muted)' }}>Sí</span></>; }
  function noLabel() { return <span>No</span>; }
  function dkLabel() { return isSpanish
    ? <><span>No sé / Prefiero no responder</span><span style={{ fontSize: 13, color: 'var(--text-muted)' }}>{"Don't know / Prefer not to say"}</span></>
    : <><span>{"Don't know / Prefer not to say"}</span><span style={{ fontSize: 13, color: 'var(--text-muted)' }}>No sé / Prefiero no responder</span></>; }

  if (subStep === 0) {
    return (
      <div className="wizard-step">
        <button className="btn-ghost" onClick={onBack}>Back / Atrás</button>
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
      </div>
    );
  }

  return (
    <div className="wizard-step">
      <button className="btn-ghost" onClick={() => setSubStep(0)}>Back / Atrás</button>
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
  initialStep?: number;
  onStateChange?: (step: number, data: Partial<WizardFormData>) => void;
}

export default function Wizard({ familyIndex, total, initialData, proxyData, onComplete, onBack, initialStep, onStateChange }: WizardProps) {
  const [step, setStep] = useState(initialStep ?? 0);
  const [data, setData] = useState<Partial<WizardFormData>>({ ...initialData });
  const [submitting, setSubmitting] = useState(false);
  const label = makeLabel(familyIndex, total);

  // Render-body write (not an effect): a crash during THIS render must still
  // report the step it crashed on, not the previous one — an effect would
  // never run if the render itself throws. wizard_step is 1-based
  // everywhere (matches "Step N of 11" below and the DB column).
  setTelemetryContext({ wizardStep: step + 1 });
  // The e2e error-boundary spec sets window.__throwAtWizardStep (1-based,
  // displayed step) before walking in — this line intentionally ships in
  // the production bundle (inert without console/devtools access) so no
  // second build mode is needed for that test.
  if (typeof window !== 'undefined' && window.__throwAtWizardStep === step + 1) {
    throw new Error(`[e2e test hook] forced throw at wizard step ${step + 1}`);
  }

  useEffect(() => {
    onStateChange?.(step, data);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, data]);

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
          questionEn={`What is the phone number for ${label.familyEn}?`}
          questionEs={`¿Cuál es el número de teléfono de ${label.familyEs}?`}
          value={formatPhoneAsTyped(data.phone ?? '')}
          onChange={v => set('phone', v)}
          onNext={next}
          onBack={goBack}
          onSkip={() => { set('phone', null); next(); }}
        />
      )}
      {step === 2 && (
        <TextInput
          questionEn={`What is the zip code for ${label.familyEn}?`}
          questionEs={`¿Cuál es el código postal de ${label.familyEs}?`}
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
          questionEn={`What language does ${label.familyEn} prefer?`}
          questionEs={`¿Qué idioma prefiere ${label.familyEs}?`}
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
          questionEn={`How many people live in ${label.familyEn}?`}
          questionEs={`¿Cuántas personas viven en ${label.familyEs}?`}
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
            questionEn={`How many children under 18 live in ${label.familyEn}?`}
            questionEs={`¿Cuántos niños menores de 18 años viven en ${label.familyEs}?`}
            onChange={v => {
              set('num_children_under_18', v);
              if (v === 0) { set('num_children_under_5', 0); setStep(s => s + 2); } else { next(); }
            }}
            onBack={goBack}
            onSkip={() => { set('num_children_under_18', null); next(); }}
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
            questionEn={`How many children under 5 live in ${label.familyEn}?`}
            questionEs={`¿Cuántos niños menores de 5 años viven en ${label.familyEs}?`}
            onChange={v => { set('num_children_under_5', v); next(); }}
            onBack={goBack}
            onSkip={() => { set('num_children_under_5', null); next(); }}
            options={opts5}
            overflowLabel={hasOverflow5 ? '6+' : undefined}
            overflowMin={hasOverflow5 ? 6 : undefined}
          />
        );
      })()}
      {step === 7 && (
        <IncomeInput
          questionEn={`How much money does ${label.familyEn} earn in a week, two weeks, a month, or a year?`}
          questionEs={`¿Cuánto dinero gana en total ${label.familyEs} por semana, cada dos semanas, al mes o al año?`}
          familySize={data.num_people ?? 1}
          onChange={v => { set('ami_bracket', v); next(); }}
          onBack={goBack}
          onSkip={() => { set('ami_bracket', 'declined'); next(); }}
        />
      )}
      {step === 8 && (
        <SelectInput
          questionEn={`Does ${label.familyEn} currently receive SNAP benefits?`}
          questionEs={`¿${cap(label.familyEs)} recibe beneficios de SNAP actualmente?`}
          onChange={v => { set('snap_benefits', v as YesNoDeclined); next(); }}
          onBack={goBack}
          options={YES_NO_DECLINED}
          language={data.language}
        />
      )}
      {step === 9 && (
        <SelectInput
          questionEn={`Does anyone in ${label.familyEn} have health insurance?`}
          questionEs={`¿Alguien en ${label.familyEs} tiene seguro de salud?`}
          noteEn="Includes all types — Medicaid, Medicare, Access, employer, or private."
          noteEs="Incluye todos los tipos — Medicaid, Medicare, Access, del empleador o privado."
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
