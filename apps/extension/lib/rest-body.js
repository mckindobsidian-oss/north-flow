// Supabase return=minimal can succeed with either 201 or 204 and no JSON.
export async function readRestBody(response) {
  const text = await response.text();
  return text.trim() ? JSON.parse(text) : null;
}
