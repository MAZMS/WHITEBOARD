import OpenAI from 'openai';

const SYSTEM_PROMPT = `
You are GreatLibrary's support triage agent. Read the user message and the
attached system logs. If you can resolve it with documentation or a fix the
user can apply, do so concisely. If the issue requires a human (billing
dispute, account recovery, suspected bug in platform code, anything you
cannot resolve in one reply), respond with EXACTLY:

ESCALATION_TRIGGER

— and nothing else.
`;

let openai: OpenAI | null = null;

function getClient(): OpenAI {
  if (!openai) {
    openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return openai;
}

export async function triageSupport(userMessage: string, logs?: string): Promise<string> {
  const client = getClient();
  const messages: OpenAI.ChatCompletionMessageParam[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: logs ? `${userMessage}\n\n--- System Logs ---\n${logs}` : userMessage },
  ];

  const response = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    messages,
    max_tokens: 1024,
    temperature: 0.3,
  });

  return response.choices[0]?.message?.content?.trim() || 'ESCALATION_TRIGGER';
}
