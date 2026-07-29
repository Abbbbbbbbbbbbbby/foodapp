const BASE = 'https://messageeverywhere.app/api/1.1/obj';

function toBubbleLang(language: string | null): 'English' | 'Spanish' {
  return language?.toLowerCase().includes('spanish') ? 'Spanish' : 'English';
}

// Best-effort: subscribe a phone number to Message Everywhere.
// Searches first to avoid creating duplicates; silently no-ops on any error.
export async function subscribeRecipient(
  apiKey: string,
  phone: string,
  language: string | null,
  name: string
): Promise<void> {
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };

  // Check for an existing recipient with this phone number
  const constraints = JSON.stringify([
    { key: 'Phone Number', constraint_type: 'equals', value: phone },
  ]);
  const searchResp = await fetch(
    `${BASE}/recipient?constraints=${encodeURIComponent(constraints)}`,
    { headers }
  );
  if (searchResp.ok) {
    const json = await searchResp.json() as { response?: { count?: number } };
    if ((json.response?.count ?? 0) > 0) return; // already subscribed
  }

  await fetch(`${BASE}/recipient`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      'Phone Number': phone,
      Language: toBubbleLang(language),
      'First Name': name,
    }),
  });
}
