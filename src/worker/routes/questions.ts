import type { Env, QuestionSetting } from '../schema';

export async function handleQuestionRoutes(
  request: Request,
  env: Env,
  pathname: string
): Promise<Response | null> {
  if (pathname === '/api/questions' && request.method === 'GET') {
    const result = await env.DB.prepare(
      `SELECT * FROM question_settings WHERE visible = 1 ORDER BY display_order ASC`
    ).all<QuestionSetting>();
    return Response.json({ questions: result.results ?? [] });
  }
  return null;
}
