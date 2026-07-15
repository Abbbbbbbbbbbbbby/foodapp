import { useState } from 'react';
import type { WizardFormData, ProxyData, YesNoDeclined } from '../../lib/types';
import TextInput from './inputs/TextInput';
import PhoneInput from './inputs/PhoneInput';
import NumberInput from './inputs/NumberInput';
import SelectInput from './inputs/SelectInput';
import IncomeInput from './inputs/IncomeInput';

const TOTAL_STEPS = 11;

const YES_NO_DECLINED = [
  { value: 'yes', labelEn: 'Yes / Sí', labelEs: 'Sí / Yes' },
  { value: 'no', labelEn: 'No / No', labelEs: 'No / No' },
  { value: 'declined', labelEn: 'Prefer not to say / Prefiero no responder', labelEs: 'Prefiero no responder' },
];

interface TextsStepProps {
  onComplete: (receivesTexts: boolean | null, wantUpdates: boolean | null) => void;
  onBack: () => void;
}

function TextsStep({ onComplete, onBack }: TextsStepProps) {
  const [subStep, setSubStep] = useState(0);

  if (subStep === 0) {
    return (
      <div className="wizard-step">
        <p className="question-en">Do you currently receive text messages?</p>
        <p className="question-es">¿Actualmente recibe mensajes de texto?</p>
        <div className="option-list">
          <button className="btn-option" onClick={() => setSubStep(1)}>
            Yes / Sí
          </button>
          <button className="btn-option" onClick={() => onComplete(false, null)}>
            No / No
          </button>
          <button className="btn-option" onClick={() => onComplete(null, null)}>
            Prefer not to say / Prefiero no responder
          </button>
        </div>
        <div className="step-actions"><button className="btn-ghost" onClick={onBack}>Back / Atrás</button></div>
      </div>
    );
  }

  return (
    <div className="wizard-step">
      <p className="question-en">
        Would you like to receive text updates about food distribution events?
      </p>
      <p className="question-es">
        ¿Le gustaría recibir actualizaciones por mensaje de texto sobre eventos de distribución de alimentos?
      </p>
      <div className="option-list">
        <button className="btn-option" onClick={() => onComplete(true, true)}>
          Yes / Sí
        </button>
        <button className="btn-option" onClick={() => onComplete(true, false)}>
          No / No
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
          questionEn="What is your full name?"
          questionEs="¿Cuál es su nombre completo?"
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
          inputMode="numeric"
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
            { value: 'other', labelEn: 'Other / Otro', labelEs: 'Otro / Other' },
            { value: 'declined', labelEn: 'Prefer not to say / Prefiero no responder', labelEs: 'Prefiero no responder' },
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
      {step === 5 && (
        <NumberInput
          questionEn="How many children under 18 live in your household?"
          questionEs="¿Cuántos niños menores de 18 años viven en su hogar?"
          onChange={v => { set('num_children_under_18', v); next(); }}
          onBack={goBack}
          options={[0, 1, 2, 3, 4, 5]}
          overflowLabel="6+"
          overflowMin={6}
        />
      )}
      {step === 6 && (
        <NumberInput
          questionEn="How many children under 5 live in your household?"
          questionEs="¿Cuántos niños menores de 5 años viven en su hogar?"
          onChange={v => { set('num_children_under_5', v); next(); }}
          onBack={goBack}
          options={[0, 1, 2, 3, 4]}
          overflowLabel="5+"
          overflowMin={5}
        />
      )}
      {step === 7 && (
        <IncomeInput
          questionEn="How often do you get paid? And about how much each time?"
          questionEs="¿Con qué frecuencia le pagan? ¿Y aproximadamente cuánto cada vez?"
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
        />
      )}
      {step === 9 && (
        <SelectInput
          questionEn="Does anyone in your family have health insurance?"
          questionEs="¿Alguien en su familia tiene seguro de salud?"
          onChange={v => { set('health_insurance', v as YesNoDeclined); next(); }}
          onBack={goBack}
          options={YES_NO_DECLINED}
        />
      )}
      {step === 10 && (
        <TextsStep
          onComplete={(rt, wu) => {
            if (!submitting) finish({ ...data, receives_texts: rt, want_text_updates: wu });
          }}
          onBack={goBack}
        />
      )}
    </div>
  );
}
